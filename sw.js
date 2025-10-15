/* Gstock SW v2.9.0 – stratégie mixte + purge */
const VERSION = 'v2.9.0';
const CORE = [
  './',
  './index.html',
  './css/styles.css?v=2.9.0',
  './js/app.js?v=2.9.0',
  './js/db.js?v=2.9.0',
  './js/code39.js?v=2.9.2',
  './manifest.json?v=2.9.0'
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
  const isCritical = url.pathname.endsWith('/index.html') || url.pathname.endsWith('/js/app.js') || url.pathname.endsWith('/js/db.js');
  if (isCritical) {
    e.respondWith(
      fetch(e.request).then(r=>{
        const copy = r.clone(); caches.open(VERSION).then(c=>c.put(e.request, copy)); return r;
      }).catch(()=>caches.match(e.request))
    );
    return;
  }
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
