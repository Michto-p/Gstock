/* Gstock - db.js */
'use strict';

let db, sharedHandle=null, sharedAutosaveTimer=null;
const DB_NAME = 'gstock-db';
const DB_VER  = 1;

async function dbInit(){
  db = await openDB(DB_NAME, DB_VER, upgrade);
  const set = await dbGetSettings();
  if (!set.defaultTags) await dbSetSettings({defaultTags:[], buffer:0});
  startSharedAutosave();
}

function upgrade(dbx, oldVersion, newVersion){
  if (!dbx.objectStoreNames.contains('items')){
    const s = dbx.createObjectStore('items', {keyPath: 'id'});
    s.createIndex('code','code',{unique:true});
    s.createIndex('name','name');
  }
  if (!dbx.objectStoreNames.contains('moves')){
    const s = dbx.createObjectStore('moves', {keyPath: 'id', autoIncrement: true});
    s.createIndex('ts','ts');
    s.createIndex('code','code');
  }
  if (!dbx.objectStoreNames.contains('loans')){
    const s = dbx.createObjectStore('loans', {keyPath: 'id', autoIncrement: true});
    s.createIndex('code','code');
    s.createIndex('returnedAt','returnedAt');
  }
  if (!dbx.objectStoreNames.contains('settings')){
    dbx.createObjectStore('settings', {keyPath:'id'});
  }
}

// --- IndexedDB Promise helpers
function openDB(name, version, onup){
  return new Promise((res,rej)=>{
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = ()=> onup(req.result, req.oldVersion, req.newVersion);
    req.onsuccess = ()=> res(req.result);
    req.onerror = ()=> rej(req.error);
  });
}
function tx(store, mode='readonly'){
  return db.transaction(store, mode).objectStore(store);
}
function idbReq(r){ return new Promise((res,rej)=>{ r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }

// --- Items
async function dbPut(item){
  item.id = item.id || item.code;
  item.updated = Date.now();
  await idbReq(tx('items','readwrite').put(item));
  scheduleSharedAutosave();
}
async function dbGet(code){ return await idbReq(tx('items').get(code)); }
async function dbDelete(code){ await idbReq(tx('items','readwrite').delete(code)); scheduleSharedAutosave(); }
async function dbList(){
  const r = await idbReq(tx('items').getAll());
  return r.sort((a,b)=> (a.name||'').localeCompare(b.name||''));
}
async function dbAdjustQty(code, delta){
  const it = await dbGet(code); if (!it) return;
  it.qty = Math.max(0, (it.qty|0) + (delta|0));
  it.updated = Date.now();
  await dbPut(it);
}

async function dbGenerateCode(){
  // Simple code unique basé sur timestamp
  let code = 'A' + Date.now().toString(36).toUpperCase();
  while (await dbGet(code)) code = 'A' + Date.now().toString(36).toUpperCase();
  return code;
}

// --- Moves (journal)
async function dbAddMove(m){
  await idbReq(tx('moves','readwrite').add(m));
  scheduleSharedAutosave();
}
async function dbListMoves({code=null, from=0, to=Infinity, limit=1000}={}){
  const all = await idbReq(tx('moves').getAll());
  return all.filter(m=>(m.ts>=from && m.ts<=to && (!code || m.code===code)))
            .sort((a,b)=>b.ts-a.ts).slice(0,limit);
}
async function dbExport(kind='csv'){
  const list = await dbListMoves({limit:100000});
  if (kind==='json') return JSON.stringify(list);
  // CSV ; FR
  const head = 'ts;type;code;name;qty;note\n';
  const rows = list.map(m=>[m.ts,m.type,m.code,(m.name||''),m.qty,(m.note||'')].map(csvEscape).join(';')).join('\n');
  return head+rows;
}
function csvEscape(v){
  const s = String(v??''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

// --- Loans
async function dbCreateLoan({code,name,person,due,note=''}) {
  const rec = {code,name,person,due, note, createdAt:Date.now(), returnedAt:null};
  await idbReq(tx('loans','readwrite').add(rec));
  scheduleSharedAutosave();
  return rec;
}
async function dbReturnLoan(id){
  const store = tx('loans','readwrite');
  const rec = await idbReq(store.get(+id));
  if (!rec) return;
  rec.returnedAt = Date.now();
  await idbReq(store.put(rec));
  scheduleSharedAutosave();
}
async function dbListLoans(activeOnly=false){
  const all = await idbReq(tx('loans').getAll());
  return all.filter(l=> activeOnly ? !l.returnedAt : true)
            .sort((a,b)=> (a.returnedAt?1:0) - (b.returnedAt?1:0) || String(a.due).localeCompare(String(b.due)));
}
async function dbListLoansByCode(code){
  const all = await idbReq(tx('loans').getAll());
  return all.filter(l=> l.code===code).sort((a,b)=> (b.createdAt-a.createdAt));
}

// --- Settings & shared file
async function dbGetSettings(){
  const v = await idbReq(tx('settings').get('main'));
  return v || {id:'main', buffer:0, defaultTags:[]};
}
async function dbSetSettings(patch){
  const cur = await dbGetSettings();
  const val = Object.assign({}, cur, patch);
  await idbReq(tx('settings','readwrite').put(val));
  scheduleSharedAutosave();
}

async function dbExportFull(){
  const [items, moves, loans, settings] = await Promise.all([
    idbReq(tx('items').getAll()),
    idbReq(tx('moves').getAll()),
    idbReq(tx('loans').getAll()),
    dbGetSettings()
  ]);
  return {version:1, exportedAt:Date.now(), items, moves, loans, settings};
}
async function dbImportFull(data){
  if (!data || typeof data!=='object') throw new Error('invalid data');
  const t1 = db.transaction(['items','moves','loans','settings'],'readwrite');
  await Promise.all([
    clearStore(t1.objectStore('items')).then(()=> putAll(t1.objectStore('items'), data.items||[])),
    clearStore(t1.objectStore('moves')).then(()=> putAll(t1.objectStore('moves'), data.moves||[])),
    clearStore(t1.objectStore('loans')).then(()=> putAll(t1.objectStore('loans'), data.loans||[])),
    (async()=>{ await idbReq(t1.objectStore('settings').put(data.settings||{id:'main'})); })()
  ]);
  return true;
}
function clearStore(store){ return idbReq(store.clear()); }
async function putAll(store, arr){ for (const x of arr) await idbReq(store.put(x)); }

// --- File System Access (partagé)
async function dbLinkSharedFile(handle){ sharedHandle = handle; await writeShared(); }
function startSharedAutosave(){ /* no-op, timer à la demande */ }
function scheduleSharedAutosave(){
  if (!sharedHandle) return;
  clearTimeout(sharedAutosaveTimer);
  sharedAutosaveTimer = setTimeout(writeShared, 1500);
}
async function writeShared(){
  if (!sharedHandle) return;
  try{
    const blob = await dbExportFull();
    const text = JSON.stringify(blob);
    const w = await sharedHandle.createWritable();
    await w.write(text);
    await w.close();
  }catch(e){
    console.warn('Erreur écriture fichier partagé', e);
    alert('Écriture du fichier partagé échouée (lecture seule ?).');
  }
}
