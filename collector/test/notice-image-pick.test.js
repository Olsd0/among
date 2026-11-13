// 핫딜 공지 이미지 자동 선택: 그 공지를 읽은 공식 페이지의 이미지 중 그 공지와 맞는 것만
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNoticeImage, dropSharedNoticeImages, isNonPhoto, noticeImageFor } from '../src/engine.js';
import { dropCommonOg } from '../src/fetch.js';

const img = (src, o = {}) => ({ src: `https://cdn.brand.kr/event/${src}`, alt: '', w: 600, h: 400, near: '', nearLen: 0, ...o });
const card = (text) => ({ near: text.slice(0, 160), nearLen: text.length });

const list = {
  isDetail: false, ogImage: 'https://brand.kr/og.png',
  images: [
    img('a.jpg', card('Stars Full of Heart 2026-10-27 ~ 2026-11-20')),
    img('b.jpg', card('2026 쓱데이 특별전 2026-10-30 ~ 2026-11-08')),
    img('c.jpg', card('딜리버스 만원 별 더블 적립 2026-10-01 ~ 2026-10-31')),
  ],
};

test('목록 카드: 근거 문구가 카드 글과 맞는 이미지만 고른다', () => {
  const n = { brand: '스타벅스', title: '2026 쓱데이 특별전', evidence: '2026 쓱데이 특별전 2026-10-30 ~ 2026-11-08' };
  assert.equal(pickNoticeImage(n, [list], { own: list }), 'https://cdn.brand.kr/event/b.jpg');
  // 원문은 같아도 제목이 다른 행사('온라인 스토어 쓱데이')면 붙이지 않는다 — 스타벅스 목록에 두 행사가 따로 있다
  assert.equal(pickNoticeImage({ ...n, title: '온라인 스토어 쓱데이 Sweet Wonderland' }, [list], { own: list }), '');
  const none = { brand: '스타벅스', title: '겨울 프리퀀시', evidence: '2026 WINTER e-FREQUENCY 이벤트 안내' };
  assert.equal(pickNoticeImage(none, [list], { own: list }), '', '맞는 카드가 없으면 비워 둔다');
});

test('대체텍스트가 제목·근거와 같으면 그 이미지, 다른 페이지(목록)의 썸네일도 같은 출처면 쓴다', () => {
  const thumbs = { isDetail: false, images: [img('pint.png', { alt: '매월 1,2,3일 파인트를 10년전 가격으로 픽업' }), img('pouch.png', { alt: '젤라또 피케 파우치 사전예약' })] };
  const detail = { isDetail: true, ogImage: '', images: [] };
  const n = { brand: '배스킨라빈스', title: '파인트 10년 전 가격 픽업', evidence: '매월 1,2,3일 파인트를 10년전 가격으로 픽업' };
  assert.equal(pickNoticeImage(n, [thumbs, detail], { own: detail, single: true }), 'https://cdn.brand.kr/event/pint.png');
  const byTitle = { brand: '배스킨라빈스', title: '젤라또 피케 파우치 사전예약', evidence: '사전예약 시 3,900원!' };
  assert.equal(pickNoticeImage(byTitle, [thumbs], {}), 'https://cdn.brand.kr/event/pouch.png');
});

test('주변 글이 목록 전체이면(카드 하나가 아니면) 글로 고르지 않는다', () => {
  const whole = 'Stars Full of Heart 2026-10-27 ~ 2026-11-20 2026 쓱데이 특별전 2026-10-30 ~ 2026-11-08 '.repeat(5);
  const page = { images: [img('x.jpg', card(whole)), img('y.jpg', card(whole))] };
  const n = { brand: '스타벅스', title: 'Stars Full of Heart', evidence: 'Stars Full of Heart 2026-10-27 ~ 2026-11-20' };
  assert.equal(pickNoticeImage({ ...n, title: '하트 별 적립' }, [page], {}), '');
});

