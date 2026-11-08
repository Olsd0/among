import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparePages, PUBLIC_PAGES } from '../scripts/prepare-pages.js';

test('프로젝트 주소에서 사용자 도메인으로 바꿔도 canonical과 사이트맵에 예전 주소가 남지 않는다', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'among-pages-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pages = PUBLIC_PAGES;
  for (const p of pages) copyFileSync(new URL(`../../web/${p}`, import.meta.url), join(dir, p));
  preparePages(dir, 'https://olsd0.github.io/among');
  assert.match(readFileSync(join(dir, 'robots.txt'), 'utf8'), /Disallow: \/among\/admin\n/, 'admin.html·admin(확장자 없는 주소)·admin.js 모두');
  preparePages(dir, 'https://among.example/');
  for (const p of pages) {
    const html = readFileSync(join(dir, p), 'utf8');
    assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
    assert.match(html, /content="https:\/\/among.example\/icon-512.png"/);
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)[1];
    assert.equal(canonical, new URL(p === 'index.html' ? './' : p, 'https://among.example/').href);
    const shared = html.match(/<meta property="og:url" content="([^"]+)"/)[1];
    assert.equal(shared, canonical);
  }
  const sitemap = readFileSync(join(dir, 'sitemap.xml'), 'utf8');
  assert.equal((sitemap.match(/<loc>/g) || []).length, PUBLIC_PAGES.length);
  assert.ok(!sitemap.includes('admin'));
  assert.match(readFileSync(join(dir, 'robots.txt'), 'utf8'), /Disallow: \/admin\n/);
  const before = readFileSync(join(dir, 'index.html'), 'utf8');
  preparePages(dir, 'https://among.example/');
  assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), before, '생성은 반복해도 동일하다');
  for (const url of ['http://example.com', 'https://user:password@example.com', 'https://example.com/?q=1']) assert.throws(() => preparePages(dir, url));
});

test('사진·로고는 파일로 저장하지 않고 공식 https 주소를 그대로 쓴다', async () => {
  assert.equal(existsSync(new URL('../../web/assets/', import.meta.url)), false, 'web/assets 없음');
  const { officialBrandLogo } = await import('../../web/brand-logos.js');
  const src = readFileSync(new URL('../../web/brand-logos.js', import.meta.url), 'utf8');
  const brands = [...src.matchAll(/^  \["([^"]+)", \{/gm)].map((m) => m[1]);
  assert.equal(brands.length, 22);
  for (const brand of brands) {
    const logo = officialBrandLogo(brand);
    assert.match(logo.image, /^https:\/\//, brand);
    assert.match(logo.source, /^https:\/\//, brand);
  }
  for (const file of ['notice-images.js', 'product-images.js', 'verified-news.js', 'app.js', 'brand-logos.js']) {
    assert.doesNotMatch(readFileSync(new URL(`../../web/${file}`, import.meta.url), 'utf8'), /["'`]assets\//, file);
  }
});
