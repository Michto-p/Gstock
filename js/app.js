/* Gstock - app.js v2.2.0 (Étiquettes : multi-sélection, tailles, pagination) */
(()=>{'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s)), sr=$('#sr');

const themeToggle=$('#themeToggle');
if(themeToggle){ themeToggle.value=(localStorage.getItem('gstock.theme')||'auto');
  themeToggle.addEventListener('change',()=>{ const v=themeToggle.value; localStorage.setItem('gstock.theme',v);
    if(v==='auto'){ const d=matchMedia('(prefers-color-scheme: dark)').matches; document.documentElement.setAttribute('data-theme',d?'dark':'light'); }
    else document.documentElement.setAttribute('data-theme',v);
  });
}

/* ---- Tabs ---- */
const sections={home:$('#tab-home'),items:$('#tab-items'),scanner:$('#tab-scanner'),labels:$('#tab-labels'),journal:$('#tab-journal'),gear:$('#tab-gear'),settings:$('#tab-settings')};
$$('nav button[data-tab]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
async function showTab(name){
  Object.entries(sections).forEach(([k,el])=>el&&(el.hidden=k!==name));
  $$('nav button[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  if(name==='home')await refreshHome();
  if(name==='items')await refreshTable();
  if(name==='labels')await initLabelsPanel();
  if(name==='journal')await refreshJournal();
  if(name==='gear')await refreshLoansTable();
  if(name==='settings')initSettingsPanel();
}

/* ---- Utils ---- */
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function downloadFile(name,data,type){ const blob=new Blob([data],{type}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),3000); }
function announce(msg){ sr&&(sr.textContent=''); setTimeout(()=>{ sr&&(sr.textContent=msg); },10); }

/* ---- Générateur de code depuis le nom ---- */
function deaccent(s){ try{ return s.normalize('NFD').replace(/\p{Diacritic}/gu,''); }catch(_){ return s; } }
function nameToCode(name){
  const stop=new Set(['le','la','les','des','du','de','d','l','un','une','pour','et','sur','avec','en','à','au','aux','the','of','for']);
  const parts=deaccent(String(name)).replace(/[^A-Za-z0-9]+/g,' ').trim().split(/\s+/);
  if(parts.length===0) return 'ITM-'+Math.floor(100000+Math.random()*899999);
  let brand=parts.length>1?parts[parts.length-1]:'';
  let brandShort=brand?(brand.slice(0,3).toLowerCase()):'';
  brandShort=brandShort?(brandShort[0].toUpperCase()+brandShort.slice(1)):'';
  const base=[]; for(let i=0;i<parts.length-(brand?1:0);i++){ const t=parts[i]; const low=t.toLowerCase(); if(stop.has(low))continue; if(/^\d+$/.test(t)){base.push(t);continue;} base.push((t.length>=4?t.slice(0,4):t).toLowerCase()); }
  return base.join('')+brandShort;
}
async function generateCodeFromName(name){ const base=nameToCode(name); let c=base, n=2; while(await dbGet(c)||await dbGet(c.toUpperCase())||await dbGet(c.toLowerCase())) c=`${base}-${n++}`; return c; }

/* ---------- Accueil (résumé) ---------- */
async function refreshHome(){
  const items=await dbList(); const set=await dbGetSettings(); const buf=(set?.buffer|0);
  $('#kpiItems')&&( $('#kpiItems').textContent=String(items.length) );
  $('#kpiQty')&&( $('#kpiQty').textContent=String(items.reduce((s,i)=>s+(i.qty|0),0)) );
  $('#kpiUnder')&&( $('#kpiUnder').textContent=String(items.filter(i=>(i.qty|0)<=(i.threshold|0)).length) );
  $('#kpiLow')&&( $('#kpiLow').textContent=String(items.filter(i=>(i.qty|0)>(i.threshold|0) && ((i.qty|0)-(i.threshold|0))<=buf).length) );
  const loans=await dbListLoans(true); const overdue=loans.filter(l=>!l.returnedAt && Date.now()>new Date(l.due).getTime()).length;
  $('#kpiLoansActive')&&( $('#kpiLoansActive').textContent=String(loans.length) );
  $('#kpiLoansOverdue')&&( $('#kpiLoansOverdue').textContent=String(overdue) );
  const recent=await dbListMoves({from:0,to:Infinity,limit:8}); const ul=$('#recentMoves'); if(ul){ ul.innerHTML=(recent.map(m=>`<li>${new Date(m.ts).toLocaleString()} • <strong>${esc(m.type)}</strong> <code>${esc(m.code)}</code> ×${m.qty}</li>`).join(''))||'<li class="muted">Aucun mouvement</li>'; }
}

/* ---------- Articles (version simple 2.1.9) ---------- */
const itemsTbody=$('#itemsTbody'), searchItems=$('#searchItems'), filterStatus=$('#filterStatus'), filterTag=$('#filterTag');
const selAll=$('#selAll'), bulkBar=$('#bulkBar'), bulkCount=$('#bulkCount');
const bulkExport=$('#bulkExport'), bulkDelete=$('#bulkDelete'), bulkLabels=$('#bulkLabels');
let selectedArticles=new Set();

$('#btnAddItem')?.addEventListener('click',()=>{ $('#niName').value=''; $('#niCode').value=''; $('#niQty').value='0'; $('#niThr').value='0'; $('#niTags').value=''; $('#newItemDialog').showModal(); setTimeout(()=>$('#niName').focus(),0); });
$('#niGen')?.addEventListener('click',async()=>{ const n=$('#niName').value.trim(); if(!n)return; $('#niCode').value=await generateCodeFromName(n); });
$('#niName')?.addEventListener('blur',async()=>{ const n=$('#niName').value.trim(); if(!$('#niCode').value.trim() && n){ $('#niCode').value=await generateCodeFromName(n);} });
$('#niSave')?.addEventListener('click',async(e)=>{
  e.preventDefault();
  const name=$('#niName').value.trim(), code=$('#niCode').value.trim();
  if(!name||!code) return;
  const qty=Math.max(0,parseInt($('#niQty').value||'0',10)), threshold=Math.max(0,parseInt($('#niThr').value||'0',10));
  const tags=($('#niTags').value||'').split(',').map(t=>t.trim()).filter(Boolean);
  await dbPut({id:code,code,name,qty,threshold,tags,updated:Date.now()});
  $('#newItemDialog').close(); announce(`Article créé • ${name} (${code})`);
  await refreshTable(); await refreshHome(); await maybeRefreshLabelsData();
});

let searchTimer=null;
searchItems?.addEventListener('input',()=>{ clearTimeout(searchTimer); searchTimer=setTimeout(()=>refreshTable(),100); });
filterStatus?.addEventListener('change',refreshTable); filterTag?.addEventListener('change',refreshTable);
$('#btnClearFilters')?.addEventListener('click',()=>{ if(searchItems)searchItems.value=''; if(filterStatus)filterStatus.value=''; if(filterTag)filterTag.value=''; refreshTable(); });

function statusBadge(it,buffer=0){
  const s=(it.qty|0)-(it.threshold|0);
  if((it.qty|0)<=(it.threshold|0))return `<span class="badge under">Sous seuil</span>`;
  if(s<=(buffer|0))return `<span class="badge low">Approche</span>`;
  return `<span class="badge ok">OK</span>`;
}
async function refreshTable(){
  const q=(searchItems?.value||'').toLowerCase(), tag=filterTag?.value||'', st=filterStatus?.value||'', buffer=(await dbGetSettings()).buffer|0;
  const list=await dbList(); const allTags=new Set(); list.forEach(i=>(i.tags||[]).forEach(t=>allTags.add(t)));
  if(filterTag){ const cur=filterTag.value; filterTag.innerHTML=`<option value="">Tous tags</option>`+[...allTags].sort().map(t=>`<option ${t===cur?'selected':''}>${esc(t)}</option>`).join(''); }

  const filtered=list.filter(it=>{
    const inQ=!q||[it.name,it.code,(it.tags||[]).join(' ')].join(' ').toLowerCase().includes(q);
    const inTag=!tag||(it.tags||[]).includes(tag);
    let stOK=true;
    if(st==='ok')stOK=(it.qty>it.threshold && (it.qty-it.threshold)>(buffer|0));
    if(st==='low')stOK=(it.qty>it.threshold && (it.qty-it.threshold)<=(buffer|0));
    if(st==='under')stOK=(it.qty<=it.threshold);
    return inQ&&inTag&&stOK;
  });

  const rows=filtered.map(it=>`<tr>
    <td><input type="checkbox" class="rowSel" data-code="${esc(it.code)}" ${selectedArticles.has(it.code)?'checked':''}></td>
    <td>${esc(it.name)}</td>
    <td><code>${esc(it.code)}</code></td>
    <td>
      <div style="display:flex;gap:.3rem;align-items:center">
        <button class="btn" data-qa="-1" data-code="${esc(it.code)}" title="Retirer 1">−1</button>
        <strong>${it.qty}</strong>
        <button class="btn" data-qa="+1" data-code="${esc(it.code)}" title="Ajouter 1">+1</button>
      </div>
    </td>
    <td>${it.threshold}</td>
    <td>${(it.tags||[]).map(t=>`<span class="pill">${esc(t)}</span>`).join(' ')}</td>
    <td>${statusBadge(it,buffer)}</td>
    <td>
      <button class="btn" data-act="adj" data-code="${esc(it.code)}">Ajuster…</button>
      <button class="btn" data-act="hist" data-code="${esc(it.code)}">Historique</button>
      <button class="btn danger" data-act="del" data-code="${esc(it.code)}">Suppr.</button>
    </td>
  </tr>`).join('');

  itemsTbody && (itemsTbody.innerHTML = rows || `<tr><td colspan="8" class="muted">Aucun article</td></tr>`);

  // Bind
  itemsTbody?.querySelectorAll('button[data-act]').forEach(btn=>{
    const code=btn.dataset.code;
    if(btn.dataset.act==='adj') btn.onclick=()=>openAdjustDialog({code});
    if(btn.dataset.act==='hist') btn.onclick=()=>openHistory(code);
    if(btn.dataset.act==='del') btn.onclick=async()=>{ if(confirm('Supprimer cet article ?')){ await dbDelete(code); selectedArticles.delete(code); await refreshTable(); announce('Article supprimé'); await maybeRefreshLabelsData(); } };
  });
  itemsTbody?.querySelectorAll('button[data-qa]').forEach(btn=>{
    btn.onclick=async()=>{
      const code=btn.dataset.code; const delta = (btn.dataset.qa==='+1')?+1:-1;
      const it=await dbGet(code)||await dbGet(code.toUpperCase())||await dbGet(code.toLowerCase()); if(!it)return;
      await dbAdjustQty(it.code, delta);
      await dbAddMove({ts:Date.now(),type:(delta>0?'ENTRY':'EXIT'),code:it.code,name:it.name,qty:Math.abs(delta),note:'ajustement rapide'});
      announce(`${delta>0?'+1':'−1'} → ${it.name}`); await refreshTable(); await refreshHome();
    };
  });
  itemsTbody?.querySelectorAll('input.rowSel').forEach(cb=>{
    cb.addEventListener('change',()=>{ const code=cb.dataset.code; if(cb.checked)selectedArticles.add(code); else selectedArticles.delete(code); updateBulkBar(); });
  });

  selAll && (selAll.checked = filtered.length>0 && filtered.every(it=>selectedArticles.has(it.code)));
  selAll?.addEventListener('change',()=>{ itemsTbody?.querySelectorAll('input.rowSel').forEach(cb=>{ cb.checked=selAll.checked; cb.dispatchEvent(new Event('change')); }); });

  updateBulkBar();
}
function updateBulkBar(){ const n=[...selectedArticles].length; if(!bulkBar)return; bulkBar.hidden = n===0; bulkCount&&(bulkCount.textContent = `${n} sélection(s)`); }
bulkDelete?.addEventListener('click',async()=>{ if(selectedArticles.size===0)return; if(!confirm(`Supprimer ${selectedArticles.size} article(s) ?`))return; for(const code of selectedArticles){ await dbDelete(code); } selectedArticles.clear(); await refreshTable(); announce('Articles supprimés'); await maybeRefreshLabelsData(); });
bulkExport?.addEventListener('click',async()=>{ if(selectedArticles.size===0)return; const items=[]; for(const code of selectedArticles){ const it=await dbGet(code); if(it)items.push(it); } const header='name,code,qty,threshold,tags\n'; const rows=items.map(i=>[i.name,i.code,(i.qty|0),(i.threshold|0),(i.tags||[]).join('|')].map(v=>String(v).replace(/"/g,'""')).map(v=>`"${v}"`).join(',')).join('\n'); downloadFile('articles-selection.csv', header+rows+'\n', 'text/csv'); });
bulkLabels?.addEventListener('click',async()=>{ if(selectedArticles.size===0)return; await labelsSelectCodes(Array.from(selectedArticles)); showTab('labels'); });

/* Historique simple */
async function openHistory(code){ const item=(await dbGet(code))||(await dbGet(code.toUpperCase()))||(await dbGet(code.toLowerCase()));
  const moves=await dbListMoves({code:item?.code||code,limit:100}); const loans=await dbListLoansByCode(item?.code||code);
  alert(`Historique "${item?.name||code}"\n\nMouvements: ${moves.length}\nEmprunts (actifs+clos): ${loans.length}`); }

/* ---------- Ajustement (dialog) ---------- */
const dlg=$('#adjustDialog'), dlgType=$('#dlgType'), dlgQty=$('#dlgQty'), dlgNote=$('#dlgNote'), dlgItem=$('#dlgItem'); let dlgState={code:null};
$('#dlgClose')?.addEventListener('click',()=>dlg?.close()); $('#dlgValidate')?.addEventListener('click',onValidateAdjust);
async function openAdjustDialog({code=null,type='add'}={}){ if(!code)code=prompt('Code article ?'); if(!code)return;
  const item=(await dbGet(code))||(await dbGet(code.toUpperCase()))||(await dbGet(code.toLowerCase())); if(!item)return alert('Article introuvable');
  dlgState.code=item.code; dlgType.value=type; dlgQty.value=1; dlgNote.value=''; dlgItem.textContent=`${item.name} (${item.code}) — Stock actuel: ${item.qty}`; dlg.showModal();
}
async function onValidateAdjust(){ const type=dlgType.value; const qty=Math.max(1,parseInt(dlgQty.value||'1',10)); const note=dlgNote.value||''; const item=await dbGet(dlgState.code); if(!item)return dlg.close(); const delta=(type==='add')?qty:-qty; await dbAdjustQty(item.code,delta); await dbAddMove({ts:Date.now(),type:(type==='add'?'ENTRY':'EXIT'),code:item.code,name:item.name,qty,note}); announce(`${type==='add'?'Ajout':'Retrait'}: ${qty} → ${item.name}`); dlg.close(); await refreshTable(); await refreshHome(); }

/* ---------- Étiquettes (nouveau) ---------- */
const LABEL_TEMPLATES={
  'avery-l7159': { cols:3, rows:7, cellW:63.5, cellH:38.1, gapX:7, gapY:2.5 },
  'mm50x25':    { cols:4, rows:10, cellW:50,  cellH:25,   gapX:5, gapY:5   },
  'mm70x35':    { cols:3, rows:8,  cellW:70,  cellH:35,   gapX:5, gapY:5   }
};
let labelsInitDone=false, labelsAllItems=[], labelsSelected=new Set(), lblPage=0, lblPagesCount=1;
const labelSearch=$('#labelSearch'), labelsList=$('#labelsList'), lblSelInfo=$('#lblSelInfo'), lblTemplate=$('#lblTemplate'), lblDensity=$('#lblDensity'), lblNameSize=$('#lblNameSize'), lblShowText=$('#lblShowText'), labelsPages=$('#labelsPages');
const btnLblAll=$('#lblAll'), btnLblNone=$('#lblNone'), btnLblPrev=$('#lblPrev'), btnLblNext=$('#lblNext'), lblPageInfo=$('#lblPageInfo'), btnLabelsPrint=$('#btnLabelsPrint');

async function initLabelsPanel(){
  if(!labelsInitDone){ await loadLabelsData(); bindLabelsUI(); labelsInitDone=true; }
  // toujours regen en arrivant (au cas où l’inventaire a changé)
  await rebuildLabelsList();
  await rebuildLabelsPreview(true);
}
async function maybeRefreshLabelsData(){ if(labelsInitDone){ await loadLabelsData(); await rebuildLabelsList(); await rebuildLabelsPreview(true); } }
async function loadLabelsData(){ labelsAllItems = await dbList(); if(labelsSelected.size===0){ labelsAllItems.forEach(i=>labelsSelected.add(i.code)); } }

function bindLabelsUI(){
  labelSearch?.addEventListener('input',()=>rebuildLabelsList());
  btnLblAll?.addEventListener('click',()=>{ labelsAllItems.forEach(i=>labelsSelected.add(i.code)); rebuildLabelsList(); rebuildLabelsPreview(true); });
  btnLblNone?.addEventListener('click',()=>{ labelsSelected.clear(); rebuildLabelsList(); rebuildLabelsPreview(true); });
  lblTemplate?.addEventListener('change',()=>rebuildLabelsPreview(true));
  lblDensity?.addEventListener('change',()=>rebuildLabelsPreview(false));
  lblNameSize?.addEventListener('change',()=>rebuildLabelsPreview(false));
  lblShowText?.addEventListener('change',()=>rebuildLabelsPreview(false));
  btnLblPrev?.addEventListener('click',()=>{ if(lblPage>0){ lblPage--; updatePaginationDisplay(); } });
  btnLblNext?.addEventListener('click',()=>{ if(lblPage<lblPagesCount-1){ lblPage++; updatePaginationDisplay(); } });
  btnLabelsPrint?.addEventListener('click',()=>window.print());
}

async function rebuildLabelsList(){
  const q=(labelSearch?.value||'').toLowerCase();
  const rows=labelsAllItems.filter(i=>!q || [i.name,i.code,(i.tags||[]).join(' ')].join(' ').toLowerCase().includes(q))
    .map(i=>`<div class="row"><label style="display:flex;align-items:center;gap:.5rem;flex:1"><input type="checkbox" class="lblRow" data-code="${esc(i.code)}" ${labelsSelected.has(i.code)?'checked':''}> <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.name)}</span></label><code>${esc(i.code)}</code></div>`).join('');
  labelsList&&(labelsList.innerHTML=rows||'<div class="muted">Aucun article</div>');
  labelsList?.querySelectorAll('.lblRow').forEach(cb=>{
    cb.addEventListener('change',()=>{ const code=cb.dataset.code; if(cb.checked)labelsSelected.add(code); else labelsSelected.delete(code); updateLblSelInfo(); rebuildLabelsPreview(true); });
  });
  updateLblSelInfo();
}
function updateLblSelInfo(){ lblSelInfo&&(lblSelInfo.textContent=`${labelsSelected.size} sélection(s)`); }

function chunkArray(arr, size){ const out=[]; for(let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out; }
function mm(n){ return `${n}mm`; }

async function rebuildLabelsPreview(resetPage){
  const tmpl = LABEL_TEMPLATES[lblTemplate?.value||'avery-l7159'];
  const module = parseFloat(lblDensity?.value||'2');
  const namePt = parseInt(lblNameSize?.value||'11',10);
  const showText = !!(lblShowText?.checked);

  const selectedItems = labelsAllItems.filter(i=>labelsSelected.has(i.code));
  const perPage = (tmpl.cols|0)*(tmpl.rows|0);
  const pages = chunkArray(selectedItems, perPage);

  labelsPages.innerHTML='';
  pages.forEach((items,pageIndex)=>{
    const page=document.createElement('div'); page.className='labels-page'; page.dataset.index=String(pageIndex);
    const sheet=document.createElement('div'); sheet.className='labels-sheet';
    sheet.style.gridTemplateColumns=`repeat(${tmpl.cols}, ${mm(tmpl.cellW)})`;
    sheet.style.gridAutoRows=mm(tmpl.cellH);
    sheet.style.columnGap=mm(tmpl.gapX);
    sheet.style.rowGap=mm(tmpl.gapY);

    items.forEach(it=>{
      const card=document.createElement('div'); card.className='label-card';
      // Nom
      const name=document.createElement('div'); name.className='name'; name.textContent=it.name; name.style.fontSize=`${namePt}pt`; card.appendChild(name);
      // Code lisible
      const hr=document.createElement('div'); hr.className='hr'; hr.textContent=it.code; card.appendChild(hr);
      // Code barre
      const svg=(window.code39?.svg && window.code39.svg(it.code,{module:module,height:52,margin:4,showText:showText,fontSize:10})) || document.createElementNS('http://www.w3.org/2000/svg','svg');
      card.appendChild(svg);
      sheet.appendChild(card);
    });

    // si dernière page pas complète → on remplit avec blancs pour garder la grille alignée (optionnel)
    const rest = perPage - items.length;
    for(let k=0;k<rest;k++){ const empty=document.createElement('div'); empty.className='label-card'; empty.style.border='1px dashed transparent'; sheet.appendChild(empty); }

    page.appendChild(sheet);
    labelsPages.appendChild(page);
  });

  lblPagesCount = Math.max(1, pages.length||1);
  if(resetPage) lblPage=0;
  updatePaginationDisplay();
}
function updatePaginationDisplay(){
  const pages=$$('.labels-page', labelsPages);
  pages.forEach((p,i)=>p.classList.toggle('active', i===lblPage));
  lblPageInfo&&(lblPageInfo.textContent=`Page ${Math.min(lblPage+1,lblPagesCount)} / ${lblPagesCount}`);
  btnLblPrev.disabled = (lblPage<=0);
  btnLblNext.disabled = (lblPage>=lblPagesCount-1);
}

/* APIs pour compat : déclenchées depuis l’onglet Articles */
async function labelsSelectCodes(codes){
  await loadLabelsData();
  labelsSelected = new Set(codes.filter(Boolean));
  await rebuildLabelsList();
  await rebuildLabelsPreview(true);
}

/* ---------- Journal ---------- */
const journalTbody=$('#journalTbody');
$('#btnFilterJournal')?.addEventListener('click',refreshJournal);
$('#btnExportCSV')?.addEventListener('click',async()=>{ const data=await dbExport('csv'); downloadFile('journal.csv',data,'text/csv'); });
$('#btnExportJSON')?.addEventListener('click',async()=>{ const data=await dbExport('json'); downloadFile('journal.json',data,'application/json'); });
async function refreshJournal(){
  const from=$('#dateFrom')?.value?new Date($('#dateFrom').value).getTime():0;
  const to=$('#dateTo')?.value?new Date($('#dateTo').value).getTime()+24*3600*1000:Infinity;
  const list=await dbListMoves({from,to,limit:1000});
  journalTbody&&(journalTbody.innerHTML=list.map(m=>`<tr><td>${new Date(m.ts).toLocaleString()}</td><td>${m.type}</td><td><code>${esc(m.code)}</code></td><td>${esc(m.name||'')}</td><td>${m.qty}</td><td>${esc(m.note||'')}</td></tr>`).join('')||`<tr><td colspan="6" class="muted">Aucun mouvement</td></tr>`);
}

/* ---------- Emprunts ---------- */
const loansTbody=$('#loansTbody');
$('#btnNewLoan')?.addEventListener('click',async()=>{ const code=prompt('Code article ?'); if(!code)return;
  const it=(await dbGet(code))||(await dbGet(code.toUpperCase()))||(await dbGet(code.toLowerCase())); if(!it)return alert('Article introuvable');
  const person=prompt('Nom emprunteur ?'); if(!person)return;
  const due=prompt('Date prévue retour (YYYY-MM-DD) ?'); if(!due)return;
  const note=prompt('Note (optionnel)')||''; await dbCreateLoan({code:it.code,name:it.name,person,due,note}); announce(`Prêt créé → ${person}`); await refreshLoansTable(); await refreshHome();
});
$('#searchLoans')?.addEventListener('input',refreshLoansTable);
async function refreshLoansTable(){
  if(!loansTbody)return; const q=($('#searchLoans')?.value||'').toLowerCase(); const loans=await dbListLoans(false);
  const rows=loans.filter(l=>!q||[l.person,l.code,l.name].join(' ').toLowerCase().includes(q)).map(l=>{
    const overdue=(l.returnedAt?false:(Date.now()>new Date(l.due).getTime()));
    return `<tr><td>${esc(l.name||'')}</td><td><code>${esc(l.code)}</code></td><td>${esc(l.person)}</td><td>${esc(l.due)}</td><td>${overdue?'<span class="badge under">En retard</span>':'<span class="badge ok">Actif</span>'}</td><td>${l.returnedAt?'<span class="muted">Clos</span>':`<button class="btn" data-return="${l.id}">Retour</button>`}</td></tr>`;
  }).join('');
  loansTbody.innerHTML=rows||`<tr><td colspan="6" class="muted">Aucun emprunt</td></tr>`;
  loansTbody.querySelectorAll('button[data-return]').forEach(btn=>{ btn.onclick=async()=>{ const id=btn.getAttribute('data-return'); await dbReturnLoan(id); announce('Matériel retourné'); await refreshLoansTable(); await refreshHome(); };});
}

/* ---------- Paramètres ---------- */
$('#btnExportFull')?.addEventListener('click',async()=>{ const blob=await dbExportFull(); const text=JSON.stringify(blob,null,2); downloadFile('gstock-export.json',text,'application/json'); });
$('#btnImportJSON')?.addEventListener('click',async()=>{ try{ const [h]=await window.showOpenFilePicker({types:[{description:'JSON',accept:{'application/json':['.json']}}]}); const f=await h.getFile(); const text=await f.text(); const data=JSON.parse(text); await dbImportFull(data); announce('Import terminé'); await refreshTable(); await refreshJournal(); await refreshLoansTable(); await refreshHome(); await maybeRefreshLabelsData(); }catch(e){ console.warn(e); alert('Import annulé / invalide'); }});
const sharedFileStatus=$('#sharedFileStatus');
$('#btnLinkSharedFile')?.addEventListener('click',async()=>{ if(!('showSaveFilePicker' in window))return alert('File System Access API non supportée.');
  const handle=await showSaveFilePicker({suggestedName:'gstock-shared.json',types:[{description:'JSON',accept:{'application/json':['.json']}}]});
  await dbLinkSharedFile(handle); sharedFileStatus&&(sharedFileStatus.textContent='Fichier partagé lié (autosave activé)');
});
$('#btnResetCache')?.addEventListener('click',async()=>{ if(!confirm('Réinitialiser cache PWA et recharger ?'))return;
  try{ const regs=await (navigator.serviceWorker?.getRegistrations?.()||[]); await Promise.all(regs.map(r=>r.unregister())); }catch(e){}
  try{ const keys=await (caches?.keys?.()||[]); await Promise.all(keys.map(k=>caches.delete(k))); }catch(e){} location.reload();
});
function initSettingsPanel(){ (async()=>{ const set=await dbGetSettings(); $('#inputBuffer')&&($('#inputBuffer').value=set.buffer|0); $('#inputDefaultTags')&&($('#inputDefaultTags').value=(set.defaultTags||[]).join(', '));
  const chkDebug=$('#chkDebug'); if(chkDebug){ const apply=en=>{ window.GSTOCK_DEBUG=!!en; localStorage.setItem('gstock.debug',en?'1':'0'); window.dispatchEvent(new CustomEvent('gstock:debug-changed',{detail:{enabled:!!en}})); };
    chkDebug.checked=(localStorage.getItem('gstock.debug')==='1'); apply(chkDebug.checked); chkDebug.addEventListener('change',e=>apply(e.target.checked)); }
})(); }

/* Init */
(async function init(){
  $('#appVersion')&&( $('#appVersion').textContent=window.APP_VERSION||'' );
  await dbInit();
  await refreshHome();
  showTab('home');
})();
})();
