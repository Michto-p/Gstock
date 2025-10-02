/* Gstock - app.js v2.4.0 (Stock/Atelier + tags à cocher + emplacement) */
(()=>{'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s)), sr=$('#sr');

/* Theme */
const themeToggle=$('#themeToggle');
if(themeToggle){ themeToggle.value=(localStorage.getItem('gstock.theme')||'auto');
  themeToggle.addEventListener('change',()=>{ const v=themeToggle.value; localStorage.setItem('gstock.theme',v);
    if(v==='auto'){ const d=matchMedia('(prefers-color-scheme: dark)').matches; document.documentElement.setAttribute('data-theme',d?'dark':'light'); }
    else document.documentElement.setAttribute('data-theme',v);
  });
}

/* Tabs */
const sections={home:$('#tab-home'),stock:$('#tab-stock'),atelier:$('#tab-atelier'),scanner:$('#tab-scanner'),labels:$('#tab-labels'),journal:$('#tab-journal'),gear:$('#tab-gear'),settings:$('#tab-settings')};
$$('nav button[data-tab]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
async function showTab(name){
  Object.entries(sections).forEach(([k,el])=>el&&(el.hidden=k!==name));
  $$('nav button[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  if(name==='home')await refreshHome();
  if(name==='stock')await refreshTable('stock');
  if(name==='atelier')await refreshTable('atelier');
  if(name==='labels')await initLabelsPanel?.();
  if(name==='journal')await refreshJournal();
  if(name==='gear')await refreshLoansTable();
  if(name==='settings')initSettingsPanel();
}

/* Utils */
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function announce(msg){ sr&&(sr.textContent=''); setTimeout(()=>{ sr&&(sr.textContent=msg); },10); }
function downloadFile(name,data,type){ const blob=new Blob([data],{type}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),3000); }

/* Name→Code (slug intelligent) */
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

/* Accueil */
async function refreshHome(){
  const items=await dbList();
  const set=await dbGetSettings(); const buf=(set?.buffer|0);
  $('#kpiItems')&&( $('#kpiItems').textContent=String(items.length) );
  $('#kpiQty')&&( $('#kpiQty').textContent=String(items.reduce((s,i)=>s+(i.qty|0),0)) );
  $('#kpiUnder')&&( $('#kpiUnder').textContent=String(items.filter(i=>(i.qty|0)<=(i.threshold|0)).length) );
  $('#kpiLow')&&( $('#kpiLow').textContent=String(items.filter(i=>(i.qty|0)>(i.threshold|0) && ((i.qty|0)-(i.threshold|0))<=buf).length) );
  const loans=await dbListLoans(true); const overdue=loans.filter(l=>!l.returnedAt && Date.now()>new Date(l.due).getTime()).length;
  $('#kpiLoansActive')&&( $('#kpiLoansActive').textContent=String(loans.length) );
  $('#kpiLoansOverdue')&&( $('#kpiLoansOverdue').textContent=String(overdue) );
  const recent=await dbListMoves({from:0,to:Infinity,limit:8}); const ul=$('#recentMoves'); if(ul){ ul.innerHTML=(recent.map(m=>`<li>${new Date(m.ts).toLocaleString()} • <strong>${esc(m.type)}</strong> <code>${esc(m.code)}</code> ×${m.qty}</li>`).join(''))||'<li class="muted">Aucun mouvement</li>'; }
}

/* ---- Etat & helpers UI ---- */
function statusBadge(it,buffer=0){
  const s=(it.qty|0)-(it.threshold|0);
  if((it.qty|0)<=(it.threshold|0))return `<span class="badge under">Sous seuil</span>`;
  if(s<=(buffer|0))return `<span class="badge low">Approche</span>`;
  return `<span class="badge ok">OK</span>`;
}
function getTypeLabel(t){ return t==='atelier'?'Atelier':'Stock'; }
function ensureType(it){ return it.type||'stock'; }

/* ---- Tables (Stock & Atelier) ---- */
const state={
  stock:{ sel:new Set(), q:'', status:'', tag:'', loc:'' },
  atelier:{ sel:new Set(), q:'', status:'', tag:'', loc:'' }
};
const els={
  stock:{ tbody:$('#stockTbody'), search:$('#stockSearch'), status:$('#stockStatus'), tag:$('#stockTag'), loc:$('#stockLoc'),
          selAll:$('#stockSelAll'), bulk:$('#stockBulk'), bulkCount:$('#stockBulkCount'),
          bulkLabels:$('#stockBulkLabels'), bulkExport:$('#stockBulkExport'), bulkDelete:$('#stockBulkDelete'),
          btnAdd:$('#btnAddStock'), btnClear:$('#stockClear') },
  atelier:{ tbody:$('#atelierTbody'), search:$('#atelierSearch'), status:$('#atelierStatus'), tag:$('#atelierTag'), loc:$('#atelierLoc'),
          selAll:$('#atelierSelAll'), bulk:$('#atelierBulk'), bulkCount:$('#atelierBulkCount'),
          bulkLabels:$('#atelierBulkLabels'), bulkExport:$('#atelierBulkExport'), bulkDelete:$('#atelierBulkDelete'),
          btnAdd:$('#btnAddAtelier'), btnClear:$('#atelierClear') }
};

Object.entries(els).forEach(([type, e])=>{
  e.search?.addEventListener('input',debounced(()=>{ state[type].q=e.search.value||''; refreshTable(type); },120));
  e.status?.addEventListener('change',()=>{ state[type].status=e.status.value||''; refreshTable(type); });
  e.tag?.addEventListener('change',()=>{ state[type].tag=e.tag.value||''; refreshTable(type); });
  e.loc?.addEventListener('change',()=>{ state[type].loc=e.loc.value||''; refreshTable(type); });
  e.btnClear?.addEventListener('click',()=>{ state[type]={...state[type], q:'',status:'',tag:'',loc:''}; if(e.search)e.search.value=''; if(e.status)e.status.value=''; if(e.tag)e.tag.value=''; if(e.loc)e.loc.value=''; refreshTable(type); });
  e.selAll?.addEventListener('change',()=>{ e.tbody?.querySelectorAll('input.rowSel').forEach(cb=>{ cb.checked=e.selAll.checked; cb.dispatchEvent(new Event('change')); }); });
  e.bulkDelete?.addEventListener('click',async()=>{ const s=state[type].sel; if(!s.size) return; if(!confirm(`Supprimer ${s.size} élément(s) ?`))return; for(const code of s){ await dbDelete(code); } s.clear(); await refreshTable(type); announce('Éléments supprimés'); });
  e.bulkExport?.addEventListener('click',async()=>{ const s=state[type].sel; if(!s.size) return; const items=[]; for(const code of s){ const it=await dbGet(code); if(it&&ensureType(it)===type)items.push(it); } const header='type,name,code,qty,threshold,tags,location\n'; const rows=items.map(i=>[ensureType(i),i.name,i.code,(i.qty|0),(i.threshold|0),(i.tags||[]).join('|'),i.location||''].map(v=>String(v).replace(/"/g,'""')).map(v=>`"${v}"`).join(',')).join('\n'); downloadFile(`${type}-selection.csv`, header+rows+'\n', 'text/csv'); });
  e.bulkLabels?.addEventListener('click',async()=>{ const s=state[type].sel; if(!s.size) return; await labelsSelectCodes?.(Array.from(s)); showTab('labels'); });
  e.btnAdd?.addEventListener('click',()=>openNewDialog(type));
});

function debounced(fn,ms){ let t=null; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }

async function refreshTable(type){
  const e=els[type]; if(!e||!e.tbody) return;
  const set=await dbGetSettings(); const buffer=(set?.buffer|0);
  const list=await dbList();
  const all = list.map(i=>({...i, type:ensureType(i)})).filter(i=>i.type===type);

  // fill filters content
  const tagsSet=new Set(), locSet=new Set();
  all.forEach(i=>{ (i.tags||[]).forEach(t=>tagsSet.add(t)); if(i.location) locSet.add(i.location); });
  const curTag=e.tag?.value||''; const curLoc=e.loc?.value||'';
  if(e.tag) e.tag.innerHTML=`<option value="">Tous tags</option>`+[...tagsSet].sort().map(t=>`<option ${t===curTag?'selected':''}>${esc(t)}</option>`).join('');
  if(e.loc) e.loc.innerHTML=`<option value="">Tous emplacements</option>`+[...locSet].sort().map(l=>`<option ${l===curLoc?'selected':''}>${esc(l)}</option>`).join('');

  // apply filters
  const q=(state[type].q||'').toLowerCase(), st=state[type].status||'', tag=state[type].tag||'', loc=state[type].loc||'';
  const filtered=all.filter(it=>{
    const inQ=!q||[it.name,it.code,(it.tags||[]).join(' '),it.location||''].join(' ').toLowerCase().includes(q);
    const inTag=!tag||(it.tags||[]).includes(tag);
    const inLoc=!loc||(it.location||'')===loc;
    let stOK=true;
    if(st==='ok')stOK=(it.qty>it.threshold && (it.qty-it.threshold)>(buffer|0));
    if(st==='low')stOK=(it.qty>it.threshold && (it.qty-it.threshold)<=(buffer|0));
    if(st==='under')stOK=(it.qty<=it.threshold);
    return inQ&&inTag&&inLoc&&stOK;
  });

  // rows
  const rows=filtered.map(it=>`<tr>
    <td><input type="checkbox" class="rowSel" data-code="${esc(it.code)}" ${state[type].sel.has(it.code)?'checked':''}></td>
    <td>${esc(it.name)}</td>
    <td><code>${esc(it.code)}</code> <span class="pill muted" style="font-size:.7rem">${getTypeLabel(type)}</span></td>
    <td>
      <div style="display:flex;gap:.3rem;align-items:center">
        <button class="btn" data-qa="-1" data-code="${esc(it.code)}" title="Retirer 1">−1</button>
        <strong>${it.qty|0}</strong>
        <button class="btn" data-qa="+1" data-code="${esc(it.code)}" title="Ajouter 1">+1</button>
      </div>
    </td>
    <td>${it.threshold|0}</td>
    <td>${(it.tags||[]).map(t=>`<span class="pill">${esc(t)}</span>`).join(' ')}</td>
    <td>${esc(it.location||'')}</td>
    <td>${statusBadge(it,buffer)}</td>
    <td>
      <button class="btn" data-act="adj" data-code="${esc(it.code)}">Ajuster…</button>
      <button class="btn" data-act="hist" data-code="${esc(it.code)}">Historique</button>
      <button class="btn danger" data-act="del" data-code="${esc(it.code)}">Suppr.</button>
    </td>
  </tr>`).join('');

  e.tbody.innerHTML=rows||`<tr><td colspan="9" class="muted">Aucun élément</td></tr>`;

  // binds
  e.tbody.querySelectorAll('button[data-act]').forEach(btn=>{
    const code=btn.dataset.code;
    if(btn.dataset.act==='adj') btn.onclick=()=>openAdjustDialog({code});
    if(btn.dataset.act==='hist') btn.onclick=()=>openHistory(code);
    if(btn.dataset.act==='del') btn.onclick=async()=>{ if(confirm('Supprimer cet élément ?')){ await dbDelete(code); state[type].sel.delete(code); await refreshTable(type); announce('Élément supprimé'); } };
  });
  e.tbody.querySelectorAll('button[data-qa]').forEach(btn=>{
    btn.onclick=async()=>{
      const code=btn.dataset.code; const delta = (btn.dataset.qa==='+1')?+1:-1;
      const it=await dbGet(code)||await dbGet(code.toUpperCase())||await dbGet(code.toLowerCase()); if(!it)return;
      await dbAdjustQty(it.code, delta);
      await dbAddMove({ts:Date.now(),type:(delta>0?'ENTRY':'EXIT'),code:it.code,name:it.name,qty:Math.abs(delta),note:`ajustement rapide (${getTypeLabel(ensureType(it))})`});
      announce(`${delta>0?'+1':'−1'} → ${it.name}`); await refreshTable(type); await refreshHome();
    };
  });
  e.tbody.querySelectorAll('input.rowSel').forEach(cb=>{
    cb.addEventListener('change',()=>{ const code=cb.dataset.code; if(cb.checked)state[type].sel.add(code); else state[type].sel.delete(code); updateBulk(type); });
  });
  e.selAll && (e.selAll.checked = filtered.length>0 && filtered.every(it=>state[type].sel.has(it.code)));
  updateBulk(type);
}
function updateBulk(type){
  const e=els[type]; const n=state[type].sel.size; if(!e||!e.bulk)return; e.bulk.hidden=(n===0); if(e.bulkCount) e.bulkCount.textContent=`${n} sélection(s)`;
}

/* Historique simple */
async function openHistory(code){ const item=(await dbGet(code))||(await dbGet(code.toUpperCase()))||(await dbGet(code.toLowerCase()));
  const moves=await dbListMoves({code:item?.code||code,limit:100}); const loans=await dbListLoansByCode?.(item?.code||code) || [];
  alert(`Historique "${item?.name||code}"\n\nMouvements: ${moves.length}\nEmprunts (actifs+clos): ${loans.length}`); }

/* Dialog Ajustement */
const dlg=$('#adjustDialog'), dlgType=$('#dlgType'), dlgQty=$('#dlgQty'), dlgNote=$('#dlgNote'), dlgItem=$('#dlgItem'); let dlgState={code:null};
$('#dlgClose')?.addEventListener('click',()=>dlg?.close()); $('#dlgValidate')?.addEventListener('click',onValidateAdjust);
async function openAdjustDialog({code=null,type='add'}={}){ if(!code)code=prompt('Code ?'); if(!code)return;
  const item=(await dbGet(code))||(await dbGet(code.toUpperCase()))||(await dbGet(code.toLowerCase())); if(!item)return alert('Introuvable');
  dlgState.code=item.code; dlgType.value=type; dlgQty.value=1; dlgNote.value=''; dlgItem.textContent=`${item.name} (${item.code}) — Stock actuel: ${item.qty}`; dlg.showModal();
}
async function onValidateAdjust(){ const type=dlgType.value; const qty=Math.max(1,parseInt(dlgQty.value||'1',10)); const note=dlgNote.value||''; const item=await dbGet(dlgState.code); if(!item)return dlg.close(); const delta=(type==='add')?qty:-qty; await dbAdjustQty(item.code,delta); await dbAddMove({ts:Date.now(),type:(type==='add'?'ENTRY':'EXIT'),code:item.code,name:item.name,qty,note}); announce(`${type==='add'?'Ajout':'Retrait'}: ${qty} → ${item.name}`); dlg.close(); await refreshTable(ensureType(item)); await refreshHome(); }

/* Création : tags à cocher + emplacement */
const newItemDialog=$('#newItemDialog'); const niTitle=$('#niTitle'), niType=$('#niType'), niName=$('#niName'), niCode=$('#niCode'), niQty=$('#niQty'), niThr=$('#niThr'), niLoc=$('#niLoc'), niTagChecks=$('#niTagChecks'), niTagsExtra=$('#niTagsExtra'), niTagCat=$('#niTagCategory');
$('#niGen')?.addEventListener('click',async()=>{ const n=niName.value.trim(); if(!n)return; niCode.value=await generateCodeFromName(n); });
niName?.addEventListener('blur',async()=>{ const n=niName.value.trim(); if(!niCode.value.trim() && n){ niCode.value=await generateCodeFromName(n);} });
$('#niTagsClear')?.addEventListener('click',()=>{ niTagChecks.querySelectorAll('input[type="checkbox"]').forEach(cb=>cb.checked=false); });

async function openNewDialog(type='stock'){
  niType.value=type;
  niTitle.textContent = (type==='atelier'?'Nouveau matériel (Atelier)':'Nouvel article (Stock)');
  niTagCat.textContent = (type==='atelier'?'Atelier':'Stock');

  // suggestions d’emplacements (datalist)
  const items=await dbList(); const locs=[...new Set(items.map(i=>i.location).filter(Boolean))].sort();
  const dl=$('#locList'); if(dl){ dl.innerHTML=locs.map(l=>`<option value="${esc(l)}">`).join(''); }

  // checkboxes de tags (issus des paramètres)
  const set=await dbGetSettings();
  const defaults = (type==='atelier'?(set.defaultTagsAtelier||[]):(set.defaultTagsStock||[]));
  niTagChecks.innerHTML = (defaults.length?defaults:[]).map(t=>`<label class="chip"><input type="checkbox" value="${esc(t)}"> ${esc(t)}</label>`).join('') || `<span class="muted">Aucun tag prédéfini (Paramètres)</span>`;

  // reset champs
  niName.value=''; niCode.value=''; niQty.value='0'; niThr.value='0'; niLoc.value=''; niTagsExtra.value='';
  newItemDialog.showModal(); setTimeout(()=>niName.focus(),0);
}

$('#btnAddStock')?.addEventListener('click',()=>openNewDialog('stock'));
$('#btnAddAtelier')?.addEventListener('click',()=>openNewDialog('atelier'));

$('#niSave')?.addEventListener('click',async(e)=>{
  e.preventDefault();
  const name=niName.value.trim(), code=niCode.value.trim(), type=niType.value==='atelier'?'atelier':'stock';
  if(!name||!code) return;
  const qty=Math.max(0,parseInt(niQty.value||'0',10)), threshold=Math.max(0,parseInt(niThr.value||'0',10));
  const loc=niLoc.value.trim()||'';
  const checked=[...niTagChecks.querySelectorAll('input[type="checkbox"]:checked')].map(cb=>cb.value);
  const extras=(niTagsExtra.value||'').split(',').map(t=>t.trim()).filter(Boolean);
  const tags=[...new Set([...checked, ...extras])];
  await dbPut({id:code,code,name,qty,threshold,tags,location:loc,type,updated:Date.now()});
  newItemDialog.close(); announce(`Créé • ${name} (${code}) → ${getTypeLabel(type)}`);
  await refreshTable(type); await refreshHome();
});

/* Étiquettes (v2.2) : API d’intégration */
async function initLabelsPanel(){ /* no-op ici */ }
async function labelsSelectCodes(){}

/* Journal */
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

/* Prêts */
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

/* Paramètres */
$('#btnExportFull')?.addEventListener('click',async()=>{ const blob=await dbExportFull(); const text=JSON.stringify(blob,null,2); downloadFile('gstock-export.json',text,'application/json'); });
$('#btnImportJSON')?.addEventListener('click',async()=>{ try{ const [h]=await window.showOpenFilePicker({types:[{description:'JSON',accept:{'application/json':['.json']}}]}); const f=await h.getFile(); const text=await f.text(); const data=JSON.parse(text); await dbImportFull(data); announce('Import terminé'); await refreshHome(); await refreshTable('stock'); await refreshTable('atelier'); }catch(e){ console.warn(e); alert('Import annulé / invalide'); }});
const sharedFileStatus=$('#sharedFileStatus');
$('#btnLinkSharedFile')?.addEventListener('click',async()=>{ if(!('showSaveFilePicker' in window))return alert('File System Access API non supportée.');
  const handle=await showSaveFilePicker({suggestedName:'gstock-shared.json',types:[{description:'JSON',accept:{'application/json':['.json']}}]});
  await dbLinkSharedFile(handle); sharedFileStatus&&(sharedFileStatus.textContent='Fichier partagé lié (autosave activé)');
});
$('#btnResetCache')?.addEventListener('click',async()=>{ if(!confirm('Réinitialiser cache PWA et recharger ?'))return;
  try{ const regs=await (navigator.serviceWorker?.getRegistrations?.()||[]); await Promise.all(regs.map(r=>r.unregister())); }catch(e){}
  try{ const keys=await (caches?.keys?.()||[]); await Promise.all(keys.map(k=>caches.delete(k))); }catch(e){} location.reload();
});
function initSettingsPanel(){ (async()=>{
  const set=await dbGetSettings();
  $('#inputBuffer')&&($('#inputBuffer').value=set.buffer|0);
  $('#inputTagsStock')&&($('#inputTagsStock').value=(set.defaultTagsStock||[]).join(', '));
  $('#inputTagsAtelier')&&($('#inputTagsAtelier').value=(set.defaultTagsAtelier||[]).join(', '));
  const chkDebug=$('#chkDebug'); if(chkDebug){ const apply=en=>{ window.GSTOCK_DEBUG=!!en; localStorage.setItem('gstock.debug',en?'1':'0'); window.dispatchEvent(new CustomEvent('gstock:debug-changed',{detail:{enabled:!!en}})); };
    chkDebug.checked=(localStorage.getItem('gstock.debug')==='1'); apply(chkDebug.checked); chkDebug.addEventListener('change',e=>apply(e.target.checked)); }
})();
}
$('#btnSaveSettings')?.addEventListener('click',async()=>{
  const s=await dbGetSettings();
  const newSet={...s, buffer:Math.max(0,parseInt($('#inputBuffer').value||'0',10)),
    defaultTagsStock: ($('#inputTagsStock').value||'').split(',').map(t=>t.trim()).filter(Boolean),
    defaultTagsAtelier: ($('#inputTagsAtelier').value||'').split(',').map(t=>t.trim()).filter(Boolean)
  };
  await dbSaveSettings(newSet); announce('Paramètres enregistrés');
});

/* Init */
(async function init(){
  $('#appVersion')&&( $('#appVersion').textContent=window.APP_VERSION||'' );
  await dbInit();
  await refreshHome();
  showTab('home');
})();
})();
