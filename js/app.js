// js/app.js — v1.7.1 : réassort + indicateur + réintégration "Matériel" (refreshLoansTable)
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
    gear: document.getElementById('tab-gear'),
    new: document.getElementById('tab-new'),
    labels: document.getElementById('tab-labels'),
    journal: document.getElementById('tab-journal'),
    settings: document.getElementById('tab-settings')
  };
  tabs.forEach(btn=>btn.addEventListener('click', ()=>showTab(btn.dataset.tab)));
  function showTab(name){
    tabs.forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
    Object.entries(sections).forEach(([k,el])=>el && el.classList.toggle('hide', k!==name));
    if (name==='items'){ refreshTable(); }
    if (name==='labels'){ refreshLabelItems(); }
    if (name==='journal'){ refreshJournal(); }
    if (name==='gear'){ refreshLoansTable(); }
    if (name==='settings'){ initSettingsPanel(); }
  }

  // Badge réseau
  const badge = document.getElementById('badge');
  function updateBadge(){ if (badge) badge.textContent = navigator.onLine ? 'en ligne' : 'hors ligne'; }
  window.addEventListener('online', updateBadge);
  window.addEventListener('offline', updateBadge);
  updateBadge();

  // ========== SCANNER STOCK ==========
  const video = document.getElementById('video');
  const scanStatus = document.getElementById('scanStatus');
  const qtyInput = document.getElementById('qty');
  const modeInBtn = document.getElementById('modeIn');
  const modeOutBtn = document.getElementById('modeOut');
  const btnStartScan = document.getElementById('btnStartScan');
  const btnStopScan = document.getElementById('btnStopScan');
  const btnTorch = document.getElementById('btnTorch');
  const btnTestDetect = document.getElementById('btnTestDetect');
  const lastOp = document.getElementById('lastOp');

  let mode = 'out'; if (modeOutBtn) modeOutBtn.classList.add('active');
  if (modeInBtn) modeInBtn.addEventListener('click', ()=>{ mode='in'; if (scanStatus) scanStatus.textContent='Mode: Entrée'; modeInBtn.classList.add('active'); modeOutBtn && modeOutBtn.classList.remove('active'); });
  if (modeOutBtn) modeOutBtn.addEventListener('click', ()=>{ mode='out'; if (scanStatus) scanStatus.textContent='Mode: Sortie'; modeOutBtn.classList.add('active'); modeInBtn && modeInBtn.classList.remove('active'); });

  let scanning = false, lastDetected = '', lastBeepAt = 0;
  function tone(freq, vol, dur){ try{ const ctx=new (window.AudioContext||window.webkitAudioContext)(); const o=ctx.createOscillator(), g=ctx.createGain(); o.type='sine'; o.frequency.value=freq; g.gain.value=vol; o.connect(g); g.connect(ctx.destination); o.start(); setTimeout(()=>{o.stop();ctx.close();},dur||120);}catch(e){} }
  const beepOK = ()=>tone(880,0.06,120);
  const beepErr = ()=>tone(240,0.07,220);

  async function startScan(){
    try{
      scanning = true;
      await Barcode.startCamera(video);
      if (lastOp) lastOp.innerHTML = '🎥 Caméra active — pointez un code.';
      loopScan();
    }catch(e){ showError('Caméra indisponible : ' + (e && e.message ? e.message : e)); }
  }
  if (btnStartScan) btnStartScan.addEventListener('click', startScan);
  if (btnStopScan) btnStopScan.addEventListener('click', stopVideo);
  function stopVideo(){
    scanning=false;
    try{ if (video && video.srcObject){ video.srcObject.getTracks().forEach(t=>t.stop()); video.pause(); video.srcObject=null; } }catch(e){}
    Barcode.stopCamera();
    if (lastOp) lastOp.innerHTML = '⏹️ Caméra arrêtée.';
  }
  if (btnTorch) btnTorch.addEventListener('click', async ()=>{ const on = await Barcode.toggleTorch(); if (lastOp) lastOp.innerHTML = on ? '💡 Lampe ON' : '💡 Lampe OFF'; });
  if (btnTestDetect) btnTestDetect.addEventListener('click', async ()=>{ const v = await Barcode.scanOnce(video); if (v){ if (v!==lastDetected){ lastDetected=v; beepOK(); } if (lastOp) lastOp.innerHTML = '🔎 Détecté : <b>'+v+'</b>'; } else if (lastOp) lastOp.innerHTML='Aucune détection.'; });

  async function loopScan(){
    while(scanning){
      await delay(650);
      try{
        if (!video || !video.srcObject) { scanning=false; break; }
        const val = await Barcode.scanOnce(video);
        if (val){
          const now = Date.now();
          if (val !== lastDetected || now - lastBeepAt > 1500){ beepOK(); lastBeepAt = now; }
          lastDetected = val;
          await processScan(val, 'scan');
          await delay(1000);
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
      scheduleFileSave();
    }
    const delta = mode==='in' ? q : -q;
    item = await dbAdjustQty(code, delta, { mode, source: source||'scan' });
    scheduleFileSave();
    const warn = getStatus(item).level!=='ok';
    if (lastOp) lastOp.innerHTML = (mode==='in'?'✅ Entrée':'📤 Sortie') + ' <b>'+q+
      '</b> × <b>'+ (item.name||'') + '</b> (<code>'+ item.barcode +
      '</code>) — stock: <span class="'+(warn?'warntext':'oktext')+'">'+ item.qty +'</span>';
    refreshTable(); refreshJournal();
  }

  // ========== TABLEAU ARTICLES : filtre/tri TAGS + code couleur + réassort ==========
  const search = document.getElementById('search');
  const itemsTable = document.getElementById('itemsTable');
  const itemsTbody = itemsTable ? itemsTable.querySelector('tbody') : null;
  const chkShowBarcodes = document.getElementById('chkShowBarcodes');
  const addDummyBtn = document.getElementById('addDummy');
  const presetFilter = document.getElementById('presetFilter');
  const presetSort = document.getElementById('presetSort');
  const stockBadges = document.getElementById('stockBadges');
  const btnExportReassort = document.getElementById('btnExportReassort');

  let TAG_PRESETS = loadPresets();        // Array<string>
  let WARN_BUFFER = loadWarnBuffer();     // number

  function populatePresetFilter(){
    if (!presetFilter) return;
    const cur = presetFilter.value || '';
    presetFilter.innerHTML = '<option value="">(Tous)</option>' + TAG_PRESETS.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');
    presetFilter.value = cur || '';
  }
  populatePresetFilter();

  if (chkShowBarcodes){
    chkShowBarcodes.checked = localStorage.getItem('showBarcodesInList') === '1';
    chkShowBarcodes.addEventListener('change', ()=>{
      localStorage.setItem('showBarcodesInList', chkShowBarcodes.checked ? '1' : '0');
      refreshTable();
    });
  }
  if (search) search.addEventListener('input', refreshTable);
  if (presetFilter) presetFilter.addEventListener('change', refreshTable);
  if (presetSort) presetSort.addEventListener('change', refreshTable);
  if (addDummyBtn) addDummyBtn.addEventListener('click', async ()=>{ await dbEnsureDemo(); scheduleFileSave(); refreshTable(); });

  if (btnExportReassort) btnExportReassort.addEventListener('click', exportReassortCsv);

  let sortKey = 'name', sortAsc = true;
  if (itemsTable){
    itemsTable.querySelectorAll('th[data-sort]').forEach(th=>{
      th.addEventListener('click', ()=>{
        const k = th.getAttribute('data-sort');
        if (sortKey===k) sortAsc = !sortAsc; else { sortKey=k; sortAsc = true; }
        refreshTable();
      });
    });
  }

  function getStatus(it){
    const qty = it.qty||0, min = it.min||0;
    if (qty <= min) return { level:'alert', order:0 };
    if (qty <= min + WARN_BUFFER) return { level:'warn', order:1 };
    return { level:'ok', order:2 };
  }

  async function refreshTable(){
    const q = (search && search.value ? search.value : '').trim().toLowerCase();
    const tagFilter = (presetFilter && presetFilter.value) ? presetFilter.value : '';
    let items = await dbList('');
    if (q){
      items = items.filter(it=>{
        const s = ((it.name||'')+' '+(it.barcode||'')+' '+(it.tags||[]).join(' ')+' '+(it.location||'')).toLowerCase();
        return s.includes(q);
      });
    }
    if (tagFilter){
      items = items.filter(it => (it.tags||[]).map(t=>String(t).toLowerCase()).includes(tagFilter.toLowerCase()));
    }

    // tri (sélecteur)
    if (presetSort && presetSort.value){
      const v = presetSort.value;
      if (v==='qtyAsc') items.sort((a,b)=>(a.qty||0)-(b.qty||0));
      else if (v==='qtyDesc') items.sort((a,b)=>(b.qty||0)-(a.qty||0));
      else if (v==='status') items.sort((a,b)=> getStatus(a).order - getStatus(b).order || (a.qty||0)-(b.qty||0));
      else if (v==='tag') items.sort((a,b)=> (String((a.tags||[])[0]||'').localeCompare(String((b.tags||[])[0]||'')) || String(a.name||'').localeCompare(String(b.name||''))));
      else items.sort((a,b)=> String(a.name||'').localeCompare(String(b.name||'')));
    } else {
      // tri legacy via header
      items.sort((a,b)=>{
        const va = (a[sortKey] ?? '').toString().toLowerCase();
        const vb = (b[sortKey] ?? '').toString().toLowerCase();
        if (sortKey==='qty' || sortKey==='min') return (sortAsc?1:-1) * ((a[sortKey]||0) - (b[sortKey]||0));
        return (sortAsc?1:-1) * va.localeCompare(vb);
      });
    }

    if (!itemsTbody) return;
    itemsTbody.innerHTML = '';
    const showCodes = !!(chkShowBarcodes && chkShowBarcodes.checked);

    let cntAlert=0, cntWarn=0;
    for (const it of items){
      const st = getStatus(it);
      if (st.level==='alert') cntAlert++; else if (st.level==='warn') cntWarn++;

      const tr = document.createElement('tr');
      tr.classList.add(st.level==='ok'?'lvl-ok':st.level==='warn'?'lvl-warn':'lvl-alert');

      let svgHtml = '';
      if (showCodes){
        const isNum = /^[0-9]+$/.test(it.barcode||'');
        const isEANish = isNum && ((it.barcode||'').length===12 || (it.barcode||'').length===13);
        try{
          svgHtml = isEANish
            ? Barcode.renderEAN13Svg(it.barcode, { moduleWidth: 2.5, height: 70, margin: 8, fontSize: 11 })
            : Barcode.renderCode128Svg(it.barcode, { moduleWidth: 2.5, height: 70, margin: 8, fontSize: 11 });
        }catch(e){ svgHtml = ''; }
      }

      tr.innerHTML = `
        <td><b>${esc(it.name||'(sans nom)')}</b></td>
        <td class="nowrap"><code>${esc(it.barcode||'')}</code></td>
        <td class="nowrap">${it.qty||0}${st.level!=='ok'? ' <span class="'+(st.level==='alert'?'overdue':'dueSoon')+'">'+(st.level==='alert'?'Sous seuil':'Approche')+'</span>':''}</td>
        <td class="nowrap">${it.min||0}</td>
        <td><div class="tags">${(it.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join(' ')}</div></td>
        <td>${svgHtml || '<span class="muted">—</span>'}</td>
        <td class="nowrap">
          <button class="btn secondary" data-act="minus">−</button>
          <button class="btn secondary" data-act="plus">+</button>
          <button class="btn warn" data-act="del">Suppr.</button>
        </td>
      `;
      tr.querySelector('[data-act="minus"]').addEventListener('click', async ()=>{
        await dbAdjustQty(it.barcode, -1, {mode:'out', source:'ui'}); scheduleFileSave(); refreshTable(); refreshJournal();
      });
      tr.querySelector('[data-act="plus"]').addEventListener('click', async ()=>{
        await dbAdjustQty(it.barcode, +1, {mode:'in', source:'ui'}); scheduleFileSave(); refreshTable(); refreshJournal();
      });
      tr.querySelector('[data-act="del"]').addEventListener('click', async ()=>{
        if (confirm("Supprimer cet article ?")){ await dbDelete(it.barcode); scheduleFileSave(); refreshTable(); }
      });

      itemsTbody.appendChild(tr);
    }
    // indicateur haut de page
    if (stockBadges){
      const parts = [];
      if (cntAlert>0) parts.push(`🔴 <b>${cntAlert}</b> sous seuil`);
      if (cntWarn>0) parts.push(`🟠 <b>${cntWarn}</b> en approche`);
      stockBadges.innerHTML = parts.length? parts.join(' · ') : 'OK';
    }
  }

  // ▶ Export réassort CSV (articles avec qty ≤ min + buffer)
  async function exportReassortCsv(){
    const items = await dbList('');
    const rows = [['barcode','name','qty','min','buffer','status','tags'].join(';')];
    for (const it of items){
      const st = getStatus(it);
      if (st.level==='ok') continue;
      rows.push([
        it.barcode, (it.name||'').replace(/;/g,','), it.qty||0, it.min||0, WARN_BUFFER,
        (st.level==='alert'?'UNDER':'NEAR'),
        (it.tags||[]).join(',').replace(/;/g, ',')
      ].join(';'));
    }
    downloadText('reassort.csv', rows.join('\n'));
  }

  // ========== NOUVEAU ==========
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
    const tags = (newTags && newTags.value ? newTags.value : '').split(',').map(s=>s.trim()).filter(Boolean);
    const item = {
      barcode: code, name, qty: parseInt((newQty && newQty.value) ? newQty.value : '0',10),
      min: parseInt((newMin && newMin.value) ? newMin.value : '0',10),
      tags,
      createdAt: Date.now(), updatedAt: Date.now()
    };
    await dbPut(item);
    if (item.qty) await dbAddMove({ time: Date.now(), barcode: item.barcode, name: item.name, delta: item.qty, qtyAfter: item.qty, mode:'init', source:'create' });
    scheduleFileSave();
    if (newName) newName.value=''; if (newQty) newQty.value='0'; if (newMin) newMin.value='5'; if (newCode) newCode.value=''; if (newTags) newTags.value='';
    alert("Article créé"); showTab('items'); refreshTable(); refreshJournal();
  });
  function genSku(){ const n = Math.floor(Math.random()*99999).toString().padStart(5,'0'); return "CFA-"+n; }

  // ========== ÉTIQUETTES ==========
  const labelItem = document.getElementById('labelItem');
  const labelCount = document.getElementById('labelCount');
  const labelPreview = document.getElementById('labelPreview');
  const btnRenderLabel = document.getElementById('btnRenderLabel');
  const btnRenderAllLabels = document.getElementById('btnRenderAllLabels');
  const btnPrintLabels = document.getElementById('btnPrintLabels');
  async function refreshLabelItems(){
    const items = await dbList('');
    if (!labelItem) return;
    labelItem.innerHTML = items.map(i=>`<option value="${i.barcode}">${esc(i.name)} — ${esc(i.barcode)}</option>`).join('');
  }
  function labelCard(name, code){
    const isNumeric = /^[0-9]+$/.test(code);
    const isEANish = isNumeric && (code.length===12 || code.length===13);
    let svgOne;
    try{
      svgOne = isEANish
        ? Barcode.renderEAN13Svg(code, { moduleWidth: 3, height: 90, margin: 12, fontSize: 13 })
        : Barcode.renderCode128Svg(code, { moduleWidth: 3, height: 90, margin: 12, fontSize: 13 });
    }catch(e){
      svgOne = Barcode.renderCode128Svg(String(code), { moduleWidth: 3, height: 90, margin: 12, fontSize: 13 });
    }
    return `<div class="lbl">${svgOne}<div class="ln" style="font-weight:700;margin-top:4px">${esc(name)}</div></div>`;
  }
  function renderSheet(html){
    if (labelPreview) {
      labelPreview.innerHTML = `<style>
        .sheet{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:12px}
        @media print{body{background:#fff} .sheet{gap:6px;padding:6px} nav,header,footer,#errbar{display:none !important} .card{border:none !important}}
        .lbl{border:1px dashed var(--bd);border-radius:8px;padding:6px;background:#fff;color:#000}
        .ln{font-size:12px}
      </style><div class="sheet">` + html + `</div>`;
    }
  }
  if (btnRenderLabel) btnRenderLabel.addEventListener('click', async ()=>{
    const code = labelItem && labelItem.value ? labelItem.value : '';
    const item = code ? await dbGet(code) : null;
    if (!item) return;
    const count = Math.max(1, parseInt((labelCount && labelCount.value) ? labelCount.value : '1',10));
    const grid = Array.from({length:count}).map(()=>labelCard(item.name, item.barcode)).join('');
    renderSheet(grid);
  });
  if (btnRenderAllLabels) btnRenderAllLabels.addEventListener('click', async ()=>{
    const items = await dbList('');
    const grid = items.map(it=>labelCard(it.name, it.barcode)).join('');
    renderSheet(grid);
  });
  if (btnPrintLabels) btnPrintLabels.addEventListener('click', ()=>{
    if (!labelPreview || !labelPreview.innerHTML) return alert("Générez les étiquettes d'abord.");
    window.print();
  });

  // ========== JOURNAL ==========
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
  if (btnClearMoves) btnClearMoves.addEventListener('click', async ()=>{ if (confirm('Vider tout le journal ?')){ await dbClearMoves(); scheduleFileSave(); refreshJournal(); } });
  if (btnImportMovesCsv) btnImportMovesCsv.addEventListener('click', ()=> fileImportMovesCsv && fileImportMovesCsv.click());
  if (fileImportMovesCsv) fileImportMovesCsv.addEventListener('change', async (e)=>{
    const f = e.target.files[0]; if (!f) return;
    const text = await f.text(); await importMovesCsv(text); scheduleFileSave(); refreshJournal(); e.target.value='';
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
        <td>${esc(m.name||'')}</td>
        <td class="nowrap">${m.delta>0?'+':''}${m.delta}</td>
        <td class="nowrap">${m.qtyAfter}</td>
        <td>${m.mode}</td>
        <td>${m.source}</td>
      `;
      journalTableBody.appendChild(tr);
    }
  }

  // ========== MATERIEL (emprunts/retours) — rétabli ==========
  const gearModeBorrow = document.getElementById('gearModeBorrow');
  const gearModeReturn = document.getElementById('gearModeReturn');
  const gearModeText = document.getElementById('gearModeText');
  let gearMode = 'borrow';
  if (gearModeBorrow) gearModeBorrow.classList.add('active');
  if (gearModeBorrow) gearModeBorrow.addEventListener('click', ()=>{ gearMode='borrow'; gearModeBorrow.classList.add('active'); gearModeReturn && gearModeReturn.classList.remove('active'); if (gearModeText) gearModeText.textContent='Mode: Emprunter'; });
  if (gearModeReturn) gearModeReturn.addEventListener('click', ()=>{ gearMode='return'; gearModeReturn.classList.add('active'); gearModeBorrow && gearModeBorrow.classList.remove('active'); if (gearModeText) gearModeText.textContent='Mode: Retour'; });

  const loanWho = document.getElementById('loanWho');
  const loanDue = document.getElementById('loanDue');
  const loanNote = document.getElementById('loanNote');
  const loanQty = document.getElementById('loanQty');

  const videoGear = document.getElementById('videoGear');
  const gearStart = document.getElementById('gearStart');
  const gearStop = document.getElementById('gearStop');
  const gearTorch = document.getElementById('gearTorch');
  const gearTest = document.getElementById('gearTest');
  const gearLast = document.getElementById('gearLast');

  let scanningGear = false, lastGearDetected = '', lastGearBeep = 0;

  async function startGear(){
    try{
      scanningGear = true;
      await Barcode.startCamera(videoGear);
      if (gearLast) gearLast.innerHTML = '🎥 Caméra active — scannez le matériel.';
      loopGear();
    }catch(e){ showError('Caméra (matériel) indisponible : ' + (e && e.message ? e.message : e)); }
  }
  if (gearStart) gearStart.addEventListener('click', startGear);
  if (gearStop) gearStop.addEventListener('click', ()=>{
    scanningGear=false;
    try{ if (videoGear && videoGear.srcObject){ videoGear.srcObject.getTracks().forEach(t=>t.stop()); videoGear.pause(); videoGear.srcObject=null; } }catch(e){}
    Barcode.stopCamera();
    if (gearLast) gearLast.innerHTML = '⏹️ Caméra arrêtée.';
  });
  if (gearTorch) gearTorch.addEventListener('click', async ()=>{
    const on = await Barcode.toggleTorch();
    if (gearLast) gearLast.innerHTML = on ? '💡 Lampe ON' : '💡 Lampe OFF';
  });
  if (gearTest) gearTest.addEventListener('click', async ()=>{
    const v = await Barcode.scanOnce(videoGear);
    if (v){ if (v!==lastGearDetected){ lastGearDetected=v; beepOK(); } if (gearLast) gearLast.innerHTML = '🔎 Détecté : <b>'+v+'</b>'; }
    else if (gearLast) gearLast.innerHTML = 'Aucune détection.';
  });

  async function loopGear(){
    while(scanningGear){
      await delay(650);
      try{
        if (!videoGear || !videoGear.srcObject) { scanningGear=false; break; }
        const val = await Barcode.scanOnce(videoGear);
        if (val){
          const now = Date.now();
          if (val !== lastGearDetected || now - lastGearBeep > 1500){ beepOK(); lastGearBeep = now; }
          lastGearDetected = val;
          await handleLoanAction(val);
          await delay(1000);
        }
      }catch(e){}
    }
  }

  async function handleLoanAction(code){
    const who = (loanWho && loanWho.value ? loanWho.value.trim() : '');
    const qty = Math.max(1, parseInt((loanQty && loanQty.value) ? loanQty.value : '1',10));
    const dueStr = (loanDue && loanDue.value ? loanDue.value : '');
    const note = (loanNote && loanNote.value ? loanNote.value.trim() : '');

    let it = await dbGet(code);
    if (!it){ beepErr(); if (gearLast) gearLast.innerHTML = '❌ Code inconnu : <code>'+esc(code)+'</code>'; return; }

    if (gearMode==='borrow'){
      if (!who){ beepErr(); alert('Nom de la personne requis pour un emprunt.'); return; }
      if ((it.qty||0) < qty){ beepErr(); if (gearLast) gearLast.innerHTML = '❌ Stock insuffisant ('+(it.qty||0)+') pour '+qty; return; }
      it = await dbAdjustQty(code, -qty, { mode:'loan', source:'gear' });
      const dueTs = dueStr ? (new Date(dueStr+'T23:59:59').getTime()) : null;
      await dbCreateLoan({ barcode: code, name: it.name, borrower: who, qty, start: Date.now(), due: dueTs, note });
      if (gearLast) gearLast.innerHTML = '✅ Emprunt: '+qty+' × <b>'+esc(it.name)+'</b> par <b>'+esc(who)+'</b>';
      refreshLoansTable(); refreshTable(); refreshJournal();
    } else {
      const ok = await dbReturnLoan(code);
      if (!ok){ beepErr(); if (gearLast) gearLast.innerHTML = '❌ Aucun emprunt actif pour <code>'+esc(code)+'</code>'; return; }
      it = await dbAdjustQty(code, +qty, { mode:'return', source:'gear' });
      if (gearLast) gearLast.innerHTML = '⬅️ Retour: '+qty+' × <b>'+esc(it.name)+'</b>';
      refreshLoansTable(); refreshTable(); refreshJournal();
    }
  }

  const loansTable = document.getElementById('loansTable');
  const loansTbody = loansTable ? loansTable.querySelector('tbody') : null;
  const loanSearch = document.getElementById('loanSearch');
  const btnExportLoansCsv = document.getElementById('btnExportLoansCsv');
  if (loanSearch) loanSearch.addEventListener('input', refreshLoansTable);
  if (btnExportLoansCsv) btnExportLoansCsv.addEventListener('click', async ()=>{
    const arr = await dbListLoans(false);
    const headers = ['start','due','returned','returnDate','barcode','name','borrower','qty','note'];
    const rows = [headers.join(';')];
    for (const l of arr){
      rows.push([l.start||'', l.due||'', l.returned?'1':'0', l.returnDate||'', l.barcode, l.name||'', l.borrower||'', l.qty||1, (l.note||'').replace(/;/g,',')].join(';'));
    }
    downloadText('emprunts.csv', rows.join('\n'));
  });

  async function refreshLoansTable(){
    if (!loansTbody) return;
    let loans = await dbListLoans(true); // actifs
    const q = (loanSearch && loanSearch.value ? loanSearch.value.trim().toLowerCase() : '');
    if (q){
      loans = loans.filter(l=>{
        const s = ((l.barcode||'')+' '+(l.name||'')+' '+(l.borrower||'')+' '+(l.note||'')).toLowerCase();
        return s.includes(q);
      });
    }
    loansTbody.innerHTML = '';
    const now = Date.now();
    for (const l of loans){
      const dueTxt = l.due ? new Date(l.due).toLocaleDateString() : '—';
      const startTxt = l.start ? new Date(l.start).toLocaleString() : '—';
      let statusHtml = '<span class="oktext">en cours</span>';
      if (l.due){
        if (now > l.due) statusHtml = '<span class="overdue">en retard</span>';
        else if (l.due - now < 48*3600*1000) statusHtml = '<span class="dueSoon">bientôt dû</span>';
      }
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="nowrap">${startTxt}</td>
        <td class="nowrap">${dueTxt}</td>
        <td>${statusHtml}</td>
        <td class="nowrap"><code>${esc(l.barcode)}</code></td>
        <td>${esc(l.name||'')}</td>
        <td>${esc(l.borrower||'')}</td>
        <td>${esc(l.note||'')}</td>
        <td><button class="btn ok" data-act="return">Marquer rendu</button></td>
      `;
      tr.querySelector('[data-act="return"]').addEventListener('click', async ()=>{
        const ok = await dbReturnLoan(l.barcode);
        if (!ok){ beepErr(); return; }
        await dbAdjustQty(l.barcode, + (l.qty||1), { mode:'return', source:'gear' });
        refreshLoansTable(); refreshTable(); refreshJournal();
      });
      loansTbody.appendChild(tr);
    }
  }

  // ========== PARAMÈTRES : presets + fichier ==========
  const presetTags = document.getElementById('presetTags');
  const warnBufferInput = document.getElementById('warnBuffer');
  const btnSavePresets = document.getElementById('btnSavePresets');

  const btnOpenDataFile = document.getElementById('btnOpenDataFile');
  const btnSaveNow = document.getElementById('btnSaveNow');
  const fileStatus = document.getElementById('fileStatus');
  const autoSaveChk = document.getElementById('autoSave');

  let fileHandle = null;
  let saveTimer = null;

  function initSettingsPanel(){
    if (presetTags) presetTags.value = TAG_PRESETS.join(', ');
    if (warnBufferInput) warnBufferInput.value = String(WARN_BUFFER);
    if (fileStatus) fileStatus.textContent = fileHandle ? 'Fichier actif: ' + (fileHandle.name||'stock-data.json') : 'Aucun fichier ouvert';
    if (autoSaveChk) autoSaveChk.checked = localStorage.getItem('autoSave')==='1';
  }

  if (btnSavePresets) btnSavePresets.addEventListener('click', ()=>{
    const list = (presetTags && presetTags.value ? presetTags.value : '').split(',').map(s=>s.trim()).filter(Boolean);
    TAG_PRESETS = list;
    WARN_BUFFER = Math.max(0, parseInt((warnBufferInput && warnBufferInput.value) ? warnBufferInput.value : '0',10) || 0);
    localStorage.setItem('tagPresets', JSON.stringify(TAG_PRESETS));
    localStorage.setItem('warnBuffer', String(WARN_BUFFER));
    populatePresetFilter();
    refreshTable();
    alert('Paramètres enregistrés.');
  });

  if (btnOpenDataFile) btnOpenDataFile.addEventListener('click', openDataFile);
  if (btnSaveNow) btnSaveNow.addEventListener('click', saveAllToFile);
  if (autoSaveChk) autoSaveChk.addEventListener('change', ()=> localStorage.setItem('autoSave', autoSaveChk.checked ? '1' : '0'));

  async function openDataFile(){
    if (!window.showSaveFilePicker && !window.showOpenFilePicker){
      alert("Votre navigateur ne supporte pas la sauvegarde de fichiers (File System Access). Utilisez Chrome/Edge sur PC.");
      return;
    }
    try{
      let choice = await new Promise(res=>{ const ok = confirm("OK = Ouvrir un fichier existant\nAnnuler = Créer un nouveau fichier"); res(ok?'open':'create'); });
      if (choice === 'open'){
        const [h] = await window.showOpenFilePicker({
          multiple:false,
          types:[{description:'Stock data JSON', accept:{'application/json':['.json']}}],
          excludeAcceptAllOption:false
        });
        fileHandle = h;
        await loadFromFileHandle(h);
      }else{
        fileHandle = await window.showSaveFilePicker({
          suggestedName:'stock-data.json',
          types:[{description:'Stock data JSON', accept:{'application/json':['.json']}}]
        });
        await saveAllToFile();
      }
      if (fileStatus) fileStatus.textContent = 'Fichier actif: ' + (fileHandle.name || 'stock-data.json');
      alert('Fichier actif prêt.');
    }catch(e){
      if (e && e.name==='AbortError') return;
      showError('Fichier: ' + (e.message||e));
    }
  }
  async function loadFromFileHandle(h){
    const f = await h.getFile();
    const text = await f.text();
    let data = {};
    try{ data = JSON.parse(text||'{}'); }catch(e){ data={}; }
    if (Array.isArray(data.items)) await importItemsJson(JSON.stringify(data.items));
    if (Array.isArray(data.moves)){ for (const m of data.moves){ await dbAddMove(m); } }
    if (Array.isArray(data.loans) && window.dbCreateLoan){ for (const l of data.loans){ if (l && !l.returned) await dbCreateLoan(l); } }
    if (data.presets){
      TAG_PRESETS = Array.isArray(data.presets.tags)? data.presets.tags : TAG_PRESETS;
      WARN_BUFFER = Number.isFinite(data.presets.warnBuffer)? data.presets.warnBuffer : WARN_BUFFER;
      localStorage.setItem('tagPresets', JSON.stringify(TAG_PRESETS));
      localStorage.setItem('warnBuffer', String(WARN_BUFFER));
    }
    populatePresetFilter(); initSettingsPanel();
    refreshTable(); refreshLabelItems(); refreshJournal(); refreshLoansTable();
  }
  async function saveAllToFile(){
    if (!fileHandle){ alert('Aucun fichier actif. Cliquez “Ouvrir / créer un fichier…” d’abord.'); return; }
    try{
      const items = JSON.parse(await exportItemsJson());
      const moves = JSON.parse(await exportMovesJson());
      const loans = (window.dbListLoans ? await dbListLoans(false) : []);
      const blob = new Blob([ JSON.stringify({ items, moves, loans, presets:{ tags: TAG_PRESETS, warnBuffer: WARN_BUFFER } }, null, 2) ], {type:'application/json'});
      const w = await fileHandle.createWritable();
      await w.write(blob); await w.close();
      if (fileStatus) fileStatus.textContent = 'Enregistré dans ' + (fileHandle.name||'stock-data.json') + ' à ' + new Date().toLocaleTimeString();
    }catch(e){ showError('Save: ' + (e.message||e)); }
  }
  function scheduleFileSave(){
    if (!autoSaveChk || !autoSaveChk.checked || !fileHandle) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveAllToFile, 800);
  }

  // Helpers
  function delay(ms){ return new Promise(r=>setTimeout(r, ms)); }
  function esc(s){ return (s||'').replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
  function downloadText(filename, text){
    const blob = new Blob([text], {type:'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
  }
  function loadPresets(){
    try{ const v = localStorage.getItem('tagPresets'); if (!v) return []; const arr = JSON.parse(v)||[]; return Array.isArray(arr)?arr:[]; }catch{ return []; }
  }
  function loadWarnBuffer(){
    const v = parseInt(localStorage.getItem('warnBuffer')||'2',10); return Number.isFinite(v)&&v>=0 ? v : 2;
  }

})();
