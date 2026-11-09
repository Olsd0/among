// 11/08 대표 결정: www.amongpick.com을 Cloudflare Pages(무료)로 운영하고 옛 GitHub 주소는 새 주소로 보낸다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { preparePages, pageUrl, PUBLIC_PAGES } from '../scripts/prepare-pages.js';
import { buildSite, injectConfig, checkCopies, COPIES, SITE_URL } from '../scripts/build-cloudflare.js';
import { buildMovedSite, MOVED_JS, MOVED_SW, MOVED_PAGES } from '../scripts/build-moved-site.js';

const ROOT = new URL('../../', import.meta.url);
const temp = (t) => { const dir = mkdtempSync(join(tmpdir(), 'among-domain-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };
function copyRepo(dir) {
  cpSync(new URL('web/', ROOT), join(dir, 'web'), { recursive: true });
  mkdirSync(join(dir, 'collector/src'), { recursive: true });
  for (const name of COPIES) copyFileSync(new URL(`collector/src/${name}`, ROOT), join(dir, 'collector/src', name));
}

test('Cloudflare 대표 주소는 확장자 없는 주소 (guide.html → /guide 이동과 같게), 관리 화면은 검색에서 뺀다', (t) => {
  const base = new URL('https://www.amongpick.com/');
  assert.equal(pageUrl('index.html', base, true), 'https://www.amongpick.com/');
  assert.equal(pageUrl('guide.html', base, true), 'https://www.amongpick.com/guide');
  assert.equal(pageUrl('guide.html', new URL('https://olsd0.github.io/among/'), false), 'https://olsd0.github.io/among/guide.html', 'GitHub Pages는 그대로');
  const dir = temp(t);
  for (const page of PUBLIC_PAGES) copyFileSync(new URL(`web/${page}`, ROOT), join(dir, page));
  preparePages(dir, base.href, { pretty: true });
  assert.match(readFileSync(join(dir, 'guide.html'), 'utf8'), /<link rel="canonical" href="https:\/\/www\.amongpick\.com\/guide">/);
  assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /<meta property="og:url" content="https:\/\/www\.amongpick\.com\/">/);
  const sitemap = readFileSync(join(dir, 'sitemap.xml'), 'utf8');
  assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]),
    ['https://www.amongpick.com/', 'https://www.amongpick.com/guide', 'https://www.amongpick.com/about', 'https://www.amongpick.com/partners', 'https://www.amongpick.com/privacy', 'https://www.amongpick.com/terms']);
  assert.equal(readFileSync(join(dir, 'robots.txt'), 'utf8'), 'User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: https://www.amongpick.com/sitemap.xml\n');
});

