/* Gstock SW v2.1.0 – network-first core, SWR assets */
const VERSION = (self.location.search.match(/v=([0-9.]+)/)||[])[1] || '2.1.0';
const CACHE_CORE = `gstock-core-${VERSION}`;
const CACHE_ASSETS = `gstock-assets-${VERSION}`;

const CORE = [
  './',
  'index.html',
  `js/app.js?v=${VERSION}`,
  `js/db.js?v=${VERSION}`,
  `js/barcode.js?v=${VERSION}`
];

self.addEventListener('install', (event)=>{
  event.waitUntil(caches.open(CACHE_CORE).then(c=>c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event)=>{
  event.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => ![CACHE_CORE, CACHE_ASSETS].includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event)=>{
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event)=>{
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  // Network-first pour l'app et JS cœur
  const isCore = CORE.some(path => url.href.endsWith(path) || url.pathname.endsWith(path.split('?')[0]));
  if (isCore || url.pathname === '/' || url.pathname.endsWith('/index.html')) {
    event.respondWith((async()=>{
      try{
        const fresh = await fetch(event.request, {cache:'no-store'});
        const cache = await caches.open(CACHE_CORE);
        cache.put(event.request, fresh.clone());
        return fresh;
      }catch(_){
        const cache = await caches.open(CACHE_CORE);
        const cached = await cache.match(event.request);
        return cached || new Response('Offline', {status:503});
      }
    })());
    return;
  }

  // SWR pour le reste (icônes, data, etc.)
  event.respondWith((async()=>{
    const cache = await caches.open(CACHE_ASSETS);
    const cached = await cache.match(event.request);
    const fetchPromise = fetch(event.request).then(resp=>{
      cache.put(event.request, resp.clone());
      return resp;
    }).catch(()=>cached);
    return cached || fetchPromise;
  })());
});
