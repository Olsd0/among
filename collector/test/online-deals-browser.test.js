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
function deal(changes = {}) {
  return {
    id: 'browser-fixture', title: '테스트 전용 생수', unit: '2L · 6개', price: 3000,
    conditions: ['테스트 와우회원 조건', '배송비는 쿠팡에서 확인'],
    checkedAt, expiresAt: '2026-10-30T03:00:00.000Z',
    url: 'https://www.coupang.com/vp/products/123',
    sourceUrl: 'https://www.coupang.com/vp/products/123', affiliate: false,
    imageUrl: '', category: 'food', ...changes,
  };
}

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
        onlineDeals: { enabled: options.enabled !== false, dataUrl: './online-deals.json' },
      })};` });
    }
    if (url.origin === site.base && url.pathname.endsWith('/online-deals.json')) {
      feedCalls++;
      if (feedCalls <= (options.failFeed || 0)) return route.fulfill({ status: 503, body: 'unavailable' });
      return route.fulfill({ json: { updatedAt: checkedAt, items: options.items || [] } });
    }
    if (options.delayModule && url.origin === site.base && url.pathname.endsWith('/online-deals.js')) {
      await new Promise(resolve => { releaseModule = resolve; moduleSeen(); });
      return route.continue();
    }
    if (url.origin === site.base) return route.continue();
    if (url.hostname === 'script.google.com') {
      const action = request.method() === 'POST' ? JSON.parse(request.postData() || '{}').action : url.searchParams.get('action');
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
  assert.ok(!requests.some(url => /\/online-deals\.(?:js|css|json)(?:\?|$)/.test(url)), 'optional assets must not load with the default coupon view');
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
  assert.ok(!disabled.requests.some(url => /\/online-deals\.(?:js|css|json)(?:\?|$)/.test(url)));
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
  const { page, errors } = await setup(t, { width: 360, items: [deal({ url: 'https://link.coupang.com/a/test-fixture', affiliate: true })] });
  await page.goto(site.base + '/index.html?view=onlineDeals');
  const card = page.locator('#onlineDeals .od-card');
  await card.waitFor();
  assert.match(await card.innerText(), /2L · 6개/);
  assert.match(await card.innerText(), /3000원/);
  assert.doesNotMatch(await card.innerText(), /3,000원/);
  assert.match(await card.innerText(), /테스트 와우회원 조건/);
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
