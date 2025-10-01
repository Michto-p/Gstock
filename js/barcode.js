/* Gstock - barcode.js v2.1.7 */
'use strict';

let mediaStream=null, detector=null, videoTrack=null, torchOn=false;
let offCanvas=null, offCtx=null;
let DBG_UI={hud:null,roi:null,boundVideo:null};
let CURRENT_VIDEO_EL=null;

const PREFERRED_FORMATS=['qr_code','ean_13','ean_8','code_128','code_39','upc_a','upc_e','itf','codabar','data_matrix','pdf417'];
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function DBG(){return !!window.GSTOCK_DEBUG;}
function ensureOffscreen(w=1280,h=720){ if(!offCanvas){ offCanvas=document.createElement('canvas'); offCtx=offCanvas.getContext('2d',{willReadFrequently:true}); } offCanvas.width=w; offCanvas.height=h; return offCanvas; }

/* Debug overlay */
function ensureDebugUI(videoEl){ if(!DBG())return;
  if(!DBG_UI.hud){ const hud=document.createElement('div'); hud.style.cssText='position:fixed;left:8px;bottom:8px;z-index:99999;background:rgba(0,0,0,.65);color:#0ff;padding:6px 8px;font:12px ui-monospace,monospace;border-radius:8px;pointer-events:none;white-space:pre'; document.body.appendChild(hud); DBG_UI.hud=hud; }
  if(!DBG_UI.roi){ const roi=document.createElement('div'); roi.style.cssText='position:fixed;z-index:99998;border:2px dashed #0ff;border-radius:6px;pointer-events:none;box-shadow:0 0 0 9999px rgba(0,0,0,.15) inset'; document.body.appendChild(roi); DBG_UI.roi=roi; }
  DBG_UI.boundVideo=videoEl; updateROI(); window.addEventListener('resize',updateROI); window.addEventListener('scroll',updateROI,{passive:true});
}
function teardownDebugUI(){ if(DBG_UI.hud){DBG_UI.hud.remove();DBG_UI.hud=null;} if(DBG_UI.roi){DBG_UI.roi.remove();DBG_UI.roi=null;} DBG_UI.boundVideo=null; window.removeEventListener('resize',updateROI); window.removeEventListener('scroll',updateROI); }
function updateROI(){ if(!DBG()||!DBG_UI.boundVideo||!DBG_UI.roi)return; const v=DBG_UI.boundVideo; const r=v.getBoundingClientRect(); if(!r.width||!r.height)return; const rx=r.left+r.width*.1, ry=r.top+r.height*.1, rw=r.width*.8, rh=r.height*.8; const roi=DBG_UI.roi; roi.style.left=`${Math.max(0,rx)}px`; roi.style.top=`${Math.max(0,ry)}px`; roi.style.width=`${Math.max(0,rw)}px`; roi.style.height=`${Math.max(0,rh)}px`; }
function updateHUD({fps,candidate,count,lastKnown,formats}){ if(!DBG()||!DBG_UI.hud)return; const lines=[`FPS: ${fps.toFixed(1)}`,`Candidate: ${candidate||'-'} (${count||0})`,`Last known: ${lastKnown||'-'}`,`Formats: ${formats?.join(', ')||'-'}`]; DBG_UI.hud.textContent=lines.join('\n'); }

/* Formats supportés */
async function getSupportedFormats(){ try{ if(window.BarcodeDetector&&BarcodeDetector.getSupportedFormats){ return await BarcodeDetector.getSupportedFormats(); } }catch(_){} return PREFERRED_FORMATS; }
async function pickRearCameraDeviceId(){ try{ const devices=await navigator.mediaDevices.enumerateDevices(); const videos=devices.filter(d=>d.kind==='videoinput'); const back=videos.find(d=>/back|rear|environment/i.test(d.label))||videos[videos.length-1]; return back&&back.deviceId; }catch(_){return null;} }

/* Démarrage caméra */
async function startCamera(videoEl){
  await stopScan();
  videoEl.setAttribute('playsinline',''); videoEl.setAttribute('autoplay',''); videoEl.muted=true;

  const tryConstraints=async(cons)=>{ const s=await navigator.mediaDevices.getUserMedia(cons); videoEl.srcObject=s; await videoEl.play(); return s; };

  try{
    mediaStream=await tryConstraints({ video:{ facingMode:{ideal:'environment'}, width:{ideal:1920}, height:{ideal:1080}, focusMode:'continuous' }, audio:false });
  }catch(e1){
    const id=await pickRearCameraDeviceId();
    if(id){ try{ mediaStream=await tryConstraints({ video:{ deviceId:{exact:id}, width:{ideal:1920}, height:{ideal:1080} }, audio:false }); }catch(e2){} }
    if(!mediaStream){ mediaStream=await tryConstraints({ video:{ width:{ideal:1280}, height:{ideal:720} }, audio:false }); }
  }

  videoTrack=mediaStream.getVideoTracks()[0]||null; CURRENT_VIDEO_EL=videoEl;

  try{ const caps=videoTrack?.getCapabilities?.()||{}; const settings=videoTrack?.getSettings?.()||{}; const adv={};
    if(caps.focusMode&&caps.focusMode.includes('continuous'))adv.focusMode='continuous';
    if(caps.zoom&&caps.zoom.max){ const cur=settings.zoom||1; adv.zoom=Math.min(caps.zoom.max, Math.max(caps.zoom.min||1, cur*1.5)); }
    if(Object.keys(adv).length)await videoTrack.applyConstraints({advanced:[adv]});
  }catch(_){}

  if(!('BarcodeDetector' in window)) throw new Error('BarcodeDetector non disponible');
  const supported=await getSupportedFormats();
  detector=new window.BarcodeDetector({formats:supported.length?supported:PREFERRED_FORMATS});

  await sleep(150);
  if(DBG())ensureDebugUI(videoEl); else teardownDebugUI();
  setTimeout(updateROI,100);
}

