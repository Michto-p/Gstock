/* Gstock - sync-github.js (tests uniquement) */
(() => {
  'use strict';

  function b64encode(str){
    // Base64 UTF-8 safe
    return btoa(unescape(encodeURIComponent(str)));
  }
  function b64decode(b64){
    return decodeURIComponent(escape(atob(b64)));
  }

  const githubSync = (() => {
    let cfg = null;     // {owner, repo, path, token}
    let lastSha = null; // sha du fichier
    let autoTimer = null;

    function init(conf){
      cfg = Object.assign({}, conf);
      lastSha = null;
      // on persiste (sans le token si tu préfères)
      localStorage.setItem('gstock.gh.owner', cfg.owner||'');
      localStorage.setItem('gstock.gh.repo', cfg.repo||'');
      localStorage.setItem('gstock.gh.path', cfg.path||'');
      localStorage.setItem('gstock.gh.token', cfg.token||'');
    }

    function loadSaved(){
      return {
        owner: localStorage.getItem('gstock.gh.owner')||'',
        repo:  localStorage.getItem('gstock.gh.repo')||'',
        path:  localStorage.getItem('gstock.gh.path')||'gstock-shared.json',
        token: localStorage.getItem('gstock.gh.token')||''
      };
    }

    async function api(method, url, body){
      if (!cfg || !cfg.token) throw new Error('Config/token GitHub manquants');
      const res = await fetch(url, {
        method,
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': 'token ' + cfg.token,
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`GitHub ${res.status}: ${t}`);
      }
      return await res.json();
    }

    function contentsURL(){
      const encPath = encodeURIComponent(cfg.path.replace(/^\/+/,''));
      return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encPath}`;
    }

    async function pull(){
      if (!cfg) throw new Error('Sync non initialisée');
      const data = await api('GET', contentsURL());
      lastSha = data.sha || null;
      const jsonText = b64decode(data.content || '');
      const obj = JSON.parse(jsonText);
      await dbImportFull(obj);
      return true;
    }

    async function push(){
      if (!cfg) throw new Error('Sync non initialisée');
      // Récupère la dernière sha (évite les conflits)
      try{
        const meta = await api('GET', contentsURL());
        lastSha = meta.sha || null;
      }catch(e){
        // si 404, c'est un create (lastSha nul)
        lastSha = null;
      }

      const snapshot = await dbExportFull();
      const text = JSON.stringify(snapshot, null, 2);
      const body = {
        message: 'Gstock sync',
        content: b64encode(text),
        sha: lastSha || undefined
      };
      const res = await api('PUT', contentsURL(), body);
      lastSha = (res.content && res.content.sha) ? res.content.sha : null;
      return true;
    }

    function startAuto(intervalMs=4000){
      stopAuto();
      autoTimer = setInterval(async ()=>{
        try{
          await pull();
          // Option: on pourrait notifier l’UI
          // window.dispatchEvent(new CustomEvent('gstock:gh-pulled'));
        }catch(e){
          console.warn('Auto-pull GitHub:', e.message);
        }
      }, intervalMs);
    }

    function stopAuto(){
      if (autoTimer) clearInterval(autoTimer);
      autoTimer = null;
    }

    return { init, loadSaved, pull, push, startAuto, stopAuto };
  })();

  // Expose
  window.githubSync = githubSync;

})();
