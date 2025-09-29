/* Gstock - barcode.js */
'use strict';

let mediaStream=null, det=null, lastCode=null, lastTs=0;
const cooldownMs = 1200;

async function startScan(videoEl){
  stopScan();
  try{
    mediaStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    videoEl.srcObject = mediaStream; await videoEl.play();
    if ('BarcodeDetector' in window) {
      const formats = ['qr_code','ean_13','ean_8','code_128','code_39','upc_a','upc_e','itf','codabar'];
      det = new window.BarcodeDetector({formats});
      loopDetect(videoEl);
    } else {
      alert('BarcodeDetector non disponible : utilisez la saisie manuelle du code.');
    }
  }catch(e){ console.warn(e); alert('Impossible d’accéder à la caméra.'); }
}

function stopScan(){
  if (mediaStream) { mediaStream.getTracks().forEach(t=>t.stop()); mediaStream=null; }
  det = null;
}

async function loopDetect(videoEl){
  if (!det || !mediaStream) return;
  try{
    const res = await det.detect(videoEl);
    const now = Date.now();
    if (res && res[0]) {
      const code = res[0].rawValue || res[0].rawValue || '';
      if (code && (code!==lastCode || (now-lastTs)>cooldownMs)){
        lastCode = code; lastTs = now; beep();
        window.dispatchEvent(new CustomEvent('gstock:barcode',{detail:{code}}));
      }
    }
  }catch(e){ /* ignore */ }
  requestAnimationFrame(()=>loopDetect(videoEl));
}

function beep(){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type='square'; o.frequency.value=880; o.connect(g); g.connect(ctx.destination);
    g.gain.value=0.05; o.start(); setTimeout(()=>{o.stop();ctx.close();},120);
  }catch(e){ /* ignore */ }
}

// Expose pour app.js
window.startScan = startScan;
window.stopScan = stopScan;
