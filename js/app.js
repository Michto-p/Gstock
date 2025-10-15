/* Gstock - app.js v2.9.5 */
(function(){'use strict';
/* -------- utilitaires / base -------- */
function $(s,r){return (r||document).querySelector(s);}
function $$(s,r){return Array.from((r||document).querySelectorAll(s));}
function show(el,on){ if(!el) return; el.hidden = !on; }
var sr=$('#sr');
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function announce(msg){ if(sr){ sr.textContent=''; setTimeout(()=>{ sr.textContent=msg; },10);} }
function downloadFile(name,data,type){ var blob=new Blob([data],{type:type}); var url=URL.createObjectURL(blob); var a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),2000); }
function debounced(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }

/* purge ?safe=1 */
(async()=>{ try{ const qs=new URLSearchParams(location.search); if(qs.has('safe')){ try{ await (window.dbNuke?window.dbNuke(false):Promise.resolve()); }catch(e){} try{ const regs=await (navigator.serviceWorker?.getRegistrations?.()||[]); await Promise.all(regs.map(r=>r.unregister())); }catch(e){} try{ const keys=await (caches?.keys?.()||[]); await Promise.all(keys.map(k=>caches.delete(k))); }catch(e){} location.replace(location.pathname+'?bust='+Date.now()); return; } }catch(e){} })();

/* thème */
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

/* tabs */
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

/* règles code */
const CODE_RULES=Object.freeze({ maxLen:10, uppercase:true, alnumOnly:true, prefix:'' });
function deaccent(s){ try{return s.normalize('NFD').replace(/\p{Diacritic}/gu,'');}catch(_){return s;} }
function nameToCode(name){
  var stop=new Set(['le','la','les','des','du','de','d','l','un','une','pour','et','sur','avec','en','à','au','aux','the','of','for']);
  var parts=deaccent(String(name)).replace(/[^A-Za-z0-9]+/g,' ').trim().split(/\s+/);
  if(!parts.length) return 'ITM'+Math.floor(100000+Math.random()*899999);
  var brand=parts.length>1?parts[parts.length-1]:'';
  var brandShort=brand?(brand.slice(0,3).toLowerCase()):'';
  brandShort=brandShort?(brandShort[0].toUpperCase()+brandShort.slice(1)):'';
  var base=[]; for(let i=0;i<parts.length-(brand?1:0);i++){
    let t=parts[i], low=t.toLowerCase();
    if(stop.has(low))continue;
    if(/^\d+$/.test(t)){base.push(t);continue;}
    base.push((t.length>=4?t.slice(0,4):t).toLowerCase());
  }
  return base.join('')+brandShort;
}
function normalizeCode(raw){
  if(!raw) return '';
  let s=deaccent(String(raw));
  if(CODE_RULES.alnumOnly) s=s.replace(/[^A-Za-z0-9]/g,'');
  if(CODE_RULES.uppercase) s=s.toUpperCase();
  if(CODE_RULES.prefix) s=CODE_RULES.prefix+s;
  if(s.length>CODE_RULES.maxLen) s=s.slice(0,CODE_RULES.maxLen);
  return s;
}
function makeCodeBaseFromName(n){ let b=nameToCode(n||''); b=normalizeCode(b); if(!b) b=normalizeCode('ITM'+Math.floor(Math.random()*1e6)); return b; }
async function makeUniqueCode(base){ if(!(await getByCodeAnyCase(base))) return base; for(let n=2;n<10000;n++){ let s=''+n, head=base.slice(0,CODE_RULES.maxLen-s.length), cand=head+s; if(!(await getByCodeAnyCase(cand))) return cand; } return base.slice(0,CODE_RULES.maxLen); }
async function generateCodeFromName(n){ return await makeUniqueCode(makeCodeBaseFromName(n)); }
async function getByCodeAnyCase(raw){ if(!raw) return null; const exact=await dbGet(raw); if(exact) return exact; const low=String(raw).toLowerCase(); const all=await dbList(); return all.find(i=>(String(i.code||'')).toLowerCase()===low)||null; }

