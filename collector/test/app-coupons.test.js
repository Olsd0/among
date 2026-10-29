import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { acNormalize, acValidate, acLifecycle, acPublic, acHotEligible, acBenefit, acAudience, acOfficialUrl, acTimestamp } from '../src/app-coupons.js';
import { loadAppsScript } from './gas-harness.js';
import { appCoupon, AC_NOW } from './app-coupon-fixtures.js';

const CODE = new URL('../../apps-script/Code.gs', import.meta.url).pathname;
function boot() {
  const gas = loadAppsScript(CODE, { now: AC_NOW }); gas.ctx.setup();
  const post = (action, body = {}) => gas.post({ action, token: gas.props.get('ADMIN_TOKEN'), ...body });
  const save = c => post('app_coupon_save', { coupon: c, expected_revision: c.revision, confirm_checked: true, confirm_link: true });
  return { gas, post, save };
}
test('canonical rules are identical in frontend and deployed backend', () => {
  const model = readFileSync(new URL('../src/app-coupons.js', import.meta.url), 'utf8');
  assert.equal(readFileSync(new URL('../../web/app-coupons.js', import.meta.url), 'utf8'), model);
  assert.ok(readFileSync(CODE, 'utf8').includes(model.replace(/^export /gm, '')));
  assert.ok(readFileSync(CODE, 'utf8').includes(readFileSync(new URL('../../apps-script/app-coupon-backend.gs', import.meta.url), 'utf8')));
});
test('KST midnight: issuance ends first; redemption ends later, both inclusively', () => {
  const c = appCoupon();
  assert.equal(acTimestamp('2026-10-30', true), '2026-10-30T14:59:59.999Z');
  assert.equal(acLifecycle(c, Date.parse('2026-10-30T14:59:59.999Z')), 'issuing');
  assert.equal(acLifecycle(c, Date.parse('2026-10-30T15:00:00Z')), 'redeem_only');
  assert.equal(acLifecycle(c, Date.parse('2026-11-02T15:00:00Z')), 'ended');
  assert.equal(acPublic(c, Date.parse('2026-11-02T15:00:00Z')), null);
  assert.equal(acHotEligible(c, Date.parse('2026-10-30T15:00:00Z')), false);
});
test('audience and grades are coupon-specific and missing core facts never publish', () => {
  const c = appCoupon();
  assert.deepEqual(acValidate(c, AC_NOW), []);
  assert.match(acAudience(c), /테스트 KING · 테스트 CROWN 등급/);
  for (const over of [{ tiers: [] }, { audience_evidence: '' }, { checked_at: '' }, { use_end: '' }, { issue_end: '' }, { rights_state: 'unknown' }, { product_name: '' }]) {
    const invalid = appCoupon(over); assert.ok(acValidate(invalid, AC_NOW).length, JSON.stringify(over)); assert.equal(acPublic(invalid, AC_NOW), null);
  }
  const mcd = appCoupon({ issuer_app: '맥도날드', audience_type: 'unknown' });
  assert.ok(acValidate(mcd, AC_NOW).includes('쿠폰별 이용 대상·확인 근거'));
});
test('prices, maximum amounts and points are not confused; rates are never inferred', () => {
  assert.equal(acBenefit(appCoupon({ benefit_type: 'amount', discount_amount: 2000, is_max: true, final_price: null })), '최대 2,000원 할인');
  assert.equal(acBenefit(appCoupon({ benefit_type: 'point_back', benefit_note: '조건', discount_rate: 50 })), '50% 포인트 환급');
  assert.equal(acBenefit(appCoupon({ benefit_type: 'point_exchange', points_cost: 2000 })), '2,000P 교환');
  const c = appCoupon({ regular_price: null, discount_rate: null });
  assert.equal(c.discount_rate, null); assert.equal(acHotEligible(c, AC_NOW), false);
});
test('Happy Point 1+1 / 50% rule only controls hot deals; points are distinct', () => {
  const hp = appCoupon({ issuer_app: '해피포인트', brand: '테스트 사용 브랜드', audience_type: 'all_members', tiers: [], source_url: 'https://www.happypointcard.com/event/test', official_link: 'https://www.happypointcard.com/event/test', discount_rate: 20 });
  assert.ok(acPublic(hp, AC_NOW)); assert.equal(acHotEligible(hp, AC_NOW), false);
  assert.equal(acHotEligible({ ...hp, discount_rate: 50 }, AC_NOW), true);
  assert.equal(acHotEligible({ ...hp, benefit_type: 'bogo', discount_rate: null }, AC_NOW), true);
  assert.equal(acHotEligible({ ...hp, benefit_type: 'point_back', benefit_note: '포인트 환급', discount_rate: 50 }, AC_NOW), false);
  assert.equal(acPublic({ ...hp, audience_type: 'personalized', audience_detail: '맞춤' }, AC_NOW), null);
});
test('reject unsafe / personal links and unsupported guessed deep links', () => {
  const good = 'https://napi.happypointcard.com/page/event/event-view.spc?eventseq=abc&share=Y';
  assert.equal(acOfficialUrl(good, '해피포인트'), true);
  for (const url of [good + '&token=private', good + '&coupon_code=personal', 'javascript:alert(1)', 'burgerking://coupon/1', 'https://burgerking.co.kr.attacker.test/event', 'https://user:pass@burgerking.co.kr/event', 'https://www.burgerking.co.kr/event?%74oken=secret']) assert.equal(acOfficialUrl(url, '버거킹'), false, url);
  assert.equal(acValidate(appCoupon({ link_type: 'install', app_path: '' }), AC_NOW).includes('실제로 확인한 앱 내 이동 경로'), true);
});
test('research drafts migrate idempotently and remain private; all admin routes require ADMIN_TOKEN', () => {
  const { gas, post } = boot();
  assert.equal(post('app_coupon_list').coupons.length, 3);
  assert.ok(post('app_coupon_list').coupons.every(c => c.status === 'draft' && !c.checked_at && c.missing_info));
  gas.props.set('SCHEMA_VERSION', '5'); gas.get({ action: 'coupons' });
  assert.equal(post('app_coupon_list').coupons.length, 3);
  const pub = gas.get({ action: 'coupons' }); assert.deepEqual(pub.app_coupons, []); assert.ok(!JSON.stringify(pub).includes('ac_research'));
  for (const action of ['app_coupon_list', 'app_coupon_save', 'app_coupon_close', 'app_coupon_duplicates']) {
    assert.equal(gas.post({ action }).error, 'unauthorized');
    assert.equal(gas.post({ action, token: gas.props.get('COLLECTOR_TOKEN') }).error, 'unauthorized');
  }
});
test('CRUD: draft privacy, explicit verification, revision conflicts, operational closure, shared record', () => {
  const { gas, post, save } = boot();
  let c = post('app_coupon_save', { coupon: appCoupon({ status: 'draft' }) }).coupon;
  assert.equal(c.checked_at, ''); assert.equal(c.link_checked_at, ''); assert.deepEqual(gas.get({ action: 'app_coupons' }).app_coupons, []);
  assert.equal(post('app_coupon_save', { coupon: { ...c, status: 'published' }, expected_revision: c.revision }).ok, false);
  c = save({ ...c, status: 'published' }).coupon;
  assert.equal(acHotEligible(c, AC_NOW), true);
  const firstCheck = c.checked_at;
  gas.clock.now += 3600e3;
  gas.get({ action: 'coupons' }); post('app_coupon_list');
  assert.equal(post('app_coupon_list').coupons.find(x => x.id === c.id).checked_at, firstCheck);
  assert.match(post('app_coupon_save', { coupon: c, expected_revision: 0 }).error, /다른 곳/);
  const changed = { ...c, final_price: 3500 };
  assert.equal(post('app_coupon_save', { coupon: changed, expected_revision: c.revision }).ok, false);
  c = save(changed).coupon;
  const shared = gas.get({ action: 'coupons' }).app_coupons.find(x => x.id === c.id);
  assert.equal(shared.final_price, 3500); assert.equal(acHotEligible(shared, gas.clock.now), true);
  assert.equal(gas.sheet('coupons').objects().length, 0); assert.equal(gas.sheet('news').objects().length, 0);
  const verified = c.checked_at;
  c = post('app_coupon_close', { id: c.id, expected_revision: c.revision, phase: 'issue' }).coupon;
  assert.equal(c.checked_at, verified); assert.equal(acLifecycle(c, gas.clock.now), 'redeem_only'); assert.equal(acHotEligible(c, gas.clock.now), false);
  assert.equal(gas.get({ action: 'app_coupons' }).app_coupons[0].lifecycle, 'redeem_only');
  c = post('app_coupon_close', { id: c.id, expected_revision: c.revision, phase: 'use' }).coupon;
  assert.equal(c.checked_at, verified); assert.deepEqual(gas.get({ action: 'app_coupons' }).app_coupons, []);
});
test('duplicates are checked, private notes never leak, long exclusions are retained', () => {
  const { gas, post, save } = boot();
  const c = save(appCoupon({ admin_notes: 'PRIVATE', missing_info: 'PRIVATE', legacy_refs: ['news:old_news'] })).coupon;
  const pub = gas.get({ action: 'coupons' });
  assert.ok(!JSON.stringify(pub).includes('PRIVATE'));
  assert.equal(pub.app_coupons[0].facts.excluded_stores.value, c.facts.excluded_stores.value);
  assert.deepEqual(pub.app_coupon_refs, ['news:old_news']);
  assert.equal(post('app_coupon_duplicates', { coupon: appCoupon() }).duplicates.length, 1);
  assert.equal(save(appCoupon()).ok, false);
  assert.equal(save(appCoupon({ product_name: '다른 쿠폰', duplicate_note: '같은 행사 안의 다른 상품' })).ok, true);
  gas.clock.now = Date.parse('2026-11-03T00:00:00Z');
  assert.deepEqual(gas.get({ action: 'coupons' }).app_coupon_refs, ['news:old_news']);
  assert.deepEqual(gas.get({ action: 'coupons' }).app_coupons, []);
});
