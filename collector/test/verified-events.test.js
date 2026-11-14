import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameEvent, verifiedEvents, withVerifiedEvents } from '../src/verified-events.js';
import { computeCouponPrice, verificationStatus } from '../src/engine.js';

const today = '2026-11-14';
const seed = () => withVerifiedEvents({ coupons: [], news: [] }, today);
const event = (id) => verifiedEvents.find((e) => e.id === id);

test('verified events provide paired factual coupons and notices with original verification time', () => {
  const { coupons, news } = seed();
  assert.equal(coupons.length, 9);
  assert.equal(news.length, 9);
  for (const e of verifiedEvents) {
    const c = coupons.find((x) => x.event_id === e.id);
    const n = news.find((x) => x.event_id === e.id);
    assert.deepEqual(n.related_ids, [c.id]);
    assert.equal(c.checked_at, e.checked_at);
    assert.equal(n.checked_at, e.checked_at);
    assert.equal(n.notice_only, true, 'verified notices must not borrow unrelated product imagery');
    assert.equal(c.official_link, e.source_url);
    assert.equal(c.image_url, '', 'event posters are not product images');
    assert.equal(verificationStatus(c.checked_at, Date.parse(c.checked_at) + 49 * 3600e3), 'stale');
  }
  assert.deepEqual(withVerifiedEvents(seed(), today), seed(), 'repeated integration is idempotent');
});

test('Npay point rewards do not become a reduced purchase price; unknown normal prices remain unknown', () => {
  const { coupons } = seed();
  for (const c of coupons.filter((x) => x.discount_type === 'point_back')) {
    assert.equal(c.regular_price, null);
    assert.equal(c.coupon_price, null);
    assert.equal(c.discount_unit, 'percent');
    if (c.brand !== '설빙') {
      assert.equal(c.max_discount, 50000);
      assert.equal(c.min_order, 10000);
    } else {
      assert.equal(c.max_discount, 30000, 'official Sulbing poster confirms the cap');
      assert.equal(c.min_order, 9900);
    }
    assert.equal(computeCouponPrice({ ...c, regular_price: 10000 }).coupon_price, null);
  }
  const blockpack = coupons.find((c) => c.event_id === 'baskin_blockpack_20261111');
  assert.equal(blockpack.coupon_price, 12000);
  assert.equal(blockpack.regular_price, null);
  assert.equal(blockpack.discount_rate, null, 'no fabricated discount rate without a normal price');
  const gift = coupons.find((c) => c.discount_type === 'free_item');
  assert.equal(gift.coupon_price, null);
  assert.equal(gift.discount_rate, null, 'free add-on is not automatically a 1+1 or 50% reduction');
  assert.match(gift.conditions, /예약 주문.*제외/);
});

test('confirmed dates are inclusive in KST and expired records do not reappear', () => {
  const id = 'baskin_blockpack_20261111';
  const has = (data) => data.coupons.some((x) => x.event_id === id);
  assert.equal(has(withVerifiedEvents({}, '2026-11-10')), false);
  assert.equal(has(withVerifiedEvents({}, '2026-11-11')), true);
  assert.equal(has(withVerifiedEvents(seed(), new Date('2026-11-15T14:59:59Z'))), true);
  assert.equal(has(withVerifiedEvents(seed(), new Date('2026-11-15T15:00:00Z'))), false);
  assert.equal(withVerifiedEvents(seed(), '2027-01-01').coupons.length, 0);
  assert.equal(withVerifiedEvents(seed(), '2027-01-01').news.length, 0);
});

test('moderation in either section blocks a replacement or cross-section re-publication', () => {
  const original = seed();
  const c = original.coupons[0], n = original.news[0];
  for (const status of ['hidden', 'pending', 'rejected', 'gone']) {
    const heldCoupon = { ...c, id: 'admin-coupon', status, checked_at: '2026-11-13T00:00:00Z' };
    const result = withVerifiedEvents({ coupons: [heldCoupon], news: [] }, today);
    assert.deepEqual(result.coupons.filter((x) => x.event_id === c.event_id), [heldCoupon]);
    assert.equal(result.news.some((x) => x.event_id === c.event_id), false);
    const heldNews = { ...n, id: 'admin-news', status };
    const second = withVerifiedEvents({ coupons: [], news: [heldNews] }, today);
    assert.equal(second.coupons.some((x) => x.event_id === c.event_id), false);
    assert.deepEqual(second.news.filter((x) => x.event_id === c.event_id), [heldNews]);
  }
});

