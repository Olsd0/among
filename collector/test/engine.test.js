import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  toInt, parseDate, todayKST, daysLeft, normChannels, normAudience, normItemType,
  computeCouponPrice, normalizeAndValidate, checkApplicable, matchesFilters, sortCoupons,
  checkEvidence, dedupe, summarize,
} from '../src/engine.js';
import { couponId, contentHash } from '../src/ids.js';

const NOW = new Date('2026-10-25T03:00:00Z'); // KST 2026-10-25 12:00
const ctx = { now: NOW, brand: '맥도날드', category: '햄버거', sourceUrl: 'https://example.com/promo' };
const base = {
  menu: '불고기버거 세트', item_type: '세트', regular_price: '8,000원', coupon_price: '5,500원',
  discount_type: 'price', channels: ['매장', '픽업'], audience: '전체', end_date: '2026-10-31', confidence: 0.95,
};

test('숫자 파싱: 원·쉼표·만 단위', () => {
  assert.equal(toInt('5,500원'), 5500);
  assert.equal(toInt('₩ 12,900'), 12900);
  assert.equal(toInt('1만원'), 10000);
  assert.equal(toInt('가격 미정'), null);
  assert.equal(toInt(''), null);
});

test('KST 기준 오늘 날짜 (UTC 15시 = KST 다음날 0시)', () => {
  assert.equal(todayKST(new Date('2026-10-25T14:59:00Z')), '2026-10-25');
  assert.equal(todayKST(new Date('2026-10-25T15:00:00Z')), '2026-10-26');
});

test('날짜 파싱: 여러 표기와 연도 추론', () => {
  assert.equal(parseDate('2026.10.31', NOW), '2026-10-31');
  assert.equal(parseDate('2026년 11월 3일', NOW), '2026-11-03');
  assert.equal(parseDate('~10/31(금)', NOW), '2026-10-31');
  assert.equal(parseDate('11월 5일까지', NOW), '2026-11-05');
  assert.equal(parseDate('26.12.01', NOW), '2026-12-01');
  // 12월 말 기준 "1/5"는 다음 해
  assert.equal(parseDate('1/5', new Date('2026-12-28T03:00:00Z')), '2027-01-05');
  assert.equal(parseDate('2/30', NOW), null);
  assert.equal(parseDate('상시', NOW), null);
});

test('D-day 계산', () => {
  assert.equal(daysLeft('2026-10-28', '2026-10-25'), 3);
  assert.equal(daysLeft('2026-10-25', '2026-10-25'), 0);
  assert.equal(daysLeft(null, '2026-10-25'), null);
});

test('채널 표기 정규화', () => {
  assert.deepEqual(normChannels('매장·포장'), ['매장', '픽업']);
  assert.deepEqual(normChannels(['맥딜리버리', '드라이브 스루']), ['배달', '드라이브스루']);
  assert.deepEqual(normChannels('킹오더'), ['픽업']);
  assert.deepEqual(normChannels('전 채널'), ['매장', '픽업', '배달', '드라이브스루']);
  assert.deepEqual(normChannels(''), []);
});

test('대상 · 구성 정규화', () => {
  assert.equal(normAudience('첫 주문 고객'), '신규회원');
  assert.equal(normAudience('VIP 등급'), '멤버십');
  assert.equal(normAudience('생일 쿠폰'), '개인');
  assert.equal(normAudience('앱 회원 누구나'), '전체');
  assert.equal(normAudience(''), '전체');
  assert.equal(normItemType('', '와퍼 세트'), '세트');
  assert.equal(normItemType('', '빅맥'), '기타');
  assert.equal(normItemType('단품', '불고기버거'), '단품');
});

test('적용가: 정가 / 정액 할인', () => {
  assert.deepEqual(computeCouponPrice({ regular_price: 8000, coupon_price: 5500, discount_type: 'price' }),
    { coupon_price: 5500, discount_rate: 31, saved: 2500 });
  assert.deepEqual(computeCouponPrice({ regular_price: 8100, discount_type: 'amount', discount_value: 2200 }),
    { coupon_price: 5900, discount_rate: 27, saved: 2200 });
});

