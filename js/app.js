/* Gstock - app.js v2.6.0 (Aide intégrée + tri Tags/Emplacements) */
(function(){'use strict';
/* ---------- helpers DOM ---------- */
function $(s,r){return (r||document).querySelector(s);}
function $$(s,r){return Array.from((r||document).querySelectorAll(s));}
var sr=$('#sr');
function cssEscapeCompat(v){
  if(window.CSS && typeof CSS.escape==='function') return CSS.escape(v);
  return String(v).replace(/[^a-zA-Z0-9_\-]/g,function(s){return '\\'+s.codePointAt(0).toString(16)+' ';});
}
function esc(s){return String(s).replace(/[&<>"']/g,function(m){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]);});}
function announce(msg){ if(sr){ sr.textContent=''; setTimeout(function(){ sr.textContent=msg; },10);} }
function downloadFile(name,data,type){ var blob=new Blob([data],{type:type}); var url=URL.createObjectURL(blob); var a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){ URL.revokeObjectURL(url); },3000); }
function debounced(fn,ms){ var t=null; return function(){ var a=arguments; clearTimeout(t); t=setTimeout(function(){ fn.apply(null,a); },ms); }; }

/* ---------- Thème ---------- */
var themeToggle=$('#themeToggle');
if(themeToggle){
  themeToggle.value=(localStorage.getItem('gstock.theme')||'auto');
  themeToggle.addEventListener('change',function(){
    var v=themeToggle.value; localStorage.setItem('gstock.theme',v);
    if(v==='auto'){ var d=matchMedia('(prefers-color-scheme: dark)').matches; document.documentElement.setAttribute('data-theme',d?'dark':'light'); }
    else document.documentElement.setAttribute('data-theme',v);
  });
}

/* ---------- Onglets ---------- */
var sections={home:$('#tab-home'),stock:$('#tab-stock'),atelier:$('#tab-atelier'),scanner:$('#tab-scanner'),labels:$('#tab-labels'),journal:$('#tab-journal'),gear:$('#tab-gear'),settings:$('#tab-settings')};
$$('nav button[data-tab]').forEach(function(b){ b.addEventListener('click',function(){ showTab(b.dataset.tab); }); });
function showTab(name){
  Object.keys(sections).forEach(function(k){ var el=sections[k]; if(el) el.hidden=(k!==name); });
  $$('nav button[data-tab]').forEach(function(b){ b.classList.toggle('active', b.dataset.tab===name); });
  if(name==='home') refreshHome();
  if(name==='stock') refreshTable('stock');
  if(name==='atelier') refreshTable('atelier');
  if(name==='labels') initLabelsPanel();
  if(name==='journal') refreshJournal();
  if(name==='gear') refreshLoansTable();
  if(name==='settings') initSettingsPanel();
}

/* ---------- Name → Code ---------- */
function deaccent(s){ try{ return s.normalize('NFD').replace(/\p{Diacritic}/gu,''); }catch(_){ return s; } }
function nameToCode(name){
  var stop=new Set(['le','la','les','des','du','de','d','l','un','une','pour','et','sur','avec','en','à','au','aux','the','of','for']);
  var parts=deaccent(String(name)).replace(/[^A-Za-z0-9]+/g,' ').trim().split(/\s+/);
  if(parts.length===0) return 'ITM-'+Math.floor(100000+Math.random()*899999);
  var brand=parts.length>1?parts[parts.length-1]:'';
  var brandShort=brand?(brand.slice(0,3).toLowerCase()):'';
  brandShort=brandShort?(brandShort[0].toUpperCase()+brandShort.slice(1)):'';
  var base=[]; for(var i=0;i<parts.length-(brand?1:0);i++){ var t=parts[i]; var low=t.toLowerCase(); if(stop.has(low))continue; if(/^\d+$/.test(t)){base.push(t);continue;} base.push((t.length>=4?t.slice(0,4):t).toLowerCase()); }
  return base.join('')+brandShort;
}
async function generateCodeFromName(name){ var base=nameToCode(name); var c=base, n=2; while(await dbGet(c)||await dbGet(c.toUpperCase())||await dbGet(c.toLowerCase())) c=base+'-'+(n++); return c; }

/* ---------- Accueil ---------- */
async function refreshHome(){
  var items=await dbList();
  var set=await dbGetSettings(); var buf=(set&&set.buffer|0);
  var el;
  el=$('#kpiItems'); if(el) el.textContent=String(items.length);
  el=$('#kpiQty'); if(el) el.textContent=String(items.reduce(function(s,i){return s+(i.qty|0);},0));
  el=$('#kpiUnder'); if(el) el.textContent=String(items.filter(function(i){return (i.qty|0)<=(i.threshold|0);}).length);
  el=$('#kpiLow'); if(el) el.textContent=String(items.filter(function(i){ return (i.qty|0)>(i.threshold|0) && ((i.qty|0)-(i.threshold|0))<=buf; }).length);
  var loans=await dbListLoans(true); var overdue=loans.filter(function(l){return !l.returnedAt && Date.now()>new Date(l.due).getTime();}).length;
  el=$('#kpiLoansActive'); if(el) el.textContent=String(loans.length);
  el=$('#kpiLoansOverdue'); if(el) el.textContent=String(overdue);
  var recent=await dbListMoves({from:0,to:Infinity,limit:8}); var ul=$('#recentMoves');
  if(ul){ ul.innerHTML=(recent.map(function(m){return '<li>'+new Date(m.ts).toLocaleString()+' • <strong>'+esc(m.type)+'</strong> <code>'+esc(m.code)+'</code> ×'+m.qty+'</li>';}).join(''))||'<li class="muted">Aucun mouvement</li>'; }
}

/* ---------- Statuts visuels ---------- */
function getTypeLabel(t){ return t==='atelier'?'Atelier':'Stock'; }
function ensureType(it){ return it.type||'stock'; }
function statusBadge(it, buffer){
  var qty=(it.qty|0), thr=(it.threshold|0), diff=qty-thr;
  if(qty===0) return '<span class="badge under" title="Épuisé">Épuisé</span>';
  if(qty<=thr) return '<span class="badge under" title="Sous seuil">Sous seuil</span>';
  if(diff<=((buffer|0))) return '<span class="badge low" title="Approche">Approche</span>';
  return '<span class="badge ok" title="OK">OK</span>';
}

/* ---------- Tables Stock & Atelier ---------- */
var state={ stock:{sel:new Set(),q:'',status:'',tag:'',loc:''}, atelier:{sel:new Set(),q:'',status:'',tag:'',loc:''} };
var els={
  stock:{ tbody:$('#stockTbody'), search:$('#stockSearch'), status:$('#stockStatus'), tag:$('#stockTag'), loc:$('#stockLoc'),
          selAll:$('#stockSelAll'), bulk:$('#stockBulk'), bulkCount:$('#stockBulkCount'),
          bulkLabels:$('#stockBulkLabels'), bulkExport:$('#stockBulkExport'), bulkDelete:$('#stockBulkDelete'),
          btnAdd:$('#btnAddStock'), btnClear:$('#stockClear') },
  atelier:{ tbody:$('#atelierTbody'), search:$('#atelierSearch'), status:$('#atelierStatus'), tag:$('#atelierTag'), loc:$('#atelierLoc'),
          selAll:$('#atelierSelAll'), bulk:$('#atelierBulk'), bulkCount:$('#atelierBulkCount'),
          bulkLabels:$('#atelierBulkLabels'), bulkExport:$('#atelierBulkExport'), bulkDelete:$('#atelierBulkDelete'),
          btnAdd:$('#btnAddAtelier'), btnClear:$('#atelierClear') }
};

Object.keys(els).forEach(function(type){
  var e=els[type];
  if(e.search) e.search.addEventListener('input',debounced(function(){ state[type].q=e.search.value||''; refreshTable(type); },120));
  if(e.status) e.status.addEventListener('change',function(){ state[type].status=e.status.value||''; refreshTable(type); });
  if(e.tag) e.tag.addEventListener('change',function(){ state[type].tag=e.tag.value||''; refreshTable(type); });
  if(e.loc) e.loc.addEventListener('change',function(){ state[type].loc=e.loc.value||''; refreshTable(type); });
  if(e.btnClear) e.btnClear.addEventListener('click',function(){
    state[type]={sel:state[type].sel,q:'',status:'',tag:'',loc:''};
    if(e.search) e.search.value='';
    if(e.status) e.status.value='';
    if(e.tag) e.tag.value='';
    if(e.loc) e.loc.value='';
    refreshTable(type);
  });
  if(e.selAll) e.selAll.addEventListener('change',function(){
    if(!e.tbody) return;
    e.tbody.querySelectorAll('input.rowSel').forEach(function(cb){
      cb.checked=e.selAll.checked; cb.dispatchEvent(new Event('change'));
    });
  });
  if(e.bulkDelete) e.bulkDelete.addEventListener('click',async function(){
    var s=state[type].sel; if(!s.size) return;
    if(!confirm('Supprimer '+s.size+' élément(s) ?')) return;
    for (const code of s) { await dbDelete(code); }
    s.clear(); await refreshTable(type); announce('Éléments supprimés');
  });
  if(e.bulkExport) e.bulkExport.addEventListener('click',async function(){
    var s=state[type].sel; if(!s.size) return;
    var items=[]; for (const code of s){ var it=await dbGet(code); if(it && ensureType(it)===type) items.push(it); }
    var header='type,name,code,qty,threshold,tags,location,links\n';
    var rows=items.map(function(i){
      return [ensureType(i),i.name,i.code,(i.qty|0),(i.threshold|0),(i.tags||[]).join('|'),i.location||'',(i.links||[]).join('|')]
        .map(function(v){return String(v).replace(/"/g,'""');})
        .map(function(v){return '"'+v+'"';}).join(',');
    }).join('\n');
    downloadFile(type+'-selection.csv', header+rows+'\n','text/csv');
  });
  if(e.bulkLabels) e.bulkLabels.addEventListener('click',async function(){
    var s=state[type].sel; if(!s.size) return;
    await labelsSelectCodes(Array.from(s)); showTab('labels');
  });
  if(e.btnAdd) e.btnAdd.addEventListener('click',function(){ openNewDialog(type); });
});

async function refreshTable(type){
  var e=els[type]; if(!e||!e.tbody) return;
  var set=await dbGetSettings(); var buffer=(set&&set.buffer|0);
  var list=await dbList();
  var all=list.map(function(i){ return Object.assign({},i,{type:ensureType(i)}); }).filter(function(i){return i.type===type;});

  var tagsSet=new Set(), locSet=new Set();
  all.forEach(function(i){ (i.tags||[]).forEach(function(t){tagsSet.add(t);}); if(i.location) locSet.add(i.location); });
  var curTag=(e.tag&&e.tag.value)||''; var curLoc=(e.loc&&e.loc.value)||'';
  if(e.tag) e.tag.innerHTML='<option value="">Tous tags</option>'+Array.from(tagsSet).sort().map(function(t){return '<option '+(t===curTag?'selected':'')+'>'+esc(t)+'</option>';}).join('');
  if(e.loc) e.loc.innerHTML='<option value="">Tous emplacements</option>'+Array.from(locSet).sort().map(function(l){return '<option '+(l===curLoc?'selected':'')+'>'+esc(l)+'</option>';}).join('');

  var q=(state[type].q||'').toLowerCase(), st=state[type].status||'', tag=state[type].tag||'', loc=state[type].loc||'';
  var filtered=all.filter(function(it){
    var inQ=!q||[it.name,it.code,(it.tags||[]).join(' '),it.location||'',(it.links||[]).join(' ')].join(' ').toLowerCase().includes(q);
    var inTag=!tag||(it.tags||[]).indexOf(tag)>=0;
    var inLoc=!loc||((it.location||'')===loc);
    var stOK=true;
    if(st==='ok') stOK=(it.qty>it.threshold && (it.qty-it.threshold)>(buffer|0));
    if(st==='low') stOK=(it.qty>it.threshold && (it.qty-it.threshold)<=(buffer|0));
    if(st==='under') stOK=(it.qty<=it.threshold);
    return inQ&&inTag&&inLoc&&stOK;
  });

  e.tbody.innerHTML = filtered.map(function(it){
    return '<tr>'
      +'<td><input type="checkbox" class="rowSel" data-code="'+esc(it.code)+'" '+(state[type].sel.has(it.code)?'checked':'')+'></td>'
      +'<td>'+esc(it.name)+'</td>'
      +'<td><code>'+esc(it.code)+'</code> <span class="pill muted" style="font-size:.7rem">'+getTypeLabel(type)+'</span></td>'
      +'<td><div style="display:flex;gap:.3rem;align-items:center">'
          +'<button class="btn" data-qa="-1" data-code="'+esc(it.code)+'" title="Retirer 1">-1</button>'
          +'<strong>'+ (it.qty|0) +'</strong>'
          +statusBadge(it, buffer)
          +'<button class="btn" data-qa="+1" data-code="'+esc(it.code)+'" title="Ajouter 1">+1</button>'
        +'</div></td>'
      +'<td>'+(it.threshold|0)+'</td>'
      +'<td>'+((it.tags||[]).map(function(t){return '<span class="pill">'+esc(t)+'</span>';}).join(' '))+'</td>'
      +'<td>'+esc(it.location||'')+'</td>'
      +'<td>'+((it.links&&it.links.length)?('<button class="btn" data-act="link" data-code="'+esc(it.code)+'">🔗 '+it.links.length+'</button>'):'<span class="muted">—</span>')+'</td>'
      +'<td>'
        +'<button class="btn" data-act="adj" data-code="'+esc(it.code)+'">Ajuster…</button>'
        +'<button class="btn" data-act="hist" data-code="'+esc(it.code)+'">Historique</button>'
        +'<button class="btn danger" data-act="del" data-code="'+esc(it.code)+'">Suppr.</button>'
      +'</td>'
    +'</tr>';
  }).join('') || '<tr><td colspan="10" class="muted">Aucun élément</td></tr>';

  e.tbody.querySelectorAll('button[data-act]').forEach(function(btn){
    var code=btn.dataset.code;
    if(btn.dataset.act==='adj') btn.onclick=function(){ openAdjustDialog({code:code}); };
    if(btn.dataset.act==='hist') btn.onclick=function(){ openHistory(code); };
    if(btn.dataset.act==='link') btn.onclick=function(){ openLinks(code); };
    if(btn.dataset.act==='del') btn.onclick=async function(){ if(confirm('Supprimer cet élément ?')){ await dbDelete(code); state[type].sel.delete(code); await refreshTable(type); announce('Élément supprimé'); } };
  });
  e.tbody.querySelectorAll('button[data-qa]').forEach(function(btn){
    btn.onclick=async function(){
      var code=btn.dataset.code; var delta = (btn.dataset.qa==='+1')?+1:-1;
      var it=(await dbGet(code))||(await dbGet(code.toUpperCase()))||(await dbGet(code.toLowerCase())); if(!it) return;
      await dbAdjustQty(it.code, delta);
      await dbAddMove({ts:Date.now(),type:(delta>0?'ENTRY':'EXIT'),code:it.code,name:it.name,qty:Math.abs(delta),note:'ajustement rapide ('+getTypeLabel(ensureType(it))+')'});
      announce((delta>0?'+1':'-1')+' → '+it.name); await refreshTable(type); await refreshHome();
    };
  });
  e.tbody.querySelectorAll('input.rowSel').forEach(function(cb){
    cb.addEventListener('change',function(){ var code=cb.dataset.code; if(cb.checked) state[type].sel.add(code); else state[type].sel.delete(code); updateBulk(type); });
  });
  if(e.selAll){
    e.selAll.checked = filtered.length>0 && filtered.every(function(it){ return state[type].sel.has(it.code); });
  }
  updateBulk(type);
}
function updateBulk(type){
  var e=els[type]; var n=state[type].sel.size; if(!e||!e.bulk) return;
  e.bulk.hidden=(n===0);
  if(e.bulkCount) e.bulkCount.textContent=String(n)+' sélection(s)';
}
async function openHistory(code){
  var item=(await dbGet(code))||(await dbGet(code.toUpperCase()))||(await dbGet(code.toLowerCase()));
  var moves=await dbListMoves({code:(item&&item.code)||code,limit:100});
  var loans=(typeof dbListLoansByCode==='function') ? (await dbListLoansByCode((item&&item.code)||code)) : [];
  alert('Historique "'+((item&&item.name)||code)+'"\n\nMouvements: '+moves.length+'\nEmprunts (actifs+clos): '+loans.length);
}
async function openLinks(code){
  var it=await dbGet(code); var links=(it&&it.links)||[]; if(!links.length) return;
  if(links.length===1){ window.open(links[0],'_blank'); return; }
  var s=prompt('Ouvrir lien (1-'+links.length+') :\n'+links.map(function(u,i){return (i+1)+'. '+u;}).join('\n'));
  var idx=((parseInt(s||'0',10)-1)|0); if(links[idx]) window.open(links[idx],'_blank');
}

/* ---------- Dialog Ajustement ---------- */
var dlg=$('#adjustDialog'), dlgType=$('#dlgType'), dlgQty=$('#dlgQty'), dlgNote=$('#dlgNote'), dlgItem=$('#dlgItem');
var dlgState={code:null};
var _dlgClose=$('#dlgClose'); if(_dlgClose) _dlgClose.addEventListener('click',function(){ if(dlg) dlg.close(); });
var _dlgValidate=$('#dlgValidate'); if(_dlgValidate) _dlgValidate.addEventListener('click',onValidateAdjust);

async function openAdjustDialog(opts){
  opts=opts||{}; var code=opts.code||null, type=opts.type||'add';
  if(!code){ code=prompt('Code ?'); if(!code) return; }
  var item=(await dbGet(code))||(await dbGet(code.toUpperCase()))||(await dbGet(code.toLowerCase())); if(!item){ alert('Introuvable'); return; }
  dlgState.code=item.code; if(dlgType) dlgType.value=type; if(dlgQty) dlgQty.value=1; if(dlgNote) dlgNote.value=''; if(dlgItem) dlgItem.textContent=item.name+' ('+item.code+') — Stock actuel: '+item.qty;
  if(dlg && dlg.showModal) dlg.showModal();
}
async function onValidateAdjust(){
  var type=dlgType?dlgType.value:'add';
  var qty=Math.max(1,parseInt((dlgQty&&dlgQty.value)||'1',10));
  var note=(dlgNote&&dlgNote.value)||'';
  var item=await dbGet(dlgState.code); if(!item){ if(dlg) dlg.close(); return; }
  var delta=(type==='add')?qty:-qty;
  await dbAdjustQty(item.code,delta);
  await dbAddMove({ts:Date.now(),type:(type==='add'?'ENTRY':'EXIT'),code:item.code,name:item.name,qty:qty,note:note});
  announce((type==='add'?'Ajout':'Retrait')+': '+qty+' → '+item.name);
  if(dlg) dlg.close(); await refreshTable(ensureType(item)); await refreshHome();
}

/* ---------- Création (Stock / Atelier) ---------- */
var newItemDialog=$('#newItemDialog');
var niTitle=$('#niTitle'), niType=$('#niType'), niName=$('#niName'), niCode=$('#niCode'),
    niQty=$('#niQty'), niThr=$('#niThr'),
    niLocSelect=$('#niLocSelect'), niLocCustom=$('#niLocCustom'), niLocCustomWrap=$('#niLocCustomWrap'), niLocChips=$('#niLocChips'),
    niTagChecks=$('#niTagChecks'), niTagsExtra=$('#niTagsExtra'), niTagCat=$('#niTagCategory'),
    niLinks=$('#niLinks');
var _niGen=$('#niGen'); if(_niGen) _niGen.addEventListener('click',async function(){ var n=niName.value.trim(); if(!n) return; niCode.value=await generateCodeFromName(n); });
if(niName) niName.addEventListener('blur',async function(){ var n=niName.value.trim(); if(!niCode.value.trim()&&n){ niCode.value=await generateCodeFromName(n);} });
var _niTagsClear=$('#niTagsClear'); if(_niTagsClear) _niTagsClear.addEventListener('click',function(){ if(!niTagChecks) return; niTagChecks.querySelectorAll('input[type="checkbox"]').forEach(function(cb){ cb.checked=false; }); });

async function openNewDialog(type){
  type=type||'stock';
  if(niType) niType.value=type;
  if(niTitle) niTitle.textContent=(type==='atelier'?'Nouveau matériel (Atelier)':'Nouvel article (Stock)');
  if(niTagCat) niTagCat.textContent=(type==='atelier'?'Atelier':'Stock');

  var items=await dbList();
  var locsExisting=Array.from(new Set(items.map(function(i){return i.location;}).filter(Boolean))).sort();
  var set=await dbGetSettings();
  var defaultsLocs=(type==='atelier'?((set&&set.defaultLocationsAtelier)||[]):((set&&set.defaultLocationsStock)||[]));
  var defaultsTags=(type==='atelier'?((set&&set.defaultTagsAtelier)||[]):((set&&set.defaultTagsStock)||[]));

  var combined=Array.from(new Set([].concat(defaultsLocs, locsExisting))).filter(Boolean);
  if(niLocSelect){
    var opts=['<option value="">— Sélectionner —</option>']
      .concat(combined.map(function(l){return '<option value="'+esc(l)+'">'+esc(l)+'</option>'; }))
      .concat(['<option value="__custom__">➕ Saisir personnalisé…</option>']);
    niLocSelect.innerHTML=opts.join('');
    niLocSelect.value='';
    if(niLocCustomWrap) niLocCustomWrap.hidden=true;
    if(niLocCustom) niLocCustom.value='';
    niLocSelect.onchange=function(){
      if(niLocSelect.value==='__custom__'){ if(niLocCustomWrap) niLocCustomWrap.hidden=false; if(niLocCustom) niLocCustom.focus(); }
      else { if(niLocCustomWrap) niLocCustomWrap.hidden=true; }
    };
  }

  if(niLocChips){
    niLocChips.innerHTML=(defaultsLocs||[]).map(function(l){return '<button type="button" class="chip" data-loc="'+esc(l)+'">'+esc(l)+'</button>';}).join('');
    niLocChips.querySelectorAll('button[data-loc]').forEach(function(b){
      b.addEventListener('click',function(){
        var val=b.getAttribute('data-loc')||'';
        var opt = niLocSelect ? niLocSelect.querySelector('option[value="'+cssEscapeCompat(val)+'"]') : null;
        if(niLocSelect && opt){
          niLocSelect.value=val; if(niLocCustomWrap) niLocCustomWrap.hidden=true;
        }else{
          if(niLocSelect) niLocSelect.value='__custom__';
          if(niLocCustomWrap) niLocCustomWrap.hidden=false;
          if(niLocCustom) niLocCustom.value=val;
          if(niLocCustom) niLocCustom.focus();
        }
      });
    });
  }

  if(niTagChecks){
    niTagChecks.innerHTML=(defaultsTags.length?defaultsTags:[]).map(function(t){return '<label class="chip"><input type="checkbox" value="'+esc(t)+'"> '+esc(t)+'</label>';}).join('') || '<span class="muted">Aucun tag prédéfini (Paramètres)</span>';
  }

  if(niName) niName.value='';
  if(niCode) niCode.value='';
  if(niQty) niQty.value='0';
  if(niThr) niThr.value='0';
  if(niTagsExtra) niTagsExtra.value='';
  if(niLinks) niLinks.value='';
  if(newItemDialog && newItemDialog.showModal) newItemDialog.showModal();
  setTimeout(function(){ if(niName) niName.focus(); },0);
}
var _btnAddStock=$('#btnAddStock'); if(_btnAddStock) _btnAddStock.addEventListener('click',function(){ openNewDialog('stock'); });
var _btnAddAtelier=$('#btnAddAtelier'); if(_btnAddAtelier) _btnAddAtelier.addEventListener('click',function(){ openNewDialog('atelier'); });

var _niSave=$('#niSave'); if(_niSave) _niSave.addEventListener('click',async function(e){
  e.preventDefault();
  var name=niName?niName.value.trim():'', code=niCode?niCode.value.trim():'', type=(niType&&niType.value==='atelier')?'atelier':'stock';
  if(!name||!code) return;
  var qty=Math.max(0,parseInt((niQty&&niQty.value)||'0',10));
  var threshold=Math.max(0,parseInt((niThr&&niThr.value)||'0',10));
  var loc=(function(){
    var v=(niLocSelect&&niLocSelect.value)||'';
    return (v==='__custom__') ? ((niLocCustom&&niLocCustom.value.trim())||'') : (v.trim()||'');
  })();
  var checked=[]; if(niTagChecks){ niTagChecks.querySelectorAll('input[type="checkbox"]:checked').forEach(function(cb){ checked.push(cb.value); }); }
  var extras=(niTagsExtra&&niTagsExtra.value||'').split(',').map(function(t){return t.trim();}).filter(Boolean);
  var tags=Array.from(new Set([].concat(checked, extras)));
  var links=(niLinks&&niLinks.value||'').split(/\n+/).map(function(s){return s.trim();}).filter(Boolean);
  await dbPut({id:code,code:code,name:name,qty:qty,threshold:threshold,tags:tags,location:loc,links:links,type:type,updated:Date.now()});
  if(newItemDialog) newItemDialog.close();
  announce('Créé • '+name+' ('+code+') → '+getTypeLabel(type));
  await refreshTable(type); await refreshHome();
});

/* ---------- Étiquettes ---------- */
var LABEL_TEMPLATES={
  'avery-l7159': { cols:3, rows:7, cellW:63.5, cellH:38.1, gapX:7, gapY:2.5 },
  'mm50x25':    { cols:4, rows:10, cellW:50,  cellH:25,   gapX:5, gapY:5   },
  'mm70x35':    { cols:3, rows:8,  cellW:70,  cellH:35,   gapX:5, gapY:5   }
};
var labelsInitDone=false, labelsAllItems=[], labelsSelected=new Set(), lblPage=0, lblPagesCount=1;
var labelSearch=$('#labelSearch'), labelsList=$('#labelsList'), lblSelInfo=$('#lblSelInfo'),
    lblTemplate=$('#lblTemplate'), lblDensity=$('#lblDensity'), lblNameSize=$('#lblNameSize'), lblShowText=$('#lblShowText'),
    labelsPages=$('#labelsPages'), btnLblAll=$('#lblAll'), btnLblNone=$('#lblNone'),
    btnLblPrev=$('#lblPrev'), btnLblNext=$('#lblNext'), lblPageInfo=$('#lblPageInfo'), btnLabelsPrint=$('#btnLabelsPrint');

function initLabelsPanel(){ if(!labelsInitDone){ bindLabelsUI(); labelsInitDone=true; } loadLabelsData().then(function(){ rebuildLabelsList(); rebuildLabelsPreview(true); }); }
async function loadLabelsData(){ labelsAllItems=await dbList(); if(labelsSelected.size===0){ labelsAllItems.forEach(function(i){ labelsSelected.add(i.code); }); } }
function bindLabelsUI(){
  if(labelSearch) labelSearch.addEventListener('input',function(){ rebuildLabelsList(); });
  if(btnLblAll) btnLblAll.addEventListener('click',function(){ labelsAllItems.forEach(function(i){ labelsSelected.add(i.code); }); rebuildLabelsList(); rebuildLabelsPreview(true); });
  if(btnLblNone) btnLblNone.addEventListener('click',function(){ labelsSelected.clear(); rebuildLabelsList(); rebuildLabelsPreview(true); });
  if(lblTemplate) lblTemplate.addEventListener('change',function(){ rebuildLabelsPreview(true); });
  if(lblDensity) lblDensity.addEventListener('change',function(){ rebuildLabelsPreview(false); });
  if(lblNameSize) lblNameSize.addEventListener('change',function(){ rebuildLabelsPreview(false); });
  if(lblShowText) lblShowText.addEventListener('change',function(){ rebuildLabelsPreview(false); });
  if(btnLblPrev) btnLblPrev.addEventListener('click',function(){ if(lblPage>0){ lblPage--; updatePaginationDisplay(); } });
  if(btnLblNext) btnLblNext.addEventListener('click',function(){ if(lblPage<lblPagesCount-1){ lblPage++; updatePaginationDisplay(); } });
  if(btnLabelsPrint) btnLabelsPrint.addEventListener('click',function(){ window.print(); });
}
function rebuildLabelsList(){
  var q=(labelSearch&&labelSearch.value||'').toLowerCase();
  if(labelsList){
    labelsList.innerHTML = labelsAllItems.filter(function(i){ return !q || [i.name,i.code,(i.tags||[]).join(' ')].join(' ').toLowerCase().includes(q); })
      .map(function(i){ return '<div class="row"><label style="display:flex;align-items:center;gap:.5rem;flex:1"><input type="checkbox" class="lblRow" data-code="'+esc(i.code)+'" '+(labelsSelected.has(i.code)?'checked':'')+'> <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(i.name)+'</span></label><code>'+esc(i.code)+'</code></div>'; }).join('');
    labelsList.querySelectorAll('.lblRow').forEach(function(cb){
      cb.addEventListener('change',function(){ var code=cb.dataset.code; if(cb.checked) labelsSelected.add(code); else labelsSelected.delete(code); updateLblSelInfo(); rebuildLabelsPreview(true); });
    });
  }
  updateLblSelInfo();
}
function updateLblSelInfo(){ if(lblSelInfo) lblSelInfo.textContent=labelsSelected.size+' sélection(s)'; }
function chunkArray(arr, size){ var out=[]; for(var i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out; }
function mm(n){ return n+'mm'; }
function rebuildLabelsPreview(resetPage){
  var tmpl=LABEL_TEMPLATES[(lblTemplate&&lblTemplate.value)||'avery-l7159'];
  var module=parseFloat((lblDensity&&lblDensity.value)||'2');
  var namePt=parseInt((lblNameSize&&lblNameSize.value)||'11',10);
  var showText=!!(lblShowText&&lblShowText.checked);

  var selectedItems=labelsAllItems.filter(function(i){ return labelsSelected.has(i.code); });
  var perPage=(tmpl.cols|0)*(tmpl.rows|0);
  var pages=chunkArray(selectedItems, perPage);

  if(labelsPages) labelsPages.innerHTML='';
  pages.forEach(function(items,pageIndex){
    var page=document.createElement('div'); page.className='labels-page'; page.dataset.index=String(pageIndex);
    var sheet=document.createElement('div'); sheet.className='labels-sheet';
    sheet.style.gridTemplateColumns='repeat('+tmpl.cols+', '+mm(tmpl.cellW)+')';
    sheet.style.gridAutoRows=mm(tmpl.cellH);
    sheet.style.columnGap=mm(tmpl.gapX);
    sheet.style.rowGap=mm(tmpl.gapY);

    items.forEach(function(it){
      var card=document.createElement('div'); card.className='label-card';
      var name=document.createElement('div'); name.className='name'; name.textContent=it.name; name.style.fontSize=namePt+'pt'; card.appendChild(name);
      var hr=document.createElement('div'); hr.className='hr'; hr.textContent=it.code; card.appendChild(hr);
      var svg=(window.code39 && window.code39.svg) ? window.code39.svg(it.code,{module:module,height:52,margin:4,showText:showText,fontSize:10}) : document.createElementNS('http://www.w3.org/2000/svg','svg');
      card.appendChild(svg);
      sheet.appendChild(card);
    });

    var rest=perPage-items.length;
    for(var k=0;k<rest;k++){ var empty=document.createElement('div'); empty.className='label-card'; empty.style.border='1px dashed transparent'; sheet.appendChild(empty); }
    page.appendChild(sheet);
    if(labelsPages) labelsPages.appendChild(page);
  });

  lblPagesCount=Math.max(1, pages.length||1);
  if(resetPage) lblPage=0;
  updatePaginationDisplay();
}
function updatePaginationDisplay(){
  var pages=$$('.labels-page', labelsPages);
  pages.forEach(function(p,i){ p.classList.toggle('active', i===lblPage); });
  var el=$('#lblPageInfo'); if(el) el.textContent='Page '+Math.min(lblPage+1,lblPagesCount)+' / '+lblPagesCount;
  var prev=$('#lblPrev'); if(prev) prev.disabled=(lblPage<=0);
  var next=$('#lblNext'); if(next) next.disabled=(lblPage>=lblPagesCount-1);
}
async function labelsSelectCodes(codes){
  await loadLabelsData();
  labelsSelected=new Set((codes||[]).filter(Boolean));
  rebuildLabelsList();
  rebuildLabelsPreview(true);
}

/* ---------- Journal ---------- */
var journalTbody=$('#journalTbody');
var _btnFilterJournal=$('#btnFilterJournal'); if(_btnFilterJournal) _btnFilterJournal.addEventListener('click',refreshJournal);
var _btnExportCSV=$('#btnExportCSV'); if(_btnExportCSV) _btnExportCSV.addEventListener('click',async function(){ var data=await dbExport('csv'); downloadFile('journal.csv',data,'text/csv'); });
var _btnExportJSON=$('#btnExportJSON'); if(_btnExportJSON) _btnExportJSON.addEventListener('click',async function(){ var data=await dbExport('json'); downloadFile('journal.json',data,'application/json'); });
async function refreshJournal(){
  var from=($('#dateFrom') && $('#dateFrom').value) ? new Date($('#dateFrom').value).getTime() : 0;
  var to=($('#dateTo') && $('#dateTo').value) ? (new Date($('#dateTo').value).getTime()+24*3600*1000) : Infinity;
  var list=await dbListMoves({from:from,to:to,limit:1000});
  if(journalTbody){
    journalTbody.innerHTML = list.map(function(m){ return '<tr><td>'+new Date(m.ts).toLocaleString()+'</td><td>'+m.type+'</td><td><code>'+esc(m.code)+'</code></td><td>'+esc(m.name||'')+'</td><td>'+m.qty+'</td><td>'+esc(m.note||'')+'</td></tr>'; }).join('')
      || '<tr><td colspan="6" class="muted">Aucun mouvement</td></tr>';
  }
}

/* ---------- Prêts ---------- */
var loansTbody=$('#loansTbody');
var _btnNewLoan=$('#btnNewLoan'); if(_btnNewLoan) _btnNewLoan.addEventListener('click',async function(){
  var code=prompt('Code article ?'); if(!code) return;
  var it=(await dbGet(code))||(await dbGet(code.toUpperCase()))||(await dbGet(code.toLowerCase())); if(!it) return alert('Article introuvable');
  var person=prompt('Nom emprunteur ?'); if(!person) return;
  var due=prompt('Date prévue retour (YYYY-MM-DD) ?'); if(!due) return;
  var note=prompt('Note (optionnel)')||''; await dbCreateLoan({code:it.code,name:it.name,person:person,due:due,note:note});
  announce('Prêt créé → '+person); await refreshLoansTable(); await refreshHome();
});
var _searchLoans=$('#searchLoans'); if(_searchLoans) _searchLoans.addEventListener('input',refreshLoansTable);
async function refreshLoansTable(){
  if(!loansTbody) return;
  var q=(_searchLoans && _searchLoans.value || '').toLowerCase();
  var loans=await dbListLoans(true);
  loansTbody.innerHTML = loans.filter(function(l){ return !q || [l.person,l.code,l.name].join(' ').toLowerCase().includes(q); }).map(function(l){
    var overdue = l.returnedAt ? false : (Date.now()>new Date(l.due).getTime());
    return '<tr><td>'+esc(l.name||'')+'</td><td><code>'+esc(l.code)+'</code></td><td>'+esc(l.person||'')+'</td><td>'+esc(l.due||'')+'</td><td>'+(l.returnedAt?'<span class="badge low">Clos</span>':(overdue?'<span class="badge under">En retard</span>':'<span class="badge ok">Actif</span>'))+'</td><td>'+(l.returnedAt?'<span class="muted">—</span>':'<button class="btn" data-return="'+l.id+'">✅ Retour</button>')+'</td></tr>';
  }).join('') || '<tr><td colspan="6" class="muted">Aucun emprunt</td></tr>';
  loansTbody.querySelectorAll('button[data-return]').forEach(function(btn){
    btn.onclick=async function(){ var id=btn.getAttribute('data-return'); await dbReturnLoan(id); announce('Matériel retourné'); await refreshLoansTable(); await refreshHome(); };
  });
}

/* ---------- Paramètres : Listes triables Tags/Emplacements ---------- */
function makeSortable(listEl, onUpdate){
  var dragEl=null, startIndex=-1;
  listEl.addEventListener('dragstart',function(e){
    var li=e.target.closest('li'); if(!li) return;
    dragEl=li; startIndex=[].indexOf.call(listEl.children, li);
    e.dataTransfer.effectAllowed='move';
    try{ e.dataTransfer.setData('text/plain', li.dataset.value||''); }catch(_){}
    li.style.opacity='0.5';
  });
  listEl.addEventListener('dragend',function(){ if(dragEl){ dragEl.style.opacity=''; dragEl=null; } });
  listEl.addEventListener('dragover',function(e){ e.preventDefault(); var li=e.target.closest('li'); if(!li||li===dragEl) return;
    var rect=li.getBoundingClientRect(); var before=(e.clientY - rect.top) < rect.height/2;
    if(before) listEl.insertBefore(dragEl, li); else listEl.insertBefore(dragEl, li.nextSibling);
  });
  listEl.addEventListener('drop',function(e){ e.preventDefault(); if(typeof onUpdate==='function') onUpdate(); });
}
function renderList(listId, items, kind){
  var ul=$(listId); if(!ul) return;
  ul.innerHTML = (items||[]).map(function(v,i){
    return '<li draggable="true" data-value="'+esc(v)+'">'
      +'<span class="drag" title="Glisser pour trier">≡</span>'
      +'<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(v)+'</span>'
      +'<button class="btn" data-del="'+i+'">🗑️</button>'
    +'</li>';
  }).join('');
  ul.querySelectorAll('button[data-del]').forEach(function(b){
    b.addEventListener('click',function(){
      var idx=parseInt(b.getAttribute('data-del'),10)|0;
      items.splice(idx,1); renderList(listId, items, kind); updateCounts();
    });
  });
  makeSortable(ul, function(){ updateCounts(); });
}
function valuesFromList(listId){
  var ul=$(listId); if(!ul) return [];
  return Array.from(ul.querySelectorAll('li')).map(function(li){ return li.dataset.value||li.textContent.trim(); }).filter(Boolean);
}
function attachAdd(inputId, btnId, listId, items){
  var input=$(inputId), btn=$(btnId);
  function add(){
    var v=(input && input.value || '').trim(); if(!v) return;
    if(items.indexOf(v)>=0) { input.value=''; return; }
    items.push(v); renderList(listId, items); if(input){ input.value=''; input.focus(); } updateCounts();
  }
  if(btn) btn.addEventListener('click', add);
  if(input) input.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); add(); } });
}
function updateCounts(){
  var el;
  el=$('#countTagsStock'); if(el){ var arr=valuesFromList('#listTagsStock'); el.textContent=String(arr.length); }
  el=$('#countTagsAtelier'); if(el){ var arr2=valuesFromList('#listTagsAtelier'); el.textContent=String(arr2.length); }
  el=$('#countLocsStock'); if(el){ var arr3=valuesFromList('#listLocsStock'); el.textContent=String(arr3.length); }
  el=$('#countLocsAtelier'); if(el){ var arr4=valuesFromList('#listLocsAtelier'); el.textContent=String(arr4.length); }
}

/* Chargement + sauvegarde Paramètres */
var _btnExportFull=$('#btnExportFull'); if(_btnExportFull) _btnExportFull.addEventListener('click',async function(){ var blob=await dbExportFull(); var text=JSON.stringify(blob,null,2); downloadFile('gstock-export.json',text,'application/json'); });
var _btnImportJSON=$('#btnImportJSON'); if(_btnImportJSON) _btnImportJSON.addEventListener('click',async function(){
  try{
    if(!window.showOpenFilePicker) throw new Error('File Picker non supporté');
    var handles=await window.showOpenFilePicker({types:[{description:'JSON',accept:{'application/json':['.json']}}]});
    var f=await handles[0].getFile(); var text=await f.text(); var data=JSON.parse(text);
    await dbImportFull(data); announce('Import terminé'); await refreshHome(); await refreshTable('stock'); await refreshTable('atelier');
  }catch(e){ console.warn(e); alert('Import annulé / invalide'); }
});
var sharedFileStatus=$('#sharedFileStatus');
var _btnLinkSharedFile=$('#btnLinkSharedFile'); if(_btnLinkSharedFile) _btnLinkSharedFile.addEventListener('click',async function(){
  if(!('showSaveFilePicker' in window)) return alert('File System Access API non supportée.');
  var handle=await showSaveFilePicker({suggestedName:'gstock-shared.json',types:[{description:'JSON',accept:{'application/json':['.json']}}]});
  await dbLinkSharedFile(handle); if(sharedFileStatus) sharedFileStatus.textContent='Fichier partagé lié (autosave activé)';
});
var _btnResetCache=$('#btnResetCache'); if(_btnResetCache) _btnResetCache.addEventListener('click',async function(){
  if(!confirm('Réinitialiser cache PWA et recharger ?')) return;
  try{ var regs=await (navigator.serviceWorker && navigator.serviceWorker.getRegistrations ? navigator.serviceWorker.getRegistrations() : []); await Promise.all(regs.map(function(r){return r.unregister();})); }catch(e){}
  try{ var keys=await (window.caches && caches.keys ? caches.keys() : []); await Promise.all(keys.map(function(k){return caches.delete(k);})); }catch(e){}
  location.reload();
});

function initSettingsPanel(){
  (async function(){
    var set=await dbGetSettings(); set=set||{};
    /* Lists initiales */
    var tagsStock = (set.defaultTagsStock||[]).slice();
    var tagsAtelier = (set.defaultTagsAtelier||[]).slice();
    var locsStock = (set.defaultLocationsStock||[]).slice();
    var locsAtelier = (set.defaultLocationsAtelier||[]).slice();

    renderList('#listTagsStock', tagsStock, 'tag');
    renderList('#listTagsAtelier', tagsAtelier, 'tag');
    renderList('#listLocsStock', locsStock, 'loc');
    renderList('#listLocsAtelier', locsAtelier, 'loc');
    updateCounts();

    attachAdd('#addTagStock','#btnAddTagStock','#listTagsStock',tagsStock);
    attachAdd('#addTagAtelier','#btnAddTagAtelier','#listTagsAtelier',tagsAtelier);
    attachAdd('#addLocStock','#btnAddLocStock','#listLocsStock',locsStock);
    attachAdd('#addLocAtelier','#btnAddLocAtelier','#listLocsAtelier',locsAtelier);

    var el=$('#inputBuffer'); if(el) el.value = set.buffer|0;

    var chkDebug=$('#chkDebug'); 
    var apply=function(en){ window.GSTOCK_DEBUG=!!en; localStorage.setItem('gstock.debug',en?'1':'0'); window.dispatchEvent(new CustomEvent('gstock:debug-changed',{detail:{enabled:!!en}})); };
    if(chkDebug){
      chkDebug.checked=(localStorage.getItem('gstock.debug')==='1'); apply(chkDebug.checked);
      chkDebug.addEventListener('change',function(e){ apply(e.target.checked); });
    }

    var _btnSaveSettings=$('#btnSaveSettings'); 
    if(_btnSaveSettings) _btnSaveSettings.onclick=async function(){
      var newSet={
        buffer:Math.max(0,parseInt(($('#inputBuffer')&&$('#inputBuffer').value)||'0',10)),
        defaultTagsStock: valuesFromList('#listTagsStock'),
        defaultTagsAtelier: valuesFromList('#listTagsAtelier'),
        defaultLocationsStock: valuesFromList('#listLocsStock'),
        defaultLocationsAtelier: valuesFromList('#listLocsAtelier')
      };
      await saveSettingsUniversal(Object.assign({}, set, newSet));
      announce('Paramètres enregistrés');
    };
  })();
}
async function saveSettingsUniversal(obj){
  if(typeof window.dbSaveSettings==='function') return await window.dbSaveSettings(obj);
  if(typeof window.dbSetSettings==='function') return await window.dbSetSettings(obj);
  if(typeof window.dbPutSettings==='function') return await window.dbPutSettings(obj);
  console.warn('Aucune fonction de sauvegarde des paramètres trouvée dans db.js');
  alert('Mise à jour de js/db.js requise : fonction de sauvegarde des paramètres absente.');
}

/* ---------- Scanner (onglet Scanner) ---------- */
var videoEl=$('#scanVideo'), btnScanStart=$('#btnScanStart'), btnScanStop=$('#btnScanStop'), btnScanTorch=$('#btnScanTorch'), scanHint=$('#scanHint');
var scanStream=null, scanTrack=null, scanDetector=null, scanLoopId=0, torchOn=false;
var lastCode='', lastReadTs=0; var DUP_MS=1200;
function beepKnown(ms,hz){
  ms = ms||140; hz=hz||880;
  try{
    var AC=window.AudioContext||window.webkitAudioContext; if(!AC) return;
    var ctx=new AC(); var o=ctx.createOscillator(), g=ctx.createGain();
    o.frequency.value=hz; o.type='sine'; o.connect(g); g.connect(ctx.destination); o.start();
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+ms/1000);
    setTimeout(function(){ o.stop(); ctx.close(); }, ms+60);
  }catch(_){}
}
async function ensureDetector(){
  if(!('BarcodeDetector' in window)) throw new Error('BarcodeDetector non supporté');
  var fmts=['ean_13','code_128','code_39','qr_code','ean_8','upc_a','upc_e','itf','codabar','pdf417'];
  var supported=[];
  try{
    if(window.BarcodeDetector && typeof window.BarcodeDetector.getSupportedFormats==='function'){
      supported = await window.BarcodeDetector.getSupportedFormats();
    }
  }catch(_){}
  if(Array.isArray(supported) && supported.length) fmts = fmts.filter(function(f){return supported.indexOf(f)>=0;});
  scanDetector = new window.BarcodeDetector({formats: fmts});
}
async function startScan(){
  try{
    var constraints={ video:{ facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720} }, audio:false };
    scanStream = await navigator.mediaDevices.getUserMedia(constraints);
    if(videoEl){ videoEl.srcObject=scanStream; await videoEl.play(); }
    scanTrack = scanStream.getVideoTracks()[0];
    var caps = (scanTrack && typeof scanTrack.getCapabilities==='function') ? scanTrack.getCapabilities() : {};
    if(btnScanTorch) btnScanTorch.disabled=!caps.torch; torchOn=false;
    await ensureDetector();
    lastCode=''; lastReadTs=0; if(scanHint) scanHint.textContent='Visez le code-barres...';
    runDetectLoop();
  }catch(err){
    console.warn('startScan error', err);
    if(scanHint) scanHint.textContent = (String(err).indexOf('BarcodeDetector')>=0) ? 'Scanner non supporté (Chrome/Edge, HTTPS conseillé).' : 'Accès caméra impossible (HTTPS/permissions).';
    stopScan();
  }
}
function stopScan(){
  if(scanLoopId){ cancelAnimationFrame(scanLoopId); scanLoopId=0; }
  try{ if(videoEl && videoEl.pause) videoEl.pause(); }catch(_){}
  if(scanTrack){ try{ scanTrack.stop(); }catch(_){} scanTrack=null; }
  if(scanStream){ try{ scanStream.getTracks().forEach(function(t){ t.stop(); }); }catch(_){} scanStream=null; }
  if(videoEl) videoEl.srcObject=null;
  if(btnScanTorch) btnScanTorch.disabled=true; torchOn=false;
}
async function runDetectLoop(){
  var step=async function(){
    if(!scanDetector || !videoEl || !scanStream){ return; }
    try{
      var codes=await scanDetector.detect(videoEl);
      if(Array.isArray(codes) && codes.length){
        var raw=(codes[0].rawValue||'').trim(); var now=Date.now();
        if(raw && (raw!==lastCode || (now-lastReadTs)>DUP_MS)){
          lastCode=raw; lastReadTs=now;
          var item=(await dbGet(raw))||(await dbGet(raw.toUpperCase()))||(await dbGet(raw.toLowerCase()));
          if(item){
            beepKnown(); stopScan(); await openAdjustDialog({code:item.code, type:'add'}); return;
          }else{
            if(scanHint) scanHint.textContent='Code inconnu : '+raw+' — on continue...';
          }
        }
      }
    }catch(err){ if(window.GSTOCK_DEBUG) console.debug('detect error', err); }
    scanLoopId = requestAnimationFrame(step);
  };
  scanLoopId=requestAnimationFrame(step);
}
if(btnScanStart) btnScanStart.addEventListener('click',startScan);
if(btnScanStop) btnScanStop.addEventListener('click',stopScan);
if(btnScanTorch) btnScanTorch.addEventListener('click',async function(){
  if(!scanTrack) return; var caps=(scanTrack && typeof scanTrack.getCapabilities==='function')?scanTrack.getCapabilities():{};
  if(!caps.torch) return; torchOn=!torchOn; try{ await scanTrack.applyConstraints({advanced:[{torch:torchOn}]}); }catch(e){ torchOn=false; }
});

/* ---------- Scan Emprunt/Retour ---------- */
var loanDlg=$('#loanScanDialog'), loanVideo=$('#loanVideo'), loanScanTitle=$('#loanScanTitle'), loanScanHint=$('#loanScanHint'), btnLoanTorch=$('#btnLoanTorch'), btnLoanStop=$('#btnLoanStop');
var loanStream=null, loanTrack=null, loanLoop=0, loanMode='borrow';
var _btnScanBorrow=$('#btnScanBorrow'); if(_btnScanBorrow) _btnScanBorrow.addEventListener('click',function(){ startLoanScan('borrow'); });
var _btnScanReturn=$('#btnScanReturn'); if(_btnScanReturn) _btnScanReturn.addEventListener('click',function(){ startLoanScan('return'); });
if(btnLoanStop) btnLoanStop.addEventListener('click',stopLoanScan);
if(btnLoanTorch) btnLoanTorch.addEventListener('click',async function(){
  if(!loanTrack) return; var caps=(loanTrack && typeof loanTrack.getCapabilities==='function')?loanTrack.getCapabilities():{};
  if(!caps.torch) return; var on=!loanTrack._torchOn; try{ await loanTrack.applyConstraints({advanced:[{torch:on}]}); loanTrack._torchOn=on; }catch(_){ loanTrack._torchOn=false; }
});

async function startLoanScan(mode){
  loanMode=mode||'borrow'; if(loanScanTitle) loanScanTitle.textContent=(loanMode==='borrow'?'Scanner un emprunt':'Scanner un retour');
  try{
    var constraints={ video:{ facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720} }, audio:false };
    loanStream = await navigator.mediaDevices.getUserMedia(constraints);
    if(loanVideo){ loanVideo.srcObject=loanStream; await loanVideo.play(); }
    loanTrack = loanStream.getVideoTracks()[0];
    var caps=(loanTrack && typeof loanTrack.getCapabilities==='function')?loanTrack.getCapabilities():{};
    if(btnLoanTorch) btnLoanTorch.disabled=!caps.torch; loanTrack._torchOn=false;
    await ensureDetector();
    if(loanScanHint) loanScanHint.textContent='Visez le code-barres...';
    if(loanDlg && loanDlg.showModal) loanDlg.showModal();
    runLoanLoop();
  }catch(err){ console.warn('loan scan error', err); alert('Caméra indisponible ou navigateur non supporté.'); }
}
function stopLoanScan(){
  if(loanLoop){ cancelAnimationFrame(loanLoop); loanLoop=0; }
  try{ if(loanVideo && loanVideo.pause) loanVideo.pause(); }catch(_){}
  if(loanTrack){ try{ loanTrack.stop(); }catch(_){} loanTrack=null; }
  if(loanStream){ try{ loanStream.getTracks().forEach(function(t){ t.stop(); }); }catch(_){} loanStream=null; }
  if(loanVideo) loanVideo.srcObject=null; try{ if(loanDlg) loanDlg.close(); }catch(_){}
}
async function runLoanLoop(){
  var step=async function(){
    if(!scanDetector || !loanVideo || !loanStream) return;
    try{
      var codes=await scanDetector.detect(loanVideo);
      if(Array.isArray(codes) && codes.length){
        var raw=(codes[0].rawValue||'').trim();
        if(raw){
          var it=(await dbGet(raw))||(await dbGet(raw.toUpperCase()))||(await dbGet(raw.toLowerCase()));
          if(!it){ if(loanScanHint) loanScanHint.textContent='Code inconnu : '+raw; loanLoop=requestAnimationFrame(step); return; }
          beepKnown();
          if(loanMode==='borrow'){ stopLoanScan(); openBorrowDialog(it); return; }
          else{
            var loans=await dbListLoans(true);
            var active=loans.find(function(l){return l.code===it.code && !l.returnedAt;});
            if(active){ await dbReturnLoan(active.id); announce('Retour enregistré • '+it.name); await refreshLoansTable(); await refreshHome(); stopLoanScan(); return; }
            if(loanScanHint) loanScanHint.textContent='Aucun prêt actif pour ce code — on continue...';
          }
        }
      }
    }catch(err){ if(window.GSTOCK_DEBUG) console.debug('loan detect err', err); }
    loanLoop=requestAnimationFrame(step);
  };
  loanLoop=requestAnimationFrame(step);
}

/* Dialog emprunt (après scan) */
var borrowDlg=$('#borrowDialog'), borrowItem=$('#borrowItem'), brwPerson=$('#brwPerson'), brwDue=$('#brwDue'), brwNote=$('#brwNote'), brwCreate=$('#brwCreate');
var borrowCurrent=null;
function openBorrowDialog(item){
  borrowCurrent=item; if(borrowItem) borrowItem.textContent=item.name+' ('+item.code+')';
  if(brwPerson) brwPerson.value=''; if(brwDue) brwDue.value=''; if(brwNote) brwNote.value='';
  if(borrowDlg && borrowDlg.showModal) borrowDlg.showModal();
}
if(brwCreate) brwCreate.addEventListener('click',async function(e){
  e.preventDefault(); if(!borrowCurrent){ if(borrowDlg) borrowDlg.close(); return; }
  var person=(brwPerson&&brwPerson.value.trim())||''; var due=(brwDue&&brwDue.value)||''; var note=(brwNote&&brwNote.value)||'';
  if(!person||!due){ alert('Emprunteur et date de retour requis.'); return; }
  await dbCreateLoan({code:borrowCurrent.code,name:borrowCurrent.name,person:person,due:due,note:note});
  announce('Prêt créé'); if(borrowDlg) borrowDlg.close(); await refreshLoansTable(); await refreshHome();
});

/* ---------- Init ---------- */
(async function init(){
  var v=$('#appVersion'); if(v) v.textContent=window.APP_VERSION||'';
  if(typeof window.dbSaveSettings!=='function' && typeof window.dbSetSettings==='function'){ window.dbSaveSettings = window.dbSetSettings; }
  await dbInit();
  await refreshHome();
  showTab('home');
})();
})();
