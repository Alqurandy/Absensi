const CACHE="hubdeenamic-v1";
const ASSETS=["./","./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png","./apple-touch-icon.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).catch(()=>{}));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=="GET"){return}
  // never cache supabase / api / cross-origin dynamic calls
  if(u.origin!==location.origin||u.pathname.startsWith("/api/")){return}
  if(e.request.mode==="navigate"){
    e.respondWith(fetch(e.request).catch(()=>caches.match("./index.html")));return}
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{
    const cp=res.clone();caches.open(CACHE).then(c=>c.put(e.request,cp)).catch(()=>{});return res}).catch(()=>r)));
});