test('적용가: 정률 할인은 10원 단위 내림, 상한 적용', () => {
  // 8,900원 30% = 2,670원 → 2,670 (10원 단위 그대로)
  assert.equal(computeCouponPrice({ regular_price: 8900, discount_type: 'percent', discount_value: 30 }).coupon_price, 6230);
  // 7,450원 15% = 1,117.5 → 1,110원 할인
  assert.equal(computeCouponPrice({ regular_price: 7450, discount_type: 'percent', discount_value: 15 }).coupon_price, 6340);
  // 20,000원 50%인데 최대 3,000원
  const r = computeCouponPrice({ regular_price: 20000, discount_type: 'percent', discount_value: 50, max_discount: 3000 });
  assert.equal(r.coupon_price, 17000);
  assert.equal(r.discount_rate, 15);
});

test('적용가: 증정(1+1)은 결제액 유지, 체감 할인율', () => {
  const r = computeCouponPrice({ regular_price: 6000, discount_type: 'free_item', discount_value: 2000 });
  assert.equal(r.coupon_price, 6000);
  assert.equal(r.discount_rate, 25);
});

test('검증: 정상 쿠폰은 게시', () => {
  const c = normalizeAndValidate(base, ctx);
  assert.equal(c.status, 'published');
  assert.equal(c.coupon_price, 5500);
  assert.equal(c.discount_rate, 31);
  assert.deepEqual(c.channels, ['매장', '픽업']);
  assert.deepEqual(c.issues, []);
});

test('검증: 버림(rejected) 규칙', () => {
  const st = (o) => normalizeAndValidate({ ...base, ...o }, ctx);
  assert.equal(st({ menu: '' }).status, 'rejected');
  assert.equal(st({ end_date: '2026-10-24' }).status, 'rejected');
  assert.equal(st({ start_date: '2026-11-05', end_date: '2026-11-01' }).status, 'rejected');
  assert.equal(st({ coupon_price: 300 }).status, 'rejected');
  assert.equal(st({ coupon_price: 150000, regular_price: 200000 }).status, 'rejected');
  assert.equal(st({ coupon_price: 8000 }).status, 'rejected');
  assert.ok(st({ coupon_price: 8000 }).issues.includes('쿠폰가 ≥ 정상가'));
});

test('검증: 보류(pending) 규칙', () => {
  const st = (o) => normalizeAndValidate({ ...base, ...o }, ctx);
  assert.equal(st({ coupon_price: null }).status, 'pending');
  assert.equal(st({ coupon_price: 700, regular_price: 8000 }).status, 'pending'); // 91%
  assert.equal(st({ end_date: '' }).status, 'pending');
  assert.equal(st({ confidence: 0.6 }).status, 'pending');
  // 오늘 종료는 게시 (종료일 포함)
  assert.equal(st({ end_date: '2026-10-25' }).status, 'published');
});

test('근거 대조: 페이지에 없는 숫자는 감점 → 보류', () => {
  const page = '불고기버거 세트 정상가 8,000원 → 앱 쿠폰 5,500원 (10/31까지)';
  const ok = normalizeAndValidate({ ...base, evidence: '불고기버거 세트 정상가 8,000원' }, { ...ctx, pageText: page });
  assert.equal(ok.status, 'published');
  const bad = normalizeAndValidate({ ...base, coupon_price: 4500, evidence: '불고기버거 세트' }, { ...ctx, pageText: page });
  assert.equal(bad.status, 'pending');
  assert.ok(bad.issues.some((i) => i.includes('4500')));
  // 이미지에서 읽은 항목은 텍스트 대조 생략
  assert.deepEqual(checkEvidence({ ...base, evidence_source: 'image', evidence: '없는 문구' }, page).issues, []);
});

