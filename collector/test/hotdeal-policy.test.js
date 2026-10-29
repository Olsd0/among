import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickHeadlines, qualifiesHappyPointHeadline } from '../src/engine.js';

test('해피포인트는 1+1·50% 이상 할인만 통과하고 적립·일반 증정·작은 할인은 제외한다', () => {
  const hp = { programs: ['해피포인트'] };
  for (const item of [
    { discount_label: '1+1' }, { title: '쉑버거 원쁠원' }, { title: '한정 50% 할인' },
    { discount_label: '최대 50% 할인' }, { discount_type: 'price', discount_rate: 51 },
    { discount_type: 'free_item', menu: '쉑버거 1 + 1' },
  ]) assert.equal(qualifiesHappyPointHeadline({ ...hp, ...item }), true, JSON.stringify(item));
  for (const item of [
    { discount_label: '49% 할인' }, { discount_label: '150% 할인' }, { discount_label: '2+1' },
    { title: '11+1' }, { title: '1+10' }, { discount_type: 'free_item', menu: '사은품 증정' },
    { discount_label: '50% 적립' }, { discount_label: '50%', title: '50% 적립 행사' },
    { title: '50% 적립과 10% 할인' }, { discount_label: '50% 환급' },
    { discount_type: 'point_back', discount_rate: 50 }, { discount_label: '5000원 할인' },
  ]) assert.equal(qualifiesHappyPointHeadline({ ...hp, ...item }), false, JSON.stringify(item));
  assert.equal(qualifiesHappyPointHeadline({ source_url: 'https://napi.happypointcard.com/event', discount_label: '40%' }), false);
  assert.equal(qualifiesHappyPointHeadline({ programs: ['네이버페이'], discount_label: '50% 적립' }), true);
});

test('공지와 쿠폰 양쪽에 해피포인트 기준을 적용하고 큰 한정 행사 다음에 정기·소규모 공지를 둔다', () => {
  const base = { status: 'published', start_date: '2026-10-26', end_date: '2026-10-30', first_seen: '2026-10-29T00:00:00Z', related_ids: [], programs: [] };
  const news = [
    { ...base, id: 'weekly', brand: '정기', title: '매주 목요일 1+1', discount_label: '1+1' },
    { ...base, id: 'small', brand: '소규모', title: '소액 할인', discount_label: '10% 할인', end_date: '2026-10-29' },
    { ...base, id: 'big', brand: '한정', title: '한정 50% 적립', discount_label: '50% 적립', first_seen: '2026-10-26T00:00:00Z', end_date: '2026-11-01' },
    { ...base, id: 'happy-low', brand: '낮음', title: '할인', discount_label: '40%', programs: ['해피포인트'] },
    { ...base, id: 'happy-big', brand: '쉐이크쉑', title: '쉑버거 1+1', discount_label: '1+1', programs: ['해피포인트'] },
  ];
  const coupons = [
    { ...base, id: 'c-low', brand: '쿠폰', menu: '할인', discount_type: 'percent', discount_rate: 49, programs: ['해피포인트'] },
    { ...base, id: 'c-big', brand: '쿠폰', menu: '할인', discount_type: 'percent', discount_rate: 50, programs: ['해피포인트'] },
  ];
  const ids = pickHeadlines(coupons, news, { today: '2026-10-29', limit: 20 }).map((x) => x.id);
  assert.ok(!ids.includes('happy-low') && !ids.includes('c-low'));
  for (const big of ['big', 'happy-big', 'c-big']) {
    assert.ok(ids.indexOf(big) >= 0);
    assert.ok(ids.indexOf(big) < ids.indexOf('weekly'));
    assert.ok(ids.indexOf(big) < ids.indexOf('small'));
  }
  assert.ok(!pickHeadlines([], news, { today: '2026-10-30', limit: 20 }).some((x) => x.id === 'weekly'));
  assert.equal(news.length, 5, '원래 혜택 목록은 변경하지 않는다');
});

test('같은 페이지에 연결된 다른 상품의 50% 할인을 작은 공지 순위에 빌려 쓰지 않는다', () => {
  const small = { id: 'small', brand: 'KFC', title: '더블 커넬 위크 2배 적립', discount_label: '2배 적립', related_ids: ['other'], end_date: '2026-10-30' };
  const big = { id: 'big', brand: '설빙', title: '50% 적립', discount_label: '50% 적립', end_date: '2026-11-01' };
  const other = { id: 'other', brand: 'KFC', menu: 'KFC 닭껍질튀김', discount_type: 'price', discount_rate: 51, end_date: '2026-10-30' };
  assert.deepEqual(pickHeadlines([other], [small, big], { today: '2026-10-29' }).map((x) => x.id), ['big', 'small']);
});
