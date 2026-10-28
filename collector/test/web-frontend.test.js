// 모바일 화면에서 실제로 보이는 최신성 안내, 재시도, 키보드와 초기 표시를 검증한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import { serveDir } from './helpers.js';

let site, browser;
before(async () => {
  site = await serveDir(new URL('../../web/', import.meta.url).pathname);
  browser = await chromium.launch();
});
after(async () => { if (browser) await browser.close(); if (site) await site.close(); });

const ago = (hours) => new Date(Date.now() - hours * 3600e3).toISOString();
function coupon(id, checkedAt = ago(1)) {
  return { id, brand: '테스트버거', category: '햄버거', menu: `테스트 혜택 ${id}`, item_type: '단품',
    discount_type: 'price', regular_price: 8000, coupon_price: 5000, discount_rate: 38,
    channels: ['매장'], audience: '전체', programs: [], start_date: null, end_date: null,
    checked_at: checkedAt, first_seen: ago(1), source_url: 'https://example.test/event', official_link: 'https://example.test/event' };
}
function news(id, checkedAt) {
  return { id, brand: '테스트버거', category: '햄버거', title: `테스트 행사 ${id}`, summary: '할인 행사',
    discount_label: '40%', programs: [], checked_at: checkedAt, first_seen: ago(1), end_date: new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10),
    source_url: 'https://example.test/event', related_ids: [] };
}
async function setup(data, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
  const page = await context.newPage();
  let couponCalls = 0;
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
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
  return { context, page };
}

test('일부 출처가 오래됐으면 경고와 카드 표시를 보이고 최신 핫딜만 추천한다', { timeout: 30000 }, async (t) => {
  const data = { ok: true, last_checked_at: ago(1), coupons: [coupon('fresh'), coupon('old', ago(72))],
    news: [news('fresh', ago(1)), news('old', ago(72))] };
  const { context, page } = await setup(data);
  t.after(() => context.close());
  await page.goto(`${site.base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#list .card').first().waitFor();
  assert.match(await page.locator('#errNote').innerText(), /일부 혜택/);
  assert.match(await page.locator('#card-old').innerText(), /출처 재확인 필요/);
  assert.doesNotMatch(await page.locator('#card-fresh').innerText(), /출처 재확인 필요/);
  assert.match(await page.locator('#hotRail').innerText(), /테스트 행사 fresh/);
  assert.doesNotMatch(await page.locator('#hotRail').innerText(), /테스트 행사 old/);

  // 링크의 Enter는 바깥 카드의 키보드 핸들러에 가로채이지 않는다.
  const link = page.locator('#card-fresh a.cta');
  await link.focus();
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('Enter')]);
  await popup.waitForLoadState('domcontentloaded');
  assert.equal(new URL(popup.url()).hostname, 'example.test');
  assert.equal(await page.locator('#card-fresh .body').getAttribute('aria-expanded'), 'false');
});

test('연결 실패 시 저장본임을 알리고, 저장본이 없으면 다시 불러올 수 있다', { timeout: 30000 }, async (t) => {
  const data = { ok: true, last_checked_at: ago(1), coupons: [coupon('available')], news: [] };
  const first = await setup(data, { failCoupons: 1, cache: { ...data, last_checked_at: ago(72), coupons: [coupon('cached', ago(72))] } });
  t.after(() => first.context.close());
  await first.page.goto(`${site.base}/index.html`, { waitUntil: 'domcontentloaded' });
  await first.page.locator('#card-cached').waitFor();
  await first.page.getByText(/연결이 불안정해/).waitFor();
  assert.match(await first.page.locator('#card-cached').innerText(), /출처 재확인 필요/);

  const second = await setup(data, { failCoupons: 1 });
  t.after(() => second.context.close());
  await second.page.goto(`${site.base}/index.html`, { waitUntil: 'domcontentloaded' });
  await second.page.getByRole('button', { name: '다시 불러오기' }).click();
  await second.page.locator('#card-available').waitFor();
  assert.equal(await second.page.locator('#errNote').isHidden(), true);
});

test('120개 혜택의 첫 표시와 검색이 모바일 화면에서 동작한다', { timeout: 30000 }, async (t) => {
  const data = { ok: true, last_checked_at: ago(1), coupons: Array.from({ length: 120 }, (_, i) => coupon(String(i))), news: [] };
  const { context, page } = await setup(data);
  t.after(() => context.close());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const started = performance.now();
  await page.goto(`${site.base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#card-119').waitFor();
  const elapsed = Math.round(performance.now() - started);
  assert.equal(await page.locator('#list .card').count(), 120);
  await page.getByRole('button', { name: '메뉴 검색' }).click();
  await page.getByRole('searchbox', { name: '메뉴·브랜드 검색' }).fill('혜택 113');
  assert.equal(await page.locator('#list .card').count(), 1);
  assert.deepEqual(errors, []);
  t.diagnostic(`모의 API, 외부 이미지·글꼴 제외: 120개 첫 표시 ${elapsed}ms`);
});
