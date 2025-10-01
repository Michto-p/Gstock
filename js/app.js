/* Gstock - app.js v2.1.8 (Accueil + KPIs) */
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
const sections={
  home:$('#tab-home'),
  items:$('#tab-items'),
  scanner:$('#tab-scanner'),
  labels:$('#tab-labels'),
  journal:$('#tab-journal'),
  gear:$('#tab-gear'),
  settings:$('#tab-settings')
};
tabs.forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
async function showTab(name){
  Object.entries(sections).forEach(([k,el])=>el&&(el.hidden=k!==name));
  tabs.forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  if(name==='home')await refreshHome();
  if(name==='items')await refreshTable();
  if(name==='labels')await refreshLabelItems();
  if(name==='journal')await refreshJournal();
  if(name==='gear')await refreshLoansTable();
  if(name==='settings')initSettingsPanel();
}
document.addEventListener('keydown',e=>{
  if(e.ctrlKey&&e.key.toLowerCase()==='k'){e.preventDefault();$('#searchItems')?.focus();}
  if(e.key.toLowerCase()==='a')openAdjustDialog({type:'add'});
  if(e.key.toLowerCase()==='r')openAdjustDialog({type:'remove'});
});

/* ---- Générer un code depuis le nom (déjà utilisé ailleurs) ---- */
function deaccent(s){ try{ return s.normalize('NFD').replace(/\p{Diacritic}/gu,''); }catch(_){ return s; } }
function nameToCode(name){
  const stop = new Set(['le','la','les','des','du','de','d','l','un','une','pour','et','sur','avec','en','à','au','aux','the','of','for']);
  const parts = deaccent(String(name)).replace(/[^A-Za-z0-9]+/g,' ').trim().split(/\s+/);
  if(parts.length===0) return 'ITM-'+Math.floor(100000+Math.random()*899999);
  let brand = parts.length>1 ? parts[parts.length-1] : '';
  let brandShort = brand ? (brand.slice(0,3).toLowerCase()) : '';
  brandShort = brandShort ? (brandShort[0].toUpperCase()+brandShort.slice(1)) : '';
  const base=[];
  for(let i=0;i<parts.length-(brand?1:0);i++){
    const t=parts[i]; const lower=t.toLowerCase(); if(stop.has(lower)) continue;
    if(/^\d+$/.test(t)){ base.push(t); continue; }
    if(t.length>=4) base.push(t.slice(0,4).toLowerCase());
    else if(t.length>=2) base.push(t.toLowerCase());
  }
  return (base.join('') + brandShort);
}
async function generateCodeFromName(name){
  const base = nameToCode(name);
  let candidate = base; let n=2;
  while(await dbGet(candidate) || await dbGet(candidate.toUpperCase()) || await dbGet(candidate.toLowerCase())){
    candidate = `${base}-${n++}`;
  }
  return candidate;
}

