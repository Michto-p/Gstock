/* Gstock - db.js v2.8.1 (IndexedDB + export/import + fichier partagé optionnel) */
(function(){'use strict';
const DB_NAME='gstock';
const DB_VER=5;
const STORES={ items:'items', moves:'moves', loans:'loans', meta:'meta' };
let db=null;
let sharedFileHandle=null; // File System Access API (optionnel)

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded=e=>{
      const d=req.result;
      if(!d.objectStoreNames.contains(STORES.items)){
        const s=d.createObjectStore(STORES.items,{keyPath:'code'}); s.createIndex('by_name','name',{unique:false}); s.createIndex('by_type','type',{unique:false});
      }
      if(!d.objectStoreNames.contains(STORES.moves)){
        const s=d.createObjectStore(STORES.moves,{keyPath:'id', autoIncrement:true}); s.createIndex('by_ts','ts',{unique:false}); s.createIndex('by_code','code',{unique:false});
      }
      if(!d.objectStoreNames.contains(STORES.loans)){
        const s=d.createObjectStore(STORES.loans,{keyPath:'id', autoIncrement:true}); s.createIndex('by_code','code',{unique:false}); s.createIndex('by_active',['code','returnedAt'],{unique:false});
      }
      if(!d.objectStoreNames.contains(STORES.meta)){
        d.createObjectStore(STORES.meta,{keyPath:'key'});
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function tx(store, mode){
  if(!db) db=await openDB();
  return db.transaction(store, mode).objectStore(store);
}

/* init + defaults */
async function ensureDefaultSettings(){
  const s=await dbGetSettings();
  if(!s){
    await dbSaveSettings({
      buffer:2,
      defaultTagsStock:['élec','plomberie','consommable'],
      defaultTagsAtelier:['outillage','mesure','sécurité'],
      defaultLocationsStock:['Atelier · Etagère 1','Atelier · Etagère 2'],
      defaultLocationsAtelier:['Chariot 1','Armoire atelier']
    });
  }
}
async function dbInit(){
  if(!db) db=await openDB();
  await ensureDefaultSettings();
  // seed minimal si vide
  const all=await dbList();
  if(all.length===0){
    const seed=[
      {code:'disj20xpLeg', ref:'disj20xpLeg', name:'Disjoncteur 20 A XP Legrand', qty:8, threshold:3, tags:['élec'], location:'Atelier · Etagère 1', links:[], type:'stock', updated:Date.now()},
      {code:'multimetFlu', ref:'Fluke-117', name:'Multimètre Fluke 117', qty:2, threshold:1, tags:['mesure'], location:'Armoire atelier', links:['https://www.fluke.com'], type:'atelier', updated:Date.now()}
    ];
    for(const it of seed){ await dbPut(it); }
    await dbAddMove({ts:Date.now(),type:'ENTRY',code:'disj20xpLeg',name:'Disjoncteur 20 A XP Legrand',qty:8,note:'seed'});
    await dbAddMove({ts:Date.now(),type:'ENTRY',code:'multimetFlu',name:'Multimètre Fluke 117',qty:2,note:'seed'});
  }
}

/* items */
async function dbList(){
  const store=await tx(STORES.items,'readonly');
  return new Promise((resolve,reject)=>{
    const req=store.getAll(); req.onsuccess=()=>resolve(req.result||[]); req.onerror=()=>reject(req.error);
  });
}
async function dbGet(code){
  if(!code) return null;
  const store=await tx(STORES.items,'readonly');
  return new Promise((resolve,reject)=>{
    const req=store.get(code); req.onsuccess=()=>resolve(req.result||null); req.onerror=()=>reject(req.error);
  });
}
async function dbPut(item){
  const store=await tx(STORES.items,'readwrite');
  return new Promise((resolve,reject)=>{
    const req=store.put(item); req.onsuccess=async()=>{ resolve(req.result); try{ await autosaveShared(); }catch(_){ } }; req.onerror=()=>reject(req.error);
  });
}
async function dbDelete(code){
  const store=await tx(STORES.items,'readwrite');
  return new Promise((resolve,reject)=>{
    const req=store.delete(code); req.onsuccess=async()=>{ resolve(); try{ await autosaveShared(); }catch(_){ } }; req.onerror=()=>reject(req.error);
  });
}
async function dbAdjustQty(code, delta){
  const item=await dbGet(code); if(!item) return;
  item.qty=Math.max(0,(item.qty|0)+delta); item.updated=Date.now();
  await dbPut(item);
}

/* moves */
async function dbAddMove(m){
  const store=await tx(STORES.moves,'readwrite');
  return new Promise((resolve,reject)=>{
    const req=store.add(m); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
async function dbListMoves({from=0,to=Infinity,code=null,limit=1000}={}){
  const store=await tx(STORES.moves,'readonly');
  return new Promise((resolve,reject)=>{
    const out=[]; const idx=store.index('by_ts'); const range=IDBKeyRange.bound(from,to);
    const req=idx.openCursor(range,'prev');
    req.onsuccess=()=>{ const cur=req.result; if(!cur||out.length>=limit) return resolve(out); const v=cur.value; if(!code||v.code===code) out.push(v); cur.continue(); };
    req.onerror=()=>reject(req.error);
  });
}
async function dbExport(fmt){
  const moves=await dbListMoves({from=0,to:Infinity,limit:100000});
  if(fmt==='json') return JSON.stringify(moves);
  // CSV
  const header='ts,type,code,name,qty,note\n';
  const rows=moves.map(m=>[m.ts,m.type,m.code,(m.name||''),(m.qty||0),(m.note||'')].map(v=>String(v).replace(/"/g,'""')).map(v=>`"${v}"`).join(',')).join('\n');
  return header+rows+'\n';
}
async function dbExportFull(){
  const [items, moves, loans, settings]=await Promise.all([dbList(), dbListMoves({from=0,to:Infinity,limit:100000}), dbListLoans(true), dbGetSettings()]);
  return {version:DB_VER, exportedAt:Date.now(), items, moves, loans, settings};
}
async function dbImportFull(payload){
  if(!payload||typeof payload!=='object') throw new Error('payload invalide');
  // clear & load
  const sItems=await tx(STORES.items,'readwrite'); const sMoves=await tx(STORES.moves,'readwrite'); const sLoans=await tx(STORES.loans,'readwrite'); const sMeta=await tx(STORES.meta,'readwrite');
  await Promise.all([ new Promise((res,rej)=>{ const r=sItems.clear(); r.onsuccess=res; r.onerror=()=>rej(r.error); }),
                      new Promise((res,rej)=>{ const r=sMoves.clear(); r.onsuccess=res; r.onerror=()=>rej(r.error); }),
                      new Promise((res,rej)=>{ const r=sLoans.clear(); r.onsuccess=res; r.onerror=()=>rej(r.error); }) ]);
  for(const it of (payload.items||[])){ await new Promise((res,rej)=>{ const r=sItems.add(it); r.onsuccess=res; r.onerror=()=>rej(r.error); }); }
  for(const m of (payload.moves||[])){ await new Promise((res,rej)=>{ const r=sMoves.add(m); r.onsuccess=res; r.onerror=()=>rej(r.error); }); }
  for(const l of (payload.loans||[])){ await new Promise((res,rej)=>{ const r=sLoans.add(l); r.onsuccess=res; r.onerror=()=>rej(r.error); }); }
  if(payload.settings){ await new Promise((res,rej)=>{ const r=sMeta.put({key:'settings', value:payload.settings}); r.onsuccess=res; r.onerror=()=>rej(r.error); }); }
}

/* loans */
async function dbCreateLoan({code,name,person,due,note}){
  const store=await tx(STORES.loans,'readwrite');
  return new Promise((resolve,reject)=>{
    const req=store.add({code,name,person,due,note:note||'',createdAt:Date.now(),returnedAt:null}); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
async function dbReturnLoan(id){
  const store=await tx(STORES.loans,'readwrite');
  return new Promise((resolve,reject)=>{
    const getReq=store.get(id);
    getReq.onsuccess=()=>{
      const v=getReq.result; if(!v) return resolve();
      v.returnedAt=Date.now();
      const putReq=store.put(v); putReq.onsuccess=()=>resolve(); putReq.onerror=()=>reject(putReq.error);
    };
    getReq.onerror=()=>reject(getReq.error);
  });
}
async function dbListLoans(includeReturned){
  const store=await tx(STORES.loans,'readonly');
  return new Promise((resolve,reject)=>{
    const req=store.getAll(); req.onsuccess=()=>{ const all=req.result||[]; resolve(includeReturned?all:all.filter(l=>!l.returnedAt)); }; req.onerror=()=>reject(req.error);
  });
}
async function dbListLoansByCode(code){
  const store=await tx(STORES.loans,'readonly');
  return new Promise((resolve,reject)=>{
    const idx=store.index('by_code'); const range=IDBKeyRange.only(code); const out=[];
    const req=idx.openCursor(range,'prev');
    req.onsuccess=()=>{ const cur=req.result; if(!cur) return resolve(out); out.push(cur.value); cur.continue(); };
    req.onerror=()=>reject(req.error);
  });
}

/* settings/meta */
async function dbGetSettings(){
  const store=await tx(STORES.meta,'readonly');
  return new Promise((resolve,reject)=>{
    const req=store.get('settings'); req.onsuccess=()=>resolve(req.result?req.result.value:null); req.onerror=()=>reject(req.error);
  });
}
async function dbSaveSettings(obj){
  const store=await tx(STORES.meta,'readwrite');
  return new Promise((resolve,reject)=>{
    const req=store.put({key:'settings', value:obj}); req.onsuccess=async()=>{ resolve(); try{ await autosaveShared(); }catch(_){ } }; req.onerror=()=>reject(req.error);
  });
}

/* fichier partagé (optionnel) */
async function dbLinkSharedFile(handle){ sharedFileHandle=handle; await autosaveShared(); }
async function autosaveShared(){
  if(!sharedFileHandle?.createWritable) return;
  const data=await dbExportFull(); const text=JSON.stringify(data,null,2);
  const w=await sharedFileHandle.createWritable(); await w.write(text); await w.close();
}

/* expose */
window.dbInit=dbInit;
window.dbList=dbList;
window.dbGet=dbGet;
window.dbPut=dbPut;
window.dbDelete=dbDelete;
window.dbAdjustQty=dbAdjustQty;
window.dbAddMove=dbAddMove;
window.dbListMoves=dbListMoves;
window.dbExport=dbExport;
window.dbExportFull=dbExportFull;
window.dbImportFull=dbImportFull;

window.dbCreateLoan=dbCreateLoan;
window.dbReturnLoan=dbReturnLoan;
window.dbListLoans=dbListLoans;
window.dbListLoansByCode=dbListLoansByCode;

window.dbGetSettings=dbGetSettings;
window.dbSaveSettings=dbSaveSettings;

window.dbLinkSharedFile=dbLinkSharedFile;
})();
