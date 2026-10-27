// 통신사·결제·포인트 혜택, 이용자 필터, 영양성분 매칭
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  detectPrograms, normPrograms, canonicalBrand, perThousandRate, isDeliveryAppOnly, detectStackable,
  normalizeAndValidate, mergeSimilar, isGenericMenu, usableBy, myPrograms, matchesFilters, sortCoupons,
  isOpenToEveryone, matchNutrition, sodiumPercent, menuKey, benefitKind,
} from '../src/engine.js';
import { couponId } from '../src/ids.js';

const NOW = new Date('2026-10-27T03:00:00Z'); // KST 10/27 12:00
const base = {
  menu: '불고기 버거', item_type: '단품', regular_price: 3800, coupon_price: 2500, discount_type: 'price',
  channels: ['매장', '픽업'], audience: '전체', end_date: '2026-11-10', evidence: '불고기 버거 2,500원', evidence_source: 'image', confidence: 0.95,
};
const v = (raw, ctx = {}) => normalizeAndValidate({ ...base, ...raw }, { now: NOW, brand: '맥도날드', category: '햄버거', ...ctx });

test('프로그램 감지: 통신사 3사 · 페이 · 해피포인트 · 카드, KT/SKT 혼동 없음', () => {
  assert.deepEqual(detectPrograms('T Membership, kt membership VIP 30% / U+멤버십 VIP 20%'), ['SKT', 'KT', 'LGU+']);
  assert.deepEqual(detectPrograms('KT 멤버십 대상, 방문포장'), ['KT']);
  assert.deepEqual(detectPrograms('SKT 멤버십, 일 1회'), ['SKT']);
  assert.deepEqual(detectPrograms('KT 달.달.혜택 방문포장 50%'), ['KT']);
  assert.deepEqual(detectPrograms('T우주 폴 바셋 구독 시'), ['SKT']);
  assert.deepEqual(detectPrograms('LG유플러스 유플투쁠'), ['LGU+']);
  assert.deepEqual(detectPrograms('네이버페이 현장결제 시 500원 적립'), ['네이버페이']);
  assert.deepEqual(detectPrograms('해피포인트 앱 바코드 스캔 시 20% 할인'), ['해피포인트']);
  assert.deepEqual(detectPrograms('현대카드 m포인트 20% 청구 할인'), ['카드']);
  assert.deepEqual(detectPrograms('KT멤버십 카드와 신분증 제시'), ['KT'], '멤버십 카드 제시는 카드 결제 할인이 아님');
  assert.deepEqual(detectPrograms('KTX 특가, KFC 징거'), []);
  assert.deepEqual(normPrograms(['T멤버십', 'U+', 'LGU+', '모름']), ['SKT', 'LGU+']);
});

test('브랜드 표준화: 표기가 달라도 같은 브랜드, 모르는 브랜드는 null', () => {
  assert.deepEqual(canonicalBrand('파리바게트'), { brand: '파리바게뜨', category: '디저트' });
  assert.deepEqual(canonicalBrand('메가MGC커피'), { brand: '메가MGC커피', category: '카페' });
  assert.deepEqual(canonicalBrand('Domino Pizza'), { brand: '도미노피자', category: '피자' });
  assert.equal(canonicalBrand('GS25'), null);
});

test('여러 브랜드가 섞인 멤버십 페이지: 브랜드·카테고리를 맞추고, 대상 밖 브랜드는 버림', () => {
  const page = '파리바게뜨 VIP·GOLD 1천원당 100원 할인, SILVER 1천원당 50원 · GS25 1천원당 100원';
  const pb = normalizeAndValidate({ brand: '파리바게트', menu: '전 제품', discount_type: 'percent', discount_value: null, channels: [], audience: '전체',
    app_only: false, evidence: 'SILVER 1천원당 50원', evidence_source: 'text', confidence: 0.9, program_note: 'VIP·GOLD 1천원당 100원, SILVER 50원' },
  { now: NOW, programs: ['SKT'], pageText: page });
  assert.equal(pb.brand, '파리바게뜨');
  assert.equal(pb.category, '디저트');
  assert.deepEqual(pb.programs, ['SKT']);
  assert.equal(pb.audience, '멤버십', '통신사 멤버십이 필요하면 누구나 쿠폰과 구분');
  assert.equal(pb.discount_value, 5, '1천원당 50원 = 5%');
  assert.equal(pb.status, 'published', pb.issues.join('/'));
  const gs = normalizeAndValidate({ brand: 'GS25', menu: '전 상품', discount_type: 'percent', discount_value: 10, evidence: 'GS25', confidence: 0.9 }, { now: NOW, programs: ['SKT'] });
  assert.equal(gs.status, 'rejected');
  assert.ok(gs.issues.includes('지원하지 않는 브랜드'));
});

