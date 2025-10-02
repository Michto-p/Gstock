/* Gstock - sw.js v2.4.0 */
const CACHE='gstock-2.4.0';
const APP_SHELL=[
  './',
  'index.html',
  'js/app.js?v=2.4.2',
  'js/barcode.js?v=2.1.7',
  'js/code39.js?v=2.1.7',
  'js/db.js?v=2.1.7',
  'js/sync-github.js?v=2.1.7',
  'manifest.json',
  'data/demo.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install',e=>{
  e.waitUntil((async()=>{ const c=await caches.open(CACHE); await c.addAll(APP_SHELL); self.skipWaiting(); })());
});
self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{ const keys=await caches.keys(); await Promise.all(keys.map(k=>k!==CACHE&&caches.delete(k))); await self.clients.claim(); })());
});
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  const isApp = url.pathname.endsWith('/') || /index\.html$/.test(url.pathname) || /(?:app|db|barcode|code39|sync-github)\.js/.test(url.pathname) || /manifest\.json$/.test(url.pathname);
  if(isApp){
    e.respondWith((async()=>{
      try{
        const net=await fetch(e.request,{cache:'no-store'});
        const c=await caches.open(CACHE); c.put(e.request, net.clone()); return net;
      }catch(_){
        const hit=await caches.match(e.request); if(hit) return hit;
        return caches.match('index.html');
      }
    })());
  }else{
    e.respondWith((async()=>{
      const hit=await caches.match(e.request); if(hit) return hit;
      const net=await fetch(e.request); const c=await caches.open(CACHE); c.put(e.request,net.clone()); return net;
    })());
  }
});
