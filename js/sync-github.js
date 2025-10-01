/* Gstock - sync-github.js v2.1.4 */
'use strict';
(function(){
  const KEY='gstock.githubSync';
  let cfg=null, timer=null;
  function save(){ localStorage.setItem(KEY, JSON.stringify(cfg||{})); }
  function loadSaved(){ try{ return JSON.parse(localStorage.getItem(KEY)||'{}'); }catch(_){ return {}; } }
  async function init({owner,repo,path,token}){ cfg={owner,repo,path,token}; save(); }
  async function pull(){
    if(!cfg) throw new Error('Non configuré');
    const url=`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`;
    const res=await fetch(url,{headers:{Authorization:`Bearer ${cfg.token}`,Accept:'application/vnd.github+json'}});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const json=await res.json(); const content=atob(json.content.replace(/\n/g,'')); const data=JSON.parse(content);
    await dbImportFull(data);
  }
  async function push(){
    if(!cfg) throw new Error('Non configuré');
    const url=`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`;
    const get=await fetch(url,{headers:{Authorization:`Bearer ${cfg.token}`,Accept:'application/vnd.github+json'}});
    let sha=null; if(get.ok){ const j=await get.json(); sha=j.sha; }
    const data=await dbExportFull(); const content=btoa(unescape(encodeURIComponent(JSON.stringify(data,null,2))));
    const body={message:`gstock sync ${new Date().toISOString()}`,content,sha};
    const res=await fetch(url,{method:'PUT',headers:{Authorization:`Bearer ${cfg.token}`,Accept:'application/vnd.github+json'},body:JSON.stringify(body)});
    if(!res.ok) throw new Error('HTTP '+res.status);
  }
  function startAuto(ms=4000){ if(timer)clearInterval(timer); timer=setInterval(async()=>{ try{ await push(); }catch(e){ console.warn('auto-push failed',e);} }, ms); }
  function stopAuto(){ if(timer)clearInterval(timer); timer=null; }
  window.githubSync={init,pull,push,startAuto,stopAuto,loadSaved};
})();
