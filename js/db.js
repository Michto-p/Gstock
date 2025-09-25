// js/db.js — IndexedDB v2 (items + moves)
const DB_NAME = 'stockdb';
const DB_VERSION = 2;
const STORE_ITEMS = 'items';
const STORE_MOVES = 'moves';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ITEMS)) {
        const store = db.createObjectStore(STORE_ITEMS, { keyPath: 'barcode' });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('tags', 'tags', { unique: false, multiEntry: true });
      }
      if (!db.objectStoreNames.contains(STORE_MOVES)) {
        const moves = db.createObjectStore(STORE_MOVES, { keyPath: 'id', autoIncrement: true });
        moves.createIndex('barcode', 'barcode', { unique: false });
        moves.createIndex('time', 'time', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ===== ITEMS
async function dbGet(barcode) {
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(STORE_ITEMS, 'readonly');
    const r = tx.objectStore(STORE_ITEMS).get(barcode);
    r.onsuccess = ()=>resolve(r.result || null);
    r.onerror = ()=>reject(r.error);
  });
}

async function dbPut(item) {
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(STORE_ITEMS, 'readwrite');
    tx.oncomplete = ()=>resolve(item);
    tx.onerror = ()=>reject(tx.error);
    tx.objectStore(STORE_ITEMS).put(item);
  });
}

async function dbDelete(barcode) {
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(STORE_ITEMS, 'readwrite');
    tx.oncomplete = ()=>resolve(true);
    tx.onerror = ()=>reject(tx.error);
    tx.objectStore(STORE_ITEMS).delete(barcode);
  });
}

async function dbList(query) {
  const q = (query||'').toLowerCase();
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(STORE_ITEMS, 'readonly');
    const store = tx.objectStore(STORE_ITEMS);
    const out = [];
    store.openCursor().onsuccess = (e)=>{
      const cur = e.target.result;
      if (cur) {
        const it = cur.value;
        if (!q ||
            (it.name && it.name.toLowerCase().includes(q)) ||
            (it.barcode && it.barcode.toLowerCase().includes(q)) ||
            (Array.isArray(it.tags) && it.tags.join(',').toLowerCase().includes(q))) {
          out.push(it);
        }
        cur.continue();
      } else resolve(out);
    };
    tx.onerror = ()=>reject(tx.error);
  });
}

async function dbAdjustQty(barcode, delta, meta){
  const m = meta || {};
  const item = await dbGet(barcode);
  if (!item) throw new Error('Article introuvable: ' + barcode);
  item.qty = Math.max(0, (item.qty || 0) + delta);
  item.updatedAt = Date.now();
  await dbPut(item);
  await dbAddMove({
    time: Date.now(),
    barcode, name: item.name || '',
    delta, qtyAfter: item.qty,
    mode: m.mode || (delta>=0?'in':'out'),
    source: m.source || 'scan'
  });
  return item;
}

async function dbEnsureDemo() {
  const existing = await dbList('');
  if (existing.length) return;
  const demo = [
    { barcode:'CFA-00001', name:'Domino 6mm²', qty:42, min:10, tags:['consommable'] },
    { barcode:'CFA-00002', name:'Disjoncteur 10A', qty:12, min:5, tags:['protection','TP'] },
    { barcode:'CFA-00003', name:'Goulotte 60x40', qty:25, min:5, tags:['atelier'] },
  ];
  for (var i=0;i<demo.length;i++){
    var d = demo[i];
    await dbPut({ ...d, createdAt:Date.now(), updatedAt:Date.now() });
  }
}

// ===== MOVES (journal)
async function dbAddMove(move){
  const db = await openDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE_MOVES,'readwrite');
    tx.oncomplete = ()=>resolve(true);
    tx.onerror = ()=>reject(tx.error);
    tx.objectStore(STORE_MOVES).add(move);
  });
}