test('1천원당 N원 할인 → % 환산 (AI가 정액 100원으로 잘못 읽어도)', () => {
  assert.equal(perThousandRate('1천원당 150원 할인'), 15);
  assert.equal(perThousandRate('1,000원당 최대 100원'), 10);
  assert.equal(perThousandRate('천원당 50원'), 5);
  assert.equal(perThousandRate('3천원 할인'), null);
  const c = v({ menu: '전 메뉴', regular_price: null, coupon_price: null, discount_type: 'amount', discount_value: 150, evidence: '1천원당 150원 할인' });
  assert.equal(c.discount_type, 'percent');
  assert.equal(c.discount_rate, 15);
});

test('적립(point_back): 결제액은 그대로, 원·% 구분, 값 없으면 보류', () => {
  const won = v({ menu: '카페 결제', regular_price: null, coupon_price: null, discount_type: 'point_back', discount_value: 500, evidence: '2천원 이상 결제 시 500원 적립', min_order: 2000, programs: ['네이버페이'] });
  assert.equal(won.status, 'published', won.issues.join('/'));
  assert.equal(won.coupon_price, null);
  assert.equal(won.discount_rate, null);
  assert.equal(won.discount_value, 500);
  assert.deepEqual(won.programs, ['네이버페이']);
  assert.equal(won.audience, '전체', '페이 적립은 누구나 가입 가능하므로 멤버십으로 바꾸지 않음');
  const pct = v({ menu: '전 메뉴', regular_price: null, coupon_price: null, discount_type: 'point_back', discount_value: 5, evidence: '네이버페이로 결제하면 5% 적립' });
  assert.equal(pct.discount_rate, 5);
  assert.equal(benefitKind(pct), 3);
  const none = v({ menu: '전 메뉴', regular_price: null, coupon_price: null, discount_type: 'point_back', discount_value: null, evidence: '네이버페이 적립' });
  assert.equal(none.status, 'pending');
});

test('제외 규칙: 외부 배달앱 전용 · 특정 카드 결제 (배달앱 "제외" 문맥은 통과)', () => {
  assert.equal(isDeliveryAppOnly('[푸라닭 X 쿠팡이츠] 5,000원 할인'), true);
  assert.equal(isDeliveryAppOnly('배달앱(배민·쿠팡이츠) 주문 시 적용 불가'), false);
  assert.equal(isDeliveryAppOnly('자체 배달 3,000원 할인'), false);
  assert.equal(v({ conditions: '쿠팡이츠 전용' }).status, 'rejected');
  const card = v({ conditions: '하나나라사랑카드로 결제 시 30% 할인' });
  assert.equal(card.status, 'rejected');
  assert.ok(card.issues.includes('특정 카드 결제 할인'));
});

test('중복 사용 · 사용 방법', () => {
  assert.equal(detectStackable('타 할인 / 제휴 중복 적용 불가'), 'no');
  assert.equal(detectStackable('다른 쿠폰과 중복 사용 가능'), 'yes');
  assert.equal(detectStackable('1인 1회'), '');
  const c = v({ conditions: '타 쿠폰 중복 불가', how_to_use: '맥도날드 앱 쿠폰함에서 받아 키오스크에서 바코드 스캔' });
  assert.equal(c.stackable, 'no');
  assert.match(c.how_to_use, /키오스크/);
  assert.equal(v({ stackable: true }).stackable, 'yes', 'AI가 명시하면 그대로');
});

