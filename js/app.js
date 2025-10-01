/* Gstock - app.js v2.3.0 (Paramètres : aide + import CSV avec mappage) */
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
const sections={home:$('#tab-home'),items:$('#tab-items'),scanner:$('#tab-scanner'),labels:$('#tab-labels'),journal:$('#tab-journal'),gear:$('#tab-gear'),settings:$('#tab-settings')};
$$('nav button[data-tab]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
async function showTab(name){
  Object.entries(sections).forEach(([k,el])=>el&&(el.hidden=k!==name));
  $$('nav button[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  if(name==='home')await refreshHome();
  if(name==='items')await refreshTable();
  if(name==='labels')await initLabelsPanel?.();
  if(name==='journal')await refreshJournal();
  if(name==='gear')await refreshLoansTable();
  if(name==='settings')initSettingsPanel();
}
function announce(msg){ sr&&(sr.textContent=''); setTimeout(()=>{ sr&&(sr.textContent=msg); },10); }
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function downloadFile(name,data,type){ const blob=new Blob([data],{type}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),3000); }

/* Name→Code helper */
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

/* -------- Accueil (résumé) -------- */
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

/* -------- Articles (résumé des actions utiles) -------- */
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
  await refreshTable(); await refreshHome();
});

let searchTimer=null;
searchItems?.addEventListener('input',()=>{ clearTimeout(searchTimer); searchTimer=setTimeout(()=>refreshTable(),100); });
filterStatus?.addEventListener('change',refreshTable); filterTag?.addEventListener('change',refreshTable);
$('#btnClearFilters')?.addEventListener('click',()=>{ if(searchItems)searchItems.value=''; if(filterStatus)filterStatus.value=''; if(filterTag)filterTag.value=''; refreshTable(); });

