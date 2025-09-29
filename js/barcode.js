/* Gstock - barcode.js (scanOnce) */
'use strict';

let mediaStream=null, detector=null;

async function scanOnce(videoEl){
  // Démarre la caméra + détecteur, renvoie une Promise résolue avec le code ou null si annulé
  await stopScan();
  try{
    mediaStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    videoEl.srcObject = mediaStream; await videoEl.play();
  }catch(e){
    alert('Impossible d’accéder à la caméra.');
    return null;
  }

  if (!('BarcodeDetector' in window)){
    alert('BarcodeDetector non disponible : utilisez la saisie manuelle.');
    await stopScan(); return null;
  }

  detector = new window.BarcodeDetector({
    formats: ['qr_code','ean_13','ean_8','code_128','code_39','upc_a','upc_e','itf','codabar']
  });

  return new Promise((resolve)=>{
    let rafId=0, lastCode='', lastTs=0, cooldown=900;

    const loop = async ()=>{
      if (!detector || !mediaStream) { cancelAnimationFrame(rafId); resolve(null); return; }
      try{
        const res = await detector.detect(videoEl);
        const now = Date.now();
        if (res && res[0]) {
          const code = res[0].rawValue || '';
          if (code && (code!==lastCode || (now-lastTs)>cooldown)){
            lastCode = code; lastTs = now; beep();
            await stopScan(); // coupe la caméra immédiatement
            resolve(code);
            return;
          }
        }
      }catch(e){ /* ignore */ }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  });
}

async function stopScan(){
  if (mediaStream) { mediaStream.getTracks().forEach(t=>t.stop()); mediaStream=null; }
  detector = null;
}

function beep(){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type='square'; o.frequency.value=880; o.connect(g); g.connect(ctx.destination);
    g.gain.value=0.05; o.start(); setTimeout(()=>{o.stop();ctx.close();},120);
  }catch(e){ /* ignore */ }
}

// Expose
window.scanOnce = scanOnce;
window.stopScan = stopScan;
