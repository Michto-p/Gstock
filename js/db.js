/* Gstock - db.js v2.8.2 (IndexedDB + export/import + fichier partagé optionnel) */
(function () {
  'use strict';

  var DB_NAME = 'gstock';
  var DB_VER = 5;
  var STORES = { items: 'items', moves: 'moves', loans: 'loans', meta: 'meta' };
  var db = null;
  var sharedFileHandle = null; // File System Access API (optionnel)

  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VER);

      req.onupgradeneeded = function () {
        var d = req.result;

        if (!d.objectStoreNames.contains(STORES.items)) {
          var s1 = d.createObjectStore(STORES.items, { keyPath: 'code' });
          s1.createIndex('by_name', 'name', { unique: false });
          s1.createIndex('by_type', 'type', { unique: false });
        }
        if (!d.objectStoreNames.contains(STORES.moves)) {
          var s2 = d.createObjectStore(STORES.moves, { keyPath: 'id', autoIncrement: true });
          s2.createIndex('by_ts', 'ts', { unique: false });
          s2.createIndex('by_code', 'code', { unique: false });
        }
        if (!d.objectStoreNames.contains(STORES.loans)) {
          var s3 = d.createObjectStore(STORES.loans, { keyPath: 'id', autoIncrement: true });
          s3.createIndex('by_code', 'code', { unique: false });
          s3.createIndex('by_active', ['code', 'returnedAt'], { unique: false });
        }
        if (!d.objectStoreNames.contains(STORES.meta)) {
          d.createObjectStore(STORES.meta, { keyPath: 'key' });
        }
      };

      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function tx(storeName, mode) {
    return new Promise(function (resolve, reject) {
      (db ? Promise.resolve(db) : openDB()).then(function (conn) {
        db = conn;
        try {
          var store = db.transaction(storeName, mode).objectStore(storeName);
          resolve(store);
        } catch (e) { reject(e); }
      }, reject);
    });
  }

  /* ---------- Defaults / Init ---------- */

  function ensureDefaultSettings() {
    return dbGetSettings().then(function (s) {
      if (s) return;
      return dbSaveSettings({
        buffer: 2,
        defaultTagsStock: ['élec', 'plomberie', 'consommable'],
        defaultTagsAtelier: ['outillage', 'mesure', 'sécurité'],
        defaultLocationsStock: ['Atelier · Etagère 1', 'Atelier · Etagère 2'],
        defaultLocationsAtelier: ['Chariot 1', 'Armoire atelier']
      });
    });
  }

  function dbInit() {
    return openDB().then(function (conn) {
      db = conn;
      return ensureDefaultSettings();
    }).then(function () {
      return dbList();
    }).then(function (all) {
      if (all.length > 0) return;
      var now = Date.now();
      var seed = [
        { code: 'disj20xpLeg', ref: 'disj20xpLeg', name: 'Disjoncteur 20 A XP Legrand', qty: 8, threshold: 3, tags: ['élec'], location: 'Atelier · Etagère 1', links: [], type: 'stock', updated: now },
        { code: 'multimetFlu', ref: 'Fluke-117', name: 'Multimètre Fluke 117', qty: 2, threshold: 1, tags: ['mesure'], location: 'Armoire atelier', links: ['https://www.fluke.com'], type: 'atelier', updated: now }
      ];
      return Promise.all(seed.map(dbPut)).then(function () {
        return Promise.all([
          dbAddMove({ ts: now, type: 'ENTRY', code: 'disj20xpLeg', name: 'Disjoncteur 20 A XP Legrand', qty: 8, note: 'seed' }),
          dbAddMove({ ts: now, type: 'ENTRY', code: 'multimetFlu', name: 'Multimètre Fluke 117', qty: 2, note: 'seed' })
        ]);
      });
    });
  }

  /* ---------- Items ---------- */

  function dbList() {
    return tx(STORES.items, 'readonly').then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function dbGet(code) {
    if (!code) return Promise.resolve(null);
    return tx(STORES.items, 'readonly').then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.get(code);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function autosaveShared() {
    if (!sharedFileHandle || !sharedFileHandle.createWritable) return Promise.resolve();
    return dbExportFull().then(function (data) {
      var text = JSON.stringify(data, null, 2);
      return sharedFileHandle.createWritable().then(function (w) {
        return w.write(text).then(function () { return w.close(); });
      });
    });
  }

  function dbPut(item) {
    return tx(STORES.items, 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.put(item);
        req.onsuccess = function () {
          resolve(req.result);
          autosaveShared()["catch"](function () { /* ignore */ });
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function dbDelete(code) {
    return tx(STORES.items, 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.delete(code);
        req.onsuccess = function () {
          resolve();
          autosaveShared()["catch"](function () { /* ignore */ });
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function dbAdjustQty(code, delta) {
    return dbGet(code).then(function (item) {
      if (!item) return;
      item.qty = Math.max(0, (item.qty | 0) + delta);
      item.updated = Date.now();
      return dbPut(item);
    });
  }

  /* ---------- Moves ---------- */

  function dbAddMove(m) {
    return tx(STORES.moves, 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.add(m);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function dbListMoves(opts) {
    opts = opts || {};
    var from = (typeof opts.from === 'number') ? opts.from : 0;
    var to = (typeof opts.to === 'number') ? opts.to : Infinity;
    var code = (typeof opts.code === 'string') ? opts.code : null;
    var limit = (typeof opts.limit === 'number') ? opts.limit : 1000;

    return tx(STORES.moves, 'readonly').then(function (store) {
      return new Promise(function (resolve, reject) {
        var out = [];
        var idx = store.index('by_ts');
        var range = IDBKeyRange.bound(from, to);
        var req = idx.openCursor(range, 'prev');
        req.onsuccess = function () {
          var cur = req.result;
          if (!cur || out.length >= limit) return resolve(out);
          var v = cur.value;
          if (!code || v.code === code) out.push(v);
          cur.continue();
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function dbExport(fmt) {
    return dbListMoves({ from: 0, to: Infinity, limit: 100000 }).then(function (moves) {
      if (fmt === 'json') return JSON.stringify(moves);
      var header = 'ts,type,code,name,qty,note\n';
      var rows = moves.map(function (m) {
        return [m.ts, m.type, m.code, (m.name || ''), (m.qty || 0), (m.note || '')]
          .map(function (v) { return String(v).replace(/"/g, '""'); })
          .map(function (v) { return '"' + v + '"'; })
          .join(',');
      }).join('\n');
      return header + rows + '\n';
    });
  }

  function dbExportFull() {
    return Promise.all([
      dbList(),
      dbListMoves({ from: 0, to: Infinity, limit: 100000 }),
      dbListLoans(true),
      dbGetSettings()
    ]).then(function (arr) {
      var items = arr[0], moves = arr[1], loans = arr[2], settings = arr[3];
      return { version: DB_VER, exportedAt: Date.now(), items: items, moves: moves, loans: loans, settings: settings };
    });
  }

  function dbImportFull(payload) {
    if (!payload || typeof payload !== 'object') return Promise.reject(new Error('payload invalide'));

    var sItems, sMoves, sLoans, sMeta;
    return tx(STORES.items, 'readwrite').then(function (st) {
      sItems = st; return tx(STORES.moves, 'readwrite');
    }).then(function (st) {
      sMoves = st; return tx(STORES.loans, 'readwrite');
    }).then(function (st) {
      sLoans = st; return tx(STORES.meta, 'readwrite');
    }).then(function (st) {
      sMeta = st;

      function clear(store) {
        return new Promise(function (res, rej) {
          var r = store.clear(); r.onsuccess = res; r.onerror = function () { rej(r.error); };
        });
      }

      return Promise.all([clear(sItems), clear(sMoves), clear(sLoans)]).then(function () {
        var p = [];

        (payload.items || []).forEach(function (it) {
          p.push(new Promise(function (res, rej) {
            var r = sItems.add(it); r.onsuccess = res; r.onerror = function () { rej(r.error); };
          }));
        });
        (payload.moves || []).forEach(function (m) {
          p.push(new Promise(function (res, rej) {
            var r = sMoves.add(m); r.onsuccess = res; r.onerror = function () { rej(r.error); };
          }));
        });
        (payload.loans || []).forEach(function (l) {
          p.push(new Promise(function (res, rej) {
            var r = sLoans.add(l); r.onsuccess = res; r.onerror = function () { rej(r.error); };
          }));
        });

        if (payload.settings) {
          p.push(new Promise(function (res, rej) {
            var r = sMeta.put({ key: 'settings', value: payload.settings });
            r.onsuccess = res; r.onerror = function () { rej(r.error); };
          }));
        }
        return Promise.all(p);
      });
    });
  }

  /* ---------- Loans ---------- */

  function dbCreateLoan(obj) {
    return tx(STORES.loans, 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        var v = {
          code: obj.code, name: obj.name, person: obj.person, due: obj.due,
          note: obj.note ? obj.note : '', createdAt: Date.now(), returnedAt: null
        };
        var req = store.add(v);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function dbReturnLoan(id) {
    return tx(STORES.loans, 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        var getReq = store.get(id);
        getReq.onsuccess = function () {
          var v = getReq.result;
          if (!v) { resolve(); return; }
          v.returnedAt = Date.now();
          var putReq = store.put(v);
          putReq.onsuccess = function () { resolve(); };
          putReq.onerror = function () { reject(putReq.error); };
        };
        getReq.onerror = function () { reject(getReq.error); };
      });
    });
  }

  function dbListLoans(includeReturned) {
    return tx(STORES.loans, 'readonly').then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.getAll();
        req.onsuccess = function () {
          var all = req.result || [];
          resolve(includeReturned ? all : all.filter(function (l) { return !l.returnedAt; }));
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function dbListLoansByCode(code) {
    return tx(STORES.loans, 'readonly').then(function (store) {
      return new Promise(function (resolve, reject) {
        var idx = store.index('by_code');
        var range = IDBKeyRange.only(code);
        var out = [];
        var req = idx.openCursor(range, 'prev');
        req.onsuccess = function () {
          var cur = req.result;
          if (!cur) return resolve(out);
          out.push(cur.value);
          cur.continue();
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  /* ---------- Settings / Meta ---------- */

  function dbGetSettings() {
    return tx(STORES.meta, 'readonly').then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.get('settings');
        req.onsuccess = function () {
          resolve(req.result ? req.result.value : null);
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function dbSaveSettings(obj) {
    return tx(STORES.meta, 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.put({ key: 'settings', value: obj });
        req.onsuccess = function () {
          resolve();
          autosaveShared()["catch"](function () { /* ignore */ });
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function dbLinkSharedFile(handle) {
    sharedFileHandle = handle;
    return autosaveShared();
  }

  /* ---------- Expose globals ---------- */
  window.dbInit = dbInit;
  window.dbList = dbList;
  window.dbGet = dbGet;
  window.dbPut = dbPut;
  window.dbDelete = dbDelete;
  window.dbAdjustQty = dbAdjustQty;

  window.dbAddMove = dbAddMove;
  window.dbListMoves = dbListMoves;
  window.dbExport = dbExport;
  window.dbExportFull = dbExportFull;
  window.dbImportFull = dbImportFull;

  window.dbCreateLoan = dbCreateLoan;
  window.dbReturnLoan = dbReturnLoan;
  window.dbListLoans = dbListLoans;
  window.dbListLoansByCode = dbListLoansByCode;

  window.dbGetSettings = dbGetSettings;
  window.dbSaveSettings = dbSaveSettings;

  window.dbLinkSharedFile = dbLinkSharedFile;
})();
