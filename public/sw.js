const CACHE = 'fa-v1';
const STATIC = ['/fa-theme.css','/nav-bar.js','/favicon.svg'];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>clients.claim()));
});

self.addEventListener('fetch', e=>{
  if(e.request.method!=='GET') return;
  if(e.request.url.includes('/api/')) return; // never cache API
  e.respondWith(
    caches.match(e.request).then(cached=>{
      const fresh = fetch(e.request).then(r=>{ if(r.ok){ const c=r.clone(); caches.open(CACHE).then(cache=>cache.put(e.request,c)); } return r; });
      return cached || fresh;
    })
  );
});
