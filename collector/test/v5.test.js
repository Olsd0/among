// v5: 쿠폰과 함께 온 사진 · 소식(핫딜) · 홈 상단 선정
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickImage, isNonPhoto, normalizeNews, linkNews, pickHeadlines, benefitLabel, normalizeAndValidate, mergeSimilar } from '../src/engine.js';
import { newsId, newsHash, contentHash } from '../src/ids.js';

const NOW = new Date('2026-10-28T03:00:00Z'); // KST 10/28 12:00
const TODAY = '2026-10-28';

test('사진: 쿠폰을 읽은 그 페이지의 이미지 중 메뉴 이름·근거 문구 옆에 있는 것만, 로고·아이콘·띠 배너는 제외', () => {
  const page = {
    images: [
      { src: 'https://img.brand.co.kr/common/logo.png', alt: '맥도날드', w: 400, h: 200, near: '맥도날드' },
      { src: 'https://img.brand.co.kr/promo/bulgogi.jpg', alt: '불고기 버거', w: 600, h: 400, near: '불고기 버거 각 2500원' },
      { src: 'https://img.brand.co.kr/promo/snackwrap.jpg', alt: '', w: 600, h: 400, near: '치킨 모짜렐라 스낵랩 각 2500원' },
      { src: 'https://img.brand.co.kr/promo/strip.jpg', alt: '불고기 버거', w: 1200, h: 150, near: '' },
      { src: 'http://img.brand.co.kr/promo/apple.jpg', alt: '애플 파이', w: 600, h: 400, near: '' },
      { src: 'https://img.brand.co.kr/btn_more.png', alt: '더보기', w: 300, h: 200, near: '불고기 버거' },
    ],
    ogImage: 'https://img.brand.co.kr/og/share.jpg',
  };
  assert.equal(pickImage({ menu: '불고기 버거' }, page, '맥도날드'), 'https://img.brand.co.kr/promo/bulgogi.jpg');
  assert.equal(pickImage({ menu: '치킨 모짜렐라 스낵랩', evidence: '치킨 모짜렐라 스낵랩 Chicken Mozzarella Snack Wrap 각 2500원' }, page, '맥도날드'), 'https://img.brand.co.kr/promo/snackwrap.jpg');
  assert.equal(pickImage({ menu: '애플 파이' }, page, '맥도날드'), '', 'http 이미지는 화면에서 막히므로 쓰지 않음');
  assert.equal(pickImage({ menu: '맥너겟 4조각' }, page, '맥도날드'), '', '맞는 사진이 없으면 사진 없음 (목록 페이지의 og:image로 채우지 않음)');
  assert.equal(pickImage({ menu: '전 메뉴' }, page, '맥도날드'), '', "'전 메뉴'는 메뉴 사진을 고르지 않음");
  // 행사 1개짜리 상세 페이지는 공유용 대표 이미지
  assert.equal(pickImage({ menu: '전 메뉴' }, { ...page, isDetail: true }, '맥도날드'), 'https://img.brand.co.kr/og/share.jpg');
  assert.equal(pickImage({ menu: '전 메뉴' }, { isDetail: true, ogImage: 'https://x.co.kr/images/og_default.png', images: [] }, 'X'), '', '기본 공유 이미지는 제외');
  assert.equal(isNonPhoto({ src: 'https://a.kr/p.svg', w: 500, h: 500 }), true);
  assert.equal(isNonPhoto({ src: 'https://a.kr/detail_long.jpg', w: 750, h: 4000 }), true, '세로로 긴 상세 통이미지');
  assert.equal(isNonPhoto({ src: 'https://a.kr/food.jpg', alt: '도미노피자', w: 500, h: 300 }, '도미노피자'), true, '대체텍스트가 브랜드 이름뿐 = 로고');
  assert.equal(isNonPhoto({ src: 'https://www.puradakchicken.com/upload/mainbanner/260715_%EB%A9%94%EC%9D%B8%ED%95%98%EB%8B%A8_%EC%88%98%EC%83%81%EB%82%B4%EC%97%AD_m.png' }), true, '홈 메인 배너(수상 내역)');
  assert.equal(isNonPhoto({ src: 'https://www.kfckorea.com/nas/popup/intro_img03.png' }), true, '팝업');
  assert.equal(isNonPhoto({ src: 'https://www.kfckorea.com/nas/event/2026/10/01/Yaf7bi1GHB5S.png' }), false, '행사 이미지는 그대로');
});

