// js/app.js — v1.3.1 avec Diagnostic + échantillons + Detector→ZXing
(function(){
  const errbar = document.getElementById('errbar');
  function showError(msg){ if (!errbar) return; errbar.textContent = msg; errbar.style.display = 'block'; }
  window.addEventListener('error', e=> showError('Erreur JS: ' + (e.message||e.error)));
  window.addEventListener('unhandledrejection', e=> showError('Promesse rejetée: ' + (e.reason && e.reason.message ? e.reason.message : e.reason)));

  // Onglets
  const tabs = Array.from(document.querySelectorAll('nav button'));
  const sections = {
    scan: document.getElementById('tab-scan'),
    items: document.getElementById('tab-items'),
    new: document.getElementById('tab-new'),
    labels: document.getElementById('tab-labels'),
    journal: document.getElementById('tab-journal'),
    settings: document.getElementById('tab-settings')
  };
  tabs.forEach(btn=>btn.addEventListener('click', ()=>showTab(btn.dataset.tab)));
  function showTab(name){
    tabs.forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
    Object.entries(sections).forEach(([k,el])=>el && el.classList.toggle('hide', k!==name));
    if (name==='items') refreshList();
    if (name==='labels') refreshLabelItems();
    if (name==='journal') refreshJournal();
  }

  // Badge réseau
  const badge = document.getElementById('badge');
  function updateBadge(){ if (badge) badge.textContent = navigator.onLine ? 'en ligne' : 'hors ligne'; }
  window.addEventListener('online', updateBadge);
  window.addEventListener('offline', updateBadge);
  updateBadge();

  // ====== Scanner ======
  const video = document.getElementById('video');
  const scanStatus = document.getElementById('scanStatus');
  const qtyInput = document.getElementById('qty');
  const modeInBtn = document.getElementById('modeIn');
  const modeOutBtn = document.getElementById('modeOut');
  const btnStartScan = document.getElementById('btnStartScan');
  const btnStopScan = document.getElementById('btnStopScan');
  const btnTorch = document.getElementById('btnTorch');
  const btnTestDetect = document.getElementById('btnTestDetect');
  const btnSelfTest = document.getElementById('btnSelfTest');
  const btnShowSamples = document.getElementById('btnShowSamples');
  const diag = document.getElementById('diag');
  const diagOut = document.getElementById('diagOut');
  const sampleArea = document.getElementById('sampleArea');

  let mode = 'out';
  if (modeOutBtn) modeOutBtn.classList.add('active');
  if (modeInBtn) modeInBtn.addEventListener('click', ()=>{ mode='in'; if (scanStatus) scanStatus.textContent='Mode: Entrée'; modeInBtn.classList.add('active'); modeOutBtn && modeOutBtn.classList.remove('active'); });
  if (modeOutBtn) modeOutBtn.addEventListener('click', ()=>{ mode='out'; if (scanStatus) scanStatus.textContent='Mode: Sortie'; modeOutBtn.classList.add('active'); modeInBtn && modeInBtn.classList.remove('active'); });

  const lastOp = document.getElementById('lastOp');
  let scanning = false;

  async function startScan(){
    try{
      scanning = true;
      await Barcode.startCamera(video);
      if (lastOp) lastOp.innerHTML = '🎥 Caméra active — pointez un code (EAN-13/Code128).';
      loopScan();
    }catch(e){
      showError('Caméra indisponible : ' + (e && e.message ? e.message : e));
    }
  }
  if (btnStartScan) btnStartScan.addEventListener('click', startScan);
  if (btnStopScan) btnStopScan.addEventListener('click', ()=>{
    scanning=false;
    try{ if (video && video.srcObject){ video.srcObject.getTracks().forEach(t=>t.stop()); video.pause(); video.srcObject=null; } }catch(e){}
    Barcode.stopCamera();
    if (lastOp) lastOp.innerHTML = '⏹️ Caméra arrêtée.';
  });
  if (btnTorch) btnTorch.addEventListener('click', async ()=>{
    const on = await Barcode.toggleTorch();
    if (lastOp) lastOp.innerHTML = on ? '💡 Lampe ON' : '💡 Lampe OFF';
  });
  if (btnTestDetect) btnTestDetect.addEventListener('click', async ()=>{
    const v = await Barcode.scanAny(video);
    if (lastOp) lastOp.innerHTML = v ? ('🔎 Détecté : <b>'+v+'</b>') : 'Aucune détection.';
  });

  async function loopScan(){
    while(scanning){
      await new Promise(r=>setTimeout(r, 650));
      try{
        if (!video || !video.srcObject) { scanning=false; break; }
        const val = await Barcode.scanAny(video); // Detector -> ZXing
        if (val){
          await processScan(val, 'scan');
          await new Promise(r=>setTimeout(r, 1200));
        }
      }catch(e){}
    }
  }

  async function processScan(code, source){
    const q = parseInt((qtyInput && qtyInput.value) ? qtyInput.value : '1',10);
    let item = await dbGet(code);
    if (!item){
      item = { barcode: code, name: 'Article ' + code, qty: 0, min: 0, tags: [], createdAt: Date.now(), updatedAt: Date.now() };
      await dbPut(item);
    }
    const delta = mode==='in' ? q : -q;
    item = await dbAdjustQty(code, delta, { mode, source: source||'scan' });
    const warn = item.qty <= (item.min||0);
    if (lastOp) lastOp.innerHTML = (mode==='in'?'✅ Entrée':'📤 Sortie') + ' <b>'+q+
      '</b> × <b>'+ (item.name||'') + '</b> (<code>'+ item.barcode +
      '</code>) — stock: <span class="'+(warn?'warntext':'oktext')+'">'+ item.qty +'</span>';
    refreshList(); refreshJournal();
  }

  // ====== Exemples à l’écran (EAN-13 + Code128)
  if (btnShowSamples) btnShowSamples.addEventListener('click', ()=>{
    const samples = [
      { name:'Exemple EAN-13', code:'5901234123457', type:'ean13' },
      { name:'Exemple Code128', code:'TEST-12345', type:'code128' }
    ];
    const cards = samples.map(s=>{
      const svg = (s.type==='ean13')
        ? Barcode.renderEAN13Svg(s.code, { moduleWidth: 3, height: 90, margin: 12, fontSize: 13 })
        : Barcode.renderCode128Svg(s.code, { moduleWidth: 3, height: 90, margin: 12, fontSize: 13 });
      return `<div class="card"><div><b>${s.name}</b> — <code>${s.code}</code></div>${svg}</div>`;
    }).join('');
    sampleArea.innerHTML = `<p class="muted">Place ces codes en plein écran et scanne-les avec la webcam.</p>${cards}`;
    sampleArea.classList.remove('hide');
    if (lastOp) lastOp.innerHTML = '🧪 Exemples affichés. Lance la caméra et clique “Tester une détection”.';
  });

  // ====== Diagnostic
  if (btnSelfTest) btnSelfTest.addEventListener('click', async ()=>{
    const lines = [];
    lines.push(`SecureContext: ${window.isSecureContext}`);
    lines.push(`getUserMedia: ${!!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)}`);
    lines.push(`BarcodeDetector in window: ${'BarcodeDetector' in window}`);
    lines.push(`ZXing chargé: ${typeof window.ZXing !== 'undefined'}`);
    try{
      const st = await navigator.mediaDevices.getUserMedia({ video:true, audio:false });
      const track = st.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      const settings = track.getSettings ? track.getSettings() : {};
      lines.push(`Caméra OK. Résolution: ${settings.width||'?'}x${settings.height||'?'}; facingMode: ${settings.facingMode||'?'}`);
      lines.push(`Torch: ${caps && 'torch' in caps ? 'oui' : 'non'}`);
      st.getTracks().forEach(t=>t.stop());
    }catch(e){
      lines.push(`Caméra test KO: ${e && e.message ? e.message : e}`);
    }
    diagOut.textContent = lines.join('\n');
    diag.classList.remove('hide');
  });

  // ====== Liste Articles ======
  const search = document.getElementById('search');
  const itemsList = document.getElementById('itemsList');
  if (search) search.addEventListener('input', ()=>refreshList());
  const addDummyBtn = document.getElementById('addDummy');
  if (addDummyBtn) addDummyBtn.addEventListener('click', async ()=>{ await dbEnsureDemo(); refreshList(); });

  async function refreshList(){
    const q = (search && search.value ? search.value : '').trim().toLowerCase();
    const items = await dbList(q);
    items.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
    if (!itemsList) return;
    itemsList.innerHTML = '';
    for (const it of items){
      const warn = (it.qty||0) <= (it.min||0);
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML = `
        <div>
          <div><b>${it.name||'(sans nom)'}</b> <span class="muted">— <code>${it.barcode}</code></span></div>
          <div class="muted">${(it.tags||[]).join(', ')}</div>
          <div>${warn?'<span class="warntext">⚠️ seuil atteint</span>':''}</div>
        </div>
        <div style="text-align:right">
          <div>Qté: <span class="qty">${it.qty||0}</span></div>
          <div class="row" style="margin-top:6px">
            <button class="btn secondary" data-act="minus">−</button>
            <button class="btn secondary" data-act="plus">+</button>
          </div>
          <div class="row" style="margin-top:6px">
            <button class="btn warn" data-act="del">Suppr.</button>
          </div>
        </div>`;
      div.querySelector('[data-act="minus"]').addEventListener('click', async ()=>{
        await dbAdjustQty(it.barcode, -1, {mode:'out', source:'ui'}); refreshList(); refreshJournal();
      });
      div.querySelector('[data-act="plus"]').addEventListener('click', async ()=>{
        await dbAdjustQty(it.barcode, +1, {mode:'in', source:'ui'}); refreshList(); refreshJournal();
      });
      div.querySelector('[data-act="del"]').addEventListener('click', async ()=>{
        if (confirm("Supprimer cet article ?")){ await dbDelete(it.barcode); refreshList(); }
      });
      itemsList.appendChild(div);
    }
  }

  // ====== Nouveau ======
  const newName = document.getElementById('newName');
  const newQty = document.getElementById('newQty');
  const newMin = document.getElementById('newMin');
  const newCode = document.getElementById('newCode');
  const newTags = document.getElementById('newTags');
  const createItemBtn = document.getElementById('createItem');
  if (createItemBtn) createItemBtn.addEventListener('click', async ()=>{
    const name = (newName && newName.value ? newName.value : '').trim();
    if (!name) return alert("Nom requis");
    const code = (newCode && newCode.value ? newCode.value.trim() : '') || genSku();
    const item = {
      barcode: code, name, qty: parseInt((newQty && newQty.value) ? newQty.value : '0',10),
      min: parseInt((newMin && newMin.value) ? newMin.value : '0',10),
      tags: (newTags && newTags.value ? newTags.value : '').split(',').map(s=>s.trim()).filter(Boolean),
      createdAt: Date.now(), updatedAt: Date.now()
    };
    await dbPut(item);
    if (item.qty) await dbAddMove({ time: Date.now(), barcode: item.barcode, name: item.name, delta: item.qty, qtyAfter: item.qty, mode:'init', source:'create' });
    if (newName) newName.value=''; if (newQty) newQty.value='0'; if (newMin) newMin.value='5'; if (newCode) newCode.value=''; if (newTags) newTags.value='';
    alert("Article créé"); showTab('items'); refreshList(); refreshJournal();
  });
  function genSku(){ const n = Math.floor(Math.random()*99999).toString().padStart(5,'0'); return "CFA-"+n; }

  // ====== Étiquettes ======
  const labelItem = document.getElementById('labelItem');
  const labelCount = document.getElementById('labelCount');
  const labelPreview = document.getElementById('labelPreview');
  const btnRenderLabel = document.getElementById('btnRenderLabel');
  const btnPrintLabels = document.getElementById('btnPrintLabels');

  async function refreshLabelItems(){
    const items = await dbList('');
    if (!labelItem) return;
    labelItem.innerHTML = items.map(i=>`<option value="${i.barcode}">${i.name} — ${i.barcode}</option>`).join('');
  }
  if (btnRenderLabel) btnRenderLabel.addEventListener('click', async ()=>{
    const code = labelItem && labelItem.value ? labelItem.value : '';
    const item = code ? await dbGet(code) : null;
    if (!item) return;
    const count = Math.max(1, parseInt((labelCount && labelCount.value) ? labelCount.value : '1',10));

    const isNumeric = /^[0-9]+$/.test(item.barcode);
    const isEANish = isNumeric && (item.barcode.length===12 || item.barcode.length===13);
    let svgOne;
    try{
      if (isEANish){ svgOne = Barcode.renderEAN13Svg(item.barcode, { moduleWidth: 3, height: 90, margin: 12, fontSize: 13 }); }
      else { svgOne = Barcode.renderCode128Svg(item.barcode, { moduleWidth: 3, height: 90, margin: 12, fontSize: 13 }); }
    }catch(e){
      svgOne = Barcode.renderCode128Svg(String(item.barcode), { moduleWidth: 3, height: 90, margin: 12, fontSize: 13 });
    }

    const labelHtml = (name, code)=>`<div class="lbl">${svgOne}<div class="ln">${escapeHtml(name)}</div></div>`;
    const grid = Array.from({length:count}).map(()=>labelHtml(item.name, item.barcode)).join('');
    if (labelPreview) {
      labelPreview.innerHTML = `<style>
        .sheet{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:12px}
        @media print{body{background:#fff} .sheet{gap:6px;padding:6px} nav,header,footer,#errbar{display:none !important} .card{border:none !important}}
        .lbl{border:1px dashed var(--bd);border-radius:8px;padding:6px;background:#fff;color:#000}
        .ln{font-size:12px;font-weight:700;margin-top:4px}
      </style><div class="sheet">` + grid + `</div>`;
    }
  });
  if (btnPrintLabels) btnPrintLabels.addEventListener('click', ()=>{
    if (!labelPreview || !labelPreview.innerHTML) return alert("Générez les étiquettes d'abord.");
    window.print();
  });

  // ====== Journal ======
  const journalTableBody = (document.getElementById('journalTable')||{}).querySelector ? document.getElementById('journalTable').querySelector('tbody') : null;
  const journalSearch = document.getElementById('journalSearch');
  const btnExportMovesCsv = document.getElementById('btnExportMovesCsv');
  const btnExportMovesJson = document.getElementById('btnExportMovesJson');
  const btnClearMoves = document.getElementById('btnClearMoves');
  const fileImportMovesCsv = document.getElementById('fileImportMovesCsv');
  const btnImportMovesCsv = document.getElementById('btnImportMovesCsv');

  if (journalSearch) journalSearch.addEventListener('input', refreshJournal);
  if (btnExportMovesCsv) btnExportMovesCsv.addEventListener('click', async ()=>{ const csv = await exportMovesCsv(); downloadText('journal.csv', csv); });
  if (btnExportMovesJson) btnExportMovesJson.addEventListener('click', async ()=>{ const json = await exportMovesJson(); downloadText('journal.json', json); });
  if (btnClearMoves) btnClearMoves.addEventListener('click', async ()=>{ if (confirm('Vider tout le journal ?')){ await dbClearMoves(); refreshJournal(); } });
  if (btnImportMovesCsv) btnImportMovesCsv.addEventListener('click', ()=> fileImportMovesCsv && fileImportMovesCsv.click());
  if (fileImportMovesCsv) fileImportMovesCsv.addEventListener('change', async (e)=>{
    const f = e.target.files[0]; if (!f) return;
    const text = await f.text(); await importMovesCsv(text); refreshJournal(); e.target.value='';
  });

  async function refreshJournal(){
    const q = (journalSearch && journalSearch.value ? journalSearch.value : '').trim().toLowerCase();
    const moves = await dbListMoves();
    if (!journalTableBody) return;
    journalTableBody.innerHTML = '';
    for (const m of moves){
      const s = (new Date(m.time).toLocaleString() + '\t' + m.barcode + '\t' + (m.name||'') + '\t' + m.delta + '\t' + m.qtyAfter + '\t' + m.mode + '\t' + m.source).toLowerCase();
      if (q && !s.includes(q)) continue;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="nowrap">${new Date(m.time).toLocaleString()}</td>
        <td class="nowrap"><code>${m.barcode}</code></td>
        <td>${escapeHtml(m.name||'')}</td>
        <td class="nowrap">${m.delta>0?'+':''}${m.delta}</td>
        <td class="nowrap">${m.qtyAfter}</td>
        <td>${m.mode}</td>
        <td>${m.source}</td>
      `;
      journalTableBody.appendChild(tr);
    }
  }

  // ====== Paramètres (import/export Articles) ======
  const btnExportItemsCsv = document.getElementById('btnExportItemsCsv');
  const btnExportItemsJson = document.getElementById('btnExportItemsJson');
  const btnImportItemsCsv = document.getElementById('btnImportItemsCsv');
  const fileImportItemsCsv = document.getElementById('fileImportItemsCsv');
  const btnImportJson = document.getElementById('btnImportJson');
  const fileImportJson = document.getElementById('fileImportJson');

  if (btnExportItemsCsv) btnExportItemsCsv.addEventListener('click', async ()=>{ const csv = await exportItemsCsv(); downloadText('articles.csv', csv); });
  if (btnExportItemsJson) btnExportItemsJson.addEventListener('click', async ()=>{ const json = await exportItemsJson(); downloadText('articles.json', json); });
  if (btnImportItemsCsv) btnImportItemsCsv.addEventListener('click', ()=> fileImportItemsCsv && fileImportItemsCsv.click());
  if (fileImportItemsCsv) fileImportItemsCsv.addEventListener('change', async (e)=>{
    const f = e.target.files[0]; if (!f) return;
    const text = await f.text(); await importItemsCsv(text); refreshList(); refreshLabelItems(); e.target.value='';
  });
  if (btnImportJson) btnImportJson.addEventListener('click', ()=> fileImportJson && fileImportJson.click());
  if (fileImportJson) fileImportJson.addEventListener('change', async (e)=>{
    const f = e.target.files[0]; if (!f) return;
    const text = await f.text(); await importItemsJson(text); refreshList(); refreshLabelItems(); e.target.value='';
  });

  // Helpers
  function downloadText(filename, text){
    const blob = new Blob([text], {type:'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
  }
  function escapeHtml(s){ return (s||'').replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

})();
