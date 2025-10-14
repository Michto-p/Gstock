/* Gstock - app.js v2.9.0 (éditer + dupliquer + scan case-insensitive) */
(function(){'use strict';

/* --- utilitaires DOM / divers --- */
function $(s,r){return (r||document).querySelector(s);}
function $$(s,r){return Array.from((r||document).querySelectorAll(s));}
function show(el,on){ if(!el) return; el.hidden = !on; }
var sr=$('#sr');
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function announce(msg){ if(sr){ sr.textContent=''; setTimeout(()=>{ sr.textContent=msg; },10);} }
function downloadFile(name,data,type){ var blob=new Blob([data],{type:type}); var url=URL.createObjectURL(blob); var a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),3000); }
function debounced(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }

/* --- SAFE MODE via ?safe=1 --- */
(async () => {
  try {
    const qs = new URLSearchParams(location.search);
    if (qs.has('safe')) {
      try { await (window.dbNuke ? window.dbNuke(false) : Promise.resolve()); } catch(e){}
      try { const regs = await (navigator.serviceWorker?.getRegistrations?.() || []); await Promise.all(regs.map(r => r.unregister())); } catch(e){}
      try { const keys = await (caches?.keys?.() || []); await Promise.all(keys.map(k => caches.delete(k))); } catch(e){}
      location.replace(location.pathname + '?bust=' + Date.now());
      return;
    }
  } catch (e) {}
})();

/* --- Thème --- */
var themeToggle=$('#themeToggle');
if(themeToggle){
  themeToggle.value=(localStorage.getItem('gstock.theme')||'auto');
  function applyTheme(){
    var v=themeToggle.value; localStorage.setItem('gstock.theme',v);
    if(v==='auto'){ var d=matchMedia('(prefers-color-scheme: dark)').matches; document.documentElement.setAttribute('data-theme',d?'dark':'light'); }
    else document.documentElement.setAttribute('data-theme',v);
  }
  themeToggle.addEventListener('change',applyTheme); applyTheme();
}