test('사진: 수집 경로 — 브랜드 자체 출처만, 같은 쿠폰이 합쳐지면 사진 있는 쪽을 이어받음, 사진이 바뀌면 변경으로 봄', () => {
  const base = { menu: '불고기 버거', item_type: '단품', regular_price: 3800, coupon_price: 2500, discount_type: 'price', channels: [], audience: '전체', end_date: '2026-11-10', evidence: '불고기 버거 2,500원', evidence_source: 'image', confidence: 0.95 };
  const a = { ...normalizeAndValidate(base, { now: NOW, brand: '맥도날드', category: '햄버거' }), id: 'a', image_url: '' };
  const b = { ...normalizeAndValidate({ ...base, menu: '불고기버거' }, { now: NOW, brand: '맥도날드', category: '햄버거' }), id: 'b', image_url: 'https://x.kr/b.jpg' };
  const m = mergeSimilar([a, b]);
  assert.equal(m.length, 1);
  assert.equal(m[0].image_url, 'https://x.kr/b.jpg');
  assert.notEqual(contentHash({ ...a, image_url: '' }), contentHash({ ...a, image_url: 'https://x.kr/b.jpg' }));
});

test('소식: 근거가 페이지에 있는 기간 한정 행사만 게시, 지난 행사·카드·배달앱·혜택 아닌 공지는 버림, 라벨 숫자 확인', () => {
  const pageText = '매주 화요일은 도미노스데이! 모든 피자 포장 40% 할인 (10/28~11/30) 가격 인상 안내 11월 1일부터';
  const ctx = { now: NOW, brand: '도미노피자', category: '피자', sourceId: 'dominos-event', sourceUrl: 'https://d.kr/event', pageText };
  const ok = normalizeNews({ title: '도미노피자 화요일 포장 40%', summary: '매주 화요일 모든 피자를 포장하면 40% 할인', discount_label: '40%', programs: [], evidence: '모든 피자 포장 40% 할인 (10/28~11/30)', evidence_source: 'text', confidence: 0.9 }, ctx);
  assert.equal(ok.status, 'published');
  assert.equal(ok.start_date, '2026-10-28');
  assert.equal(ok.end_date, '2026-11-30');
  assert.equal(ok.discount_label, '40%');
  assert.ok(ok.issues.includes('기간은 근거 문구에서 읽음'));
  const badLabel = normalizeNews({ title: '도미노 50%', summary: '50% 할인', discount_label: '50%', programs: [], evidence: '모든 피자 포장 40% 할인', evidence_source: 'text', confidence: 0.9 }, ctx);
  assert.equal(badLabel.discount_label, '', '페이지에 없는 숫자 라벨은 지움');
  const old = normalizeNews({ title: '여름 1+1', summary: '여름 행사', discount_label: '1+1', start_date: '2026-08-01', end_date: '2026-08-31', programs: [], evidence: '모든 피자 포장 40% 할인', evidence_source: 'text', confidence: 0.9 }, ctx);
  assert.equal(old.status, 'rejected');
  assert.ok(old.issues.includes('이미 종료'));
  const price = normalizeNews({ title: '가격 조정 안내', summary: '11월 1일부터 일부 메뉴 가격이 오름', discount_label: '', programs: [], evidence: '가격 인상 안내 11월 1일부터', evidence_source: 'text', confidence: 0.9 }, ctx);
  assert.equal(price.status, 'rejected', '가격 인상 공지는 혜택 소식이 아님');
  const ghost = normalizeNews({ title: '도미노 반값', summary: '반값', discount_label: '', programs: [], evidence: '전 메뉴 반값 이벤트 진행', evidence_source: 'text', confidence: 0.95 }, ctx);
  assert.equal(ghost.status, 'pending', '근거 문구가 페이지에 없으면 보류');
  const card = normalizeNews({ title: '현대카드 20%', summary: '현대카드 결제 시 20% 청구 할인', programs: [], evidence: '현대카드 20% 청구 할인', evidence_source: 'image', confidence: 0.9 }, ctx);
  assert.equal(card.status, 'rejected');
  // 여러 브랜드 출처(네이버페이)의 공통 행사는 프로그램 이름으로
  const np = normalizeNews({ brand: '', title: '카페 현장결제 첫 이용 적립', summary: '네이버페이 현장결제를 처음 쓰면 최대 5,000원 적립', discount_label: '최대 5,000원 적립', end_date: '2026-11-01', programs: ['네이버페이'], evidence: '현장결제가 처음이라면 최대 5,000원 적립', evidence_source: 'text', confidence: 0.9 },
    { now: NOW, brand: '', category: '카페', programs: ['네이버페이'], sourceId: 'npay-cafe', sourceUrl: 'https://n.kr/c', pageText: '현장결제가 처음이라면 최대 5,000원 적립 월요일 2,000원' });
  assert.equal(np.status, 'published');
  assert.equal(np.brand, '네이버페이');
  assert.deepEqual(np.programs, ['네이버페이']);
});

