import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withCouponEventNews } from '../src/event-notices.js';
import { pickHeadlines } from '../src/engine.js';

const options = { today: '2026-11-14', now: Date.parse('2026-11-14T03:00:00Z') };
const coupon = (o = {}) => ({
  id: 'c_npay', status: 'published', brand: '설빙', category: '디저트', menu: '전 메뉴',
  discount_type: 'point_back', discount_value: 50, discount_rate: 50, coupon_price: null,
  start_date: '2026-11-12', end_date: '2026-11-18', programs: ['네이버페이'], audience: '전체',
  conditions: '포인트·머니로 10000원 이상 결제, 1인 합산 최대 50000포인트',
  source_id: 'npay', source_url: 'https://pay.naver.com/benefit/payment/detail/123',
  checked_at: '2026-11-14T02:00:00Z', first_seen: '2026-11-12T00:00:00Z', confidence: 1,
  image_url: 'https://example.com/product.jpg', ...o,
});

test('네이버페이 적립 쿠폰을 공지에도 표시하고 가격·조건·시각을 그대로 보존한다', () => {
  const c = coupon();
  const original = structuredClone(c);
  const [n] = withCouponEventNews([], [c], options);
  assert.equal(n.discount_label, '50% 적립');
  assert.ok(n.title.includes('네이버페이'));
  assert.equal(n.summary, c.conditions);
  assert.equal(n.checked_at, c.checked_at);
  assert.equal(n.first_seen, c.first_seen);
  assert.deepEqual(n.related_ids, ['c_npay']);
  assert.equal(n.image_url, '', '상품 사진을 공지 이미지로 쓰지 않는다');
  assert.deepEqual(c, original);
  const h = pickHeadlines([c], [n], { today: options.today });
  assert.equal(h.length, 1);
  assert.equal(h[0].kind, 'news');
  assert.equal(h[0].label, '50% 적립');
});

test('같은 행사 URL·브랜드·기간이면 자동·수동 공지는 유지하고 연결 쿠폰만 추가한다', () => {
  const c = coupon();
  const n = { ...c, id: 'n_official', title: '공식 제목', summary: '공식 요약', related_ids: ['c_original'], image_url: 'https://example.com/poster.jpg' };
  const original = structuredClone(n);
  const result = withCouponEventNews([n], [coupon({ source_url: `${c.source_url}?utm_source=share#top` })], options);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'n_official');
  assert.equal(result[0].image_url, n.image_url);
  assert.equal(result[0].title, n.title);
  assert.deepEqual(result[0].related_ids, ['c_original', 'c_npay']);
  assert.deepEqual(n, original);
  assert.deepEqual(withCouponEventNews(result, [c], options), result, '재적용해도 중복되지 않는다');
});

test('같은 행사를 숨김·보류·거절했으면 쿠폰으로 공지를 되살리지 않는다', () => {
  for (const status of ['hidden', 'pending', 'rejected']) {
    const n = { ...coupon(), id: 'n_disabled', status, related_ids: [] };
    assert.deepEqual(withCouponEventNews([n], [coupon()], options), [n]);
  }
});

test('게시·기간·현재 확인을 검증하고 개인 쿠폰과 상시성 행사는 제외한다', () => {
  for (const patch of [
    { status: 'pending' }, { status: 'hidden' }, { status: '' }, { audience: '개인' },
    { checked_at: '' }, { checked_at: '2026-11-10T00:00:00Z' }, { checked_at: '2026-11-15T00:00:00Z' },
    { start_date: '2026-11-15' }, { end_date: '2026-11-13' }, { start_date: 'invalid' }, { end_date: null },
    { end_date: '2026-11-31' }, { start_date: '2026-07-01', end_date: '2026-12-31' },
    { source_url: '' }, { source_url: 'javascript:alert(1)' }, { source_url: 'https://user:pass@example.com/event' },
  ]) assert.equal(withCouponEventNews([], [coupon(patch)], options).length, 0, JSON.stringify(patch));
  assert.equal(withCouponEventNews([], [coupon({ end_date: '2026-11-14' })], options).length, 1, '종료 당일 포함');
});

test('종료일이 확인된 결제 행사는 시작일이 없어도 올리되 시작일을 만들지 않는다', () => {
  const [n] = withCouponEventNews([], [coupon({ start_date: null })], options);
  assert.equal(n.start_date, null);
  assert.equal(n.end_date, '2026-11-18');
  assert.equal(withCouponEventNews([], [coupon({ start_date: null, end_date: null })], options).length, 0);
  assert.equal(withCouponEventNews([], [coupon({ start_date: null, programs: [], discount_type: 'free_item' })], options).length, 0);
});