async function dbListMoves(){
  const db = await openDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE_MOVES,'readonly');
    const out = [];
    tx.objectStore(STORE_MOVES).index('time').openCursor(null, 'prev').onsuccess = (e)=>{
      const cur = e.target.result;
      if (cur){ out.push(cur.value); cur.continue(); } else resolve(out);
    };
    tx.onerror = ()=>reject(tx.error);
  });
}

async function dbClearMoves(){
  const db = await openDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE_MOVES,'readwrite');
    tx.oncomplete = ()=>resolve(true);
    tx.onerror = ()=>reject(tx.error);
    tx.objectStore(STORE_MOVES).clear();
  });
}

// ===== EXPORT/IMPORT
async function exportItemsJson(){ const items = await dbList(''); return JSON.stringify({ items }, null, 2); }
async function exportMovesJson(){ const moves = await dbListMoves(); return JSON.stringify({ moves }, null, 2); }

async function exportItemsCsv(){
  const items = await dbList('');
  const header = ['barcode','name','qty','min','tags'];
  const rows = [header.join(',')];
  for (var i=0;i<items.length;i++){
    const it = items[i];
    rows.push([csv(it.barcode), csv(it.name), it.qty||0, it.min||0, csv((it.tags||[]).join('|'))].join(','));
  }
  return rows.join('\n');
}

async function exportMovesCsv(){
  const moves = await dbListMoves();
  const header = ['timeISO','barcode','name','delta','qtyAfter','mode','source'];
  const rows = [header.join(',')];
  for (var i=0;i<moves.length;i++){
    const m = moves[i];
    rows.push([new Date(m.time).toISOString(), csv(m.barcode), csv(m.name), m.delta, m.qtyAfter, m.mode, m.source].join(','));
  }
  return rows.join('\n');
}

function csv(v){ v = v==null?'':String(v); return (v.includes(',')||v.includes('"')||v.includes('\n')) ? '"'+v.replace(/"/g,'""')+'"' : v; }

async function importItemsJson(text){
  const data = JSON.parse(text);
  const items = data.items || [];
  for (var i=0;i<items.length;i++){
    const it = items[i];
    await dbPut({ ...it, updatedAt: Date.now(), createdAt: it.createdAt||Date.now() });
  }
}

async function importItemsCsv(text){
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift(); // ignore
  for (var i=0;i<lines.length;i++){
    const cols = parseCsv(lines[i]);
    const barcode = cols[0]||'', name = cols[1]||'', qty = cols[2]||'0', min = cols[3]||'0', tags = cols[4]||'';
    if (!barcode) continue;
    await dbPut({
      barcode, name: name||barcode,
      qty: parseInt(qty,10)||0, min: parseInt(min,10)||0,
      tags: tags ? String(tags).split('|').map(s=>s.trim()).filter(Boolean) : [],
      updatedAt: Date.now(), createdAt: Date.now()
    });
  }
}

async function importMovesCsv(text){
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift(); // ignore
  for (var i=0;i<lines.length;i++){
    const cols = parseCsv(lines[i]);
    const timeISO = cols[0]||'', barcode = cols[1]||'', name = cols[2]||'';
    const delta = cols[3]||'0', qtyAfter = cols[4]||'0', mode = cols[5]||'in', source = cols[6]||'import';
    if (!barcode) continue;
    await dbAddMove({
      time: timeISO ? Date.parse(timeISO) : Date.now(),
      barcode, name,
      delta: parseInt(delta,10)||0, qtyAfter: parseInt(qtyAfter,10)||0,
      mode, source
    });
  }
}

// Simple CSV parser
function parseCsv(line){
  const out = []; var cur = ''; var inQ = false;
  for (var i=0;i<line.length;i++){
    const c = line[i];
    if (inQ){
      if (c === '"'){ if (line[i+1] === '"'){ cur+='"'; i++; } else { inQ=false; } }
      else { cur+=c; }
    } else {
      if (c === ','){ out.push(cur); cur=''; }
      else if (c === '"'){ inQ = true; }
      else { cur+=c; }
    }
  }
  out.push(cur); return out;
}