test('쿠폰 id: 조건 없는 쿠폰은 예전 id 그대로, 통신사 조건이 다르면 다른 쿠폰', () => {
  const c = v({});
  const old = 'c_' + createHash('sha1').update([c.brand, menuKey(c.menu), c.item_type, c.audience, c.end_date || ''].join('|')).digest('hex').slice(0, 12);
  assert.equal(couponId(c), old);
  const skt = v({ menu: '전 메뉴', regular_price: null, coupon_price: null, discount_type: 'percent', discount_value: 20, evidence: 'T멤버십 20%' });
  const kt = v({ menu: '전 메뉴', regular_price: null, coupon_price: null, discount_type: 'percent', discount_value: 15, evidence: 'KT 멤버십 15%' });
  assert.notEqual(couponId(skt), couponId(kt));
});

test('중복 합치기: 전체/전체 메뉴, 같은 할인을 통신사별로 공지하면 하나로 + 프로그램 모음', () => {
  assert.equal(isGenericMenu('전체'), true);
  assert.equal(isGenericMenu('전체 메뉴'), true);
  assert.equal(isGenericMenu('모든 피자'), true);
  assert.equal(isGenericMenu('불고기 버거'), false);
  const a = v({ menu: '전체', regular_price: null, coupon_price: null, discount_type: 'percent', discount_value: 20, evidence: 'T 멤버십 20% 할인' }, { brand: '반올림피자', category: '피자' });
  const b = v({ menu: '전체 메뉴', regular_price: null, coupon_price: null, discount_type: 'percent', discount_value: 20, evidence: 'KT 멤버십 20% 할인' }, { brand: '반올림피자', category: '피자' });
  const out = mergeSimilar([a, b]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].programs, ['SKT', 'KT']);
  const c = v({ menu: '전체 메뉴', regular_price: null, coupon_price: null, discount_type: 'percent', discount_value: 15, evidence: 'KT 멤버십 15% 할인' }, { brand: '반올림피자', category: '피자' });
  assert.equal(mergeSimilar([a, c]).length, 2, '할인 크기가 다르면 합치지 않음');
});

test('내가 쓸 수 있는 쿠폰: 통신사·페이는 하나만 있으면 됨, 개인 쿠폰 제외, 신규가입은 선택', () => {
  const multi = { programs: ['SKT', 'KT', 'LGU+'], audience: '멤버십' };
  assert.equal(usableBy(multi, { programs: ['KT'] }), true);
  assert.equal(usableBy(multi, { programs: [] }), false);
  assert.deepEqual(myPrograms(multi, { programs: ['KT', '네이버페이'] }), ['KT']);
  assert.equal(usableBy({ audience: '전체', programs: [] }, {}), true);
  assert.equal(usableBy({ audience: '개인', programs: [] }, {}), false);
  assert.equal(usableBy({ audience: '신규회원', programs: [] }, {}), true);
  assert.equal(usableBy({ audience: '신규회원', programs: [] }, { newMember: false }), false);
  assert.equal(isOpenToEveryone({ audience: '전체', programs: ['네이버페이'] }), false);
});

