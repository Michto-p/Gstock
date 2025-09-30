/* Gstock - barcode.js (mobile robuste + overlay debug) */
'use strict';

let mediaStream = null;
let detector = null;
let videoTrack = null;
let torchOn = false;

let offCanvas = null;
let offCtx = null;

// UI debug
let DBG_UI = { hud: null, roi: null, boundVideo: null };
const PREFERRED_FORMATS = [
  'qr_code','ean_13','ean_8','code_128','code_39','upc_a','upc_e','itf','codabar','data_matrix','pdf417'
];

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
function DBG(){ return !!window.GSTOCK_DEBUG; }

function ensureOffscreen(w=800, h=450){
  if (!offCanvas) {
    offCanvas = document.createElement('canvas');
    offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
  }
  offCanvas.width = w; offCanvas.height = h;
  return offCanvas;
}

function ensureDebugUI(videoEl){
  if (!DBG()) return;
  if (!DBG_UI.hud){
    const hud = document.createElement('div');
    hud.style.cssText = `
      position:fixed; left:8px; bottom:8px; z-index:99999;
      background:rgba(0,0,0,.65); color:#0ff; padding:6px 8px;
      font:12px ui-monospace,monospace; border-radius:8px; pointer-events:none; white-space:pre;
    `;
    hud.textContent = 'DEBUG ready';
    document.body.appendChild(hud);
    DBG_UI.hud = hud;
  }
  if (!DBG_UI.roi){
    const roi = document.createElement('div');
    roi.style.cssText = `
      position:fixed; z-index:99998; border:2px dashed #0ff; border-radius:6px;
      pointer-events:none; box-shadow:0 0 0 9999px rgba(0,0,0,.15) inset;
    `;
    document.body.appendChild(roi);
    DBG_UI.roi = roi;
  }
  DBG_UI.boundVideo = videoEl;
  updateROI();
  window.addEventListener('resize', updateROI);
  window.addEventListener('scroll', updateROI, {passive:true});
}

function teardownDebugUI(){
  if (DBG_UI.hud) { DBG_UI.hud.remove(); DBG_UI.hud = null; }
  if (DBG_UI.roi) { DBG_UI.roi.remove(); DBG_UI.roi = null; }
  DBG_UI.boundVideo = null;
  window.removeEventListener('resize', updateROI);
  window.removeEventListener('scroll', updateROI);
}

function updateROI(){
  if (!DBG() || !DBG_UI.boundVideo || !DBG_UI.roi) return;
  const v = DBG_UI.boundVideo;
  const r = v.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const rx = r.left + r.width * 0.1;
  const ry = r.top  + r.height* 0.1;
  const rw = r.width * 0.8;
  const rh = r.height* 0.8;
  const roi = DBG_UI.roi;
  roi.style.left = `${Math.max(0, rx)}px`;
  roi.style.top  = `${Math.max(0, ry)}px`;
  roi.style.width = `${Math.max(0, rw)}px`;
  roi.style.height= `${Math.max(0, rh)}px`;
}

function updateHUD({fps, candidate, count, lastKnown}){
  if (!DBG() || !DBG_UI.hud) return;
  const lines = [
    `FPS: ${fps.toFixed(1)}`,
    `Candidate: ${candidate||'-'} (${count||0})`,
    `Last known: ${lastKnown||'-'}`
  ];
  DBG_UI.hud.textContent = lines.join('\n');
}

async function getSupportedFormats() {
  try {
    if (window.BarcodeDetector && BarcodeDetector.getSupportedFormats) {
      return await BarcodeDetector.getSupportedFormats();
    }
  } catch(_) {}
  return PREFERRED_FORMATS;
}

// ---- Camera
async function startCamera(videoEl){
  await stopScan();

  // iOS-friendly
  videoEl.setAttribute('playsinline','');
  videoEl.setAttribute('autoplay','');
  videoEl.muted = true;

  const constraints = {
    video: {
      facingMode: { ideal: 'environment' },
      width:      { ideal: 1920 },
      height:     { ideal: 1080 },
      frameRate:  { ideal: 30, max: 60 },
      advanced:   [{ focusMode: 'continuous' }]
    },
    audio: false
  };

  mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = mediaStream;
  await videoEl.play();

  videoTrack = mediaStream.getVideoTracks()[0] || null;

  // Autofocus/zoom si supportés
  try {
    const caps = videoTrack?.getCapabilities?.() || {};
    const settings = videoTrack?.getSettings?.() || {};
    const adv = {};
    if (caps.focusMode && caps.focusMode.includes('continuous')) adv.focusMode = 'continuous';
    if (caps.zoom && caps.zoom.max) {
      const cur = settings.zoom || 1;
      adv.zoom = Math.min(caps.zoom.max, Math.max(caps.zoom.min || 1, cur * 1.35));
    }
    if (Object.keys(adv).length) await videoTrack.applyConstraints({ advanced: [adv] });
  } catch(_) {}

  if (!('BarcodeDetector' in window)) throw new Error('BarcodeDetector non disponible');
  const formats = await getSupportedFormats();
  detector = new window.BarcodeDetector({ formats: formats.length ? formats : PREFERRED_FORMATS });

  // Warm-up pour laisser l'AF bosser un peu
  await sleep(150);

  // Debug overlay
  if (DBG()) ensureDebugUI(videoEl);
  // ROI au premier rendu
  setTimeout(updateROI, 100);
}