test('소식 id는 제목이 날마다 달라도 같고, 연결된 쿠폰·사진이 붙는다', () => {
  const n1 = { source_id: 's', brand: '도미노피자', start_date: '2026-10-28', end_date: '2026-11-30', discount_label: '40%', title: '도미노 화요일 40%' };
  const n2 = { ...n1, title: '화요일엔 도미노 포장 40% 할인', discount_label: '40% 할인' };
  assert.equal(newsId(n1), newsId(n2));
  assert.notEqual(newsId(n1), newsId({ ...n1, end_date: '2026-12-31' }));
  const coupons = [
    { id: 'c1', status: 'published', brand: '도미노피자', source_url: 'https://d.kr/event https://d.kr/e/1', image_url: 'https://d.kr/p.jpg', start_date: null, end_date: null, programs: [] },
    { id: 'c2', status: 'published', brand: '피자헛', source_url: 'https://d.kr/event', programs: [] },
    { id: 'c3', status: 'pending', brand: '도미노피자', source_url: 'https://d.kr/event', programs: [] },
  ];
  const [linked] = linkNews([{ ...n1, source_url: 'https://d.kr/event', programs: [], image_url: '' }], coupons);
  assert.deepEqual(linked.related_ids, ['c1']);
  assert.equal(linked.image_url, 'https://d.kr/p.jpg', '소식 페이지에 사진이 없으면 연결된 쿠폰 사진');
  assert.notEqual(newsHash(linked), newsHash({ ...linked, title: '다른 제목' }));
});