/* ---------- Accueil ---------- */
async function refreshHome(){
  const items = await dbList();
  const settings = await dbGetSettings();
  const buffer = (settings?.buffer|0);

  const totalItems = items.length;
  const totalQty = items.reduce((s,i)=>s+(i.qty|0),0);
  const under = items.filter(i=>(i.qty|0)<=(i.threshold|0)).length;
  const low = items.filter(i=>(i.qty|0)>(i.threshold|0) && ((i.qty|0)-(i.threshold|0))<=buffer).length;

  $('#kpiItems')&&( $('#kpiItems').textContent = String(totalItems) );
  $('#kpiQty')&&( $('#kpiQty').textContent = String(totalQty) );
  $('#kpiUnder')&&( $('#kpiUnder').textContent = String(under) );
  $('#kpiLow')&&( $('#kpiLow').textContent = String(low) );

  // Emprunts
  const loans = await dbListLoans(true);
  const overdue = loans.filter(l=>!l.returnedAt && Date.now()>new Date(l.due).getTime()).length;
  $('#kpiLoansActive')&&( $('#kpiLoansActive').textContent = String(loans.length) );
  $('#kpiLoansOverdue')&&( $('#kpiLoansOverdue').textContent = String(overdue) );

  // Derniers mouvements
  const recent = await dbListMoves({from:0,to:Infinity,limit:8});
  const ul = $('#recentMoves');
  if(ul){
    ul.innerHTML = (recent.slice(0,8).map(m=>{
      const d=new Date(m.ts); const dt=d.toLocaleString();
      const type=(m.type||'').replace('_',' ');
      return `<li><span>${dt} • <strong>${esc(type)}</strong> <code>${esc(m.code)}</code> ×${m.qty}</span><span class="muted">${esc(m.name||'')}</span></li>`;
    }).join('')) || '<li class="muted">Aucun mouvement récent</li>';
  }

  // Mini bar-chart sorties des 7 derniers jours
  drawUsageSpark(await buildUsage7d());
}
async function buildUsage7d(){
  const now=Date.now();
  const from = now - 7*24*3600*1000;
  const moves = await dbListMoves({from,to:now,limit:5000});
  const days = Array.from({length:7},(_,i)=>{ const start=from + i*24*3600*1000; const end=start+24*3600*1000-1; return {start,end,exit:0,entry:0}; });
  for(const m of moves){
    const idx = Math.floor((m.ts - from)/(24*3600*1000));
    if(idx>=0 && idx<7){
      if(m.type==='EXIT') days[idx].exit += (m.qty|0);
      if(m.type==='ENTRY') days[idx].entry += (m.qty|0);
    }
  }
  return days;
}
function drawUsageSpark(days){
  const svg=$('#sparkUsage'); if(!svg) return;
  const W=200, H=48, pad=6; svg.setAttribute('viewBox',`0 0 ${W} ${H}`); svg.innerHTML='';
  const max=Math.max(1,...days.map(d=>d.exit));
  const barW=(W-2*pad)/days.length-2;
  days.forEach((d,i)=>{
    const h = Math.round((d.exit/max)*(H-2*pad));
    const x = pad + i*((W-2*pad)/days.length);
    const y = H-pad-h;
    const r=document.createElementNS('http://www.w3.org/2000/svg','rect');
    r.setAttribute('x',String(x)); r.setAttribute('y',String(y));
    r.setAttribute('width',String(barW)); r.setAttribute('height',String(h||1));
    r.setAttribute('rx','2'); r.setAttribute('fill','currentColor');
    svg.appendChild(r);
  });
}

/* ---------- Articles ---------- */
const itemsTbody=$('#itemsTbody'), searchItems=$('#searchItems'), filterStatus=$('#filterStatus'), filterTag=$('#filterTag');
$('#btnAddItem')?.addEventListener('click',async()=>{
  const name=prompt('Nom de l’article ?'); if(!name)return;
  let code=prompt('Code (laisser vide pour auto à partir du nom)')||''; if(!code){ code = await generateCodeFromName(name); }
  const qty=parseInt(prompt('Quantité initiale ?','0')||'0',10);
  const threshold=parseInt(prompt('Seuil d’alerte ?','0')||'0',10);
  const tags=(prompt('Tags (séparés par des virgules)')||'').split(',').map(t=>t.trim()).filter(Boolean);
  await dbPut({id:code,code,name,qty,threshold,tags,updated:Date.now()});
  announce(`Article créé • code: ${code}`); await refreshTable(); await refreshHome();
});
searchItems?.addEventListener('input',refreshTable); filterStatus?.addEventListener('change',refreshTable); filterTag?.addEventListener('change',refreshTable);
function statusBadge(it,buffer=0){ const s=(it.qty|0)-(it.threshold|0); if((it.qty|0)<=(it.threshold|0))return `<span class="badge under">Sous seuil</span>`;
  if(s<=(buffer|0))return `<span class="badge low">Approche</span>`; return `<span class="badge ok">OK</span>`; }
