import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { encodeArtworkUrl } from '../src/artwork-meta.js';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveDir } from './helpers.js';

const NOW = '2026-11-14T06:00:00.000Z';
const HANS_ID = 'n_verified_hans_npay_20261112';
const HANS_SOURCE = 'https://pay.naver.com/benefit/payment/detail/24278798653708';
const HANS_IMAGE = '/event-images/hans-ganache-official.webp';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAA6ElEQVR4nO3QwQ3AIBDAsNL9dz5WIC+EZE8QZc3Mx5n/dsBLzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCjbP8QPFyqa8aAAAAABJRU5ErkJggg==', 'base64');

// Nine urgent notices deliberately fill the eight-card recommendation rail.
// The real, reviewed HANS notice must still be reachable in the complete list.
const DATA = {
  ok: true, last_checked_at: NOW, coupons: [], app_coupons: [], app_coupon_refs: [],
  news: Array.from({ length: 9 }, (_, i) => ({
    id: `n_visibility_fixture_${i}`, brand: `테스트 브랜드 ${i}`, category: '디저트',
    title: `테스트 행사 ${i} 오늘 마감`, summary: '테스트 전용 기간 한정 행사',
    start_date: '2026-11-14', end_date: '2026-11-14', status: 'published',
    checked_at: NOW, first_seen: NOW, programs: [], related_ids: [], notice_only: true,
    source_url: `https://pay.naver.com/benefit/payment/detail/test-${i}`,
    image_url: i === 0 ? encodeArtworkUrl('https://press.example/photo.jpg', { kind: 'press_related', source: 'https://press.example/article/1', checkedAt: NOW, credit: '브랜드 제공' }) : './event-images/dunkin-npay-dday-20261114.webp',
  })),
};

let site, browser;
before(async () => {
  site = await serveDir(fileURLToPath(new URL('../../web/', import.meta.url)), { reviewedEvents: true });
  browser = await chromium.launch();
});
after(async () => {
  if (browser) await browser.close();
  if (site) await site.close();
});

async function setup(t, width = 390) {
  const context = await browser.newContext({
    viewport: { width, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul',
    serviceWorkers: 'block', reducedMotion: 'reduce',
  });
  t.after(() => context.close());
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === site.base) return route.continue();
    if (url.hostname === 'script.google.com') {
      const action = url.searchParams.get('action');
      const json = action === 'coupons' ? DATA : action === 'nutrition' ? { ok: true, items: [] }
        : { ok: true, state: 'idle', app_coupons: [], app_coupon_refs: [] };
      return route.fulfill({ status: 200, json, headers: { 'access-control-allow-origin': '*' } });
    }
    if (request.resourceType() === 'image') return route.fulfill({ contentType: 'image/png', body: PNG });
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date(NOW));
  return { context, page, errors };
}

async function ready(page, suffix = '') {
  await page.goto(`${site.base}/index.html${suffix}`);
  await page.locator('#list[aria-busy="false"]').waitFor();
  await page.locator('#showAllNotices').waitFor();
}

test('all notices exposes events beyond the eight recommendations, opens their real detail, and collapses on narrow screens', { timeout: 30000 }, async t => {
  const { page, errors } = await setup(t);
  await ready(page);
  const toggle = page.locator('#showAllNotices');
  const list = page.locator('#allHotNotices');
  const card = list.locator(`[data-hot="news:${HANS_ID}"]`);
  assert.equal(await page.locator('#hotRail [data-hot]').count(), 8);
  assert.equal(await page.locator(`#hotRail [data-hot="news:${HANS_ID}"]`).count(), 0);
  assert.equal(await toggle.getAttribute('aria-controls'), 'allHotNotices');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await list.isVisible(), false);

  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.ok(await list.locator('[data-hot]').count() > 8);
  await card.waitFor();
  await card.scrollIntoViewIfNeeded();
  const poster = card.locator('img.ph');
  await poster.evaluate(img => img.decode());
  assert.equal(new URL(await poster.getAttribute('src'), site.base).pathname, HANS_IMAGE);
  assert.equal(await card.locator('.hot-source').getAttribute('href'), HANS_SOURCE);

  await card.locator('.hot-open').click();
  const dialog = page.locator('#newsSheet[open]');
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /HANS.*50%/s);
  assert.equal(await dialog.locator('[data-news-src]').getAttribute('href'), HANS_SOURCE);
  await dialog.locator('img.ph').evaluate(img => img.decode());
  assert.equal(new URL(page.url()).searchParams.get('n'), HANS_ID);
  await dialog.locator('[data-close]').click();

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px has no horizontal page overflow`);
  }
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await list.isVisible(), false);
  assert.deepEqual(errors, []);
});

test('the first three visible recommendation images load eagerly while later cards remain lazy', { timeout: 30000 }, async t => {
  const { page, errors } = await setup(t, 1200);
  await ready(page);
  const pictures = page.locator('#hotRail .hot-visual img.ph');
  assert.equal(await pictures.count(), 8);
  assert.deepEqual(await pictures.evaluateAll(images => images.map(img => img.loading)), ['eager', 'eager', 'eager', 'lazy', 'lazy', 'lazy', 'lazy', 'lazy']);
  for (let i = 0; i < 3; i++) {
    assert.ok(await pictures.nth(i).evaluate(async img => { await img.decode(); return img.naturalWidth; }) >= 80);
  }
  assert.deepEqual(errors, []);
});

test('a transient local poster failure retries once and preserves the poster and original source', { timeout: 30000 }, async t => {
  const { context, page, errors } = await setup(t);
  let requests = 0;
  // Register after the shared route: the first local HANS request fails, and
  // its retry goes to the actual bundled image rather than a fixture image.
  await context.route(url => url.origin === site.base && url.pathname === HANS_IMAGE, route => {
    requests++;
    return requests === 1 ? route.abort('failed') : route.continue();
  });
  await ready(page, `?n=${HANS_ID}`);
  const hero = page.locator('#newsSheet[open] .news-hero');
  const poster = hero.locator('img.ph');
  await page.waitForFunction(() => {
    const image = document.querySelector('#newsSheet[open] .news-hero img.ph');
    return image?.complete && image.naturalWidth >= 80;
  });
  assert.equal(requests, 2, 'only one retry is needed after the failed first request');
  assert.match(await hero.getAttribute('class'), /\bhas-ph\b/);
  assert.equal(new URL(await poster.getAttribute('src'), site.base).pathname, HANS_IMAGE);
  assert.equal(await page.locator('#newsSheet [data-news-src]').getAttribute('href'), HANS_SOURCE);
  assert.equal(await page.locator('#newsSheet .notice-image-error').isVisible(), false);
  assert.deepEqual(errors, []);
});

test('a press photo from the public API displays its source and label without exposing the metadata fragment', { timeout: 30000 }, async t => {
  const { page, errors } = await setup(t);
  await ready(page, '?n=n_visibility_fixture_0');
  const dialog = page.locator('#newsSheet[open]');
  assert.equal(await dialog.locator('.notice-image-label').innerText(), '기사 관련 이미지');
  assert.equal(await dialog.locator('img.ph').getAttribute('src'), 'https://press.example/photo.jpg');
  assert.equal(await dialog.locator('.notice-image-credit a').getAttribute('href'), 'https://press.example/article/1');
  assert.equal(await dialog.locator('[data-news-src]').getAttribute('href'), 'https://pay.naver.com/benefit/payment/detail/test-0');
  assert.deepEqual(errors, []);
});
