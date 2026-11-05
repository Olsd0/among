// 메인 메뉴 / 사이드메뉴 전환 (11/05 대표 요청: 사이드가 섞여 보기 불편)
// 아래 혜택·브랜드는 모두 가상 데이터이며 실제 사이트에 게시되지 않는다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serveDir } from './helpers.js';

let site, browser;
before(async () => {
  site = await serveDir(new URL('../../web/', import.meta.url).pathname);
  browser = await chromium.launch();
});
after(async () => { if (browser) await browser.close(); if (site) await site.close(); });

const now = new Date(Date.now() - 3600e3).toISOString();
const plus = (d) => new Date(Date.now() + d * 864e5 + 9 * 3600e3).toISOString().slice(0, 10);
const c = (id, fields) => ({
  id, brand: '가상버거', category: '햄버거', menu: id, item_type: '단품', discount_type: 'price', regular_price: 3000, coupon_price: 1500,
  discount_rate: 50, discount_value: null, channels: ['매장', '픽업'], audience: '전체', programs: [], app_only: false, start_date: null, end_date: plus(20),
  checked_at: now, first_seen: now, source_url: 'https://example.test/event', official_link: 'https://example.test/event', ...fields,
});
const COUPONS = [
  c('burger', { menu: '가상 불고기 버거' }),
  c('set', { menu: '가상 불고기 버거 세트', item_type: '세트', coupon_price: 4900 }),
  c('nugget', { menu: '가상 너겟 4조각' }),
  c('coke', { menu: '코카-콜라 M', coupon_price: 1000 }),
  c('pizza', { brand: '가상피자', category: '피자', menu: '가상 슈프림 피자 L', coupon_price: 15000 }),
  c('pasta', { brand: '가상피자', category: '피자', menu: '가상 치즈 오븐 파스타', coupon_price: 4900 }),
  c('latte', { brand: '가상카페', category: '카페', menu: '가상 카페라떼', coupon_price: 2500 }),
  c('allmenu', { menu: '전 메뉴', discount_type: 'percent', coupon_price: null, discount_value: 10, discount_rate: 10 }),
];

async function setup(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: options.width || 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block', colorScheme: options.colorScheme || 'light' });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [], events = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === site.base) return route.continue();
    if (url.hostname === 'script.google.com') {
      if (req.method() === 'POST') { try { events.push(JSON.parse(req.postData() || '{}')); } catch { /* 무시 */ } return route.fulfill({ json: { ok: true }, headers: { 'access-control-allow-origin': '*' } }); }
      if (url.searchParams.get('action') === 'coupons') return route.fulfill({ json: { ok: true, last_checked_at: now, coupons: COUPONS, news: [] }, headers: { 'access-control-allow-origin': '*' } });
      return route.fulfill({ json: { ok: true, state: 'idle', last_checked_at: now }, headers: { 'access-control-allow-origin': '*' } });
    }
    return route.abort();
  });
  await page.goto(`${site.base}/index.html${options.query || ''}`);
  await page.locator('#list .card').first().waitFor();
  return { page, errors, events };
}
const ids = (page) => page.locator('#list .card').evaluateAll((els) => els.map((e) => e.dataset.id).sort());
const tab = (page, name) => page.locator('#menuType').getByRole('button', { name: new RegExp(`^${name}`) });

test('기본은 메인 메뉴만, 사이드메뉴를 누르면 사이드만 — 개수·제목·저장', { timeout: 40000 }, async (t) => {
  const { page, errors, events } = await setup(t);
  assert.deepEqual(await ids(page), ['allmenu', 'burger', 'latte', 'pizza', 'set']);
  assert.equal(await tab(page, '메인 메뉴').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('#menuType').innerText(), /메인 메뉴\s*5\s*사이드메뉴\s*3/);
  assert.equal(await page.locator('#listTitle').innerText(), '전체 혜택');
  await tab(page, '사이드메뉴').click();
  assert.deepEqual(await ids(page), ['coke', 'nugget', 'pasta']);
  assert.equal(await page.locator('#listTitle').innerText(), '사이드메뉴 혜택');
  assert.match(await page.locator('#grid [data-cat="햄버거"] .n').innerText(), /^2$/, '아이콘 숫자도 사이드 기준');
  await page.locator('#grid [data-cat="피자"]').click();
  assert.deepEqual(await ids(page), ['pasta']);
  assert.equal(await page.locator('#listTitle').innerText(), '피자 · 사이드메뉴 혜택');
  assert.ok(events.some((e) => e.type === 'filter' && e.value === 'menu:side'));
  await page.reload();
  await page.locator('#list .card').first().waitFor();
  assert.equal(await tab(page, '사이드메뉴').getAttribute('aria-pressed'), 'true', '다시 열어도 유지');
  assert.deepEqual(await ids(page), ['pasta']);
  await page.locator('#grid [data-cat="카페"]').click();
  await page.locator('#list .empty').filter({ hasText: '사이드메뉴에는 맞는 혜택이 없어요' }).waitFor();
  await page.locator('#list').getByRole('button', { name: '메인 메뉴 보기' }).click();
  assert.deepEqual(await ids(page), ['latte']);
  assert.equal(await page.locator('#menuType').isHidden(), true, '카페는 사이드가 없어 전환 줄을 숨김');
  assert.deepEqual(errors, []);
});

test('검색어가 다른 쪽에만 있으면 안내하고, 사이드 쿠폰 공유 주소는 사이드메뉴로 연다', { timeout: 40000 }, async (t) => {
  const { page, errors } = await setup(t);
  await page.locator('#searchBtn').click();
  await page.locator('#q').fill('콜라');
  await page.locator('#list .empty').filter({ hasText: '메인 메뉴에는 맞는 혜택이 없어요' }).waitFor();
  assert.match(await page.locator('#list .empty').innerText(), /사이드메뉴에 1개 있어요/);
  await page.locator('#list').getByRole('button', { name: '사이드메뉴 보기' }).click();
  assert.deepEqual(await ids(page), ['coke']);
  const shared = await setup(t, { query: '?c=nugget' });
  await shared.page.locator('#card-nugget').waitFor();
  assert.equal(await tab(shared.page, '사이드메뉴').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(errors, []);
  assert.deepEqual(shared.errors, []);
});

test('320·390·430·1280, 밝은·어두운 화면에서 넘치지 않고 키보드로 바꿀 수 있다', { timeout: 60000 }, async (t) => {
  for (const colorScheme of ['light', 'dark']) {
    for (const width of [320, 390, 430, 1280]) {
      const { page, errors } = await setup(t, { width, colorScheme });
      const box = await page.locator('#menuType').boundingBox();
      assert.ok(box && box.width <= Math.min(width - 24, 420) + 0.5, `${width}px 폭 안`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px ${colorScheme} 가로 넘침 없음`);
      const heights = await page.locator('#menuType .menu-btn').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      assert.ok(heights.every((h) => h >= 40), '누르기 쉬운 높이');
      if (width === 390) {
        await tab(page, '사이드메뉴').focus();
        await page.keyboard.press('Enter');
        assert.deepEqual(await ids(page), ['coke', 'nugget', 'pasta']);
        if (process.env.AMONG_QA_DIR) await page.screenshot({ path: `${process.env.AMONG_QA_DIR}/side-menu-${width}-${colorScheme}.png` });
      }
      assert.deepEqual(errors, []);
    }
  }
});
