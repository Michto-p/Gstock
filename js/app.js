/* Gstock - app.js v2.9.6 */
(function(){'use strict';
/* -------- utils -------- */
const $=(s,r)=> (r||document).querySelector(s);
const $$=(s,r)=> Array.from((r||document).querySelectorAll(s));
const show=(el,on)=>{ if(el) el.hidden=!on; };
const esc=(s)=> String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const sr=$('#sr');
function announce(msg){ if(sr){ sr.textContent=''; setTimeout(()=>{ sr.textContent=msg; },10);} }
function debounced(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }
function deaccent(s){ try{return s.normalize('NFD').replace(/\p{Diacritic}/gu,'');}catch(_){return s;} }

/* purge ?safe=1 */
(async()=>{ try{ const qs=new URLSearchParams(location.search); if(qs.has('safe')){ try{ await (window.dbNuke?window.dbNuke(false):Promise.resolve()); }catch(e){} try{ const regs=await (navigator.serviceWorker?.getRegistrations?.()||[]); await Promise.all(regs.map(r=>r.unregister())); }catch(e){} try{ const keys=await (caches?.keys?.()||[]); await Promise.all(keys.map(k=>caches.delete(k))); }catch(e){} location.replace(location.pathname+'?bust='+Date.now()); return; } }catch(e){} })();

/* thème */
const themeToggle=$('#themeToggle');
if(themeToggle){
  themeToggle.value=(localStorage.getItem('gstock.theme')||'auto');
  function applyTheme(){
    const v=themeToggle.value; localStorage.setItem('gstock.theme',v);
    if(v==='auto'){ const d=matchMedia('(prefers-color-scheme: dark)').matches; document.documentElement.setAttribute('data-theme',d?'dark':'light'); }
    else document.documentElement.setAttribute('data-theme',v);
  }
  themeToggle.addEventListener('change',applyTheme); applyTheme();
}

/* navigation */
const sections={
  home:$('#tab-home'),stock:$('#tab-stock'),atelier:$('#tab-atelier'),
  scanner:$('#tab-scanner'),labels:$('#tab-labels'),journal:$('#tab-journal'),
  gear:$('#tab-gear'),settings:$('#tab-settings')
};
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

/* règles code-barres */
const CODE_RULES=Object.freeze({ maxLen:10, uppercase:true, alnumOnly:true, prefix:'' });
function nameToCode(name){
  const stop=new Set(['le','la','les','des','du','de','d','l','un','une','pour','et','sur','avec','en','à','au','aux','the','of','for']);
  const parts=deaccent(String(name)).replace(/[^A-Za-z0-9]+/g,' ').trim().split(/\s+/);
  if(!parts.length) return 'ITM'+Math.floor(100000+Math.random()*899999);
  const brand=parts.length>1?parts[parts.length-1]:'';
  const brandShort=brand? (brand.slice(0,3)[0].toUpperCase()+brand.slice(1,3).toLowerCase()) : '';
  const base=[];
  for(let i=0;i<parts.length-(brand?1:0);i++){
    const t=parts[i], low=t.toLowerCase();
    if(stop.has(low)) continue;
    if(/^\d+$/.test(t)){ base.push(t); continue; }
    base.push((t.length>=4?t.slice(0,4):t).toLowerCase());
  }
  return (base.join('')+brandShort);
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
async function getByCodeAnyCase(raw){
  if(!raw) return null;
  const exact=await (window.dbGet?dbGet(raw):null);
  if(exact) return exact;
  const low=String(raw).toLowerCase();
  const all=await (window.dbList?dbList():[]);
  return all.find(i=>(String(i.code||'')).toLowerCase()===low)||null;
}
async function makeUniqueCode(base){
  if(!(await getByCodeAnyCase(base))) return base;
  for(let n=2;n<10000;n++){
    const s=''+n, head=base.slice(0,CODE_RULES.maxLen-s.length), cand=head+s;
    if(!(await getByCodeAnyCase(cand))) return cand;
  }
  return base.slice(0,CODE_RULES.maxLen);
}
async function generateCodeFromName(n){ return await makeUniqueCode(normalizeCode(nameToCode(n||''))||('ITM'+Math.floor(Math.random()*1e6))); }

/* ---------- ACCUEIL ---------- */
async function refreshHome(){
  const items=await (window.dbList?dbList():[]);
  const set=await (window.dbGetSettings?dbGetSettings():null); const buf=(set&&set.buffer|0);

  const exhausted=items.filter(i=>(i.qty|0)===0).sort((a,b)=>a.name.localeCompare(b.name));
  const under=items.filter(i=>(i.qty|0)>0 && (i.qty|0)<=(i.threshold|0)).sort((a,b)=>a.name.localeCompare(b.name));
  const low=items.filter(i=> (i.qty|0)>(i.threshold|0) && ((i.qty|0)-(i.threshold|0))<=buf ).sort((a,b)=>a.name.localeCompare(b.name));

  $('#kpiItems').textContent=String(items.length);
  $('#kpiQty').textContent=String(items.reduce((s,i)=>s+(i.qty|0),0));
  $('#kpiUnder').textContent=String(exhausted.length + under.length);
  $('#kpiLow').textContent=String(low.length);

  const loans=await (window.dbListLoans?dbListLoans(true):[]);
  $('#kpiLoansActive').textContent=String(loans.filter(l=>!l.returnedAt).length);
  $('#kpiLoansOverdue').textContent=String(loans.filter(l=>!l.returnedAt && Date.now()>new Date(l.due).getTime()).length);

  function renderList(el, arr, empty){
    el.innerHTML = (arr.slice(0,30).map(i=>{
      const q=i.qty|0, th=i.threshold|0;
      return `<li>• <strong>${esc(i.name)}</strong> <span class="muted">(<code>${esc(i.code)}</code>)</span> — q=${q} / seuil=${th}</li>`;
    }).join('')) || `<li class="muted">${empty}</li>`;
  }
  renderList($('#homeExhausted'), exhausted, 'Aucun article épuisé');
  renderList($('#homeUnder'), under, 'Aucun article sous le seuil');
  renderList($('#homeLow'), low, 'Aucun article en approche');

  const recent=await (window.dbListMoves?dbListMoves({from:0,to:Infinity,limit:8}):[]);
  $('#recentMoves').innerHTML=(recent.map(m=>`<li>${new Date(m.ts).toLocaleString()} • <strong>${esc(m.type)}</strong> <code>${esc(m.code)}</code> ×${m.qty}</li>`).join(''))||'<li class="muted">Aucun mouvement</li>';
}

/* ---------- TABLES STOCK/ATELIER ---------- */
function ensureType(it){ return it.type||'stock'; }
function statusBadge(it, buffer){
  const qty=(it.qty|0), thr=(it.threshold|0), diff=qty-thr;
  if(qty===0) return '<span class="badge under">Épuisé</span>';
  if(qty<=thr) return '<span class="badge under">Sous seuil</span>';
  if(diff<=((buffer|0))) return '<span class="badge low">Approche</span>';
  return '<span class="badge ok">OK</span>';
}
const state={ stock:{q:'',status:'',tag:'',loc:''}, atelier:{q:'',status:'',tag:'',loc:''} };
const els={
  stock:{ tbody:$('#stockTbody'), search:$('#stockSearch'), status:$('#stockStatus'), tag:$('#stockTag'), loc:$('#stockLoc'), btnAdd:$('#btnAddStock'), btnClear:$('#stockClear') },
  atelier:{ tbody:$('#atelierTbody'), search:$('#atelierSearch'), status:$('#atelierStatus'), tag:$('#atelierTag'), loc:$('#atelierLoc'), btnAdd:$('#btnAddAtelier'), btnClear:$('#atelierClear') }
};
Object.keys(els).forEach(type=>{
  const e=els[type];
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
      const svg = window.code39.svg(code, {module:1.6, height:34, margin:0, showText:false, fontSize:9});
      return svg && (svg.outerHTML || new XMLSerializer().serializeToString(svg));
    }
  }catch(_){}
  return '<code>'+esc(code)+'</code>';
}
async function refreshTable(type){
  const e=els[type]; if(!e||!e.tbody) return;
  const set=await (window.dbGetSettings?dbGetSettings():null); const buffer=(set&&set.buffer|0);
  const all=(await (window.dbList?dbList():[])).map(i=>Object.assign({},i,{type:ensureType(i)})).filter(i=>i.type===type);

  const tagsSet=new Set(), locSet=new Set();
  all.forEach(i=>{ (i.tags||[]).forEach(t=>tagsSet.add(t)); if(i.location) locSet.add(i.location); });
  const curTag=(e.tag&&e.tag.value)||''; const curLoc=(e.loc&&e.loc.value)||'';
  if(e.tag) e.tag.innerHTML='<option value="">Tous tags</option>'+Array.from(tagsSet).sort().map(t=>`<option ${t===curTag?'selected':''}>${esc(t)}</option>`).join('');
  if(e.loc) e.loc.innerHTML='<option value="">Tous emplacements</option>'+Array.from(locSet).sort().map(l=>`<option ${l===curLoc?'selected':''}>${esc(l)}</option>`).join('');
  show(e.tag, tagsSet.size>0); show(e.loc, locSet.size>0);

  const q=(state[type].q||'').toLowerCase(), st=state[type].status||'', tag=state[type].tag||'', loc=state[type].loc||'';
  const filtered=all.filter(it=>{
    const inQ=!q||[it.name,(it.ref||''),it.code,(it.tags||[]).join(' '),it.location||'',(it.links||[]).join(' ')].join(' ').toLowerCase().includes(q);
    const inTag=!tag||(it.tags||[]).indexOf(tag)>=0;
    const inLoc=!loc||((it.location||'')===loc);
    let stOK=true;
    if(st==='ok') stOK=(it.qty>it.threshold && (it.qty-it.threshold)>(buffer|0));
    if(st==='low') stOK=(it.qty>it.threshold && (it.qty-it.threshold)<=(buffer|0));
    if(st==='under') stOK=(it.qty<=it.threshold);
    return inQ&&inTag&&inLoc&&stOK;
  });

  e.tbody.innerHTML = filtered.map(it=>{
    const qtyCell = `<div style="display:flex;gap:.3rem;align-items:center">
      <button class="btn" data-qa="-1" data-code="${esc(it.code)}" title="Retirer 1">-1</button>
      <strong>${(it.qty|0)}</strong>
      ${statusBadge(it, buffer)}
      <button class="btn" data-qa="+1" data-code="${esc(it.code)}" title="Ajouter 1">+1</button>
    </div>`;
    const tags = (it.tags||[]).map(t=>`<span class="pill">${esc(t)}</span>`).join(' ');
    const linksBtn = (it.links&&it.links.length) ? `<button class="btn" data-act="link" data-code="${esc(it.code)}">🔗 ${it.links.length}</button>` : '<span class="muted">—</span>';

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
    const code=btn.dataset.code;
    if(btn.dataset.act==='adj')  btn.onclick=()=>openAdjustDialog({code});
    if(btn.dataset.act==='link') btn.onclick=()=>openLinks(code);
    if(btn.dataset.act==='edit') btn.onclick=()=>openEditDialog(code);
    if(btn.dataset.act==='dup')  btn.onclick=()=>openDuplicateDialog(code);
    if(btn.dataset.act==='del')  btn.onclick=async()=>{ if(confirm('Supprimer cet élément ?')){ await (window.dbDelete?dbDelete(code):Promise.resolve()); await refreshTable(type); announce('Élément supprimé'); } };
  });
  e.tbody.querySelectorAll('button[data-qa]').forEach(btn=>{
    btn.onclick=async()=>{
      const code=btn.dataset.code; const delta=(btn.dataset.qa==='+1')?+1:-1;
      const it=(await (window.dbGet?dbGet(code):null)); if(!it) return;
      await (window.dbAdjustQty?dbAdjustQty(it.code,delta):Promise.resolve());
      await (window.dbAddMove?dbAddMove({ts:Date.now(),type:(delta>0?'ENTRY':'EXIT'),code:it.code,name:it.name,qty:Math.abs(delta),note:'ajustement rapide ('+ensureType(it)+')'}):Promise.resolve());
      announce((delta>0?'+1':'-1')+' → '+it.name); await refreshTable(type); await refreshHome();
    };
  });
}
async function openLinks(code){
  const it=await (window.dbGet?dbGet(code):null); const links=(it&&it.links)||[]; if(!links.length) return;
  if(links.length===1){ window.open(links[0],'_blank'); return; }
  const s=prompt('Ouvrir lien (1-'+links.length+') :\n'+links.map((u,i)=>(i+1)+'. '+u).join('\n'));
  const idx=((parseInt(s||'0',10)-1)|0); if(links[idx]) window.open(links[idx],'_blank');
}

/* ---------- Dialogs Article ---------- */
const newItemDialog=$('#newItemDialog');
const niTitle=$('#niTitle'), niType=$('#niType'), niName=$('#niName'), niRef=$('#niRef'), niCode=$('#niCode'),
      niQty=$('#niQty'), niThr=$('#niThr'), niLocSelect=$('#niLocSelect'), niLocCustom=$('#niLocCustom'),
      niLocCustomWrap=$('#niLocCustomWrap'), niLocChips=$('#niLocChips'),
      niTagChecks=$('#niTagChecks'), niTagsExtra=$('#niTagsExtra'), niTagCat=$('#niTagCategory'),
      niLinks=$('#niLinks');
let niMode='create', niOriginalCode=null;

$('#niGen')?.addEventListener('click',async ()=>{ const n=niName && niName.value.trim(); if(!n) return; if(niRef && !niRef.value.trim()) niRef.value=nameToCode(n); if(niCode){ niCode.value = await generateCodeFromName(n); } });
niName && niName.addEventListener('blur',async ()=>{ const n=niName.value.trim(); if(!n) return; if(niRef && !niRef.value.trim()) niRef.value=nameToCode(n); if(niCode && !niCode.value.trim()) niCode.value=await generateCodeFromName(n); });
$('#niCopyRefToCode')?.addEventListener('click',async ()=>{ if(niRef && niCode){ const v=(niRef.value||'').trim(); if(!v) return; const normalized=normalizeCode(v); if(!normalized){ alert('Référence invalide pour un code (A-Z0-9)'); return; } if(await getByCodeAnyCase(normalized)){ alert('Ce code existe déjà.'); return; } niCode.value=normalized; } });
$('#niTagsClear')?.addEventListener('click',()=>{ niTagChecks && niTagChecks.querySelectorAll('input[type="checkbox"]').forEach(cb=>cb.checked=false); });

async function openNewDialog(type){
  type=type||'stock'; niMode='create'; niOriginalCode=null; if(niType) niType.value=type; if(niTitle) niTitle.textContent=(type==='atelier'?'Nouveau matériel (Atelier)':'Nouvel article (Stock)'); if(niTagCat) niTagCat.textContent=(type==='atelier'?'Atelier':'Stock');

  const items=await (window.dbList?dbList():[]);
  const locsExisting=Array.from(new Set(items.map(i=>i.location).filter(Boolean))).sort();
  const set=await (window.dbGetSettings?dbGetSettings():null);
  const defaultsLocs=(type==='atelier'?((set&&set.defaultLocationsAtelier)||[]):((set&&set.defaultLocationsStock)||[]));
  const defaultsTags=(type==='atelier'?((set&&set.defaultTagsAtelier)||[]):((set&&set.defaultTagsStock)||[]));
  const combined=Array.from(new Set([].concat(defaultsLocs,locsExisting))).filter(Boolean);

  if(niLocSelect){
    niLocSelect.innerHTML=['<option value="">— Sélectionner —</option>']
      .concat(combined.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`))
      .concat(['<option value="__custom__">➕ Saisir personnalisé…</option>']).join('');
    niLocSelect.value=''; if(niLocCustomWrap) niLocCustomWrap.hidden=true; if(niLocCustom) niLocCustom.value='';
    niLocSelect.onchange=()=>{ if(niLocSelect.value==='__custom__'){ if(niLocCustomWrap) niLocCustomWrap.hidden=false; niLocCustom?.focus(); } else if(niLocCustomWrap) niLocCustomWrap.hidden=true; };
  }
  if(niLocChips){
    niLocChips.innerHTML=(defaultsLocs||[]).map(l=>`<button type="button" class="chip" data-loc="${esc(l)}">${esc(l)}</button>`).join('');
    niLocChips.querySelectorAll('button[data-loc]').forEach(b=>{
      b.addEventListener('click',()=>{
        const val=b.getAttribute('data-loc')||'';
        const opt=niLocSelect?niLocSelect.querySelector('option[value="'+val.replace(/"/g,'&quot;')+'"]'):null;
        if(niLocSelect && opt){ niLocSelect.value=val; if(niLocCustomWrap) niLocCustomWrap.hidden=true; }
        else { if(niLocSelect) niLocSelect.value='__custom__'; if(niLocCustomWrap) niLocCustomWrap.hidden=false; if(niLocCustom) niLocCustom.value=val; niLocCustom?.focus(); }
      });
    });
  }
  if(niTagChecks){
    niTagChecks.innerHTML=(defaultsTags.length?defaultsTags:[]).map(t=>`<label class="chip"><input type="checkbox" value="${esc(t)}"> ${esc(t)}</label>`).join('') || '<span class="muted">Aucun tag prédéfini (Paramètres)</span>';
  }
  if(niName) niName.value='';
  if(niRef) niRef.value='';
  if(niCode){ niCode.value=''; niCode.readOnly=false; }
  if(niQty) niQty.value='0';
  if(niThr) niThr.value='0';
  if(niTagsExtra) niTagsExtra.value='';
  if(niLinks) niLinks.value='';
  newItemDialog?.showModal(); setTimeout(()=>niName?.focus(),0);
}
$('#btnAddStock')?.addEventListener('click',()=>openNewDialog('stock'));
$('#btnAddAtelier')?.addEventListener('click',()=>openNewDialog('atelier'));

async function openEditDialog(code){
  const it=await (window.dbGet?dbGet(code):null); if(!it){ alert('Introuvable'); return; }
  niMode='edit'; niOriginalCode=it.code;
  if(niType) niType.value=it.type||'stock'; if(niTitle) niTitle.textContent='Éditer l’article';
  if(niName) niName.value=it.name||''; if(niRef) niRef.value=it.ref||it.code||''; if(niCode){ niCode.value=it.code||''; niCode.readOnly=true; }
  if(niQty) niQty.value=String(it.qty|0); if(niThr) niThr.value=String(it.threshold|0);
  const set=await (window.dbGetSettings?dbGetSettings():{});
  const defaultsLocs=(it.type==='atelier'?(set.defaultLocationsAtelier||[]):(set.defaultLocationsStock||[]));
  const defaultsTags=(it.type==='atelier'?(set.defaultTagsAtelier||[]):(set.defaultTagsStock||[]));
  const items=await (window.dbList?dbList():[]); const locsExisting=Array.from(new Set(items.map(i=>i.location).filter(Boolean))).sort();
  const combined=Array.from(new Set([].concat(defaultsLocs,locsExisting))).filter(Boolean);

  if(niLocSelect){
    niLocSelect.innerHTML=['<option value="">— Sélectionner —</option>']
      .concat(combined.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`))
      .concat(['<option value="__custom__">➕ Saisir personnalisé…</option>']).join('');
    if(it.location && combined.includes(it.location)) niLocSelect.value=it.location;
    else if(it.location){ niLocSelect.value='__custom__'; if(niLocCustomWrap) niLocCustomWrap.hidden=false; if(niLocCustom) niLocCustom.value=it.location; }
    else { niLocSelect.value=''; if(niLocCustomWrap) niLocCustomWrap.hidden=true; if(niLocCustom) niLocCustom.value=''; }
  }
  if(niLocChips){
    niLocChips.innerHTML=(defaultsLocs||[]).map(l=>`<button type="button" class="chip" data-loc="${esc(l)}">${esc(l)}</button>`).join('');
    niLocChips.querySelectorAll('button[data-loc]').forEach(b=>{
      b.addEventListener('click',()=>{
        const val=b.getAttribute('data-loc')||'';
        const opt=niLocSelect?niLocSelect.querySelector('option[value="'+val.replace(/"/g,'&quot;')+'"]'):null;
        if(niLocSelect && opt){ niLocSelect.value=val; if(niLocCustomWrap) niLocCustomWrap.hidden=true; }
        else { niLocSelect.value='__custom__'; if(niLocCustomWrap) niLocCustomWrap.hidden=false; if(niLocCustom) niLocCustom.value=val; }
      });
    });
  }
  if(niTagChecks){
    niTagChecks.innerHTML=(defaultsTags||[]).map(t=>`<label class="chip"><input type="checkbox" value="${esc(t)}" ${(it.tags||[]).includes(t)?'checked':''}> ${esc(t)}</label>`).join('') || '<span class="muted">Aucun tag prédéfini (Paramètres)</span>';
  }
  if(niTagsExtra) niTagsExtra.value=((it.tags||[]).filter(t=>!(defaultsTags||[]).includes(t))).join(', ');
  if(niLinks) niLinks.value=(it.links||[]).join('\n');
  newItemDialog?.showModal();
}
async function openDuplicateDialog(code){
  const it=await (window.dbGet?dbGet(code):null); if(!it){ alert('Introuvable'); return; }
  niMode='duplicate'; niOriginalCode=null;
  if(niType) niType.value=it.type||'stock'; if(niTitle) niTitle.textContent='Dupliquer l’article';
  if(niName) niName.value=it.name||''; if(niRef) niRef.value=it.ref||'';
  if(niCode){ niCode.value=await generateCodeFromName(it.name||it.ref||it.code||''); niCode.readOnly=false; }
  if(niQty) niQty.value=String(it.qty|0); if(niThr) niThr.value=String(it.threshold|0);
  const set=await (window.dbGetSettings?dbGetSettings():{});
  const defaultsLocs=(it.type==='atelier'?(set.defaultLocationsAtelier||[]):(set.defaultLocationsStock||[]));
  const defaultsTags=(it.type==='atelier'?(set.defaultTagsAtelier||[]):(set.defaultTagsStock||[]));
  const items=await (window.dbList?dbList():[]); const locsExisting=Array.from(new Set(items.map(i=>i.location).filter(Boolean))).sort();
  const combined=Array.from(new Set([].concat(defaultsLocs,locsExisting))).filter(Boolean);

  if(niLocSelect){
    niLocSelect.innerHTML=['<option value="">— Sélectionner —</option>']
      .concat(combined.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`))
      .concat(['<option value="__custom__">➕ Saisir personnalisé…</option>']).join('');
    if(it.location && combined.includes(it.location)) niLocSelect.value=it.location;
    else if(it.location){ niLocSelect.value='__custom__'; if(niLocCustomWrap) niLocCustomWrap.hidden=false; if(niLocCustom) niLocCustom.value=it.location; }
  }
  if(niLocChips){
    niLocChips.innerHTML=(defaultsLocs||[]).map(l=>`<button type="button" class="chip" data-loc="${esc(l)}">${esc(l)}</button>`).join('');
    niLocChips.querySelectorAll('button[data-loc]').forEach(b=>{
      b.addEventListener('click',()=>{
        const val=b.getAttribute('data-loc')||'';
        const opt=niLocSelect?niLocSelect.querySelector('option[value="'+val.replace(/"/g,'&quot;')+'"]'):null;
        if(niLocSelect && opt){ niLocSelect.value=val; if(niLocCustomWrap) niLocCustomWrap.hidden=true; }
        else { niLocSelect.value='__custom__'; if(niLocCustomWrap) niLocCustomWrap.hidden=false; if(niLocCustom) niLocCustom.value=val; }
      });
    });
  }
  if(niTagChecks){
    niTagChecks.innerHTML=(defaultsTags||[]).map(t=>`<label class="chip"><input type="checkbox" value="${esc(t)}" ${(it.tags||[]).includes(t)?'checked':''}> ${esc(t)}</label>`).join('') || '<span class="muted">Aucun tag prédéfini (Paramètres)</span>';
  }
  if(niTagsExtra) niTagsExtra.value=((it.tags||[]).filter(t=>!(defaultsTags||[]).includes(t))).join(', ');
  if(niLinks) niLinks.value=(it.links||[]).join('\n');
  newItemDialog?.showModal();
}
$('#niSave')?.addEventListener('click', async e=>{
  e.preventDefault();
  const type=(niType?.value==='atelier')?'atelier':'stock';
  const name=niName?.value.trim(); let code=niCode?.value.trim(); const ref=niRef?.value.trim();
  if(!name) return;
  const qty=Math.max(0,parseInt(niQty?.value||'0',10));
  const threshold=Math.max(0,parseInt(niThr?.value||'0',10));
  const loc=(niLocSelect?.value==='__custom__')?(niLocCustom?.value.trim()):(niLocSelect?.value.trim());
  const checked=[]; niTagChecks?.querySelectorAll('input[type="checkbox"]:checked').forEach(cb=>checked.push(cb.value));
  const extras=(niTagsExtra?.value||'').split(',').map(t=>t.trim()).filter(Boolean);
  const tags=Array.from(new Set([].concat(checked,extras)));
  const links=(niLinks?.value||'').split(/\n+/).map(s=>s.trim()).filter(Boolean);

  if(niMode==='edit'){
    const existing=await (window.dbGet?dbGet(niOriginalCode):null);
    if(!existing){ alert('Article introuvable.'); return; }
    const updated={ id:niOriginalCode, code:niOriginalCode, ref:(ref||undefined), name, qty, threshold, tags, location:loc, links, type, updated:Date.now() };
    await (window.dbPut?dbPut(updated):Promise.resolve());
    newItemDialog?.close(); announce('Modifications enregistrées'); await refreshTable(type); await refreshHome();
    return;
  }

  if(!code){ code=await generateCodeFromName(name); }
  else { code=normalizeCode(code); if(!code){ alert('Code invalide'); return; } if(await getByCodeAnyCase(code)){ alert('Ce code existe déjà.'); return; } }
  await (window.dbPut?dbPut({ id:code, code, ref:(ref||undefined), name, qty, threshold, tags, location:loc, links, type, updated:Date.now() }):Promise.resolve());
  newItemDialog?.close(); announce(niMode==='duplicate'?'Copie créée':'Créé'); await refreshTable(type); await refreshHome();
});

/* ---------- Ajustement (dialog après scan) ---------- */
const adjustDialog=$('#adjustDialog');
const adjName=$('#adjName'), adjCode=$('#adjCode'), adjQty=$('#adjQty');
$('#adjAdd')?.addEventListener('click', async ()=>{
  const code=adjCode?.textContent||''; const it=await (window.dbGet?dbGet(code):null); if(!it) return;
  const q=Math.max(1, parseInt(adjQty?.value||'1',10));
  await (window.dbAdjustQty?dbAdjustQty(code, +q):Promise.resolve());
  await (window.dbAddMove?dbAddMove({ts:Date.now(),type:'ENTRY',code:it.code,name:it.name,qty:q,note:'ajout (scan/ajustement)'}):Promise.resolve());
  adjustDialog?.close(); announce('Ajout effectué'); await refreshTable(ensureType(it)); await refreshHome();
});
$('#adjRemove')?.addEventListener('click', async ()=>{
  const code=adjCode?.textContent||''; const it=await (window.dbGet?dbGet(code):null); if(!it) return;
  const q=Math.max(1, parseInt(adjQty?.value||'1',10));
  await (window.dbAdjustQty?dbAdjustQty(code, -q):Promise.resolve());
  await (window.dbAddMove?dbAddMove({ts:Date.now(),type:'EXIT',code:it.code,name:it.name,qty:q,note:'retrait (scan/ajustement)'}):Promise.resolve());
  adjustDialog?.close(); announce('Retrait effectué'); await refreshTable(ensureType(it)); await refreshHome();
});
async function openAdjustDialog({code}){
  const it=await (window.dbGet?dbGet(code):null);
  if(!it){ alert('Code inconnu'); return; }
  if(adjName) adjName.textContent=it.name||'—'; if(adjCode) adjCode.textContent=it.code||code; if(adjQty) adjQty.value='1';
  adjustDialog?.showModal();
}

/* ---------- Journal ---------- */
const journalTbody=$('#journalTbody');
$('#btnFilterJournal')?.addEventListener('click', refreshJournal);
$('#btnExportCSV')?.addEventListener('click', async ()=>{
  const rows=await (window.dbListMoves?dbListMoves({from:0,to:Infinity}):[]);
  const csv=['date;type;code;nom;qty;note'].concat(rows.map(r=>{
    const d=new Date(r.ts).toISOString(); return [d,r.type,r.code,(r.name||''),r.qty,(r.note||'')].map(v=>('"'+String(v).replace(/"/g,'""')+'"')).join(';');
  })).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='journal.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1500);
});
$('#btnExportJSON')?.addEventListener('click', async ()=>{
  const all=await (window.dbExportFull?dbExportFull():{});
  const s=JSON.stringify(all,null,2); const blob=new Blob([s],{type:'application/json'}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='gstock-export.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1500);
});
async function refreshJournal(){
  const df=$('#dateFrom'), dt=$('#dateTo');
  let from=0, to=Infinity;
  if(df?.value) from=new Date(df.value+'T00:00:00').getTime();
  if(dt?.value) to=new Date(dt.value+'T23:59:59').getTime();
  const rows=await (window.dbListMoves?dbListMoves({from,to}):[]);
  journalTbody.innerHTML = rows.map(r=>`<tr>
    <td>${new Date(r.ts).toLocaleString()}</td>
    <td>${esc(r.type)}</td>
    <td><code>${esc(r.code)}</code></td>
    <td>${esc(r.name||'')}</td>
    <td>${r.qty}</td>
    <td>${esc(r.note||'')}</td>
  </tr>`).join('') || '<tr><td colspan="6" class="muted">Aucun mouvement</td></tr>';
}

/* ---------- Emprunts ---------- */
const loansTbody=$('#loansTbody');
$('#btnNewLoan')?.addEventListener('click', ()=>{ $('#loanCode').value=''; $('#loanPerson').value=''; $('#loanDue').value=''; $('#loanNote').value=''; loanDialog.showModal(); });
$('#loanSave')?.addEventListener('click', async e=>{
  e.preventDefault();
  const code=normalizeCode($('#loanCode').value.trim()); if(!code){ alert('Code requis'); return; }
  const it=await (window.dbGet?dbGet(code):null); if(!it){ alert('Article inconnu'); return; }
  const person=$('#loanPerson').value.trim(); const due=$('#loanDue').value; const note=$('#loanNote').value.trim();
  await (window.dbAddLoan?dbAddLoan({ts:Date.now(), code:it.code, name:it.name, person, due, note}):Promise.resolve());
  loanDialog.close(); announce('Emprunt enregistré'); await refreshLoansTable();
});
$('#btnScanBorrow')?.addEventListener('click', ()=> startLoanScan('borrow'));
$('#btnScanReturn')?.addEventListener('click', ()=> startLoanScan('return'));
$('#btnScanInLoan')?.addEventListener('click', ()=> startLoanScan('borrow', (code)=>{ $('#loanCode').value=code; }));

async function refreshLoansTable(){
  const q=($('#searchLoans')?.value||'').toLowerCase();
  const loans=await (window.dbListLoans?dbListLoans(true):[]);
  const filtered=loans.filter(l=>!q || [l.name,l.code,l.person,l.note].join(' ').toLowerCase().includes(q));
  loansTbody.innerHTML = filtered.map(l=>{
    const overdue= (!l.returnedAt && l.due && Date.now()>new Date(l.due).getTime());
    const st = l.returnedAt ? '✅ Retourné' : (overdue?'⛔ En retard':'⏳ En cours');
    const dueStr = l.due ? new Date(l.due).toLocaleDateString() : '—';
    return `<tr>
      <td>${esc(l.name||'')}</td>
      <td><code>${esc(l.code)}</code></td>
      <td>${esc(l.person||'')}</td>
      <td>${dueStr}</td>
      <td>${st}</td>
      <td>
        ${l.returnedAt ? '—' : `<button class="btn" data-ret="${esc(l.id||'')}" data-code="${esc(l.code)}">Marquer rendu</button>`}
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">Aucun emprunt</td></tr>';

  loansTbody.querySelectorAll('button[data-ret]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const code=btn.dataset.code;
      await (window.dbCloseLoan?dbCloseLoan(code):Promise.resolve());
      announce('Retour enregistré'); await refreshLoansTable();
    });
  });
}
$('#searchLoans')?.addEventListener('input', debounced(refreshLoansTable,150));

/* ---------- Paramètres ---------- */
async function initSettingsPanel(){
  const set=await (window.dbGetSettings?dbGetSettings():{})||{};
  $('#inputBuffer').value = String(set.buffer||0);
  $('#chkDebug').checked = !!set.debug;

  function renderList(containerId, arr, type, key){
    const ul=$(containerId); if(!ul) return;
    ul.innerHTML = (arr||[]).map((v,i)=>`<li><span class="drag">↕</span><span style="flex:1">${esc(v)}</span><button class="ghost" data-del="${i}" data-type="${type}" data-key="${key}">Suppr.</button></li>`).join('') || '<li class="muted">—</li>';
    ul.querySelectorAll('button[data-del]').forEach(b=>{
      b.addEventListener('click', async ()=>{
        const idx=parseInt(b.getAttribute('data-del'),10); const t=b.getAttribute('data-type'); const k=b.getAttribute('data-key');
        const s=await (window.dbGetSettings?dbGetSettings():{})||{};
        const arr2 = Array.isArray(s[k])?s[k]:[];
        arr2.splice(idx,1); s[k]=arr2;
        await (window.dbSaveSettings?dbSaveSettings(s):Promise.resolve());
        initSettingsPanel();
      });
    });
  }

  renderList('#listTagsStock', set.defaultTagsStock||[], 'tag','defaultTagsStock'); $('#countTagsStock').textContent=String((set.defaultTagsStock||[]).length);
  renderList('#listTagsAtelier', set.defaultTagsAtelier||[], 'tag','defaultTagsAtelier'); $('#countTagsAtelier').textContent=String((set.defaultTagsAtelier||[]).length);
  renderList('#listLocsStock', set.defaultLocationsStock||[], 'loc','defaultLocationsStock'); $('#countLocsStock').textContent=String((set.defaultLocationsStock||[]).length);
  renderList('#listLocsAtelier', set.defaultLocationsAtelier||[], 'loc','defaultLocationsAtelier'); $('#countLocsAtelier').textContent=String((set.defaultLocationsAtelier||[]).length);

  $('#btnAddTagStock')?.addEventListener('click',async ()=>{
    const v=$('#addTagStock').value.trim(); if(!v) return;
    const s=await dbGetSettings()||{}; s.defaultTagsStock=Array.from(new Set([...(s.defaultTagsStock||[]), v]));
    await (window.dbSaveSettings?dbSaveSettings(s):Promise.resolve()); $('#addTagStock').value=''; initSettingsPanel();
  });
  $('#btnAddTagAtelier')?.addEventListener('click',async ()=>{
    const v=$('#addTagAtelier').value.trim(); if(!v) return;
    const s=await dbGetSettings()||{}; s.defaultTagsAtelier=Array.from(new Set([...(s.defaultTagsAtelier||[]), v]));
    await (window.dbSaveSettings?dbSaveSettings(s):Promise.resolve()); $('#addTagAtelier').value=''; initSettingsPanel();
  });
  $('#btnAddLocStock')?.addEventListener('click',async ()=>{
    const v=$('#addLocStock').value.trim(); if(!v) return;
    const s=await dbGetSettings()||{}; s.defaultLocationsStock=Array.from(new Set([...(s.defaultLocationsStock||[]), v]));
    await (window.dbSaveSettings?dbSaveSettings(s):Promise.resolve()); $('#addLocStock').value=''; initSettingsPanel();
  });
  $('#btnAddLocAtelier')?.addEventListener('click',async ()=>{
    const v=$('#addLocAtelier').value.trim(); if(!v) return;
    const s=await dbGetSettings()||{}; s.defaultLocationsAtelier=Array.from(new Set([...(s.defaultLocationsAtelier||[]), v]));
    await (window.dbSaveSettings?dbSaveSettings(s):Promise.resolve()); $('#addLocAtelier').value=''; initSettingsPanel();
  });

  $('#btnSaveSettings')?.addEventListener('click', async ()=>{
    const s=await dbGetSettings()||{};
    s.buffer = Math.max(0, parseInt($('#inputBuffer').value||'0',10));
    s.debug = !!$('#chkDebug').checked;
    await (window.dbSaveSettings?dbSaveSettings(s):Promise.resolve());
    announce('Paramètres enregistrés');
    refreshHome();
  });

  $('#btnExportFull')?.addEventListener('click', async ()=>{
    const pack=await (window.dbExportFull?dbExportFull():{});
    const s=JSON.stringify(pack,null,2);
    const blob=new Blob([s],{type:'application/json'}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='gstock-full.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1500);
  });
  $('#btnImportJSON')?.addEventListener('click', async ()=>{
    const inp=document.createElement('input'); inp.type='file'; inp.accept='application/json';
    inp.onchange=async ()=>{
      const file=inp.files[0]; if(!file) return;
      const text=await file.text();
      try{
        const data=JSON.parse(text);
        await (window.dbImportFull?dbImportFull(data):Promise.resolve());
        alert('Import réussi'); location.reload();
      }catch(e){ alert('Import invalide : '+e.message); }
    };
    inp.click();
  });
  $('#btnLinkSharedFile')?.addEventListener('click', async ()=>{
    try{
      if(window.dbLinkSharedFile){ const h=await dbLinkSharedFile(); $('#sharedFileStatus').textContent = h?'Fichier lié ✔':'—'; }
    }catch(e){ alert('Échec liaison: '+e.message); }
  });
  $('#btnResetCache')?.addEventListener('click', ()=>{ location.href=location.pathname+'?safe=1'; });
}

/* ---------- Scanner (stock) ---------- */
const scanVideo=$('#scanVideo');
const btnScanStart=$('#btnScanStart'), btnScanStop=$('#btnScanStop'), btnScanTorch=$('#btnScanTorch');
const scanHint=$('#scanHint'), scanFallback=$('#scanFallback'), scanManual=$('#scanManual'), btnScanManual=$('#btnScanManual');

let mediaStream=null, detector=null, scanLoopOn=false, torchOn=false, videoTrack=null;
let audioCtx=null;
function beepKnown(){
  try{
    if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    const o=audioCtx.createOscillator(), g=audioCtx.createGain();
    o.type='sine'; o.frequency.value=880; g.gain.value=0.12;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); setTimeout(()=>{o.stop();},120);
  }catch(_){}
}
async function ensureDetector(){
  if('BarcodeDetector' in window){
    const formats=['code_39','code_128','ean_13','ean_8','upc_a','upc_e'];
    detector = new window.BarcodeDetector({formats});
    return;
  }
  throw new Error('BarcodeDetector non supporté');
}
async function startCamera(videoEl){
  const constraints={ video:{ facingMode:'environment' } };
  mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject=mediaStream; await videoEl.play();
  videoTrack = mediaStream.getVideoTracks()[0];
  const caps=videoTrack.getCapabilities?.()||{};
  if(caps.torch){ show(btnScanTorch,true); } else { show(btnScanTorch,false); }
}
function stopCamera(videoEl){
  try{ videoEl.pause(); }catch(_){}
  try{
    mediaStream?.getTracks().forEach(t=>t.stop());
  }catch(_){}
  mediaStream=null; videoTrack=null; torchOn=false; show(btnScanTorch,false);
}
async function toggleTorch(){
  if(!videoTrack) return;
  const caps=videoTrack.getCapabilities?.()||{};
  if(!caps.torch) return;
  torchOn=!torchOn;
  await videoTrack.applyConstraints({ advanced:[{torch:torchOn}] });
}

async function scanLoop(handler){
  if(!detector || !scanVideo) return;
  scanLoopOn=true;
  while(scanLoopOn){
    try{
      const codes=await detector.detect(scanVideo);
      if(codes && codes.length){
        const raw=codes[0].rawValue||codes[0].rawValue||'';
        const code=normalizeCode(raw);
        const hit=await getByCodeAnyCase(code);
        if(hit){
          beepKnown();
          scanLoopOn=false; stopCamera(scanVideo);
          await handler(hit);
          break;
        }
        // sinon: article inconnu → on continue
      }
      await new Promise(r=>setTimeout(r,80));
    }catch(e){
      console.warn('scan err',e);
      await new Promise(r=>setTimeout(r,160));
    }
  }
}

btnScanStart?.addEventListener('click', async ()=>{
  show(scanFallback,false);
  try{
    await ensureDetector();
    await startCamera(scanVideo);
    show(btnScanStart,false); show(btnScanStop,true);
    scanHint.textContent='Visez le code-barres…';
    await scanLoop(async (it)=>{ // connu → ouvrir ajustement
      await openAdjustDialog({code:it.code});
    });
  }catch(e){
    console.warn('startScan error',e);
    scanHint.textContent='Scanner indisponible. Utilisez la saisie manuelle.';
    show(scanFallback,true);
  }
});
btnScanStop?.addEventListener('click', ()=>{
  scanLoopOn=false; stopCamera(scanVideo); show(btnScanStop,false); show(btnScanStart,true);
});
btnScanTorch?.addEventListener('click', toggleTorch);
btnScanManual?.addEventListener('click', async ()=>{
  const v=normalizeCode(scanManual.value.trim()); if(!v) return;
  const hit=await getByCodeAnyCase(v);
  if(hit){ beepKnown(); await openAdjustDialog({code:hit.code}); }
  else alert('Code inconnu');
});

/* ---------- Scanner Emprunt/Retour ---------- */
const loanDialog=$('#loanDialog'), loanScanDialog=$('#loanScanDialog'), loanVideo=$('#loanVideo');
const loanScanStop=$('#loanScanStop'), loanScanTitle=$('#loanScanTitle');
let loanLoop=false;
async function startLoanScan(mode, onDetect){
  loanScanTitle.textContent = (mode==='return')?'Scanner un retour':'Scanner un emprunt';
  loanScanDialog.showModal();
  try{
    await ensureDetector();
    await startCamera(loanVideo);
    loanLoop=true;
    while(loanLoop){
      const codes=await detector.detect(loanVideo);
      if(codes && codes.length){
        const code=normalizeCode(codes[0].rawValue||'');
        const hit=await getByCodeAnyCase(code);
        if(hit){
          beepKnown();
          loanLoop=false; stopCamera(loanVideo);
          loanScanDialog.close();
          if(typeof onDetect==='function'){ onDetect(hit.code); return; }
          if(mode==='return'){
            await (window.dbCloseLoan?dbCloseLoan(hit.code):Promise.resolve());
            announce('Retour enregistré'); await refreshLoansTable();
          }else{ // borrow
            // pré-remplir le dialog de création
            $('#loanCode').value=hit.code;
            loanDialog.showModal();
          }
          return;
        }
      }
      await new Promise(r=>setTimeout(r,90));
    }
  }catch(e){
    console.warn('loan scan error', e);
    alert('Scanner indisponible sur cet appareil.');
    loanScanDialog.close();
  }
}
loanScanStop?.addEventListener('click', ()=>{ loanLoop=false; stopCamera(loanVideo); });

/* ---------- Étiquettes (mêmes réglages que 2.9.5) ---------- */
const LABEL_TEMPLATES={
  'a4-3x8-63x34':{cols:3,rows:8,cellW:63.5,cellH:33.9,gapX:2.5,gapY:2.0,marginX:7.5,marginY:10.7},
  'avery-l7160':{cols:3,rows:7,cellW:63.5,cellH:38.1,gapX:2.5,gapY:0,marginX:7.5,marginY:12.0},
  'avery-l7163':{cols:2,rows:7,cellW:99.1,cellH:38.1,gapX:2.0,gapY:0,marginX:5.0,marginY:13.5},
  'avery-l7162':{cols:2,rows:8,cellW:99.1,cellH:33.9,gapX:2.0,gapY:2.0,marginX:5.0,marginY:10.7},
  'avery-l7165':{cols:2,rows:4,cellW:99.1,cellH:67.7,gapX:2.0,gapY:0,marginX:5.0,marginY:13.5}
};
let labelsInitDone=false, labelsAllItems=[], labelsSelected=new Set(), lblPage=0, lblPagesCount=1;
const labelSearch=$('#labelSearch'), labelsList=$('#labelsList'), lblSelInfo=$('#lblSelInfo'),
      lblTemplate=$('#lblTemplate'), lblDensity=$('#lblDensity'), lblNameSize=$('#lblNameSize'), lblShowText=$('#lblShowText'),
      lblOffsetX=$('#lblOffsetX'), lblOffsetY=$('#lblOffsetY'),
      lblShowName=$('#lblShowName'), lblCodeTextSize=$('#lblCodeTextSize'), lblBarHeightPct=$('#lblBarHeightPct'), lblPadding=$('#lblPadding'), lblLayout=$('#lblLayout'),
      labelsPages=$('#labelsPages'), btnLblAll=$('#lblAll'), btnLblNone=$('#lblNone'),
      btnLblPrev=$('#lblPrev'), btnLblNext=$('#lblNext'), btnLabelsPrint=$('#btnLabelsPrint');

function initLabelsPanel(){ if(!labelsInitDone){ bindLabelsUI(); labelsInitDone=true; } loadLabelsData().then(()=>{ rebuildLabelsList(); rebuildLabelsPreview(true); }); }
async function loadLabelsData(){ labelsAllItems=await (window.dbList?dbList():[]); if(labelsSelected.size===0){ labelsAllItems.forEach(i=>labelsSelected.add(i.code)); } }
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
      'avery-l7165':'Avery L7165 (2×4 99.1×67.7)'
    };
    lblTemplate.innerHTML = Object.entries(LABEL_TEMPLATES).map(([k,t])=>{
      const label=nameMap[k]||`${k} (${t.cols}×${t.rows} ${t.cellW}×${t.cellH}mm)`; return `<option value="${k}">${label}</option>`;
    }).join('');
    let t=localStorage.getItem('gstock.lblTemplate'); if(!t || !LABEL_TEMPLATES[t]){ t='a4-3x8-63x34'; localStorage.setItem('gstock.lblTemplate',t); }
    lblTemplate.value=t;
    lblTemplate.addEventListener('change',()=>{ localStorage.setItem('gstock.lblTemplate', lblTemplate.value); rebuildLabelsPreview(true); });
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
function chunkArray(arr,size){ const out=[]; for(let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out; }
function mm(n){ return n+'mm'; }

function renderLabelCardHTML(it, tmpl, opts){
  const {module, namePt, showName, showText, codeTextPt, barHeightPct, paddingMm, layout} = opts;
  const mmToPx = (mm)=> Math.max(1, Math.floor(mm * 3.78));
  const pad= Math.max(0, Number(paddingMm)||0);
  const availH = Math.max(4, (tmpl.cellH - pad*2));
  const reservedTopMm = showName ? (namePt * 0.3527 + 1) : 0;
  const reservedBottomMm = showText ? (codeTextPt * 0.3527 + 1) : 0;
  const targetBarMm = Math.max(6, (availH * (Math.max(20,Math.min(90,Number(barHeightPct)||60))/100)));
  const maxBarMm = Math.max(6, availH - reservedTopMm - reservedBottomMm);
  const barMm = Math.min(targetBarMm, maxBarMm);
  const barHeightPx = mmToPx(barMm);

  let svgStr = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  try{
    if (window.code39 && typeof window.code39.svg === 'function'){
      const svgEl = window.code39.svg(it.code, { module, height: barHeightPx, margin: 2, showText: false, fontSize: 10 });
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

  let inner='';
  if(layout==='name-below') inner = `${barcodeHTML}${codeText}${nameHTML}`;
  else if(layout==='barcode-only') inner = `${barcodeHTML}`;
  else inner = `${nameHTML}${barcodeHTML}${codeText}`;

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
  const q=(labelSearch&&labelSearch.value||'').toLowerCase();
  if(labelsList){
    labelsList.innerHTML=labelsAllItems.filter(i=>!q||[i.name,i.code,(i.tags||[]).join(' ')].join(' ').toLowerCase().includes(q))
      .map(i=>`<div class="row"><label style="display:flex;align-items:center;gap:.5rem;flex:1"><input type="checkbox" class="lblRow" data-code="${esc(i.code)}" ${(labelsSelected.has(i.code)?'checked':'')}> <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.name)}</span></label><code>${esc(i.code)}</code></div>`).join('');
    labelsList.querySelectorAll('.lblRow').forEach(cb=>{
      cb.addEventListener('change',()=>{ const code=cb.dataset.code; if(cb.checked) labelsSelected.add(code); else labelsSelected.delete(code); updateLblSelInfo(); rebuildLabelsPreview(true); });
    });
  }
  updateLblSelInfo();
}
function rebuildLabelsPreview(resetPage){
  const key=(lblTemplate&&lblTemplate.value)||'a4-3x8-63x34';
  const tmpl=LABEL_TEMPLATES[key]||LABEL_TEMPLATES['a4-3x8-63x34'];
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
  const selectedItems=labelsAllItems.filter(i=>labelsSelected.has(i.code));
  const pagesHTML=buildLabelsPagesHTML(selectedItems,tmpl,opts);
  if(labelsPages) labelsPages.innerHTML=pagesHTML;
  const perPage=(tmpl.cols|0)*(tmpl.rows|0);
  const countPages=Math.max(1, Math.ceil(selectedItems.length/perPage));
  lblPagesCount=countPages;
  if(resetPage) lblPage=0;
  updatePaginationDisplay();
}
function updatePaginationDisplay(){
  const pages=$$('.labels-page',labelsPages);
  pages.forEach((p,i)=>p.classList.toggle('active', i===lblPage));
  const info=$('#lblPageInfo'); info && (info.textContent='Page '+Math.min(lblPage+1,lblPagesCount)+' / '+lblPagesCount);
  const prev=$('#lblPrev'), next=$('#lblNext'), one=(lblPagesCount<=1);
  if(prev){ prev.disabled=(lblPage<=0); show(prev,!one); }
  if(next){ next.disabled=(lblPage>=lblPagesCount-1); show(next,!one); }
  show(info,!one);
}
function printLabelsClean(){
  try{
    const key=(lblTemplate&&lblTemplate.value)||'a4-3x8-63x34';
    const tmpl=LABEL_TEMPLATES[key]||LABEL_TEMPLATES['a4-3x8-63x34'];
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
    const selectedItems=labelsAllItems.filter(i=>labelsSelected.has(i.code));
    const pagesHTML=buildLabelsPagesHTML(selectedItems,tmpl,opts);
    const css=`@page{size:A4;margin:0}html,body{margin:0;padding:0}.labels-page{break-after:page}.labels-sheet{display:grid}.label-card{box-sizing:border-box;overflow:hidden;text-align:center}.label-card .name{font-weight:600;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.label-card .code-text{line-height:1.1}`;
    const html=`<!doctype html><html><head><meta charset="utf-8"><title>Étiquettes</title><style>${css}</style></head><body>${pagesHTML}</body></html>`;
    const w=window.open('','gstock_print','width=900,height=700'); if(!w){ alert('Pop-up bloquée'); return; }
    w.document.open(); w.document.write(html); w.document.close(); w.focus(); setTimeout(()=>{ try{ w.print(); }catch(_){ } setTimeout(()=>{ try{ w.close(); }catch(_){ } }, 500); }, 200);
  }catch(e){ console.warn('print error',e); alert('Impossible de lancer l’impression propre.'); window.print(); }
}

/* ---------- INIT ---------- */
(async function init(){
  $('#appVersion') && ($('#appVersion').textContent=window.APP_VERSION||'');
  try{
    if(typeof window.dbInit!=='function') throw new Error('db.js non chargé');
    await dbInit();
  }catch(e){
    console.warn('Init DB error (verbose):',e);
    // si IDB HS → on laisse db.js tomber en mémoire ; on garde l’appli utilisable
  }
  await refreshHome();
  showTab('home');
  await refreshLoansTable(); // existante à présent
})();
})();