test('증정은 그대로 증정으로 표기하고 추첨·경품은 확정 혜택으로 만들지 않는다', () => {
  const c = coupon({ programs: [], discount_type: 'free_item', discount_value: null, discount_rate: null, menu: '콤보 구매 시 도넛 증정' });
  const [n] = withCouponEventNews([], [c], options);
  assert.equal(n.discount_label, '증정');
  assert.ok(!n.title.includes('1+1'));
  assert.ok(!n.title.includes('50%'));
  for (const conditions of ['추첨 50명에게 사은품 증정', '인스타그램 댓글 이벤트', '응모 후 당첨자 발표'])
    assert.equal(withCouponEventNews([], [{ ...c, conditions }], options).length, 0);
});

test('카카오·토스 결제는 포함하되 일반 쿠폰과 특정 카드 조건은 자동 공지로 늘리지 않는다', () => {
  for (const program of ['카카오페이', '토스페이'])
    assert.equal(withCouponEventNews([], [coupon({ programs: [program] })], options).length, 1);
  for (const programs of [[], ['KT'], ['네이버페이', '카드']])
    assert.equal(withCouponEventNews([], [coupon({ programs })], options).length, 0);
});

test('서로 다른 이벤트 id·브랜드·기간은 합치지 않고 순서가 달라도 결과가 같다', () => {
  const base = coupon();
  const others = [
    coupon({ id: 'c_other_url', source_url: `${base.source_url}?event=other` }),
    coupon({ id: 'c_other_brand', brand: '던킨' }),
    coupon({ id: 'c_other_date', end_date: '2026-11-19' }),
  ];
  const list = [base, ...others];
  const result = withCouponEventNews([], list, options);
  assert.equal(result.length, 4);
  assert.deepEqual(withCouponEventNews([], [...list].reverse(), options), result);
});

test('같은 네이버페이 목록·브랜드·기간의 30%와 4800원 할인은 별개 공지로 남긴다', () => {
  const source_url = 'https://pay.naver.com/benefit/payment/list?firstCategory=DOMESTIC_INSTORE&secondCategory=FNB';
  const a = coupon({ id: 'c_percent', source_url, discount_type: 'percent', discount_value: 30, discount_rate: 30 });
  const b = coupon({ id: 'c_amount', source_url, discount_type: 'amount', discount_value: 4800, discount_rate: null });
  const result = withCouponEventNews([], [a, b], options);
  assert.equal(result.length, 2);
  assert.deepEqual(new Set(result.map((n) => n.discount_label)), new Set(['30%', '4800원 할인']));
  assert.ok(result.every((n) => n.related_ids.length === 1));
});

test('목록 URL은 같은 메뉴·혜택이면 연결하고 다른 메뉴면 같은 할인율이어도 나눈다', () => {
  const source_url = 'https://pay.naver.com/benefit/payment/list';
  const a = coupon({ id: 'c_one', source_url, menu: '딸기빙수' });
  const b = coupon({ id: 'c_twin', source_url, menu: '딸기 빙수' });
  const other = coupon({ id: 'c_other', source_url, menu: '팥빙수' });
  const result = withCouponEventNews([], [a, b, other], options);
  assert.equal(result.length, 2);
  assert.deepEqual(result.find((n) => n.related_ids.includes(a.id)).related_ids, ['c_one', 'c_twin']);
});

test('목록의 숨긴 다른 혜택이 같은 브랜드·날짜의 새 혜택을 막지 않는다', () => {
  const source_url = 'https://pay.naver.com/benefit/payment/list';
  const a = coupon({ id: 'c_old', source_url, discount_type: 'percent', discount_value: 30, discount_rate: 30 });
  const [hidden] = withCouponEventNews([], [a], options);
  hidden.status = 'hidden';
  const b = coupon({ id: 'c_new', source_url, discount_type: 'amount', discount_value: 4800, discount_rate: null });
  const result = withCouponEventNews([hidden], [a, b], options);
  assert.equal(result.length, 2);
  assert.equal(result[0].status, 'hidden');
  assert.equal(result[1].discount_label, '4800원 할인');
});

test('해피포인트 일반 증정은 공지 후보가 있어도 기존 핫딜 기준을 우회하지 않는다', () => {
  const c = coupon({ programs: ['해피포인트'], discount_type: 'free_item', discount_value: null, discount_rate: null, menu: '콤보 주문 시 도넛 증정' });
  const ns = withCouponEventNews([], [c], options);
  assert.equal(pickHeadlines([c], ns, { today: options.today }).length, 0);
});