test('화면 필터: 내 혜택 · 통신사·페이 · 가격대 · 새로 생긴 · 곧 끝나는 · 찜', () => {
  const today = '2026-10-27';
  const list = [
    { id: 'a', brand: '맥도날드', category: '햄버거', menu: '불고기 버거', coupon_price: 2500, audience: '전체', programs: [], end_date: '2026-10-28', first_seen: '2026-10-26T15:10:00Z' },
    { id: 'b', brand: '도미노피자', category: '피자', menu: '모든 피자', coupon_price: null, discount_type: 'percent', discount_rate: 50, audience: '멤버십', programs: ['KT'], end_date: '2026-10-30', first_seen: '2026-10-01T00:00:00Z' },
    { id: 'c', brand: '피자헛', category: '피자', menu: '콰트로 치즈 슈프림', coupon_price: 26900, audience: '전체', programs: [], end_date: '2026-12-31', first_seen: '2026-10-20T00:00:00Z' },
  ];
  const ids = (f, prof) => list.filter((c) => matchesFilters(c, f, { today, profile: prof })).map((c) => c.id);
  assert.deepEqual(ids({ mine: true }, { programs: [] }), ['a', 'c']);
  assert.deepEqual(ids({ mine: true }, { programs: ['KT'] }), ['a', 'b', 'c']);
  assert.deepEqual(ids({ programsOnly: true }), ['b']);
  assert.deepEqual(ids({ maxPrice: 10000 }), ['a']);
  assert.deepEqual(ids({ fresh: true }), ['a'], '첫 방문: 오늘(KST 10/27 00:10) 처음 보인 것');
  const since = (f, s) => list.filter((c) => matchesFilters(c, f, { today, since: s })).map((c) => c.id);
  assert.deepEqual(since({ fresh: true }, '2026-10-15T00:00:00Z'), ['a', 'c'], '지난 방문(10/15) 이후 생긴 것');
  assert.deepEqual(ids({ endingSoon: true }), ['a', 'b']);
  assert.deepEqual(ids({ ids: new Set(['c']) }), ['c']);
  assert.deepEqual(ids({ q: 'kt멤버십' }), ['b'], '프로그램 이름으로도 검색');
});

test('추천순: 내 통신사·페이 혜택 → 누구나 → 조건부 → 못 쓰는 것, 그 안에서 쿠폰가 → 할인율 → 할인액 → 적립 → 증정', () => {
  const today = '2026-10-27';
  const L = [
    { id: 'gift', audience: '전체', programs: [], discount_type: 'free_item', coupon_price: null },
    { id: 'pct', audience: '전체', programs: [], discount_type: 'percent', discount_rate: 30, coupon_price: null },
    { id: 'pct2', audience: '전체', programs: [], discount_type: 'percent', discount_rate: 40, coupon_price: null },
    { id: 'kt', audience: '멤버십', programs: ['KT'], discount_type: 'percent', discount_rate: 50, coupon_price: null },
    { id: 'cheap', audience: '전체', programs: [], discount_type: 'price', coupon_price: 1000 },
    { id: 'amt', audience: '전체', programs: [], discount_type: 'amount', discount_value: 5000, coupon_price: null },
    { id: 'new', audience: '신규회원', programs: [], discount_type: 'price', coupon_price: 500 },
  ];
  assert.deepEqual(sortCoupons(L, 'best', today).map((c) => c.id), ['cheap', 'pct2', 'pct', 'amt', 'gift', 'new', 'kt']);
  assert.deepEqual(sortCoupons(L, 'best', today, { programs: ['KT'] }).map((c) => c.id), ['kt', 'cheap', 'pct2', 'pct', 'amt', 'gift', 'new'], '설정한 통신사 혜택이 맨 위');
  assert.deepEqual(sortCoupons(L, 'best', today, { programs: [] }).map((c) => c.id).at(-1), 'kt', '쓸 수 없는 혜택은 맨 뒤');
});

test('영양성분 매칭: 정확히 같거나 사이즈만 다를 때만, 세트는 메인 메뉴 기준, 비슷한 다른 메뉴는 붙이지 않음', () => {
  const items = [
    { brand: '맥도날드', name: '불고기버거', kcal: 386 },
    { brand: '맥도날드', name: '더블 불고기 버거', kcal: 621 },
    { brand: '맥도날드', name: '아이스 드립 커피', kcal: 5 },
    { brand: '맥도날드', name: '빅맥', kcal: 583 },
    { brand: '맥도날드', name: '치즈버거', kcal: 311 },
    { brand: '버거킹', name: '불고기버거', kcal: 400 },
  ];
  const m = (menu, item_type = '단품', brand = '맥도날드') => matchNutrition({ brand, menu, item_type }, items);
  assert.equal(m('불고기 버거').item.kcal, 386);
  assert.equal(m('불고기 버거').basis, 'exact');
  assert.equal(m('불고기 버거', '단품', '버거킹').item.kcal, 400, '브랜드가 다르면 다른 메뉴');
  assert.equal(m('아이스 드립 커피 M').basis, 'size');
  const set = m('빅맥 세트', '세트');
  assert.equal(set.item.name, '빅맥');
  assert.equal(set.set, true);
  assert.equal(m('더블치즈버거'), null, '치즈버거와 다른 메뉴');
  assert.equal(m('전체 메뉴'), null);
  assert.equal(m('룽고, 카페라떼'), null, '여러 메뉴');
  assert.equal(m('핫크리스피치킨 외 9종'), null);
  assert.equal(m('불고기 버거', '단품', '롯데리아'), null);
  assert.equal(sodiumPercent(1010), 51);
});

