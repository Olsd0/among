// HTML·설정은 최신 사본 우선. 버전이 고정된 모듈·로고만 캐시 우선. 쿠폰 API는 저장하지 않는다.
const CACHE = 'among-shell-v16';
const SHELL = ['./', 'index.html', 'app.js?v=20261029-7', 'engine.js?v=20261029-7', 'product-images.js?v=20261029-7', 'notice-images.js?v=20261029-7', 'verified-news.js?v=20261029-7', 'brand-logos.js?v=20261029-7', 'config.js', 'manifest.webmanifest', 'icon-192.png'];
const ASSETS = new Set(['', 'index.html', 'app.js', 'engine.js', 'product-images.js', 'notice-images.js', 'verified-news.js', 'brand-logos.js', 'config.js', 'manifest.webmanifest',
  'about.html', 'guide.html', 'privacy.html', 'terms.html', 'doc.js', 'doc.css',
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
  const logo = /^assets\/brands\/[a-z]+-[a-f0-9]{12}\.(png|ico|svg)$/.test(path);
  const notice = /^assets\/notices\/[a-z0-9-]+-[a-f0-9]{12}\.jpg$/.test(path);
  if (!ASSETS.has(path) && !logo && !notice) return;
  // 공유 조건은 제외하되 배포 버전(v)은 보존해 서로 다른 모듈 버전을 섞지 않는다.
  const keyUrl = new URL(path || './', scope);
  if (url.searchParams.has('v')) keyUrl.searchParams.set('v', url.searchParams.get('v'));
  const key = keyUrl.href;
  e.respondWith((async () => {
    // 파일 해시·배포 버전이 바뀌기 전에는 같은 내용. 로고는 본 것만 저장한다.
    const immutable = logo || notice || (['app.js', 'engine.js', 'product-images.js', 'notice-images.js', 'verified-news.js', 'brand-logos.js'].includes(path) && url.searchParams.has('v'));
    if (immutable) {
      try { const hit = await (await caches.open(CACHE)).match(key); if (hit) return hit; } catch { /* 저장소 접근 실패 시 네트워크 사용 */ }
    }
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
