/* Gstock - db.js v2.9.3 (IDB + fallback mémoire) */
(function(){'use strict';
const DB_NAME='gstock2'; const DB_VER=2;
let idb=null; let mem={items:[],moves:[],loans:[],settings:{buffer:0,defaultTagsStock:[],defaultTagsAtelier:[],defaultLocationsStock:[],defaultLocationsAtelier:[]}};
let useMem=false;

/* open IDB */
function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded=(ev)=>{
      const db=req.result;
      if(!db.objectStoreNames.contains('items')){
        const s=db.createObjectStore('items',{keyPath:'id'});
        s.createIndex('code','code',{unique:true});
        s.createIndex('name','name',{unique:false});
      }
      if(!db.objectStoreNames.contains('moves')){
        const s=db.createObjectStore('moves',{keyPath:'id',autoIncrement:true});
        s.createIndex('code','code',{unique:false});
        s.createIndex('ts','ts',{unique:false});
      }
      if(!db.objectStoreNames.contains('loans')){
        const s=db.createObjectStore('loans',{keyPath:'id',autoIncrement:true});
        s.createIndex('code','code',{unique:false});
        s.createIndex('returnedAt','returnedAt',{unique:false});
      }
      if(!db.objectStoreNames.contains('settings')){
        db.createObjectStore('settings',{keyPath:'id'});
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('open error'));
  });
}
function tx(store,mode){ return idb.transaction(store,mode).objectStore(store); }

/* Init + defaults */
async function ensureDefaults(){
  try{
    const s=await dbGetSettings();
    if(!s){ await dbSaveSettings(mem.settings); }
  }catch(e){
    // ignore
  }
}

async function dbInit(){
  try{
    if(!('indexedDB' in window)) throw new Error('IDB unsupported');
    idb=await openDB();
    await ensureDefaults();
  }catch(e){
    console.warn('IDB disabled, fallback memory:', e);
    useMem=true;
  }
}

/* Items */
async function dbGet(id){
  if(useMem){ return mem.items.find(i=>i.id===id)||null; }
  return new Promise((resolve,reject)=>{
    const r=tx('items','readonly').get(id);
    r.onsuccess=()=>resolve(r.result||null);
    r.onerror=()=>reject(r.error);
  });
}
async function dbPut(item){
  if(useMem){
    const i=mem.items.findIndex(x=>x.id===item.id); if(i>=0) mem.items[i]=item; else mem.items.push(item);
    return;
  }
  return new Promise((resolve,reject)=>{
    const r=tx('items','readwrite').put(item);
    r.onsuccess=()=>resolve(); r.onerror=()=>reject(r.error);
  });
}
async function dbDelete(id){
  if(useMem){ mem.items=mem.items.filter(i=>i.id!==id); return; }
  return new Promise((resolve,reject)=>{
    const r=tx('items','readwrite').delete(id);
    r.onsuccess=()=>resolve(); r.onerror=()=>reject(r.error);
  });
}
async function dbList(){
  if(useMem){ return mem.items.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name))); }
  return new Promise((resolve,reject)=>{
    const store=tx('items','readonly'); const out=[];
    const req=store.openCursor(); req.onsuccess=()=>{ const c=req.result; if(c){ out.push(c.value); c.continue(); } else resolve(out.sort((a,b)=>String(a.name).localeCompare(String(b.name)))); };
    req.onerror=()=>reject(req.error);
  });
}
async function dbAdjustQty(code, delta){
  const it=await dbGet(code); if(!it) return;
  it.qty=Math.max(0,(it.qty|0)+delta); it.updated=Date.now();
  await dbPut(it);
}

