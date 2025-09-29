/* Gstock - sw.js */
const APP_VERSION = (new URL(self.location)).searchParams.get('v') || '2.0.1';
const CACHE_PREFIX = 'gstock-cache-';
const STATIC_CACHE = `${CACHE_PREFIX}${APP_VERSION}`;

const DOC_EXT = ['.html','.js','/'];
const ASSET_EXT = ['.css','.png','.svg','.jpg','.jpeg','.webp','.woff2','.ico','.json'];

self.addEventListener('install', (event)=>{
  event.waitUntil((async()=>{
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll([
      './',
      './index.html',
      './manifest.json',
      './js/app.js?v='+APP_VERSION,
      './js/db.js?v='+APP_VERSION,
      './js/barcode.js?v='+APP_VERSION,
      './icons/icon-192.png',
      './icons/icon-512.png'
    ].map(u=>new Request(u, {cache:'reload'})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event)=>{
  event.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k.startsWith(CACHE_PREFIX) && k!==STATIC_CACHE) ? caches.delete(k) : null));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event)=>{
  const req = event.request;
  const url = new URL(req.url);

  // Bypass cross-origin except GET
  if (url.origin !== location.origin) return;

  // Strategy selection
  if (isDocOrJs(url.pathname)) {
    return event.respondWith(networkFirst(req));
  }
  if (isAsset(url.pathname)) {
    return event.respondWith(staleWhileRevalidate(req));
  }
  // default: passthrough
});

self.addEventListener('message', (event)=>{
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isDocOrJs(path){
  return DOC_EXT.some(ext => path.endsWith(ext)) || path === '/' || path.startsWith('/?');
}
function isAsset(path){
  return ASSET_EXT.some(ext => path.endsWith(ext));
}

async function networkFirst(req){
  const cache = await caches.open(STATIC_CACHE);
  try{
    const fresh = await fetch(req, {cache:'no-store'});
    cache.put(req, fresh.clone());
    return fresh;
  }catch(e){
    const cached = await cache.match(req);
    if (cached) return cached;
    throw e;
  }
}
async function staleWhileRevalidate(req){
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then(res=>{
    cache.put(req, res.clone());
    return res;
  }).catch(()=>cached);
  return cached || fetchPromise;
}