test('exact official detail variants enrich missing dates without replacing id or checked_at', () => {
  const e = event('baskin_blockpack_20261111');
  const collected = {
    id: 'live-blockpack', brand: e.brand, menu: '블록팩 4개',
    source_url: 'https://www.baskinrobbins.co.kr/m/play/event/view.php?seq=642&category=ALL&utm_source=test',
    checked_at: '2026-11-13T15:00:00Z', status: 'published',
    start_date: '', end_date: '', conditions: '', coupon_price: 12000,
  };
  const result = withVerifiedEvents({ coupons: [collected], news: [] }, today);
  const matches = result.coupons.filter((x) => x.brand === e.brand);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, collected.id);
  assert.equal(matches[0].checked_at, collected.checked_at);
  assert.equal(matches[0].start_date, e.start_date);
  assert.equal(matches[0].end_date, e.end_date);
  assert.match(matches[0].conditions, /2세트/);
  assert.equal(collected.end_date, '', 'input remains immutable');
  assert.deepEqual(result.news.find((x) => x.event_id === e.id).related_ids, [collected.id]);
});

test('specific current Npay list coupon suppresses a duplicate but shared lists cannot transfer dates', () => {
  const e = event('dunkin_npay_dubai_20261109');
  const collected = {
    id: 'existing-dubai', brand: '던킨', menu: '두바이시리즈 도넛 4종',
    source_url: 'https://pay.naver.com/benefit/payment/list?firstCategory=DOMESTIC_INSTORE',
    official_link: 'https://campaign2.naver.com/npay/cafe/',
    start_date: '', end_date: '', discount_type: 'percent', discount_value: 50,
    programs: ['네이버페이'], first_seen: '2026-11-08T15:23:16.079Z', checked_at: '2026-11-13T15:14:02.32Z',
  };
  const other = { ...collected, id: 'dday', menu: '전 메뉴', discount_type: 'amount', discount_value: 4800, min_order: 12000 };
  const input = { coupons: [collected, other], news: [], marker: 42 };
  const result = withVerifiedEvents(input, today);
  assert.equal(result.marker, 42);
  assert.deepEqual(result.coupons.find((x) => x.id === collected.id), collected);
  assert.deepEqual(result.coupons.find((x) => x.id === other.id), other);
  assert.equal(result.coupons.some((x) => x.event_id === e.id), false);
  assert.deepEqual(result.news.find((x) => x.event_id === e.id).related_ids, [collected.id]);
  assert.equal(sameEvent(collected, other), false);
  const historical = { ...collected, first_seen: '2026-10-01T00:00:00Z' };
  assert.equal(withVerifiedEvents({ coupons: [historical] }, today).coupons.some((x) => x.event_id === e.id), true,
    'a historical undated list record must not be silently treated as the current event');
});

test('same brand or changed event period alone cannot identify a matching event', () => {
  const c = seed().coupons[0];
  assert.equal(sameEvent(c, { ...c, id: 'old', event_id: '', start_date: '2026-10-26', end_date: '2026-11-01' }), false);
  assert.equal(sameEvent({ brand: '던킨', source_url: 'https://www.dunkindonuts.co.kr/event' }, { brand: '던킨', source_url: 'https://www.dunkindonuts.co.kr/event' }), false);
});