/* --- Onglets --- */
var sections={home:$('#tab-home'),stock:$('#tab-stock'),atelier:$('#tab-atelier'),scanner:$('#tab-scanner'),labels:$('#tab-labels'),journal:$('#tab-journal'),gear:$('#tab-gear'),settings:$('#tab-settings')};
$$('nav button[data-tab]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
function showTab(name){
  Object.keys(sections).forEach(k=>sections[k] && (sections[k].hidden=(k!==name)));
  $$('nav button[data-tab]').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  if(name==='home') refreshHome();
  if(name==='stock') refreshTable('stock');
  if(name==='atelier') refreshTable('atelier');
  if(name==='labels') initLabelsPanel();
  if(name==='journal') refreshJournal();
  if(name==='gear') refreshLoansTable();
  if(name==='settings') initSettingsPanel();
}

/* --- helpers de codes --- */
function deaccent(s){ try{return s.normalize('NFD').replace(/\p{Diacritic}/gu,'');}catch(_){return s;} }
function nameToCode(name){
  var stop=new Set(['le','la','les','des','du','de','d','l','un','une','pour','et','sur','avec','en','à','au','aux','the','of','for']);
  var parts=deaccent(String(name)).replace(/[^A-Za-z0-9]+/g,' ').trim().split(/\s+/);
  if(!parts.length) return 'ITM-'+Math.floor(100000+Math.random()*899999);
  var brand=parts.length>1?parts[parts.length-1]:'';
  var brandShort=brand?(brand.slice(0,3).toLowerCase()):'';
  brandShort=brandShort?(brandShort[0].toUpperCase()+brandShort.slice(1)):'';
  var base=[]; for(let i=0;i<parts.length-(brand?1:0);i++){ let t=parts[i], low=t.toLowerCase(); if(stop.has(low))continue; if(/^\d+$/.test(t)){base.push(t);continue;} base.push((t.length>=4?t.slice(0,4):t).toLowerCase()); }
  return base.join('')+brandShort;
}
async function generateCodeFromName(name){ var base=nameToCode(name); var c=base, n=2; while(await dbGet(c)) c=base+'-'+(n++); return c; }

/* --- recherche case-insensitive du code (scan/saisie) --- */
async function getByCodeAnyCase(raw) {
  if (!raw) return null;
  const exact = await dbGet(raw);
  if (exact) return exact;
  const low = raw.toLowerCase();
  const all = await dbList();
  return all.find(i => (i.code || '').toLowerCase() === low) || null;
}

/* --- Accueil --- */
async function refreshHome(){
  var items=await dbList();
  var set=await dbGetSettings(); var buf=(set&&set.buffer|0);
  $('#kpiItems').textContent=String(items.length);
  $('#kpiQty').textContent=String(items.reduce((s,i)=>s+(i.qty|0),0));
  $('#kpiUnder').textContent=String(items.filter(i=>(i.qty|0)<=(i.threshold|0)).length);
  $('#kpiLow').textContent=String(items.filter(i=> (i.qty|0)>(i.threshold|0) && ((i.qty|0)-(i.threshold|0))<=buf ).length);
  var loans=await dbListLoans(true); var overdue=loans.filter(l=>!l.returnedAt && Date.now()>new Date(l.due).getTime()).length;
  $('#kpiLoansActive').textContent=String(loans.filter(l=>!l.returnedAt).length);
  $('#kpiLoansOverdue').textContent=String(overdue);
  var recent=await dbListMoves({from:0,to:Infinity,limit:8});
  var ul=$('#recentMoves');
  ul.innerHTML=(recent.map(m=>`<li>${new Date(m.ts).toLocaleString()} • <strong>${esc(m.type)}</strong> <code>${esc(m.code)}</code> ×${m.qty}</li>`).join(''))||'<li class="muted">Aucun mouvement</li>';
}

/* --- statuts --- */
function ensureType(it){ return it.type||'stock'; }
function statusBadge(it, buffer){
  var qty=(it.qty|0), thr=(it.threshold|0), diff=qty-thr;
  if(qty===0) return '<span class="badge under" title="Épuisé">Épuisé</span>';
  if(qty<=thr) return '<span class="badge under" title="Sous seuil">Sous seuil</span>';
  if(diff<=((buffer|0))) return '<span class="badge low" title="Approche">Approche</span>';
  return '<span class="badge ok" title="OK">OK</span>';
}

/* --- Tables Stock/Atelier --- */
var state={ stock:{q:'',status:'',tag:'',loc:''}, atelier:{q:'',status:'',tag:'',loc:''} };
var els={
  stock:{ tbody:$('#stockTbody'), search:$('#stockSearch'), status:$('#stockStatus'), tag:$('#stockTag'), loc:$('#stockLoc'), btnAdd:$('#btnAddStock'), btnClear:$('#stockClear') },
  atelier:{ tbody:$('#atelierTbody'), search:$('#atelierSearch'), status:$('#atelierStatus'), tag:$('#atelierTag'), loc:$('#atelierLoc'), btnAdd:$('#btnAddAtelier'), btnClear:$('#atelierClear') }
};
Object.keys(els).forEach(type=>{
  var e=els[type];
  e.search && e.search.addEventListener('input',debounced(()=>{ state[type].q=e.search.value||''; refreshTable(type); },120));
  e.status && e.status.addEventListener('change',()=>{ state[type].status=e.status.value||''; refreshTable(type); });
  e.tag && e.tag.addEventListener('change',()=>{ state[type].tag=e.tag.value||''; refreshTable(type); });
  e.loc && e.loc.addEventListener('change',()=>{ state[type].loc=e.loc.value||''; refreshTable(type); });
  e.btnClear && e.btnClear.addEventListener('click',()=>{ state[type]={q:'',status:'',tag:'',loc:''}; ['search','status','tag','loc'].forEach(k=>e[k]&&(e[k].value='')); refreshTable(type); });
  e.btnAdd && e.btnAdd.addEventListener('click',()=>openNewDialog(type));
});
function barcodeInline(code){
  try{
    if(window.code39 && typeof window.code39.svg==='function'){
      var svg = window.code39.svg(code, {module:1.6, height:34, margin:0, showText:false, fontSize:9});
      return svg && (svg.outerHTML || new XMLSerializer().serializeToString(svg));
    }
  }catch(_){}
  return '<code>'+esc(code)+'</code>';
}
async function refreshTable(type){
  var e=els[type]; if(!e||!e.tbody) return;
  var set=await dbGetSettings(); var buffer=(set&&set.buffer|0);
  var all=(await dbList()).map(i=>Object.assign({},i,{type:ensureType(i)})).filter(i=>i.type===type);

  var tagsSet=new Set(), locSet=new Set();
  all.forEach(i=>{ (i.tags||[]).forEach(t=>tagsSet.add(t)); if(i.location) locSet.add(i.location); });
  var curTag=(e.tag&&e.tag.value)||''; var curLoc=(e.loc&&e.loc.value)||'';
  if(e.tag) e.tag.innerHTML='<option value="">Tous tags</option>'+Array.from(tagsSet).sort().map(t=>`<option ${t===curTag?'selected':''}>${esc(t)}</option>`).join('');
  if(e.loc) e.loc.innerHTML='<option value="">Tous emplacements</option>'+Array.from(locSet).sort().map(l=>`<option ${l===curLoc?'selected':''}>${esc(l)}</option>`).join('');
  show(e.tag, tagsSet.size>0); show(e.loc, locSet.size>0);

  var q=(state[type].q||'').toLowerCase(), st=state[type].status||'', tag=state[type].tag||'', loc=state[type].loc||'';
  var filtered=all.filter(it=>{
    var inQ=!q||[it.name,(it.ref||''),it.code,(it.tags||[]).join(' '),it.location||'',(it.links||[]).join(' ')].join(' ').toLowerCase().includes(q);
    var inTag=!tag||(it.tags||[]).indexOf(tag)>=0;
    var inLoc=!loc||((it.location||'')===loc);
    var stOK=true;
    if(st==='ok') stOK=(it.qty>it.threshold && (it.qty-it.threshold)>(buffer|0));
    if(st==='low') stOK=(it.qty>it.threshold && (it.qty-it.threshold)<=(buffer|0));
    if(st==='under') stOK=(it.qty<=it.threshold);
    return inQ&&inTag&&inLoc&&stOK;
  });

  e.tbody.innerHTML = filtered.map(it=>{
    var qtyCell = `<div style="display:flex;gap:.3rem;align-items:center">
      <button class="btn" data-qa="-1" data-code="${esc(it.code)}" title="Retirer 1">-1</button>
      <strong>${(it.qty|0)}</strong>
      ${statusBadge(it, buffer)}
      <button class="btn" data-qa="+1" data-code="${esc(it.code)}" title="Ajouter 1">+1</button>
    </div>`;
    var tags = (it.tags||[]).map(t=>`<span class="pill">${esc(t)}</span>`).join(' ');
    var linksBtn = (it.links&&it.links.length) ? `<button class="btn" data-act="link" data-code="${esc(it.code)}">🔗 ${it.links.length}</button>` : '<span class="muted">—</span>';

    return `<tr>
      <td>${esc(it.name)}</td>
      <td><code>${esc(it.ref||it.code)}</code></td>
      <td class="barcode">${barcodeInline(it.code)}</td>
      <td>${qtyCell}</td>
      <td>${(it.threshold|0)}</td>
      <td>${tags}</td>
      <td>${esc(it.location||'')}</td>
      <td>${linksBtn}</td>
      <td>
        <button class="btn" data-act="adj"  data-code="${esc(it.code)}">Ajuster…</button>
        <button class="btn" data-act="edit" data-code="${esc(it.code)}">✏️ Éditer</button>
        <button class="btn" data-act="dup"  data-code="${esc(it.code)}">📄 Dupliquer</button>
        <button class="btn danger" data-act="del" data-code="${esc(it.code)}">Suppr.</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" class="muted">Aucun élément</td></tr>';

  e.tbody.querySelectorAll('button[data-act]').forEach(btn=>{
    var code=btn.dataset.code;
    if(btn.dataset.act==='adj')  btn.onclick=()=>openAdjustDialog({code});
    if(btn.dataset.act==='hist') btn.onclick=()=>openHistory(code); // (si utilisé ailleurs)
    if(btn.dataset.act==='link') btn.onclick=()=>openLinks(code);
    if(btn.dataset.act==='edit') btn.onclick=()=>openEditDialog(code);
    if(btn.dataset.act==='dup')  btn.onclick=()=>openDuplicateDialog(code);
    if(btn.dataset.act==='del')  btn.onclick=async()=>{ if(confirm('Supprimer cet élément ?')){ await dbDelete(code); await refreshTable(type); announce('Élément supprimé'); } };
  });
  e.tbody.querySelectorAll('button[data-qa]').forEach(btn=>{
    btn.onclick=async()=>{
      var code=btn.dataset.code; var delta=(btn.dataset.qa==='+1')?+1:-1;
      var it=(await dbGet(code)); if(!it) return;
      await dbAdjustQty(it.code,delta);
      await dbAddMove({ts:Date.now(),type:(delta>0?'ENTRY':'EXIT'),code:it.code,name:it.name,qty:Math.abs(delta),note:'ajustement rapide ('+ensureType(it)+')'});
      announce((delta>0?'+1':'-1')+' → '+it.name); await refreshTable(type); await refreshHome();
    };
  });
}
async function openHistory(code){
  var item=(await dbGet(code));
  var moves=await dbListMoves({code:(item&&item.code)||code,limit:100});
  var loans=(typeof dbListLoansByCode==='function') ? (await dbListLoansByCode((item&&item.code)||code)) : [];
  alert('Historique "'+((item&&item.name)||code)+'"\n\nMouvements: '+moves.length+'\nEmprunts (actifs+clos): '+loans.length);
}
async function openLinks(code){
  var it=await dbGet(code); var links=(it&&it.links)||[]; if(!links.length) return;
  if(links.length===1){ window.open(links[0],'_blank'); return; }
  var s=prompt('Ouvrir lien (1-'+links.length+') :\n'+links.map((u,i)=>(i+1)+'. '+u).join('\n'));
  var idx=((parseInt(s||'0',10)-1)|0); if(links[idx]) window.open(links[idx],'_blank');
}

/* --- Ajustement --- */
var dlg=$('#adjustDialog'), dlgType=$('#dlgType'), dlgQty=$('#dlgQty'), dlgNote=$('#dlgNote'), dlgItem=$('#dlgItem');
var dlgState={code:null};
$('#dlgClose')?.addEventListener('click',()=>dlg?.close());
$('#dlgValidate')?.addEventListener('click',onValidateAdjust);
async function openAdjustDialog(opts){
  opts=opts||{}; var code=opts.code||null, type=opts.type||'add';
  if(!code){ code=prompt('Code ?'); if(!code) return; }
  var item=(await getByCodeAnyCase(code)); if(!item){ alert('Introuvable'); return; }
  dlgState.code=item.code; dlgType && (dlgType.value=type); dlgQty && (dlgQty.value=1); dlgNote && (dlgNote.value=''); dlgItem && (dlgItem.textContent=`${item.name} (${item.ref||item.code}) — Stock actuel: ${item.qty}`);
  dlg && dlg.showModal && dlg.showModal();
}
async function onValidateAdjust(){
  var type=dlgType?dlgType.value:'add'; var qty=Math.max(1,parseInt((dlgQty&&dlgQty.value)||'1',10)); var note=(dlgNote&&dlgNote.value)||'';
  var item=await dbGet(dlgState.code); if(!item){ dlg?.close(); return; }
  var delta=(type==='add')?qty:-qty;
  await dbAdjustQty(item.code,delta);
  await dbAddMove({ts:Date.now(),type:(type==='add'?'ENTRY':'EXIT'),code:item.code,name:item.name,qty:qty,note:note});
  announce((type==='add'?'Ajout':'Retrait')+': '+qty+' → '+item.name);
  dlg?.close(); await refreshTable(ensureType(item)); await refreshHome();
}

/* --- Création / Édition / Duplication --- */
var newItemDialog=$('#newItemDialog');
var niTitle=$('#niTitle'), niType=$('#niType'), niName=$('#niName'), niRef=$('#niRef'), niCode=$('#niCode'),
    niQty=$('#niQty'), niThr=$('#niThr'), niLocSelect=$('#niLocSelect'), niLocCustom=$('#niLocCustom'),
    niLocCustomWrap=$('#niLocCustomWrap'), niLocChips=$('#niLocChips'),
    niTagChecks=$('#niTagChecks'), niTagsExtra=$('#niTagsExtra'), niTagCat=$('#niTagCategory'),
    niLinks=$('#niLinks');

var niMode = 'create';       // 'create' | 'edit' | 'duplicate'
var niOriginalCode = null;   // code d'origine en édition

$('#niGen')?.addEventListener('click',async ()=>{
  var n=niName && niName.value.trim(); if(!n) return;
  var refSug=nameToCode(n);
  if(niRef && !niRef.value.trim()) niRef.value=refSug;
  if(niCode && !niCode.value.trim()) niCode.value=refSug;
});
niName && niName.addEventListener('blur',async ()=>{
  var n=niName.value.trim(); if(!n) return;
  if(niRef && !niRef.value.trim()) niRef.value=nameToCode(n);
  if(niCode && !niCode.value.trim()) niCode.value=await generateCodeFromName(n);
});
$('#niCopyRefToCode')?.addEventListener('click',()=>{
  if(niRef && niCode){ var v=(niRef.value||'').trim(); if(v) niCode.value=v; }
});
$('#niTagsClear')?.addEventListener('click',()=>{ niTagChecks && niTagChecks.querySelectorAll('input[type="checkbox"]').forEach(cb=>cb.checked=false); });

async function openNewDialog(type){
  type=type||'stock';
  niMode='create'; niOriginalCode=null;

  niType && (niType.value=type);
  niTitle && (niTitle.textContent=(type==='atelier'?'Nouveau matériel (Atelier)':'Nouvel article (Stock)'));
  niTagCat && (niTagCat.textContent=(type==='atelier'?'Atelier':'Stock'));

  var items=await dbList();
  var locsExisting=Array.from(new Set(items.map(i=>i.location).filter(Boolean))).sort();
  var set=await dbGetSettings();
  var defaultsLocs=(type==='atelier'?((set&&set.defaultLocationsAtelier)||[]):((set&&set.defaultLocationsStock)||[]));
  var defaultsTags=(type==='atelier'?((set&&set.defaultTagsAtelier)||[]):((set&&set.defaultTagsStock)||[]));

  var combined=Array.from(new Set([].concat(defaultsLocs, locsExisting))).filter(Boolean);
  if(niLocSelect){
    var opts=['<option value="">— Sélectionner —</option>'].concat(combined.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`)).concat(['<option value="__custom__">➕ Saisir personnalisé…</option>']);
    niLocSelect.innerHTML=opts.join('');
    niLocSelect.value='';
    niLocCustomWrap && (niLocCustomWrap.hidden=true);
    niLocCustom && (niLocCustom.value='');
    niLocSelect.onchange=()=>{ if(niLocSelect.value==='__custom__'){ niLocCustomWrap.hidden=false; niLocCustom?.focus(); } else { niLocCustomWrap.hidden=true; } };
  }
  if(niLocChips){
    niLocChips.innerHTML=(defaultsLocs||[]).map(l=>`<button type="button" class="chip" data-loc="${esc(l)}">${esc(l)}</button>`).join('');
    niLocChips.querySelectorAll('button[data-loc]').forEach(b=>{
      b.addEventListener('click',()=>{
        var val=b.getAttribute('data-loc')||'';
        var opt=niLocSelect?niLocSelect.querySelector('option[value="'+val.replace(/"/g,'&quot;')+'"]'):null;
        if(niLocSelect && opt){ niLocSelect.value=val; niLocCustomWrap && (niLocCustomWrap.hidden=true); }
        else { niLocSelect && (niLocSelect.value='__custom__'); niLocCustomWrap && (niLocCustomWrap.hidden=false); niLocCustom && (niLocCustom.value=val); niLocCustom?.focus(); }
      });
    });
  }
  niTagChecks && (niTagChecks.innerHTML=(defaultsTags.length?defaultsTags:[]).map(t=>`<label class="chip"><input type="checkbox" value="${esc(t)}"> ${esc(t)}</label>`).join('') || '<span class="muted">Aucun tag prédéfini (Paramètres)</span>');

  niName&&(niName.value=''); niRef&&(niRef.value=''); niCode&&(niCode.value=''); if(niCode){ niCode.readOnly=false; niCode.title=''; }
  niQty&&(niQty.value='0'); niThr&&(niThr.value='0'); niTagsExtra&&(niTagsExtra.value=''); niLinks&&(niLinks.value='');
  newItemDialog && newItemDialog.showModal && newItemDialog.showModal(); setTimeout(()=>niName?.focus(),0);
}
$('#btnAddStock')?.addEventListener('click',()=>openNewDialog('stock'));
$('#btnAddAtelier')?.addEventListener('click',()=>openNewDialog('atelier'));

/* --- Éditer --- */
async function openEditDialog(code){
  const it = await dbGet(code);
  if(!it){ alert('Introuvable'); return; }
  niMode = 'edit';
  niOriginalCode = it.code;

  niType && (niType.value = it.type || 'stock');
  niTitle && (niTitle.textContent = 'Éditer l’article');
  niName && (niName.value = it.name || '');
  niRef && (niRef.value = it.ref || it.code || '');
  niCode && (niCode.value = it.code || '');
  if(niCode){ niCode.readOnly = true; niCode.title = 'Le code n’est pas modifiable en édition'; }

  niQty && (niQty.value = String(it.qty|0));
  niThr && (niThr.value = String(it.threshold|0));

  const set = await dbGetSettings() || {};
  const defaultsLocs = (it.type==='atelier' ? (set.defaultLocationsAtelier||[]) : (set.defaultLocationsStock||[]));
  const defaultsTags = (it.type==='atelier' ? (set.defaultTagsAtelier||[]) : (set.defaultTagsStock||[]));

  const items = await dbList();
  const locsExisting = Array.from(new Set(items.map(i=>i.location).filter(Boolean))).sort();
  const combined = Array.from(new Set([].concat(defaultsLocs, locsExisting))).filter(Boolean);
  if(niLocSelect){
    niLocSelect.innerHTML = ['<option value="">— Sélectionner —</option>']
      .concat(combined.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`))
      .concat(['<option value="__custom__">➕ Saisir personnalisé…</option>']).join('');
    if(it.location && combined.includes(it.location)) niLocSelect.value = it.location;
    else if(it.location){ niLocSelect.value='__custom__'; niLocCustomWrap.hidden=false; niLocCustom && (niLocCustom.value=it.location); }
  }
  if(niLocChips){
    niLocChips.innerHTML = (defaultsLocs||[]).map(l=>`<button type="button" class="chip" data-loc="${esc(l)}">${esc(l)}</button>`).join('');
    niLocChips.querySelectorAll('button[data-loc]').forEach(b=>{
      b.addEventListener('click',()=>{
        const val=b.getAttribute('data-loc')||'';
        const opt=niLocSelect?niLocSelect.querySelector('option[value="'+val.replace(/"/g,'&quot;')+'"]'):null;
        if(niLocSelect && opt){ niLocSelect.value=val; niLocCustomWrap.hidden=true; }
        else { niLocSelect && (niLocSelect.value='__custom__'); niLocCustomWrap.hidden=false; niLocCustom && (niLocCustom.value=val); }
      });
    });
  }

  if(niTagChecks){
    niTagChecks.innerHTML = (defaultsTags||[]).map(t=>{
      const checked = (it.tags||[]).includes(t) ? 'checked' : '';
      return `<label class="chip"><input type="checkbox" value="${esc(t)}" ${checked}> ${esc(t)}</label>`;
    }).join('') || '<span class="muted">Aucun tag prédéfini (Paramètres)</span>';
  }
  if(niTagsExtra){
    const extras = (it.tags||[]).filter(t => !(defaultsTags||[]).includes(t));
    niTagsExtra.value = extras.join(', ');
  }

  niLinks && (niLinks.value = (it.links||[]).join('\n'));

  newItemDialog && newItemDialog.showModal && newItemDialog.showModal();
}

/* --- Dupliquer --- */
async function openDuplicateDialog(code){
  const it = await dbGet(code);
  if(!it){ alert('Introuvable'); return; }
  niMode = 'duplicate';
  niOriginalCode = null;

  niType && (niType.value = it.type || 'stock');
  niTitle && (niTitle.textContent = 'Dupliquer l’article');
  niName && (niName.value = it.name || '');
  niRef && (niRef.value = it.ref || '');
  if(niCode){
    const base = nameToCode(it.name || it.ref || it.code || '');
    let c = base, n = 2;
    while(await dbGet(c)) c = base + '-' + (n++);
    niCode.value = c;
    niCode.readOnly = false;
    niCode.title = '';
  }

  niQty && (niQty.value = String(it.qty|0));
  niThr && (niThr.value = String(it.threshold|0));

  const set = await dbGetSettings() || {};
  const defaultsLocs = (it.type==='atelier' ? (set.defaultLocationsAtelier||[]) : (set.defaultLocationsStock||[]));
  const defaultsTags = (it.type==='atelier' ? (set.defaultTagsAtelier||[]) : (set.defaultTagsStock||[]));

  const items = await dbList();
  const locsExisting = Array.from(new Set(items.map(i=>i.location).filter(Boolean))).sort();
  const combined = Array.from(new Set([].concat(defaultsLocs, locsExisting))).filter(Boolean);
  if(niLocSelect){
    niLocSelect.innerHTML = ['<option value="">— Sélectionner —</option>']
      .concat(combined.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`))
      .concat(['<option value="__custom__">➕ Saisir personnalisé…</option>']).join('');
    if(it.location && combined.includes(it.location)) niLocSelect.value = it.location;
    else if(it.location){ niLocSelect.value='__custom__'; niLocCustomWrap.hidden=false; niLocCustom && (niLocCustom.value=it.location); }
  }
  if(niLocChips){
    niLocChips.innerHTML = (defaultsLocs||[]).map(l=>`<button type="button" class="chip" data-loc="${esc(l)}">${esc(l)}</button>`).join('');
    niLocChips.querySelectorAll('button[data-loc]').forEach(b=>{
      b.addEventListener('click',()=>{
        const val=b.getAttribute('data-loc')||'';
        const opt=niLocSelect?niLocSelect.querySelector('option[value="'+val.replace(/"/g,'&quot;')+'"]'):null;
        if(niLocSelect && opt){ niLocSelect.value=val; niLocCustomWrap.hidden=true; }
        else { niLocSelect && (niLocSelect.value='__custom__'); niLocCustomWrap.hidden=false; niLocCustom && (niLocCustom.value=val); }
      });
    });
  }

  if(niTagChecks){
    niTagChecks.innerHTML = (defaultsTags||[]).map(t=>{
      const checked = (it.tags||[]).includes(t) ? 'checked' : '';
      return `<label class="chip"><input type="checkbox" value="${esc(t)}" ${checked}> ${esc(t)}</label>`;
    }).join('') || '<span class="muted">Aucun tag prédéfini (Paramètres)</span>';
  }
  if(niTagsExtra){
    const extras = (it.tags||[]).filter(t => !(defaultsTags||[]).includes(t));
    niTagsExtra.value = extras.join(', ');
  }

  niLinks && (niLinks.value = (it.links||[]).join('\n'));

  newItemDialog && newItemDialog.showModal && newItemDialog.showModal();
}

/* --- Sauvegarde dialog (create/edit/duplicate) --- */
$('#niSave')?.addEventListener('click', async e=>{
  e.preventDefault();

  const type = (niType && niType.value === 'atelier') ? 'atelier' : 'stock';
  const name = niName ? niName.value.trim() : '';
  let   code = niCode ? niCode.value.trim() : '';
  const ref  = niRef ? niRef.value.trim() : '';
  if(!name) return;

  const qty = Math.max(0, parseInt((niQty && niQty.value) || '0', 10));
  const threshold = Math.max(0, parseInt((niThr && niThr.value) || '0', 10));

  const loc = (function(){
    const v = (niLocSelect && niLocSelect.value) || '';
    return (v==='__custom__') ? ((niLocCustom && niLocCustom.value.trim()) || '') : (v.trim() || '');
  })();

  const checked=[]; niTagChecks && niTagChecks.querySelectorAll('input[type="checkbox"]:checked').forEach(cb=>checked.push(cb.value));
  const extras=(niTagsExtra && niTagsExtra.value || '').split(',').map(t=>t.trim()).filter(Boolean);
  const tags = Array.from(new Set([].concat(checked, extras)));
  const links = (niLinks && niLinks.value || '').split(/\n+/).map(s=>s.trim()).filter(Boolean);

  if(niMode === 'edit'){
    code = niOriginalCode;
    const existing = await dbGet(code);
    if(!existing){ alert('Article introuvable.'); return; }
    const updated = { id: code, code, ref: (ref||undefined), name, qty, threshold, tags, location: loc, links, type, updated: Date.now() };
    await dbPut(updated);
    newItemDialog?.close(); announce('Modifications enregistrées'); await refreshTable(type); await refreshHome();
    return;
  }

  // create | duplicate
  if(!code){
    code = await generateCodeFromName(name);
  } else {
    const hit = await getByCodeAnyCase(code);
    if(hit){ alert('Ce code existe déjà : '+hit.code); return; }
  }

  await dbPut({ id: code, code, ref: (ref||undefined), name, qty, threshold, tags, location: loc, links, type, updated: Date.now() });
  newItemDialog?.close();
  announce(niMode==='duplicate' ? 'Copie créée' : 'Créé');
  await refreshTable(type); await refreshHome();
});

/* --- Étiquettes --- */
var LABEL_TEMPLATES={ 'avery-l7160':{cols:3,rows:7,cellW:63.5,cellH:38.1,gapX:2.5,gapY:0,marginX:7.5,marginY:12.0},
  'avery-l7159':{cols:3,rows:7,cellW:63.5,cellH:38.1,gapX:2.5,gapY:0,marginX:7.5,marginY:12.0},
  'avery-l7163':{cols:2,rows:7,cellW:99.1,cellH:38.1,gapX:2.0,gapY:0,marginX:5.0,marginY:13.5},
  'avery-l7162':{cols:2,rows:8,cellW:99.1,cellH:33.9,gapX:2.0,gapY:2.0,marginX:5.0,marginY:10.7},
  'avery-l7165':{cols:2,rows:4,cellW:99.1,cellH:67.7,gapX:2.0,gapY:0,marginX:5.0,marginY:13.5},
  'mm50x25':{cols:4,rows:10,cellW:50,cellH:25,gapX:5,gapY:5,marginX:10,marginY:10},
  'mm70x35':{cols:3,rows:8,cellW:70,cellH:35,gapX:5,gapY:5,marginX:10,marginY:10} };
var labelsInitDone=false, labelsAllItems=[], labelsSelected=new Set(), lblPage=0, lblPagesCount=1;
var labelSearch=$('#labelSearch'), labelsList=$('#labelsList'), lblSelInfo=$('#lblSelInfo'),
    lblTemplate=$('#lblTemplate'), lblDensity=$('#lblDensity'), lblNameSize=$('#lblNameSize'), lblShowText=$('#lblShowText'),
    lblOffsetX=$('#lblOffsetX'), lblOffsetY=$('#lblOffsetY'),
    labelsPages=$('#labelsPages'), btnLblAll=$('#lblAll'), btnLblNone=$('#lblNone'),
    btnLblPrev=$('#lblPrev'), btnLblNext=$('#lblNext'), btnLabelsPrint=$('#btnLabelsPrint');
function initLabelsPanel(){ if(!labelsInitDone){ bindLabelsUI(); labelsInitDone=true; } loadLabelsData().then(()=>{ rebuildLabelsList(); rebuildLabelsPreview(true); }); }
async function loadLabelsData(){ labelsAllItems=await dbList(); if(labelsSelected.size===0){ labelsAllItems.forEach(i=>labelsSelected.add(i.code)); } }
function bindLabelsUI(){
  labelSearch?.addEventListener('input',()=>rebuildLabelsList());
  btnLblAll?.addEventListener('click',()=>{ labelsAllItems.forEach(i=>labelsSelected.add(i.code)); rebuildLabelsList(); rebuildLabelsPreview(true); });
  btnLblNone?.addEventListener('click',()=>{ labelsSelected.clear(); rebuildLabelsList(); rebuildLabelsPreview(true); });
  if(lblTemplate){ var t=localStorage.getItem('gstock.lblTemplate'); if(t) lblTemplate.value=t; lblTemplate.addEventListener('change',()=>{ localStorage.setItem('gstock.lblTemplate', lblTemplate.value); rebuildLabelsPreview(true); }); }
  if(lblDensity){ var d=localStorage.getItem('gstock.lblDensity'); if(d) lblDensity.value=d; lblDensity.addEventListener('change',()=>{ localStorage.setItem('gstock.lblDensity', lblDensity.value); rebuildLabelsPreview(false); }); }
  if(lblNameSize){ var ns=localStorage.getItem('gstock.lblNameSize'); if(ns) lblNameSize.value=ns; lblNameSize.addEventListener('change',()=>{ localStorage.setItem('gstock.lblNameSize', lblNameSize.value); rebuildLabelsPreview(false); }); }
  if(lblShowText){ var st=localStorage.getItem('gstock.lblShowText')==='1'; lblShowText.checked=st; lblShowText.addEventListener('change',()=>{ localStorage.setItem('gstock.lblShowText', lblShowText.checked?'1':'0'); rebuildLabelsPreview(false); }); }
  if(lblOffsetX){ var ox=parseFloat(localStorage.getItem('gstock.lblOffsetX')||'0')||0; lblOffsetX.value=ox; lblOffsetX.addEventListener('change',()=>{ localStorage.setItem('gstock.lblOffsetX', String(lblOffsetX.value||0)); rebuildLabelsPreview(false); }); }
  if(lblOffsetY){ var oy=parseFloat(localStorage.getItem('gstock.lblOffsetY')||'0')||0; lblOffsetY.value=oy; lblOffsetY.addEventListener('change',()=>{ localStorage.setItem('gstock.lblOffsetY', String(lblOffsetY.value||0)); rebuildLabelsPreview(false); }); }
  btnLblPrev?.addEventListener('click',()=>{ if(lblPage>0){ lblPage--; updatePaginationDisplay(); } });
  btnLblNext?.addEventListener('click',()=>{ if(lblPage<lblPagesCount-1){ lblPage++; updatePaginationDisplay(); } });
  btnLabelsPrint?.addEventListener('click',()=>window.print());
}
function rebuildLabelsList(){
  var q=(labelSearch&&labelSearch.value||'').toLowerCase();
  if(labelsList){
    labelsList.innerHTML = labelsAllItems.filter(i=>!q || [i.name,i.code,(i.tags||[]).join(' ')].join(' ').toLowerCase().includes(q))
      .map(i=>`<div class="row"><label style="display:flex;align-items:center;gap:.5rem;flex:1"><input type="checkbox" class="lblRow" data-code="${esc(i.code)}" ${(labelsSelected.has(i.code)?'checked':'')}> <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.name)}</span></label><code>${esc(i.code)}</code></div>`).join('');
    labelsList.querySelectorAll('.lblRow').forEach(cb=>{
      cb.addEventListener('change',()=>{ var code=cb.dataset.code; if(cb.checked) labelsSelected.add(code); else labelsSelected.delete(code); updateLblSelInfo(); rebuildLabelsPreview(true); });
    });
  }
  updateLblSelInfo();
}
function updateLblSelInfo(){ lblSelInfo && (lblSelInfo.textContent=labelsSelected.size+' sélection(s)'); }
function chunkArray(arr, size){ var out=[]; for(let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out; }
function mm(n){ return n+'mm'; }
function rebuildLabelsPreview(resetPage){
  var key=(lblTemplate&&lblTemplate.value)||'avery-l7160';
  var tmpl=LABEL_TEMPLATES[key]||LABEL_TEMPLATES['avery-l7160'];
  var module=parseFloat((lblDensity&&lblDensity.value)||'2');
  var namePt=parseInt((lblNameSize&&lblNameSize.value)||'11',10);
  var showText=!!(lblShowText&&lblShowText.checked);
  var offX=parseFloat((lblOffsetX&&lblOffsetX.value)||'0')||0;
  var offY=parseFloat((lblOffsetY&&lblOffsetY.value)||'0')||0;

  var selectedItems=labelsAllItems.filter(i=>labelsSelected.has(i.code));
  var perPage=(tmpl.cols|0)*(tmpl.rows|0);
  var pages=chunkArray(selectedItems, perPage);

  if(labelsPages) labelsPages.innerHTML='';
  pages.forEach((items,pageIndex)=>{
    var page=document.createElement('div'); page.className='labels-page'; page.dataset.index=String(pageIndex);
    var sheet=document.createElement('div'); sheet.className='labels-sheet';
    sheet.style.paddingLeft=mm((tmpl.marginX||0)+offX);
    sheet.style.paddingTop=mm((tmpl.marginY||0)+offY);
    sheet.style.gridTemplateColumns='repeat('+tmpl.cols+', '+mm(tmpl.cellW)+')';
    sheet.style.gridAutoRows=mm(tmpl.cellH);
    sheet.style.columnGap=mm((tmpl.gapX||0));
    sheet.style.rowGap=mm((tmpl.gapY||0));

    items.forEach(it=>{
      var card=document.createElement('div'); card.className='label-card';
      var name=document.createElement('div'); name.className='name'; name.textContent=it.name; name.style.fontSize=namePt+'pt'; card.appendChild(name);
      var hr=document.createElement('div'); hr.className='hr'; hr.textContent=it.code; card.appendChild(hr);
      var svg=(window.code39 && window.code39.svg) ? window.code39.svg(it.code,{module, height:52, margin:4, showText, fontSize:10}) : document.createElementNS('http://www.w3.org/2000/svg','svg');
      card.appendChild(svg);
      sheet.appendChild(card);
    });

    var rest=perPage-items.length;
    for(let k=0;k<rest;k++){ var empty=document.createElement('div'); empty.className='label-card'; empty.style.border='1px dashed transparent'; sheet.appendChild(empty); }
    page.appendChild(sheet);
    labelsPages && labelsPages.appendChild(page);
  });

  lblPagesCount=Math.max(1, pages.length||1);
  if(resetPage) lblPage=0;
  updatePaginationDisplay();
}
function updatePaginationDisplay(){
  var pages=$$('.labels-page', labelsPages);
  pages.forEach((p,i)=>p.classList.toggle('active', i===lblPage));
  var info=$('#lblPageInfo'); info && (info.textContent='Page '+Math.min(lblPage+1,lblPagesCount)+' / '+lblPagesCount);
  var prev=$('#lblPrev'), next=$('#lblNext'), one=(lblPagesCount<=1);
  if(prev){ prev.disabled=(lblPage<=0); show(prev,!one); }
  if(next){ next.disabled=(lblPage>=lblPagesCount-1); show(next,!one); }
  show(info,!one);
}

/* --- Journal --- */
var journalTbody=$('#journalTbody');
$('#btnFilterJournal')?.addEventListener('click',refreshJournal);
$('#btnExportCSV')?.addEventListener('click',async()=>{ var data=await dbExport('csv'); downloadFile('journal.csv',data,'text/csv'); });
$('#btnExportJSON')?.addEventListener('click',async()=>{ var data=await dbExport('json'); downloadFile('journal.json',data,'application/json'); });
async function refreshJournal(){
  var from=($('#dateFrom') && $('#dateFrom').value) ? new Date($('#dateFrom').value).getTime() : 0;
  var to=($('#dateTo') && $('#dateTo').value) ? (new Date($('#dateTo').value).getTime()+24*3600*1000) : Infinity;
  var list=await dbListMoves({from,to,limit:1000});
  journalTbody.innerHTML = list.map(m=>`<tr><td>${new Date(m.ts).toLocaleString()}</td><td>${m.type}</td><td><code>${esc(m.code)}</code></td><td>${esc(m.name||'')}</td><td>${m.qty}</td><td>${esc(m.note||'')}</td></tr>`).join('')
    || '<tr><td colspan="6" class="muted">Aucun mouvement</td></tr>';
}

/* --- Emprunts --- */
var loansTbody=$('#loansTbody');
$('#btnNewLoan')?.addEventListener('click',async ()=>{
  var code=prompt('Code article ?'); if(!code) return;
  var it=(await getByCodeAnyCase(code)); if(!it) return alert('Article introuvable');
  var person=prompt('Nom emprunteur ?'); if(!person) return;
  var due=prompt('Date prévue retour (YYYY-MM-DD) ?'); if(!due) return;
  var note=prompt('Note (optionnel)')||''; await dbCreateLoan({code:it.code,name:it.name,person,due,note});
  announce('Prêt créé → '+person); await refreshLoansTable(); await refreshHome();
});
$('#searchLoans')?.addEventListener('input',refreshLoansTable);
async function refreshLoansTable(){
  if(!loansTbody) return;
  var q=($('#searchLoans') && $('#searchLoans').value || '').toLowerCase();
  var loans=await dbListLoans(true);
  loansTbody.innerHTML = loans.filter(l=>!q || [l.person,l.code,l.name].join(' ').toLowerCase().includes(q)).map(l=>{
    var overdue = l.returnedAt ? false : (Date.now()>new Date(l.due).getTime());
    return `<tr><td>${esc(l.name||'')}</td><td><code>${esc(l.code)}</code></td><td>${esc(l.person||'')}</td><td>${esc(l.due||'')}</td><td>${l.returnedAt?'<span class="badge low">Clos</span>':(overdue?'<span class="badge under">En retard</span>':'<span class="badge ok">Actif</span>')}</td><td>${l.returnedAt?'<span class="muted">—</span>':'<button class="btn" data-return="'+l.id+'">✅ Retour</button>'}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">Aucun emprunt</td></tr>';
  loansTbody.querySelectorAll('button[data-return]').forEach(btn=>{
    btn.onclick=async()=>{ var id=btn.getAttribute('data-return'); await dbReturnLoan(id); announce('Matériel retourné'); await refreshLoansTable(); await refreshHome(); };
  });
  var sBorrow=$('#btnScanBorrow'), sReturn=$('#btnScanReturn'); var supported=('BarcodeDetector' in window);
  if(sBorrow){ sBorrow.hidden=false; sBorrow.disabled=!supported; if(!supported) sBorrow.title='Scanner non supporté'; }
  if(sReturn){ sReturn.hidden=false; sReturn.disabled=!supported; if(!supported) sReturn.title='Scanner non supporté'; }
}

/* --- Paramètres --- */
function makeSortable(listEl, onUpdate){
  var dragEl=null;
  listEl.addEventListener('dragstart',e=>{ var li=e.target.closest('li'); if(!li) return; dragEl=li; e.dataTransfer.effectAllowed='move'; try{ e.dataTransfer.setData('text/plain', li.dataset.value||''); }catch(_){ } li.style.opacity='0.5'; });
  listEl.addEventListener('dragend',()=>{ if(dragEl){ dragEl.style.opacity=''; dragEl=null; } });
  listEl.addEventListener('dragover',e=>{ e.preventDefault(); var li=e.target.closest('li'); if(!li||li===dragEl) return; var rect=li.getBoundingClientRect(); var before=(e.clientY - rect.top) < rect.height/2; if(before) listEl.insertBefore(dragEl, li); else listEl.insertBefore(dragEl, li.nextSibling); });
  listEl.addEventListener('drop',e=>{ e.preventDefault(); typeof onUpdate==='function' && onUpdate(); });
}
function renderList(sel, items){
  var ul=$(sel); if(!ul) return;
  ul.innerHTML=(items||[]).map((v,i)=>`<li draggable="true" data-value="${esc(v)}"><span class="drag">≡</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v)}</span><button class="btn" data-del="${i}">🗑️</button></li>`).join('');
  ul.querySelectorAll('button[data-del]').forEach(b=>b.addEventListener('click',()=>{ var idx=parseInt(b.getAttribute('data-del'),10)|0; items.splice(idx,1); renderList(sel,items); updateCounts(); }));
  makeSortable(ul, updateCounts);
}
function valuesFromList(sel){ var ul=$(sel); if(!ul) return []; return Array.from(ul.querySelectorAll('li')).map(li=>li.dataset.value||li.textContent.trim()).filter(Boolean); }
function attachAdd(inpSel, btnSel, listSel, items){
  var input=$(inpSel), btn=$(btnSel);
  function add(){ var v=(input && input.value || '').trim(); if(!v) return; if(items.indexOf(v)>=0){ input.value=''; return; } items.push(v); renderList(listSel,items); input && (input.value=''); input?.focus(); updateCounts(); }
  btn?.addEventListener('click',add); input?.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); add(); } });
}
function updateCounts(){
  var el;
  (el=$('#countTagsStock')) && (el.textContent=String(valuesFromList('#listTagsStock').length));
  (el=$('#countTagsAtelier')) && (el.textContent=String(valuesFromList('#listTagsAtelier').length));
  (el=$('#countLocsStock')) && (el.textContent=String(valuesFromList('#listLocsStock').length));
  (el=$('#countLocsAtelier')) && (el.textContent=String(valuesFromList('#listLocsAtelier').length));
}
$('#btnExportFull')?.addEventListener('click',async()=>{ var blob=await dbExportFull(); downloadFile('gstock-export.json', JSON.stringify(blob,null,2),'application/json'); });
$('#btnImportJSON')?.addEventListener('click',async()=>{
  try{
    if(!window.showOpenFilePicker) throw new Error('File Picker non supporté');
    var handles=await window.showOpenFilePicker({types:[{description:'JSON',accept:{'application/json':['.json']}}]});
    var f=await handles[0].getFile(); var text=await f.text(); var data=JSON.parse(text);
    await dbImportFull(data); announce('Import terminé'); await refreshHome(); await refreshTable('stock'); await refreshTable('atelier');
  }catch(e){ console.warn(e); alert('Import annulé / invalide'); }
});
$('#btnLinkSharedFile')?.addEventListener('click',async()=>{
  if(!('showSaveFilePicker' in window)) return alert('File System Access API non supportée.');
  var handle=await showSaveFilePicker({suggestedName:'gstock-shared.json',types:[{description:'JSON',accept:{'application/json':['.json']}}]});
  await dbLinkSharedFile(handle); $('#sharedFileStatus').textContent='Fichier partagé lié (autosave activé)';
});
$('#btnResetCache')?.addEventListener('click',async()=>{
  if(!confirm('Réinitialiser cache + base locale (IDB) + SW et recharger ?')) return;
  try { await dbNuke(false); } catch(e){}
  try{ var regs=await (navigator.serviceWorker?.getRegistrations?.()||[]); await Promise.all(regs.map(r=>r.unregister())); }catch(e){}
  try{ var keys=await (window.caches?.keys?.()||[]); await Promise.all(keys.map(k=>caches.delete(k))); }catch(e){}
  location.href = location.pathname + '?bust=' + Date.now();
});
function initSettingsPanel(){
  (async ()=>{
    var set=await dbGetSettings()||{};
    var tagsStock=(set.defaultTagsStock||[]).slice();
    var tagsAtelier=(set.defaultTagsAtelier||[]).slice();
    var locsStock=(set.defaultLocationsStock||[]).slice();
    var locsAtelier=(set.defaultLocationsAtelier||[]).slice();
    renderList('#listTagsStock', tagsStock);
    renderList('#listTagsAtelier', tagsAtelier);
    renderList('#listLocsStock', locsStock);
    renderList('#listLocsAtelier', locsAtelier);
    updateCounts();
    attachAdd('#addTagStock','#btnAddTagStock','#listTagsStock',tagsStock);
    attachAdd('#addTagAtelier','#btnAddTagAtelier','#listTagsAtelier',tagsAtelier);
    attachAdd('#addLocStock','#btnAddLocStock','#listLocsStock',locsStock);
    attachAdd('#addLocAtelier','#btnAddLocAtelier','#listLocsAtelier',locsAtelier);
    var el=$('#inputBuffer'); el && (el.value=set.buffer|0);

    var chkDebug=$('#chkDebug');
    var apply=(en)=>{ window.GSTOCK_DEBUG=!!en; localStorage.setItem('gstock.debug',en?'1':'0'); window.dispatchEvent(new CustomEvent('gstock:debug-changed',{detail:{enabled:!!en}})); };
    if(chkDebug){ chkDebug.checked=(localStorage.getItem('gstock.debug')==='1'); apply(chkDebug.checked); chkDebug.addEventListener('change',e=>apply(e.target.checked)); }

    $('#btnSaveSettings')?.addEventListener('click',async ()=>{
      var newSet={
        buffer:Math.max(0,parseInt(($('#inputBuffer')&&$('#inputBuffer').value)||'0',10)),
        defaultTagsStock: valuesFromList('#listTagsStock'),
        defaultTagsAtelier: valuesFromList('#listTagsAtelier'),
        defaultLocationsStock: valuesFromList('#listLocsStock'),
        defaultLocationsAtelier: valuesFromList('#listLocsAtelier')
      };
      await dbSaveSettings(Object.assign({}, set, newSet));
      announce('Paramètres enregistrés');
    });
  })();
}

/* --- Scanner articles --- */
var videoEl=$('#scanVideo'), btnScanStart=$('#btnScanStart'), btnScanStop=$('#btnScanStop'), btnScanTorch=$('#btnScanTorch'), scanHint=$('#scanHint'), scanFallback=$('#scanFallback'), scanManual=$('#scanManual');
var scanStream=null, scanTrack=null, scanDetector=null, scanLoopId=0, torchOn=false;
var lastCode='', lastReadTs=0; var DUP_MS=1200;
var HAS_DETECTOR=('BarcodeDetector' in window);
btnScanStop && (btnScanStop.hidden=true);
btnScanTorch && (btnScanTorch.hidden=true);
if(!HAS_DETECTOR){ show(scanFallback,true); scanHint && (scanHint.textContent='Scanner natif indisponible sur ce navigateur'); }
$('#btnScanManual')?.addEventListener('click',async ()=>{
  var raw=(scanManual&&scanManual.value.trim())||''; if(!raw) return;
  var item=(await getByCodeAnyCase(raw));
  if(item){ beepKnown(); await openAdjustDialog({code:item.code, type:'add'}); } else { alert('Code inconnu'); }
});

function beepKnown(ms,hz){
  ms=ms||140; hz=hz||880;
  try{
    var AC=window.AudioContext||window.webkitAudioContext; if(!AC) return;
    var ctx=new AC(), o=ctx.createOscillator(), g=ctx.createGain();
    o.frequency.value=hz; o.type='sine'; o.connect(g); g.connect(ctx.destination); o.start();
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+ms/1000);
    setTimeout(()=>{ o.stop(); ctx.close(); }, ms+60);
  }catch(_){}
}
async function ensureDetector(){
  if(!('BarcodeDetector' in window)) throw new Error('BarcodeDetector non supporté');
  var fmts=['ean_13','code_128','code_39','qr_code','ean_8','upc_a','upc_e','itf','codabar','pdf417'];
  var supported=[]; try{ if(window.BarcodeDetector?.getSupportedFormats) supported=await window.BarcodeDetector.getSupportedFormats(); }catch(_){}
  if(Array.isArray(supported) && supported.length) fmts=fmts.filter(f=>supported.indexOf(f)>=0);
  scanDetector=new window.BarcodeDetector({formats:fmts});
}
async function startScan(){
  try{
    var constraints={ video:{ facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720} }, audio:false };
    scanStream=await navigator.mediaDevices.getUserMedia(constraints);
    if(videoEl){ videoEl.srcObject=scanStream; await videoEl.play(); }
    scanTrack=scanStream.getVideoTracks()[0];
    var caps=(scanTrack?.getCapabilities?.())||{};
    btnScanStart && (btnScanStart.hidden=true);
    btnScanStop && (btnScanStop.hidden=false);
    btnScanTorch && (btnScanTorch.hidden=!caps.torch, btnScanTorch.disabled=!caps.torch);
    torchOn=false;
    await ensureDetector();
    lastCode=''; lastReadTs=0; scanHint && (scanHint.textContent='Visez le code-barres...');
    runDetectLoop();
  }catch(err){
    console.warn('startScan error', err);
    scanHint && (scanHint.textContent=String(err).includes('BarcodeDetector')?'Détection non supportée. Utilisez la saisie manuelle.':'Accès caméra impossible (HTTPS/permissions).');
    if(!scanStream){ stopScan(); }
  }
}
function stopScan(){
  if(scanLoopId){ cancelAnimationFrame(scanLoopId); scanLoopId=0; }
  try{ videoEl?.pause(); }catch(_){}
  if(scanTrack){ try{ scanTrack.stop(); }catch(_){ } scanTrack=null; }
  if(scanStream){ try{ scanStream.getTracks().forEach(t=>t.stop()); }catch(_){ } scanStream=null; }
  if(videoEl) videoEl.srcObject=null;
  btnScanStart && (btnScanStart.hidden=false);
  btnScanStop && (btnScanStop.hidden=true);
  btnScanTorch && (btnScanTorch.hidden=true);
  torchOn=false;
}
async function runDetectLoop(){
  var step=async()=>{
    if(!scanDetector || !videoEl || !scanStream) return;
    try{
      var codes=await scanDetector.detect(videoEl);
      if(Array.isArray(codes) && codes.length){
        var raw=(codes[0].rawValue||'').trim(); var now=Date.now();
        if(raw && (raw!==lastCode || (now-lastReadTs)>DUP_MS)){
          lastCode=raw; lastReadTs=now;
          var item=(await getByCodeAnyCase(raw));
          if(item){ beepKnown(); stopScan(); await openAdjustDialog({code:item.code, type:'add'}); return; }
          else{ scanHint && (scanHint.textContent='Code inconnu : '+raw+' — on continue...'); }
        }
      }
    }catch(err){ if(window.GSTOCK_DEBUG) console.debug('detect error', err); }
    scanLoopId=requestAnimationFrame(step);
  };
  scanLoopId=requestAnimationFrame(step);
}
btnScanStart?.addEventListener('click',startScan);
btnScanStop?.addEventListener('click',stopScan);
btnScanTorch?.addEventListener('click',async ()=>{
  if(!scanTrack) return; var caps=(scanTrack?.getCapabilities?.())||{}; if(!caps.torch) return;
  torchOn=!torchOn; try{ await scanTrack.applyConstraints({advanced:[{torch:torchOn}]}); }catch(e){ torchOn=false; }
});

/* --- Scan emprunt/retour --- */
var loanDlg=$('#loanScanDialog'), loanVideo=$('#loanVideo'), loanScanTitle=$('#loanScanTitle'), loanScanHint=$('#loanScanHint'), btnLoanTorch=$('#btnLoanTorch'), btnLoanStop=$('#btnLoanStop');
var loanStream=null, loanTrack=null, loanLoop=0, loanMode='borrow';
$('#btnScanBorrow')?.addEventListener('click',()=>startLoanScan('borrow'));
$('#btnScanReturn')?.addEventListener('click',()=>startLoanScan('return'));
btnLoanStop?.addEventListener('click',stopLoanScan);
btnLoanTorch?.addEventListener('click',async ()=>{
  if(!loanTrack) return; var caps=(loanTrack?.getCapabilities?.())||{}; if(!caps.torch) return;
  var on=!loanTrack._torchOn; try{ await loanTrack.applyConstraints({advanced:[{torch:on}]}); loanTrack._torchOn=on; }catch(_){ loanTrack._torchOn=false; }
});
async function startLoanScan(mode){
  loanMode=mode||'borrow'; loanScanTitle && (loanScanTitle.textContent=(loanMode==='borrow'?'Scanner un emprunt':'Scanner un retour'));
  try{
    var constraints={ video:{ facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720} }, audio:false };
    loanStream=await navigator.mediaDevices.getUserMedia(constraints);
    if(loanVideo){ loanVideo.srcObject=loanStream; await loanVideo.play(); }
    loanTrack=loanStream.getVideoTracks()[0];
    var caps=(loanTrack?.getCapabilities?.())||{}; btnLoanTorch && (btnLoanTorch.disabled=!caps.torch); loanTrack._torchOn=false;
    await ensureDetector();
    loanScanHint && (loanScanHint.textContent='Visez le code-barres...');
    loanDlg && loanDlg.showModal && loanDlg.showModal();
    runLoanLoop();
  }catch(err){ console.warn('loan scan error', err); alert('Caméra ou détection indisponible. Utilisez la saisie manuelle sur la fiche.'); }
}
function stopLoanScan(){
  if(loanLoop){ cancelAnimationFrame(loanLoop); loanLoop=0; }
  try{ loanVideo?.pause(); }catch(_){}
  if(loanTrack){ try{ loanTrack.stop(); }catch(_){ } loanTrack=null; }
  if(loanStream){ try{ loanStream.getTracks().forEach(t=>t.stop()); }catch(_){ } loanStream=null; }
  if(loanVideo) loanVideo.srcObject=null; try{ loanDlg?.close(); }catch(_){}
}
async function runLoanLoop(){
  var step=async()=>{
    if(!scanDetector || !loanVideo || !loanStream) return;
    try{
      var codes=await scanDetector.detect(loanVideo);
      if(Array.isArray(codes) && codes.length){
        var raw=(codes[0].rawValue||'').trim();
        if(raw){
          var it=(await getByCodeAnyCase(raw));
          if(!it){ loanScanHint && (loanScanHint.textContent='Code inconnu : '+raw); loanLoop=requestAnimationFrame(step); return; }
          beepKnown();
          if(loanMode==='borrow'){ stopLoanScan(); openBorrowDialog(it); return; }
          else{
            var loans=await dbListLoans(true);
            var active=loans.find(l=>l.code===it.code && !l.returnedAt);
            if(active){ await dbReturnLoan(active.id); announce('Retour enregistré • '+it.name); await refreshLoansTable(); await refreshHome(); stopLoanScan(); return; }
            loanScanHint && (loanScanHint.textContent='Aucun prêt actif pour ce code — on continue...');
          }
        }
      }
    }catch(err){ if(window.GSTOCK_DEBUG) console.debug('loan detect err', err); }
    loanLoop=requestAnimationFrame(step);
  };
  loanLoop=requestAnimationFrame(step);
}
var borrowDlg=$('#borrowDialog'), borrowItem=$('#borrowItem'), brwPerson=$('#brwPerson'), brwDue=$('#brwDue'), brwNote=$('#brwNote'), brwCreate=$('#brwCreate');
var borrowCurrent=null;
function openBorrowDialog(item){
  borrowCurrent=item; borrowItem && (borrowItem.textContent=item.name+' ('+(item.ref||item.code)+')');
  brwPerson&&(brwPerson.value=''); brwDue&&(brwDue.value=''); brwNote&&(brwNote.value='');
  borrowDlg && borrowDlg.showModal && borrowDlg.showModal();
}
brwCreate?.addEventListener('click',async e=>{
  e.preventDefault(); if(!borrowCurrent){ borrowDlg?.close(); return; }
  var person=(brwPerson&&brwPerson.value.trim())||''; var due=(brwDue&&brwDue.value)||''; var note=(brwNote&&brwNote.value)||'';
  if(!person||!due){ alert('Emprunteur et date de retour requis.'); return; }
  await dbCreateLoan({code:borrowCurrent.code,name:borrowCurrent.name,person,due,note});
  announce('Prêt créé'); borrowDlg?.close(); await refreshLoansTable(); await refreshHome();
});

/* --- INIT --- */
(async function init(){
  $('#appVersion') && ($('#appVersion').textContent=window.APP_VERSION||'');
  try {
    if (typeof window.dbInit !== 'function') throw new Error('db.js non chargé');
    await dbInit(); // IDB ou fallback LS
  } catch (e) {
    console.error('Init DB error (verbose):', { name: e && e.name, message: e && e.message, stack: e && e.stack }, e);
    const msg = String((e && (e.message || e.name)) || 'Unknown');
    if ((e && (e.name === 'UnknownError' || e.name === 'InvalidStateError' || e.name === 'QuotaExceededError')) || /Internal error/i.test(msg)) {
      const ok = confirm('Le stockage local semble corrompu/bloqué.\nLancer la réparation ?\n(La base locale sera réinitialisée)');
      if (ok) {
        try { await (window.dbNuke ? window.dbNuke(false) : Promise.resolve()); } catch(_) {}
        try {
          if ('caches' in window) { const ks = await caches.keys(); await Promise.all(ks.map(k=>caches.delete(k))); }
          if (navigator.serviceWorker?.getRegistrations) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=>r.unregister())); }
        } catch(_) {}
        location.href = location.pathname + '?bust=' + Date.now();
        return;
      }
    }
    if (e && (e.name === 'SecurityError' || e.name === 'NotAllowedError')) {
      alert('IndexedDB est bloqué (navigation privée / politique). Fallback mémoire activé.');
    }
    if (!window.dbInit) {
      alert('db.js non chargé (cache SW ?). Rechargement.');
      location.href = location.pathname + '?bust=' + Date.now();
      return;
    }
  }

  await refreshHome();
  showTab('home');
  await refreshLoansTable();
})();
})();
