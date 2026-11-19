// 11/19 대표 요청 "쿠폰에도 이미지 없는 것들 보완해줘" · "핫딜 공지는 브랜드 로고로 대치하지 말고 이미지를"
// 상품 사진이 없는 쿠폰 → 수집기가 찾은 행사 썸네일(official_event) 또는 연결된 공지의 공식 이미지, 공지 이미지가 없으면 연결 쿠폰의 행사 썸네일
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { encodeArtworkUrl } from '../src/artwork-meta.js';
import { serveDir } from './helpers.js';

let site, browser;
before(async () => {
  site = await serveDir(fileURLToPath(new URL('../../web/', import.meta.url)));
  browser = await chromium.launch();
});
after(async () => { if (browser) await browser.close(); if (site) await site.close(); });

async function setup(data, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
  const page = await context.newPage();
  let couponCalls = 0;
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (options.requests) options.requests.push(url.href);
    // 실제 상품 사진처럼 최소 너비(80px) 검증을 통과하는 100px PNG.
    if (options.photoUrl === url.href || (options.photoUrls || []).includes(url.href)) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAA6ElEQVR4nO3QwQ3AIBDAsNL9dz5WIC+EZE8QZc3Mx5n/dsBLzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCjbP8QPFyqa8aAAAAABJRU5ErkJggg==', 'base64') });
    if ((options.failImages || []).some((path) => url.href === new URL(path, site.base).href)) return route.abort();
    if (url.origin === site.base) return route.continue();
    if (url.hostname === 'script.google.com') {
      if (url.searchParams.get('action') === 'coupons') {
        couponCalls++;
        if (options.failCoupons && couponCalls <= options.failCoupons) return route.abort('failed');
        return route.fulfill({ status: 200, json: data, headers: { 'access-control-allow-origin': '*' } });
      }
      return route.fulfill({ status: 200, json: { ok: true, state: 'idle', last_checked_at: data.last_checked_at }, headers: { 'access-control-allow-origin': '*' } });
    }
    if (url.hostname === 'example.test') return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>공식 행사</title>' });
    return route.abort();
  });
  if (options.cache) await page.addInitScript((cache) => localStorage.setItem('among_cache', JSON.stringify(cache)), options.cache);
  if (options.blockFollowing) await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === 'among_following') throw new DOMException('Storage blocked', 'QuotaExceededError'); return set.call(this, key, value); };
  });
  return { context, page };
}

const NOW = '2026-11-19T03:00:00.000Z';
const END = '2026-11-30';
const THUMB = 'https://img.test/upload/event-thumb.png';
const POSTER = 'https://img.test/upload/notice-poster.png';
const base = { brand: '테스트버거', category: '햄버거', item_type: '단품', discount_type: 'free_item', channels: ['매장'], audience: '전체', programs: [],
  start_date: '2026-11-10', end_date: END, checked_at: NOW, first_seen: NOW, official_link: 'https://example.test/event' };

test('상품 사진 없는 쿠폰은 같은 행사의 공식 이미지로, 이미지 없는 공지는 연결 쿠폰의 행사 썸네일로 (로고 대신)', { timeout: 30000 }, async (t) => {
  const thumbUrl = encodeArtworkUrl(THUMB, { kind: 'official_event', source: 'https://example.test/event/7', checkedAt: NOW });
  const data = { ok: true, last_checked_at: NOW,
    coupons: [
      { ...base, id: 'c_thumb', menu: '겨울 한정 굿즈', source_url: 'https://example.test/event/7', image_url: thumbUrl },
      { ...base, id: 'c_rel', menu: '산타 피규어 증정', source_url: 'https://example.test/event/8', image_url: '' },
      { ...base, id: 'c_none', menu: '알 수 없는 증정', source_url: 'https://example.test/event/9', image_url: '' },
    ],
    news: [
      { id: 'n_poster', brand: '테스트버거', category: '햄버거', title: '산타 피규어 증정 이벤트', summary: '피규어 증정', discount_label: '증정', programs: [], start_date: '2026-11-10', end_date: END,
        checked_at: NOW, first_seen: NOW, source_url: 'https://example.test/event/8', official_link: 'https://example.test/event', related_ids: ['c_rel'], image_url: POSTER },
      { id: 'n_noimg', brand: '테스트버거', category: '햄버거', title: '겨울 한정 굿즈 프로모션', summary: '굿즈 증정', discount_label: '증정', programs: [], start_date: '2026-11-10', end_date: END,
        checked_at: NOW, first_seen: NOW, source_url: 'https://example.test/event/7', official_link: 'https://example.test/event', related_ids: ['c_thumb'], image_url: '' },
    ] };
  const { context, page } = await setup(data, { photoUrls: [THUMB, POSTER] });
  t.after(() => context.close());
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(`${site.base}/index.html`);
  const card = (id) => page.locator(`#list article.card[data-id="${id}"]`);
  await card('c_thumb').waitFor();
  assert.equal(await card('c_thumb').locator('img.ph').getAttribute('src'), THUMB, '행사 썸네일(주소 뒤 종류 표시는 떼고)');
  assert.equal((await card('c_thumb').locator('.coupon-image-label').innerText()).trim(), '공식 행사');
  assert.equal(await card('c_rel').locator('img.ph').getAttribute('src'), POSTER, '연결된 공지의 공식 이미지');
  assert.equal((await card('c_rel').locator('.coupon-image-label').innerText()).trim(), '공식 행사');
  assert.equal(await card('c_none').locator('img.ph').count(), 0, '맞는 이미지가 없으면 다른 행사 이미지로 채우지 않는다');
  const hot = page.locator('[data-hot="news:n_noimg"]');
  await hot.waitFor();
  assert.equal(await hot.locator('img.ph').getAttribute('src'), THUMB);
  assert.equal((await hot.locator('.notice-image-label').innerText()).trim(), '공식 행사 이미지');
  await page.waitForFunction(() => { const i = document.querySelector('[data-hot="news:n_noimg"] img.ph'); return i && i.complete && i.naturalWidth > 0; });
  assert.equal(await hot.locator('.notice-preview').isVisible(), false, '브랜드 로고가 보이지 않는다');
});