// ---- Détection multi-voies (video -> bitmap -> canvas ROI)
async function detectAny(videoEl){
  if (!detector) return [];

  // 1) Direct vidéo
  try {
    const r = await detector.detect(videoEl);
    if (r && r.length) return r;
  } catch(_) {}

  // 2) ImageBitmap
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(videoEl);
      try {
        const r = await detector.detect(bmp);
        bmp.close?.();
        if (r && r.length) return r;
      } catch(_) { bmp.close?.(); }
    } catch(_) {}
  }

  // 3) Canvas ROI (80% centré)
  try {
    const vw = videoEl.videoWidth  || videoEl.clientWidth || 640;
    const vh = videoEl.videoHeight || videoEl.clientHeight || 360;
    const rw = Math.floor(vw * 0.8);
    const rh = Math.floor(vh * 0.8);
    const rx = Math.floor((vw - rw) / 2);
    const ry = Math.floor((vh - rh) / 2);

    const targetW = 960;
    const targetH = Math.floor(targetW * (rh / rw));

    const cnv = ensureOffscreen(targetW, targetH);
    offCtx.drawImage(videoEl, rx, ry, rw, rh, 0, 0, targetW, targetH);

    // léger boost contraste
    try {
      const img = offCtx.getImageData(0,0,targetW,targetH);
      const data = img.data;
      const factor = 1.15;
      for (let i=0;i<data.length;i+=4){
        data[i]   = Math.min(255, data[i]  * factor);
        data[i+1] = Math.min(255, data[i+1]* factor);
        data[i+2] = Math.min(255, data[i+2]* factor);
      }
      offCtx.putImageData(img,0,0);
    } catch(_) {}

    const r = await detector.detect(cnv);
    if (r && r.length) return r;
  } catch(_) {}

  return [];
}

// ---- Boucle principale : retourne un code CONNU, sinon continue
async function scanUntilKnown(videoEl, {confirmFrames = 2, cooldownMs = 700, maxMs = 60000} = {}){
  try{
    await startCamera(videoEl);
  }catch(e){
    alert('Impossible d’accéder à la caméra ou API non supportée.');
    return null;
  }

  const t0 = Date.now();
  let lastAccepted = '';
  let lastAcceptedTs = 0;
  let candidate = '';
  let candidateCount = 0;

  // FPS
  let frames = 0;
  let lastFPSts = performance.now();
  let fps = 0;
  let lastKnown = '';

  return new Promise((resolve)=>{
    let rafId = 0;
    let stopped = false;

    const loop = async ()=>{
      if (stopped) return;

      // Timeout de sécurité
      if ((Date.now() - t0) > maxMs) {
        await stopScan(); resolve(null); return;
      }

      try{
        const results = await detectAny(videoEl);
        const now = Date.now();

        if (results && results[0]) {
          const raw = results[0].rawValue || '';
          if (raw) {
            if (raw === candidate) candidateCount++; else { candidate = raw; candidateCount = 1; }
            const inCooldown = (raw === lastAccepted) && ((now - lastAcceptedTs) < cooldownMs);

            if (!inCooldown && candidateCount >= confirmFrames) {
              let known = null;
              try { known = await dbGet(raw); } catch(_) { known = null; }

              if (known) {
                beep();
                lastAccepted = raw; lastAcceptedTs = now;
                lastKnown = raw;
                stopped = true;
                await stopScan();
                updateHUD({fps, candidate, count: candidateCount, lastKnown});
                resolve(raw);
                return;
              } else {
                window.dispatchEvent(new CustomEvent('gstock:scan-unknown',{detail:{code: raw}}));
                candidate = ''; candidateCount = 0;
              }
            }
          }
        }
      }catch(_) {}

      // FPS calc
      frames++;
      const nowTs = performance.now();
      if (nowTs - lastFPSts >= 1000){
        fps = (frames * 1000) / (nowTs - lastFPSts);
        frames = 0; lastFPSts = nowTs;
      }

      // Debug overlay updates
      if (DBG()){
        updateROI();
        updateHUD({fps, candidate, count: candidateCount, lastKnown});
      }

      if ('requestVideoFrameCallback' in videoEl) {
        videoEl.requestVideoFrameCallback(()=>{ if (!stopped) loop(); });
      } else {
        rafId = requestAnimationFrame(loop);
      }
    };

    // start loop
    if ('requestVideoFrameCallback' in videoEl) {
      videoEl.requestVideoFrameCallback(()=>{ loop(); });
    } else {
      rafId = requestAnimationFrame(loop);
    }
  });
}

async function stopScan(){
  try{
    if (mediaStream) mediaStream.getTracks().forEach(t=>t.stop());
  } finally {
    mediaStream = null;
    detector = null;
    videoTrack = null;
    torchOn = false;
    teardownDebugUI();
  }
}

function beep(){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type='square'; o.frequency.value=880; o.connect(g); g.connect(ctx.destination);
    g.gain.value=0.05; o.start(); setTimeout(()=>{o.stop();ctx.close();},120);
  }catch(_) {}
}

async function toggleTorch(){
  if (!videoTrack) return alert('Lampe non disponible');
  try{
    const caps = videoTrack.getCapabilities?.();
    if (!caps || !caps.torch) return alert('Lampe non supportée sur cet appareil');
    torchOn = !torchOn;
    await videoTrack.applyConstraints({ advanced: [{ torch: torchOn }] });
  }catch(e){
    console.warn(e);
    alert('Impossible d’activer la lampe.');
  }
}

// Expose global
window.scanUntilKnown = scanUntilKnown;
window.stopScan = stopScan;
window.toggleTorch = toggleTorch;
