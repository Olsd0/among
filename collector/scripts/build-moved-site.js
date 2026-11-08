// 옛 주소(https://olsd0.github.io/among/) → 새 주소(https://www.amongpick.com/)로 보내는 이동 안내 사이트.
// 11/08 Cloudflare 이전이 확인된 뒤 GitHub Pages(pages.yml)가 web/ 대신 이 결과를 배포한다.
// - 각 페이지: 즉시 새 주소로 이동(meta refresh + 스크립트로 검색어·# 보존), canonical은 새 주소
// - 404.html: 그 밖의 옛 경로도 같은 경로의 새 주소로
// - sw.js: 옛 주소에 설치된 서비스 워커와 캐시를 지우고 열린 화면을 새로 고침 → 이동 안내로
// 이동 목적지는 항상 새 도메인 안이다(경로 글자 제한, 앞 슬래시 제거 — 다른 사이트로 보내는 데 쓸 수 없음).
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_PAGES, pageUrl } from './prepare-pages.js';

export const MOVED_PAGES = [...PUBLIC_PAGES, 'admin.html'];
export const OLD_BASE = '/among/';

export const MOVED_JS = `// 옛 주소 → 새 주소 (같은 경로·검색어·#)
(function () {
  var root = document.documentElement;
  var site = root.getAttribute('data-site');
  var base = root.getAttribute('data-base') || '/';
  var path = location.pathname;
  var rest = path.indexOf(base) === 0 ? path.slice(base.length) : path;
  rest = rest.replace(/^\\/+/, '').replace(/(^|\\/)index\\.html$/, '$1').replace(/\\.html$/, '');
  if (!/^[A-Za-z0-9._\\/-]*$/.test(rest) || rest.indexOf('..') !== -1) rest = '';
  var target = new URL(rest, site);
  if (target.origin !== new URL(site).origin) target = new URL(site);
  target.search = location.search;
  target.hash = location.hash;
  location.replace(target.href);
})();
`;

export const MOVED_SW = `// 옛 주소의 서비스 워커·캐시를 정리한다. AMONG 새 주소: 이동 안내 페이지가 알려 준다.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('among-shell-') === 0; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.registration.unregister(); }).then(function () {
    return self.clients.matchAll({ type: 'window' });
  }).then(function (clients) { clients.forEach(function (c) { c.navigate(c.url); }); }));
});
`;

const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function movedPage(target, site, { notFound = false } = {}) {
  return `<!doctype html>
<html lang="ko" data-site="${esc(site)}" data-base="${OLD_BASE}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="strict-origin-when-cross-origin">
${notFound ? '' : `<link rel="canonical" href="${esc(target)}">\n`}<meta http-equiv="refresh" content="0; url=${esc(target)}">
<title>AMONG 주소가 바뀌었어요</title>
<script src="${OLD_BASE}moved.js"></script>
</head>
<body>
<p>AMONG 주소가 바뀌었어요. <a href="${esc(target)}">${esc(new URL(target).host)}</a>으로 이동합니다.</p>
</body>
</html>
`;
}

export function buildMovedSite(outDir, site) {
  const base = new URL(site);
  if (base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.hash) throw new Error('새 주소는 https://도메인/ 형식이어야 해요.');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const page of MOVED_PAGES) {
    writeFileSync(resolve(outDir, page), movedPage(pageUrl(page, base, true), base.href));
    written.push(page);
  }
  writeFileSync(resolve(outDir, '404.html'), movedPage(base.href, base.href, { notFound: true }));
  writeFileSync(resolve(outDir, 'moved.js'), MOVED_JS);
  writeFileSync(resolve(outDir, 'sw.js'), MOVED_SW);
  writeFileSync(resolve(outDir, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  return [...written, '404.html', 'moved.js', 'sw.js', 'robots.txt'];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const site = process.argv[2] || 'https://www.amongpick.com/';
  const outDir = resolve(process.argv[3] || fileURLToPath(new URL('../../moved/', import.meta.url)));
  const files = buildMovedSite(outDir, site);
  console.log(`옛 주소 이동 안내: ${site} · 파일 ${files.length}개 → ${outDir}`);
}
