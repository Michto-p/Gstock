// js/barcode.js — Detector + ZXing fallback + Code128/EAN13 (v1.3.0)
const Barcode = (()=> {
  // ===== Camera & Detector
  let _stream = null, _track = null, _detector = null, _canvas = null, _ctx = null, _zxingReader = null;
  const SUPPORTED_FORMATS = ['code_128','ean_13','ean_8','upc_a','upc_e','qr_code','code_39','itf','codabar'];

  async function ensureDetector(){
    if (!('BarcodeDetector' in window)) return null;
    if (!_detector){
      try { _detector = new BarcodeDetector({ formats: SUPPORTED_FORMATS }); }
      catch(e){ _detector = null; }
    }
    return _detector;
  }

  async function startCamera(video){
    stopCamera();
    _stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720} },
      audio:false
    });
    video.srcObject = _stream;
    await video.play();
    _track = _stream.getVideoTracks()[0];

    try{
      const caps = _track.getCapabilities ? _track.getCapabilities() : {};
      const cons = {};
      if (caps.focusMode && caps.focusMode.indexOf('continuous')>=0) cons.focusMode = 'continuous';
      if (caps.zoom) cons.zoom = Math.min(caps.zoom.max, Math.max(caps.zoom.min, (caps.zoom.min + caps.zoom.max)/3));
      if (Object.keys(cons).length) await _track.applyConstraints({ advanced:[cons] });
    }catch(e){}

    _canvas = document.createElement('canvas');
    _canvas.width = video.videoWidth || 800;
    _canvas.height = video.videoHeight || 600;
    _ctx = _canvas.getContext('2d');
    return _stream;
  }

  function stopCamera(){
    try{
      if (_track) _track.stop();
      if (_stream) _stream.getTracks().forEach(t=>t.stop());
    }catch(e){}
    _stream = null; _track = null;
    if (_zxingReader){ try{ _zxingReader.reset(); }catch(e){}; _zxingReader = null; }
  }

  async function toggleTorch(){
    if (!_track) return false;
    try{
      const caps = _track.getCapabilities ? _track.getCapabilities() : null;
      if (caps && 'torch' in caps){
        const settings = _track.getSettings ? _track.getSettings() : {};
        const newTorch = !settings.torch;
        await _track.applyConstraints({ advanced:[{ torch:newTorch }] });
        return newTorch;
      }
    }catch(e){}
    return false;
  }

  // --- Essai 1 : BarcodeDetector (rapide)
  async function scanWithDetector(video){
    const det = await ensureDetector();
    if (!det || !video || !video.srcObject) return null;
    try{
      if (!_canvas || !_ctx || _canvas.width !== (video.videoWidth||800)){
        _canvas = document.createElement('canvas');
        _canvas.width = video.videoWidth || 800; _canvas.height = video.videoHeight || 600; _ctx = _canvas.getContext('2d');
      }
      // downscale léger pour la stabilité
      const W = Math.min(_canvas.width, 960);
      const H = Math.round(W * (_canvas.height/_canvas.width));
      _ctx.drawImage(video, 0, 0, W, H);
      const bmp = await createImageBitmap(_canvas, { resizeWidth: W, resizeHeight: H });
      const res = await det.detect(bmp);
      if (res && res.length){
        let best = res[0];
        for (let i=1;i<res.length;i++){ if ((res[i].rawValue||'').length > (best.rawValue||'').length) best = res[i]; }
        return best.rawValue || null;
      }
    }catch(e){}
    return null;
  }

  // --- Essai 2 : ZXing (très robuste sur webcam)
  async function scanWithZXing(video){
    if (!window.ZXing || !video || !video.srcObject) return null;
    if (!_zxingReader){
      try{
        // Multi-format reader avec hints par défaut
        _zxingReader = new ZXing.BrowserMultiFormatReader();
      }catch(e){
        _zxingReader = null;
        return null;
      }
    }
    try{
      // Décode UNE fois sur l'image courante du <video> (ne prend pas le contrôle de la caméra)
      const result = await _zxingReader.decodeOnceFromVideoElement(video);
      _zxingReader.reset();
      return result && result.text ? result.text : null;
    }catch(e){
      try{ _zxingReader.reset(); }catch(_){}
      return null;
    }
  }

  // --- API simple : essaye Detector puis ZXing
  async function scanAny(video){
    // 1) Detector natif
    let v = await scanWithDetector(video);
    if (v) return v;
    // 2) ZXing fallback
    return await scanWithZXing(video);
  }

  // ===== Code128-B (étiquettes)
  const CODE128B_TABLE = (function(){
    return [
      [2,1,2,2,2,2],[2,2,2,1,2,2],[2,2,2,2,2,1],[1,2,1,2,2,3],[1,2,1,3,2,2],[1,3,1,2,2,2],[1,2,2,2,1,3],[1,2,2,3,1,2],[1,3,2,2,1,2],[2,2,1,2,1,3],
      [2,2,1,3,1,2],[2,3,1,2,1,2],[1,1,2,2,3,2],[1,2,2,1,3,2],[1,2,2,2,3,1],[1,1,3,2,2,2],[1,2,3,1,2,2],[1,2,3,2,2,1],[2,2,3,2,1,1],[2,2,1,1,3,2],
      [2,2,1,2,3,1],[2,1,3,2,1,2],[2,2,3,1,1,2],[3,1,2,1,3,1],[3,1,1,2,2,2],[3,2,1,1,2,2],[3,2,1,2,2,1],[3,1,2,2,1,2],[3,2,2,1,1,2],[3,2,2,2,1,1],
      [2,1,2,1,2,3],[2,1,2,3,2,1],[2,3,2,1,2,1],[1,1,1,3,2,3],[1,3,1,1,2,3],[1,3,1,3,2,1],[1,1,2,3,1,3],[1,3,2,1,1,3],[1,3,2,3,1,1],[2,1,1,3,1,3],
      [2,3,1,1,1,3],[2,3,1,3,1,1],[1,1,2,1,3,3],[1,1,2,3,3,1],[1,3,2,1,3,1],[1,1,3,1,2,3],[1,1,3,3,2,1],[1,3,3,1,2,1],[3,1,3,1,2,1],[2,1,1,3,3,1],
      [2,3,1,1,3,1],[2,1,3,1,1,3],[2,1,3,3,1,1],[2,1,3,1,3,1],[3,1,1,1,2,3],[3,1,1,3,2,1],[3,3,1,1,2,1],[3,1,2,1,1,3],[3,1,2,3,1,1],[3,3,2,1,1,1],
      [3,1,4,1,1,1],[2,2,1,4,1,1],[4,3,1,1,1,1],[1,1,1,2,2,4],[1,1,1,4,2,2],[1,2,1,1,2,4],[1,2,1,4,2,1],[1,4,1,1,2,2],[1,4,1,2,2,1],[1,1,2,2,1,4],
      [1,1,2,4,1,2],[1,2,2,1,1,4],[1,2,2,4,1,1],[1,4,2,1,1,2],[1,4,2,2,1,1],[2,4,1,2,1,1],[2,2,1,1,1,4],[4,1,3,1,1,1],[2,4,1,1,1,2],[1,3,4,1,1,1],
      [1,1,1,2,4,2],[1,2,1,1,4,2],[1,2,1,2,4,1],[1,1,4,2,1,2],[1,2,4,1,1,2],[1,2,4,2,1,1],[4,1,1,2,1,2],[4,2,1,1,1,2],[4,2,1,2,1,1],[2,1,2,1,4,1],
      [2,1,4,1,2,1],[4,1,2,1,2,1],[1,1,1,1,4,3],[1,1,1,3,4,1],[1,3,1,1,4,1],[1,1,4,1,1,3],[1,1,4,3,1,1],[4,1,1,1,1,3],[4,1,1,3,1,1],[1,1,3,1,4,1],
      [1,1,4,1,3,1],[3,1,1,1,4,1],[4,1,1,1,3,1],[2,1,1,4,1,2],[2,1,1,2,1,4],[2,1,1,2,3,2],[2,3,3,1,1,1,2]
    ];
  })();
  function code128Encode(value){
    const start = 104; const codes = [start];
    for (let i=0;i<value.length;i++){
      const ch = value.charCodeAt(i); if (ch < 32 || ch > 126) throw new Error('Code128-B: ASCII 32..126');
      codes.push(ch - 32);
    }
    let sum = start; for (let i=1;i<codes.length;i++) sum += codes[i]*i;
    codes.push(sum % 103); codes.push(106); return codes;
  }
  function codeToPattern(code){ if (code === 106) return [2,3,3,1,1,1,2]; return CODE128B_TABLE[code] || null; }
  function renderCode128Svg(value, opts){
    const o = opts || {}; const module = o.moduleWidth||3, height = o.height||90, margin = (o.margin==null?12:o.margin), fontSize = o.fontSize||13;
    const codes = code128Encode(value); let x = margin, rects = [];
    for (let i=0;i<codes.length;i++){ const patt = codeToPattern(codes[i]); for (let j=0;j<patt.length;j++){ const w=patt[j]*module; if (j%2===0) rects.push({x,y:margin,w,h:height}); x+=w; } }
    const total = x + margin, H = height + margin*2 + fontSize + 4;
    const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${H}" viewBox="0 0 ${total} ${H}">`,`<rect width="100%" height="100%" fill="#fff"/>`];
    for (const r of rects){ svg.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#000"/>`); }
    svg.push(`<text x="${total/2}" y="${height+margin*1.8}" text-anchor="middle" font-family="monospace" font-size="${fontSize}" fill="#000">${esc(value)}</text>`,`</svg>`);
    return svg.join('');
  }

  // ===== EAN-13 (étiquettes)
  const EAN_L = {'0':'0001101','1':'0011001','2':'0010011','3':'0111101','4':'0100011','5':'0110001','6':'0101111','7':'0111011','8':'0110111','9':'0001011'};
  const EAN_G = {'0':'0100111','1':'0110011','2':'0011011','3':'0100001','4':'0011101','5':'0111001','6':'0000101','7':'0010001','8':'0001001','9':'0010111'};
  const EAN_R = {'0':'1110010','1':'1100110','2':'1101100','3':'1000010','4':'1011100','5':'1001110','6':'1010000','7':'1000100','8':'1001000','9':'1110100'};
  const EAN_PARITY = {'0':'LLLLLL','1':'LLGLGG','2':'LLGGLG','3':'LLGGGL','4':'LGLLGG','5':'LGGLLG','6':'LGGGLL','7':'LGLGLG','8':'LGLGGL','9':'LGGLGL'};
  function eanChecksum12(s){ let sum=0; for (let i=0;i<12;i++){ const n=s.charCodeAt(i)-48; sum += (i%2===0)?n:n*3; } const m=sum%10; return m===0?0:10-m; }
  function renderEAN13Svg(value, opts){
    const o = opts||{}; const module = o.moduleWidth||3, height=o.height||90, margin=(o.margin==null?12:o.margin), fontSize=o.fontSize||13;
    let s = String(value).replace(/\D/g,''); if (s.length<12) s = s.padStart(12,'0'); if (s.length===12) s = s + eanChecksum12(s);
    if (s.length!==13) throw new Error('EAN-13: 12 ou 13 chiffres attendus');
    const first = s[0], left = s.slice(1,7), right = s.slice(7), parity = EAN_PARITY[first];
    let bits = '101';
    for (let i=0;i<6;i++){ const d=left[i], p=parity[i]; bits += (p==='L'?EAN_L[d]:EAN_G[d]); }
    bits += '01010';
    for (let j=0;j<6;j++){ bits += EAN_R[right[j]]; }
    bits += '101';

    let x = margin, rects = [], cur = bits[0], run = 1;
    for (let k=1;k<bits.length;k++){
      if (bits[k]===cur) run++;
      else { if (cur==='1') rects.push({x,y:margin,w:run*module,h:height}); x += run*module; cur=bits[k]; run=1; }
    }
    if (cur==='1') rects.push({x,y:margin,w:run*module,h:height}); else x += run*module;
    const total = x + margin, H = height + margin*2 + fontSize + 4;
    const human = s[0]+' '+s.slice(1,7)+' '+s.slice(7);

    const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${H}" viewBox="0 0 ${total} ${H}">`,`<rect width="100%" height="100%" fill="#fff"/>`];
    for (const r of rects){ svg.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#000"/>`); }
    svg.push(`<text x="${total/2}" y="${height+margin*1.8}" text-anchor="middle" font-family="monospace" font-size="${fontSize}" fill="#000">${human}</text>`,`</svg>`);
    return svg.join('');
  }

  function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  // API publique
  return {
    startCamera, stopCamera, toggleTorch,
    scanAny,                 // <-- à utiliser côté app
    renderCode128Svg, renderEAN13Svg
  };
})();