test('같은 점수의 이미지가 다른 카드에 있으면 애매하므로 고르지 않고, 같은 카드의 PC·모바일 이미지면 정사각형에 가까운 쪽', () => {
  const twoCards = { images: [img('p1.jpg', card('주말 1+1 핫딜 10월')), img('p2.jpg', card('주말 1+1 핫딜 11월 예고'))] };
  assert.equal(pickNoticeImage({ brand: '피자헛', title: '주말 할인', evidence: '주말 1+1 핫딜' }, [twoCards], {}), '');
  assert.equal(pickNoticeImage({ brand: '피자헛', title: '주말 할인', evidence: '주말 1+1 핫딜 11월 예고' }, [twoCards], {}), 'https://cdn.brand.kr/event/p2.jpg', '한 카드만 맞으면 그 카드');
  const sameCard = { images: [img('pc.jpg', { ...card('목요일 1+1 스페셜데이'), alt: '목요일 스페셜데이', w: 1200, h: 400 }), img('mo.jpg', { ...card('목요일 1+1 스페셜데이'), alt: '목요일 스페셜데이', w: 600, h: 500 })] };
  assert.equal(pickNoticeImage({ brand: '도미노피자', title: '목요일 1+1', evidence: '목요일 1+1 스페셜데이' }, [sameCard], {}), 'https://cdn.brand.kr/event/mo.jpg');
});

test('공유용 대표 이미지(og)는 공지 이미지로 쓰지 않는다 — 11/03 파파존스·맥도날드에서 다른 행사 이미지가 붙음', () => {
  // 불닭 통신사 상세 페이지에서 '파파스데이' 공지를 함께 읽은 경우: og·본문 포스터는 불닭 행사 것
  const detail = { isDetail: true, ogImage: 'https://cdn.brand.kr/event/buldak_telecom.jpg', images: [img('buldak_telecom.jpg', { ...card('불닭 까르보 치킨 통신사 최대 30% 할인 이벤트'), alt: '불닭 까르보 치킨 통신사 최대 30% 할인 이벤트' })] };
  const papasday = { brand: '파파존스', title: '파파스데이 30% 할인', evidence: '11월 8일은 파파스데이!!! 라지 30% 할인' };
  assert.equal(pickNoticeImage(papasday, [detail], { own: detail, single: true }), '');
  // 같은 페이지의 불닭 공지는 제목과 맞는 카드라 그대로 쓴다
  const buldak = { brand: '파파존스', title: '불닭 까르보 치킨 통신사 최대 30% 할인', evidence: '불닭 까르보 치킨 통신사 최대 30% 할인 이벤트' };
  assert.equal(pickNoticeImage(buldak, [detail], { own: detail, single: true }), 'https://cdn.brand.kr/event/buldak_telecom.jpg');
});

test('로고·아이콘·띠 배너·긴 통이미지·http·gif는 공지 이미지 후보가 아니다', () => {
  assert.ok(isNonPhoto({ src: 'https://b.kr/img/logo.png', w: 600, h: 400 }));
  assert.ok(isNonPhoto({ src: 'https://b.kr/img/a.png', alt: '팝업', w: 600, h: 400 }));
  assert.ok(isNonPhoto({ src: 'https://b.kr/img/strip.png', w: 1600, h: 200 }));
  assert.ok(isNonPhoto({ src: 'https://b.kr/img/poster.jpg', w: 600, h: 4000 }));
  assert.ok(isNonPhoto({ src: 'http://b.kr/img/a.jpg', w: 600, h: 400 }));
  assert.ok(isNonPhoto({ src: 'https://b.kr/img/a.gif', w: 600, h: 400 }));
  assert.ok(isNonPhoto({ src: 'https://b.kr/img/a.jpg', alt: 'KFC', w: 600, h: 400 }, 'KFC'));
  assert.ok(!isNonPhoto({ src: 'https://b.kr/upload/event/thumb.jpg', alt: '닭껍질튀김', w: 600, h: 400 }, 'KFC'));
  const page = { images: [img('logo.png', { alt: '파인트 10년 전 가격 픽업' })] };
  assert.equal(pickNoticeImage({ brand: '배스킨라빈스', title: '파인트 10년 전 가격 픽업', evidence: '파인트 10년 전 가격 픽업' }, [page], {}), '');
});

