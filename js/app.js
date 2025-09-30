/* Gstock - app.js (scanner intégré + debug toggle) */
(() => {
  'use strict';

  const $  = (s, r=document) => r.querySelector(s);
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
    items:    $('#tab-items'),
    scanner:  $('#tab-scanner'),
    labels:   $('#tab-labels'),
    journal:  $('#tab-journal'),
    gear:     $('#tab-gear'),
    settings: $('#tab-settings')
  };
  tabs.forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

  async function showTab(name) {
    Object.entries(sections).forEach(([k, el]) => el && (el.hidden = k !== name));
    tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    if (name === 'items')   await refreshTable();
    if (name === 'labels')  await refreshLabelItems();
    if (name === 'journal') await refreshJournal();
    if (name === 'gear')    await refreshLoansTable();
    if (name === 'settings') initSettingsPanel();
  }

  // Raccourcis
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#searchItems')?.focus(); }
    if (e.key.toLowerCase() === 'a') openAdjustDialog({type:'add'});
    if (e.key.toLowerCase() === 'r') openAdjustDialog({type:'remove'});
  });

  // ------------ Articles
  const itemsTbody   = $('#itemsTbody');
  const searchItems  = $('#searchItems');
  const filterStatus = $('#filterStatus');
  const filterTag    = $('#filterTag');

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
    const s = (it.qty|0) - (it.threshold|0);
    if ((it.qty|0) <= (it.threshold|0)) return `<span class="badge under">Sous seuil</span>`;
    if (s <= (buffer|0))               return `<span class="badge low">Approche</span>`;
    return `<span class="badge ok">OK</span>`;
  }

  async function refreshTable(){
    const q   = (searchItems?.value||'').toLowerCase();
    const tag = filterTag?.value || '';
    const st  = filterStatus?.value || '';
    const buffer = (await dbGetSettings()).buffer|0;
    const list = await dbList();

    const allTags = new Set(); list.forEach(i => (i.tags||[]).forEach(t=>allTags.add(t)));
    if (filterTag){
      const cur = filterTag.value;
      filterTag.innerHTML = `<option value="">Tous tags</option>` + [...allTags].map(t=>`<option ${t===cur?'selected':''}>${escapeHTML(t)}</option>`).join('');
    }

    const rows = list.filter(it=>{
      const inQ   = !q || [it.name,it.code,(it.tags||[]).join(' ')].join(' ').toLowerCase().includes(q);
      const inTag = !tag || (it.tags||[]).includes(tag);
      let stOK = true;
      if (st==='ok')    stOK = (it.qty>it.threshold && (it.qty-it.threshold)>(buffer|0));
      if (st==='low')   stOK = (it.qty>it.threshold && (it.qty-it.threshold)<=(buffer|0));
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
        <button class="btn" data-act="adj"  data-code="${it.code}">Ajuster</button>
        <button class="btn" data-act="hist" data-code="${it.code}">Historique</button>
        <button class="btn danger" data-act="del" data-code="${it.code}">Suppr.</button>
      </td>
    </tr>`).join('');

    itemsTbody && (itemsTbody.innerHTML = rows || `<tr><td colspan="7" class="muted">Aucun article</td></tr>`);
    itemsTbody?.querySelectorAll('button[data-act]').forEach(btn=>{
      const code = btn.dataset.code;
      if (btn.dataset.act==='adj')  btn.onclick=()=>openAdjustDialog({code});
      if (btn.dataset.act==='hist') btn.onclick=()=>openHistory(code);
      if (btn.dataset.act==='del')  btn.onclick=async()=>{
        if (confirm('Supprimer cet article ?')) { await dbDelete(code); await refreshTable(); }
      };
    });
  }

  async function openHistory(code){
    const item  = await dbGet(code);
    const moves = await dbListMoves({code, limit: 100});
    const loans = await dbListLoansByCode(code);
    alert(`Historique "${item?.name||code}"\n\nMouvements: ${moves.length}\nEmprunts (actifs+clos): ${loans.length}`);
  }

  // Dialog ajustement
  const dlg     = $('#adjustDialog');
  const dlgType = $('#dlgType');
  const dlgQty  = $('#dlgQty');
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
    dlgType && (dlgType.value = type);
    dlgQty  && (dlgQty.value  = 1);
    dlgNote && (dlgNote.value = '');
    dlgItem && (dlgItem.textContent = `${item.name} (${item.code}) — Stock actuel: ${item.qty}`);
    dlg?.showModal();
  }

  async function onValidateAdjust(){
    const type = dlgType.value;
    const qty  = Math.max(1, parseInt(dlgQty.value||'1',10));
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

  // Étiquettes
  const labelsPreview = $('#labelsPreview');
  $('#btnLabelsAll')?.addEventListener('click', ()=> renderSheet('all'));
  $('#btnLabelsSelected')?.addEventListener('click', async ()=>{
    const code = prompt('Code article ? (laisser vide pour annuler)');
    if (!code) return;
    await renderSheet('one', code);
  });

  async function renderSheet(mode='all', code=null){
    const items = (mode==='all') ? await dbList() : [await dbGet(code)].filter(Boolean);
    const html = items.map(it=>`<div style="display:inline-block;border:1px dashed var(--bd);border-radius:8px;padding:8px;margin:6px;width:220px">
      <div style="font-weight:600;margin-bottom:6px">${escapeHTML(it.name)}</div>
      <div style="font-size:12px;color:#6b7280">${escapeHTML(it.code)}</div>
      <svg width="200" height="60" data-barcode="${escapeHTML(it.code)}"></svg>
    </div>`).join('');
    labelsPreview && (labelsPreview.innerHTML = html || `<div class="muted">Aucun article</div>`);
    labelsPreview?.querySelectorAll('svg[data-barcode]').forEach(svg=>{
      drawFakeCode128(svg, svg.getAttribute('data-barcode'));
    });
    announce('Planche étiquettes générée');
  }

  function drawFakeCode128(svg, value){
    const w = +svg.getAttribute('width'), h = +svg.getAttribute('height');
    const rnd = (s)=>{ let x=0; for (let i=0;i<s.length;i++) x=(x*31 + s.charCodeAt(i))>>>0; return x; };
    const seed = rnd(String(value));
    const bars = 95;
    const ctx = document.createElementNS('http://www.w3.org/2000/svg','g');
    let x = 0; const bw = Math.max(1, Math.floor(w/bars));
    for (let i=0;i<bars;i++){
      const on = ((seed >> (i%31)) & 1) ^ (i%3===0?1:0);
      if (on) {
        const r = document.createElementNS('http://www.w3.org/2000/svg','rect');
        r.setAttribute('x', String(x));
        r.setAttribute('y', '0');
        r.setAttribute('width', String(bw));
        r.setAttribute('height', String(h));
        r.setAttribute('fill', '#111827');
        ctx.appendChild(r);
      }
      x += bw;
    }
    svg.innerHTML = ''; svg.appendChild(ctx);
  }

  async function refreshLabelItems(){}

  // Journal
  const journalTbody = $('#journalTbody');
  $('#btnFilterJournal')?.addEventListener('click', refreshJournal);
  $('#btnExportCSV')?.addEventListener('click', async ()=>{
    const data = await dbExport('csv'); downloadFile('journal.csv', data, 'text/csv');
  });
  $('#btnExportJSON')?.addEventListener('click', async ()=>{
    const data = await dbExport('json'); downloadFile('journal.json', data, 'application/json');
  });

  async function refreshJournal(){
    const from = $('#dateFrom')?.value ? new Date($('#dateFrom').value).getTime() : 0;
    const to   = $('#dateTo')?.value   ? new Date($('#dateTo').value).getTime()+24*3600*1000 : Infinity;
    const list = await dbListMoves({from,to,limit:1000});
    journalTbody && (journalTbody.innerHTML = list.map(m=>`<tr>
      <td>${new Date(m.ts).toLocaleString()}</td>
      <td>${m.type}</td>
      <td><code>${escapeHTML(m.code)}</code></td>
      <td>${escapeHTML(m.name||'')}</td>
      <td>${m.qty}</td>
      <td>${escapeHTML(m.note||'')}</td>
    </tr>`).join('') || `<tr><td colspan="6" class="muted">Aucun mouvement</td></tr>`);
  }

  // Prêts
  const loansTbody = $('#loansTbody');
  $('#btnNewLoan')?.addEventListener('click', async ()=>{
    const code = prompt('Code article ?'); if (!code) return;
    const it = await dbGet(code); if (!it) return alert('Article introuvable');
    const person = prompt('Nom emprunteur ?'); if (!person) return;
    const due = prompt('Date prévue retour (YYYY-MM-DD) ?'); if (!due) return;
    const note = prompt('Note (optionnel)')||'';
    await dbCreateLoan({code, name:it.name, person, due, note});
    announce(`Prêt créé → ${person}`);
    await refreshLoansTable();
  });
  $('#searchLoans')?.addEventListener('input', refreshLoansTable);

  async function refreshLoansTable(){
    if (!loansTbody) return;
    const q = ($('#searchLoans')?.value||'').toLowerCase();
    const loans = await dbListLoans(false);
    const rows = loans.filter(l=>{
      return !q || [l.person,l.code,l.name].join(' ').toLowerCase().includes(q);
    }).map(l=>{
      const overdue = (l.returnedAt?false:(Date.now()>new Date(l.due).getTime()));
      return `<tr>
        <td>${escapeHTML(l.name||'')}</td>
        <td><code>${escapeHTML(l.code)}</code></td>
        <td>${escapeHTML(l.person)}</td>
        <td>${escapeHTML(l.due)}</td>
        <td>${overdue?'<span class="badge under">En retard</span>':'<span class="badge ok">Actif</span>'}</td>
        <td>${l.returnedAt? `<span class="muted">Clos</span>` : `<button class="btn" data-return="${l.id}">Retour</button>`}</td>
      </tr>`;
    }).join('');
    loansTbody.innerHTML = rows || `<tr><td colspan="6" class="muted">Aucun emprunt</td></tr>`;
    loansTbody.querySelectorAll('button[data-return]').forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute('data-return');
        await dbReturnLoan(id);
        announce('Matériel retourné');
        await refreshLoansTable();
      };
    });
  }

  // Paramètres / Sauvegarde
  $('#btnExportFull')?.addEventListener('click', async ()=>{
    const blob = await dbExportFull();
    const text = JSON.stringify(blob, null, 2);
    downloadFile('gstock-export.json', text, 'application/json');
  });

  $('#btnImportJSON')?.addEventListener('click', async ()=>{
    try{
      const [fileHandle] = await window.showOpenFilePicker({types:[{description:'JSON',accept:{'application/json':['.json']}}]});
      const file = await fileHandle.getFile();
      const text = await file.text();
      const data = JSON.parse(text);
      await dbImportFull(data);
      announce('Import terminé');
      await refreshTable(); await refreshJournal(); await refreshLoansTable();
    }catch(e){ console.warn(e); alert('Import annulé / invalide'); }
  });

  const sharedFileStatus = $('#sharedFileStatus');
  $('#btnLinkSharedFile')?.addEventListener('click', async ()=>{
    if (!('showSaveFilePicker' in window)) return alert('File System Access API non supportée sur ce navigateur.');
    const handle = await showSaveFilePicker({suggestedName:'gstock-shared.json', types:[{description:'JSON',accept:{'application/json':['.json']}}]});
    await dbLinkSharedFile(handle);
    sharedFileStatus && (sharedFileStatus.textContent = 'Fichier partagé lié (autosave activé)');
  });

  function initSettingsPanel(){
    (async ()=>{
      const set = await dbGetSettings();
      $('#inputBuffer')      && ($('#inputBuffer').value = set.buffer|0);
      $('#inputDefaultTags') && ($('#inputDefaultTags').value = (set.defaultTags||[]).join(', '));

      // Debug live toggle
      const chkDebug = $('#chkDebug');
      if (chkDebug) {
        const apply = (enabled)=>{
          window.GSTOCK_DEBUG = !!enabled;
          localStorage.setItem('gstock.debug', enabled ? '1' : '0');
          window.dispatchEvent(new CustomEvent('gstock:debug-changed', { detail: { enabled: !!enabled } }));
        };
        chkDebug.checked = (localStorage.getItem('gstock.debug') === '1');
        apply(chkDebug.checked);
        chkDebug.addEventListener('change', (e)=> apply(e.target.checked));
      }

      if (window.githubSync?.loadSaved) {
        const saved = window.githubSync.loadSaved();
        $('#ghOwner') && ($('#ghOwner').value = saved.owner || '');
        $('#ghRepo')  && ($('#ghRepo').value  = saved.repo  || '');
        $('#ghPath')  && ($('#ghPath').value  = saved.path  || 'gstock-shared.json');
        $('#ghToken') && ($('#ghToken').value = saved.token || '');
      }
    })();
  }

  $('#btnSaveSettings')?.addEventListener('click', async ()=>{
    const buffer = Math.max(0, parseInt($('#inputBuffer')?.value||'0',10));
    const defaultTags = ($('#inputDefaultTags')?.value||'').split(',').map(t=>t.trim()).filter(Boolean);
    await dbSetSettings({buffer, defaultTags});
    announce('Paramètres enregistrés');
    await refreshTable();
  });

  // Démo
  $('#btnLoadDemo')?.addEventListener('click', async ()=>{
    try{
      const res = await fetch('data/demo.json', {cache:'no-store'});
      if (!res.ok) throw new Error('demo.json introuvable');
      const data = await res.json();
      await dbImportFull(data);
      announce('Mini base de démo chargée');
      await refreshTable(); await refreshJournal(); await refreshLoansTable();
    }catch(e){
      console.warn(e);
      alert('Impossible de charger la démo : ' + e.message);
    }
  });

  // Sync GitHub (tests)
  $('#btnGHEnable')?.addEventListener('click', ()=>{
    if (!window.githubSync) return alert('Module sync-github non chargé');
    const owner = ($('#ghOwner')?.value||'').trim();
    const repo  = ($('#ghRepo')?.value||'').trim();
    const path  = ($('#ghPath')?.value||'gstock-shared.json').trim();
    const token = ($('#ghToken')?.value||'').trim();
    if (!owner || !repo || !path || !token) return alert('Renseignez owner, repo, chemin et token.');
    window.githubSync.init({owner, repo, path, token});
    alert('Sync GitHub configurée (tests).');
  });
  $('#btnGHPull')?.addEventListener('click', async ()=>{
    try{
      await window.githubSync.pull();
      announce('Pull GitHub OK');
      await refreshTable(); await refreshJournal(); await refreshLoansTable();
    }catch(e){ alert('Pull GitHub échoué : '+ e.message); }
  });
  $('#btnGHPush')?.addEventListener('click', async ()=>{
    try{
      await window.githubSync.push();
      announce('Push GitHub OK');
    }catch(e){ alert('Push GitHub échoué : '+ e.message); }
  });
  $('#btnGHStart')?.addEventListener('click', ()=>{
    try{ window.githubSync.startAuto(4000); alert('Auto-sync ON (toutes les 4s)'); }catch(e){ alert(e.message); }
  });
  $('#btnGHStop')?.addEventListener('click', ()=>{
    try{ window.githubSync.stopAuto(); alert('Auto-sync OFF'); }catch(e){ alert(e.message); }
  });

  // Scanner intégré
  const scanVideo    = $('#scanVideo');
  const scanHint     = $('#scanHint');
  const btnScanStart = $('#btnScanStart');
  const btnScanStop  = $('#btnScanStop');
  const btnScanTorch = $('#btnScanTorch');
  let scanning = false;

  window.addEventListener('gstock:scan-unknown', (ev)=>{
    const code = ev.detail.code;
    scanHint && (scanHint.textContent = `Code ${code} inconnu — continuez à viser un article enregistré.`);
  });

  btnScanStart?.addEventListener('click', async ()=>{
    if (scanning) return;
    if (typeof window.scanUntilKnown !== 'function') { alert('Module de scan non chargé.'); return; }
    scanning = true;
    btnScanStart.disabled = true;
    scanHint && (scanHint.textContent = 'Visez le code-barres. Les codes inconnus ne ferment pas la caméra.');

    try{
      const code = await window.scanUntilKnown(scanVideo, { confirmFrames: 1 });
      if (!scanning) return;
      if (code) openAdjustDialog({code});
    }catch(e){
      console.warn(e);
      alert('Le scan a échoué ou a été annulé.');
    }finally{
      scanning = false;
      btnScanStart.disabled = false;
    }
  });

  btnScanStop?.addEventListener('click', async ()=>{
    scanning = false;
    try{ await window.stopScan?.(); }catch(_){}
    scanHint && (scanHint.textContent = 'Scan arrêté.');
    btnScanStart.disabled = false;
  });

  btnScanTorch?.addEventListener('click', ()=> window.toggleTorch?.());

  // Helpers
  function escapeHTML(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function downloadFile(name, data, type){
    const blob = new Blob([data], {type}); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 5000);
  }
  function announce(msg){ sr && (sr.textContent=''); setTimeout(()=>{ sr && (sr.textContent = msg); }, 10); }

  // Init
  (async function init(){
    $('#appVersion') && ( $('#appVersion').textContent = window.APP_VERSION || '' );
    await dbInit();
    await refreshTable();
    showTab('items');
  })();

})();
