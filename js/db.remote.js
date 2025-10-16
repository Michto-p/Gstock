/* Gstock - db.remote.js v1.0.0
 * Si window.GSTOCK_BACKEND est défini, on redéfinit toutes les fonctions db* pour utiliser l'API serveur (PHP+SQLite).
 */
(function(){
'use strict';
if(!window.GSTOCK_BACKEND) return; // pas de backend → ne fait rien

const API = String(window.GSTOCK_BACKEND).replace(/\/+$/,''); // sans trailing slash
const KEY = window.GSTOCK_API_KEY || '';

async function api(path, method='GET', body){
  const url = API + (path.startsWith('/')?path:('/'+path));
  const opts = { method, headers: { 'X-API-Key': KEY } };
  if(body!==undefined){
    opts.headers['Content-Type']='application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url + (url.indexOf('api.php')!==-1 ? '' : ''), opts);
  if(!r.ok) throw new Error('HTTP '+r.status);
  const j = await r.json();
  if(!j.ok) throw new Error(j.error||'api-error');
  return j.data;
}

async function dbInit(){ 
  try{ await api('/health','GET'); console.info('[db.remote] connected'); }
  catch(e){ console.error('[db.remote] backend unreachable',e); throw e; }
}
async function dbNuke(){ console.warn('[db.remote] nuke not available on server'); }

async function dbGetSettings(){ return await api('/settings','GET'); }
async function dbSaveSettings(s){ await api('/settings','PUT', s); }

async function dbList(){ return await api('/items','GET'); }
async function dbGet(code){ return await api('/items/'+encodeURIComponent(code),'GET'); }
async function dbPut(it){
  // create or update
  const exists = it && it.code ? await (async()=>{ try{ return await dbGet(it.code); }catch(_){ return null; } })() : null;
  if(exists){ await api('/items/'+encodeURIComponent(it.code),'PUT', it); }
  else { await api('/items','POST', it); }
}
async function dbDelete(code){ await api('/items/'+encodeURIComponent(code),'DELETE'); }
async function dbAdjustQty(code,delta){ return await api('/items/'+encodeURIComponent(code)+'/adjust','POST',{delta}); }

async function dbListMoves(f){ 
  const p = new URLSearchParams();
  if(f && Number.isFinite(f.from)) p.set('from', String(f.from));
  if(f && Number.isFinite(f.to))   p.set('to', String(f.to));
  if(f && Number.isFinite(f.limit))p.set('limit', String(f.limit));
  const q = p.toString()?('?'+p.toString()):'';
  return await api('/moves'+q,'GET');
}
async function dbAddMove(m){ await api('/moves','POST', m); }

async function dbListLoans(includeClosed){ 
  const q = includeClosed ? '?includeClosed=1' : '';
  return await api('/loans'+q,'GET'); 
}
async function dbAddLoan(l){ await api('/loans','POST', l); }
async function dbCloseLoan(code){ await api('/loans/'+encodeURIComponent(code)+'/close','POST',{}); }

async function dbExportFull(){ return await api('/export','GET'); }
async function dbImportFull(data){ await api('/import','POST', data); }

// Expose (override)
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

})();