test('서로 다른 공지 여럿에 붙은 같은 이미지는 떼고, 확인 목록 이미지는 둔다', () => {
  const list = [
    { id: 'a', status: 'published', image_url: 'https://b.kr/common.jpg' },
    { id: 'b', status: 'pending', image_url: 'https://b.kr/common.jpg' },
    { id: 'c', status: 'published', image_url: 'https://b.kr/own.jpg' },
    { id: 'd', status: 'published', image_url: 'https://b.kr/verified.jpg' },
    { id: 'e', status: 'published', image_url: 'https://b.kr/verified.jpg' },
  ];
  dropSharedNoticeImages(list, (n) => (['d', 'e'].includes(n.id) ? n.image_url : ''));
  assert.deepEqual(list.map((n) => n.image_url), ['', '', 'https://b.kr/own.jpg', 'https://b.kr/verified.jpg', 'https://b.kr/verified.jpg']);
});

test('확인 목록에 있는 공지는 목록의 이미지만 — 일부러 비워 둔 것(9MB 원본)은 자동 선택으로 채우지 않는다', () => {
  const popeyes = { brand: '파파이스', title: '레그 순살 치킨 1+1', source_url: 'https://www.popeyes.co.kr/event', end_date: null };
  assert.equal(noticeImageFor(popeyes, 'https://popeyes.co.kr/data/file/event/huge.jpg', '2026-11-03'), '');
  const listed = { brand: '배스킨라빈스', title: '파인트를 10년 전 가격으로 픽업', source_url: 'https://www.baskinrobbins.co.kr/m/play/event/list.php', end_date: '2026-11-03' };
  assert.equal(noticeImageFor(listed, 'https://b.kr/other.png', '2026-11-03'), 'https://www.baskinrobbins.co.kr/upload/promotion/event/1acda682bf0122b84b87ad886b474d8e.png');
  assert.equal(noticeImageFor({ brand: '굽네치킨', title: '새 행사', source_url: 'https://g.kr/e' }, 'https://g.kr/new.png', '2026-11-03'), 'https://g.kr/new.png');
  assert.ok(isNonPhoto({ src: 'https://p.kr/huge.jpg', w: 12000, h: 12000 }), '수천만 화소 원본은 후보에서 뺀다');
});

test('상세 여러 곳에 같은 공유 이미지(og)·앱 다운로드 배너는 공지 이미지가 아니다 (11/03 맥도날드)', () => {
  const pages = [
    { isDetail: false, ogImage: '' },
    { isDetail: true, ogImage: 'https://m.kr/upload/2025/09/250902_corp_site_PC_1.jpg' },
    { isDetail: true, ogImage: 'https://m.kr/upload/2025/09/250902_corp_site_PC_1.jpg' },
    { isDetail: true, ogImage: 'https://m.kr/upload/event/snack.jpg' },
  ];
  dropCommonOg(pages);
  assert.deepEqual(pages.map((p) => p.ogImage), ['', '', '', 'https://m.kr/upload/event/snack.jpg']);
  assert.ok(isNonPhoto({ src: 'https://m.kr/upload/a.jpg', alt: '지금 앱 다운로드 하고 혜택 누리기!', w: 800, h: 400 }));
  assert.ok(isNonPhoto({ src: 'https://m.kr/upload/2025/09/250902_corp_site_PC_1.jpg', alt: '', w: 800, h: 400 }));
  const own = { isDetail: true, ogImage: 'https://m.kr/upload/2025/09/250902_corp_site_PC_1.jpg', images: [] };
  assert.equal(pickNoticeImage({ brand: '맥도날드', title: '해피 스낵', evidence: '시즌 한정 해피 스낵, 1000원부터!' }, [own], { own, single: true }), '');
});

