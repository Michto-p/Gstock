/* Gstock - barcode.js (mobile robuste) */
'use strict';

let mediaStream = null;
let detector = null;
let videoTrack = null;
let torchOn = false;

let offCanvas = null;
let offCtx = null;

const PREFERRED_FORMATS = [
  'qr_code','ean_13','ean_8','code_128','code_39','upc_a','upc_e','itf','codabar','data_matrix','pdf417'
];

// -- Utils
async function getSupportedFormats() {
  try {
    if (window.BarcodeDetector && BarcodeDetector.getSupportedFormats) {
      return await BarcodeDetector.getSupportedFormats();
    }
  } catch(_) {}
  return PREFERRED_FORMATS;
}

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function ensureOffscreen(w=800, h=450){
  if (!offCanvas) {
    offCanvas = document.createElement('canvas');
    offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
  }
  offCanvas.width = w; offCanvas.height = h;
  return offCanvas;
}

// -- Camera
async function startCamera(videoEl){
  await stopScan();

  // Important pour iOS
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

  // Récupère la piste vidéo pour zoom/torch etc.
  videoTrack = mediaStream.getVideoTracks()[0] || null;

  // Autofocus/zoom si possibles
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

  // Prépare detector avec formats réellement supportés
  if (!('BarcodeDetector' in window)) throw new Error('BarcodeDetector non disponible sur ce navigateur');
  const formats = await getSupportedFormats();
  detector = new window.BarcodeDetector({ formats: formats.length ? formats : PREFERRED_FORMATS });

  // Petit warm-up (mise au point)
  await sleep(150);
}

// -- Détection multi-voies (video → bitmap → canvas ROI)
async function detectAny(videoEl){
  if (!detector) return [];

  // 1) Directement sur la vidéo
  try {
    const r = await detector.detect(videoEl);
    if (r && r.length) return r;
  } catch(_) {}

  // 2) Via ImageBitmap (certains devices y arrivent mieux)
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

  // 3) Canvas ROI (zone centrale, meilleure lisibilité)
  try {
    const vw = videoEl.videoWidth  || videoEl.clientWidth || 640;
    const vh = videoEl.videoHeight || videoEl.clientHeight || 360;
    // ROI : 80% centré
    const rw = Math.floor(vw * 0.8);
    const rh = Math.floor(vh * 0.8);
    const rx = Math.floor((vw - rw) / 2);
    const ry = Math.floor((vh - rh) / 2);

    const targetW = 960; // bonne résolution d’analyse
    const targetH = Math.floor(targetW * (rh / rw));

    const cnv = ensureOffscreen(targetW, targetH);
    offCtx.drawImage(videoEl, rx, ry, rw, rh, 0, 0, targetW, targetH);

    // Optionnel: renforcer le contraste (light unsharp)
    try {
      const img = offCtx.getImageData(0,0,targetW,targetH);
      // simple contraste rapide
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

// -- Boucle de scan : retourne un code CONNU, sinon continue
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

  return new Promise((resolve)=>{
    let rafId = 0;
    let stop = false;

    const onFrame = async ()=>{
      if (stop) return;

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
            // Multi-frame confirmation
            if (raw === candidate) candidateCount++;
            else { candidate = raw; candidateCount = 1; }

            const inCooldown = (raw === lastAccepted) && ((now - lastAcceptedTs) < cooldownMs);

            if (!inCooldown && candidateCount >= confirmFrames) {
              // Connu ?
              let known = null;
              try { known = await dbGet(raw); } catch(_) { known = null; }

              if (known) {
                beep();
                lastAccepted = raw; lastAcceptedTs = now;
                stop = true;
                await stopScan();
                resolve(raw);
                return;
              } else {
                // inconnu → on notifie, on continue
                window.dispatchEvent(new CustomEvent('gstock:scan-unknown',{detail:{code: raw}}));
                candidate = ''; candidateCount = 0;
              }
            }
          }
        }
      }catch(_) {}

      // Choix du scheduler
      if ('requestVideoFrameCallback' in videoEl) {
        videoEl.requestVideoFrameCallback(()=>{ if (!stop) onFrame(); });
      } else {
        rafId = requestAnimationFrame(onFrame);
      }
    };

    // Démarre la boucle
    if ('requestVideoFrameCallback' in videoEl) {
      videoEl.requestVideoFrameCallback(()=>{ onFrame(); });
    } else {
      rafId = requestAnimationFrame(onFrame);
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
