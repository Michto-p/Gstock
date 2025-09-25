// js/app.js — v1.5.0 : + onglet Matériel (emprunts/retours avec scan)
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
    if (name==='items') refreshTable();
    if (name==='labels') refreshLabelItems();
    if (name==='journal') refreshJournal();
    if (name==='gear') { refreshLoansTable(); }
  }

  // Badge réseau
  const badge = document.getElementById('badge');
  function updateBadge(){ if (badge) badge.textContent = navigator.onLine ? 'en ligne' : 'hors ligne'; }
  window.addEventListener('online', updateBadge);
  window.addEventListener('offline', updateBadge);
  updateBadge();

  // ====== Scanner (stock)
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

  let scanning = false;
  let lastDetected = '', lastBeepAt = 0;

  // Sons
  function beepOK(){ tone(880, 0.06, 120); }
  function beepErr(){ tone(240, 0.07, 220); }
  function tone(freq, vol, dur){
    try{
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq; g.gain.value = vol;
      o.connect(g); g.connect(ctx.destination); o.start();
      setTimeout(()=>{ o.stop(); ctx.close(); }, dur||120);
    }catch(e){}
  }

  async function startScan(){
    try{
      scanning = true;
      await Barcode.startCamera(video);
      if (lastOp) lastOp.innerHTML = '🎥 Caméra active — pointez un code.';
      loopScan();
    }catch(e){ showError('Caméra indisponible : ' + (e && e.message ? e.message : e)); }
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
    const v = await Barcode.scanOnce(video);
    if (v){ if (v!==lastDetected){ lastDetected=v; beepOK(); } if (lastOp) lastOp.innerHTML = '🔎 Détecté : <b>'+v+'</b>'; }
    else if (lastOp) lastOp.innerHTML = 'Aucune détection.';
  });

  async function loopScan(){
    while(scanning){
      await new Promise(r=>setTimeout(r, 650));
      try{
        if (!video || !video.srcObject) { scanning=false; break; }
        const val = await Barcode.scanOnce(video);
        if (val){
          const now = Date.now();
          if (val !== lastDetected || now - lastBeepAt > 1500){ beepOK(); lastBeepAt = now; }
          lastDetected = val;
          await processScan(val, 'scan');
          await new Promise(r=>setTimeout(r, 1000));
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
    refreshTable(); refreshJournal();
  }

  // ====== Tableau Articles (identique à v1.4, conservé)
  const search = document.getElementById('search');
  const itemsTable = document.getElementById('itemsTable');
  const itemsTbody = itemsTable ? itemsTable.querySelector('tbody') : null;
  const chkShowBarcodes = document.getElementById('chkShowBarcodes');
  const addDummyBtn = document.getElementById('addDummy');

  if (chkShowBarcodes){
    chkShowBarcodes.checked = localStorage.getItem('showBarcodesInList') === '1';
    chkShowBarcodes.addEventListener('change', ()=>{
      localStorage.setItem('showBarcodesInList', chkShowBarcodes.checked ? '1' : '0');
      refreshTable();
    });
  }
  if (search) search.addEventListener('input', ()=>refreshTable());
  if (addDummyBtn) addDummyBtn.addEventListener('click', async ()=>{ await dbEnsureDemo(); refreshTable(); });

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

  async function refreshTable(){
    const q = (search && search.value ? search.value : '').trim().toLowerCase();
    let items = await dbList('');
    if (q){
      items = items.filter(it=>{
        const s = ((it.name||'')+' '+(it.barcode||'')+' '+(it.tags||[]).join(' ')+' '+(it.location||'')).toLowerCase();
        return s.includes(q);
      });
    }
    items.sort((a,b)=>{
      const va = (a[sortKey] ?? '').toString().toLowerCase();
      const vb = (b[sortKey] ?? '').toString().toLowerCase();
      if (sortKey==='qty' || sortKey==='min') return (sortAsc?1:-1) * ((a[sortKey]||0) - (b[sortKey]||0));
      return (sortAsc?1:-1) * va.localeCompare(vb);
    });
    if (!itemsTbody) return;
    itemsTbody.innerHTML = '';
    const showCodes = !!(chkShowBarcodes && chkShowBarcodes.checked);
    for (const it of items){
      const warn = (it.qty||0) <= (it.min||0);
      const tr = document.createElement('tr');
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
        <td><b>${escapeHtml(it.name||'(sans nom)')}</b></td>
        <td class="nowrap"><code>${escapeHtml(it.barcode||'')}</code></td>
        <td class="nowrap">${it.qty||0}${warn? ' <span class="warntext">⚠</span>':''}</td>
        <td class="nowrap">${it.min||0}</td>
        <td><div class="tags">${(it.tags||[]).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join(' ')}</div></td>
        <td>${svgHtml || '<span class="muted">—</span>'}</td>
        <td class="nowrap">
          <button class="btn secondary" data-act="minus">−</button>
          <button class="btn secondary" data-act="plus">+</button>
          <button class="btn warn" data-act="del">Suppr.</button>
        </td>
      `;
      tr.querySelector('[data-act="minus"]').addEventListener('click', async ()=>{
        await dbAdjustQty(it.barcode, -1, {mode:'out', source:'ui'}); refreshTable(); refreshJournal();
      });
      tr.querySelector('[data-act="plus"]').addEventListener('click', async ()=>{
        await dbAdjustQty(it.barcode, +1, {mode:'in', source:'ui'}); refreshTable(); refreshJournal();
      });
      tr.querySelector('[data-act="del"]').addEventListener('click', async ()=>{
        if (confirm("Supprimer cet article ?")){ await dbDelete(it.barcode); refreshTable(); }
      });
      itemsTbody.appendChild(tr);
    }
  }

  // ====== Nouveau (création article)
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
    if (newName) newName.value=''; if (newQty) newQty.value='0'; if (newMin) newMin.value='5'; if (newCode) newCode.value=''; if (newTags) newTags.value='';
    alert("Article créé"); showTab('items'); refreshTable(); refreshJournal();
  });
  function genSku(){ const n = Math.floor(Math.random()*99999).toString().padStart(5,'0'); return "CFA-"+n; }

  // ====== Étiquettes
  const labelItem = document.getElementById('labelItem');
  const labelCount = document.getElementById('labelCount');
  const labelPreview = document.getElementById('labelPreview');
  const btnRenderLabel = document.getElementById('btnRenderLabel');
  const btnRenderAllLabels = document.getElementById('btnRenderAllLabels');
  const btnPrintLabels = document.getElementById('btnPrintLabels');

  async function refreshLabelItems(){
    const items = await dbList('');
    if (!labelItem) return;
    labelItem.innerHTML = items.map(i=>`<option value="${i.barcode}">${escapeHtml(i.name)} — ${escapeHtml(i.barcode)}</option>`).join('');
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
    return `<div class="lbl">${svgOne}<div class="ln">${escapeHtml(name)}</div></div>`;
  }
  function renderSheet(html){
    if (labelPreview) {
      labelPreview.innerHTML = `<style>
        .sheet{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:12px}
        @media print{body{background:#fff} .sheet{gap:6px;padding:6px} nav,header,footer,#errbar{display:none !important} .card{border:none !important}}
        .lbl{border:1px dashed var(--bd);border-radius:8px;padding:6px;background:#fff;color:#000}
        .ln{font-size:12px;font-weight:700;margin-top:4px}
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

  // ====== Journal
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

  // ====== Matériel (emprunts/retours)
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
      await new Promise(r=>setTimeout(r, 650));
      try{
        if (!videoGear || !videoGear.srcObject) { scanningGear=false; break; }
        const val = await Barcode.scanOnce(videoGear);
        if (val){
          const now = Date.now();
          if (val !== lastGearDetected || now - lastGearBeep > 1500){ beepOK(); lastGearBeep = now; }
          lastGearDetected = val;
          await handleLoanAction(val);
          await new Promise(r=>setTimeout(r, 1000));
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
    if (!it){ beepErr(); if (gearLast) gearLast.innerHTML = '❌ Code inconnu : <code>'+escapeHtml(code)+'</code>'; return; }

    if (gearMode==='borrow'){
      if (!who){ beepErr(); alert('Nom de la personne requis pour un emprunt.'); return; }
      if ((it.qty||0) < qty){ beepErr(); if (gearLast) gearLast.innerHTML = '❌ Stock insuffisant ('+(it.qty||0)+') pour '+qty; return; }
      // Ajuste stock
      it = await dbAdjustQty(code, -qty, { mode:'loan', source:'gear' });
      // Crée le prêt
      const dueTs = dueStr ? (new Date(dueStr+'T23:59:59').getTime()) : null;
      await dbCreateLoan({ barcode: code, name: it.name, borrower: who, qty, start: Date.now(), due: dueTs, note });
      if (gearLast) gearLast.innerHTML = '✅ Emprunt: '+qty+' × <b>'+escapeHtml(it.name)+'</b> par <b>'+escapeHtml(who)+'</b>';
      refreshLoansTable(); refreshTable(); refreshJournal();
    } else {
      // Retour
      const ok = await dbReturnLoan(code);
      if (!ok){ beepErr(); if (gearLast) gearLast.innerHTML = '❌ Aucun emprunt actif trouvé pour <code>'+escapeHtml(code)+'</code>'; return; }
      it = await dbAdjustQty(code, +qty, { mode:'return', source:'gear' });
      if (gearLast) gearLast.innerHTML = '⬅️ Retour: '+qty+' × <b>'+escapeHtml(it.name)+'</b>';
      refreshLoansTable(); refreshTable(); refreshJournal();
    }
  }

  // Tableau des emprunts
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
    let loans = await dbListLoans(true); // actifs
    const q = (loanSearch && loanSearch.value ? loanSearch.value.trim().toLowerCase() : '');
    if (q){
      loans = loans.filter(l=>{
        const s = ((l.barcode||'')+' '+(l.name||'')+' '+(l.borrower||'')+' '+(l.note||'')).toLowerCase();
        return s.includes(q);
      });
    }
    if (!loansTbody) return;
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
        <td class="nowrap"><code>${escapeHtml(l.barcode)}</code></td>
        <td>${escapeHtml(l.name||'')}</td>
        <td>${escapeHtml(l.borrower||'')}</td>
        <td>${escapeHtml(l.note||'')}</td>
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

  // Helpers
  function downloadText(filename, text){
    const blob = new Blob([text], {type:'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
  }
  function escapeHtml(s){ return (s||'').replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

})();
