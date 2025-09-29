/* Gstock - barcode.js */
'use strict';

let mediaStream = null;
let detector = null;
let videoTrack = null;
let torchOn = false;

// Démarre la caméra avec des contraintes favorables au scan
async function startCamera(videoEl){
  await stopScan();
  const constraints = {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30, max: 60 },
      advanced: [{ focusMode: 'continuous' }]
    },
    audio: false
  };
  mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = mediaStream;
  await videoEl.play();
  videoTrack = mediaStream.getVideoTracks()[0] || null;

  // Essai d'activer l'autofocus / zoom si dispos
  try {
    const caps = videoTrack.getCapabilities?.() || {};
    const settings = videoTrack.getSettings?.() || {};
    const cons = {};
    if (caps.focusMode && caps.focusMode.includes('continuous')) cons.focusMode = 'continuous';
    if (caps.zoom && caps.zoom.max) cons.zoom = Math.min(caps.zoom.max, Math.max(caps.zoom.min||1, (settings.zoom||1) * 1.5));
    if (Object.keys(cons).length) await videoTrack.applyConstraints({ advanced: [cons] });
  } catch(e){ /* ignore */ }

  // Prépare BarcodeDetector
  if (!('BarcodeDetector' in window)) throw new Error('BarcodeDetector non disponible');
  detector = new window.BarcodeDetector({
    formats: ['qr_code','ean_13','ean_8','code_128','code_39','upc_a','upc_e','itf','codabar','data_matrix','pdf417']
  });
}

// Scan en boucle jusqu’à trouver un article CONNU (en base). Renvoie le code ou null si annulé.
async function scanUntilKnown(videoEl, {confirmFrames = 2, cooldownMs = 700} = {}){
  try{
    await startCamera(videoEl);
  }catch(e){
    alert('Impossible d’accéder à la caméra ou API non supportée.');
    return null;
  }

  return new Promise((resolve)=>{
    let rafId = 0;
    let lastAccepted = '';
    let lastAcceptedTs = 0;
    let candidate = '';
    let candidateCount = 0;

    const loop = async ()=>{
      if (!detector || !mediaStream) { cancelAnimationFrame(rafId); resolve(null); return; }

      try{
        // requestVideoFrameCallback serait idéal, fallback rAF
        const results = await detector.detect(videoEl);
        const now = Date.now();

        if (results && results[0]) {
          const raw = results[0].rawValue || '';
          if (raw) {
            // Multi-frame confirmation (réduit les faux positifs)
            if (raw === candidate) {
              candidateCount++;
            } else {
              candidate = raw;
              candidateCount = 1;
            }

            // Cooldown pour ne pas spammer
            const isCooldown = (raw === lastAccepted) && ((now - lastAcceptedTs) < cooldownMs);

            if (!isCooldown && candidateCount >= confirmFrames) {
              // Connait-on cet article ?
              let known = null;
              try { known = await dbGet(raw); } catch(_) { known = null; }

              if (known) {
                // Article connu → bip + fin de scan
                beep();
                lastAccepted = raw; lastAcceptedTs = now;
                await stopScan();
                resolve(raw);
                return;
              } else {
                // Inconnu → on continue à scanner, on notifie le hint
                window.dispatchEvent(new CustomEvent('gstock:scan-unknown',{detail:{code: raw}}));
                // reset candidature pour éviter de rester bloqué sur le même code
                candidate = ''; candidateCount = 0;
              }
            }
          }
        }
      }catch(e){ /* ignore erreurs de frame/détection */ }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
  });
}

async function stopScan(){
  try{
    if (mediaStream) {
      mediaStream.getTracks().forEach(t=>t.stop());
    }
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
  }catch(e){ /* ignore */ }
}

// Torch (lampe) si supporté
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