/* Accueil */
async function refreshHome(){
  var items=await dbList();
  var set=await dbGetSettings(); var buf=(set&&set.buffer|0);

  const exhausted=items.filter(i=>(i.qty|0)===0).sort((a,b)=>a.name.localeCompare(b.name));
  const under=items.filter(i=>(i.qty|0)>0 && (i.qty|0)<=(i.threshold|0)).sort((a,b)=>a.name.localeCompare(b.name));
  const low=items.filter(i=> (i.qty|0)>(i.threshold|0) && ((i.qty|0)-(i.threshold|0))<=buf ).sort((a,b)=>a.name.localeCompare(b.name));

  $('#kpiItems').textContent=String(items.length);
  $('#kpiQty').textContent=String(items.reduce((s,i)=>s+(i.qty|0),0));
  $('#kpiUnder').textContent=String(exhausted.length + under.length);
  $('#kpiLow').textContent=String(low.length);

  const loans=await dbListLoans(true); 
  $('#kpiLoansActive').textContent=String(loans.filter(l=>!l.returnedAt).length);
  $('#kpiLoansOverdue').textContent=String(loans.filter(l=>!l.returnedAt && Date.now()>new Date(l.due).getTime()).length);

  function renderList(ulSel, arr, empty){
    const ul=$(ulSel);
    ul.innerHTML = (arr.slice(0,30).map(i=>{
      const q=i.qty|0, th=i.threshold|0;
      return `<li>• <strong>${esc(i.name)}</strong> <span class="muted">(<code>${esc(i.code)}</code>)</span> — q=${q} / seuil=${th}</li>`;
    }).join('')) || `<li class="muted">${empty}</li>`;
  }
  renderList('#homeExhausted', exhausted, 'Aucun article épuisé');
  renderList('#homeUnder', under, 'Aucun article sous le seuil');
  renderList('#homeLow', low, 'Aucun article en approche');

  const recent=await dbListMoves({from:0,to:Infinity,limit:8});
  $('#recentMoves').innerHTML=(recent.map(m=>`<li>${new Date(m.ts).toLocaleString()} • <strong>${esc(m.type)}</strong> <code>${esc(m.code)}</code> ×${m.qty}</li>`).join(''))||'<li class="muted">Aucun mouvement</li>';
}

/* statut */
function ensureType(it){ return it.type||'stock'; }
function statusBadge(it, buffer){
  var qty=(it.qty|0), thr=(it.threshold|0), diff=qty-thr;
  if(qty===0) return '<span class="badge under">Épuisé</span>';
  if(qty<=thr) return '<span class="badge under">Sous seuil</span>';
  if(diff<=((buffer|0))) return '<span class="badge low">Approche</span>';
  return '<span class="badge ok">OK</span>';
}

/* listes stock/atelier (identique à v2.9.3) */
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
async function openLinks(code){
  var it=await dbGet(code); var links=(it&&it.links)||[]; if(!links.length) return;
  if(links.length===1){ window.open(links[0],'_blank'); return; }
  var s=prompt('Ouvrir lien (1-'+links.length+') :\n'+links.map((u,i)=>(i+1)+'. '+u).join('\n'));
  var idx=((parseInt(s||'0',10)-1)|0); if(links[idx]) window.open(links[idx],'_blank');
}

/* dialogs création/édition/duplication — (identiques v2.9.3) */
var newItemDialog=$('#newItemDialog');
var niTitle=$('#niTitle'), niType=$('#niType'), niName=$('#niName'), niRef=$('#niRef'), niCode=$('#niCode'),
    niQty=$('#niQty'), niThr=$('#niThr'), niLocSelect=$('#niLocSelect'), niLocCustom=$('#niLocCustom'),
    niLocCustomWrap=$('#niLocCustomWrap'), niLocChips=$('#niLocChips'),
    niTagChecks=$('#niTagChecks'), niTagsExtra=$('#niTagsExtra'), niTagCat=$('#niTagCategory'),
    niLinks=$('#niLinks');
