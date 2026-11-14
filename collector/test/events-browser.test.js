import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serveDir } from './helpers.js';

// Real shared event modules with a deterministic clock and a public-API-shaped
// fixture. All external requests are fulfilled or blocked; no live source reads.
const NOW = '2026-11-14T06:00:00.000Z';
const SULBING_ID = 'c_bb9ba7a3fbed';
const DUBAI_POSTER = 'https://www.dunkindonuts.co.kr/storage/editor/ZKO41rckExIQHctvcT0omxZnMfi0WrDhVQUpB5Kt.png';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAA6ElEQVR4nO3QwQ3AIBDAsNL9dz5WIC+EZE8QZc3Mx5n/dsBLzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCjbP8QPFyqa8aAAAAABJRU5ErkJggg==', 'base64');
const DATA = {
  ok: true, last_checked_at: '2026-11-13T15:14:02.320Z', news: [], app_coupons: [], app_coupon_refs: [],
  coupons: [{
    id: SULBING_ID, brand: '설빙', category: '디저트', menu: '전 메뉴', item_type: '기타',
    regular_price: null, coupon_price: null, discount_type: 'point_back', discount_value: 50,
    discount_rate: 50, min_order: 9900, max_discount: null, channels: ['매장'],
    audience: '전체', app_only: false, programs: ['네이버페이'],
    start_date: '', end_date: '', conditions: '포인트·머니 9900원 이상 결제 시',
    source_url: 'https://pay.naver.com/benefit/payment/list?firstCategory=DOMESTIC_INSTORE',
    official_link: 'https://campaign2.naver.com/npay/cafe/',
    first_seen: '2026-11-11T21:57:41.327Z', checked_at: '2026-11-13T15:14:02.320Z',
  }],
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

async function setup() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
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
  await page.clock.setFixedTime(new Date(NOW));
  return { context, page };
}

test('확인한 네이버페이 공지가 기존 쿠폰ID와 조건·종료일을 공유하고 적립을 결제가격으로 표시하지 않는다', { timeout: 30000 }, async (t) => {
  const { context, page } = await setup();
  t.after(() => context.close());
  await page.goto(`${site.base}/index.html?n=n_verified_sulbing_npay_20261115`);
  await page.locator('#newsSheet[open]').waitFor();
  assert.match(await page.locator('.news-meta').innerText(), /11\/15/);
  assert.match(await page.locator('.news-sum').innerText(), /9900원.*50%.*적립/);
  assert.equal(await page.locator(`[data-rel="${SULBING_ID}"]`).count(), 1);
  await page.locator(`[data-rel="${SULBING_ID}"]`).click();
  const card = page.locator(`#card-${SULBING_ID}`);
  await card.locator('.detail:not([hidden])').waitFor();
  assert.equal(await page.locator(`#card-${SULBING_ID}`).count(), 1);
  assert.match(await card.locator('.price').innerText(), /50%.*적립/);
  assert.equal(await card.locator('.price b').count(), 0, '포인트 적립을 할인된 결제가격으로 만들지 않는다');
  assert.match(await card.locator('.detail').innerText(), /11\/15/);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.clock.setFixedTime(new Date('2026-11-16T03:00:00Z'));
  await page.goto(`${site.base}/index.html`);
  await page.locator('#list[aria-busy="false"]').waitFor();
  assert.equal(await page.locator(`#card-${SULBING_ID}`).count(), 0, '만료된 원본API 쿠폰이 다시 들어와도 표시하지 않는다');
  assert.equal(await page.locator('[data-hot="news:n_verified_sulbing_npay_20261115"]').count(), 0);
});

test('Npay 적립 한도는 즉시 할인 한도로 표기하지 않는다', { timeout: 30000 }, async (t) => {
  const { context, page } = await setup();
  t.after(() => context.close());
  await page.goto(`${site.base}/index.html?c=c_verified_hans_npay_20261112`);
  const card = page.locator('#card-c_verified_hans_npay_20261112');
  await card.locator('.detail:not([hidden])').waitFor();
  const detail = await card.locator('.detail').innerText();
  assert.match(detail, /50000P/);
  assert.doesNotMatch(detail, /50000원 할인/);
  assert.equal(await card.locator('.price b').count(), 0);
});

test('확인한 던킨 공지에는 해당 행사 포스터와 공식 상세 링크가 붙는다', { timeout: 30000 }, async (t) => {
  const { context, page } = await setup();
  t.after(() => context.close());
  await page.goto(`${site.base}/index.html?n=n_verified_dunkin_npay_dubai_20261109`);
  await page.locator('#newsSheet[open]').waitFor();
  const poster = page.locator('#newsBody .news-hero img.ph');
  await poster.evaluate((img) => img.decode());
  assert.equal(await poster.getAttribute('src'), DUBAI_POSTER);
  assert.equal(await page.locator('#newsBody .notice-original').getAttribute('href'), DUBAI_POSTER);
  assert.equal(await page.locator('[data-news-src]').getAttribute('href'), 'https://www.dunkindonuts.co.kr/index.php/event/view?id=5464');
  assert.match(await page.locator('.news-meta').innerText(), /11\/9.*11\/30/);
  assert.match(await page.locator('.img-note').innerText(), /공식 공지 이미지/);
});
