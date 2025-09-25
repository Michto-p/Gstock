// sw.js — offline cache v1.2.3
const CACHE = 'stock-cfa-v1.2.3';
const ASSETS = [
  './',
  './index.html',
  './js/db.js',
  './js/barcode.js',
  './js/app.js',
  './manifest.json'
];
self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate', e=>{
  e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  if (url.origin === location.origin){
    e.respondWith(caches.match(e.request).then(res => res || fetch(e.request)));
  }
});
