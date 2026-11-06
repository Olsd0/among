// The trial is isolated from franchise coupons. All prices below are test fixtures only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serveDir } from './helpers.js';
import { appCoupon, AC_NOW } from './app-coupon-fixtures.js';

let site, browser;
before(async () => {
  site = await serveDir(new URL('../../web/', import.meta.url).pathname);
  browser = await chromium.launch();
});
after(async () => { if (browser) await browser.close(); if (site) await site.close(); });

const checkedAt = new Date(AC_NOW).toISOString();
function coupon(id, changes = {}) {
  return {
    id, brand: '테스트버거', category: '햄버거', menu: `고른 메뉴 ${id}`, item_type: '단품',
    discount_type: 'price', regular_price: 8000, coupon_price: 4000, discount_rate: 50,
    channels: ['매장'], audience: '전체', programs: [], start_date: null, end_date: null,
    checked_at: checkedAt, first_seen: checkedAt,
    source_url: 'https://example.test/event', official_link: 'https://example.test/event',
    ...changes,
  };
}
// 공개 API(online_deals) 응답 형식. 테스트 전용 값이며 실제 상품이 아니다.
function deal(changes = {}) {
  return {
    id: 'od_browser0001', supplier: 'coupang', store: '쿠팡', title: '테스트 전용 생수', option: '2L · 6개', seller: '테스트 판매자',
    price: 3000, membership: '', conditions: ['테스트 와우회원 조건'], shipping: 'unknown', shippingFee: null, shippingThreshold: null,
    category: 'food', url: 'https://www.coupang.com/vp/products/123', imageUrl: '', affiliate: false, pick: '',
    checkedAt, endsAt: '', visibleUntil: new Date(AC_NOW + 3 * 3600e3).toISOString(), ...changes,
  };
}
const OPTIONAL = /\/online-deals(?:-core)?\.(?:js|css|json)(?:\?|$)|action=online_deals/;

async function setup(t, options = {}) {
  const data = {
    ok: true, last_checked_at: checkedAt,
    coupons: options.coupons || [coupon('one')], news: [],
    app_coupons: [appCoupon({ id: 'legacy-coupon' })], app_coupon_refs: [],
  };
  const context = await browser.newContext({
    viewport: { width: options.width || 390, height: 844 },
    locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block',
  });
  t.after(() => context.close());
  const requests = [], errors = [];
  let feedCalls = 0;
  let releaseModule, moduleSeen, releaseCoupons, couponsSeen;
  const moduleBlocked = new Promise(resolve => { moduleSeen = resolve; });
  const couponsBlocked = new Promise(resolve => { couponsSeen = resolve; });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    requests.push(url.href);
    if (url.origin === site.base && url.pathname.endsWith('/config.js')) {
      return route.fulfill({ contentType: 'text/javascript', body: `window.AMONG_CONFIG = ${JSON.stringify({
        apiUrl: 'https://script.google.com/macros/s/test/exec', contactEmail: '',
        onlineDeals: { enabled: options.enabled !== false, dataUrl: './online-deals.json', goldboxUrl: options.goldboxUrl || '', shortcutLinks: options.shortcutLinks || {} },
      })};` });
    }
    if (options.delayModule && url.origin === site.base && url.pathname.endsWith('/online-deals.js')) {
      await new Promise(resolve => { releaseModule = resolve; moduleSeen(); });
      return route.continue();
    }
    if (url.origin === site.base) return route.continue();
    if (url.hostname === 'script.google.com') {
      const action = request.method() === 'POST' ? JSON.parse(request.postData() || '{}').action : url.searchParams.get('action');
      if (action === 'online_deals') {
        feedCalls++;
        if (feedCalls <= (options.failFeed || 0)) return route.fulfill({ status: 503, body: 'unavailable' });
        return route.fulfill({ json: { ok: true, state: options.state || 'preparing', items: options.items || [] }, headers: { 'access-control-allow-origin': '*' } });
      }
      if (options.delayCoupons && action === 'coupons') await new Promise(resolve => { releaseCoupons = resolve; couponsSeen(); });
      const json = action === 'coupons' ? data : action === 'app_coupons'
        ? { ok: true, app_coupons: data.app_coupons, app_coupon_refs: [] }
        : { ok: true, state: 'idle', last_checked_at: checkedAt };
      return route.fulfill({ json, headers: { 'access-control-allow-origin': '*' } });
    }
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date(AC_NOW));
  await page.addInitScript(seed => {
    localStorage.setItem('among_notrack', 'true');
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, JSON.stringify(value));
  }, options.storage || {});
  return { page, context, requests, errors, feedCalls: () => feedCalls,
    moduleBlocked, releaseModule: () => releaseModule?.(), couponsBlocked, releaseCoupons: () => releaseCoupons?.() };
}

test('online trial loads only on entry and returning restores coupon search, filters, sorting and scroll', { timeout: 30000 }, async t => {
  const prefs = { v: 5, category: '햄버거', kind: '', sort: 'price',
    filters: { itemType: '단품', channel: '매장', everyoneOnly: true, maxPrice: '5000' },
    quick: { mine: true, programsOnly: false, fresh: false, endingSoon: false, saved: false } };
  const profile = { telecom: 'KT', pays: ['네이버페이'], newMember: false };
  const coupons = Array.from({ length: 18 }, (_, i) => coupon(`kept-${i}`, { coupon_price: 3900 + i }));
  coupons.push(coupon('wrong-channel', { channels: ['배달'] }), coupon('over-budget', { coupon_price: 8000 }), coupon('other-menu', { menu: '다른 메뉴' }));
  const { page, requests, errors, feedCalls } = await setup(t, { coupons, storage: {
    among_prefs: prefs, among_profile: profile, among_following: ['테스트버거'],
  } });
  await page.goto(site.base + '/index.html');
  await page.locator('#card-kept-0').waitFor();
  assert.equal(await page.locator('[data-view="all"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await page.locator('#viewNav [data-view]:visible').evaluateAll(nodes => nodes.map(n => n.dataset.view)), ['all', 'brands', 'following', 'onlineDeals']);
  assert.equal(feedCalls(), 0);
  assert.ok(!requests.some(url => OPTIONAL.test(url)), 'optional assets and the online feed must not load with the default coupon view');
  await page.locator('#searchBtn').click();
  await page.locator('#q').fill('고른 메뉴');
  const beforeIds = await page.locator('#list .card').evaluateAll(nodes => nodes.map(n => n.id));
  assert.equal(beforeIds.length, 18);
  const beforeSummary = await page.locator('#summary').innerText();
  await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }));
  const beforeScroll = await page.evaluate(() => window.scrollY);
  assert.ok(beforeScroll >= 500);
  await page.locator('[data-view="onlineDeals"]').click();
  await page.locator('#onlineDeals .od-official-entry').waitFor();
  await page.waitForFunction(() => document.querySelector('#onlineDeals')?.getAttribute('aria-busy') !== 'true');
  assert.equal(feedCalls(), 1);
  assert.equal(await page.locator('#list').isVisible(), false);
  assert.equal(await page.locator('#onlineDeals .od-card').count(), 0);
  assert.equal(await page.locator('#onlineDeals .od-disclosure').isVisible(), false, 'ordinary links must not falsely claim affiliate commission');
  assert.match(await page.locator('#onlineDeals .od-status').innerText(), /아직 올라온 특가가 없어요/, 'honest empty state before any supplier is connected');
  assert.ok(!requests.some(url => /(?:partners\.)?coupang\.com/.test(new URL(url).hostname)), 'viewing the tab makes no advertising or destination-page requests');
  if (process.env.AMONG_QA_SCREENSHOT) await page.screenshot({ path: process.env.AMONG_QA_SCREENSHOT.replace('.png', '-online-empty.png'), fullPage: true });
  await page.locator('[data-view="all"]').click();
  await page.locator('#card-kept-0').waitFor();
  await page.waitForFunction(y => Math.abs(window.scrollY - y) < 3, beforeScroll);
  assert.equal(await page.locator('#q').inputValue(), '고른 메뉴');
  assert.equal(await page.locator('#sortSel').inputValue(), 'price');
  assert.equal(await page.locator('#filterBtn').getAttribute('data-on'), 'true');
  assert.deepEqual(await page.locator('#list .card').evaluateAll(nodes => nodes.map(n => n.id)), beforeIds);
  assert.equal(await page.locator('#summary').innerText(), beforeSummary);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('among_profile'))), profile);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('among_following'))), ['테스트버거']);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('among_prefs'))), prefs);
  await page.locator('[data-view="onlineDeals"]').click();
  await page.locator('#onlineDeals .od-official-entry').waitFor();
  assert.equal(feedCalls(), 1, 'reopening uses already loaded data while rechecking freshness');
  assert.deepEqual(errors, []);
});