async function refreshTable(){
  const q=(searchItems?.value||'').toLowerCase(), tag=filterTag?.value||'', st=filterStatus?.value||'', buffer=(await dbGetSettings()).buffer|0;
  const list=await dbList(); const allTags=new Set(); list.forEach(i=>(i.tags||[]).forEach(t=>allTags.add(t)));
  if(filterTag){ const cur=filterTag.value; filterTag.innerHTML=`<option value="">Tous tags</option>`+[...allTags].map(t=>`<option ${t===cur?'selected':''}>${esc(t)}</option>`).join(''); }
  const rows=list.filter(it=>{ const inQ=!q||[it.name,it.code,(it.tags||[]).join(' ')].join(' ').toLowerCase().includes(q);
    const inTag=!tag||(it.tags||[]).includes(tag); let stOK=true;
    if(st==='ok')stOK=(it.qty>it.threshold && (it.qty-it.threshold)>(buffer|0));
    if(st==='low')stOK=(it.qty>it.threshold && (it.qty-it.threshold)<=(buffer|0));
    if(st==='under')stOK=(it.qty<=it.threshold);
    return inQ&&inTag&&stOK;
  }).map(it=>`<tr>
    <td>${esc(it.name)}</td><td><code>${esc(it.code)}</code></td>
    <td>${it.qty}</td><td>${it.threshold}</td>
    <td>${(it.tags||[]).map(t=>`<span class="pill">${esc(t)}</span>`).join(' ')}</td>
    <td>${statusBadge(it,buffer)}</td>
    <td><button class="btn" data-act="adj" data-code="${it.code}">Ajuster</button>
        <button class="btn" data-act="hist" data-code="${it.code}">Historique</button>
        <button class="btn danger" data-act="del" data-code="${it.code}">Suppr.</button></td>
  </tr>`).join('');
  itemsTbody && (itemsTbody.innerHTML=rows||`<tr><td colspan="7" class="muted">Aucun article</td></tr>`);
  itemsTbody?.querySelectorAll('button[data-act]').forEach(btn=>{ const code=btn.dataset.code;
    if(btn.dataset.act==='adj')btn.onclick=()=>openAdjustDialog({code});
    if(btn.dataset.act==='hist')btn.onclick=()=>openHistory(code);
    if(btn.dataset.act==='del')btn.onclick=async()=>{ if(confirm('Supprimer cet article ?')){ await dbDelete(code); await refreshTable(); await refreshHome(); } };
  });
}
async function openHistory(code){ const item=(await dbGet(code))||(await dbGet(code.toUpperCase()))||(await dbGet(code.toLowerCase()));
  const moves=await dbListMoves({code:item?.code||code,limit:100}); const loans=await dbListLoansByCode(item?.code||code);
  alert(`Historique "${item?.name||code}"\n\nMouvements: ${moves.length}\nEmprunts (actifs+clos): ${loans.length}`); }

/* ---------- Ajustement ---------- */
const dlg=$('#adjustDialog'), dlgType=$('#dlgType'), dlgQty=$('#dlgQty'), dlgNote=$('#dlgNote'), dlgItem=$('#dlgItem');
$('#dlgClose')?.addEventListener('click',()=>dlg?.close()); $('#dlgValidate')?.addEventListener('click',onValidateAdjust);
let dlgState={code:null,name:null};
async function openAdjustDialog({code=null,type='add'}={}){ if(!code)code=prompt('Code article ?'); if(!code)return;
  const item=(await dbGet(code))||(await dbGet(code.toUpperCase()))||(await dbGet(code.toLowerCase())); if(!item)return alert('Article introuvable');
  dlgState.code=item.code; dlgState.name=item.name; dlgType&&(dlgType.value=type); dlgQty&&(dlgQty.value=1); dlgNote&&(dlgNote.value='');
  dlgItem&&(dlgItem.textContent=`${item.name} (${item.code}) — Stock actuel: ${item.qty}`); dlg?.showModal();
}
async function onValidateAdjust(){ const type=dlgType.value; const qty=Math.max(1,parseInt(dlgQty.value||'1',10)); const note=dlgNote.value||'';
  const item=await dbGet(dlgState.code); if(!item)return dlg?.close();
  const delta=(type==='add')?qty:-qty; await dbAdjustQty(item.code,delta);
  await dbAddMove({ts:Date.now(),type:(type==='add'?'ENTRY':'EXIT'),code:item.code,name:item.name,qty,note});
  announce(`${type==='add'?'Ajout':'Retrait'}: ${qty} → ${item.name}`); dlg?.close(); await refreshTable(); await refreshHome();
}