test('같은 출처의 다른 행사 상세 페이지 이미지는 쓰지 않는다 — 11/03 피자헛 콜라 딜·맥도날드 앱 가입', () => {
  const list = { isDetail: false, images: [] };
  const own = { isDetail: true, images: [] };
  // 다른 행사(클리커) 상세 페이지 안에 '슈프림 3종 콜라 1,000원' 안내가 함께 실려 있어도 그 페이지 이미지는 쓰지 않는다
  const clicker = { isDetail: true, images: [img('clicker.png', card('슈프림 피자 3종 중 1판을 구매하면 코카-콜라 1.25L를 1,000원에'))] };
  const cola = { brand: '피자헛', title: '슈프림 3종 구매 시 콜라 1,000원 딜', evidence: '슈프림 피자 3종 중 1판을 구매하면 정상가 2,500원인 코카-콜라 1.25L를 1,000원에 구매' };
  assert.equal(pickNoticeImage(cola, [list, own, clicker], { own }), '');
  // 공지를 읽은 그 상세 페이지에 있으면 쓴다
  const own2 = { isDetail: true, images: [img('cola.png', card('슈프림 피자 3종 중 1판을 구매하면 코카-콜라 1.25L를 1,000원에'))] };
  assert.equal(pickNoticeImage(cola, [list, own2, clicker], { own: own2 }), 'https://cdn.brand.kr/event/cola.png');
});

test('카드 글이 제목과 안 맞거나 금액이 다르면 그 공지 이미지가 아니다 — 11/03 파파존스·피자헛·맥도날드', () => {
  const list = { isDetail: false, images: [
    img('masudong.jpg', { ...card('마케팅 수신 동의 시, 20% 상시 할인 2026.03.17~'), alt: '마케팅 수신 동의 시, 20% 상시 할인' }),
    img('papasday.jpg', { ...card('11월 8일은 파파스데이!!! 2026.10.29~2026.11.08'), alt: '파파스데이' }),
  ] };
  const papas = { brand: '파파존스', title: '파파스데이 30% 할인', evidence: '11월 8일은 파파스데이!!! 2026.10.29~2026.11.08', discount_label: '30%' };
  assert.equal(pickNoticeImage(papas, [list], { own: list }), 'https://cdn.brand.kr/event/papasday.jpg');
  // AI가 근거 문구를 옆 카드('마케팅 수신 동의 20%')에서 옮겨 적어도, 제목 낱말·금액이 안 맞으면 그 카드 이미지를 쓰지 않는다
  assert.equal(pickNoticeImage({ ...papas, evidence: '마케팅 수신 동의 시, 20% 상시 할인' }, [list], { own: list }), '');
  const clicker = { isDetail: false, images: [img('clicker.png', { ...card('슈프림 신메뉴 2종 매장 주문 시 피자헛 클리커 증정 선착순 10,000명'), alt: '슈프림 피자 3종' })] };
  const cola = { brand: '피자헛', title: '슈프림 피자 3종 구매 시 콜라 1천원', evidence: '슈프림 피자 3종 중 1판을 구매하면 정상가 2,500원인 코카-콜라 1.25L를 1,000원에 구매' };
  assert.equal(pickNoticeImage(cola, [clicker], {}), '');
  const mcd = { isDetail: false, images: [img('jeju.jpg', { ...card('제주 맥피즈 출시! 앱가입시 불고기버거 1,500원 · 해피 스낵'), alt: '제주 맥피즈' })] };
  assert.equal(pickNoticeImage({ brand: '맥도날드', title: '맥도날드 앱 가입 시 불고기버거 특가', evidence: '앱가입시 불고기버거 1,500원!' }, [mcd], {}), '', '카드 글에 문구가 섞여 있어도 금액·제목 낱말 기준을 둘 다 통과해야 — 여기선 대체텍스트·카드가 다른 행사');
});

