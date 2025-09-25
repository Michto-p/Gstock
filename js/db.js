// js/db.js — v1.5.0 : items + moves + loans (emprunts)
(function(){
  const DB_NAME = 'stock-cfa';
  const DB_VER  = 5; // ↑ incrémente si tu modifies le schéma

  function openDB(){
    return new Promise((resolve,reject)=>{
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e)=>{
        const db = req.result;
        // items
        if (!db.objectStoreNames.contains('items')){
          const s = db.createObjectStore('items', { keyPath: 'barcode' });
          s.createIndex('by_name','name',{ unique:false });
        }
        // moves (journal)
        if (!db.objectStoreNames.contains('moves')){
          const s = db.createObjectStore('moves', { keyPath: 'id', autoIncrement: true });
          s.createIndex('by_time','time',{ unique:false });
          s.createIndex('by_barcode','barcode',{ unique:false });
        }
        // loans (emprunts)
        if (!db.objectStoreNames.contains('loans')){
          const s = db.createObjectStore('loans', { keyPath: 'id', autoIncrement: true });
          s.createIndex('by_barcode','barcode',{ unique:false });
          s.createIndex('by_returned','returned',{ unique:false });
          s.createIndex('by_start','start',{ unique:false });
          s.createIndex('by_due','due',{ unique:false });
        }
      };
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> reject(req.error);
    });
  }

  function tx(storeNames, mode, fn){
    return openDB().then(db=>{
      return new Promise((resolve,reject)=>{
        const t = db.transaction(storeNames, mode);
        t.oncomplete = ()=> resolve(result);
        t.onerror = ()=> reject(t.error);
        let result;
        fn(t, (v)=>{ result=v; });
      });
    });
  }

  // ===== Items
  async function dbPut(item){
    item.updatedAt = Date.now();
    return tx(['items'],'readwrite',(t,done)=>{
      t.objectStore('items').put(item);
      done(true);
    });
  }
  async function dbGet(code){
    return tx(['items'],'readonly',(t,done)=>{
      const r = t.objectStore('items').get(code);
      r.onsuccess = ()=> done(r.result || null);
    });
  }
  async function dbDelete(code){
    return tx(['items'],'readwrite',(t,done)=>{
      t.objectStore('items').delete(code);
      done(true);
    });
  }
  async function dbList(query){
    query = (query||'').toLowerCase();
    return tx(['items'],'readonly',(t,done)=>{
      const s = t.objectStore('items').openCursor();
      const out = [];
      s.onsuccess = ()=>{
        const cur = s.result;
        if (!cur){ done(out); return; }
        const it = cur.value;
        const str = ((it.name||'')+' '+(it.barcode||'')+' '+(it.tags||[]).join(' ')+' '+(it.location||'')).toLowerCase();
        if (!query || str.includes(query)) out.push(it);
        cur.continue();
      };
    });
  }

  // Ajuste quantité + log move
  async function dbAdjustQty(code, delta, info){
    const item = await dbGet(code);
    if (!item) throw new Error('Article introuvable: ' + code);
    let q = parseInt(item.qty||0,10) + parseInt(delta||0,10);
    if (q < 0) q = 0; // clamp
    const updated = { ...item, qty: q, updatedAt: Date.now() };
    await dbPut(updated);
    await dbAddMove({
      time: Date.now(),
      barcode: item.barcode,
      name: item.name,
      delta: parseInt(delta||0,10),
      qtyAfter: q,
      mode: (info && info.mode) || 'adj',
      source: (info && info.source) || 'ui'
    });
    return updated;
  }

  // ===== Moves (journal)
  async function dbAddMove(m){
    return tx(['moves'],'readwrite',(t,done)=>{
      t.objectStore('moves').add(m);
      done(true);
    });
  }
  async function dbListMoves(){
    return tx(['moves'],'readonly',(t,done)=>{
      const s = t.objectStore('moves').index('by_time').openCursor(null,'prev');
      const out = [];
      s.onsuccess = ()=>{
        const cur = s.result;
        if (!cur){ done(out); return; }
        out.push(cur.value); cur.continue();
      };
    });
  }
  async function dbClearMoves(){
    return tx(['moves'],'readwrite',(t,done)=>{
      t.objectStore('moves').clear(); done(true);
    });
  }

  // ===== Loans (emprunts)
  async function dbCreateLoan({ barcode, name, borrower, qty, start, due, note }){
    // qty: nombre de pièces empruntées (par défaut 1)
    return tx(['loans'],'readwrite',(t,done)=>{
      t.objectStore('loans').add({
        barcode, name,
        borrower: borrower||'',
        qty: parseInt(qty||1,10),
        start: start||Date.now(),
        due: due||null,
        note: note||'',
        returned: false,
        returnDate: null
      });
      done(true);
    });
  }
  async function dbReturnLoan(barcode){
    // Retourne le prêt actif le plus récent pour ce code
    return tx(['loans'],'readwrite',(t,done)=>{
      const s = t.objectStore('loans').index('by_barcode').openCursor(IDBKeyRange.only(barcode), 'prev');
      s.onsuccess = ()=>{
        let cur = s.result, found=null;
        while(cur){
          const v = cur.value;
          if (!v.returned){ found = { cursor: cur, value: v }; break; }
          cur.continue();
          return; // important: on attend le prochain onsuccess
        }
        if (!found){ done(false); return; }
        found.value.returned = true;
        found.value.returnDate = Date.now();
        found.cursor.update(found.value);
        done(true);
      };
    });
  }
  async function dbListLoans(activeOnly){
    return tx(['loans'],'readonly',(t,done)=>{
      const s = t.objectStore('loans').index('by_start').openCursor(null,'prev');
      const out=[];
      s.onsuccess = ()=>{
        const cur = s.result;
        if (!cur){ done(out); return; }
        const v = cur.value;
        if (!activeOnly || (activeOnly && !v.returned)) out.push(v);
        cur.continue();
      };
    });
  }

  // ===== Imports/Exports utilitaires (identiques)
  async function exportItemsCsv(){
    const items = await dbList('');
    const headers = ['barcode','name','qty','min','tags','createdAt','updatedAt'];
    const rows = [headers.join(';')];
    for (const it of items){
      rows.push([it.barcode, it.name, it.qty||0, it.min||0, (it.tags||[]).join(','), it.createdAt||'', it.updatedAt||''].map(v=>String(v).replace(/;/g,',')).join(';'));
    }
    return rows.join('\n');
  }
  async function exportItemsJson(){
    const items = await dbList('');
    return JSON.stringify(items, null, 2);
  }
  async function importItemsCsv(text){
    const lines = text.split(/\r?\n/).filter(Boolean); if (!lines.length) return;
    const hdr = lines.shift().split(/;|,/).map(h=>h.trim().toLowerCase());
    const idx = (k)=> hdr.indexOf(k);
    for (const line of lines){
      const cols = line.split(/;|,/);
      const item = {
        barcode: cols[idx('barcode')] || cols[0],
        name: cols[idx('name')] || '',
        qty: parseInt(cols[idx('qty')]||'0',10),
        min: parseInt(cols[idx('min')]||'0',10),
        tags: (cols[idx('tags')]||'').split(',').map(s=>s.trim()).filter(Boolean),
        createdAt: Date.now(), updatedAt: Date.now()
      };
      if (item.barcode) await dbPut(item);
    }
  }
  async function importItemsJson(text){
    const arr = JSON.parse(text||'[]');
    for (const it of arr){ if (it && it.barcode) await dbPut(it); }
  }

  async function exportMovesCsv(){
    const moves = await dbListMoves();
    const headers = ['time','barcode','name','delta','qtyAfter','mode','source'];
    const rows = [headers.join(';')];
    for (const m of moves){
      rows.push([m.time, m.barcode, m.name||'', m.delta, m.qtyAfter, m.mode||'', m.source||''].map(v=>String(v).replace(/;/g,',')).join(';'));
    }
    return rows.join('\n');
  }
  async function exportMovesJson(){
    const moves = await dbListMoves();
    return JSON.stringify(moves, null, 2);
  }
  async function importMovesCsv(text){
    const lines = text.split(/\r?\n/).filter(Boolean); if (!lines.length) return;
    const hdr = lines.shift().split(/;|,/).map(h=>h.trim().toLowerCase());
    const idx = (k)=> hdr.indexOf(k);
    for (const line of lines){
      const cols = line.split(/;|,/);
      await dbAddMove({
        time: parseInt(cols[idx('time')]||Date.now(),10),
        barcode: cols[idx('barcode')]||'',
        name: cols[idx('name')]||'',
        delta: parseInt(cols[idx('delta')]||'0',10),
        qtyAfter: parseInt(cols[idx('qtyafter')]||'0',10),
        mode: cols[idx('mode')]||'',
        source: cols[idx('source')]||''
      });
    }
  }

  // Démo
  async function dbEnsureDemo(){
    const have = await dbList('');
    if (have.length) return;
    const demo = [
      { barcode:'VM-0001', name:'Voltmètre numérique', qty:2, min:1, tags:['atelier','mesure'] },
      { barcode:'MULTI-0002', name:'Multimètre', qty:3, min:1, tags:['atelier','mesure'] },
      { barcode:'PINCE-AMP', name:'Pince ampèremétrique', qty:1, min:0, tags:['mesure'] },
      { barcode:'PERCEUSE-01', name:'Perceuse', qty:2, min:0, tags:['atelier','outillage'] }
    ];
    for (const it of demo){
      await dbPut({ ...it, createdAt: Date.now(), updatedAt: Date.now() });
    }
  }

  // Expose
  window.dbPut = dbPut;
  window.dbGet = dbGet;
  window.dbDelete = dbDelete;
  window.dbList = dbList;
  window.dbAdjustQty = dbAdjustQty;

  window.dbAddMove = dbAddMove;
  window.dbListMoves = dbListMoves;
  window.dbClearMoves = dbClearMoves;

  window.dbCreateLoan = dbCreateLoan;
  window.dbReturnLoan = dbReturnLoan;
  window.dbListLoans = dbListLoans;

  window.exportItemsCsv = exportItemsCsv;
  window.exportItemsJson = exportItemsJson;
  window.importItemsCsv = importItemsCsv;
  window.importItemsJson = importItemsJson;

  window.exportMovesCsv = exportMovesCsv;
  window.exportMovesJson = exportMovesJson;
  window.importMovesCsv = importMovesCsv;

  window.dbEnsureDemo = dbEnsureDemo;
})();