/* ---------- Étiquettes ---------- */
const labelsPreview=$('#labelsPreview');
$('#btnLabelsAll')?.addEventListener('click',()=>renderSheet('all'));
$('#btnLabelsSelected')?.addEventListener('click',async()=>{ const code=prompt('Code article ?'); if(!code)return; await renderSheet('one',code); });
$('#btnLabelsPrintA4')?.addEventListener('click',async()=>{ if(!labelsPreview||!labelsPreview.firstElementChild)await renderSheet('all'); window.print(); });
async function renderSheet(mode='all',code=null){
  const items=(mode==='all')?await dbList():[await dbGet(code)||await dbGet(code?.toUpperCase())||await dbGet(code?.toLowerCase())].filter(Boolean);
  const frag=document.createDocumentFragment();
  items.forEach(it=>{
    const card = document.createElement('div'); card.className='label-card';
    const name = document.createElement('div'); name.className='name'; name.textContent=it.name; card.appendChild(name);
    const hr = document.createElement('div'); hr.className='hr'; hr.textContent=it.code; card.appendChild(hr);
    const svg = (window.code39?.svg && window.code39.svg(it.code,{module:2,height:52,margin:4,showText:false})) || document.createElementNS('http://www.w3.org/2000/svg','svg');
    card.appendChild(svg); frag.appendChild(card);
  });
  if(labelsPreview){ labelsPreview.classList.add('labels-sheet'); labelsPreview.innerHTML=''; labelsPreview.appendChild(frag); }
  announce('Planche étiquettes Code 39 générée (scannable).');
}
async function refreshLabelItems(){}

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

/* ---------- Import / Export / Paramètres ---------- */
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
$('#btnSaveSettings')?.addEventListener('click',async()=>{ const buffer=Math.max(0,parseInt($('#inputBuffer')?.value||'0',10)); const defaultTags=($('#inputDefaultTags')?.value||'').split(',').map(t=>t.trim()).filter(Boolean); await dbSetSettings({buffer,defaultTags}); announce('Paramètres enregistrés'); await refreshTable(); await refreshHome(); });
$('#btnLoadDemo')?.addEventListener('click',async()=>{ try{ const res=await fetch('data/demo.json',{cache:'no-store'}); if(!res.ok)throw new Error('data/demo.json introuvable'); const data=await res.json(); await dbImportFull(data); announce('Mini base de démo chargée'); await refreshTable(); await refreshJournal(); await refreshLoansTable(); await refreshHome(); }catch(e){ console.warn(e); alert('Impossible de charger la démo : '+e.message); }});

/* ---------- Scanner ---------- */
const scanVideo=$('#scanVideo'), scanHint=$('#scanHint'), btnScanStart=$('#btnScanStart'), btnScanStop=$('#btnScanStop'), btnScanTorch=$('#btnScanTorch'); let scanning=false;
window.addEventListener('gstock:scan-unknown',ev=>{ const code=ev.detail.code; scanHint&&(scanHint.textContent=`Code ${code} inconnu — continuez à viser un article enregistré.`); });
btnScanStart?.addEventListener('click',async()=>{ if(scanning)return;
  if(typeof window.scanUntilKnown!=='function'){ alert('Module de scan non chargé.\nVérifiez que js/barcode.js est bien inclus AVANT js/app.js (et videz le cache PWA).'); return; }
  scanning=true; btnScanStart.disabled=true; scanHint&&(scanHint.textContent='Visez le code-barres. Les codes inconnus ne ferment pas la caméra.');
  try{ const code=await window.scanUntilKnown(scanVideo,{confirmFrames:1}); if(!scanning)return; if(code)openAdjustDialog({code}); }
  catch(e){ console.warn(e); alert('Le scan a échoué ou a été annulé.'); }
  finally{ scanning=false; btnScanStart.disabled=false; }
});
btnScanStop?.addEventListener('click',async()=>{ scanning=false; try{ await window.stopScan?.(); }catch(_){} scanHint&&(scanHint.textContent='Scan arrêté.'); btnScanStart.disabled=false; });
btnScanTorch?.addEventListener('click',()=>window.toggleTorch?.());

/* ---------- Accueil : actions rapides ---------- */
$('#qaScan')?.addEventListener('click',()=>{ showTab('scanner'); $('#btnScanStart')?.click(); });
$('#qaAdd')?.addEventListener('click',()=>{ showTab('items'); $('#btnAddItem')?.click(); });
$('#qaLabels')?.addEventListener('click',()=>{ showTab('labels'); });
$('#qaExport')?.addEventListener('click',()=>{ $('#btnExportFull')?.click(); });

/* Utils */
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function downloadFile(name,data,type){ const blob=new Blob([data],{type}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),5000); }
function announce(msg){ sr&&(sr.textContent=''); setTimeout(()=>{ sr&&(sr.textContent=msg); },10); }

/* Init */
(async function init(){
  $('#appVersion')&&( $('#appVersion').textContent=window.APP_VERSION||'' );
  await dbInit();
  await refreshHome();
  showTab('home');
})();
})();
