/* Gstock SW v2.8.1 – cache léger + network-first pour index/app */
const VERSION = 'v2.8.1';
const CORE = [
  './',
  './index.html',
  './css/styles.css?v=2.8.1',
  './js/app.js?v=2.8.1',
  './js/db.js?v=2.8.1',
  './js/code39.js?v=2.8.1',
  './manifest.json'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(VERSION).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', (e)=>{
  const url = new URL(e.request.url);
  // network-first pour index et app.js
  const isCritical = url.pathname.endsWith('/index.html') || url.pathname.endsWith('/js/app.js');
  if (isCritical) {
    e.respondWith(
      fetch(e.request).then(r=>{
        const copy = r.clone(); caches.open(VERSION).then(c=>c.put(e.request, copy)); return r;
      }).catch(()=>caches.match(e.request))
    );
    return;
  }
  // cache-first pour le reste
  e.respondWith(
    caches.match(e.request).then(cached=>{
      return cached || fetch(e.request).then(r=>{
        const copy = r.clone();
        caches.open(VERSION).then(c=>c.put(e.request, copy));
        return r;
      });
    }).catch(()=>caches.match('./index.html'))
  );
});