test('검토 보완: 제외 문맥의 통신사·카드 이름은 조건이 아님, 등급별 1천원당은 낮은 값, 여러 브랜드 출처 카테고리', () => {
  assert.deepEqual(detectPrograms('T멤버십 등 제휴 할인과 중복 불가'), []);
  assert.deepEqual(detectPrograms('네이버페이 결제 시 사용 불가, 앱 주문 전용'), []);
  assert.deepEqual(detectPrograms('T멤버십 회원 전용, 타 할인 중복 불가'), ['SKT']);
  assert.deepEqual(detectPrograms('삼성카드 결제 할인 제외'), []);
  const open = v({ conditions: '통신사 제휴(SKT·KT) 할인과 중복 불가' });
  assert.deepEqual(open.programs, []);
  assert.equal(open.audience, '전체', '누구나 쓰는 쿠폰이 통신사 전용으로 바뀌지 않음');
  assert.equal(v({ conditions: '삼성카드 결제 할인과 중복 적용 안 됨' }).status, 'published');
  assert.equal(perThousandRate('VIP 1천원당 150원, SILVER 1천원당 50원'), 5);
  const pb = normalizeAndValidate({ brand: '파리바게뜨', menu: '전 제품', discount_type: 'point_back', discount_value: 500, evidence: '500원 적립', confidence: 0.9 },
    { now: NOW, category: '카페', programs: ['네이버페이'] });
  assert.equal(pb.category, '디저트', '네이버페이 카페 캠페인에 나온 베이커리는 디저트로');
});

test('id 안정화: AI 표기가 달라도 같은 행사면 예전 id를 이어 씀, 다른 행사·기간·크기는 새 id', async () => {
  const { stabilizeIds } = await import('../src/engine.js');
  const existing = [
    { id: 'c_old_zinger', brand: 'KFC', menu: '징거', discount_type: 'price', coupon_price: 1000, audience: '신규회원', end_date: '' },
    { id: 'c_old_all', brand: '반올림피자', menu: '전체 메뉴', discount_type: 'amount', discount_value: 4000, audience: '전체', end_date: '2027-08-03' },
    { id: 'c_old_dom', brand: '도미노피자', menu: '모든 피자', discount_type: 'percent', discount_value: 40, audience: '전체', end_date: '' },
  ];
  const today = [
    { id: 'c_new1', status: 'published', brand: 'KFC', menu: '징거 단품', discount_type: 'price', coupon_price: 1000, audience: '신규회원', end_date: null },
    { id: 'c_new2', status: 'published', brand: '반올림피자', menu: '전체', discount_type: 'amount', discount_value: 4000, audience: '전체', end_date: '2027-08-03' },
    { id: 'c_new3', status: 'published', brand: '도미노피자', menu: '모든 피자', discount_type: 'percent', discount_value: 50, audience: '전체', end_date: null },
    { id: 'c_new4', status: 'published', brand: '반올림피자', menu: '전체 메뉴', discount_type: 'amount', discount_value: 4000, audience: '전체', end_date: '2026-11-30' },
    { id: 'c_new5', status: 'rejected', brand: 'KFC', menu: '징거', discount_type: 'price', coupon_price: 1000, audience: '신규회원' },
  ];
  const r = stabilizeIds(today, existing);
  assert.deepEqual(r.list.map((c) => c.id), ['c_old_zinger', 'c_old_all', 'c_new3', 'c_new4', 'c_new5']);
  assert.equal(r.reused, 2);
  // 같은 예전 쿠폰을 두 번 쓰지 않음
  const twice = stabilizeIds([today[0], { ...today[0], id: 'c_new9', menu: '징거 버거' }], existing);
  assert.deepEqual(twice.list.map((c) => c.id), ['c_old_zinger', 'c_new9']);
});

