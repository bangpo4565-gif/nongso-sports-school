// 홈 화면 설치용 최소 서비스 워커: 화면 파일은 항상 새로 받고, 큰 AI 모델 파일만 저장해 둔다.
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=="GET") return;
  if(u.pathname.includes("/models/")){
    e.respondWith(caches.open("models-v1").then(c=>c.match(e.request).then(r=>r||fetch(e.request).then(res=>{if(res.ok)c.put(e.request,res.clone());return res;}))));
  }
});