/* Moves */
async function dbAddMove(m){ // {ts,type,code,name,qty,note}
  const move=Object.assign({},m);
  if(useMem){ move.id=(mem.moves.at(-1)?.id||0)+1; mem.moves.push(move); return move.id; }
  return new Promise((resolve,reject)=>{
    const r=tx('moves','readwrite').add(move); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
  });
}
async function dbListMoves({from=0,to=Infinity,code=null,limit=1000}={}){
  let all;
  if(useMem){ all=mem.moves.slice(); }
  else{
    all=await new Promise((resolve,reject)=>{
      const s=tx('moves','readonly'), out=[]; const req=s.openCursor(null,'prev');
      req.onsuccess=()=>{ const c=req.result; if(c){ out.push(c.value); c.continue(); } else resolve(out); };
      req.onerror=()=>reject(req.error);
    });
  }
  return all.filter(m=>m.ts>=from && m.ts<=to && (!code || m.code===code)).sort((a,b)=>b.ts-a.ts).slice(0,limit);
}
async function dbExport(fmt){
  const rows=await dbListMoves({from:0,to:Infinity,limit:100000});
  if(fmt==='json') return JSON.stringify(rows);
  // CSV
  const head='ts,type,code,name,qty,note';
  const body=rows.map(r=>[r.ts,r.type,r.code,(r.name||'').replace(/"/g,'""'),r.qty,(r.note||'').replace(/"/g,'""')].map(v=>/[,"]/.test(String(v))?('"'+v+'"'):v).join(',')).join('\n');
  return head+'\n'+body;
}
async function dbExportFull(){
  const items=await dbList(); const moves=await dbListMoves({from:0,to:Infinity,limit:100000}); const loans=await dbListLoans(true); const settings=await dbGetSettings();
  return { version:'2.9.3', exportedAt:Date.now(), items, moves, loans, settings };
}
async function dbImportFull(data){
  if(!data || typeof data!=='object') throw new Error('invalid data');
  // reset stores (soft)
  if(useMem){ mem.items=[]; mem.moves=[]; mem.loans=[]; mem.settings=data.settings||mem.settings; }
  else{
    await new Promise((resolve,reject)=>{ const r=tx('items','readwrite').clear(); r.onsuccess=()=>resolve(); r.onerror=()=>reject(r.error); });
    await new Promise((resolve,reject)=>{ const r=tx('moves','readwrite').clear(); r.onsuccess=()=>resolve(); r.onerror=()=>reject(r.error); });
    await new Promise((resolve,reject)=>{ const r=tx('loans','readwrite').clear(); r.onsuccess=()=>resolve(); r.onerror=()=>reject(r.error); });
    await new Promise((resolve,reject)=>{ const r=tx('settings','readwrite').put(Object.assign({id:'singleton'}, (data.settings||mem.settings))); r.onsuccess=()=>resolve(); r.onerror=()=>reject(r.error); });
  }
  // put items
  for(const it of (data.items||[])){ await dbPut(it); }
  // moves
  if(useMem){ mem.moves=(data.moves||[]).slice(); }
  else{
    for(const m of (data.moves||[])){
      await new Promise((resolve,reject)=>{ const r=tx('moves','readwrite').add(m); r.onsuccess=()=>resolve(); r.onerror=()=>reject(r.error); });
    }
  }
  // loans
  if(useMem){ mem.loans=(data.loans||[]).slice(); }
  else{
    for(const l of (data.loans||[])){
      await new Promise((resolve,reject)=>{ const r=tx('loans','readwrite').add(l); r.onsuccess=()=>resolve(); r.onerror=()=>reject(r.error); });
    }
  }
}

/* Settings */
async function dbGetSettings(){
  if(useMem){ return Object.assign({id:'singleton'}, mem.settings); }
  return new Promise((resolve,reject)=>{
    const r=tx('settings','readonly').get('singleton');
    r.onsuccess=()=>resolve(r.result||null);
    r.onerror=()=>reject(r.error);
  });
}
async function dbSaveSettings(s){
  const data=Object.assign({id:'singleton'}, s||{});
  if(useMem){ mem.settings=Object.assign({},data); return; }
  return new Promise((resolve,reject)=>{
    const r=tx('settings','readwrite').put(data);
    r.onsuccess=()=>resolve(); r.onerror=()=>reject(r.error);
  });
}

/* Loans */
async function dbCreateLoan({code,name,person,due,note}){
  const l={code,name,person,due,note,createdAt:Date.now(),returnedAt:null};
  if(useMem){ l.id=(mem.loans.at(-1)?.id||0)+1; mem.loans.push(l); return l.id; }
  return new Promise((resolve,reject)=>{ const r=tx('loans','readwrite').add(l); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
}
async function dbReturnLoan(id){
  if(useMem){ const i=mem.loans.findIndex(x=>String(x.id)===String(id)); if(i>=0){ mem.loans[i]=Object.assign({},mem.loans[i],{returnedAt:Date.now()}); } return; }
  return new Promise((resolve,reject)=>{
    const s=tx('loans','readwrite'); const g=s.get(Number(id));
    g.onsuccess=()=>{ const v=g.result; if(!v){ resolve(); return; } v.returnedAt=Date.now(); const p=s.put(v); p.onsuccess=()=>resolve(); p.onerror=()=>reject(p.error); };
    g.onerror=()=>reject(g.error);
  });
}
async function dbListLoans(includeClosed=false){
  let all;
  if(useMem){ all=mem.loans.slice(); }
  else{
    all=await new Promise((resolve,reject)=>{
      const s=tx('loans','readonly'), out=[]; const req=s.openCursor();
      req.onsuccess=()=>{ const c=req.result; if(c){ out.push(c.value); c.continue(); } else resolve(out); };
      req.onerror=()=>reject(req.error);
    });
  }
  return all.filter(l=> includeClosed || !l.returnedAt ).sort((a,b)=> (a.returnedAt?1:0) - (b.returnedAt?1:0) || String(a.person).localeCompare(String(b.person)));
}
async function dbListLoansByCode(code){
  const all=await dbListLoans(true);
  return all.filter(l=>l.code===code);
}

/* Shared file (stub) */
let sharedHandle=null;
async function dbLinkSharedFile(handle){ sharedHandle=handle; }

/* NUKE */
async function dbNuke(deleteIDB=true){
  try{
    if(deleteIDB && 'indexedDB' in window){
      await new Promise((resolve,reject)=>{
        const req=indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess=()=>resolve(); req.onerror=()=>reject(req.error); req.onblocked=()=>resolve();
      });
    }
  }catch(e){ /* ignore */ }
  mem={items:[],moves:[],loans:[],settings:{buffer:0,defaultTagsStock:[],defaultTagsAtelier:[],defaultLocationsStock:[],defaultLocationsAtelier:[]}};
}

/* expose */
window.dbInit=dbInit;
window.dbGet=dbGet; window.dbPut=dbPut; window.dbDelete=dbDelete; window.dbList=dbList; window.dbAdjustQty=dbAdjustQty;
window.dbAddMove=dbAddMove; window.dbListMoves=dbListMoves; window.dbExport=dbExport; window.dbExportFull=dbExportFull; window.dbImportFull=dbImportFull;
window.dbGetSettings=dbGetSettings; window.dbSaveSettings=dbSaveSettings;
window.dbCreateLoan=dbCreateLoan; window.dbReturnLoan=dbReturnLoan; window.dbListLoans=dbListLoans; window.dbListLoansByCode=dbListLoansByCode;
window.dbLinkSharedFile=dbLinkSharedFile; window.dbNuke=dbNuke;

})();
