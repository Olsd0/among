// 최소 서비스 워커: 화면 파일은 네트워크 우선, 끊기면 마지막 사본. 쿠폰 API는 캐시하지 않는다.
const CACHE = 'among-shell-v11';
const SHELL = ['./', 'index.html', 'app.js?v=20261029-2', 'engine.js?v=20261029-2', 'product-images.js?v=20261029-2', 'notice-images.js?v=20261029-2', 'config.js', 'manifest.webmanifest', 'icon-192.png'];
const ASSETS = new Set(['', 'index.html', 'app.js', 'engine.js', 'product-images.js', 'notice-images.js', 'config.js', 'manifest.webmanifest',
  'about.html', 'privacy.html', 'terms.html', 'doc.js', 'doc.css',
  'icon-32.png', 'icon-64.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  // 같은 도메인의 다른 서비스 캐시는 건드리지 않는다.
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('among-shell-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const scope = new URL(self.registration.scope);
  if (e.request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length);
  if (!ASSETS.has(path)) return;
  // 공유 조건은 제외하되 배포 버전(v)은 보존해 서로 다른 모듈 버전을 섞지 않는다.
  const keyUrl = new URL(path || './', scope);
  if (url.searchParams.has('v')) keyUrl.searchParams.set('v', url.searchParams.get('v'));
  const key = keyUrl.href;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request, { cache: 'no-cache' });
      if (res.ok) {
        try { const c = await caches.open(CACHE); await c.put(key, res.clone()); } catch { /* 캐시가 안 돼도 화면은 표시 */ }
      }
      return res;
    } catch {
      const c = await caches.open(CACHE);
      const hit = await c.match(key);
      if (hit) return hit;
      // JS·CSS·이미지가 없을 때 HTML을 주면 실행 오류가 나므로 탐색 요청에만 홈을 대체한다.
      if (e.request.mode === 'navigate') return (await c.match(new URL('index.html', scope).href)) || Response.error();
      return Response.error();
    }
  })());
});