/* Détection multi-voies */
async function detectAny(videoEl){
  if(!detector) return [];
  try{ const r=await detector.detect(videoEl); if(r&&r.length)return r; }catch(_){}
  if('createImageBitmap' in window){ try{ const bmp=await createImageBitmap(videoEl); try{ const r=await detector.detect(bmp); bmp.close?.(); if(r&&r.length)return r; }catch(_){ bmp.close?.(); } }catch(_){ } }
  try{
    const vw=videoEl.videoWidth||videoEl.clientWidth||640, vh=videoEl.videoHeight||videoEl.clientHeight||360;
    const rw=Math.floor(vw*.9), rh=Math.floor(vh*.9), rx=Math.floor((vw-rw)/2), ry=Math.floor((vh-rh)/2);
    const targetW=1280, targetH=Math.floor(targetW*(rh/rw)); const cnv=ensureOffscreen(targetW,targetH);
    offCtx.drawImage(videoEl,rx,ry,rw,rh,0,0,targetW,targetH);
    const r=await detector.detect(cnv); if(r&&r.length)return r;
  }catch(_){}
  return [];
}

/* Scan jusqu'à code CONNU */
async function scanUntilKnown(videoEl,{confirmFrames=2,cooldownMs=700,maxMs=60000}={}){
  try{ await startCamera(videoEl); }catch(e){ alert('Impossible d’accéder à la caméra ou API non supportée.'); return null; }

  const t0=Date.now(); let lastAccepted='', lastAcceptedTs=0, candidate='', candidateCount=0;
  let frames=0, lastFPSts=performance.now(), fps=0, lastKnown='', formats=null;
  try{ formats=await getSupportedFormats(); }catch(_){}

  async function lookup(code){
    return (await dbGet(code)) || (await dbGet(code.toUpperCase())) || (await dbGet(code.toLowerCase()));
  }

  return new Promise(resolve=>{
    let stopped=false;
    const loop=async()=>{
      if(stopped) return;
      if((Date.now()-t0)>maxMs){ await stopScan(); resolve(null); return; }

      try{
        const results=await detectAny(videoEl); const now=Date.now();
        if(results&&results[0]){ const raw=results[0].rawValue||''; if(raw){
          if(raw===candidate)candidateCount++; else{candidate=raw; candidateCount=1;}
          const inCooldown=(raw===lastAccepted)&&((now-lastAcceptedTs)<cooldownMs);
          if(!inCooldown && candidateCount>=confirmFrames){
            const known=await lookup(raw);
            if(known){ beep(); lastAccepted=raw; lastAcceptedTs=now; lastKnown=raw; stopped=true; await stopScan(); updateHUD({fps,candidate,count:candidateCount,lastKnown,formats}); resolve(raw); return; }
            else{ window.dispatchEvent(new CustomEvent('gstock:scan-unknown',{detail:{code:raw}})); candidate=''; candidateCount=0; }
          }
        }}
      }catch(_){}

      frames++; const nowTs=performance.now();
      if(nowTs-lastFPSts>=1000){ fps=(frames*1000)/(nowTs-lastFPSts); frames=0; lastFPSts=nowTs; }
      if(DBG()){ updateROI(); updateHUD({fps,candidate,count:candidateCount,lastKnown,formats}); }

      if('requestVideoFrameCallback' in videoEl){ videoEl.requestVideoFrameCallback(()=>{ if(!stopped)loop(); }); }
      else{ requestAnimationFrame(loop); }
    };
    if('requestVideoFrameCallback' in videoEl){ videoEl.requestVideoFrameCallback(()=>loop()); }
    else{ requestAnimationFrame(loop); }
  });
}

/* Stop / bip / lampe */
async function stopScan(){ try{ if(mediaStream)mediaStream.getTracks().forEach(t=>t.stop()); }finally{ mediaStream=null; detector=null; videoTrack=null; torchOn=false; teardownDebugUI(); } }
function beep(){ try{ const ctx=new (window.AudioContext||window.webkitAudioContext)(); const o=ctx.createOscillator(), g=ctx.createGain(); o.type='square'; o.frequency.value=880; o.connect(g); g.connect(ctx.destination); g.gain.value=0.05; o.start(); setTimeout(()=>{o.stop();ctx.close();},120); }catch(_){} }
async function toggleTorch(){ if(!videoTrack)return alert('Lampe non disponible'); try{ const caps=videoTrack.getCapabilities?.(); if(!caps||!caps.torch)return alert('Lampe non supportée'); torchOn=!torchOn; await videoTrack.applyConstraints({advanced:[{torch:torchOn}]}); }catch(e){ console.warn(e); alert('Impossible d’activer la lampe.'); }}

window.addEventListener('gstock:debug-changed',ev=>{ const enabled=!!(ev.detail&&ev.detail.enabled); if(enabled){ if(CURRENT_VIDEO_EL)ensureDebugUI(CURRENT_VIDEO_EL); } else { teardownDebugUI(); }});

window.scanUntilKnown=scanUntilKnown; window.stopScan=stopScan; window.toggleTorch=toggleTorch;
