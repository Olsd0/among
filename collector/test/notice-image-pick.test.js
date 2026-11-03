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
  const n = { brand: '스타벅스', title: '온라인 스토어 쓱데이', evidence: '2026 쓱데이 특별전 2026-10-30 ~ 2026-11-08' };
  assert.equal(pickNoticeImage(n, [list], { own: list }), 'https://cdn.brand.kr/event/b.jpg');
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
  const sameCard = { images: [img('pc.jpg', { ...card('목요일 1+1 스페셜데이'), w: 1200, h: 400 }), img('mo.jpg', { ...card('목요일 1+1 스페셜데이'), w: 600, h: 500 })] };
  assert.equal(pickNoticeImage({ brand: '도미노피자', title: '목요일 1+1', evidence: '목요일 1+1 스페셜데이' }, [sameCard], {}), 'https://cdn.brand.kr/event/mo.jpg');
});

test('상세 페이지에 공지가 하나뿐일 때만 공유용 대표 이미지(og:image)를 쓴다', () => {
  const detail = { isDetail: true, ogImage: 'https://cdn.brand.kr/event/share-1129.png', images: [] };
  const n = { brand: 'KFC', title: '닭껍질튀김 특가', evidence: '2배 더 풍성하게 돌아온 바삭함!' };
  assert.equal(pickNoticeImage(n, [detail], { own: detail, single: true }), 'https://cdn.brand.kr/event/share-1129.png');
  assert.equal(pickNoticeImage(n, [detail], { own: detail, single: false }), '', '공지가 여럿이면 어느 것의 이미지인지 모름');
  assert.equal(pickNoticeImage(n, [{ ...detail, isDetail: false }], { own: { ...detail, isDetail: false }, single: true }), '', '목록 페이지의 og는 사이트 공통');
  const logoOg = { ...detail, ogImage: 'https://brand.kr/images/common/logo_share.png' };
  assert.equal(pickNoticeImage(n, [logoOg], { own: logoOg, single: true }), '');
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
  assert.match(noticeImageFor(listed, 'https://b.kr/other.png', '2026-11-03'), /assets\/notices\/baskin-pint/);
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
