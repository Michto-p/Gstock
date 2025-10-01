/* Gstock - db.js v2.1.7 */
'use strict';

const DB_NAME='gstock', DB_VERSION=5;
let idb=null, sharedFileHandle=null, autosaveTimer=null;

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=(ev)=>{
      const db=ev.target.result;
      if(!db.objectStoreNames.contains('items')){
        const s=db.createObjectStore('items',{keyPath:'code'}); s.createIndex('by_name','name',{unique:false});
      }
      if(!db.objectStoreNames.contains('moves')){
        db.createObjectStore('moves',{keyPath:'ts'});
      }
      if(!db.objectStoreNames.contains('loans')){
        const s=db.createObjectStore('loans',{keyPath:'id'}); s.createIndex('by_code','code',{unique:false}); s.createIndex('by_active','returnedAt',{unique:false});
      }
      if(!db.objectStoreNames.contains('settings')){
        db.createObjectStore('settings',{keyPath:'k'});
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
function tx(name,mode='readonly'){
  if(!idb) throw new Error('DB not opened');
  if(!idb.objectStoreNames.contains(name)){
    throw new Error(`Missing object store "${name}". Reload to upgrade DB.`);
  }
  return idb.transaction(name,mode).objectStore(name);
}

async function dbInit(){ idb=await openDB(); await ensureDefaultSettings(); }
async function ensureDefaultSettings(){ const s=await dbGetSettings(); if(!s){ await dbSetSettings({buffer:0,defaultTags:[]}); } }

async function dbGetSettings(){ return new Promise((res,rej)=>{ const r=tx('settings').get('main'); r.onsuccess=()=>res(r.result?.v||null); r.onerror=()=>rej(r.error); }); }
async function dbSetSettings(v){ return new Promise((res,rej)=>{ const r=tx('settings','readwrite').put({k:'main',v}); r.onsuccess=()=>res(true); r.onerror=()=>rej(r.error); }); }

async function dbList(){ return new Promise((res,rej)=>{ const s=tx('items'); const out=[]; s.openCursor().onsuccess=e=>{ const c=e.target.result; if(c){ out.push(c.value); c.continue(); }else{ out.sort((a,b)=>a.name.localeCompare(b.name,'fr')); res(out);} }; s.openCursor().onerror=()=>rej(); }); }
async function dbGet(code){ return new Promise((res,rej)=>{ const r=tx('items').get(code); r.onsuccess=()=>res(r.result||null); r.onerror=()=>rej(r.error); }); }
async function dbPut(item){ return new Promise((res,rej)=>{ const r=tx('items','readwrite').put(item); r.onsuccess=()=>{ scheduleAutosave(); res(true); }; r.onerror=()=>rej(r.error); }); }
async function dbDelete(code){ return new Promise((res,rej)=>{ const r=tx('items','readwrite').delete(code); r.onsuccess=()=>{ scheduleAutosave(); res(true); }; r.onerror=()=>rej(r.error); }); }
async function dbAdjustQty(code,delta){ return new Promise((res,rej)=>{ const s=tx('items','readwrite'); const r=s.get(code); r.onsuccess=()=>{ const it=r.result; if(!it){res(false);return;} it.qty=(it.qty|0)+delta; if(it.qty<0)it.qty=0; it.updated=Date.now(); s.put(it).onsuccess=()=>{ scheduleAutosave(); res(true); }; }; r.onerror=()=>rej(r.error); }); }
async function dbGenerateCode(){ let code=''; let ok=false; while(!ok){ code='ITM-'+Math.floor(100000+Math.random()*899999); ok=!(await dbGet(code)); } return code; }

async function dbAddMove(m){
  return new Promise((resolve,reject)=>{
    const store=tx('moves','readwrite');
    const tryAdd=(rec,attempt=0)=>{
      const req=store.add(rec);
      req.onsuccess=()=>{ scheduleAutosave(); resolve(true); };
      req.onerror=(ev)=>{
        const err=ev.target.error;
        if(err&&err.name==='ConstraintError'&&attempt<8){ rec.ts=(rec.ts|0)+(1+Math.floor(Math.random()*5)); tryAdd(rec,attempt+1); }
        else reject(err||new Error('dbAddMove failed'));
      };
    };
    tryAdd({...m});
  });
}
async function dbListMoves({from=0,to=Infinity,code=null,limit=1000}={}){
  return new Promise((res,rej)=>{ const s=tx('moves'); const out=[];
    s.openCursor().onsuccess=e=>{ const c=e.target.result; if(c){ const v=c.value; if(v.ts>=from && v.ts<=to && (!code || v.code===code)) out.push(v); c.continue(); } else { out.sort((a,b)=>b.ts-a.ts); res(out.slice(0,limit)); } };
    s.openCursor().onerror=()=>rej();
  });
}

function genLoanId(){ return 'L'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
async function dbCreateLoan({code,name,person,due,note=''}){ return new Promise((res,rej)=>{ const loan={id:genLoanId(),code,name,person,due,createdAt:Date.now(),returnedAt:null,note};
  const r=tx('loans','readwrite').add(loan); r.onsuccess=()=>{ scheduleAutosave(); res(loan); }; r.onerror=()=>rej(r.error); }); }
async function dbListLoans(activeOnly=false){ return new Promise((res,rej)=>{ const out=[]; tx('loans').openCursor().onsuccess=e=>{ const c=e.target.result; if(c){ const v=c.value; if(!activeOnly||!v.returnedAt) out.push(v); c.continue(); } else { out.sort((a,b)=>b.createdAt-a.createdAt); res(out);} }; }); }
async function dbListLoansByCode(code){ return new Promise((res,rej)=>{ const out=[]; tx('loans').index('by_code').openCursor(IDBKeyRange.only(code)).onsuccess=e=>{ const c=e.target.result; if(c){ out.push(c.value); c.continue(); } else { out.sort((a,b)=>b.createdAt-a.createdAt); res(out);} }; }); }
async function dbReturnLoan(id){ return new Promise((res,rej)=>{ const s=tx('loans','readwrite'); const r=s.get(id); r.onsuccess=()=>{ const v=r.result; if(!v){res(false);return;} v.returnedAt=Date.now(); s.put(v).onsuccess=()=>{ scheduleAutosave(); res(true); }; }; r.onerror=()=>rej(r.error); }); }

async function dbExport(kind='csv'){ const moves=await dbListMoves({from:0,to:Infinity,limit:100000});
  if(kind==='json') return JSON.stringify(moves);
  const header='ts,type,code,name,qty,note\n';
  const rows=moves.map(m=>[m.ts,m.type,m.code,(m.name||''),(m.qty||0),(m.note||'')].map(v=>String(v).replace(/"/g,'""')).map(v=>`"${v}"`).join(',')).join('\n');
  return header+rows+'\n';
}
async function dbExportFull(){ const [items,moves,loans,settings]=await Promise.all([dbList(),dbListMoves({from:0,to:Infinity,limit:100000}),dbListLoans(false),dbGetSettings()]); return {version:'2.1.7',ts:Date.now(),items,moves,loans,settings}; }
async function dbImportFull(dump){ if(!dump) return;
  const {items=[],moves=[],loans=[],settings=null}=dump;
  await new Promise((res,rej)=>{ const t=idb.transaction(['items','moves','loans','settings'],'readwrite'); const si=t.objectStore('items'), sm=t.objectStore('moves'), sl=t.objectStore('loans'), ss=t.objectStore('settings');
    si.clear(); sm.clear(); sl.clear();
    items.forEach(x=>si.put(x)); moves.forEach(x=>sm.put(x)); loans.forEach(x=>sl.put(x));
    if(settings) ss.put({k:'main',v:settings});
    t.oncomplete=()=>{ scheduleAutosave(); res(true); }; t.onerror=()=>rej(t.error);
  });
}

async function dbLinkSharedFile(handle){ sharedFileHandle=handle; scheduleAutosave(); }
function scheduleAutosave(){ clearTimeout(autosaveTimer); autosaveTimer=setTimeout(async()=>{ if(!sharedFileHandle)return; try{
    const data=await dbExportFull(); const txt=JSON.stringify(data,null,2); const ws=await sharedFileHandle.createWritable(); await ws.write(txt); await ws.close();
  }catch(e){ console.warn('Autosave partagé échoué:',e); }
}, 600); }

/* Exports */
window.dbInit=dbInit; window.dbGetSettings=dbGetSettings; window.dbSetSettings=dbSetSettings;
window.dbList=dbList; window.dbGet=dbGet; window.dbPut=dbPut; window.dbDelete=dbDelete; window.dbAdjustQty=dbAdjustQty; window.dbGenerateCode=dbGenerateCode;
window.dbAddMove=dbAddMove; window.dbListMoves=dbListMoves; window.dbExport=dbExport; window.dbExportFull=dbExportFull; window.dbImportFull=dbImportFull;
window.dbCreateLoan=dbCreateLoan; window.dbListLoans=dbListLoans; window.dbListLoansByCode=dbListLoansByCode; window.dbReturnLoan=dbReturnLoan; window.dbLinkSharedFile=dbLinkSharedFile;