test('한 줄에 카드 둘이 든 목록에서는 대체텍스트로 그 공지 이미지를 가린다 — 11/03 파파존스 아메리칸 콤보·아이브', () => {
  const row = '파파 아메리칸 콤보 프로모션 2026.10.05~2026.11.08 아이브 포토카드 프로모션 2026.11.03~2026.12.20';
  const list = { isDetail: false, images: [
    img('ive.jpg', { ...card(row), alt: '7,000원 할인 + 아이브 포토카드 증정', w: 580, h: 190 }),
    img('combo.jpg', { ...card(row), alt: '파파 아메리칸 콤보', w: 580, h: 190 }),
  ] };
  const combo = { brand: '파파존스', title: '파파 아메리칸 콤보 브라우니 증정', evidence: '파파 아메리칸 콤보 프로모션 2026.10.05~2026.11.08' };
  assert.equal(pickNoticeImage(combo, [list], {}), 'https://cdn.brand.kr/event/combo.jpg');
  const noAlt = { isDetail: false, images: list.images.map((i) => ({ ...i, alt: '' })) };
  assert.equal(pickNoticeImage(combo, [noAlt], {}), '', '대체텍스트가 없으면 어느 쪽인지 몰라 비워 둔다');
});

test('확인 목록에서 다른 공지의 이미지로 올라 있는 주소는 자동 선택으로 쓰지 않는다 — 11/03 피자헛 콜라 딜·클리커', () => {
  const clicker = 'https://akamai.pizzahut.co.kr/2020pizzahut-prod/public/event/9725e387-0139-4887-ad09-cb44e8e7f99f.png';
  const cola = { brand: '피자헛', title: '슈프림 피자 3종 콜라 1천원 딜', source_url: 'https://www.pizzahut.co.kr/cs/event/extra/newsupreme', end_date: '2026-11-16' };
  assert.equal(noticeImageFor(cola, clicker, '2026-11-03'), '');
  assert.equal(noticeImageFor(cola, 'https://akamai.pizzahut.co.kr/2020pizzahut-prod/public/event/new-cola.png', '2026-11-03'), 'https://akamai.pizzahut.co.kr/2020pizzahut-prod/public/event/new-cola.png');
});

// 11/13 대표 요청: "핫딜 이미지는 해당 핫딜 링크에 있는 페이지 이미지를 넣어줘. 포스터나 이미지가 있는데 왜 대표 이미지를 사용해"
test('상세 페이지의 포스터: 그 행사 하나만 다루는 페이지면 대체텍스트가 없어도 본문의 가장 큰 이미지, 없으면 그 페이지의 공유 이미지', () => {
  const n = { brand: 'KFC', title: '치킨나이트 1+1 매일 밤 9시', evidence: '치킨나이트 매일 밤 9시부터 치킨 1+1', discount_label: '1+1' };
  const list = { isDetail: false, ogImage: 'https://cdn.brand.kr/og-default.jpg', images: [img('common-banner.jpg', { w: 1200, h: 400 })] };
  const poster = { src: 'https://cdn.brand.kr/event/night-poster.jpg', alt: '', w: 860, h: 3200, near: '', nearLen: 0 };
  const detail = { isDetail: true, title: 'KFC 프로모션', text: '치킨나이트 1+1\n매일 밤 9시부터 매장 마감까지 …', ogImage: 'https://cdn.brand.kr/event/night-og.jpg',
    images: [img('common-banner.jpg', { w: 1200, h: 400 }), { ...poster }, img('thumb-small.jpg', { w: 320, h: 240 }), { src: 'https://cdn.brand.kr/img/logo_kfc.png', alt: 'KFC', w: 400, h: 300 }] };
  assert.equal(pickNoticeImage(n, [list, detail], { own: detail, single: true }), poster.src, '세로로 긴 포스터도 그 페이지 것이면 사용, 목록에도 있는 공통 배너·로고는 제외');
  // 본문 이미지가 없으면 그 페이지의 공유 이미지 (사이트 기본 이미지와 다를 때만)
  assert.equal(pickNoticeImage(n, [list, { ...detail, images: [] }], { own: { ...detail, images: [] }, single: true }), '');
  const noImg = { ...detail, images: [] };
  assert.equal(pickNoticeImage(n, [list, noImg], { own: noImg, single: true }), 'https://cdn.brand.kr/event/night-og.jpg');
  const defaultOg = { ...detail, images: [], ogImage: list.ogImage };
  assert.equal(pickNoticeImage(n, [list, defaultOg], { own: defaultOg, single: true }), '', '사이트 기본 공유 이미지는 쓰지 않음');
  // 11/03 오류를 다시 만들지 않는다: 그 페이지에서 공지를 여러 개 읽었거나, 페이지 첫머리가 다른 행사면 쓰지 않는다
  assert.equal(pickNoticeImage(n, [list, detail], { own: detail, single: false }), '');
  const other = { ...detail, title: '맥도날드', text: '제주 맥피즈 출시! 상큼한 제주 한라봉 …'.padEnd(1000, '가') + '치킨나이트 1+1 매일 밤 9시' };
  assert.equal(pickNoticeImage(n, [list, other], { own: other, single: true }), '', '다른 행사의 상세 페이지');
  // 금액이 적힌 대체텍스트가 공지와 다르면 그 이미지는 건너뛴다, 수천만 화소 원본도 제외
  const wrongAmount = { ...detail, ogImage: '', images: [{ ...poster, alt: '마케팅 수신 동의 20% 할인' }, { src: 'https://cdn.brand.kr/event/huge.jpg', alt: '', w: 3000, h: 9000 }] };
  assert.equal(pickNoticeImage(n, [list, wrongAmount], { own: wrongAmount, single: true }), '');
  // 목록에서 읽은 공지(상세가 아님)는 전과 같이 카드 글·대체텍스트로만
  assert.equal(pickNoticeImage(n, [list], { own: list, single: true }), '');
});