test('등급별 할인은 가장 낮은 등급 값으로 · 메뉴 자리에 프로그램 이름만 있으면 전 메뉴 (10/27 시험 실행에서 발견)', async () => {
  const { lowestTierPercent } = await import('../src/engine.js');
  assert.equal(lowestTierPercent('VIP 30%, GOLD·SILVER 20% 할인'), 20);
  assert.equal(lowestTierPercent('VIP·GOLD 15%(1일 1회), SILVER 5%(1일 1회)'), 5);
  assert.equal(lowestTierPercent('전 메뉴 30% 할인, 2잔 이상 10% 추가'), null, '등급 표기 없으면 건드리지 않음');
  const mega = normalizeAndValidate({ brand: '메가MGC커피', menu: '전 메뉴', discount_type: 'percent', discount_value: 20, program_note: 'VIP 20%, GOLD·SILVER 10%', evidence: '메가MGC커피 VIP 20% GOLD·SILVER 10%', evidence_source: 'text', confidence: 0.9 },
    { now: NOW, programs: ['SKT'], pageText: '메가MGC커피 VIP 20% GOLD·SILVER 10% 할인' });
  assert.equal(mega.discount_rate, 10);
  assert.equal(mega.status, 'published', mega.issues.join('/'));
  assert.ok(mega.issues.includes('등급별 할인 중 가장 낮은 값으로 표시'));
  const hp = v({ menu: '해피포인트 적립', regular_price: null, coupon_price: null, discount_type: 'point_back', discount_value: 5, evidence: '해피포인트 5% 적립' }, { brand: '배스킨라빈스', category: '디저트' });
  assert.equal(hp.menu, '전 메뉴');
  assert.deepEqual(hp.programs, ['해피포인트']);
  assert.equal(v({ menu: '해피포인트 블록팩' }, { brand: '배스킨라빈스', category: '디저트' }).menu, '해피포인트 블록팩', '실제 메뉴 이름은 그대로');
});

test('과장 방지 (2차 시험 실행에서 발견): 최대 표기, 등급별 할인액, 머니·포인트 지급은 적립', async () => {
  const { lowestTierAmount, isUpTo } = await import('../src/engine.js');
  assert.equal(lowestTierAmount('LG유플러스 VVIP 고객 패밀리 9천원 OFF, VIP고객 패밀리 6천원OFF'), 6000);
  assert.equal(lowestTierAmount('패밀리 26,000원 → 9천원 할인'), null, '등급 표기 없으면 그대로');
  assert.equal(isUpTo('🍚밥 먹자! 파바 고? 최대 30% 선착순 혜택!', 30), true);
  assert.equal(isUpTo('최대 5,000원 할인', 5000), true);
  assert.equal(isUpTo('최대 5천원 혜택', 5000), true);
  assert.equal(isUpTo('30% 할인 (최대 3천원)', 30), false, '할인 상한(max_discount)은 최대 표기가 아님');
  const fam = v({ menu: '패밀리', regular_price: 26000, coupon_price: 17000, discount_type: 'amount', discount_value: 9000, audience: '멤버십', evidence: 'LG유플러스 VVIP 고객 패밀리 9천원 OFF, VIP고객 패밀리 6천원OFF' }, { brand: '배스킨라빈스', category: '디저트' });
  assert.equal(fam.discount_value, 6000);
  assert.equal(fam.coupon_price, 20000, '쿠폰가도 낮은 등급 기준으로 다시 계산');
  assert.deepEqual(fam.programs, ['LGU+']);
  const pb = v({ menu: '전 메뉴', regular_price: null, coupon_price: null, discount_type: 'percent', discount_value: 30, evidence: '파바 고? 최대 30% 선착순 혜택!' }, { brand: '파리바게뜨', category: '디저트' });
  assert.match(pb.program_note, /^최대/);
  const money = v({ menu: '전 메뉴', regular_price: null, coupon_price: null, discount_type: 'amount', discount_value: 3000, evidence: '해피페이 머니 가입 고객 대상 3천 머니 지급' }, { brand: '배스킨라빈스', category: '디저트' });
  assert.equal(money.discount_type, 'point_back');
  assert.equal(money.discount_value, 3000);
});