test('online feed failure stays in its own panel, retries, and does not disturb franchise coupons', { timeout: 30000 }, async t => {
  const { page, errors, feedCalls } = await setup(t, { failFeed: 1 });
  await page.goto(site.base + '/index.html?view=onlineDeals');
  const panel = page.locator('#onlineDeals');
  await panel.getByRole('button', { name: '다시 불러오기', exact: true }).waitFor();
  assert.equal(await page.locator('#errNote').isVisible(), false);
  assert.equal(await panel.locator('.od-official-entry a').getAttribute('href'), 'https://www.coupang.com/np/goldbox');
  await panel.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#onlineDeals')?.getAttribute('aria-busy') === 'false' && !document.querySelector('#onlineDeals button[data-od-retry]'));
  assert.equal(feedCalls(), 2);
  await page.locator('[data-view="all"]').click();
  await page.locator('#card-one').waitFor();
  assert.equal(await page.locator('#errNote').isVisible(), false);
  assert.equal(await page.locator('#list .card').count(), 1);
  assert.deepEqual(errors, []);
});

test('leaving while the online module is loading does not reopen its panel or fetch its data', { timeout: 30000 }, async t => {
  const { page, errors, feedCalls, moduleBlocked, releaseModule } = await setup(t, { delayModule: true });
  t.after(releaseModule);
  await page.goto(site.base + '/index.html');
  await page.locator('#card-one').waitFor();
  await page.locator('[data-view="onlineDeals"]').click();
  await moduleBlocked;
  await page.locator('[data-view="all"]').click();
  releaseModule();
  await page.locator('#onlineDeals.od-view').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#onlineDeals').isVisible(), false);
  assert.equal(await page.locator('#card-one').isVisible(), true);
  assert.equal(feedCalls(), 0);
  await page.locator('[data-view="onlineDeals"]').click();
  await page.waitForFunction(() => document.querySelector('#onlineDeals')?.getAttribute('aria-busy') === 'false');
  assert.equal(feedCalls(), 1);
  assert.deepEqual(errors, []);
});

test('a delayed coupon response does not reopen an online deep link after the visitor has left it', { timeout: 30000 }, async t => {
  const { page, errors, couponsBlocked, releaseCoupons } = await setup(t, { delayCoupons: true });
  t.after(releaseCoupons);
  await page.goto(site.base + '/index.html?view=onlineDeals');
  await couponsBlocked;
  await page.locator('#onlineDeals .od-official-entry').waitFor();
  await page.locator('[data-view="all"]').click();
  assert.equal(await page.locator('#onlineDeals').isVisible(), false);
  releaseCoupons();
  await page.locator('#card-one').waitFor();
  assert.equal(await page.locator('[data-view="all"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#onlineDeals').isVisible(), false);
  assert.deepEqual(errors, []);
});

test('disabling the trial restores app navigation, and existing app coupon deep links still work when enabled', { timeout: 30000 }, async t => {
  const disabled = await setup(t, { enabled: false });
  await disabled.page.goto(site.base + '/index.html?view=onlineDeals');
  await disabled.page.locator('#card-one').waitFor();
  assert.deepEqual(await disabled.page.locator('#viewNav [data-view]:visible').evaluateAll(nodes => nodes.map(n => n.dataset.view)), ['all', 'appCoupons', 'brands', 'following']);
  assert.equal(await disabled.page.locator('#onlineDeals').isVisible(), false);
  assert.equal(disabled.feedCalls(), 0);
  assert.ok(!disabled.requests.some(url => OPTIONAL.test(url)));
  await disabled.page.locator('[data-view="appCoupons"]').click();
  await disabled.page.locator('.ac-card').waitFor();

  const enabled = await setup(t);
  await enabled.page.goto(site.base + '/index.html?ac=legacy-coupon');
  await enabled.page.locator('#appCouponSheet[open]').waitFor();
  assert.match(await enabled.page.locator('#appCouponSheet').innerText(), /검증용 버거/);
  assert.equal(enabled.feedCalls(), 0);
  assert.deepEqual(disabled.errors, []);
  assert.deepEqual(enabled.errors, []);
});

