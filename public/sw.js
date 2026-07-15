const CACHE = 'fa-v65';
const STATIC = ['/fa-theme.css','/favicon.svg'];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>clients.claim()));
});

self.addEventListener('fetch', e=>{
  if(e.request.method!=='GET') return;
  if(e.request.url.includes('/api/')) return; // never cache API
  const isHTML = e.request.mode==='navigate' || (e.request.headers.get('accept')||'').includes('text/html');
  const isCode = /\.(js|css)(\?|$)/.test(e.request.url);
  if(isHTML || isCode){
    // network-first for pages so deploys show up immediately
    e.respondWith(
      fetch(e.request).then(r=>{ if(r.ok){ const c=r.clone(); caches.open(CACHE).then(cache=>cache.put(e.request,c)); } return r; })
        .catch(()=>caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached=>{
      const fresh = fetch(e.request).then(r=>{ if(r.ok){ const c=r.clone(); caches.open(CACHE).then(cache=>cache.put(e.request,c)); } return r; });
      return cached || fresh;
    })
  );
});