test('홈 핫딜: 소식 우선, 긴급(3일 이내·큰 혜택)·새로 시작한 큰 혜택, 같은 브랜드 2장까지, 내 수단으로 못 쓰면 뒤로', () => {
  const c = (o) => ({ status: 'published', audience: '전체', programs: [], start_date: null, end_date: null, first_seen: '2026-10-01T00:00:00Z', discount_rate: null, coupon_price: null, ...o });
  const coupons = [
    c({ id: 'urgent', brand: 'KFC', category: '치킨', menu: '닭껍질튀김', discount_type: 'price', coupon_price: 3900, regular_price: 8000, discount_rate: 51, end_date: '2026-10-29' }),
    c({ id: 'fresh', brand: '파파이스', category: '치킨', menu: '치킨', discount_type: 'free_item', first_seen: '2026-10-28T01:00:00Z' }),
    c({ id: 'small', brand: '맥도날드', category: '햄버거', menu: '맥너겟', discount_type: 'price', coupon_price: 2500, discount_rate: 11, end_date: '2026-10-29' }),
    c({ id: 'kt', brand: '도미노피자', category: '피자', menu: '전 메뉴', discount_type: 'percent', discount_value: 50, discount_rate: 50, programs: ['KT'], end_date: '2026-10-30' }),
    c({ id: 'rel', brand: '교촌치킨', category: '치킨', menu: '허니메뉴 7종', discount_type: 'amount', discount_value: 5000, end_date: '2026-10-31' }),
    c({ id: 'k2', brand: 'KFC', category: '치킨', menu: '징거', discount_type: 'free_item', end_date: '2026-10-28' }),
    c({ id: 'k3', brand: 'KFC', category: '치킨', menu: '타워', discount_type: 'free_item', end_date: '2026-10-28' }),
    c({ id: 'gone', brand: 'A', category: '피자', menu: 'x', discount_type: 'free_item', end_date: '2026-10-20' }),
  ];
  const news = [{ id: 'n1', status: 'published', brand: '교촌치킨', category: '치킨', title: '교촌 허니메뉴 최대 5천원 할인', summary: '10/31까지', discount_label: '최대 5,000원', start_date: '2026-10-22', end_date: '2026-10-31', programs: [], related_ids: ['rel'], first_seen: '2026-10-27T15:00:00Z' }];
  const h = pickHeadlines(coupons, news, { today: TODAY });
  const ids = h.map((x) => x.id);
  assert.equal(h[0].kind, 'news');
  assert.ok(ids.includes('fresh'));
  assert.ok(!ids.includes('rel'), '소식에 연결된 쿠폰은 따로 올리지 않음');
  assert.ok(!ids.includes('small'), '작은 혜택은 마감 임박이어도 제외');
  assert.ok(!ids.includes('gone'));
  assert.equal(h.filter((x) => x.brand === 'KFC').length, 2, '같은 브랜드 2장까지');
  assert.ok(!ids.includes('urgent'), 'KFC는 점수가 더 높은 2장(오늘 마감)만');
  assert.equal(pickHeadlines([coupons[0]], [], { today: TODAY })[0].reason, 'D-1');
  assert.equal(h.find((x) => x.id === 'k2').reason, '오늘 마감');
  assert.equal(h.find((x) => x.id === 'fresh').label, '증정');
  const mine = pickHeadlines(coupons, news, { today: TODAY, profile: { programs: ['SKT'] } });
  assert.equal(mine.at(-1).id, 'kt', 'KT 전용은 SKT 사용자에게 맨 뒤');
});

test('혜택 한 줄 표시', () => {
  assert.equal(benefitLabel({ discount_type: 'free_item', menu: '치킨 1+1' }), '1+1');
  assert.equal(benefitLabel({ discount_type: 'price', coupon_price: 2500, discount_rate: 34 }), '34%');
  assert.equal(benefitLabel({ discount_type: 'price', coupon_price: 2026, discount_rate: null }), '2,026원');
  assert.equal(benefitLabel({ discount_type: 'amount', discount_value: 5000, program_note: '최대 (조건에 따라 다름)' }), '최대 5,000원 할인');
  assert.equal(benefitLabel({ discount_type: 'point_back', discount_value: 2000 }), '2,000원 적립');
  assert.equal(benefitLabel({ discount_type: 'point_back', discount_value: 5, discount_rate: 5 }), '5% 적립');
});