var niMode='create', niOriginalCode=null;
$('#niGen')?.addEventListener('click',async ()=>{ var n=niName && niName.value.trim(); if(!n) return; if(niRef && !niRef.value.trim()) niRef.value=nameToCode(n); if(niCode){ niCode.value = await generateCodeFromName(n); } });
niName && niName.addEventListener('blur',async ()=>{ var n=niName.value.trim(); if(!n) return; if(niRef && !niRef.value.trim()) niRef.value=nameToCode(n); if(niCode && !niCode.value.trim()) niCode.value=await generateCodeFromName(n); });
$('#niCopyRefToCode')?.addEventListener('click',async ()=>{ if(niRef && niCode){ var v=(niRef.value||'').trim(); if(!v) return; var normalized=normalizeCode(v); if(!normalized){ alert('Référence invalide pour un code (A-Z0-9)'); return; } if(await getByCodeAnyCase(normalized)){ alert('Ce code existe déjà.'); return; } niCode.value=normalized; } });
$('#niTagsClear')?.addEventListener('click',()=>{ niTagChecks && niTagChecks.querySelectorAll('input[type="checkbox"]').forEach(cb=>cb.checked=false); });
async function openNewDialog(type){
  type=type||'stock'; niMode='create'; niOriginalCode=null; niType && (niType.value=type); niTitle && (niTitle.textContent=(type==='atelier'?'Nouveau matériel (Atelier)':'Nouvel article (Stock)')); niTagCat && (niTagCat.textContent=(type==='atelier'?'Atelier':'Stock'));
  var items=await dbList();
  var locsExisting=Array.from(new Set(items.map(i=>i.location).filter(Boolean))).sort();
  var set=await dbGetSettings();
  var defaultsLocs=(type==='atelier'?((set&&set.defaultLocationsAtelier)||[]):((set&&set.defaultLocationsStock)||[]));
  var defaultsTags=(type==='atelier'?((set&&set.defaultTagsAtelier)||[]):((set&&set.defaultTagsStock)||[]));
  var combined=Array.from(new Set([].concat(defaultsLocs,locsExisting))).filter(Boolean);
  if(niLocSelect){
    niLocSelect.innerHTML=['<option value="">— Sélectionner —</option>']
      .concat(combined.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`))
      .concat(['<option value="__custom__">➕ Saisir personnalisé…</option>']).join('');
    niLocSelect.value=''; niLocCustomWrap.hidden=true; niLocCustom.value='';
    niLocSelect.onchange=()=>{ if(niLocSelect.value==='__custom__'){ niLocCustomWrap.hidden=false; niLocCustom.focus(); } else niLocCustomWrap.hidden=true; };
  }
  if(niLocChips){
    niLocChips.innerHTML=(defaultsLocs||[]).map(l=>`<button type="button" class="chip" data-loc="${esc(l)}">${esc(l)}</button>`).join('');
    niLocChips.querySelectorAll('button[data-loc]').forEach(b=>{
      b.addEventListener('click',()=>{
        var val=b.getAttribute('data-loc')||'';
        var opt=niLocSelect?niLocSelect.querySelector('option[value="'+val.replace(/"/g,'&quot;')+'"]'):null;
        if(niLocSelect && opt){ niLocSelect.value=val; niLocCustomWrap.hidden=true; }
        else { niLocSelect.value='__custom__'; niLocCustomWrap.hidden=false; niLocCustom.value=val; niLocCustom.focus(); }
      });
    });
  }
  niTagChecks && (niTagChecks.innerHTML=(defaultsTags.length?defaultsTags:[]).map(t=>`<label class="chip"><input type="checkbox" value="${esc(t)}"> ${esc(t)}</label>`).join('') || '<span class="muted">Aucun tag prédéfini (Paramètres)</span>');
  niName.value=''; niRef.value=''; niCode.value=''; niCode.readOnly=false; niQty.value='0'; niThr.value='0'; (niTagsExtra.value=''); niLinks.value='';
  newItemDialog.showModal(); setTimeout(()=>niName.focus(),0);
}
$('#btnAddStock')?.addEventListener('click',()=>openNewDialog('stock'));
$('#btnAddAtelier')?.addEventListener('click',()=>openNewDialog('atelier'));
async function openEditDialog(code){
  const it=await dbGet(code); if(!it){ alert('Introuvable'); return; }
  niMode='edit'; niOriginalCode=it.code;
  niType.value=it.type||'stock'; niTitle.textContent='Éditer l’article';
  niName.value=it.name||''; niRef.value=it.ref||it.code||''; niCode.value=it.code||''; niCode.readOnly=true;
  niQty.value=String(it.qty|0); niThr.value=String(it.threshold|0);
  const set=await dbGetSettings()||{};
  const defaultsLocs=(it.type==='atelier'?(set.defaultLocationsAtelier||[]):(set.defaultLocationsStock||[]));
  const defaultsTags=(it.type==='atelier'?(set.defaultTagsAtelier||[]):(set.defaultTagsStock||[]));
  const items=await dbList(); const locsExisting=Array.from(new Set(items.map(i=>i.location).filter(Boolean))).sort();
  const combined=Array.from(new Set([].concat(defaultsLocs,locsExisting))).filter(Boolean);
  if(niLocSelect){
    niLocSelect.innerHTML=['<option value="">— Sélectionner —</option>']
      .concat(combined.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`))
      .concat(['<option value="__custom__">➕ Saisir personnalisé…</option>']).join('');
    if(it.location && combined.includes(it.location)) niLocSelect.value=it.location;
    else if(it.location){ niLocSelect.value='__custom__'; niLocCustomWrap.hidden=false; niLocCustom.value=it.location; }
    else { niLocSelect.value=''; niLocCustomWrap.hidden=true; niLocCustom.value=''; }
  }
  if(niLocChips){
    niLocChips.innerHTML=(defaultsLocs||[]).map(l=>`<button type="button" class="chip" data-loc="${esc(l)}">${esc(l)}</button>`).join('');
    niLocChips.querySelectorAll('button[data-loc]').forEach(b=>{
      b.addEventListener('click',()=>{
        const val=b.getAttribute('data-loc')||'';
        const opt=niLocSelect?niLocSelect.querySelector('option[value="'+val.replace(/"/g,'&quot;')+'"]'):null;
        if(niLocSelect && opt){ niLocSelect.value=val; niLocCustomWrap.hidden=true; }
        else { niLocSelect.value='__custom__'; niLocCustomWrap.hidden=false; niLocCustom.value=val; }
      });
    });
  }
  if(niTagChecks){
    niTagChecks.innerHTML=(defaultsTags||[]).map(t=>`<label class="chip"><input type="checkbox" value="${esc(t)}" ${(it.tags||[]).includes(t)?'checked':''}> ${esc(t)}</label>`).join('') || '<span class="muted">Aucun tag prédéfini (Paramètres)</span>';
  }
  niTagsExtra.value=((it.tags||[]).filter(t=>!(defaultsTags||[]).includes(t))).join(', ');
  niLinks.value=(it.links||[]).join('\n');
  newItemDialog.showModal();
}
async function openDuplicateDialog(code){
  const it=await dbGet(code); if(!it){ alert('Introuvable'); return; }
  niMode='duplicate'; niOriginalCode=null;
  niType.value=it.type||'stock'; niTitle.textContent='Dupliquer l’article';
  niName.value=it.name||''; niRef.value=it.ref||''; niCode.value=await generateCodeFromName(it.name||it.ref||it.code||''); niCode.readOnly=false;
  niQty.value=String(it.qty|0); niThr.value=String(it.threshold|0);
  const set=await dbGetSettings()||{};
  const defaultsLocs=(it.type==='atelier'?(set.defaultLocationsAtelier||[]):(set.defaultLocationsStock||[]));
  const defaultsTags=(it.type==='atelier'?(set.defaultTagsAtelier||[]):(set.defaultTagsStock||[]));
  const items=await dbList(); const locsExisting=Array.from(new Set(items.map(i=>i.location).filter(Boolean))).sort();
  const combined=Array.from(new Set([].concat(defaultsLocs,locsExisting))).filter(Boolean);
  if(niLocSelect){
    niLocSelect.innerHTML=['<option value="">— Sélectionner —</option>']
      .concat(combined.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`))
      .concat(['<option value="__custom__">➕ Saisir personnalisé…</option>']).join('');
    if(it.location && combined.includes(it.location)) niLocSelect.value=it.location;
    else if(it.location){ niLocSelect.value='__custom__'; niLocCustomWrap.hidden=false; niLocCustom.value=it.location; }
  }
  if(niLocChips){
    niLocChips.innerHTML=(defaultsLocs||[]).map(l=>`<button type="button" class="chip" data-loc="${esc(l)}">${esc(l)}</button>`).join('');
    niLocChips.querySelectorAll('button[data-loc]').forEach(b=>{
      b.addEventListener('click',()=>{
        const val=b.getAttribute('data-loc')||'';
        const opt=niLocSelect?niLocSelect.querySelector('option[value="'+val.replace(/"/g,'&quot;')+'"]'):null;
        if(niLocSelect && opt){ niLocSelect.value=val; niLocCustomWrap.hidden=true; }
        else { niLocSelect.value='__custom__'; niLocCustomWrap.hidden=false; niLocCustom.value=val; }
      });
    });
  }
  if(niTagChecks){
    niTagChecks.innerHTML=(defaultsTags||[]).map(t=>`<label class="chip"><input type="checkbox" value="${esc(t)}" ${(it.tags||[]).includes(t)?'checked':''}> ${esc(t)}</label>`).join('') || '<span class="muted">Aucun tag prédéfini (Paramètres)</span>';
  }
  niTagsExtra.value=((it.tags||[]).filter(t=>!(defaultsTags||[]).includes(t))).join(', ');
  niLinks.value=(it.links||[]).join('\n');
  newItemDialog.showModal();
}
$('#niSave')?.addEventListener('click', async e=>{
  e.preventDefault();
  const type=(niType.value==='atelier')?'atelier':'stock';
  const name=niName.value.trim(); let code=niCode.value.trim(); const ref=niRef.value.trim();
  if(!name) return;
  const qty=Math.max(0,parseInt(niQty.value||'0',10));
  const threshold=Math.max(0,parseInt(niThr.value||'0',10));
  const loc=(niLocSelect.value==='__custom__')?(niLocCustom.value.trim()):(niLocSelect.value.trim());
  const checked=[]; niTagChecks?.querySelectorAll('input[type="checkbox"]:checked').forEach(cb=>checked.push(cb.value));
  const extras=(niTagsExtra.value||'').split(',').map(t=>t.trim()).filter(Boolean);
  const tags=Array.from(new Set([].concat(checked,extras)));
  const links=(niLinks.value||'').split(/\n+/).map(s=>s.trim()).filter(Boolean);

  if(niMode==='edit'){
    const existing=await dbGet(niOriginalCode);
    if(!existing){ alert('Article introuvable.'); return; }
    const updated={ id:niOriginalCode, code:niOriginalCode, ref:(ref||undefined), name, qty, threshold, tags, location:loc, links, type, updated:Date.now() };
    await dbPut(updated);
    newItemDialog.close(); announce('Modifications enregistrées'); await refreshTable(type); await refreshHome();
    return;
  }

  if(!code){ code=await generateCodeFromName(name); }
  else { code=normalizeCode(code); if(!code){ alert('Code invalide'); return; } if(await getByCodeAnyCase(code)){ alert('Ce code existe déjà.'); return; } }

  await dbPut({ id:code, code, ref:(ref||undefined), name, qty, threshold, tags, location:loc, links, type, updated:Date.now() });
  newItemDialog.close(); announce(niMode==='duplicate'?'Copie créée':'Créé'); await refreshTable(type); await refreshHome();
});

/* ------- ÉTIQUETTES (réglages avancés) ------- */
var LABEL_TEMPLATES={
  'a4-3x8-63x34':{cols:3,rows:8,cellW:63.5,cellH:33.9,gapX:2.5,gapY:2.0,marginX:7.5,marginY:10.7},
  'avery-l7160':{cols:3,rows:7,cellW:63.5,cellH:38.1,gapX:2.5,gapY:0,marginX:7.5,marginY:12.0},
  'avery-l7163':{cols:2,rows:7,cellW:99.1,cellH:38.1,gapX:2.0,gapY:0,marginX:5.0,marginY:13.5},
  'avery-l7162':{cols:2,rows:8,cellW:99.1,cellH:33.9,gapX:2.0,gapY:2.0,marginX:5.0,marginY:10.7},
  'avery-l7165':{cols:2,rows:4,cellW:99.1,cellH:67.7,gapX:2.0,gapY:0,marginX:5.0,marginY:13.5},
  'mm50x25':{cols:4,rows:10,cellW:50,cellH:25,gapX:5,gapY:5,marginX:10,marginY:10},
  'mm70x35':{cols:3,rows:8,cellW:70,cellH:35,gapX:5,gapY:5,marginX:10,marginY:10}
};
var labelsInitDone=false, labelsAllItems=[], labelsSelected=new Set(), lblPage=0, lblPagesCount=1;
var labelSearch=$('#labelSearch'), labelsList=$('#labelsList'), lblSelInfo=$('#lblSelInfo'),
    lblTemplate=$('#lblTemplate'), lblDensity=$('#lblDensity'), lblNameSize=$('#lblNameSize'), lblShowText=$('#lblShowText'),
    lblOffsetX=$('#lblOffsetX'), lblOffsetY=$('#lblOffsetY'),
    lblShowName=$('#lblShowName'), lblCodeTextSize=$('#lblCodeTextSize'), lblBarHeightPct=$('#lblBarHeightPct'), lblPadding=$('#lblPadding'), lblLayout=$('#lblLayout'),
    labelsPages=$('#labelsPages'), btnLblAll=$('#lblAll'), btnLblNone=$('#lblNone'),
    btnLblPrev=$('#lblPrev'), btnLblNext=$('#lblNext'), btnLabelsPrint=$('#btnLabelsPrint');

function initLabelsPanel(){ if(!labelsInitDone){ bindLabelsUI(); labelsInitDone=true; } loadLabelsData().then(()=>{ rebuildLabelsList(); rebuildLabelsPreview(true); }); }
async function loadLabelsData(){ labelsAllItems=await dbList(); if(labelsSelected.size===0){ labelsAllItems.forEach(i=>labelsSelected.add(i.code)); } }

function bindLabelsUI(){
  labelSearch?.addEventListener('input',()=>rebuildLabelsList());
  btnLblAll?.addEventListener('click',()=>{ labelsAllItems.forEach(i=>labelsSelected.add(i.code)); rebuildLabelsList(); rebuildLabelsPreview(true); });
  btnLblNone?.addEventListener('click',()=>{ labelsSelected.clear(); rebuildLabelsList(); rebuildLabelsPreview(true); });

  if(lblTemplate){
    const nameMap={
      'a4-3x8-63x34':'A4 3×8 (63.5×33.9)',
      'avery-l7160':'Avery L7160 (3×7 63.5×38.1)',
      'avery-l7163':'Avery L7163 (2×7 99.1×38.1)',
      'avery-l7162':'Avery L7162 (2×8 99.1×33.9)',
      'avery-l7165':'Avery L7165 (2×4 99.1×67.7)',
      'mm50x25':'Custom 50×25 (4×10)',
      'mm70x35':'Custom 70×35 (3×8)'
    };
    lblTemplate.innerHTML = Object.entries(LABEL_TEMPLATES).map(([k,t])=>{
      const label=nameMap[k]||`${k} (${t.cols}×${t.rows} ${t.cellW}×${t.cellH}mm)`; return `<option value="${k}">${label}</option>`;
    }).join('');
    let t=localStorage.getItem('gstock.lblTemplate'); if(!t || !LABEL_TEMPLATES[t]){ t='a4-3x8-63x34'; localStorage.setItem('gstock.lblTemplate',t); }
    lblTemplate.value=t;
    lblTemplate.addEventListener('change',()=>{ localStorage.setItem('gstock.lblTemplate', lblTemplate.value); rebuildLabelsPreview(true); });
  }

  function bindLSBool(id, key){
    const el=$(id); if(!el) return;
    el.checked = (localStorage.getItem(key)!=='0');
    el.addEventListener('change',()=>{ localStorage.setItem(key, el.checked?'1':'0'); rebuildLabelsPreview(false); });
  }
  function bindLSNum(id, key, def){
    const el=$(id); if(!el) return;
    const v=localStorage.getItem(key); el.value = (v!=null?v:def);
    el.addEventListener('change',()=>{ localStorage.setItem(key, String(el.value)); rebuildLabelsPreview(false); });
  }
  function bindLSStr(id, key, def){
    const el=$(id); if(!el) return;
    const v=localStorage.getItem(key); el.value = (v!=null?v:def);
    el.addEventListener('change',()=>{ localStorage.setItem(key, String(el.value)); rebuildLabelsPreview(false); });
  }

  bindLSBool('#lblShowName','gstock.lblShowName');
  bindLSBool('#lblShowText','gstock.lblShowText');
  bindLSNum('#lblNameSize','gstock.lblNameSize',11);
  bindLSNum('#lblCodeTextSize','gstock.lblCodeTextSize',9);
  bindLSNum('#lblBarHeightPct','gstock.lblBarHeightPct',60);
  bindLSNum('#lblDensity','gstock.lblDensity',2);
  bindLSNum('#lblPadding','gstock.lblPadding',2);
  bindLSNum('#lblOffsetX','gstock.lblOffsetX',0);
  bindLSNum('#lblOffsetY','gstock.lblOffsetY',0);
  bindLSStr('#lblLayout','gstock.lblLayout','name-above');

  btnLblPrev?.addEventListener('click',()=>{ if(lblPage>0){ lblPage--; updatePaginationDisplay(); } });
  btnLblNext?.addEventListener('click',()=>{ if(lblPage<lblPagesCount-1){ lblPage++; updatePaginationDisplay(); } });
  btnLabelsPrint?.addEventListener('click', printLabelsClean);
}
function updateLblSelInfo(){ lblSelInfo && (lblSelInfo.textContent=labelsSelected.size+' sélection(s)'); }
function chunkArray(arr,size){ var out=[]; for(let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out; }
function mm(n){ return n+'mm'; }

/* — nouveau rendu d'une carte d'étiquette (centrée & paramétrable) — */
function renderLabelCardHTML(it, tmpl, opts){
  const {module, namePt, showName, showText, codeTextPt, barHeightPct, paddingMm} = opts;
  const mmToPx = (mm)=> Math.max(1, Math.floor(mm * 3.78));
  const pad= Math.max(0, Number(paddingMm)||0);
  const availH = Math.max(4, (tmpl.cellH - pad*2));
  const reservedTopMm = showName ? (namePt * 0.3527 + 1) : 0;        // nom + petite marge
  const reservedBottomMm = showText ? (codeTextPt * 0.3527 + 1) : 0; // texte code + petite marge
  // hauteur code-barres : min entre (pourcentage) et (hauteur restante après textes)
  const targetBarMm = Math.max(6, (availH * (Math.max(20,Math.min(90,Number(barHeightPct)||60))/100)));
  const maxBarMm = Math.max(6, availH - reservedTopMm - reservedBottomMm);
  const barMm = Math.min(targetBarMm, maxBarMm);
  const barHeightPx = mmToPx(barMm);

  // SVG sans hauteur explicite (pas de height="auto"), limité par CSS inline
  let svgStr = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  try{
    if (window.code39 && typeof window.code39.svg === 'function'){
      const svgEl = window.code39.svg(it.code, {
        module,
        height: barHeightPx,
        margin: 2,
        showText: false,
        fontSize: 10
      });
      svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svgEl.setAttribute('width', '100%');
      svgEl.style.maxHeight = Math.max(6, barMm) + 'mm';
      svgEl.style.display = 'block';
      svgEl.style.margin = '0 auto';
      svgStr = new XMLSerializer().serializeToString(svgEl);
    }
  }catch(e){}

  const nameHTML = showName ? `<div class="name" style="font-size:${namePt}pt;margin-bottom:1mm;text-align:center">${esc(it.name)}</div>` : '';
  const codeText = showText ? `<div class="code-text" style="font-size:${codeTextPt}pt;margin-top:1mm;text-align:center">${esc(it.code)}</div>` : '';
  const barcodeHTML = `<div class="barcode">${svgStr}</div>`;

  // disposition
  let inner='';
  if(opts.layout==='name-below'){
    inner = `${barcodeHTML}${codeText}${nameHTML}`;
  }else if(opts.layout==='barcode-only'){
    inner = `${barcodeHTML}`;
  }else{ // name-above
    inner = `${nameHTML}${barcodeHTML}${codeText}`;
  }

  return `<div class="label-card" style="box-sizing:border-box;padding:${pad}mm;overflow:hidden;text-align:center">${inner}</div>`;
}

function buildLabelsPagesHTML(items,tmpl,opts){
  const perPage=(tmpl.cols|0)*(tmpl.rows|0);
  const pages=chunkArray(items,perPage);
  const sheetStyle=[
    `padding-left:${mm((tmpl.marginX||0)+(opts.offX||0))}`,
    `padding-top:${mm((tmpl.marginY||0)+(opts.offY||0))}`,
    `display:grid`,
    `grid-template-columns:repeat(${tmpl.cols}, ${mm(tmpl.cellW)})`,
    `grid-auto-rows:${mm(tmpl.cellH)}`,
    `column-gap:${mm((tmpl.gapX||0))}`,
    `row-gap:${mm((tmpl.gapY||0))}`
  ].join(';');
  let html='';
  pages.forEach(sub=>{
    let sheet=`<div class="labels-sheet" style="${sheetStyle}">`;
    sub.forEach(it=>{ sheet+=renderLabelCardHTML(it,tmpl,opts); });
    for(let k=sub.length;k<perPage;k++){ sheet+=`<div class="label-card" style="border:1px dashed transparent"></div>`; }
    sheet+=`</div>`;
    html+=`<div class="labels-page">${sheet}</div>`;
  });
  if(!pages.length) html+=`<div class="labels-page"><div class="labels-sheet" style="${sheetStyle}"></div></div>`;
  return html;
}

function rebuildLabelsList(){
  var q=(labelSearch&&labelSearch.value||'').toLowerCase();
  if(labelsList){
    labelsList.innerHTML=labelsAllItems.filter(i=>!q||[i.name,i.code,(i.tags||[]).join(' ')].join(' ').toLowerCase().includes(q))
      .map(i=>`<div class="row"><label style="display:flex;align-items:center;gap:.5rem;flex:1"><input type="checkbox" class="lblRow" data-code="${esc(i.code)}" ${(labelsSelected.has(i.code)?'checked':'')}> <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.name)}</span></label><code>${esc(i.code)}</code></div>`).join('');
    labelsList.querySelectorAll('.lblRow').forEach(cb=>{
      cb.addEventListener('change',()=>{ var code=cb.dataset.code; if(cb.checked) labelsSelected.add(code); else labelsSelected.delete(code); updateLblSelInfo(); rebuildLabelsPreview(true); });
    });
  }
  updateLblSelInfo();
}
function rebuildLabelsPreview(resetPage){
  var key=(lblTemplate&&lblTemplate.value)||'a4-3x8-63x34';
  var tmpl=LABEL_TEMPLATES[key]||LABEL_TEMPLATES['a4-3x8-63x34'];

  const opts={
    module: parseFloat((lblDensity&&lblDensity.value)||'2'),
    namePt: parseInt((lblNameSize&&lblNameSize.value)||'11',10),
    codeTextPt: parseInt((lblCodeTextSize&&lblCodeTextSize.value)||'9',10),
    showName: !!(lblShowName&&lblShowName.checked),
    showText: !!(lblShowText&&lblShowText.checked),
    barHeightPct: parseInt((lblBarHeightPct&&lblBarHeightPct.value)||'60',10),
    paddingMm: parseFloat((lblPadding&&lblPadding.value)||'2')||0,
    offX: parseFloat((lblOffsetX&&lblOffsetX.value)||'0')||0,
    offY: parseFloat((lblOffsetY&&lblOffsetY.value)||'0')||0,
    layout: (lblLayout&&lblLayout.value)||'name-above'
  };

  var selectedItems=labelsAllItems.filter(i=>labelsSelected.has(i.code));
  const pagesHTML=buildLabelsPagesHTML(selectedItems,tmpl,opts);
  if(labelsPages) labelsPages.innerHTML=pagesHTML;

  const perPage=(tmpl.cols|0)*(tmpl.rows|0);
  const countPages=Math.max(1, Math.ceil(selectedItems.length/perPage));
  lblPagesCount=countPages;
  if(resetPage) lblPage=0;
  updatePaginationDisplay();
}
function updatePaginationDisplay(){
  var pages=$$('.labels-page',labelsPages);
  pages.forEach((p,i)=>p.classList.toggle('active', i===lblPage));
  var info=$('#lblPageInfo'); info && (info.textContent='Page '+Math.min(lblPage+1,lblPagesCount)+' / '+lblPagesCount);
  var prev=$('#lblPrev'), next=$('#lblNext'), one=(lblPagesCount<=1);
  if(prev){ prev.disabled=(lblPage<=0); show(prev,!one); }
  if(next){ next.disabled=(lblPage>=lblPagesCount-1); show(next,!one); }
  show(info,!one);
}
function printLabelsClean(){
  try{
    var key=(lblTemplate&&lblTemplate.value)||'a4-3x8-63x34';
    var tmpl=LABEL_TEMPLATES[key]||LABEL_TEMPLATES['a4-3x8-63x34'];
    const opts={
      module: parseFloat((lblDensity&&lblDensity.value)||'2'),
      namePt: parseInt((lblNameSize&&lblNameSize.value)||'11',10),
      codeTextPt: parseInt((lblCodeTextSize&&lblCodeTextSize.value)||'9',10),
      showName: !!(lblShowName&&lblShowName.checked),
      showText: !!(lblShowText&&lblShowText.checked),
      barHeightPct: parseInt((lblBarHeightPct&&lblBarHeightPct.value)||'60',10),
      paddingMm: parseFloat((lblPadding&&lblPadding.value)||'2')||0,
      offX: parseFloat((lblOffsetX&&lblOffsetY.value)||'0')||0,
      offY: parseFloat((lblOffsetY&&lblOffsetY.value)||'0')||0,
      layout: (lblLayout&&lblLayout.value)||'name-above'
    };
    var selectedItems=labelsAllItems.filter(i=>labelsSelected.has(i.code));

    const pagesHTML=buildLabelsPagesHTML(selectedItems,tmpl,opts);
    const css=`@page{size:A4;margin:0}html,body{margin:0;padding:0}.labels-page{break-after:page}.labels-sheet{display:grid}.label-card{box-sizing:border-box;overflow:hidden;text-align:center}.label-card .name{font-weight:600;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.label-card .code-text{line-height:1.1}`;
    const html=`<!doctype html><html><head><meta charset="utf-8"><title>Étiquettes</title><style>${css}</style></head><body>${pagesHTML}</body></html>`;
    const w=window.open('','gstock_print','width=900,height=700'); if(!w){ alert('Pop-up bloquée'); return; }
    w.document.open(); w.document.write(html); w.document.close(); w.focus(); setTimeout(()=>{ try{ w.print(); }catch(_){ } setTimeout(()=>{ try{ w.close(); }catch(_){ } }, 500); }, 200);
  }catch(e){ console.warn('print error',e); alert('Impossible de lancer l’impression propre.'); window.print(); }
}

/* Journal / Emprunts / Paramètres / Scanner — identiques v2.9.3 (inchangés ici) */
/* … pour ne pas alourdir : garde tes fichiers db.js / sw.js / code39.js existants en v2.9.3 … */

/* INIT */
(async function init(){
  $('#appVersion') && ($('#appVersion').textContent=window.APP_VERSION||'');
  try{
    if(typeof window.dbInit!=='function') throw new Error('db.js non chargé');
    await dbInit();
  }catch(e){
    console.error('Init DB error (verbose):',e);
    const msg=String((e&&(e.message||e.name))||'Unknown');
    if((e && (e.name==='UnknownError'||e.name==='InvalidStateError'||e.name==='QuotaExceededError'))||/Internal error/i.test(msg)){
      const ok=confirm('Le stockage local semble corrompu/bloqué.\nLancer la réparation ?\n(La base locale sera réinitialisée)');
      if(ok){
        try{ await (window.dbNuke?window.dbNuke(false):Promise.resolve()); }catch(_){}
        try{ if('caches' in window){ const ks=await caches.keys(); await Promise.all(ks.map(k=>caches.delete(k))); } if(navigator.serviceWorker?.getRegistrations){ const regs=await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=>r.unregister())); } }catch(_){}
        location.href=location.pathname+'?bust='+Date.now(); return;
      }
    }
  }
  await refreshHome(); showTab('home'); await refreshLoansTable();
})();
})();