test('11/13 실제 화면에서 빠졌던 경우: 도미노(대체텍스트에 제목 낱말 모두) · 파파존스(목록 썸네일과 상세 포스터가 같은 대체텍스트) · 맥도날드(공지 둘인 상세의 포스터) · 피자헛(뜻 없는 대체텍스트)', () => {
  const dom = { isDetail: false, images: [{ src: 'https://cdn.d.kr/a.jpg', alt: '하나 나라사랑카드 캐시백 이벤트', w: 750, h: 320, near: '', nearLen: 0 }, { src: 'https://cdn.d.kr/day.jpg', alt: '도미노스데이: 모든 피자 포장 40% 할인', w: 750, h: 320, near: '', nearLen: 0 }] };
  assert.equal(pickNoticeImage({ brand: '도미노피자', title: '도미노스데이 포장 40% 할인', evidence: '도미노스데이 방문포장 시 40%', discount_label: '40%' }, [dom], { own: dom }), 'https://cdn.d.kr/day.jpg');
  const pjList = { isDetail: false, images: [{ src: 'https://cdn.p.kr/ive_list.jpg', alt: '아이브 포토카드 프로모션', w: 580, h: 190, near: '아이브 포토카드 프로모션 2026.11.03~2026.12.20', nearLen: 35 }, { src: 'https://cdn.p.kr/ive_note_list.jpg', alt: '아이브 포토카드 유의사항', w: 580, h: 190, near: '아이브 포토카드 유의사항', nearLen: 20 }] };
  const pjDetail = { isDetail: true, title: '파파존스', text: 'EVENT 아이브 포토카드 프로모션', images: [{ src: 'https://cdn.p.kr/ive.jpg', alt: '아이브 포토카드 프로모션', w: 750, h: 1545, near: 'EVENT 아이브 포토카드 프로모션 2026.11.03', nearLen: 58 }] };
  assert.equal(pickNoticeImage({ brand: '파파존스', title: '아이브 포토카드 프로모션', evidence: '아이브 포토카드 프로모션 2026.11.03~2026.12.20' }, [pjList, pjDetail], { own: pjDetail, single: true }), 'https://cdn.p.kr/ive_list.jpg');
  const mc = { isDetail: true, title: '맥도날드', text: '프로모션 시즌 한정 해피 스낵, 1000원부터!', images: [
    { src: 'https://cdn.m.kr/happy.jpg', alt: '해피스낵 시즌 한정 간식 1000원 부터!_하단 내용', w: 1000, h: 2755, near: '', nearLen: 719 },
    { src: 'https://cdn.m.kr/app.jpg', alt: '맥도날드 앱으로 즐기는 다양한 혜택', w: 1000, h: 1000, near: '앱 가입 시 불고기 버거 1500원', nearLen: 138 }] };
  assert.equal(pickNoticeImage({ brand: '맥도날드', title: '맥도날드 시즌 한정 해피 스낵 1000원부터', evidence: '시즌 한정 해피 스낵, 1000원부터!', discount_label: '1,000원부터' }, [mc], { own: mc, single: false }), 'https://cdn.m.kr/happy.jpg', '공지를 둘 읽은 상세라도 대체텍스트로 확인되면 사용');
  assert.equal(pickNoticeImage({ brand: '맥도날드', title: '앱 신규 가입 불고기 버거 1500원', evidence: '앱 가입 시 불고기 버거 1500원' }, [mc], { own: mc, single: false }), '', '다른 행사 포스터·내용이 다른 이미지는 붙이지 않음');
  const ph = { isDetail: true, title: '피자헛', text: '설정 가입 즉시 멤버십만 누릴 수 있는 풍성한 혜택 증정! 로그인 메뉴 마이 멤버십 이벤트 단체주문 공지사항 '.repeat(4) + '반값다 피자헛! 평일반값 & 주말1+1 (11월)', ogImage: '',
    images: [{ src: 'https://cdn.h.kr/top.png', alt: 'hellopizzahut', w: 980, h: 468, near: '', nearLen: 1237 }, { src: 'https://cdn.h.kr/weekend.png', alt: 'hellopizzahut', w: 980, h: 2811, near: '', nearLen: 1237 }] };
  const phNews = { brand: '피자헛', title: '피자헛 11월 주말 1+1 핫딜', evidence: '주말1+1 (11월)', discount_label: '1+1' };
  assert.equal(pickNoticeImage(phNews, [ph], { own: ph, single: true }), 'https://cdn.h.kr/weekend.png');
  assert.equal(pickNoticeImage(phNews, [ph], { own: ph, single: false }), '', '뜻 없는 대체텍스트는 공지가 하나뿐일 때만');
  const tab = { ...ph, images: [{ src: 'https://cdn.h.kr/event/mo_sticky_tab_1_default.png', alt: '', w: 980, h: 600, near: '', nearLen: 0 }] };
  assert.equal(pickNoticeImage(phNews, [tab], { own: tab, single: true }), '', '붙박이 탭 같은 화면 부품은 포스터가 아님');
});

test('합쳐진 소식의 이미지는 제목이 같은 공지일 때만 물려받는다 (같은 쿠폰에 연결된 다른 행사 이미지는 받지 않음)', async () => {
  const { mergeNews } = await import('../src/engine.js');
  const base = { status: 'published', brand: '파파존스', end_date: '2026-11-18', programs: [], confidence: 0.9 };
  const papas = { ...base, id: 'a', title: '파파스데이 30% 할인', discount_label: '30%', related_ids: ['c1', 'c2'], image_url: '' };
  const buldak = { ...base, id: 'b', title: '불닭 까르보 치킨 통신사 최대 30% 할인', discount_label: '', end_date: '2026-12-31', related_ids: ['c1'], image_url: 'https://cdn.p.kr/buldak_list.jpg' };
  const merged = mergeNews([papas, buldak]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].image_url, '', '다른 행사의 이미지');
  const twin = { ...base, id: 'c', title: '11월 파파스데이 30% 할인', discount_label: '', related_ids: [], image_url: 'https://cdn.p.kr/papasday.jpg' };
  assert.equal(mergeNews([papas, twin])[0].image_url, 'https://cdn.p.kr/papasday.jpg');
});
