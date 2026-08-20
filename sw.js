const V="0.12.1",CACHE="angeli-secretaria-v"+V;
const ASSETS=["./?v="+V,"./index.html?v="+V,"./manifest.json?v="+V,"./icon-192.png?v="+V,"./icon-512.png?v="+V];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;const u=new URL(e.request.url);if(e.request.mode==="navigate"||/\/(index\.html|manifest\.json|sw\.js)$/.test(u.pathname)){e.respondWith(fetch(e.request,{cache:"no-store"}).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request)));}else e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});