test('핫딜 소식에 라벨이 없을 때 다른 연결 쿠폰의 금액을 대신 표시하지 않는다', () => {
  const coupons = [{ id: 'c1', brand: '반올림피자', discount_type: 'amount', discount_value: 4000, audience: '전체', programs: [] }];
  const news = [{ id: 'n1', brand: '반올림피자', title: '매주 수요일 반올림데이 최대 6천원 할인', summary: '매주 수요일', discount_label: '', end_date: '2026-10-31', related_ids: ['c1'], programs: [] }];
  assert.equal(pickHeadlines(coupons, news, { today: TODAY })[0].label, '');
  news[0].discount_label = '최대 6천원';
  assert.equal(pickHeadlines(coupons, news, { today: TODAY })[0].label, '최대 6천원');
});

test('홈 아이콘 아래 줄: 1+1·증정 / 곧 마감 / 통신사 / 페이·포인트 / 신규가입', async () => {
  const { matchesKind, matchesFilters } = await import('../src/engine.js');
  const c = (o) => ({ discount_type: 'price', audience: '전체', programs: [], end_date: null, ...o });
  assert.equal(matchesKind(c({ discount_type: 'free_item' }), 'free'), true);
  assert.equal(matchesKind(c({ end_date: '2026-10-30' }), 'ending', TODAY), true);
  assert.equal(matchesKind(c({ end_date: '2026-11-30' }), 'ending', TODAY), false);
  assert.equal(matchesKind(c({ programs: ['KT'] }), 'telecom'), true);
  assert.equal(matchesKind(c({ programs: ['해피포인트'] }), 'pay'), true);
  assert.equal(matchesKind(c({ programs: ['SKT'] }), 'pay'), false);
  assert.equal(matchesKind(c({ audience: '신규회원' }), 'new'), true);
  assert.equal(matchesFilters(c({ category: '피자', programs: ['KT'] }), { category: '피자', kind: 'telecom' }, { today: TODAY }), true);
  assert.equal(matchesFilters(c({ category: '피자' }), { category: '피자', kind: 'telecom' }, { today: TODAY }), false);
});

test('소식: 멤버십·결제 출처의 소식은 우리 브랜드이거나 외식·카페 업종만', () => {
  const ctx = { now: NOW, brand: '', category: '', programs: ['SKT'], sourceId: 'tworld-benefit', sourceUrl: 'https://t.kr/b', pageText: 'CGV 영화 50% 할인 T day 배스킨라빈스 싱글레귤러 50% 카페 아메리카노 30%' };
  const base = { summary: '', discount_label: '50%', end_date: '2026-10-31', programs: ['SKT'], evidence_source: 'text', confidence: 0.9 };
  assert.equal(normalizeNews({ ...base, brand: 'CGV', title: 'T day CGV 50%', evidence: 'CGV 영화 50% 할인' }, ctx).status, 'rejected');
  const br = normalizeNews({ ...base, brand: '배스킨라빈스', title: 'T day 배스킨 싱글레귤러 50%', evidence: 'T day 배스킨라빈스 싱글레귤러 50%' }, ctx);
  assert.equal(br.status, 'published');
  assert.equal(br.brand, '배스킨라빈스');
  assert.equal(br.category, '디저트');
  const cafe = normalizeNews({ ...base, brand: '', title: 'T멤버십 카페 30%', discount_label: '30%', evidence: '카페 아메리카노 30%' }, ctx);
  assert.equal(cafe.status, 'published');
  assert.equal(cafe.brand, 'SKT T멤버십');
});