test('mobile product view identifies affiliate links, preserves factual conditions and stays within the viewport', { timeout: 30000 }, async t => {
  const { page, errors } = await setup(t, { width: 360, state: 'live', items: [deal({ url: 'https://link.coupang.com/a/test-fixture', affiliate: true, membership: '와우회원' })] });
  await page.goto(site.base + '/index.html?view=onlineDeals');
  const card = page.locator('#onlineDeals .od-card');
  await card.waitFor();
  assert.match(await card.innerText(), /2L · 6개/);
  assert.match(await card.innerText(), /3000원/);
  assert.doesNotMatch(await card.innerText(), /3,000원/);
  assert.match(await card.innerText(), /테스트 와우회원 조건/);
  assert.match(await card.innerText(), /와우회원 가격/);
  assert.match(await card.innerText(), /배송비 확인 필요/);
  assert.doesNotMatch(await card.innerText(), /무료배송/);
  const disclosure = page.locator('#onlineDeals .od-disclosure');
  assert.match(await disclosure.innerText(), /쿠팡 파트너스.*수수료/);
  assert.equal(await disclosure.isVisible(), true);
  assert.ok(await disclosure.evaluate(el => !!(el.compareDocumentPosition(document.querySelector('.od-card')) & Node.DOCUMENT_POSITION_FOLLOWING)));
  const cta = card.getByRole('link', { name: /쿠팡에서 가격 확인/ });
  assert.equal(await cta.getAttribute('href'), 'https://link.coupang.com/a/test-fixture');
  assert.match(await cta.getAttribute('rel'), /sponsored/);
  if (process.env.AMONG_QA_SCREENSHOT) await page.screenshot({ path: process.env.AMONG_QA_SCREENSHOT.replace('.png', '-online-product.png'), fullPage: true });
  for (const width of [360, 390, 820]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (process.env.AMONG_QA_SCREENSHOT) await page.screenshot({ path: process.env.AMONG_QA_SCREENSHOT.replace('.png', '-online-dark.png'), fullPage: true });
  assert.deepEqual(errors, []);
});

test('파트너스 골드박스 링크: AMONG ID 링크면 제휴 고지를 맨 위에, 다른 ID 링크는 쓰지 않고 일반 링크로', { timeout: 30000 }, async t => {
  const ours = await setup(t, { goldboxUrl: 'https://link.coupang.com/a/among-goldbox-test' });
  await ours.page.goto(site.base + '/index.html?view=onlineDeals');
  const panel = ours.page.locator('#onlineDeals');
  await panel.locator('.od-official-entry').waitFor();
  await ours.page.waitForFunction(() => document.querySelector('#onlineDeals')?.getAttribute('aria-busy') === 'false');
  const link = panel.locator('.od-official-entry a');
  assert.equal(await link.getAttribute('href'), 'https://link.coupang.com/a/among-goldbox-test');
  assert.match(await link.getAttribute('rel'), /sponsored/);
  assert.match(await panel.locator('.od-official-entry').innerText(), /제휴광고/);
  const disclosure = panel.locator('.od-disclosure');
  assert.equal(await disclosure.isVisible(), true, '상품이 없어도 제휴 링크가 있으면 고지');
  assert.match(await disclosure.innerText(), /^이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다\.$/);
  assert.ok(await disclosure.evaluate(el => !!(el.compareDocumentPosition(document.querySelector('.od-official-entry')) & Node.DOCUMENT_POSITION_FOLLOWING)), '고지가 링크보다 먼저');
  assert.ok(await ours.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (process.env.AMONG_QA_DIR) await ours.page.screenshot({ path: `${process.env.AMONG_QA_DIR}/online-goldbox-affiliate-390.png`, fullPage: true });
  const other = await setup(t, { goldboxUrl: 'https://www.coupang.com/np/goldbox?lptag=AF0000001' });
  await other.page.goto(site.base + '/index.html?view=onlineDeals');
  await other.page.locator('#onlineDeals .od-official-entry').waitFor();
  assert.equal(await other.page.locator('#onlineDeals .od-official-entry a').getAttribute('href'), 'https://www.coupang.com/np/goldbox');
  assert.equal(await other.page.locator('#onlineDeals .od-disclosure').isVisible(), false);
  assert.deepEqual(ours.errors, []);
  assert.deepEqual(other.errors, []);
});

test('항목별로 둘러보기: 골드박스 카드보다 먼저, 고른 상품이 없으면 일반 검색 링크(고지 없음), 제휴 링크가 생기면 고지·sponsored', { timeout: 40000 }, async t => {
  const plain = await setup(t, { width: 320 });
  await plain.page.goto(site.base + '/index.html?view=onlineDeals');
  const panel = plain.page.locator('#onlineDeals');
  await panel.locator('.od-shortcuts').waitFor();
  const links = panel.locator('.od-sc');
  assert.deepEqual((await links.allInnerTexts()).map(x => x.replace(/\s*(쿠팡에서 보기|↗).*$/s, '')), ['생수', '라면', '즉석밥', '냉동 간편식', '레토르트', '닭가슴살', '단백질', '통조림']);
  assert.equal(await panel.locator('.od-sc-group h4').count(), 0, '먹거리 한 묶음뿐이라 묶음 제목 없음');
  assert.equal(await links.first().getAttribute('href'), 'https://www.coupang.com/np/search?q=%EC%83%9D%EC%88%98');
  assert.equal(await links.first().getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await links.first().getAttribute('target'), '_blank');
  assert.ok(await panel.locator('.od-shortcuts').evaluate(el => !!(el.compareDocumentPosition(document.querySelector('.od-official-entry')) & Node.DOCUMENT_POSITION_FOLLOWING)), '항목별 칸이 골드박스 카드보다 먼저');
  assert.equal(await panel.locator('.od-disclosure').isVisible(), false);
  const heights = await links.evaluateAll(els => els.map(e => e.getBoundingClientRect().height));
  assert.ok(heights.every(h => h >= 44), '누르기 쉬운 높이');
  assert.ok(await plain.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '320px 넘침 없음');
  const own = await setup(t, { shortcutLinks: { water: 'https://link.coupang.com/a/among-water' } });
  await own.page.goto(site.base + '/index.html?view=onlineDeals');
  await own.page.locator('#onlineDeals .od-shortcuts').waitFor();
  const water = own.page.locator('#onlineDeals [data-od-shortcut="water"]');
  assert.equal(await water.getAttribute('href'), 'https://link.coupang.com/a/among-water');
  assert.match(await water.getAttribute('rel'), /sponsored/);
  assert.equal(await own.page.locator('#onlineDeals [data-od-shortcut="ramen"]').getAttribute('rel'), 'noopener noreferrer');
  assert.match(await own.page.locator('#onlineDeals .od-shortcuts-head').innerText(), /제휴광고/);
  assert.equal(await own.page.locator('#onlineDeals .od-disclosure').isVisible(), true);
  for (const width of [390, 430, 1280]) {
    await own.page.setViewportSize({ width, height: 900 });
    assert.ok(await own.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px 넘침 없음`);
    if (process.env.AMONG_QA_DIR) await own.page.screenshot({ path: `${process.env.AMONG_QA_DIR}/online-shortcuts-${width}.png`, fullPage: true });
  }
  assert.deepEqual(plain.errors, []);
  assert.deepEqual(own.errors, []);
});

// ---------- 전체 경로 모의 검증: 가짜 공급처 → 실행기 → Apps Script(가짜 환경) → 공개 화면·관리 화면 ----------
import { loadAppsScript } from './gas-harness.js';
import { runOnlineDeals } from '../src/online/run.js';
import { ADAPTERS } from '../src/online/suppliers.js';
import { createHttpClient } from '../src/online/http.js';
import { candidate, mixedBatch, OD_T0, HOUR } from './online-fixtures.js';
import { readFileSync } from 'node:fs';

async function chain(t, { width = 390, batch = mixedBatch(), publish = true, darkMode = false, images = null } = {}) {
  const gas = loadAppsScript(new URL('../../apps-script/Code.gs', import.meta.url).pathname, { now: OD_T0 });
  gas.ctx.setup();
  const token = gas.props.get('COLLECTOR_TOKEN'), admin = gas.props.get('ADMIN_TOKEN');
  const api = { async post(action, payload) { const r = gas.post({ ...payload, action, token }); if (!r.ok) throw new Error(r.error); return r; } };
  const ingest = async items => runOnlineDeals({
    api, env: { COUPANG_PARTNERS_ACCESS_KEY: 'k', COUPANG_PARTNERS_SECRET_KEY: 's' }, now: () => gas.clock.now,
    adapters: { ...ADAPTERS, coupang: { ...ADAPTERS.coupang, apiHosts: ['api.mock.test'], async fetch({ http }) { return { items: (await http.request('https://api.mock.test/deals')).json().items }; } } },
    httpFactory: o => createHttpClient({ ...o, minIntervalMs: 0, fetchImpl: async () => new Response(JSON.stringify({ items })), sleep: async () => {} }),
  });
  await ingest(batch);
  if (publish) gas.post({ action: 'online_admin_set', token: admin, op: 'supplier_mode', supplier: 'coupang', mode: 'publish' });
  const context = await browser.newContext({ viewport: { width, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block', colorScheme: darkMode ? 'dark' : 'light' });
  t.after(() => context.close());
  const posts = [], errors = [], outside = [];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === site.base) return route.continue();
    if (url.hostname === 'script.google.com') {
      const body = req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : null;
      if (body) posts.push(body);
      const result = body ? gas.post(body) : gas.get(Object.fromEntries(url.searchParams));
      return route.fulfill({ json: result, headers: { 'access-control-allow-origin': '*' } });
    }
    outside.push(url.href);
    // 사진 시험: 쿠팡 CDN 주소는 저장소의 아이콘으로 대신 응답 (실제 쿠팡 사진을 받지 않음), 'broken'이 든 주소는 실패
    if (images && /\.coupangcdn\.com$/.test(url.hostname)) return /broken/.test(url.pathname) ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ contentType: 'image/png', body: images });
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date(OD_T0 + 60 * 1000));
  await page.addInitScript(() => localStorage.setItem('among_notrack', 'true'));
  return { gas, admin, page, posts, errors, outside, ingest };
}
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test('전체 경로: 검증을 통과한 상품만 공개 화면에, 제휴 고지가 목록보다 먼저, 배송비를 모르면 무료로 쓰지 않음', { timeout: 40000 }, async t => {
  const { page, errors, outside } = await chain(t);
  await page.goto(site.base + '/index.html?view=onlineDeals');
  const cards = page.locator('#onlineDeals .od-card');
  await cards.first().waitFor();
  assert.deepEqual((await cards.locator('h3').allInnerTexts()).sort(), ['테스트 생수 2L', '테스트 참치 100g 10캔']);
  const waterCard = cards.filter({ hasText: '테스트 생수 2L' }), tunaCard = cards.filter({ hasText: '테스트 참치 100g 10캔' });
  const text = await page.locator('#onlineDeals').innerText();
  for (const held of ['테스트 쌀', '테스트 라면', '테스트 커피', '테스트 냉동고', '테스트 우유']) assert.ok(!text.includes(held), `보류 상품 비공개: ${held}`);
  assert.match(await waterCard.innerText(), /배송비 확인 필요/);
  assert.doesNotMatch(await waterCard.innerText(), /무료배송/);
  assert.match(await tunaCard.innerText(), /무료배송/);
  assert.equal(await page.locator('#onlineDeals .od-card img').count(), 0, '사진 이용 범위 확인 전');
  const disclosure = page.locator('#onlineDeals .od-disclosure');
  assert.match(await disclosure.innerText(), /쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다/);
  assert.ok(await disclosure.evaluate(el => !!(el.compareDocumentPosition(document.querySelector('.od-card')) & Node.DOCUMENT_POSITION_FOLLOWING)));
  assert.match(await waterCard.getByRole('link', { name: /쿠팡에서 가격 확인/ }).getAttribute('rel'), /sponsored/);
  assert.doesNotMatch(text, /최저가|할인율/);
  for (const width of [320, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await noOverflow(page), `${width}px 가로 넘침 없음`);
    if (process.env.AMONG_QA_DIR) await page.screenshot({ path: `${process.env.AMONG_QA_DIR}/online-public-${width}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await noOverflow(page));
  if (process.env.AMONG_QA_DIR) await page.screenshot({ path: `${process.env.AMONG_QA_DIR}/online-public-390-dark.png`, fullPage: true });
  assert.deepEqual(outside.filter(u => !/^https:\/\/cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard@/.test(u)), [], '공급처·광고 주소로 요청하지 않음 (글꼴만 예외)');
  assert.deepEqual(errors, []);
});

test('전체 경로: 재확인 기한이 지난 상품은 새 수집 없이 빠지고, 긴 상품명·조건도 320px 안에', { timeout: 40000 }, async t => {
  const long = candidate({ supplierItemId: 'LONG', title: '아주 긴 테스트 상품명 '.repeat(9).trim(), option: '옵션 설명이 매우 긴 경우 '.repeat(4).trim(),
    conditions: ['조건 문구가 길어도 자르지 않고 그대로 보여 줘야 하는 테스트 조건입니다. '.repeat(4).trim(), '두 번째 조건'], shipping: 'conditional', shippingThreshold: 19800 });
  const { gas, page, errors } = await chain(t, { width: 320, batch: [long] });
  await page.goto(site.base + '/index.html?view=onlineDeals');
  await page.locator('#onlineDeals .od-card').waitFor();
  assert.match(await page.locator('#onlineDeals .od-card').innerText(), /19800원 이상 구매 시 무료배송/);
  assert.match(await page.locator('#onlineDeals .od-card').innerText(), /그대로 보여 줘야 하는 테스트 조건입니다\./);
  assert.ok(await noOverflow(page));
  if (process.env.AMONG_QA_DIR) await page.screenshot({ path: `${process.env.AMONG_QA_DIR}/online-long-320.png`, fullPage: true });
  gas.clock.now = OD_T0 + 6 * HOUR; gas.cache.clear();
  await page.clock.setFixedTime(new Date(OD_T0 + 6 * HOUR));
  await page.reload();
  await page.locator('#onlineDeals .od-status').filter({ hasText: '상품 정보를 다시 확인하고 있어요' }).waitFor();
  assert.equal(await page.locator('#onlineDeals .od-card').count(), 0);
  if (process.env.AMONG_QA_DIR) await page.screenshot({ path: `${process.env.AMONG_QA_DIR}/online-stale-320.png`, fullPage: true });
  assert.deepEqual(errors, []);
});

test('관리 화면: 승인 대기 표시, 보류 사유, 숨김·규칙 저장이 공개 화면에 반영, 좁은 화면에서도 넘치지 않음', { timeout: 60000 }, async t => {
  const { gas, admin, page, posts, errors } = await chain(t, { width: 390 });
  await page.goto(site.base + '/admin.html');
  await page.locator('#token').fill(admin);
  await page.getByRole('button', { name: '불러오기', exact: true }).click();
  const box = page.locator('#onlineDealsManager');
  await box.locator('#odAdminContent').waitFor();
  const sup = await box.locator('.od-supplier').allInnerTexts();
  assert.match(sup[0], /쿠팡[\s\S]*연결됨/, '가짜 공급처로 받은 쿠팡은 연결됨으로 보임 (모의)');
  assert.match(sup[1], /링크프라이스[\s\S]*실행 기록 없음|링크프라이스[\s\S]*승인 대기/);
  assert.match(sup[1], /링크 주소 확인 전/);
  const held = await box.locator('.od-item').allInnerTexts();
  assert.equal(held.length, 5, '기본 목록은 보류');
  assert.ok(held.some(x => /테스트 쌀[\s\S]*상품 실구매가가 아님/.test(x)));
  assert.ok(held.some(x => /테스트 냉동고[\s\S]*분류 규칙에 없는 분류/.test(x)));
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await noOverflow(page), `관리 ${width}px`);
    if (process.env.AMONG_QA_DIR) { await box.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.AMONG_QA_DIR}/online-admin-held-${width}.png`, fullPage: true }); }
  }
  await box.locator('#odFilter').selectOption('published');
  const water = box.locator('.od-item', { hasText: '테스트 생수 2L' });
  await water.locator('[data-od-reason]').fill('설명과 다름');
  await water.getByRole('button', { name: '숨기기', exact: true }).click();
  await box.locator('#odAdminMessage').filter({ hasText: '숨겼어요' }).waitFor();
  assert.deepEqual(gas.get({ action: 'online_deals' }).items.map(i => i.title), ['테스트 참치 100g 10캔']);
  await box.locator('details.od-rules summary').click();
  assert.equal(await box.locator('#odRulesForm input[type=checkbox][disabled]').count(), 1, '생활용품 게시는 끔 (11/06 먹거리만)');
  await box.locator('[name="excludeKeywords"]').fill('주류\n참치');
  await box.getByRole('button', { name: '규칙 저장', exact: true }).click();
  await box.locator('#odAdminMessage').filter({ hasText: '규칙을 저장했어요' }).waitFor();
  assert.equal(gas.get({ action: 'online_deals' }).count, 0);
  const saved = posts.filter(p => p.op === 'rules').at(-1).rules;
  assert.deepEqual(saved.excludeKeywords, ['주류', '참치']);
  assert.deepEqual(saved.includeCategories, ['food']);
  assert.ok(!posts.some(p => p.token && p.action === 'online_deals'), '공개 조회에 토큰 없음');
  assert.deepEqual(errors, []);
});

test('직접 고른 쿠팡 특가: 관리 화면에서 올리면 공개 화면에 쿠폰 모양 카드, 가격 카드는 확인 후 24시간 뒤 내려감', { timeout: 90000 }, async t => {
  const { gas, admin, page, posts, errors } = await chain(t, { width: 390, batch: [], publish: false });
  await page.goto(site.base + '/admin.html');
  await page.locator('#token').fill(admin);
  await page.getByRole('button', { name: '불러오기', exact: true }).click();
  const box = page.locator('#onlineDealsManager');
  await box.locator('#odAdminContent').waitFor();
  const form = box.locator('#odPickForm');
  assert.deepEqual(await form.locator('[name="place"] option').evaluateAll(o => o.map(x => x.value)),
    ['deal:food', 'item:water', 'item:ramen', 'item:rice', 'item:frozen', 'item:retort', 'item:chicken', 'item:protein', 'item:canned'], '11/06 대표 결정: 먹거리만 올릴 곳');
  await form.locator('[name="title"]').fill('테스트 참치 100g 10캔 × 2팩');
  await form.locator('[name="url"]').fill('https://www.coupang.com/vp/products/1');
  await form.locator('[name="place"]').selectOption('deal:food');
  await form.locator('[name="price"]').fill('15,900원');
  await form.locator('[name="note"]').fill('와우회원 가격 · 로켓배송');
  await form.locator('[name="memo"]').fill('에펨코리아 핫딜 11/5');
  await box.getByRole('button', { name: '카드 등록', exact: true }).click();
  await box.locator('#odAdminMessage.bad').filter({ hasText: '간편 링크' }).waitFor();
  assert.equal(await form.locator('[name="title"]').inputValue(), '테스트 참치 100g 10캔 × 2팩', '오류면 입력 유지');
  await form.locator('[name="url"]').fill('https://link.coupang.com/a/testTissue01');
  await box.getByRole('button', { name: '카드 등록', exact: true }).click();
  await box.locator('#odAdminMessage').filter({ hasText: '카드를 올렸어요' }).waitFor();
  assert.equal(await form.locator('[name="title"]').inputValue(), '', '등록하면 입력 칸 비움');
  const row = box.locator('#odPicks [data-pick-id]');
  assert.match(await row.innerText(), /공개 중[\s\S]*테스트 참치[\s\S]*15900원[\s\S]*출처 메모: 에펨코리아 핫딜/);
  assert.equal(posts.filter(p => p.op === 'pick_save').at(-1).pick.price, '15900', '쉼표·원 제거');
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `관리 ${width}px`);
    if (process.env.AMONG_QA_DIR) { await box.locator('.od-picks-admin').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.AMONG_QA_DIR}/online-picks-admin-${width}.png`, fullPage: true }); }
  }
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(site.base + '/index.html?view=onlineDeals');
  const card = page.locator('#onlineDeals .od-pick-card');
  await card.waitFor();
  assert.equal(await card.getAttribute('href'), 'https://link.coupang.com/a/testTissue01');
  assert.equal(await card.getAttribute('rel'), 'sponsored noopener noreferrer');
  assert.equal(await card.getAttribute('target'), '_blank');
  const text = await card.innerText();
  assert.match(text, /15900원/);
  assert.match(text, /확인/);
  assert.match(text, /쿠팡 · 먹거리/);
  assert.match(text, /제휴광고/);
  assert.match(text, /와우회원 가격 · 로켓배송/);
  assert.doesNotMatch(await page.locator('#onlineDeals').innerText(), /에펨코리아|최저가/);
  const disclosure = page.locator('#onlineDeals .od-disclosure');
  assert.equal(await disclosure.isVisible(), true);
  assert.ok(await disclosure.evaluate(el => !!(el.compareDocumentPosition(document.querySelector('.od-pick-card')) & Node.DOCUMENT_POSITION_FOLLOWING)), '고지가 카드보다 먼저');
  assert.ok(await card.evaluate(el => !!(el.compareDocumentPosition(document.querySelector('.od-shortcuts')) & Node.DOCUMENT_POSITION_FOLLOWING)), '카드가 항목별 바로가기보다 먼저');
  assert.equal(await page.locator('#onlineDeals .od-status').isVisible(), false, '카드가 있으면 빈 안내 없음');
  for (const width of [320, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `공개 ${width}px`);
    if (process.env.AMONG_QA_DIR) await page.screenshot({ path: `${process.env.AMONG_QA_DIR}/online-picks-${width}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (process.env.AMONG_QA_DIR) await page.screenshot({ path: `${process.env.AMONG_QA_DIR}/online-picks-390-dark.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });

  // 가격 확인 24시간이 지나면 카드가 내려간다
  gas.clock.now = OD_T0 + 24 * HOUR; gas.cache.clear();
  await page.clock.setFixedTime(new Date(OD_T0 + 24 * HOUR + 60 * 1000));
  await page.reload();
  await page.locator('#onlineDeals .od-status').filter({ hasText: '아직 올라온 특가가 없어요' }).waitFor();
  assert.equal(await card.count(), 0);

  // 관리 화면: 가격 다시 확인 → 숨기기 → 삭제(두 번 눌러야)
  await page.goto(site.base + '/admin.html');
  await page.locator('#token').fill(admin);
  await page.getByRole('button', { name: '불러오기', exact: true }).click();
  await box.locator('#odPicks [data-pick-id]').waitFor();
  assert.match(await box.locator('#odPicks').innerText(), /가격 다시 확인 필요[\s\S]*24시간 지나 공개 화면에서 내려감/);
  await box.getByRole('button', { name: '수정·가격 갱신', exact: true }).click();
  assert.equal(await form.locator('[name="title"]').inputValue(), '테스트 참치 100g 10캔 × 2팩');
  await form.locator('[name="recheck"]').check();
  await box.getByRole('button', { name: '수정 저장', exact: true }).click();
  await box.locator('#odAdminMessage').filter({ hasText: '수정했어요' }).waitFor();
  assert.equal(gas.get({ action: 'online_deals' }).picks[0].price, 15900);
  await box.getByRole('button', { name: '숨기기', exact: true }).click();
  await box.locator('#odAdminMessage').filter({ hasText: '숨겼어요' }).waitFor();
  gas.cache.clear();
  assert.equal(gas.get({ action: 'online_deals' }).picks.length, 0);
  await box.getByRole('button', { name: '삭제', exact: true }).click();
  await box.getByRole('button', { name: '정말 삭제', exact: true }).click();
  await box.locator('#odAdminMessage').filter({ hasText: '삭제했어요' }).waitFor();
  assert.match(await box.locator('#odPicks').innerText(), /아직 올린 카드가 없어요/);
  assert.deepEqual(errors, []);
});

