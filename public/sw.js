const CACHE = 'fa-v704';
const STATIC = ['/fa-theme.css','/aurora.css','/logo-mark.png','/logo-wordmark.png'];

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

// Push z venčekového večera (22. 9. 2026): zamknutý telefón tímu dostane
// „Teraz: …" / „Si na rade" aj bez otvorenej stránky. Keď je stránka práve
// na očiach, notifikácia je tichá — stránka si zacinká sama.
self.addEventListener('push', e=>{
  let d={};
  try{ d=e.data ? e.data.json() : {}; }catch(x){ d={ title:'Fusion Academy', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async()=>{
    const okna = await clients.matchAll({ type:'window', includeUncontrolled:true });
    const naOciach = okna.some(c=>c.visibilityState==='visible' && d.url && new URL(c.url).pathname===d.url);
    await self.registration.showNotification(d.title||'Fusion Academy', {
      body: d.body||'', tag: d.tag||undefined, renotify: !!d.tag, icon:'/logo-mark.png', badge:'/logo-mark.png',
      vibrate: d.vibrate||[200,100,200], silent: naOciach, requireInteraction: !!d.ja, data:{ url: d.url||'/' } });
  })());
});
self.addEventListener('notificationclick', e=>{
  e.notification.close();
  const url=(e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type:'window', includeUncontrolled:true }).then(ws=>{
    for(const w of ws){ if(new URL(w.url).pathname===url && 'focus' in w) return w.focus(); }
    return clients.openWindow(url);
  }));
});
