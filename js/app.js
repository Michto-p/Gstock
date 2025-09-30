/* Gstock - app.js */
(() => {
  'use strict';

  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const sr = $('#sr');

  // Thème
  const themeToggle = $('#themeToggle');
  if (themeToggle){
    themeToggle.value = (localStorage.getItem('gstock.theme') || 'auto');
    themeToggle.addEventListener('change', () => {
      const v = themeToggle.value;
      localStorage.setItem('gstock.theme', v);
      if (v === 'auto') {
        const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', v);
      }
    });
  }

  // Onglets
  const tabs = $$('nav button[data-tab]');
  const sections = {
    items: $('#tab-items'),
    scanner: $('#tab-scanner'),
    labels: $('#tab-labels'),
    journal: $('#tab-journal'),
    gear: $('#tab-gear'),
    settings: $('#tab-settings')
  };
  tabs.forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

  async function showTab(name) {
    Object.entries(sections).forEach(([k, el]) => el.hidden = k !== name);
    tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    if (name === 'items') await refreshTable();
    if (name === 'labels') await refreshLabelItems();
    if (name === 'journal') await refreshJournal();
    if (name === 'gear' && typeof refreshLoansTable === 'function') await refreshLoansTable();
    if (name === 'settings') initSettingsPanel();
  }

  // Raccourcis
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#searchItems')?.focus(); }
    if (e.key.toLowerCase() === 'a') openAdjustDialog({type:'add'});
    if (e.key.toLowerCase() === 'r') openAdjustDialog({type:'remove'});
  });

  // ----------- Articles
  const itemsTbody = $('#itemsTbody');
  const searchItems = $('#searchItems');
  const filterStatus = $('#filterStatus');
  const filterTag = $('#filterTag');

  $('#btnAddItem')?.addEventListener('click', async () => {
    const name = prompt('Nom de l’article ?');
    if (!name) return;
    const code = prompt('Code-barres (laisser vide pour générer)') || await dbGenerateCode();
    const qty = parseInt(prompt('Quantité initiale ?', '0')||'0',10);
    const threshold = parseInt(prompt('Seuil d’alerte ?', '0')||'0',10);
    const tags = (prompt('Tags (séparés par des virgules)')||'').split(',').map(t=>t.trim()).filter(Boolean);
    await dbPut({id: code, code, name, qty, threshold, tags, updated: Date.now()});
    announce('Article créé');
    await refreshTable();
  });
  searchItems?.addEventListener('input', refreshTable);
  filterStatus?.addEventListener('change', refreshTable);
  filterTag?.addEventListener('change', refreshTable);

  function statusBadge(it, buffer=0){
    const s = it.qty - it.threshold;
    if (it.qty <= it.threshold) return `<span class="badge under">Sous seuil</span>`;
    if (s <= buffer) return `<span class="badge low">Approche</span>`;
    return `<span class="badge ok">OK</span>`;
  }

  async function refreshTable(){
    const q = (searchItems?.value||'').toLowerCase();
    const tag = filterTag?.value || '';
    const st = filterStatus?.value || '';
    const buffer = (await dbGetSettings()).buffer|0;
    const list = await dbList();
    const allTags = new Set(); list.forEach(i => (i.tags||[]).forEach(t=>allTags.add(t)));
    if (filterTag){
      const cur = filterTag.value;
      filterTag.innerHTML = `<option value="">Tous tags</option>` + [...allTags].map(t=>`<option ${t===cur?'selected':''}>${t}</option>`).join('');
    }
    const rows = list.filter(it=>{
      const inQ = !q || [it.name,it.code,(it.tags||[]).join(' ')].join(' ').toLowerCase().includes(q);
      const inTag = !tag || (it.tags||[]).includes(tag);
      let stOK = true;
      if (st==='ok') stOK = (it.qty>it.threshold && (it.qty-it.threshold)>(buffer|0));
      if (st==='low') stOK = (it.qty>it.threshold && (it.qty-it.threshold)<=(buffer|0));
      if (st==='under') stOK = (it.qty<=it.threshold);
      return inQ && inTag && stOK;
    }).map(it=>`<tr>
      <td>${escapeHTML(it.name)}</td>
      <td><code>${escapeHTML(it.code)}</code></td>
      <td>${it.qty}</td>
      <td>${it.threshold}</td>
      <td>${(it.tags||[]).map(t=>`<span class="pill">${escapeHTML(t)}</span>`).join(' ')}</td>
      <td>${statusBadge(it, buffer)}</td>
      <td>
        <button class="btn" data-act="adj" data-code="${it.code}">Ajuster</button>
        <button class="btn" data-act="hist" data-code="${it.code}">Historique</button>
        <button class="btn danger" data-act="del" data-code="${it.code}">Suppr.</button>
      </td>
    </tr>`).join('');
    if (itemsTbody) itemsTbody.innerHTML = rows || `<tr><td colspan="7" class="muted">Aucun article</td></tr>`;
    itemsTbody?.querySelectorAll('button[data-act]').forEach(btn=>{
      const code = btn.dataset.code;
      if (btn.dataset.act==='adj') btn.onclick=()=>openAdjustDialog({code});
      if (btn.dataset.act==='hist') btn.onclick=()=>openHistory(code);
      if (btn.dataset.act==='del') btn.onclick=async()=>{
        if (confirm('Supprimer cet article ?')) { await dbDelete(code); await refreshTable(); }
      };
    });
  }

  async function openHistory(code){
    const item = await dbGet(code);
    const moves = await dbListMoves({code, limit: 100});
    const loans = await dbListLoansByCode(code);
    alert(`Historique "${item?.name||code}"\n\nMouvements: ${moves.length}\nEmprunts (actifs+clos): ${loans.length}`);
  }

  // ----------- Dialog Ajustement
  const dlg = $('#adjustDialog');
  const dlgType = $('#dlgType');
  const dlgQty = $('#dlgQty');
  const dlgNote = $('#dlgNote');
  const dlgItem = $('#dlgItem');
  $('#dlgClose')?.addEventListener('click', ()=> dlg?.close());
  $('#dlgValidate')?.addEventListener('click', onValidateAdjust);

  let dlgState = { code:null, name:null };
  async function openAdjustDialog({code=null,type='add'}={}){
    if (!code) code = prompt('Code article ?');
    if (!code) return;
    const item = await dbGet(code);
    if (!item) return alert('Article introuvable');
    dlgState.code = code; dlgState.name = item.name;
    if (dlgType) dlgType.value = type;
    if (dlgQty) dlgQty.value = 1;
    if (dlgNote) dlgNote.value = '';
    if (dlgItem) dlgItem.textContent = `${item.name} (${item.code}) — Stock actuel: ${item.qty}`;
    dlg?.showModal();
  }

  async function onValidateAdjust(){
    const type = dlgType.value;
    const qty = Math.max(1, parseInt(dlgQty.value||'1',10));
    const note = dlgNote.value||'';
    const item = await dbGet(dlgState.code);
    if (!item) return dlg?.close();
    const delta = (type==='add') ? qty : -qty;
    await dbAdjustQty(item.code, delta);
    await dbAddMove({ ts: Date.now(), type: (type==='add'?'ENTRY':'EXIT'), code: item.code, name: item.name, qty, note });
    announce(`${type==='add'?'Ajout':'Retrait'}: ${qty} → ${item.name}`);
    dlg?.close();
    await refreshTable();
  }

  // ----------- Étiquettes
  const labelsPreview = $('#labelsPreview');
  $('#btnLabelsAll')?.addEventListener('click', ()=> renderSheet('all'));
  $('#btnLabelsSelected')?.addEventListener('click', async ()=>{
    const code = prompt('Code article ? (ou laisser vide pour annuler)');
    if (!code) return;
    await renderSheet('one', code);
  });

  async function renderSheet(mode='all', code=null){
    const items = (mode==='all') ? await dbList() : [await dbGet(code)].filter(Boolean);
    const html = items.map(it=>`<div style="display:inline-block;border:1px das
