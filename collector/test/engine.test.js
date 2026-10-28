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

test('출처 확인 시각은 48시간을 넘기거나 알 수 없으면 최신으로 취급하지 않는다', async () => {
  const { verificationStatus } = await import('../src/engine.js');
  const now = Date.parse('2026-10-28T03:00:00Z');
  assert.equal(verificationStatus('2026-10-26T03:00:00Z', now), 'fresh');
  assert.equal(verificationStatus('2026-10-26T02:59:59Z', now), 'stale');
  assert.equal(verificationStatus('', now), 'unknown');
  assert.equal(verificationStatus('잘못된 날짜', now), 'unknown');
  assert.equal(verificationStatus('2026-10-28T03:06:00Z', now), 'unknown');
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
    { coupon_price: 5500, discount_rate: 31, saved: 2500, scope: 'item' });
  assert.deepEqual(computeCouponPrice({ regular_price: 8100, discount_type: 'amount', discount_value: 2200 }),
    { coupon_price: 5900, discount_rate: 27, saved: 2200, scope: 'item' });
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

test('주문 전체 할인: 정률은 할인율만, 정액은 할인액만 (쿠폰가 없음) → 게시', () => {
  assert.deepEqual(computeCouponPrice({ discount_type: 'percent', discount_value: 25 }), { coupon_price: null, discount_rate: 25, saved: null, scope: 'order' });
  assert.deepEqual(computeCouponPrice({ discount_type: 'amount', discount_value: 3000 }), { coupon_price: null, discount_rate: null, saved: 3000, scope: 'order' });
  const pct = normalizeAndValidate({ menu: '전 메뉴 (앱 첫 주문)', discount_type: 'percent', discount_value: 25, audience: '신규회원', channels: ['배달', '픽업'], end_date: '2026-12-31', confidence: 0.9 }, ctx);
  assert.equal(pct.status, 'published');
  assert.equal(pct.coupon_price, null);
  assert.equal(pct.discount_rate, 25);
  const amt = normalizeAndValidate({ menu: '크루아상 피자', discount_type: 'amount', discount_value: 10000, end_date: '2026-12-31', confidence: 0.9 }, ctx);
  assert.equal(amt.status, 'published');
  assert.equal(amt.discount_value, 10000);
  // 1+1·증정은 가격 없이도 게시
  assert.equal(normalizeAndValidate({ menu: '치킨 1+1 (밤 9~10시)', discount_type: 'free_item', end_date: '2026-12-31', confidence: 0.9 }, ctx).status, 'published');
  // 수치가 하나도 없으면 보류
  assert.equal(normalizeAndValidate({ menu: '이벤트', discount_type: 'percent', end_date: '2026-12-31', confidence: 0.9 }, ctx).status, 'pending');
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
  assert.equal(st({ confidence: 0.6 }).status, 'pending');
  // 종료일 없는 상시·시즌 프로모션은 게시하되 표시를 남긴다 (공식 페이지에서 사라지면 gone)
  const noEnd = st({ end_date: '' });
  assert.equal(noEnd.status, 'published');
  assert.ok(noEnd.issues.includes('종료일 미정 (매일 재확인)'));
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

test('근거 대조: 한글 단위 금액(1만원·4천원·1만5천원)도 인정', () => {
  assert.deepEqual(checkEvidence({ discount_type: 'amount', discount_value: 10000, evidence: '크루아상 1만원 할인' }, '크루아상 1만원 할인').issues, []);
  assert.deepEqual(checkEvidence({ discount_type: 'amount', discount_value: 4000, evidence: '포장 주문 시 4천원 할인' }, '포장 주문 시 4천원 할인').issues, []);
  assert.deepEqual(checkEvidence({ discount_type: 'amount', discount_value: 15000, evidence: '1만5천원 할인' }, '세트 1만5천원 할인').issues, []);
  assert.ok(checkEvidence({ discount_type: 'amount', discount_value: 5000, evidence: '4천원 할인' }, '4천원 할인').issues.length > 0);
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

test('D17 비슷한 쿠폰 합치기: 표기만 다른 같은 행사는 하나로, 다른 메뉴는 그대로', async () => {
  const { mergeSimilar, similarMenu } = await import('../src/engine.js');
  assert.ok(similarMenu('버터비스킷', '버터 비스켓'));
  assert.ok(similarMenu('징거버거', '징거'));
  assert.ok(similarMenu('NEW불닭 까르보 치킨', '불닭 까르보 치킨'));
  assert.ok(!similarMenu('핫크리스피치킨', '핫크리스피통다리'));
  assert.ok(!similarMenu('치킨', '핫크리스피치킨', 3));
  const base = { brand: 'K', status: 'published', audience: '신규회원', confidence: 0.9, source_url: 'a' };
  const out = mergeSimilar([
    { ...base, id: '1', menu: '징거버거', discount_type: 'price', coupon_price: 1000 },
    { ...base, id: '2', menu: '징거', discount_type: 'price', coupon_price: 1000, end_date: '2026-12-31', source_url: 'b' },
    { ...base, id: '3', menu: '징거버거', discount_type: 'price', coupon_price: 2000 },
    { ...base, id: '4', menu: '핫크리스피치킨', discount_type: 'free_item', audience: '전체' },
    { ...base, id: '5', menu: '오리지널치킨', discount_type: 'free_item', audience: '전체' },
  ]);
  assert.equal(out.length, 4);
  const kept = out.find((c) => c.coupon_price === 1000);
  assert.equal(kept.id, '2');                 // 종료일이 있는 쪽을 남김
  assert.equal(kept.source_url, 'b a');
});

test('근거 요약은 작은 감점, 연도를 가격으로 읽으면 보류', () => {
  const page = '빽다방 20주년 이벤트 2026.10.20 ~ 2026.10.28 아이스 아메리카노 1,000원';
  const ok = normalizeAndValidate({ menu: '아이스 아메리카노', discount_type: 'price', coupon_price: 1000, channels: [], audience: '전체', app_only: false,
    evidence: '아메리카노를 천원에 판매', evidence_source: 'text', confidence: 0.95, end_date: '2026-10-28' }, { ...ctx, pageText: page });
  assert.equal(ok.status, 'published');
  assert.ok(ok.issues.includes('근거 문구 요약됨 (숫자는 확인)'));
  const bad = normalizeAndValidate({ menu: '말차 전 메뉴', discount_type: 'price', coupon_price: 2026, channels: [], audience: '전체', app_only: false,
    evidence: '20주년 2026', evidence_source: 'text', confidence: 0.95, end_date: '2026-10-28' }, { ...ctx, pageText: page });
  assert.notEqual(bad.status, 'published');
});

test('D18 한 행사의 메뉴별 1+1이 4건 이상이면 카드 하나로, 정상가 없는 단순 가격은 보류', async () => {
  const { groupFreeItems } = await import('../src/engine.js');
  const b = { brand: 'KFC', status: 'published', audience: '전체', discount_type: 'free_item', source_url: 'u' };
  const g = groupFreeItems([{ ...b, menu: 'A치킨' }, { ...b, menu: 'B치킨' }, { ...b, menu: 'C치킨' }, { ...b, menu: 'D치킨' }, { ...b, brand: '파파이스', menu: '치킨' }]);
  assert.equal(g.length, 2);
  assert.equal(g.find((c) => c.brand === 'KFC').menu, 'A치킨 외 3종');
  const menuPrice = normalizeAndValidate({ menu: '한근 치즈 클래식', discount_type: 'price', coupon_price: 15900, channels: [], audience: '전체', app_only: false,
    evidence: '한근 치즈 클래식 15,900원', evidence_source: 'image', confidence: 0.9 }, ctx);
  assert.equal(menuPrice.status, 'pending');
  assert.ok(menuPrice.issues.includes('할인 행사인지 불명확 (정상가 없음)'));
});
