/* Gstock - db.js v2.9.7
 * Stratégie de stockage :
 *  - IndexedDB si disponible et sain
 *  - Sinon fallback localStorage (persistant entre rafraîchissements)
 *  - Sinon mémoire (ultime recours)
 */
(function(){
'use strict';

const LS_KEY = 'gstock.store.v1';
let MODE = 'memory'; // 'idb' | 'local' | 'memory'
let idb = null;

// ----- helpers communs -----
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function now(){ return Date.now(); }
function uid(prefix){ return (prefix||'ID')+'-'+now().toString(36)+'-'+Math.random().toString(36).slice(2,8); }
function toArray(x){ return Array.isArray(x)?x:[]; }

const DEFAULT_SETTINGS = {
  id: 'settings',
  buffer: 0,
  debug: false,
  defaultTagsStock: [],
  defaultTagsAtelier: [],
  defaultLocationsStock: [],
  defaultLocationsAtelier: []
};

function emptyStore(){
  return {
    items: [],   // {id, code, name, ref, qty, threshold, tags[], location, links[], type, updated}
    moves: [],   // {id, ts, type, code, name, qty, note}
    loans: [],   // {id, ts, code, name, person, due, note, returnedAt?}
    settings: clone(DEFAULT_SETTINGS)
  };
}

// ===== localStorage backend =====
function lsLoad(){
  try {
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return emptyStore();
    const data = JSON.parse(raw);
    // sécurise les clés
    data.items   = toArray(data.items);
    data.moves   = toArray(data.moves);
    data.loans   = toArray(data.loans);
    data.settings= Object.assign({}, DEFAULT_SETTINGS, data.settings||{});
    return data;
  } catch(e){
    console.warn('localStorage load error', e);
    return emptyStore();
  }
}
function lsSave(data){
  try{
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  }catch(e){
    console.warn('localStorage save error', e);
  }
}

// ===== IndexedDB backend =====
function idbOpen(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open('gstock', 3);
    req.onupgradeneeded = (ev)=>{
      const db = req.result;
      if(!db.objectStoreNames.contains('items')){
        db.createObjectStore('items', { keyPath: 'code' });
      }
      if(!db.objectStoreNames.contains('moves')){
        db.createObjectStore('moves', { keyPath: 'id' });
      }
      if(!db.objectStoreNames.contains('loans')){
        db.createObjectStore('loans', { keyPath: 'id' });
      }
      if(!db.objectStoreNames.contains('settings')){
        db.createObjectStore('settings', { keyPath: 'id' });
      }
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror   = ()=> reject(req.error || new Error('IDB open error'));
    req.onblocked = ()=> console.warn('IDB blocked');
  });
}
function idbTx(store, mode){
  return idb.transaction(store, mode).objectStore(store);
}
function idbGet(store, key){
  return new Promise((res,rej)=>{
    const r = idbTx(store,'readonly').get(key);
    r.onsuccess=()=>res(r.result||null);
    r.onerror=()=>rej(r.error);
  });
}
function idbPut(store, value){
  return new Promise((res,rej)=>{
    const r = idbTx(store,'readwrite').put(value);
    r.onsuccess=()=>res(true);
    r.onerror=()=>rej(r.error);
  });
}
function idbDel(store, key){
  return new Promise((res,rej)=>{
    const r = idbTx(store,'readwrite').delete(key);
    r.onsuccess=()=>res(true);
    r.onerror=()=>rej(r.error);
  });
}
function idbAll(store){
  return new Promise((res,rej)=>{
    const r = idbTx(store,'readonly').getAll();
    r.onsuccess=()=>res(r.result||[]);
    r.onerror=()=>rej(r.error);
  });
}

// ===== API commune =====
async function _getSettings(){
  if(MODE==='idb'){
    let s = await idbGet('settings','settings');
    if(!s){ s = clone(DEFAULT_SETTINGS); await idbPut('settings', s); }
    return s;
  }
  if(MODE==='local'){
    const d = lsLoad();
    if(!d.settings) d.settings = clone(DEFAULT_SETTINGS);
    lsSave(d);
    return d.settings;
  }
  // memory
  if(!window.__GSTOCK_MEM__) window.__GSTOCK_MEM__ = emptyStore();
  return window.__GSTOCK_MEM__.settings;
}
async function _saveSettings(s){
  const merged = Object.assign({}, DEFAULT_SETTINGS, s||{});
  if(MODE==='idb'){ await idbPut('settings', merged); return; }
  if(MODE==='local'){ const d=lsLoad(); d.settings=merged; lsSave(d); return; }
  window.__GSTOCK_MEM__.settings = merged;
}

async function _listItems(){
  if(MODE==='idb') return await idbAll('items');
  if(MODE==='local') return lsLoad().items;
  return (window.__GSTOCK_MEM__||emptyStore()).items;
}
async function _getItem(code){
  if(MODE==='idb') return await idbGet('items', code);
  if(MODE==='local') return lsLoad().items.find(it=>it.code===code)||null;
  const d = window.__GSTOCK_MEM__||emptyStore(); return d.items.find(it=>it.code===code)||null;
}
async function _putItem(it){
  const v = Object.assign({}, it, { id: it.code, updated: now() });
  if(MODE==='idb'){ await idbPut('items', v); return; }
  if(MODE==='local'){
    const d=lsLoad();
    const idx = d.items.findIndex(x=>x.code===v.code);
    if(idx>=0) d.items[idx]=v; else d.items.push(v);
    lsSave(d); return;
  }
  const d=window.__GSTOCK_MEM__||emptyStore();
  const idx = d.items.findIndex(x=>x.code===v.code);
  if(idx>=0) d.items[idx]=v; else d.items.push(v);
  window.__GSTOCK_MEM__=d;
}
async function _delItem(code){
  if(MODE==='idb'){ await idbDel('items', code); return; }
  if(MODE==='local'){
    const d=lsLoad(); d.items = d.items.filter(x=>x.code!==code); lsSave(d); return;
  }
  const d=window.__GSTOCK_MEM__; d.items = d.items.filter(x=>x.code!==code);
}
async function _adjustQty(code, delta){
  const it = await _getItem(code); if(!it) return;
  it.qty = Math.max(0, (it.qty|0) + (delta|0));
  await _putItem(it);
}

async function _listMoves({from=0,to=Infinity,limit=Infinity}={}){
  let arr=[];
  if(MODE==='idb'){ arr = await idbAll('moves'); }
  else if(MODE==='local'){ arr = lsLoad().moves; }
  else { arr = (window.__GSTOCK_MEM__||emptyStore()).moves; }
  arr = arr.filter(m=>m.ts>=from && m.ts<=to).sort((a,b)=>b.ts-a.ts);
  if(isFinite(limit)) arr = arr.slice(0, limit);
  return arr;
}
async function _addMove(m){
  const rec = Object.assign({ id: uid('MV') }, m);
  if(MODE==='idb'){ await idbPut('moves', rec); return; }
  if(MODE==='local'){ const d=lsLoad(); d.moves.push(rec); lsSave(d); return; }
  const d=window.__GSTOCK_MEM__||emptyStore(); d.moves.push(rec); window.__GSTOCK_MEM__=d;
}

async function _listLoans(includeClosed){
  let arr=[];
  if(MODE==='idb'){ arr = await idbAll('loans'); }
  else if(MODE==='local'){ arr = lsLoad().loans; }
  else { arr = (window.__GSTOCK_MEM__||emptyStore()).loans; }
  if(!includeClosed) arr = arr.filter(l=>!l.returnedAt);
  // du plus récent au plus ancien
  return arr.sort((a,b)=>(b.ts||0)-(a.ts||0));
}
async function _addLoan(l){
  const rec = Object.assign({ id: uid('LN') }, l);
  if(MODE==='idb'){ await idbPut('loans', rec); return; }
  if(MODE==='local'){ const d=lsLoad(); d.loans.push(rec); lsSave(d); return; }
  const d=window.__GSTOCK_MEM__||emptyStore(); d.loans.push(rec); window.__GSTOCK_MEM__=d;
}
async function _closeLoan(code){
  // marque le plus récent prêt de ce code comme rendu
  let arr=[];
  if(MODE==='idb'){ arr = await idbAll('loans'); }
  else if(MODE==='local'){ const d=lsLoad(); arr=d.loans; }
  else { arr=(window.__GSTOCK_MEM__||emptyStore()).loans; }
  const idx = arr.findIndex(l=>l.code===code && !l.returnedAt);
  if(idx<0) return;
  const ln = Object.assign({}, arr[idx], { returnedAt: now() });
  if(MODE==='idb'){ await idbPut('loans', ln); return; }
  if(MODE==='local'){ const d=lsLoad(); const i=d.loans.findIndex(x=>x.id===ln.id); if(i>=0) d.loans[i]=ln; lsSave(d); return; }
  const d=window.__GSTOCK_MEM__; const i=d.loans.findIndex(x=>x.id===ln.id); if(i>=0) d.loans[i]=ln;
}

async function _exportFull(){
  const items = await _listItems();
  const moves = await _listMoves({from:0,to:Infinity});
  const loans = await _listLoans(true);
  const settings = await _getSettings();
  return { items, moves, loans, settings };
}
async function _importFull(data){
  const pack = data||{};
  const items = toArray(pack.items);
  const moves = toArray(pack.moves);
  const loans = toArray(pack.loans);
  const settings = Object.assign({}, DEFAULT_SETTINGS, pack.settings||{});

  if(MODE==='idb'){
    // remplace le contenu
    const tx = idb.transaction(['items','moves','loans','settings'],'readwrite');
    await Promise.all([
      new Promise((res,rej)=>{ const r=tx.objectStore('items').clear(); r.onsuccess=res; r.onerror=()=>rej(r.error); }),
      new Promise((res,rej)=>{ const r=tx.objectStore('moves').clear(); r.onsuccess=res; r.onerror=()=>rej(r.error); }),
      new Promise((res,rej)=>{ const r=tx.objectStore('loans').clear(); r.onsuccess=res; r.onerror=()=>rej(r.error); })
    ]);
    const oi = tx.objectStore('items');
    const om = tx.objectStore('moves');
    const ol = tx.objectStore('loans');
    items.forEach(v=>oi.put(Object.assign({},v,{id:v.code})));
    moves.forEach(v=>om.put(v.id? v : Object.assign({id:uid('MV')},v)));
    loans.forEach(v=>ol.put(v.id? v : Object.assign({id:uid('LN')},v)));
    tx.objectStore('settings').put(Object.assign({id:'settings'}, settings));
    await new Promise((res,rej)=>{ tx.oncomplete=res; tx.onerror=()=>rej(tx.error); tx.onabort=()=>rej(tx.error||new Error('tx abort')); });
    return;
  }

  if(MODE==='local'){
    const d = emptyStore();
    d.items = items.map(v=>Object.assign({},v,{id:v.code}));
    d.moves = moves.map(v=> v.id?v:Object.assign({id:uid('MV')},v));
    d.loans = loans.map(v=> v.id?v:Object.assign({id:uid('LN')},v));
    d.settings = Object.assign({id:'settings'}, settings);
    lsSave(d); return;
  }

  window.__GSTOCK_MEM__ = {
    items: items.map(v=>Object.assign({},v,{id:v.code})),
    moves: moves.map(v=> v.id?v:Object.assign({id:uid('MV')},v)),
    loans: loans.map(v=> v.id?v:Object.assign({id:uid('LN')},v)),
    settings: Object.assign({id:'settings'}, settings)
  };
}

// ===== Public API =====
async function dbInit(){
  // Demande de "persistent storage" quand possible (réduit le risque d'éviction)
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(_){}

  if('indexedDB' in window){
    try{
      idb = await idbOpen();
      MODE = 'idb';
      // vérif write
      const test = { id:'settings', foo:'bar' };
      await idbPut('settings', test);
      const back = await idbGet('settings','settings');
      if(!back){ throw new Error('IDB readback fail'); }
      // réécrit settings propres si besoin
      const merged = Object.assign({}, DEFAULT_SETTINGS, (await idbGet('settings','settings'))||{});
      await idbPut('settings', merged);
      console.info('[db] MODE=idb');
      return;
    }catch(e){
      console.warn('IDB disabled, fallback localStorage:', e);
    }
  }

  try{
    // Test localStorage
    localStorage.setItem(LS_KEY+'__t','1');
    localStorage.removeItem(LS_KEY+'__t');
    // init si absent
    const cur = lsLoad();
    if(!cur || !cur.settings || typeof cur.items==='undefined'){
      lsSave(emptyStore());
    }
    MODE='local';
    console.info('[db] MODE=localStorage');
    return;
  }catch(e){
    console.warn('localStorage inaccessible, fallback mémoire:', e);
  }

  // Mémoire (ultime recours)
  window.__GSTOCK_MEM__ = emptyStore();
  MODE='memory';
  console.info('[db] MODE=memory');
}

async function dbNuke(clearLocalAlso=true){
  try{
    if(MODE==='idb' && idb){
      await new Promise((res,rej)=>{
        const req = indexedDB.deleteDatabase('gstock');
        req.onsuccess=()=>res(true);
        req.onerror =()=>rej(req.error);
      });
    }
  }catch(e){ console.warn('IDB nuke error',e); }
  try{
    if(clearLocalAlso) localStorage.removeItem(LS_KEY);
  }catch(e){}
  if(window.__GSTOCK_MEM__) delete window.__GSTOCK_MEM__;
  MODE='memory'; idb=null;
}

async function dbGetSettings(){ return await _getSettings(); }
async function dbSaveSettings(s){ return await _saveSettings(s); }

async function dbList(){ return await _listItems(); }
async function dbGet(code){ return await _getItem(code); }
async function dbPut(it){ return await _putItem(it); }
async function dbDelete(code){ return await _delItem(code); }
async function dbAdjustQty(code,delta){ return await _adjustQty(code,delta); }

async function dbListMoves(f){ return await _listMoves(f||{}); }
async function dbAddMove(m){ return await _addMove(m); }

async function dbListLoans(includeClosed){ return await _listLoans(!!includeClosed); }
async function dbAddLoan(l){ return await _addLoan(l); }
async function dbCloseLoan(code){ return await _closeLoan(code); }

async function dbExportFull(){ return await _exportFull(); }
async function dbImportFull(data){ return await _importFull(data); }

/* Optionnel : Lier un fichier partagé (nécessite File System Access API)
 * Si IndexedDB est KO, on ne persiste pas le handle entre les sessions.
 * On fait donc une écriture ponctuelle (export) pour dépanner.
 */
async function dbLinkSharedFile(){
  if(!window.showSaveFilePicker){
    alert('File System Access API non supportée par ce navigateur.');
    return null;
  }
  try{
    const handle = await window.showSaveFilePicker({
      suggestedName: 'gstock-data.json',
      types: [{ description:'JSON', accept: {'application/json':['.json']} }]
    });
    // écrit l’état courant
    const writable = await handle.createWritable();
    const pack = await dbExportFull();
    await writable.write(new Blob([JSON.stringify(pack,null,2)],{type:'application/json'}));
    await writable.close();
    alert('Fichier écrit. Pense à ré-ouvrir ce fichier lorsque tu veux sauvegarder de nouveau.');
    return true;
  }catch(e){
    console.warn('link shared file error', e);
    return null;
  }
}

// expose
window.dbInit = dbInit;
window.dbNuke = dbNuke;

window.dbGetSettings = dbGetSettings;
window.dbSaveSettings = dbSaveSettings;

window.dbList = dbList;
window.dbGet = dbGet;
window.dbPut = dbPut;
window.dbDelete = dbDelete;
window.dbAdjustQty = dbAdjustQty;

window.dbListMoves = dbListMoves;
window.dbAddMove = dbAddMove;

window.dbListLoans = dbListLoans;
window.dbAddLoan = dbAddLoan;
window.dbCloseLoan = dbCloseLoan;

window.dbExportFull = dbExportFull;
window.dbImportFull = dbImportFull;

window.dbLinkSharedFile = dbLinkSharedFile;

})();