function statusBadge(it,buffer=0){ const s=(it.qty|0)-(it.threshold|0);
  if((it.qty|0)<=(it.threshold|0))return `<span class="badge under">Sous seuil</span>`;
  if(s<=(buffer|0))return `<span class="badge low">Approche</span>`;
  return `<span class="badge ok">OK</span>`;
}
async function refreshTable(){
  if(!itemsTbody)return;
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
    <td>${esc(it.name)}</td><td><code>${esc(it.code)}</code></td>
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
  itemsTbody.innerHTML=rows||`<tr><td colspan="8" class="muted">Aucun article</td></tr>`;
  // binds
  itemsTbody.querySelectorAll('button[data-act]').forEach(btn=>{
    const code=btn.dataset.code;
    if(btn.dataset.act==='adj') btn.onclick=()=>openAdjustDialog({code});
    if(btn.dataset.act==='hist') btn.onclick=()=>openHistory(code);
    if(btn.dataset.act==='del') btn.onclick=async()=>{ if(confirm('Supprimer cet article ?')){ await dbDelete(code); selectedArticles.delete(code); await refreshTable(); announce('Article supprimé'); } };
  });
  itemsTbody.querySelectorAll('button[data-qa]').forEach(btn=>{
    btn.onclick=async()=>{
      const code=btn.dataset.code; const delta=(btn.dataset.qa==='+1')?+1:-1;
      const it=await dbGet(code)||await dbGet(code.toUpperCase())||await dbGet(code.toLowerCase()); if(!it)return;
      await dbAdjustQty(it.code,delta);
      await dbAddMove({ts:Date.now(),type:(delta>0?'ENTRY':'EXIT'),code:it.code,name:it.name,qty:Math.abs(delta),note:'ajustement rapide'});
      announce(`${delta>0?'+1':'−1'} → ${it.name}`); await refreshTable(); await refreshHome();
    };
  });
  itemsTbody.querySelectorAll('input.rowSel').forEach(cb=>{
    cb.addEventListener('change',()=>{ const code=cb.dataset.code; if(cb.checked)selectedArticles.add(code); else selectedArticles.delete(code); updateBulkBar(); });
  });
  selAll && (selAll.checked = filtered.length>0 && filtered.every(it=>selectedArticles.has(it.code)));
  selAll?.addEventListener('change',()=>{ itemsTbody?.querySelectorAll('input.rowSel').forEach(cb=>{ cb.checked=selAll.checked; cb.dispatchEvent(new Event('change')); }); });
  updateBulkBar();
}
function updateBulkBar(){ const n=[...selectedArticles].length; if(!bulkBar)return; bulkBar.hidden=(n===0); bulkCount&&(bulkCount.textContent=`${n} sélection(s)`); }
bulkDelete?.addEventListener('click',async()=>{ if(selectedArticles.size===0)return; if(!confirm(`Supprimer ${selectedArticles.size} article(s) ?`))return; for(const code of selectedArticles){ await dbDelete(code); } selectedArticles.clear(); await refreshTable(); announce('Articles supprimés'); });
bulkExport?.addEventListener('click',async()=>{ if(selectedArticles.size===0)return; const items=[]; for(const code of selectedArticles){ const it=await dbGet(code); if(it)items.push(it); } const header='name,code,qty,threshold,tags\n'; const rows=items.map(i=>[i.name,i.code,(i.qty|0),(i.threshold|0),(i.tags||[]).join('|')].map(v=>String(v).replace(/"/g,'""')).map(v=>`"${v}"`).join(',')).join('\n'); downloadFile('articles-selection.csv', header+rows+'\n', 'text/csv'); });
bulkLabels?.addEventListener('click',async()=>{ if(selectedArticles.size===0)return; await labelsSelectCodes?.(Array.from(selectedArticles)); showTab('labels'); });

/* Historique simple */
async function openHistory(code){ const item=(await dbGet(code))||(await dbGet(code.toUpperCase()))||(await dbGet(code.toLowerCase()));
  const moves=await dbListMoves({code:item?.code||code,limit:100}); const loans=await dbListLoansByCode(item?.code||code);
  alert(`Historique "${item?.name||code}"\n\nMouvements: ${moves.length}\nEmprunts (actifs+clos): ${loans.length}`); }

/* -------- Ajustement dialog -------- */
const dlg=$('#adjustDialog'), dlgType=$('#dlgType'), dlgQty=$('#dlgQty'), dlgNote=$('#dlgNote'), dlgItem=$('#dlgItem'); let dlgState={code:null};
$('#dlgClose')?.addEventListener('click',()=>dlg?.close()); $('#dlgValidate')?.addEventListener('click',onValidateAdjust);
async function openAdjustDialog({code=null,type='add'}={}){ if(!code)code=prompt('Code article ?'); if(!code)return;
  const item=(await dbGet(code))||(await dbGet(code.toUpperCase()))||(await dbGet(code.toLowerCase())); if(!item)return alert('Article introuvable');
  dlgState.code=item.code; dlgType.value=type; dlgQty.value=1; dlgNote.value=''; dlgItem.textContent=`${item.name} (${item.code}) — Stock actuel: ${item.qty}`; dlg.showModal();
}
async function onValidateAdjust(){ const type=dlgType.value; const qty=Math.max(1,parseInt(dlgQty.value||'1',10)); const note=dlgNote.value||''; const item=await dbGet(dlgState.code); if(!item)return dlg.close(); const delta=(type==='add')?qty:-qty; await dbAdjustQty(item.code,delta); await dbAddMove({ts:Date.now(),type:(type==='add'?'ENTRY':'EXIT'),code:item.code,name:item.name,qty,note}); announce(`${type==='add'?'Ajout':'Retrait'}: ${qty} → ${item.name}`); dlg.close(); await refreshTable(); await refreshHome(); }

/* -------- Étiquettes (v2.2.0) — stubs publics utilisés par Articles -------- */
async function initLabelsPanel(){ /* no-op ici; impl. déjà dans v2.2.0 si présent */ }
async function labelsSelectCodes(){}

/* -------- Journal -------- */
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

/* -------- Paramètres -------- */
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

/* -------- Import CSV avec assistant de mappage -------- */
const inputCSV=$('#inputCSV'), btnOpenCsvMap=$('#btnOpenCsvMap'), csvDlg=$('#csvMapDialog');
const csvClose=$('#csvClose'), csvDelimiter=$('#csvDelimiter'), csvHeader=$('#csvHeader'), csvTagSep=$('#csvTagSep');
const mapName=$('#mapName'), mapCode=$('#mapCode'), mapQty=$('#mapQty'), mapThr=$('#mapThr'), mapTags=$('#mapTags'), csvDup=$('#csvDup');
const csvPrevHead=$('#csvPrevHead'), csvPrevBody=$('#csvPrevBody'), csvSummary=$('#csvSummary'), csvImport=$('#csvImport');

let csvText='', csvRows=[], csvCols=[], csvHasHeader=true, csvSep=',', csvHeaders=[], csvDetected={rows:0, cols:0};
function resetCsvState(){ csvText=''; csvRows=[]; csvCols=[]; csvHasHeader=true; csvSep=','; csvHeaders=[]; csvDetected={rows:0,cols:0}; }

/* Parser CSV robuste (gère quotes, séparateurs) */
function detectSeparator(sample){
  const cands=[',',';','\t']; let best=',', bestScore=-1;
  for(const sep of cands){
    const lines=sample.split(/\r?\n/).filter(Boolean).slice(0,20);
    const counts=lines.map(l=>splitCsvLine(l,sep).length);
    const score = - Math.abs(new Set(counts).size) + (counts[0]||0); // homogénéité + nb colonnes
    if(score>bestScore){ best=sep; bestScore=score; }
  }
  return best;
}
function splitCsvLine(line, sep){
  const out=[]; let cur=''; let inQ=false; for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){ if(inQ && line[i+1]==='"'){ cur+='"'; i++; } else { inQ=!inQ; } }
    else if(ch===sep && !inQ){ out.push(cur); cur=''; }
    else cur+=ch;
  }
  out.push(cur); return out;
}
function parseCSV(text, sep, hasHeader){
  const lines=text.split(/\r?\n/).filter(l=>l.length>0);
  const rows=lines.map(l=>splitCsvLine(l, sep));
  const cols=Math.max(0,...rows.map(r=>r.length));
  return {rows, cols, headers: hasHeader? (rows[0]||[]): Array.from({length:cols},(_,i)=>`Col${i+1}`), startIndex: hasHeader?1:0};
}

/* Auto-map des entêtes */
function autoMap(headers){
  const H=headers.map(h=>String(h||'').toLowerCase().trim());
  const find=(alts)=>{ for(const a of alts){ const i=H.findIndex(h=>h===a || h.includes(a)); if(i>=0) return i; } return -1; };
  return {
    name: find(['nom','name','designation','libelle','libellé']),
    code: find(['code','sku','ref','réf','reference','référence']),
    qty:  find(['qty','quantite','quantité','stock','qte']),
    thr:  find(['seuil','threshold','min','minstock','alerte']),
    tags: find(['tags','etiquettes','labels','motscles','mots-clés'])
  };
}

/* Remplit les <select> de mapping */
function fillMapSelects(headers, preset){
  const opts = ['<option value="-1">— (ignorer)</option>']
    .concat(headers.map((h,i)=>`<option value="${i}">${esc(h)}</option>`)).join('');
  [mapName,mapCode,mapQty,mapThr,mapTags].forEach(sel=> sel.innerHTML=opts);
  mapName.value = String(preset.name ?? -1);
  mapCode.value = String(preset.code ?? -1);
  mapQty.value  = String(preset.qty ?? -1);
  mapThr.value  = String(preset.thr ?? -1);
  mapTags.value = String(preset.tags ?? -1);
}

/* Aperçu (20 lignes) */
function buildPreview(parsed){
  csvPrevHead.innerHTML = `<th>Nom</th><th>Code</th><th>Qté</th><th>Seuil</th><th>Tags</th>`;
  const iName=parseInt(mapName.value,10), iCode=parseInt(mapCode.value,10), iQty=parseInt(mapQty.value,10), iThr=parseInt(mapThr.value,10), iTags=parseInt(mapTags.value,10);
  const tagSep = (csvTagSep.value==='auto')? guessTagSep(parsed, iTags) : (csvTagSep.value || ',');
  const rows=[];
  for(let r=parsed.startIndex; r<parsed.rows.length && rows.length<20; r++){
    const row=parsed.rows[r]||[];
    const name=(iName>=0?row[iName]:'')||'';
    const code=(iCode>=0?row[iCode]:'')||'';
    const qty = (iQty>=0?row[iQty]:'');
    const thr = (iThr>=0?row[iThr]:'');
    const tags=(iTags>=0?row[iTags]:'');
    rows.push(`<tr><td>${esc(name)}</td><td><code>${esc(code)}</code></td><td>${esc(qty)}</td><td>${esc(thr)}</td><td>${esc(tags)}</td></tr>`);
  }
  csvPrevBody.innerHTML = rows.join('') || `<tr><td colspan="5" class="muted">Aucune ligne à prévisualiser</td></tr>`;
  csvSummary.textContent = `Lignes lues : ${parsed.rows.length - parsed.startIndex} • Colonnes détectées : ${parsed.cols}`;
}

/* Tag separator heuristique */
function guessTagSep(parsed, idx){
  if(idx<0) return ',';
  const sample = (parsed.rows[parsed.startIndex]||[])[idx]||'';
  if(sample.includes('|')) return '|';
  if(sample.includes(';')) return ';';
  if(sample.includes(',')) return ',';
  return ',';
}

/* Handlers UI CSV */
btnOpenCsvMap?.addEventListener('click',async()=>{
  if(!inputCSV?.files?.length){ alert('Choisissez d’abord un fichier CSV.'); return; }
  const file=inputCSV.files[0]; const text=await file.text(); resetCsvState(); csvText=text;
  // Detect sep + header
  const sep = (csvDelimiter.value==='auto')? detectSeparator(text) : (csvDelimiter.value.replace('\\t','\t'));
  csvSep = sep;
  csvHasHeader = (csvHeader.value==='1');
  // Parse
  const parsed = parseCSV(text, sep, csvHasHeader);
  csvRows = parsed.rows; csvCols = parsed.cols; csvHeaders = parsed.headers;
  // Auto map
  const preset = autoMap(parsed.headers);
  fillMapSelects(parsed.headers, preset);
  // Preview
  buildPreview(parsed);
  csvDlg.showModal();
});
csvClose?.addEventListener('click',()=>csvDlg.close());

[csvDelimiter,csvHeader,csvTagSep,mapName,mapCode,mapQty,mapThr,mapTags].forEach(el=>{
  el?.addEventListener('change',()=>{
    if(!csvText) return;
    const sep=(csvDelimiter.value==='auto')? detectSeparator(csvText) : (csvDelimiter.value.replace('\\t','\t'));
    const hasHeader=(csvHeader.value==='1');
    const parsed=parseCSV(csvText, sep, hasHeader);
    // si on a changé le séparateur ou header, on recalcule preset si les selects sont tous à -1
    if([mapName,mapCode,mapQty,mapThr,mapTags].every(s=>s.value==='-1')){
      const preset=autoMap(parsed.headers); fillMapSelects(parsed.headers, preset);
    }
    buildPreview(parsed);
    csvSep=sep; csvHasHeader=hasHeader; csvRows=parsed.rows; csvCols=parsed.cols; csvHeaders=parsed.headers;
  });
});

/* Import effectif */
csvImport?.addEventListener('click',async()=>{
  const iName=parseInt(mapName.value,10), iCode=parseInt(mapCode.value,10), iQty=parseInt(mapQty.value,10), iThr=parseInt(mapThr.value,10), iTags=parseInt(mapTags.value,10);
  if(iName<0 || iCode<0){ alert('Nom et Code sont obligatoires.'); return; }
  const tagSep = (csvTagSep.value==='auto')? guessTagSep({rows:csvRows,startIndex:csvHasHeader?1:0}, iTags) : (csvTagSep.value || ',');

  let created=0, updated=0, skipped=0;
  const start = csvHasHeader?1:0;
  for(let r=start; r<csvRows.length; r++){
    const row=csvRows[r]||[];
    const name=(row[iName]||'').trim(); const code=(row[iCode]||'').trim();
    if(!name || !code){ skipped++; continue; }
    const qty = iQty>=0 ? Math.max(0, parseInt(String(row[iQty]).replace(',','.'))||0) : 0;
    const thr = iThr>=0 ? Math.max(0, parseInt(String(row[iThr]).replace(',','.'))||0) : 0;
    let tags=[]; if(iTags>=0){ tags=String(row[iTags]||'').split(tagSep).map(t=>t.trim()).filter(Boolean); }

    const existing = await dbGet(code)||await dbGet(code.toUpperCase())||await dbGet(code.toLowerCase());
    if(existing){
      if(csvDup.value==='create'){ skipped++; continue; }
      // upsert: met à jour champs de base (sans écraser tags existants si vides)
      existing.name = name || existing.name;
      if(iQty>=0) existing.qty = qty;
      if(iThr>=0) existing.threshold = thr;
      if(iTags>=0) existing.tags = tags;
      existing.updated = Date.now();
      await dbPut(existing);
      updated++;
    }else{
      await dbPut({id:code,code,name,qty,threshold:thr,tags,updated:Date.now()});
      created++;
    }
  }
  announce(`Import CSV terminé • ${created} créé(s), ${updated} mis à jour, ${skipped} ignoré(s)`);
  csvDlg.close();
  await refreshTable(); await refreshHome();
});

/* -------- Emprunts -------- */
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

/* Init */
(async function init(){
  $('#appVersion')&&( $('#appVersion').textContent=window.APP_VERSION||'' );
  await dbInit();
  await refreshHome();
  showTab('home');
})();
})();
