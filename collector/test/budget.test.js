// 예산 필터(제한 없음 · 5000 · 10000 · 20000원 이하): 확인된 쿠폰 적용가(구성 전체 가격)만 기준으로 한다.
// 아래 혜택은 실제 행사가 아니라 판단 기준을 확인하기 위한 가상 데이터다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetPrice, matchesFilters, computeCouponPrice, sortCoupons } from '../src/engine.js';

const base = { brand: '가상버거', category: '햄버거', audience: '전체', programs: [], channels: ['매장'], item_type: '단품', end_date: null };
const make = (id, fields) => ({ ...base, id, menu: `가상 메뉴 ${id}`, discount_type: 'price', coupon_price: null, ...fields });
const within = (list, maxPrice, extra = {}) => list.filter((c) => matchesFilters(c, { maxPrice, ...extra }, { today: '2026-11-04' })).map((c) => c.id);

test('예산 경계값: 기준 금액과 같은 가격은 포함, 1원이라도 넘으면 제외', () => {
  const list = [make('p4900', { coupon_price: 4900 }), make('p5000', { coupon_price: 5000 }), make('p5001', { coupon_price: 5001 }),
    make('p10000', { coupon_price: 10000 }), make('p20000', { coupon_price: 20000 }), make('p20001', { coupon_price: 20001 })];
  assert.deepEqual(within(list, '5000'), ['p4900', 'p5000']);
  assert.deepEqual(within(list, '10000'), ['p4900', 'p5000', 'p5001', 'p10000']);
  assert.deepEqual(within(list, '20000'), ['p4900', 'p5000', 'p5001', 'p10000', 'p20000']);
  // 제한 없음(빈 값)은 아무것도 빼지 않는다
  assert.equal(within(list, '').length, list.length);
  assert.equal(within(list, undefined).length, list.length);
});

test('할인액·할인율·적립액·최소 주문금액은 상품 가격으로 쓰지 않는다', () => {
  // 3000원 할인 — 실제 적용가 미확인
  const amount = make('amount', { discount_type: 'amount', ...computeCouponPrice({ discount_type: 'amount', discount_value: 3000 }), discount_value: 3000 });
  assert.equal(amount.coupon_price, null);
  // 30% 할인 — 기준 가격 미확인
  const percent = make('percent', { discount_type: 'percent', ...computeCouponPrice({ discount_type: 'percent', discount_value: 30 }), discount_value: 30 });
  assert.equal(percent.coupon_price, null);
  // 10000원 결제 후 50% 포인트 적립 — 5000원짜리 상품이 아니다
  const points = make('points', { discount_type: 'point_back', ...computeCouponPrice({ discount_type: 'point_back', discount_value: 50, discount_unit: 'percent' }), discount_value: 50, min_order: 10000 });
  // 혹시 적립 혜택에 결제 금액이 가격처럼 들어와도 즉시 할인으로 보지 않는다
  const pointsWithPay = make('points-pay', { discount_type: 'point_back', coupon_price: 10000, discount_value: 5000 });
  // 상품 가격 없이 최소 주문금액만 안내
  const minOrder = make('min-order', { discount_type: 'amount', discount_value: 2000, min_order: 15000 });
  const list = [amount, percent, points, pointsWithPay, minOrder];
  for (const c of list) assert.equal(budgetPrice(c), null, c.id);
  for (const max of ['5000', '10000', '20000']) assert.deepEqual(within(list, max), [], max);
  // 예산을 해제하면 기존처럼 모두 보인다
  assert.equal(within(list, '').length, list.length);
});

test('묶음·1+1은 사야 하는 구성 전체 가격으로 판단한다 (개당 환산 아님)', () => {
  // 총 6000원 결제로 음료 2잔 — 1잔 3000원이 아니라 6000원
  const twoCups = make('two-cups', { menu: '가상 음료 2잔 세트', item_type: '세트', coupon_price: 6000 });
  // 1+1: 하나 값(정상가 4500원)을 내고 하나 더 — 결제 구성은 4500원
  const bogo = make('bogo', { discount_type: 'free_item', menu: '가상 커피 1+1', ...computeCouponPrice({ discount_type: 'free_item', regular_price: 4500 }), regular_price: 4500 });
  assert.equal(budgetPrice(twoCups), 6000);
  assert.equal(bogo.coupon_price, 4500);
  assert.equal(budgetPrice(bogo), 4500);
  assert.deepEqual(within([twoCups, bogo], '5000'), ['bogo']);
  assert.deepEqual(within([twoCups, bogo], '10000'), ['two-cups', 'bogo']);
  // 1+1 구성 가격을 모르면 예산 결과에 넣지 않는다
  const bogoUnknown = make('bogo-unknown', { discount_type: 'free_item', menu: '가상 버거 1+1', coupon_price: null });
  assert.deepEqual(within([bogoUnknown], '20000'), []);
});

test('잘못된 가격 값은 0원·저가 상품으로 바뀌어 섞이지 않는다', () => {
  const bad = [null, undefined, '', '   ', 'abc', '4,900', NaN, -1000, 0, '0', true, false, Infinity, {}, []];
  const list = bad.map((v, i) => make(`bad${i}`, { coupon_price: v }));
  for (const c of list) assert.equal(budgetPrice(c), null, `${String(c.coupon_price)}`);
  assert.deepEqual(within(list, '5000'), []);
  // 숫자 문자열(시트에서 온 '4900')은 그대로 인정한다
  assert.equal(budgetPrice(make('str', { coupon_price: '4900' })), 4900);
  assert.deepEqual(within([make('str', { coupon_price: '4900' })], '5000'), ['str']);
});

test('예산은 다른 조건과 함께 적용되고 정렬을 바꾸지 않는다', () => {
  const list = [
    make('set-cheap', { item_type: '세트', coupon_price: 4500, end_date: '2026-11-30' }),
    make('single-cheap', { item_type: '단품', coupon_price: 3000, end_date: '2026-11-05' }),
    make('set-pricey', { item_type: '세트', coupon_price: 9000 }),
    make('pizza', { category: '피자', coupon_price: 4000 }),
  ];
  assert.deepEqual(within(list, '5000', { category: '햄버거', itemType: '세트' }), ['set-cheap']);
  assert.deepEqual(within(list, '5000', { q: '가상 메뉴 pizza' }), ['pizza']);
  // 정렬은 고른 방식 그대로: 예산을 골라도 '가격 낮은 순'으로 바뀌지 않는다 (정렬은 호출하는 쪽의 선택)
  const shown = list.filter((c) => matchesFilters(c, { maxPrice: '10000', category: '햄버거' }, { today: '2026-11-04' }));
  assert.deepEqual(sortCoupons(shown, 'deadline', '2026-11-04').map((c) => c.id), ['single-cheap', 'set-cheap', 'set-pricey']);
});

test('알 수 없는 예산 값은 결과를 몰래 줄이지 않는다', () => {
  const list = [make('a', { coupon_price: 4000 }), make('b', { coupon_price: null })];
  assert.equal(within(list, 'abc').length, 2);
  assert.equal(within(list, '-5').length, 2);
});