test('핫딜 소식은 기간이 있어야 함: 상시 혜택은 보류, 요일 행사는 그 요일에만, 같은 행사 두 개는 하나로, 긴 라벨은 지움', async () => {
  const { weeklyDay, mergeNews } = await import('../src/engine.js');
  const pageText = '목요일 Special Day 한판 더! 매주 수요일 치킨 1+1 신규 회원 웰컴 쿠폰팩 구매금액 100원당 5포인트 적립';
  const ctx = { now: NOW, brand: 'KFC', category: '치킨', sourceId: 'k', sourceUrl: 'https://k.kr', pageText };
  const evergreen = normalizeNews({ title: 'KFC 신규 회원 웰컴 쿠폰팩', summary: '신규 가입하면 쿠폰 3종', discount_label: '쿠폰 3종', programs: [], evidence: '신규 회원 웰컴 쿠폰팩', evidence_source: 'text', confidence: 0.9 }, ctx);
  assert.equal(evergreen.status, 'pending');
  assert.ok(evergreen.issues.includes('기간 없는 상시 행사'));
  const weekly = normalizeNews({ title: 'KFC 수요일 치킨 1+1', summary: '매주 수요일 치킨 1+1', discount_label: '1+1', programs: [], evidence: '매주 수요일 치킨 1+1', evidence_source: 'text', confidence: 0.9 }, ctx);
  assert.equal(weekly.status, 'published', '요일마다 돌아오는 행사는 기간이 있는 것으로 봄');
  assert.equal(weeklyDay('목요일 Special Day 한판 더'), 4);
  assert.equal(weeklyDay('매주 수요일 치킨 1+1'), 3);
  assert.equal(weeklyDay('수요일 오픈'), null, '요일만 나오고 반복 표현이 없으면 아님');
  const long = normalizeNews({ title: '맥도날드 포인트', summary: '', discount_label: '구매금액 100원당 5포인트 적립', end_date: '2026-11-30', programs: [], evidence: '구매금액 100원당 5포인트 적립', evidence_source: 'text', confidence: 0.9 }, ctx);
  assert.equal(long.discount_label, '');
  // 수요일(10/28)에는 수요일 행사만 핫딜에, 목요일 행사는 빠짐
  const news = [
    { id: 'w3', status: 'published', brand: 'KFC', title: 'KFC 수요일 치킨 1+1', summary: '매주 수요일', discount_label: '1+1', end_date: null, programs: [], related_ids: [] },
    { id: 'w4', status: 'published', brand: '도미노피자', title: '목요일 Special Day 한판 더', summary: '', discount_label: '1+1', end_date: null, programs: [], related_ids: [] },
  ];
  const h = pickHeadlines([], news, { today: TODAY });
  assert.deepEqual(h.map((x) => x.id), ['w3']);
  assert.equal(h[0].reason, '오늘(수)만');
  // 목록·상세에서 두 번 잡힌 같은 행사
  const m = mergeNews([
    { id: 'a', status: 'published', brand: '배스킨라빈스', title: '블록팩 4개 12,000원 특가', discount_label: '12,000원', end_date: '2026-10-30', related_ids: ['c1'], confidence: 0.9 },
    { id: 'b', status: 'published', brand: '배스킨라빈스', title: '배스킨라빈스 블록팩 4개 12,000원 특가', discount_label: '', end_date: '2026-10-30', related_ids: ['c1', 'c2'], image_url: 'https://b.kr/x.jpg', confidence: 0.9 },
    { id: 'c', status: 'published', brand: '배스킨라빈스', title: '31데이 사전예약 혜택', discount_label: '사이즈업', end_date: '2026-10-30', related_ids: ['c9'], confidence: 0.9 },
  ]);
  assert.equal(m.length, 2);
  const keep = m.find((x) => x.id === 'a');
  assert.deepEqual(keep.related_ids, ['c1', 'c2']);
  assert.equal(keep.image_url, 'https://b.kr/x.jpg');
});

