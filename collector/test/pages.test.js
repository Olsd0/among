import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { preparePages, PUBLIC_PAGES } from '../scripts/prepare-pages.js';

test('프로젝트 주소에서 사용자 도메인으로 바꿔도 canonical과 사이트맵에 예전 주소가 남지 않는다', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'among-pages-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pages = PUBLIC_PAGES;
  for (const p of pages) copyFileSync(new URL(`../../web/${p}`, import.meta.url), join(dir, p));
  preparePages(dir, 'https://olsd0.github.io/among');
  assert.match(readFileSync(join(dir, 'robots.txt'), 'utf8'), /Disallow: \/among\/admin.html/);
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
  assert.match(readFileSync(join(dir, 'robots.txt'), 'utf8'), /Disallow: \/admin.html/);
  const before = readFileSync(join(dir, 'index.html'), 'utf8');
  preparePages(dir, 'https://among.example/');
  assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), before, '생성은 반복해도 동일하다');
  for (const url of ['http://example.com', 'https://user:password@example.com', 'https://example.com/?q=1']) assert.throws(() => preparePages(dir, url));
});

test('공식 로고 파일은 고정 해시와 일치하며 외부 참조 없는 원본 이미지다', () => {
  const root = new URL('../../web/assets/brands/', import.meta.url);
  const files = readdirSync(root);
  assert.equal(files.length, 22);
  let bytes = 0;
  for (const name of files) {
    const data = readFileSync(new URL(name, root));
    bytes += data.length;
    assert.ok(name.includes(createHash('sha256').update(data).digest('hex').slice(0, 12)));
    if (name.endsWith('.svg')) assert.doesNotMatch(data.toString(), /<script|<foreignObject|(?:href|src)=["'](?:https?:|\/\/|data:)/i);
  }
  assert.ok(bytes < 600000, '전체 로고는 600KB 미만');
});
