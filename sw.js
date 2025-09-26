// sw.js — update-friendly, no IndexedDB touches
const CACHE_VERSION = 'v1.6.0';
const RUNTIME = `stock-cfa-${CACHE_VERSION}`;

self.addEventListener('install', (event) => {
  // On n'installe rien de bloquant : laisse le SW se mettre en place vite
  self.skipWaiting(); // On active au plus tôt, mais on ne prend pas le contrôle tant que la page ne le demande pas
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Nettoie les vieux caches
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k.startsWith('stock-cfa-') && k !== RUNTIME) ? caches.delete(k) : null));
    await self.clients.claim();
  })());
});

// Petites helpers
const isHTML = (req) => req.destination === 'document' || req.headers.get('accept')?.includes('text/html');
const isJS = (req) => req.destination === 'script' || /\.js(\?|$)/.test(new URL(req.url).pathname);
const isManifest = (req) => /manifest\.json$/.test(new URL(req.url).pathname);
const isStatic = (req) => req.destination === 'style' || req.destination === 'image' || /\.(css|png|jpg|jpeg|svg|webp|ico|woff2?)$/.test(new URL(req.url).pathname);

// Stratégies
async function networkFirst(event) {
  try {
    const fresh = await fetch(event.request);
    const cache = await caches.open(RUNTIME);
    cache.put(event.request, fresh.clone());
    return fresh;
  } catch {
    const cache = await caches.open(RUNTIME);
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    // offline fallback minimal
    return new Response('<h1>Hors-ligne</h1>', { headers: { 'Content-Type': 'text/html;charset=utf-8' }});
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(event.request, { ignoreSearch: false });
  const fetchPromise = fetch(event.request).then((resp) => {
    if (resp && resp.status === 200) cache.put(event.request, resp.clone());
    return resp;
  }).catch(() => null);
  return cached || fetchPromise || fetch(event.request);
}

async function cacheFirst(event) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(event.request, { ignoreSearch: true });
  if (cached) return cached;
  const resp = await fetch(event.request);
  if (resp && resp.status === 200) cache.put(event.request, resp.clone());
  return resp;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // On ne gère que GET
  if (req.method !== 'GET') return;

  if (isHTML(req)) {
    // Toujours essayer le réseau d'abord pour index.html (évite l'appli coincée)
    return event.respondWith(networkFirst(event));
  }

  if (isJS(req) || isManifest(req)) {
    // Scripts/manifest : rapide puis rafraîchit en fond
    return event.respondWith(staleWhileRevalidate(event));
  }

  if (isStatic(req)) {
    // Assets statiques : cache d'abord
    return event.respondWith(cacheFirst(event));
  }

  // Par défaut
  return event.respondWith(staleWhileRevalidate(event));
});

// Canal de communication page <-> SW pour SKIP_WAITING contrôlé
self.addEventListener('message', (event) => {
  const { type } = event.data || {};
  if (type === 'SKIP_WAITING') self.skipWaiting();
});