test('Cloudflare 빌드: 사본 확인 → 설정 주입(공개값만, 형식 검사) → 새 주소 메타. 비밀값 없이 동작', (t) => {
  const dir = temp(t);
  copyRepo(dir);
  const before = readFileSync(join(dir, 'web/config.js'), 'utf8');
  const out = buildSite(dir, {});
  assert.equal(out.site, SITE_URL);
  assert.equal(out.api, /apiUrl: 'https:\/\/script\.google\.com/.test(before), '저장소 설정의 API 주소 유지');
  assert.match(readFileSync(join(dir, 'web/about.html'), 'utf8'), /<link rel="canonical" href="https:\/\/www\.amongpick\.com\/about">/);
  assert.equal(out.publisher, true, '대표 주소 빌드는 AMONG 계정 게시자 ID를 기본으로 사용');
  assert.equal(out.contact, true, '저장소 설정의 문의 메일 사용');
  for (const page of ['about.html', 'privacy.html', 'terms.html', 'partners.html']) assert.match(readFileSync(join(dir, 'web', page), 'utf8'), /<a href="mailto:hello@amongpick\.com">hello@amongpick\.com<\/a>/, page + ' 정적 문의처');
  assert.equal(readFileSync(join(dir, 'web/ads.txt'), 'utf8'), 'google.com, pub-3507520612481684, DIRECT, f08c47fec0942fa0\n');
  assert.match(readFileSync(join(dir, 'web/index.html'), 'utf8'), /name="google-adsense-account" content="ca-pub-3507520612481684"/);
  const other = temp(t);
  copyRepo(other);
  assert.equal(buildSite(other, { SITE_URL: 'https://preview.example.com/' }).publisher, false, '다른 주소 빌드에는 기본 ID를 넣지 않음');
  assert.equal(existsSync(join(other, 'web/ads.txt')), false, '게시자 ID 없으면 ads.txt 없음');
  buildSite(dir, { CONTACT_EMAIL: 'hello@example.com', ADSENSE_PUBLISHER_ID: 'pub-1234567890123456' });
  assert.match(readFileSync(join(dir, 'web/about.html'), 'utf8'), /mailto:hello@example\.com/);
  assert.equal(readFileSync(join(dir, 'web/ads.txt'), 'utf8'), 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n', '환경변수 게시자 ID가 기본값보다 우선');
  assert.throws(() => injectConfig(before, { APPS_SCRIPT_URL: 'https://evil.example/exec' }), /APPS_SCRIPT_URL/);
  assert.throws(() => injectConfig(before, { CONTACT_EMAIL: 'a@example.com\nBcc:x@example.com' }), /CONTACT_EMAIL/);
  for (const SITE_URL of ['http://www.amongpick.com/', 'https://www.amongpick.com/among/', 'https://www.amongpick.com/?a=1']) assert.throws(() => buildSite(dir, { SITE_URL }), /SITE_URL/);
  writeFileSync(join(dir, 'web/engine.js'), '// 오래된 사본\n');
  assert.throws(() => checkCopies(dir), /engine\.js/);
});

test('Cloudflare 응답 보안 헤더: 다른 사이트 안에 넣기 금지·HSTS·관리 화면 검색 제외·기본 주소 검색 제외', () => {
  const text = readFileSync(new URL('web/_headers', ROOT), 'utf8');
  const rules = {};
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (!/^\s/.test(line)) { current = line.trim(); rules[current] = {}; continue; }
    if (line.trim().startsWith('! ')) { rules[current]['!' + line.trim().slice(2)] = true; continue; }
    const at = line.indexOf(':');
    rules[current][line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  const all = rules['/*'];
  assert.match(all['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(all['X-Frame-Options'], 'DENY');
  assert.equal(all['X-Content-Type-Options'], 'nosniff');
  assert.match(all['Strict-Transport-Security'], /^max-age=(\d+)$/);
  assert.ok(Number(all['Strict-Transport-Security'].split('=')[1]) >= 31536000);
  assert.doesNotMatch(text, /preload|includeSubDomains/, 'HSTS 미리 등록·하위 도메인 강제는 하지 않음 (되돌리기 어려움)');
  assert.match(all['Permissions-Policy'], /geolocation=\(\)/);
  assert.equal(rules['/admin*']['X-Robots-Tag'], 'noindex, nofollow');
  assert.equal(rules['/admin*']['Cache-Control'], 'no-store');
  assert.equal(rules['https://:project.pages.dev/*']['X-Robots-Tag'], 'noindex');
  const widget = rules['/coupang-widget*'];
  assert.ok(widget['!X-Frame-Options'] && widget['!Content-Security-Policy'], '쿠팡 배너 페이지만 /* 의 프레임 금지를 뗀다');
  assert.match(widget['Content-Security-Policy'], /frame-ancestors 'self'/, '같은 사이트 안에서만');
  assert.equal(widget['X-Frame-Options'], 'SAMEORIGIN');
  assert.equal(Object.keys(rules).filter((k) => Object.keys(rules[k]).some((h) => h.startsWith('!'))).join(), '/coupang-widget*', '다른 경로는 프레임 금지 유지');
});

test('옛 GitHub 주소 이동 안내: 같은 경로·검색어·#를 새 도메인으로만 보내고, 옛 서비스 워커를 지운다', (t) => {
  const dir = temp(t);
  const files = buildMovedSite(dir, 'https://www.amongpick.com/');
  assert.deepEqual(files, [...MOVED_PAGES, '404.html', 'moved.js', 'sw.js', 'robots.txt']);
  const guide = readFileSync(join(dir, 'guide.html'), 'utf8');
  assert.match(guide, /<link rel="canonical" href="https:\/\/www\.amongpick\.com\/guide">/);
  assert.match(guide, /<meta http-equiv="refresh" content="0; url=https:\/\/www\.amongpick\.com\/guide">/);
  assert.match(guide, /script-src 'self'/);
  assert.doesNotMatch(guide, /unsafe-inline|<script>(?!<)/);
  assert.match(readFileSync(join(dir, 'admin.html'), 'utf8'), /url=https:\/\/www\.amongpick\.com\/admin"/);
  assert.doesNotMatch(readFileSync(join(dir, '404.html'), 'utf8'), /rel="canonical"/);
  const go = (href) => {
    const url = new URL(href);
    let replaced = null;
    const attrs = { 'data-site': 'https://www.amongpick.com/', 'data-base': '/among/' };
    vm.runInNewContext(MOVED_JS, { URL, document: { documentElement: { getAttribute: (k) => attrs[k] } }, location: { pathname: url.pathname, search: url.search, hash: url.hash, replace: (to) => { replaced = to; } } });
    return replaced;
  };
  assert.equal(go('https://olsd0.github.io/among/'), 'https://www.amongpick.com/');
  assert.equal(go('https://olsd0.github.io/among/index.html?view=onlineDeals'), 'https://www.amongpick.com/?view=onlineDeals');
  assert.equal(go('https://olsd0.github.io/among/guide.html?r=1#calc'), 'https://www.amongpick.com/guide?r=1#calc');
  assert.equal(go('https://olsd0.github.io/among/admin.html'), 'https://www.amongpick.com/admin');
  for (const evil of ['https://olsd0.github.io/among//evil.example/x', 'https://olsd0.github.io/among/%2F%2Fevil.example', 'https://olsd0.github.io/among/../../x', 'https://olsd0.github.io/among/a%0Ab']) {
    assert.equal(new URL(go(evil)).origin, 'https://www.amongpick.com', evil);
  }
  assert.match(MOVED_SW, /registration\.unregister\(\)/);
  assert.match(MOVED_SW, /among-shell-/);
});

test('없는 주소는 404 페이지 (Cloudflare Pages가 홈 화면을 200으로 내보내 중복 페이지가 되지 않게), 옛 GitHub 주소는 이동 안내만 배포', () => {
  const html = readFileSync(new URL('web/404.html', ROOT), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /script-src 'none'/);
  assert.doesNotMatch(html, /<script|rel="canonical"/);
  for (const [, url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) assert.match(url, /^\//, `깊은 주소에서도 열리게 / 로 시작: ${url}`);
  const yml = readFileSync(new URL('.github/workflows/pages.yml', ROOT), 'utf8');
  assert.match(yml, /build-moved-site\.js https:\/\/www\.amongpick\.com\/ moved/);
  assert.match(yml, /path: moved/);
  assert.doesNotMatch(yml, /path: web/, '옛 주소에 사이트 사본을 다시 배포하지 않음');
});
