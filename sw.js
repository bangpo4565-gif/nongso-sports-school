// 홈 화면 설치용 서비스 워커: 화면 파일은 항상 새로 받고, 큰 파일(AI 모델, 라이브러리)만 저장해 둬요.
const BIG = "big-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== BIG).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  if (u.pathname.includes("/models/") || u.pathname.includes("/vendor/")) {
    e.respondWith(caches.open(BIG).then(c => c.match(e.request).then(r => r || fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
  }
});
