/* Gstock - db.js (IndexedDB + export/import + fichier partagé) */
'use strict';

const DB_NAME = 'gstock';
const DB_VER  = 3;
let db = null;

// Fichier partagé (File System Access)
let sharedHandle = null;
let autosaveTimer = null;

// ---- IDB helpers
function idbOpen(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (ev)=>{
      const d = ev.target.result;
      if (!d.objectStoreNames.contains('items')) {
        d.createObjectStore('items', { keyPath: 'code' });
      }
      if (!d.objectStoreNames.contains('moves')) {
        const store = d.createObjectStore('moves', { keyPath: 'id', autoIncrement: true });
        store.createIndex('by_ts', 'ts');
        store.createIndex('by_code', 'code');
      }
      if (!d.objectStoreNames.contains('loans')) {
        const store = d.createObjectStore('loans', { keyPath: 'id', autoIncrement: true });
        store.createIndex('active', 'returnedAt');
        store.createIndex('by_code', 'code');
      }
      if (!d.objectStoreNames.contains('meta')) {
        d.createObjectStore('meta', { keyPath: 'id' });
      }
    };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}
function tx(store, mode='readonly'){
  return db.transaction(store, mode).objectStore(store);
}

async function dbInit(){
  db = await idbOpen();
  // init settings
  const meta = await getMeta('settings');
  if (!meta) await setMeta('settings', { id:'settings', buffer:0, defaultTags:[] });
  return true;
}

// ---- Meta
function getMeta(id){
  return new Promise((resolve,reject)=>{
    const r = tx('meta').get(id);
    r.onsuccess = ()=>resolve(r.result||null);
    r.onerror = ()=>reject(r.error);
  });
}
function setMeta(id, obj){
  return new Promise((resolve,reject)=>{
    const r = tx('meta','readwrite').put(obj);
    r.onsuccess = ()=>resolve(true);
    r.onerror = ()=>reject(r.error);
  });
}
async function dbGetSettings(){
  const m = await getMeta('settings');
  return m || {id:'settings',buffer:0,defaultTags:[]};
}
async function dbSetSettings(p){
  const cur = await dbGetSettings();
  await setMeta('settings', {...cur, ...p});
  scheduleAutosave();
}

// ---- Items
function dbGet(code){
  return new Promise((resolve,reject)=>{
    const r = tx('items').get(code);
    r.onsuccess = ()=>resolve(r.result||null);
    r.onerror = ()=>reject(r.error);
  });
}
function dbPut(item){
  return new Promise((resolve,reject)=>{
    const r = tx('items','readwrite').put(item);
    r.onsuccess = ()=>{ scheduleAutosave(); resolve(true); };
    r.onerror = ()=>reject(r.error);
  });
}
function dbDelete(code){
  return new Promise((resolve,reject)=>{
    const r = tx('items','readwrite').delete(code);
    r.onsuccess = ()=>{ scheduleAutosave(); resolve(true); };
    r.onerror = ()=>reject(r.error);
  });
}
function dbList(){
  return new Promise((resolve,reject)=>{
    const req = tx('items').getAll();
    req.onsuccess = ()=>resolve(req.result||[]);
    req.onerror = ()=>reject(req.error);
  });
}
async function dbAdjustQty(code, delta){
  const it = await dbGet(code);
  if (!it) throw new Error('item not found');
  it.qty = Math.max(0, (it.qty|0) + (delta|0));
  it.updated = Date.now();
  await dbPut(it);
  return it.qty;
}
async function dbGenerateCode(){
  // simple code EAN-like 12 digits (sans checksum)
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return 'CFA' + timestamp.slice(-8) + random;
}

// ---- Moves (journal)
// ... le reste de db.js inchangé ...

async function dbAddMove(m){
  // Ajoute un mouvement ; en cas de ConstraintError (clé déjà existante),
  // on modifie légèrement 'ts' et on ré-essaie (jusqu'à 8 fois).
  return new Promise((resolve,reject)=>{
    const store = tx('moves','readwrite');
    const tryAdd = (rec, attempt=0)=>{
      const req = store.add(rec);
      req.onsuccess = ()=>{ scheduleAutosave(); resolve(true); };
      req.onerror = (ev)=>{
        const err = ev.target.error;
        if (err && err.name === 'ConstraintError' && attempt < 8) {
          // collision de clé: décale ts et retente
          const jitter = 1 + Math.floor(Math.random()*5);
          rec.ts = (rec.ts|0) + jitter;
          tryAdd(rec, attempt+1);
        } else {
          reject(err || new Error('dbAddMove failed'));
        }
      };
    };
    // clone pour ne pas muter l'objet d'origine
    tryAdd({...m});
  });
}

function dbListMoves({from=0,to=Infinity,code=null,limit=1000}={}){
  return new Promise((resolve,reject)=>{
    const store = tx('moves');
    const idx = store.index('by_ts');
    const range = IDBKeyRange.bound(from, to);
    const res = [];
    idx.openCursor(range,'prev').onsuccess = (ev)=>{
      const cur = ev.target.result;
      if (cur && res.length<limit){
        const v = cur.value;
        if (!code || v.code === code) res.push(v);
        cur.continue();
      } else {
        resolve(res);
      }
    };
    idx.openCursor(range,'prev').onerror = ()=>reject(idx.error);
  });
}