test('explicitly reviewed live IDs are enriched and removed on expiry without renewing verification', () => {
  for (const e of verifiedEvents.filter((x) => x.alias_ids?.length)) {
    const expected = seed().coupons.find((x) => x.event_id === e.id);
    const live = {
      ...expected, event_id: undefined, id: e.alias_ids[0],
      start_date: '', end_date: '', conditions: '',
      source_url: 'https://pay.naver.com/benefit/payment/list?firstCategory=DOMESTIC_INSTORE',
      official_link: 'https://campaign2.naver.com/npay/cafe/',
      checked_at: '2026-11-13T15:14:02.32Z', first_seen: '2026-11-13T15:38:18.159Z',
    };
    const result = withVerifiedEvents({ coupons: [live] }, today);
    const matched = result.coupons.filter((x) => x.event_id === e.id);
    assert.equal(matched.length, 1);
    assert.equal(matched[0].id, live.id);
    assert.equal(matched[0].start_date, e.start_date);
    assert.equal(matched[0].end_date, e.end_date);
    assert.equal(matched[0].checked_at, e.checked_at);
    assert.equal(matched[0].source_url, e.source_url);
    assert.equal(matched[0].first_seen, live.first_seen);
    assert.equal(withVerifiedEvents({ coupons: [live] }, '2027-01-01').coupons.some((x) => x.id === live.id), false);
    assert.equal(withVerifiedEvents(result, today).coupons.find((x) => x.id === live.id).checked_at, e.checked_at);
    const held = { ...live, status: 'pending' };
    assert.deepEqual(withVerifiedEvents({ coupons: [held] }, today).coupons.find((x) => x.id === held.id), held);
  }
});

test('official poster confirms Sulbing dates, and alias IDs cannot rewrite different benefits', () => {
  const e = event('sulbing_npay_20261115');
  const n = seed().news.find((x) => x.event_id === e.id);
  assert.equal(n.start_date, '2026-11-12');
  assert.equal(n.period_source, '공식 원문');
  assert.match(n.period_refs, /^Npay\|https:.*\|2026-11-14$/);
  assert.equal(withVerifiedEvents({}, '2026-11-11').news.some((x) => x.event_id === e.id), false);
  assert.equal(withVerifiedEvents({}, '2026-11-13').news.some((x) => x.event_id === e.id), true);
  const spoof = { id: e.alias_ids[0], brand: '설빙', menu: '전 메뉴', discount_type: 'percent', discount_value: 30, programs: ['네이버페이'] };
  assert.deepEqual(withVerifiedEvents({ coupons: [spoof] }, today).coupons.find((x) => x.id === spoof.id), spoof);
});

test('newer real source verification keeps its timestamp and facts while missing fields retain supplement provenance', () => {
  const e = event('dunkin_npay_dubai_20261109');
  const original = seed().coupons.find((x) => x.event_id === e.id);
  const newer = {
    ...original, id: e.alias_ids[0], event_id: undefined,
    checked_at: '2026-11-15T03:00:00Z', first_seen: '2026-11-09T01:00:00Z',
    conditions: '공식 상세 재확인: 일부 매장 재고 소진',
    program_note: '11월 15일 공식 상세 확인', max_discount: 6000,
    start_date: '', end_date: '', how_to_use: '',
    source_url: 'https://pay.naver.com/benefit/payment/list?firstCategory=DOMESTIC_INSTORE',
    official_link: 'https://campaign2.naver.com/npay/cafe/',
    verified_detail_checked_at: '', verified_detail_source_url: '',
    period_source: '', period_refs: '',
  };
  const out = withVerifiedEvents({ coupons: [newer] }, '2026-11-15').coupons.find((x) => x.id === newer.id);
  assert.equal(out.checked_at, newer.checked_at);
  assert.equal(out.conditions, newer.conditions);
  assert.equal(out.program_note, newer.program_note);
  assert.equal(out.max_discount, newer.max_discount);
  assert.equal(out.source_url, newer.source_url);
  assert.equal(out.official_link, newer.official_link);
  assert.equal(out.start_date, e.start_date);
  assert.equal(out.end_date, e.end_date);
  assert.equal(out.how_to_use, original.how_to_use);
  assert.equal(out.verified_detail_checked_at, e.checked_at);
  assert.equal(out.verified_detail_source_url, e.source_url);
  assert.match(out.period_refs, /\|2026-11-14$/);
  assert.equal(newer.end_date, '', 'later source input is not mutated');
});