test('실제 수집(10/28 11:30)에서 본 것: 경품·초청 이벤트 제외, 몇 달짜리 행사는 핫딜 아님, 카페마다 잡힌 같은 캠페인은 하나로', async () => {
  const { mergeNews } = await import('../src/engine.js');
  const pageText = '뮤지컬 두도시이야기 초청 이벤트 치즈페스타 최대 1만원 할인 8/31~12/31 현장결제가 처음이라면 최대 5,000원 적립';
  const ctx = { now: NOW, brand: '파파존스', category: '피자', sourceId: 'p', sourceUrl: 'https://p.kr', pageText };
  const musical = normalizeNews({ title: '뮤지컬 초청 문화 이벤트', summary: '추첨으로 뮤지컬 티켓 증정', discount_label: '뮤지컬 티켓 1인 2매', end_date: '2026-11-08', programs: [], evidence: '뮤지컬 두도시이야기 초청 이벤트', evidence_source: 'text', confidence: 0.9 }, ctx);
  assert.equal(musical.status, 'rejected');
  assert.ok(musical.issues.includes('경품·추첨 이벤트'));
  const longRun = normalizeNews({ title: '치즈페스타 할인', summary: '', discount_label: '최대 1만원 할인', start_date: '2026-08-31', end_date: '2026-12-31', programs: [], evidence: '치즈페스타 최대 1만원 할인 8/31~12/31', evidence_source: 'text', confidence: 0.9 }, ctx);
  assert.equal(longRun.status, 'pending');
  assert.ok(longRun.issues.includes('기간이 긴 상시성 행사'));
  const camp = (brand, id) => ({ id, status: 'published', source_id: 'npay-cafe', brand, programs: ['네이버페이'], title: '네이버페이 카페 현장결제 포인트 적립', discount_label: '최대 5,000원 적립', end_date: '2026-11-01', related_ids: [id + 'c'], confidence: 0.9 });
  const m = mergeNews([camp('메가MGC커피', 'a'), camp('이디야', 'b'), camp('컴포즈커피', 'c')]);
  assert.equal(m.length, 1);
  assert.equal(m[0].brand, '네이버페이');
  assert.equal(m[0].related_ids.length, 3);
});

test('결제 캠페인 소식은 프로그램 이름으로, 기간이 길어도 요일 행사는 그 요일 핫딜', async () => {
  const ctx = { now: NOW, brand: '', category: '카페', programs: ['네이버페이'], sourceId: 'npay-cafe', sourceUrl: 'https://n.kr', pageText: '현장결제가 처음이라면 최대 5,000원 적립' };
  const n = normalizeNews({ brand: '메가MGC커피', title: '네이버페이 카페 현장결제 포인트 적립', summary: '네이버페이 현장결제 첫 이용 시 최대 5,000원 적립', discount_label: '최대 5,000원 적립', end_date: '2026-11-01', programs: ['네이버페이'], evidence: '현장결제가 처음이라면 최대 5,000원 적립', evidence_source: 'text', confidence: 0.9 }, ctx);
  assert.equal(n.brand, '네이버페이');
  const own = normalizeNews({ brand: '메가MGC커피', title: '메가MGC커피 네이버페이 2천원 적립', summary: '메가MGC커피에서 네이버페이로 결제하면 적립', discount_label: '', end_date: '2026-11-01', programs: ['네이버페이'], evidence: '현장결제가 처음이라면 최대 5,000원 적립', evidence_source: 'text', confidence: 0.9 }, ctx);
  assert.equal(own.brand, '메가MGC커피', '특정 브랜드를 말하는 소식은 그 브랜드');
  const weekly = normalizeNews({ title: '매주 수요일 반올림데이 최대 6천원 할인', summary: '', discount_label: '', start_date: '2024-07-01', end_date: '2027-08-03', programs: [], evidence: '매주 수요일 반올림데이', evidence_source: 'text', confidence: 0.9 },
    { now: NOW, brand: '반올림피자', category: '피자', sourceId: 'b', sourceUrl: 'https://b.kr', pageText: '매주 수요일 반올림데이 최대 6천원 할인' });
  assert.equal(weekly.status, 'published');
  const h = pickHeadlines([], [{ ...weekly, id: 'w', first_seen: '2026-10-01T00:00:00Z' }], { today: TODAY });
  assert.equal(h[0].reason, '오늘(수)만');
  assert.equal(pickHeadlines([], [{ ...weekly, id: 'w' }], { today: '2026-10-29' }).length, 0, '목요일에는 안 보임');
});