test('적용 조건 판단: 채널·최소주문·회원구분·기간', () => {
  const c = normalizeAndValidate({ ...base, audience: '신규회원', min_order: 10000, start_date: '2026-10-27', app_only: true }, ctx);
  const r = checkApplicable(c, { today: '2026-10-25', channel: '배달', orderAmount: 8000, member: '비회원' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['10/27 시작', '배달 불가', '10,000원 이상 주문', '신규회원 전용', '앱 회원 전용']);
  const ok = checkApplicable(normalizeAndValidate(base, ctx), { today: '2026-10-25', channel: '픽업', member: '회원' });
  assert.equal(ok.ok, true);
});

test('화면 필터와 정렬', () => {
  const a = normalizeAndValidate({ ...base, menu: 'A 세트', coupon_price: 5500 }, ctx);
  const b = normalizeAndValidate({ ...base, menu: 'B 단품', item_type: '단품', regular_price: 5000, coupon_price: 2900, end_date: '2026-10-26', channels: ['배달'] }, ctx);
  const c = normalizeAndValidate({ ...base, menu: 'C 세트', coupon_price: 6200, regular_price: 7900, audience: '신규회원', start_date: '2026-10-28' }, ctx);
  const all = [a, b, c];
  assert.deepEqual(all.filter((x) => matchesFilters(x, { itemType: '세트' })).map((x) => x.menu), ['A 세트', 'C 세트']);
  assert.deepEqual(all.filter((x) => matchesFilters(x, { channel: '픽업', everyoneOnly: true })).map((x) => x.menu), ['A 세트']);
  assert.deepEqual(all.filter((x) => matchesFilters(x, { q: 'b단' })).map((x) => x.menu), ['B 단품']);
  assert.deepEqual(sortCoupons(all, 'price', '2026-10-25').map((x) => x.menu), ['B 단품', 'A 세트', 'C 세트']);
  assert.deepEqual(sortCoupons(all, 'rate', '2026-10-25').map((x) => x.menu), ['B 단품', 'A 세트', 'C 세트']);
  assert.deepEqual(sortCoupons(all, 'deadline', '2026-10-25').map((x) => x.menu), ['B 단품', 'A 세트', 'C 세트']);
});

test('id는 가격이 바뀌어도 유지, 메뉴 표기 차이도 흡수 · 해시는 내용 변화 감지', () => {
  const a = normalizeAndValidate(base, ctx);
  const b = normalizeAndValidate({ ...base, menu: '불고기 버거세트', coupon_price: 5400 }, ctx);
  assert.equal(couponId(a), couponId(b));
  assert.notEqual(contentHash(a), contentHash(b));
  const c = normalizeAndValidate({ ...base, channels: ['픽업', '매장'], confidence: 0.9 }, ctx);
  assert.equal(contentHash(a), contentHash(c)); // 채널 순서·신뢰도는 해시에 영향 없음
  const other = normalizeAndValidate({ ...base, audience: '신규회원' }, ctx);
  assert.notEqual(couponId(a), couponId(other));
});

test('중복 제거: 신뢰도 높은 쪽 기준, 출처 합침', () => {
  const a = normalizeAndValidate({ ...base, confidence: 0.85 }, { ...ctx, sourceUrl: 'https://a.example' });
  const b = normalizeAndValidate({ ...base, confidence: 0.97 }, { ...ctx, sourceUrl: 'https://b.example' });
  const out = dedupe([a, b], couponId);
  assert.equal(out.length, 1);
  assert.equal(out[0].confidence, 0.97);
  assert.equal(out[0].source_url, 'https://b.example https://a.example');
});

test('실행 요약: 자동 게시율 = 게시 / (게시+보류)', () => {
  const list = [
    normalizeAndValidate(base, ctx),
    normalizeAndValidate({ ...base, menu: 'x', confidence: 0.5 }, ctx),
    normalizeAndValidate({ ...base, menu: '' }, ctx),
  ];
  const s = summarize(list);
  assert.equal(s.published, 1);
  assert.equal(s.pending, 1);
  assert.equal(s.rejected, 1);
  assert.equal(s.auto_publish_rate, 0.5);
});

test('web/engine.js 사본이 원본과 같다 (npm run sync-web)', () => {
  const src = readFileSync(new URL('../src/engine.js', import.meta.url), 'utf8');
  const web = readFileSync(new URL('../../web/engine.js', import.meta.url), 'utf8');
  assert.equal(web, src, 'web/engine.js가 오래됐습니다. collector에서 `npm run sync-web` 실행');
});