test('stable alias IDs from another recurring generation are never rewritten or expired by the old supplement', () => {
  for (const e of verifiedEvents.filter((x) => x.alias_ids?.length)) {
    const original = seed().coupons.find((x) => x.event_id === e.id);
    const later = {
      ...original, id: e.alias_ids[0], start_date: '', end_date: '',
      first_seen: '2026-12-15T01:00:00Z', checked_at: '2026-12-15T01:00:00Z',
      conditions: '다음 회차 행사',
    };
    // Even a copied old event_id and original detail URL cannot bypass the gate.
    const out = withVerifiedEvents({ coupons: [later] }, '2026-12-15');
    assert.deepEqual(out.coupons.find((x) => x.id === later.id), later);
    const old = { ...later, event_id: undefined, first_seen: '2026-01-01T00:00:00Z' };
    assert.deepEqual(withVerifiedEvents({ coupons: [old] }, today).coupons.find((x) => x.id === old.id), old);
    const unknown = { ...later, event_id: undefined, first_seen: '' };
    assert.deepEqual(withVerifiedEvents({ coupons: [unknown] }, today).coupons.find((x) => x.id === unknown.id), unknown);
    const datedNewCycle = { ...later, first_seen: original.first_seen, start_date: '2026-12-14', end_date: '2026-12-20' };
    assert.deepEqual(withVerifiedEvents({ coupons: [datedNewCycle] }, '2026-12-15').coupons.find((x) => x.id === datedNewCycle.id), datedNewCycle);
  }
});

test('Dunkin optional index.php route and URL tracking resolve to the same official detail', () => {
  const c = seed().coupons.find((x) => x.event_id === 'dunkin_npay_dubai_20261109');
  const collected = { ...c, event_id: undefined, id: 'detail-from-clean-route', source_url: 'https://dunkindonuts.co.kr/event/view?utm_source=share&id=5464', official_link: '' };
  assert.equal(sameEvent(collected, c), true);
  assert.equal(withVerifiedEvents({ coupons: [collected] }, today).coupons.filter((x) => sameEvent(x, c)).length, 1);
});


test('poster-confirmed expired list rows are dated without changing later generations or unrelated coupons', () => {
  const news = [
    { id: 'n_c94c469d4626', brand: '파파이스', title: '수요일 치킨 1+1 및 콜라 100원', summary: '11월 11일 수요일 한정', first_seen: '2026-10-28T02:35:17.344Z', source_url: 'https://popeyes.co.kr/event' },
    { id: 'n_5115cf53eee2', brand: '파파이스', title: '버거 2종 7,900원 특가', summary: '루이 치킨휠레 버거', first_seen: '2026-11-03T08:41:44.039Z', source_url: 'https://popeyes.co.kr/event' },
    { id: 'n_8d748f7d6591', brand: '빽다방', title: '말차 전 메뉴 2,026원 프로모션', summary: '2026년 말의해 프로모션', first_seen: '2026-10-28T20:19:12.194Z', source_url: 'https://paikdabang.com/news/?cate=event' },
  ];
  const matcha = { id: 'c_f39852815df3', brand: '빽다방', first_seen: '2026-10-26T21:06:40.587Z', menu: '말차 전 메뉴', discount_type: 'price', discount_value: 2026, source_url: 'https://paikdabang.com/news/?cate=event', hidden: true };
  const coffee = { id: 'c_6922043b6761', brand: '빽다방', menu: '아메리카노(ICED)', end_date: '2026-12-14' };
  const result = withVerifiedEvents({ news, coupons: [matcha, coffee] }, '2026-11-14');
  assert.deepEqual(result.news.slice(0, 3).map(n => n.end_date), ['2026-11-11', '2026-11-08', '2026-01-08']);
  assert.equal(result.coupons[0].end_date, '2026-01-08');
  assert.equal(result.coupons[0].hidden, true);
  assert.deepEqual(result.coupons[1], coffee);
  const later = news.map(n => ({ ...n, start_date: '2026-12-01', end_date: '2026-12-31' }));
  assert.deepEqual(withVerifiedEvents({ news: later }, '2026-11-14').news.slice(0, 3), later);
  const next = news.map(n => ({ ...n, first_seen: '2026-12-01T00:00:00Z' }));
  assert.deepEqual(withVerifiedEvents({ news: next }, '2026-11-14').news.slice(0, 3), next);
});

test('reviewed artwork fills an empty exact event but does not relabel an existing different image', () => {
  const template = withVerifiedEvents({}, '2026-11-14').news.find(n => n.event_id === 'hans_npay_20261112');
  const current = { ...template, image_url: 'https://example.com/new-official-poster.jpg', image_kind: undefined, image_checked_at: undefined };
  const result = withVerifiedEvents({ news: [current] }, '2026-11-14').news.find(n => n.id === current.id);
  assert.equal(result.image_url, current.image_url);
  assert.equal(result.image_kind, undefined);
});
