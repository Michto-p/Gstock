/* Gstock - sw.js v2.6.0 (cache shell only + safe puts) */
const CACHE='gstock-2.6.0';
const SHELL=[
  './',
  'index.html',
  'js/app.js?v=2.6.0',
  'js/db.js?v=2.1.8',
  'js/barcode.js?v=2.1.8',
  'js/code39.js?v=2.1.8',
  'js/sync-github.js?v=2.1.8',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    try { await c.addAll(SHELL); } catch (err) { /* ignore quota */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k !== CACHE && caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isShell = url.origin === location.origin &&
    (url.pathname.endsWith('/') ||
     /index\.html$/.test(url.pathname) ||
     /(app|db|barcode|code39|sync-github)\.js/.test(url.pathname) ||
     /manifest\.json$/.test(url.pathname) ||
     /icons\/icon-(192|512)\.png$/.test(url.pathname));

  if (isShell) {
    e.respondWith((async () => {
      try {
        const net = await fetch(e.request, { cache: 'no-store' });
        try { const c = await caches.open(CACHE); await c.put(e.request, net.clone()); } catch (_) {}
        return net;
      } catch (_) {
        const hit = await caches.match(e.request);
        return hit || caches.match('index.html');
      }
    })());
  } else {
    e.respondWith(fetch(e.request).catch(() => caches.match('index.html')));
  }
});