test('실제 수집 검토 (10/27 저녁 전체 실행에서 발견): 지난 기간, 다른 결제수단, 적립 안내 이름, 등급별 가격, 최대 홍보 중복', async () => {
  const { inferPeriod, needsOtherPayment, accrualOnlyPrograms, tierPercents } = await import('../src/engine.js');
  // 1) 근거 문구의 '(8/19~8/21)' → 이미 끝난 행사는 버림
  assert.deepEqual(inferPeriod('빽다방 20주년 기념 아메리카노(ICED) 1천원에 만나보세요! (8/19~8/21)', NOW), { start: '2026-08-19', end: '2026-08-21' });
  assert.deepEqual(inferPeriod('가입하고 아메리카노(ICED) 500원에!(~12/31)', NOW), { start: null, end: '2026-12-31' });
  assert.deepEqual(inferPeriod('12/20~1/10 겨울 한정', NOW), { start: '2026-12-20', end: '2027-01-10' });
  assert.deepEqual(inferPeriod('10/30(목)~11/2(일)', NOW), { start: '2026-10-30', end: '2026-11-02' });
  assert.equal(inferPeriod('말차 전 메뉴 2,026원 프로모션(1/2~)', NOW), null, '시작만 있으면 모름');
  assert.equal(inferPeriod('정상가 4,900원~5,900원', NOW), null);
  assert.equal(inferPeriod('1.5~2배 적립', NOW), null, '일만 있는 범위는 해를 넘기지 않음');
  const paik = v({ menu: '아메리카노(ICED)', regular_price: null, coupon_price: 1000, end_date: null, evidence: '빽다방 20주년 기념 아메리카노(ICED) 1천원에 만나보세요! (8/19~8/21)' }, { brand: '빽다방', category: '카페' });
  assert.equal(paik.status, 'rejected');
  assert.ok(paik.issues.includes('이미 종료'));
  const paikNew = v({ menu: '아메리카노(ICED)', regular_price: null, coupon_price: 500, end_date: null, audience: '신규회원', evidence: '[빽다방 앱 신규가입 이벤트] 가입하고 아메리카노(ICED) 500원에 만나보세요!(~12/31)' }, { brand: '빽다방', category: '카페' });
  assert.equal(paikNew.end_date, '2026-12-31');
  assert.ok(paikNew.issues.includes('기간은 근거 문구에서 읽음'));
  assert.equal(v({ end_date: '2026-11-10', evidence: '불고기 버거 2,500원 (8/19~8/21)' }).end_date, '2026-11-10', 'AI가 읽은 날짜가 있으면 그대로');

  // 2) 우리 목록 밖 결제수단 할인은 버림 (조건 없는 쿠폰처럼 보이므로)
  assert.equal(needsOtherPayment('페이코인 앱 결제 시 20% 추가 할인!'), true);
  assert.equal(needsOtherPayment('삼성페이 결제 불가'), false);
  assert.equal(needsOtherPayment('앱 쿠폰 3천원 할인'), false);
  const payco = v({ menu: '전 메뉴', regular_price: null, coupon_price: null, discount_type: 'percent', discount_value: 20, conditions: '페이코인 앱 결제 시', evidence: '페이코인 앱 결제 시 20% 추가 할인!' }, { brand: '도미노피자', category: '피자' });
  assert.equal(payco.status, 'rejected');
  assert.ok(payco.issues.includes('특정 결제수단 할인'));

  // 3) '해피포인트 0.1% 적립' 안내만 있는 가격 행사는 해피포인트 전용이 아님 (적립형 쿠폰은 그대로)
  assert.deepEqual(accrualOnlyPrograms('1인당 2세트 한정 · 해피포인트 0.1%적립'), ['해피포인트']);
  assert.deepEqual(accrualOnlyPrograms('해피포인트플러스 결제 시 50% OFF'), []);
  const block = v({ menu: '블록팩 4개', regular_price: 17600, coupon_price: 12000, programs: ['해피포인트'], program_note: '해피포인트 0.1%적립', evidence: '블록팩 4개 17,600원 12,000원' }, { brand: '배스킨라빈스', category: '디저트' });
  assert.deepEqual(block.programs, []);
  const half = v({ menu: '배라 전 제품', regular_price: null, coupon_price: null, discount_type: 'percent', discount_value: 50, programs: ['해피포인트'], evidence: '해피포인트플러스 결제 시, 배라 전 제품 50% OFF' }, { brand: '배스킨라빈스', category: '디저트' });
  assert.deepEqual(half.programs, ['해피포인트']);
  const pb = v({ menu: '전 메뉴', regular_price: null, coupon_price: null, discount_type: 'point_back', discount_value: 5, discount_unit: 'percent', evidence: '해피포인트 적립 대상으로 결제금액의 5% 적립됩니다.' }, { brand: '배스킨라빈스', category: '디저트' });
  assert.deepEqual(pb.programs, ['해피포인트']);

  // 4) 통신사 등급별 '가격'은 VIP 가격 → 가장 낮은 등급 %로
  assert.deepEqual(tierPercents('VIP 50% 할인 (2,150원), GOLD/SILVER 30% 할인 (1,290원)'), [30, 50]);
  const single = v({ menu: '싱글레귤러', regular_price: null, coupon_price: 2150, audience: '멤버십', programs: ['SKT'], program_note: 'VIP 50% 할인 (2,150원), GOLD/SILVER 30% 할인 (1,290원)', evidence: 'VIP 50% 할인 (2,150원)' }, { brand: '배스킨라빈스', category: '디저트', programs: ['SKT'] });
  assert.equal(single.discount_type, 'percent');
  assert.equal(single.discount_value, 30);
  assert.equal(single.coupon_price, null);
  assert.ok(single.issues.includes('등급별 할인 중 가장 낮은 값으로 표시'));
  const sameTier = v({ menu: '싱글레귤러', regular_price: null, coupon_price: 2150, audience: '멤버십', programs: ['SKT'], program_note: '전 등급 50% (2,150원)', evidence: '싱글레귤러 50% 할인 2,150원' }, { brand: '배스킨라빈스', category: '디저트', programs: ['SKT'] });
  assert.equal(sameTier.discount_type, 'price', '등급 차이가 없으면 가격 그대로');

  // 5) '통신사 최대 30%'와 '일반 15%'가 같은 행사로 따로 잡히면 낮은 값 하나만
  const ctx = { brand: '파파존스', category: '피자' };
  const up = { ...v({ menu: 'NEW불닭 까르보 치킨', regular_price: null, coupon_price: null, discount_type: 'percent', discount_value: 30, audience: '멤버십', programs: ['SKT', 'KT', 'LGU+'], evidence: '불닭 까르보 치킨 통신사 최대 30% 할인 이벤트', source_url: 'https://a' }, ctx), id: 'u' };
  const low = { ...v({ menu: '불닭 까르보 치킨', regular_price: null, coupon_price: null, discount_type: 'percent', discount_value: 30, audience: '멤버십', programs: ['SKT', 'KT', 'LGU+'], evidence: 'T Membership VIP 30% 일반 15% kt membership VIP 30% 일반 15%', source_url: 'https://b' }, ctx), id: 'l' };
  assert.match(up.program_note, /^최대/);
  assert.equal(low.discount_value, 15);
  const merged = mergeSimilar([up, low]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].discount_value, 15);
  assert.match(merged[0].source_url, /https:\/\/a/);
  const other = { ...v({ menu: '전 메뉴', regular_price: null, coupon_price: null, discount_type: 'percent', discount_value: 10, audience: '멤버십', programs: ['SKT'], evidence: 'SKT 10% 할인' }, ctx), id: 'o' };
  assert.equal(mergeSimilar([up, other]).length, 2, '프로그램이 다르면 다른 행사');
});
