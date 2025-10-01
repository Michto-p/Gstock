/* Gstock - app.js v2.1.9 (ergonomie Articles) */
(()=>{'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s)), sr=$('#sr');

const themeToggle=$('#themeToggle');
if(themeToggle){ themeToggle.value=(localStorage.getItem('gstock.theme')||'auto');
  themeToggle.addEventListener('change',()=>{ const v=themeToggle.value; localStorage.setItem('gstock.theme',v);
    if(v==='auto'){ const d=matchMedia('(prefers-color-scheme: dark)').matches; document.documentElement.setAttribute('data-theme',d?'dark':'light'); }
    else document.documentElement.setAttribute('data-theme',v);
  });
}

/* Tabs */
const tabs=$$('nav button[data-tab]');
const sections={home:$('#tab-home'),items:$('#tab-items'),scanner:$('#tab-scanner'),labels:$('#tab-labels'),journal:$('#tab-journal'),gear:$('#tab-gear'),settings:$('#tab-settings')};
tabs.forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
async function showTab(name){ Object.entries(sections).forEach(([k,el])=>el&&(el.hidden=k!==name));
  tabs.forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  if(name==='home')await refreshHome();
  if(name==='items')await refreshTable();
  if(name==='labels')await refreshLabelItems();
  if(name==='journal')await refreshJournal();
  if(name==='gear')await refreshLoansTable();
  if(name==='settings')initSettingsPanel();
}
document.addEventListener('keydown',e=>{ if(e.ctrlKey&&e.key.toLowerCase()==='k'){e.preventDefault();$('#searchItems')?.focus();} });

/* ----- utils ----- */
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function downloadFile(name,data,type){ const blob=new Blob([data],{type}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),3000); }
function announce(msg){ sr&&(sr.textContent=''); setTimeout(()=>{ sr&&(sr.textContent=msg); },10); }
const wait=ms=>new Promise(r=>setTimeout(r,ms));

/* ---- code from name ---- */
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

/* ---------- Articles ---------- */
const itemsTbody=$('#itemsTbody'), searchItems=$('#searchItems'), filterStatus=$('#filterStatus'), filterTag=$('#filterTag');
const selAll=$('#selAll'), bulkBar=$('#bulkBar'), bulkCount=$('#bulkCount');
const bulkExport=$('#bulkExport'), bulkDelete=$('#bulkDelete'), bulkLabels=$('#bulkLabels');
let selected=new Set();

let sortKey=(JSON.parse(localStorage.getItem('gstock.articles.sort')||'{}').key)||'name';
let sortDir=(JSON.parse(localStorage.getItem('gstock.articles.sort')||'{}').dir)||'asc';
let filters=JSON.parse(localStorage.getItem('gstock.articles.filters')||'{}');
if(filters.q) searchItems.value=filters.q||'';
if(filters.status) filterStatus.value=filters.status||'';
if(filters.tag) filterTag.value=filters.tag||'';

function saveSort(){ localStorage.setItem('gstock.articles.sort', JSON.stringify({key:sortKey,dir:sortDir})); }
function saveFilters(){ localStorage.setItem('gstock.articles.filters', JSON.stringify({q:searchItems?.value||'', status:filterStatus?.value||'', tag:filterTag?.value||''})); }

let searchTimer=null;
searchItems?.addEventListener('input',()=>{ clearTimeout(searchTimer); searchTimer=setTimeout(()=>{ saveFilters(); refreshTable(); }, 80); });
filterStatus?.addEventListener('change',()=>{ saveFilters(); refreshTable(); });
filterTag?.addEventListener('change',()=>{ saveFilters(); refreshTable(); });
$('#btnClearFilters')?.addEventListener('click',()=>{ if(searchItems)searchItems.value=''; if(filterStatus)filterStatus.value=''; if(filterTag)filterTag.value=''; saveFilters(); refreshTable(); });

$$('th button.th-sort').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const key=btn.dataset.sort;
    if(sortKey===key){ sortDir=(sortDir==='asc'?'desc':'asc'); } else { sortKey=key; sortDir='asc'; }
    saveSort(); refreshTable(); updateSortIndicators();
  });
});
function updateSortIndicators(){
  $$('thead th').forEach(th=>th.setAttribute('aria-sort','none'));
  const th=$(`th button.th-sort[data-sort="${sortKey}"]`)?.closest('th'); if(th) th.setAttribute('aria-sort', sortDir==='asc'?'ascending':'descending');
}

selAll?.addEventListener('change',()=>{ if(!itemsTbody)return; itemsTbody.querySelectorAll('input.rowSel').forEach(cb=>{ cb.checked=selAll.checked; cb.dispatchEvent(new Event('change')); }); });