test('자동 후보 → 카드: 관리 화면에서 후보를 골라 간편 링크만 붙이면 카드가 되고, 후보 목록에서 빠짐', { timeout: 90000 }, async t => {
  const { gas, admin, page, errors } = await chain(t, { width: 390, batch: [], publish: false });
  const token = gas.props.get('COLLECTOR_TOKEN');
  gas.post({ action: 'online_leads_ingest', token, leads: [
    { key: 'ruliweb:108726', source: 'ruliweb', title: '[쿠팡]테스트 새우깡 90g 10개 (9,370원/무료)', postUrl: 'https://bbs.ruliweb.com/market/board/1020/read/108726',
      coupangUrl: 'https://www.coupang.com/vp/products/987654', priceHint: 9370, freeShipping: true, postedAt: new Date(OD_T0 - 30 * 60000).toISOString() },
    { key: 'ppomppu:600001', source: 'ppomppu', title: '[쿠팡] 테스트 휴지 (15,900원)', postUrl: 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&no=600001', affiliateOnly: true },
  ] });
  await page.goto(site.base + '/admin.html');
  await page.locator('#token').fill(admin);
  await page.getByRole('button', { name: '불러오기', exact: true }).click();
  const box = page.locator('#onlineDealsManager');
  const leads = box.locator('#odLeads [data-lead-key]');
  await leads.first().waitFor();
  assert.equal(await leads.count(), 2);
  assert.match(await box.locator('#odLeadCount').innerText(), /2개/);
  const shrimp = leads.filter({ hasText: '새우깡' });
  assert.match(await shrimp.innerText(), /루리웹[\s\S]*제목 속 가격 9370원[\s\S]*무료배송 표시/);
  assert.equal(await shrimp.getByRole('link', { name: '쿠팡 상품 열기 ↗' }).getAttribute('href'), 'https://www.coupang.com/vp/products/987654');
  assert.match(await leads.filter({ hasText: '휴지' }).innerText(), /다른 사람의 제휴 링크라 쿠팡에서 상품을 직접 찾아 주세요/);
  if (process.env.AMONG_QA_DIR) { await box.locator('.od-leads').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.AMONG_QA_DIR}/online-leads-admin-390.png`, fullPage: true }); }
  await shrimp.getByRole('button', { name: '이 후보로 카드 만들기', exact: true }).click();
  const form = box.locator('#odPickForm');
  assert.equal(await form.locator('[name="title"]').inputValue(), '테스트 새우깡 90g 10개');
  const before = await form.locator('[name="title"]').inputValue();
  assert.ok(before && !/[/]\s*$/.test(before));
  assert.equal(await form.locator('[name="price"]').inputValue(), '9370');
  assert.match(await form.locator('[name="memo"]').inputValue(), /^루리웹 핫딜 /);
  assert.equal(await page.evaluate(() => document.activeElement?.name), 'html', '파트너스 HTML 칸으로 이동');
  await form.locator('[name="url"]').fill('https://link.coupang.com/a/amongShrimp1');
  await box.getByRole('button', { name: '카드 등록 (후보에서)', exact: true }).click();
  await box.locator('#odAdminMessage').filter({ hasText: '카드를 올렸어요' }).waitFor();
  assert.equal(await leads.count(), 1, '카드로 만든 후보는 빠짐');
  assert.equal(gas.sheet('online_leads').objects().find(x => x.key === 'ruliweb:108726').status, 'used');
  assert.match(await box.locator('#odPicks').innerText(), /테스트 새우깡 90g 10개[\s\S]*9370원/);
  await leads.first().getByRole('button', { name: '지우기', exact: true }).click();
  await box.locator('#odLeads').filter({ hasText: '새 후보가 없어요' }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.goto(site.base + '/index.html?view=onlineDeals');
  const card = page.locator('#onlineDeals .od-pick-card');
  await card.waitFor();
  assert.equal(await card.getAttribute('href'), 'https://link.coupang.com/a/amongShrimp1');
  const text = await page.locator('#onlineDeals').innerText();
  assert.doesNotMatch(text, /루리웹|뽐뿌|게시글/, '후보 출처는 공개 화면에 없음');
  assert.deepEqual(errors, []);
});

test('카드 사진: 파트너스 HTML을 붙이면 링크·사진·상품명이 채워지고, 공개 카드에 사진(비율 그대로)과 가격이 바로 보임 · 항목별 칩 · 사진 실패 시 글자 칸', { timeout: 90000 }, async t => {
  const icon = readFileSync(new URL('../../web/icon-192.png', import.meta.url));
  const { gas, admin, page, errors, outside } = await chain(t, { width: 390, batch: [], publish: false, images: icon });
  // 파트너스 상품 링크 HTML 형식을 흉내 낸 테스트 값 (실제 링크·사진 아님)
  const html = (code, img, alt) => `<a href="https://link.coupang.com/a/${code}" target="_blank" referrerpolicy="unsafe-url"><img src="${img}" alt="${alt}" width="120" height="240"></a>`;
  const banner = name => `https://img5c.coupangcdn.com/image/affiliate/banner/${name}@2x.jpg`;
  await page.goto(site.base + '/admin.html');
  await page.locator('#token').fill(admin);
  await page.getByRole('button', { name: '불러오기', exact: true }).click();
  const box = page.locator('#onlineDealsManager');
  await box.locator('#odAdminContent').waitFor();
  const form = box.locator('#odPickForm');
  const photo = box.locator('.od-pick-photo');
  assert.equal(await photo.isVisible(), false);
  // 1) HTML 칸에 붙여 넣기 → 링크·사진·상품명
  await form.locator('[name="html"]').fill(html('testShrimp01', banner('shrimp'), '테스트 새우깡, 90g, 10개 &amp; 증정'));
  await box.locator('#odAdminMessage').filter({ hasText: '링크·사진·상품명을 채웠어요' }).waitFor();
  assert.equal(await form.locator('[name="url"]').inputValue(), 'https://link.coupang.com/a/testShrimp01');
  assert.equal(await form.locator('[name="title"]').inputValue(), '테스트 새우깡, 90g, 10개 & 증정');
  assert.equal(await photo.isVisible(), true);
  assert.equal(await photo.locator('img').getAttribute('src'), banner('shrimp'));
  await page.waitForFunction(() => document.querySelector('.od-pick-photo img')?.naturalWidth > 0);
  if (process.env.AMONG_QA_DIR) { await form.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.AMONG_QA_DIR}/online-pick-html-admin-390.png`, fullPage: true }); }
  await form.locator('[name="price"]').fill('9370');
  await form.locator('[name="note"]').fill('로켓배송');
  await box.getByRole('button', { name: '카드 등록', exact: true }).click();
  await box.locator('#odAdminMessage').filter({ hasText: '카드를 올렸어요' }).waitFor();
  assert.equal(await photo.isVisible(), false, '등록하면 사진 미리보기도 비움');
  assert.equal(gas.sheet('online_picks').objects()[0].image_url, banner('shrimp'), '시트에는 사진 주소만 (파일 저장 안 함)');
  // 2) 상품 페이지 사진이 든 HTML은 링크만 받고 사진은 거절 — 링크 칸에 통째로 붙여 넣어도 같은 방식
  await form.locator('[name="url"]').fill(html('testTuna0002', 'https://thumbnail6.coupangcdn.com/thumbnails/remote/230x230ex/image/retail/a.jpg', '테스트 참치 100g 10캔'));
  await box.locator('#odAdminMessage').filter({ hasText: '사진은 넣지 않았어요' }).waitFor();
  assert.equal(await form.locator('[name="url"]').inputValue(), 'https://link.coupang.com/a/testTuna0002');
  assert.equal(await photo.isVisible(), false);
  await form.locator('[name="place"]').selectOption('deal:food');
  await form.locator('[name="price"]').fill('15900');
  await box.getByRole('button', { name: '카드 등록', exact: true }).click();
  await box.locator('#odAdminMessage').filter({ hasText: '카드를 올렸어요' }).waitFor();
  // 3) 사진을 못 불러오는 카드
  await form.locator('[name="html"]').fill(html('testRice0003', banner('broken'), '테스트 즉석밥 24개'));
  await box.locator('#odAdminMessage').filter({ hasText: '링크·사진·상품명을 채웠어요' }).waitFor();
  await form.locator('[name="price"]').fill('21900');
  await box.getByRole('button', { name: '카드 등록', exact: true }).click();
  await box.locator('#odAdminMessage').filter({ hasText: '카드를 올렸어요' }).waitFor();
  assert.equal(await box.locator('#odPicks .od-pick-thumb').count(), 2, '관리 목록에 사진 미리보기');
  assert.match(await box.locator('#odPicks').innerText(), /사진 없음/);
  assert.ok(await noOverflow(page));

  await page.goto(site.base + '/index.html?view=onlineDeals');
  const cards = page.locator('#onlineDeals .od-pick-card');
  await cards.nth(2).waitFor();
  assert.equal(await cards.count(), 3);
  const shrimp = cards.filter({ hasText: '테스트 새우깡' });
  assert.equal(await shrimp.getAttribute('href'), 'https://link.coupang.com/a/testShrimp01');
  const img = shrimp.locator('img.od-ph');
  await page.waitForFunction(() => document.querySelector('#onlineDeals .od-ph')?.naturalWidth > 0);
  const geo = await img.evaluate(el => ({ ratio: el.getBoundingClientRect().height / el.getBoundingClientRect().width, natural: el.naturalHeight / el.naturalWidth, fit: getComputedStyle(el).objectFit, alt: el.alt, ref: el.referrerPolicy }));
  assert.ok(Math.abs(geo.ratio - geo.natural) < 0.03, `사진 비율 그대로 ${JSON.stringify(geo)}`);
  assert.notEqual(geo.fit, 'cover', '자르지 않음');
  assert.equal(geo.ref, 'no-referrer');
  const shrimpText = await shrimp.innerText();
  assert.match(shrimpText, /9370원/); assert.match(shrimpText, /확인 당시 가격/); assert.match(shrimpText, /쿠팡 · 먹거리/); assert.match(shrimpText, /제휴광고/);
  const firstBox = await shrimp.boundingBox();
  assert.ok(firstBox.y + firstBox.height <= 844, '첫 카드(사진·가격)가 첫 화면 안에 보임');
  assert.equal(await shrimp.locator('.ticket').count(), 1, '메인 쿠폰과 같은 티켓');
  // 사진 거절된 카드·사진 실패 카드는 글자 칸 (사진 대신 '쿠팡 · 항목')
  assert.equal(await cards.filter({ hasText: '테스트 참치' }).locator('img').count(), 0);
  const rice = cards.filter({ hasText: '테스트 즉석밥' });
  await page.waitForFunction(() => [...document.querySelectorAll('#onlineDeals .od-pick-card')].find(c => c.textContent.includes('테스트 즉석밥'))?.querySelector('img') === null);
  assert.match(await rice.locator('.stub').innerText(), /쿠팡\s*먹거리/);
  // 분류 칩: 11/06부터 먹거리만 공개라 분류가 하나뿐 → 칩 없음
  assert.equal(await page.locator('#onlineDeals .od-cats [data-od-cat]').count(), 0);
  assert.equal(await cards.count(), 3);
  for (const width of [320, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await noOverflow(page), `공개 ${width}px`);
    if (process.env.AMONG_QA_DIR) await page.screenshot({ path: `${process.env.AMONG_QA_DIR}/online-pick-photo-${width}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (process.env.AMONG_QA_DIR) await page.screenshot({ path: `${process.env.AMONG_QA_DIR}/online-pick-photo-390-dark.png`, fullPage: true });
  // 기존 글꼴(cdn.jsdelivr.net) 외에 새로 생긴 외부 요청은 쿠팡 파트너스 사진뿐 (광고·추적 스크립트 없음)
  assert.ok(outside.filter(u => !u.startsWith('https://cdn.jsdelivr.net/')).every(u => /^https:\/\/img5c\.coupangcdn\.com\/image\/affiliate\//.test(u)), `쿠팡 파트너스 사진 외 외부 요청 없음: ${outside.join(', ')}`);
  assert.deepEqual(errors, []);
});

// 11/06 08:14 대표 요청: 항목별에서도 상품을 띄워 달라
test('항목별 상품: 파트너스 HTML 여러 개를 한 번에 붙여 올리면 공개 화면 항목 탭에 사진·가격 카드, 24시간 뒤에는 가격만 빠지고 카드는 남음', { timeout: 90000 }, async t => {
  const icon = readFileSync(new URL('../../web/icon-192.png', import.meta.url));
  const { gas, admin, page, errors, outside } = await chain(t, { width: 390, batch: [], publish: false, images: icon });
  // 파트너스 상품 링크 HTML 형식을 흉내 낸 테스트 값 (실제 링크·사진 아님)
  const html = (code, alt) => `<a href="https://link.coupang.com/a/${code}" target="_blank" referrerpolicy="unsafe-url"><img src="https://img5c.coupangcdn.com/image/affiliate/banner/${code}@2x.jpg" alt="${alt}" width="120" height="240"></a>`;
  await page.goto(site.base + '/admin.html');
  await page.locator('#token').fill(admin);
  await page.getByRole('button', { name: '불러오기', exact: true }).click();
  const box = page.locator('#onlineDealsManager');
  await box.locator('#odAdminContent').waitFor();
  const pasted = [html('itemWater01', '테스트 삼다수 2L, 12개'), html('itemRamen01', '테스트 신라면 120g, 5개'), html('itemChick01', '테스트 닭가슴살 100g, 10팩'),
    html('itemSnack01', '테스트 간식 모음'), html('itemWater01', '같은 링크 두 번'), '<a href="https://example.com/x"><img src="https://example.com/a.jpg" alt="다른 사이트"></a>'].join('\n');
  await box.locator('#odBulkHtml').fill(pasted);
  await box.locator('#odAdminMessage').filter({ hasText: 'HTML 6개 중 4개를 읽었어요' }).waitFor();
  const rows = box.locator('.od-bulk-row');
  assert.equal(await rows.count(), 4);
  assert.deepEqual(await rows.locator('[data-bulk-place]').evaluateAll(els => els.map(e => e.value)), ['item:water', 'item:ramen', 'item:chicken', ''], '상품명으로 항목 짐작');
  await box.getByRole('button', { name: '모두 등록', exact: true }).click();
  await box.locator('#odAdminMessage').filter({ hasText: '4번 상품의 올릴 곳을 골라 주세요' }).waitFor();
  assert.equal(gas.sheet('online_picks').objects().length, 0);
  await rows.nth(3).locator('[data-bulk-place]').selectOption('deal:food');
  await rows.nth(0).locator('[data-bulk-price]').fill('9,900원');
  await rows.nth(1).locator('[data-bulk-title]').fill('테스트 신라면 멀티팩');
  await rows.nth(2).locator('[data-bulk-remove]').click();
  assert.equal(await rows.count(), 3);
  if (process.env.AMONG_QA_DIR) { await box.locator('.od-bulk').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.AMONG_QA_DIR}/online-items-bulk-admin-390.png`, fullPage: true }); }
  assert.ok(await noOverflow(page), '관리 화면 390px');
  await box.getByRole('button', { name: '모두 등록', exact: true }).click();
  await box.locator('#odAdminMessage').filter({ hasText: '3개를 올렸어요' }).waitFor();
  assert.equal(await rows.count(), 0, '등록하면 비움');
  assert.equal(await box.locator('#odBulkHtml').inputValue(), '');
  const saved = gas.sheet('online_picks').objects();
  assert.deepEqual(saved.map(x => [x.title, x.item, x.category, String(x.price)]).sort(), [['테스트 간식 모음', '', 'food', ''], ['테스트 삼다수 2L, 12개', 'water', 'food', '9900'], ['테스트 신라면 멀티팩', 'ramen', 'food', '']].sort());
  assert.match(await box.locator('#odPicks').innerText(), /항목별 · 생수/);

  await page.goto(site.base + '/index.html?view=onlineDeals');
  const panel = page.locator('#onlineDeals');
  const section = panel.locator('.od-shortcuts');
  await section.locator('.od-item-tabs').waitFor();
  assert.match(await section.locator('h3').innerText(), /항목별로 둘러보기/);
  assert.match(await section.locator('.od-shortcuts-head').innerText(), /제휴광고/);
  const tabs = section.locator('[data-od-item]');
  assert.deepEqual((await tabs.allInnerTexts()).map(x => x.replace(/\s+/g, ' ')), ['생수 1', '라면 1', '즉석밥', '냉동 간편식', '레토르트', '닭가슴살', '단백질', '통조림']);
  assert.equal(await section.locator('[data-od-item="water"]').getAttribute('aria-pressed'), 'true', '상품이 있는 첫 항목을 먼저');
  const card = section.locator('.od-item-list .od-pick-card');
  assert.equal(await card.count(), 1);
  assert.equal(await card.getAttribute('href'), 'https://link.coupang.com/a/itemWater01');
  assert.equal(await card.getAttribute('rel'), 'sponsored noopener noreferrer');
  const waterText = await card.innerText();
  assert.match(waterText, /쿠팡 · 생수/); assert.match(waterText, /9900원/); assert.match(waterText, /확인 당시 가격/);
  await page.waitForFunction(() => document.querySelector('#onlineDeals .od-item-list .od-ph')?.naturalWidth > 0);
  assert.equal(await section.locator('.od-item-more').getAttribute('href'), 'https://www.coupang.com/np/search?q=%EC%83%9D%EC%88%98');
  assert.match(await section.locator('.od-item-more').innerText(), /쿠팡에서 생수 더 보기/);
  await section.locator('[data-od-item="ramen"]').click();
  assert.match(await card.innerText(), /테스트 신라면 멀티팩[\s\S]*가격은 쿠팡에서 확인/);
  await section.locator('[data-od-item="rice"]').click();
  assert.equal(await card.count(), 0);
  assert.match(await section.locator('.od-item-empty').innerText(), /즉석밥은\(는\) 아직 고른 상품이 없어요/);
  assert.match(await section.locator('.od-item-more').getAttribute('href'), /q=%EC%A6%89%EC%84%9D%EB%B0%A5$/);
  // 위쪽 특가 목록에는 특가로 올린 카드만
  assert.deepEqual(await panel.locator('.od-picks > .od-picks-list > li .menu').allInnerTexts(), ['테스트 간식 모음']);
  assert.ok(await section.evaluate(el => !!(el.compareDocumentPosition(document.querySelector('.od-official-entry')) & Node.DOCUMENT_POSITION_FOLLOWING)), '항목별 칸이 골드박스보다 먼저');
  await section.locator('[data-od-item="water"]').click();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await noOverflow(page), `공개 ${width}px`);
    if (process.env.AMONG_QA_DIR) await page.screenshot({ path: `${process.env.AMONG_QA_DIR}/online-items-${width}.png`, fullPage: true });
  }
  // 24시간 뒤: 생수 카드는 남고 가격만 빠짐, 가격 없이 올린 특가는 하루 노출이 끝나 내려감
  gas.clock.now = OD_T0 + 25 * HOUR; gas.cache.clear();
  await page.clock.setFixedTime(new Date(OD_T0 + 25 * HOUR));
  await page.reload();
  await section.locator('.od-item-tabs').waitFor();
  const after = await section.locator('.od-item-list .od-pick-card').innerText();
  assert.match(after, /테스트 삼다수/); assert.match(after, /가격은 쿠팡에서 확인/); assert.doesNotMatch(after, /9900원/);
  assert.equal(await panel.locator('.od-picks > .od-picks-list > li').count(), 0);
  assert.match(await panel.locator('.od-status').innerText(), /아래 항목별 상품을 둘러보세요/);
  assert.ok(outside.filter(u => !u.startsWith('https://cdn.jsdelivr.net/')).every(u => /^https:\/\/img5c\.coupangcdn\.com\/image\/affiliate\//.test(u)), outside.join(', '));
  assert.deepEqual(errors, []);
});

test('30일 최저·최저 알림: 기록 3일부터 표시, 알림을 켠 상품이 30일 최저가 되면 첫 화면 배너, 보면 다시 뜨지 않음, 알림은 이 기기에만', { timeout: 90000 }, async t => {
  const { gas, admin, page, errors } = await chain(t, { width: 390, batch: [], publish: false });
  const DAY = 24 * HOUR;
  const set = body => { const r = gas.post({ action: 'online_admin_set', token: admin, ...body }); assert.equal(r.ok, true, r.error); return r; };
  const later = async ms => { gas.clock.now += ms; gas.cache.clear(); await page.clock.setFixedTime(new Date(gas.clock.now + 60 * 1000)); };
  const water = set({ op: 'pick_save', pick: { title: '테스트 생수 2L 12개', url: 'https://link.coupang.com/a/lowWater01', item: 'water', price: '6000' } }).picks[0];
  await later(DAY);
  set({ op: 'pick_prices', prices: [{ id: water.id, price: 5900 }] });
  await page.goto(site.base + '/index.html?view=onlineDeals');
  const panel = page.locator('#onlineDeals');
  const card = panel.locator('.od-item-list .od-pick-li');
  await card.waitFor();
  assert.doesNotMatch(await card.innerText(), /30일 최저/, '기록 2일: 아직 표시 안 함');
  const bell = card.locator('[data-od-watch]');
  assert.equal(await bell.getAttribute('aria-pressed'), 'false');
  assert.match(await bell.innerText(), /최저 알림/);
  await bell.click();
  assert.equal(await bell.getAttribute('aria-pressed'), 'true');
  assert.match(await bell.innerText(), /알림 중/);
  assert.ok(await bell.evaluate(el => el === document.activeElement), '다시 그린 뒤에도 같은 버튼에 초점');
  assert.match(await panel.locator('.od-watch-live').innerText(), /최저 알림을 켰어요/);
  const watchBox = panel.locator('.od-watch-section');
  assert.equal(await watchBox.isVisible(), true);
  assert.deepEqual(await watchBox.locator('.menu').allInnerTexts(), ['테스트 생수 2L 12개']);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('among_price_watch')));
  assert.deepEqual(stored.map(w => w.id), [water.id]);
  assert.deepEqual(Object.keys(stored[0]).sort(), ['at', 'id', 't'], '이 기기에는 카드 번호·상품명·켠 시각만');
  // 다음 날 가격이 내려가 30일 최저가 됨 → 첫 화면 배너
  await later(DAY);
  set({ op: 'pick_prices', prices: [{ id: water.id, price: 5690 }] });
  await page.goto(site.base + '/index.html');
  const banner = page.locator('#watchBanner');
  await banner.waitFor();
  assert.match(await banner.innerText(), /알림을 켠 상품이 30일 최저예요[\s\S]*테스트 생수 2L 12개/);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await noOverflow(page), `배너 ${width}px`);
    if (process.env.AMONG_QA_DIR) await page.screenshot({ path: `${process.env.AMONG_QA_DIR}/price-watch-banner-${width}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await banner.getByRole('button', { name: '보기' }).click();
  await watchBox.waitFor();
  const low = watchBox.locator('.od-pick-li');
  const lowText = await low.innerText();
  assert.match(lowText, /5690원[\s\S]*30일 최저/);
  assert.match(lowText, /AMONG 확인 30일 최저 5690원 \(3일 기록\)/);
  assert.doesNotMatch(await panel.innerText(), /최저가|역대가|할인율/);
  assert.ok(await noOverflow(page));
  if (process.env.AMONG_QA_DIR) { await watchBox.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.AMONG_QA_DIR}/price-watch-390.png`, fullPage: true }); }
  // 본 뒤에는 같은 가격으로 다시 알리지 않음
  await page.goto(site.base + '/index.html');
  await page.waitForResponse(r => /script\.google\.com/.test(r.url()) && /online_deals/.test(r.url()));
  await page.waitForTimeout(500);
  assert.equal(await banner.isVisible(), false, '본 최저는 다시 알리지 않음');
  // 알림 끄기 → 알림 목록이 사라짐
  await page.goto(site.base + '/index.html?view=onlineDeals');
  await watchBox.waitFor();
  await watchBox.locator('[data-od-watch]').click();
  assert.equal(await watchBox.isVisible(), false);
  assert.equal(await card.locator('[data-od-watch]').getAttribute('aria-pressed'), 'false');
  assert.ok(await card.locator('[data-od-watch]').evaluate(el => el === document.activeElement), '알림 목록에서 끄면 본 목록 버튼으로 초점');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('among_price_watch') || '[]')), []);
  assert.deepEqual(errors, []);
});
