import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serveDir } from './helpers.js';
import { loadAppsScript } from './gas-harness.js';
import { appCoupon, AC_NOW } from './app-coupon-fixtures.js';

let site, browser;
before(async () => { site = await serveDir(new URL('../../web/', import.meta.url).pathname); browser = await chromium.launch(); });
after(async () => { if (browser) await browser.close(); if (site) await site.close(); });
async function setup(t, width = 390) {
  const gas = loadAppsScript(new URL('../../apps-script/Code.gs', import.meta.url).pathname, { now: AC_NOW }); gas.ctx.setup();
  const token = gas.props.get('ADMIN_TOKEN');
  const post = (action, body = {}) => gas.post({ action, token, ...body });
  const save = c => { const j = post('app_coupon_save', { coupon: c, expected_revision: c.revision, confirm_checked: true, confirm_link: true }); assert.equal(j.ok, true, j.error); return j.coupon; };
  const context = await browser.newContext({ viewport: { width, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
  t.after(() => context.close());
  const errors = [];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === site.base) return route.continue();
    if (url.hostname === 'script.google.com') {
      const result = req.method() === 'POST' ? gas.post(JSON.parse(req.postData() || '{}')) : gas.get(Object.fromEntries(url.searchParams));
      return route.fulfill({ json: result, headers: { 'access-control-allow-origin': '*' } });
    }
    if (url.hostname === 'www.burgerking.co.kr') return route.fulfill({ body: '<title>테스트 전용 공식 목적지</title>', contentType: 'text/html' });
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: AC_NOW });
  return { gas, token, post, save, context, page, errors };
}
async function ready(page, suffix = '?view=appCoupons') {
  await page.goto(site.base + '/index.html' + suffix);
  await page.locator('#acCount').filter({ hasText: /개/ }).waitFor({ state: 'attached' });
}
test('390px mobile: app filters, exact tiers, full conditions, official CTA and no draft leakage', { timeout: 30000 }, async t => {
  const { save, page, context, errors } = await setup(t);
  const bk = save(appCoupon());
  save(appCoupon({ issuer_app: '해피포인트', brand: '테스트 사용처', audience_type: 'all_members', tiers: [], discount_rate: 10, source_url: 'https://www.happypointcard.com/event/test', official_link: 'https://www.happypointcard.com/event/test' }));
  await ready(page);
  assert.equal(await page.locator('.ac-card').count(), 2);
  assert.equal(await page.locator('#errNote').isVisible(), false, 'app coupon freshness is independent of the collector run timestamp');
  assert.equal(await page.locator('body').innerText().then(t => t.includes('상세 확인 대기')), false);
  await page.getByRole('button', { name: '버거킹', exact: true }).click();
  assert.equal(await page.locator('.ac-card').count(), 1);
  assert.match(await page.locator('.ac-card').innerText(), /테스트 KING · 테스트 CROWN 등급/);
  assert.match(await page.locator('.ac-card').innerText(), /11-02 23:59/);
  await page.getByRole('button', { name: '조건 상세', exact: true }).click();
  const dialog = page.locator('#appCouponSheet');
  assert.match(await dialog.innerText(), /발급 기간/);
  assert.match(await dialog.innerText(), /미확인/);
  assert.match(await dialog.innerText(), /해당 없음/);
  await dialog.getByText('제외 매장', { exact: true }).click();
  assert.equal(await dialog.locator('.ac-long').first().locator('p').innerText(), bk.facts.excluded_stores.value);
  if (process.env.AMONG_QA_SCREENSHOT) await page.screenshot({ path: process.env.AMONG_QA_SCREENSHOT.replace('.png', '-detail.png') });
  assert.match(await dialog.innerText(), /조건 마지막 확인: 2026-10-29 12:00/);
  const [popup] = await Promise.all([context.waitForEvent('page'), dialog.getByRole('link', { name: /공식 행사 보기/ }).click()]);
  await popup.waitForLoadState(); assert.equal(popup.url(), bk.official_link); await popup.close();
  await dialog.getByRole('button', { name: '쿠폰 상세 닫기' }).click();
  await page.getByRole('button', { name: '해피포인트', exact: true }).click();
  assert.match(await page.locator('.ac-card').innerText(), /테스트 사용처/);
  assert.match(await page.locator('.ac-card').innerText(), /전체 회원/);
  assert.equal(await page.locator('.ac-card').innerText().then(s => s.includes('개인별')), false);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (process.env.AMONG_QA_SCREENSHOT) await page.screenshot({ path: process.env.AMONG_QA_SCREENSHOT, fullPage: true });
  assert.deepEqual(errors, []);
});
test('360px mobile: one record updates both hot deals and list, issuance / use closures are distinct', { timeout: 30000 }, async t => {
  const { save, post, page, errors } = await setup(t, 360);
  let c = save(appCoupon());
  await ready(page, '');
  await page.locator(`[data-hot="app_coupon:${c.id}"]`).waitFor();
  await page.locator(`[data-hot="app_coupon:${c.id}"]`).click();
  assert.match(await page.locator('#appCouponSheet').innerText(), /4,000원/);
  await page.getByRole('button', { name: '쿠폰 상세 닫기' }).click();
  c = save({ ...c, final_price: 3500 });
  await page.reload(); await page.locator(`[data-hot="app_coupon:${c.id}"]`).waitFor();
  assert.match(await page.locator(`[data-hot="app_coupon:${c.id}"]`).innerText(), /3,500원/);
  await page.getByRole('button', { name: '앱 전용 쿠폰', exact: true }).click();
  assert.match(await page.locator('.ac-card').innerText(), /3,500원/);
  c = post('app_coupon_close', { id: c.id, expected_revision: c.revision, phase: 'issue' }).coupon;
  await ready(page);
  assert.equal(await page.locator('.ac-card').count(), 0);
  await page.locator('#acScope').selectOption('redeem_only');
  assert.match(await page.locator('.ac-card').innerText(), /발급 종료 · 받은 쿠폰 사용 가능/);
  await page.getByRole('button', { name: '전체 혜택', exact: true }).click();
  assert.equal(await page.locator(`[data-hot="app_coupon:${c.id}"]`).count(), 0);
  post('app_coupon_close', { id: c.id, expected_revision: c.revision, phase: 'use' });
  await ready(page); await page.locator('#acScope').selectOption('all');
  assert.equal(await page.locator('.ac-card').count(), 0);
  assert.deepEqual(errors, []);
});
test('open page expires at KST boundary without refreshing checked_at', { timeout: 30000 }, async t => {
  const { save, page } = await setup(t);
  const c = save(appCoupon({ issue_end: '2026-10-29T12:00:00.500+09:00', use_end: '2026-10-29T12:00:02.500+09:00' }));
  await ready(page);
  await page.locator('#acScope').selectOption('all');
  await page.clock.runFor(1500);
  assert.match(await page.locator('.ac-card').innerText(), /발급 종료 · 받은 쿠폰 사용 가능/);
  await page.clock.runFor(2000);
  assert.equal(await page.locator('.ac-card').count(), 0);
  assert.equal(c.checked_at, '2026-10-29T03:00:00.000Z');
});
test('mobile admin uses existing auth: create draft, reject incomplete publish, edit, verify, close', { timeout: 40000 }, async t => {
  const { save, page, token, post, errors } = await setup(t);
  await page.goto(site.base + '/admin.html');
  await page.locator('#token').fill('wrong'); await page.getByRole('button', { name: '불러오기', exact: true }).click();
  await page.locator('#acAdminMessage').filter({ hasText: '관리 토큰이 맞지 않아요.' }).waitFor();
  assert.equal(await page.locator('#acAdminContent').isVisible(), false);
  await page.locator('#token').fill(token); await page.getByRole('button', { name: '불러오기', exact: true }).click();
  await page.locator('#acAdminContent').waitFor();
  assert.equal(await page.locator('[data-ac-edit]').count(), 3);
  await page.getByRole('button', { name: '쿠폰 등록', exact: true }).click();
  await page.locator('[name="product_name"]').fill('모바일 등록 초안');
  await page.getByRole('button', { name: '초안 저장', exact: true }).click();
  await page.locator('#acSaveMessage').filter({ hasText: '초안으로 저장했어요' }).waitFor();
  assert.equal(post('app_coupon_list').coupons.find(c => c.product_name === '모바일 등록 초안').checked_at, '');
  await page.getByRole('button', { name: '검증 후 공개', exact: true }).click();
  await page.locator('#acSaveMessage').filter({ hasText: '공개 전 확인 필요' }).waitFor();
  let c = save(appCoupon());
  await page.getByRole('button', { name: '목록 새로고침', exact: true }).click();
  await page.locator(`[data-ac-edit="${c.id}"]`).click();
  await page.locator('[name="final_price"]').fill('3600');
  await page.getByRole('button', { name: '검증 후 공개', exact: true }).click();
  await page.locator('#acSaveMessage').filter({ hasText: '변경된 조건 재확인' }).waitFor();
  await page.locator('[name="confirm_checked"]').check();
  await page.getByRole('button', { name: '검증 후 공개', exact: true }).click();
  await page.locator('#acSaveMessage').filter({ hasText: '공개했어요' }).waitFor();
  if (process.env.AMONG_QA_SCREENSHOT) { await page.locator('#acEditor').scrollIntoViewIfNeeded(); await page.screenshot({ path: process.env.AMONG_QA_SCREENSHOT.replace('.png', '-admin.png') }); }
  c = post('app_coupon_list').coupons.find(x => x.id === c.id); assert.equal(c.final_price, 3600);
  await page.getByRole('button', { name: '발급 조기 마감', exact: true }).click();
  await page.locator('#acAdminMessage').filter({ hasText: '발급 종료 · 받은 쿠폰 사용 가능 처리했어요' }).waitFor();
  await page.getByRole('button', { name: '사용 종료 처리', exact: true }).click();
  await page.locator('#acAdminMessage').filter({ hasText: '사용 종료 처리했어요' }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
});