function statusBadge(it,buffer=0){
  const s=(it.qty|0)-(it.threshold|0);
  if((it.qty|0)<=(it.threshold|0))return `<span class="badge under" data-fstatus="under" title="Cliquez pour filtrer Sous seuil">Sous seuil</span>`;
  if(s<=(buffer|0))return `<span class="badge low" data-fstatus="low" title="Cliquez pour filtrer Approche">Approche</span>`;
  return `<span class="badge ok" data-fstatus="ok" title="Cliquez pour filtrer OK">OK</span>`;
}

async function refreshTable(){
  const q=(searchItems?.value||'').toLowerCase(), tag=filterTag?.value||'', st=filterStatus?.value||'', buffer=(await dbGetSettings()).buffer|0;
  const list=await dbList();
  const allTags=new Set(); list.forEach(i=>(i.tags||[]).forEach(t=>allTags.add(t)));
  if(filterTag){ const cur=filterTag.value; filterTag.innerHTML=`<option value="">Tous tags</option>`+[...allTags].sort().map(t=>`<option ${t===cur?'selected':''}>${esc(t)}</option>`).join(''); }

  let filtered=list.filter(it=>{
    const inQ=!q||[it.name,it.code,(it.tags||[]).join(' ')].join(' ').toLowerCase().includes(q);
    const inTag=!tag||(it.tags||[]).includes(tag);
    let stOK=true;
    if(st==='ok')stOK=(it.qty>it.threshold && (it.qty-it.threshold)>(buffer|0));
    if(st==='low')stOK=(it.qty>it.threshold && (it.qty-it.threshold)<=(buffer|0));
    if(st==='under')stOK=(it.qty<=it.threshold);
    return inQ&&inTag&&stOK;
  });

  filtered.sort((a,b)=>{
    const dir = (sortDir==='asc')?1:-1;
    if(sortKey==='name') return dir * a.name.localeCompare(b.name,'fr');
    if(sortKey==='code') return dir * a.code.localeCompare(b.code,'fr');
    if(sortKey==='qty') return dir * ((a.qty|0)-(b.qty|0));
    if(sortKey==='threshold') return dir * ((a.threshold|0)-(b.threshold|0));
    return 0;
  });

  const rows=filtered.map(it=>`<tr>
    <td><input type="checkbox" class="rowSel" data-code="${esc(it.code)}" ${selected.has(it.code)?'checked':''}></td>
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
  updateSortIndicators();

  // Bind actions par ligne
  itemsTbody?.querySelectorAll('button[data-act]').forEach(btn=>{
    const code=btn.dataset.code;
    if(btn.dataset.act==='adj') btn.onclick=()=>openAdjustDialog({code});
    if(btn.dataset.act==='hist') btn.onclick=()=>openHistory(code);
    if(btn.dataset.act==='del') btn.onclick=async()=>{ if(confirm('Supprimer cet article ?')){ await dbDelete(code); selected.delete(code); await refreshTable(); announce('Article supprimé'); } };
  });
  // Quick adjust
  itemsTbody?.querySelectorAll('button[data-qa]').forEach(btn=>{
    btn.onclick=async()=>{
      const code=btn.dataset.code; const delta = (btn.dataset.qa==='+1')?+1:-1;
      await quickAdjust(code, delta);
    };
  });
  // Sélection
  itemsTbody?.querySelectorAll('input.rowSel').forEach(cb=>{
    cb.addEventListener('change',()=>{ const code=cb.dataset.code; if(cb.checked)selected.add(code); else selected.delete(code); updateBulkBar(); });
  });
  // Badge → filtre statut
  itemsTbody?.querySelectorAll('[data-fstatus]').forEach(el=>{
    el.addEventListener('click',()=>{ filterStatus.value=el.getAttribute('data-fstatus'); saveFilters(); refreshTable(); });
  });

  // Maj selAll
  selAll.checked = filtered.length>0 && filtered.every(it=>selected.has(it.code));
  updateBulkBar();
}

function updateBulkBar(){ const n=[...selected].length; if(!bulkBar)return; bulkBar.hidden = n===0; bulkCount&&(bulkCount.textContent = `${n} sélection(s)`); }

async function quickAdjust(code, delta){
  const it=await dbGet(code)||await dbGet(code.toUpperCase())||await dbGet(code.toLowerCase());
  if(!it) return alert('Article introuvable');
  const newQty=Math.max(0,(it.qty|0)+delta);
  await dbAdjustQty(it.code, delta);
  await dbAddMove({ts:Date.now(),type:(delta>0?'ENTRY':'EXIT'),code:it.code,name:it.name,qty:Math.abs(delta),note:'ajustement rapide'});
  announce(`${delta>0?'+1':'−1'} → ${it.name}`);
  await refreshTable();
  await refreshHome();
}

// Bulk actions
bulkDelete?.addEventListener('click',async()=>{
  if(selected.size===0) return;
  if(!confirm(`Supprimer ${selected.size} article(s) ?`)) return;
  for(const code of selected){ await dbDelete(code); }
  selected.clear(); await refreshTable(); announce('Articles supprimés');
});
bulkExport?.addEventListener('click',async()=>{
  if(selected.size===0) return;
  const items=[]; for(const code of selected){ const it=await dbGet(code); if(it)items.push(it); }
  const header='name,code,qty,threshold,tags\n';
  const rows=items.map(i=>[i.name,i.code,(i.qty|0),(i.threshold|0),(i.tags||[]).join('|')].map(v=>String(v).replace(/"/g,'""')).map(v=>`"${v}"`).join(',')).join('\n');
  downloadFile('articles-selection.csv', header+rows+'\n', 'text/csv');
});
bulkLabels?.addEventListener('click',async()=>{
  if(selected.size===0) return;
  await renderSheet('selected', Array.from(selected));
  announce('Aperçu des étiquettes (sélection) mis à jour dans l’onglet Étiquettes.');
  showTab('labels');
});

/* Historique simple */
async function openHistory(code){ const item=(await dbGet(code))||(await dbGet(code.toUpperCase()))||(await dbGet(code.toLowerCase()));
  const moves=await dbListMoves({code:item?.code||code,limit:100}); const loans=await dbListLoansByCode(item?.code||code);
  alert(`Historique "${item?.name||code}"\n\nMouvements: ${moves.length}\nEmprunts (actifs+clos): ${loans.length}`); }

/* ----- Dialog Nouvel article ----- */
const newItemDialog=$('#newItemDialog'); const niName=$('#niName'), niCode=$('#niCode'), niQty=$('#niQty'), niThr=$('#niThr'), niTags=$('#niTags');
$('#btnAddItem')?.addEventListener('click',()=>{ niName.value=''; niCode.value=''; niQty.value='0'; niThr.value='0'; niTags.value=''; newItemDialog.showModal(); setTimeout(()=>niName.focus(),0); });
$('#niGen')?.addEventListener('click',async()=>{ if(!niName.value.trim())return; niCode.value = await generateCodeFromName(niName.value.trim()); });
niName?.addEventListener('blur',async()=>{ if(!niCode.value.trim() && niName.value.trim()){ niCode.value = await generateCodeFromName(niName.value.trim()); } });
$('#niSave')?.addEventListener('click',async(e)=>{
  e.preventDefault();
  if(!niName.value.trim() || !niCode.value.trim()) return;
  const name=niName.value.trim(); const code=niCode.value.trim();
  const qty=Math.max(0,parseInt(niQty.value||'0',10)); const threshold=Math.max(0,parseInt(niThr.value||'0',10));
  const tags=(niTags.value||'').split(',').map(t=>t.trim()).filter(Boolean);
  await dbPut({id:code,code,name,qty,threshold,tags,updated:Date.now()});
  newItemDialog.close(); announce(`Article créé • ${name} (${code})`);
  await refreshTable(); await refreshHome();
});

/* ---------- Étiquettes ---------- */
const labelsPreview=$('#labelsPreview');
$('#btnLabelsAll')?.addEventListener('click',()=>renderSheet('all'));
$('#btnLabelsSelected')?.addEventListener('click',async()=>{ const code=prompt('Code article ?'); if(!code)return; await renderSheet('one',code); });
$('#btnLabelsPrintA4')?.addEventListener('click',async()=>{ if(!labelsPreview||!labelsPreview.firstElementChild)await renderSheet('all'); window.print(); });

async function renderSheet(mode='all', payload=null){
  let items=[];
  if(mode==='all'){ items=await dbList(); }
  else if(mode==='one'){ const code=payload; const it=(await dbGet(code))||(await dbGet(code?.toUpperCase()))||(await dbGet(code?.toLowerCase())); if(it)items=[it]; }
  else if(mode==='selected'){ const codes=Array.isArray(payload)?payload:[]; for(const c of codes){ const it=await dbGet(c); if(it)items.push(it); } }
  const frag=document.createDocumentFragment();
  items.forEach(it=>{
    const card=document.createElement('div'); card.className='label-card';
    const name=document.createElement('div'); name.className='name'; name.textContent=it.name; card.appendChild(name);
    const hr=document.createElement('div'); hr.className='hr'; hr.textContent=it.code; card.appendChild(hr);
    const svg=(window.code39?.svg && window.code39.svg(it.code,{module:2,height:52,margin:4,showText:false}))||document.createElementNS('http://www.w3.org/2000/svg','svg');
    card.appendChild(svg); frag.appendChild(card);
  });
  if(labelsPreview){ labelsPreview.classList.add('labels-sheet'); labelsPreview.innerHTML=''; labelsPreview.appendChild(frag); }
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
$('#btnImportJSON')?.addEventListener('click',async()=>{ try{ const [h]=await window.showOpenFilePicker({types:[{description:'JSON',accept:{'application/json':['.json']}}]}); const f=await h.getFile(); const text=await f.text(); const data=JSON.parse(text); await dbImportFull(data); announce('Import terminé'); await refreshTable(); await refreshJournal(); await refreshLoansTable(); await refreshHome(); }catch(e){ console.warn(e); alert('Import annulé / invalide'); }});
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