// ---- Loans
function dbCreateLoan({code,name,person,due,note}){
  const obj = { code, name, person, due, note, createdAt: Date.now(), returnedAt: null };
  return new Promise((resolve,reject)=>{
    const r = tx('loans','readwrite').add(obj);
    r.onsuccess = ()=>{ scheduleAutosave(); resolve(true); };
    r.onerror = ()=>reject(r.error);
  });
}
function dbListLoans(includeClosed=true){
  return new Promise((resolve,reject)=>{
    const req = tx('loans').getAll();
    req.onsuccess = ()=>{
      let arr = req.result||[];
      if (!includeClosed) arr = arr.filter(x=>!x.returnedAt);
      resolve(arr.sort((a,b)=>(b.createdAt|0)-(a.createdAt|0)));
    };
    req.onerror = ()=>reject(req.error);
  });
}
function dbListLoansByCode(code){
  return new Promise((resolve,reject)=>{
    const idx = tx('loans').index('by_code');
    const req = idx.getAll(IDBKeyRange.only(code));
    req.onsuccess = ()=>resolve((req.result||[]).sort((a,b)=>(b.createdAt|0)-(a.createdAt|0)));
    req.onerror = ()=>reject(req.error);
  });
}
function dbReturnLoan(id){
  return new Promise((resolve,reject)=>{
    const store = tx('loans','readwrite');
    const get = store.get(id);
    get.onsuccess = ()=>{
      const l = get.result;
      if (!l) return resolve(false);
      l.returnedAt = Date.now();
      const put = store.put(l);
      put.onsuccess = ()=>{ scheduleAutosave(); resolve(true); };
      put.onerror = ()=>reject(put.error);
    };
    get.onerror = ()=>reject(get.error);
  });
}

// ---- Export / Import
async function dbExport(format='csv'){
  const moves = await dbListMoves({limit:10000});
  if (format==='json') return JSON.stringify(moves, null, 2);
  // CSV
  const header = 'ts,type,code,name,qty,note\n';
  const rows = moves.map(m=>[
    new Date(m.ts).toISOString(),
    m.type, m.code, (m.name||'').replace(/"/g,'""'), m.qty, (m.note||'').replace(/"/g,'""')
  ].map(v=>typeof v==='string'?`"${v}"`:v).join(',')).join('\n');
  return header+rows+'\n';
}

async function dbExportFull(){
  const [settings, items, moves, loans] = await Promise.all([
    dbGetSettings(),
    dbList(),
    dbListMoves({limit:100000}),
    dbListLoans(true)
  ]);
  return {
    version: 1,
    exportedAt: Date.now(),
    settings: { id:'main', buffer: settings.buffer|0, defaultTags: settings.defaultTags||[] },
    items, moves, loans
  };
}

async function clearStore(name){
  return new Promise((resolve,reject)=>{
    const r = tx(name,'readwrite').clear();
    r.onsuccess = ()=>resolve(true);
    r.onerror = ()=>reject(r.error);
  });
}

async function dbImportFull(blob){
  // blob: {settings, items, moves, loans}
  await clearStore('items');
  await clearStore('moves');
  await clearStore('loans');
  if (blob.settings) await dbSetSettings({buffer: blob.settings.buffer|0, defaultTags: blob.settings.defaultTags||[]});
  // put items
  await Promise.all((blob.items||[]).map(it=>dbPut(it)));
  // bulk moves
  await new Promise((resolve,reject)=>{
    const store = tx('moves','readwrite');
    let i=0;
    (blob.moves||[]).forEach(m=>{
      const r = store.add(m);
      r.onerror = ()=>reject(r.error);
      r.onsuccess = ()=>{ i++; if (i===(blob.moves||[]).length) resolve(true); };
    });
    if ((blob.moves||[]).length===0) resolve(true);
  });
  // bulk loans
  await new Promise((resolve,reject)=>{
    const store = tx('loans','readwrite');
    let i=0;
    (blob.loans||[]).forEach(l=>{
      const r = store.add(l);
      r.onerror = ()=>reject(r.error);
      r.onsuccess = ()=>{ i++; if (i===(blob.loans||[]).length) resolve(true); };
    });
    if ((blob.loans||[]).length===0) resolve(true);
  });
  scheduleAutosave();
}

// ---- Shared file autosave (desktop)
async function dbLinkSharedFile(handle){
  sharedHandle = handle;
  await writeSharedFile(); // snapshot initial
}
function scheduleAutosave(){
  if (!sharedHandle) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(()=>writeSharedFile().catch(console.warn), 300);
}
async function writeSharedFile(){
  if (!sharedHandle) return false;
  try{
    const data = await dbExportFull();
    const text = JSON.stringify(data, null, 2);
    const writable = await sharedHandle.createWritable();
    await writable.write(new Blob([text], {type:'application/json'}));
    await writable.close();
    return true;
  }catch(e){
    console.warn('Écriture fichier partagé échouée:', e.message);
    return false;
  }
}

// Expose (global)
window.dbInit = dbInit;
window.dbGet = dbGet;
window.dbPut = dbPut;
window.dbDelete = dbDelete;
window.dbList = dbList;
window.dbAdjustQty = dbAdjustQty;
window.dbAddMove = dbAddMove;
window.dbListMoves = dbListMoves;
window.dbCreateLoan = dbCreateLoan;
window.dbListLoans = dbListLoans;
window.dbListLoansByCode = dbListLoansByCode;
window.dbReturnLoan = dbReturnLoan;
window.dbGenerateCode = dbGenerateCode;
window.dbGetSettings = dbGetSettings;
window.dbSetSettings = dbSetSettings;
window.dbExport = dbExport;
window.dbExportFull = dbExportFull;
window.dbImportFull = dbImportFull;
window.dbLinkSharedFile = dbLinkSharedFile;
