// 11/19 대표 요청 "핫딜 공지에는 어지간하면 이미지를 받아줘. 브랜드 로고로 대치말고. 쿠폰에도 이미지 없는 것들 보완해줘"
// 목록 칸(글 링크 + 썸네일)으로 공지·쿠폰의 공식 이미지를 찾는다. 값은 11/19 실제 공식 목록에서 본 모양 그대로.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noticeCardFor, couponCardFor, pageUrlKey, usableThumb } from '../src/engine.js';
import { couponEventImage } from '../src/event-notices.js';
import { encodeArtworkUrl } from '../src/artwork-meta.js';
import { openBrowser, renderPage } from '../src/fetch.js';
import { runCollector } from '../src/run.js';
import { clearRobotsCache } from '../src/robots.js';
import { serveDir } from './helpers.js';

const SB = 'https://www.starbucks.co.kr/whats_new/campaign_view.do?pro_seq=';
const thumb = (name, o = {}) => ({ src: `https://image.istarbucks.co.kr/upload/promotion/${name}`, alt: '', w: 260, h: 260, ...o });
// 11/19 스타벅스 목록: 글은 클릭으로만 열리고 칸마다 260x260 썸네일(대체텍스트 = 글 제목)
const sbPosts = [
  { href: SB + '3499', text: '2026 WINTER e-FREQUENCY 이벤트 안내 중요2026 WINTER e-FREQUENCY 이벤트 안내 2026-10-22 ~ 2026-12-31', img: thumb('WEB_THUM_20261014134821897.png', { alt: '2026 WINTER e-FREQUENCY 이벤트 안내' }) },
  { href: SB + '3639', text: 'HOLIDAY DELIGHTS 프로모션 HOLIDAY DELIGHTS 프로모션 2026-11-19 ~ 2026-11-25', img: thumb('WEB_THUM_20261118135210957.jpg', { alt: 'HOLIDAY DELIGHTS 프로모션' }) },
  { href: SB + '3626', text: 'HELLO KITTY 프로모션 HELLO KITTY 프로모션 2026-11-19 ~ 2026-12-31', img: thumb('WEB_THUM_20261113083317806.jpg', { alt: 'HELLO KITTY 프로모션' }) },
  { href: SB + '3603', text: '카카오톡 선물하기 파베 초콜릿 이벤트 카카오톡 선물하기 파베 초콜릿 이벤트 2026-11-05 ~ 2026-11-19', img: thumb('WEB_THUM_20261110100052400.png', { alt: '카카오톡 선물하기 파베 초콜릿 이벤트' }) },
];
const sbCards = sbPosts.map((p) => ({ href: p.href, title: p.text, img: p.img }));

test('주소 비교: www·끝 슬래시·한글 인코딩·빈 쿼리 차이는 같은 글로 본다', () => {
  assert.equal(pageUrlKey(SB + '3499&menu_cd='), pageUrlKey(SB + '3499'));
  assert.equal(pageUrlKey('https://paikdabang.com/post_news/2026-%ec%ba%98/'), pageUrlKey('https://www.paikdabang.com/post_news/2026-캘'));
  assert.notEqual(pageUrlKey(SB + '3499'), pageUrlKey(SB + '3639'));
  assert.equal(pageUrlKey('javascript:void(0)'), '');
});

test('공지 원문 주소 = 목록 칸 글 주소면 그 칸 썸네일 (스타벅스 HOLIDAY DELIGHTS·HELLO KITTY·윈터 e-프리퀀시 중복 공지)', () => {
  for (const [seq, title, file] of [['3639', 'HOLIDAY DELIGHTS 프로모션', 'WEB_THUM_20261118135210957.jpg'], ['3626', 'HELLO KITTY 프로모션', 'WEB_THUM_20261113083317806.jpg'], ['3499&menu_cd=', '스타벅스 윈터 e-프리퀀시 이벤트', 'WEB_THUM_20261014134821897.png']]) {
    const hit = noticeCardFor({ brand: '스타벅스', title, source_url: SB + seq }, sbCards);
    assert.equal(hit.exact, true, title);
    assert.match(hit.card.img.src, new RegExp(file.replace('.', '\\.')), title);
  }
});

test('원문이 목록이면 제목 낱말로 칸 하나를 고른다 (맥도날드 해피 스낵 · 빽다방 말차)', () => {
  const list = 'https://www.mcdonalds.co.kr/kor/promotion/list';
  const mcd = [
    { href: 'https://www.mcdonalds.co.kr/kor/promotion/detail/9EDB98', title: '진행중 아시아가 주목한 그 버거!', img: { src: 'https://www.mcdonalds.co.kr/upload/2026/11/Asia_corpsite_thumbnail_860x704.jpg', alt: '', w: 860, h: 704 } },
    { href: 'https://www.mcdonalds.co.kr/kor/promotion/detail/5C253D', title: '진행중 시즌 한정 해피 스낵, 1000원부터!', img: { src: 'https://www.mcdonalds.co.kr/upload/2026/11/BAQ4_corpsite_thumbnail_860x704.jpg', alt: '', w: 860, h: 704 } },
  ];
  const hit = noticeCardFor({ brand: '맥도날드', title: '시즌 한정 해피 스낵', evidence: '시즌 한정 해피 스낵, 1000원부터!', source_url: list }, mcd);
  assert.equal(hit.exact, false);
  assert.match(hit.card.href, /5C253D$/);
  assert.match(hit.card.img.src, /BAQ4/);
  const paik = [
    { href: 'https://paikdabang.com/post_news/2026_promotion/', title: "2026년 말의해 맞이 '말차' 전 메뉴 2,026원 프로모션(1/2~) – 빽다방 앱 '픽업오더 전용" },
    { href: 'https://paikdabang.com/post_news/2026-calendar/', title: '2026 캘린더 프로모션 진행매장 안내' },
  ];
  const p = noticeCardFor({ brand: '빽다방', title: '2026 말차 전 메뉴 2,026원 프로모션', source_url: 'https://paikdabang.com/news/?cate=event' }, paik);
  assert.equal(p.card.href, 'https://paikdabang.com/post_news/2026_promotion/');
  assert.equal(p.card.img, undefined, '썸네일 없는 글 링크 → 상세에서 포스터를 찾는다');
});

test('헷갈리면 고르지 않는다: 같은 낱말 칸이 둘, 낱말이 숫자뿐, 금액이 다름, 로고', () => {
  const two = [
    { href: 'https://a.kr/e/1', title: '해피 스낵 1,000원', img: { src: 'https://a.kr/1.jpg', w: 600, h: 400 } },
    { href: 'https://a.kr/e/2', title: '해피 스낵 2탄 1,000원', img: { src: 'https://a.kr/2.jpg', w: 600, h: 400 } },
  ];
  assert.equal(noticeCardFor({ brand: 'A', title: '해피 스낵 1,000원', source_url: 'https://a.kr/e' }, two), null);
  assert.equal(noticeCardFor({ brand: 'A', title: '50% 할인', source_url: 'https://a.kr/e' }, [{ href: 'https://a.kr/e/9', title: '50% 할인 이벤트' }]), null);
  assert.equal(noticeCardFor({ brand: 'A', title: '파파스데이 30% 할인', source_url: 'https://a.kr/e' }, [{ href: 'https://a.kr/e/7', title: '파파스데이 20% 할인', img: { src: 'https://a.kr/7.jpg' } }]), null);
  assert.equal(usableThumb({ src: 'https://a.kr/images/common/h_logo.png', w: 300, h: 200 }, 'A'), false);
  assert.equal(usableThumb({ src: 'http://a.kr/x.jpg' }, 'A'), false, 'https만');
  assert.equal(usableThumb({ src: 'https://a.kr/x.jpg', w: 0, h: 0 }, 'A'), true, '크기를 모르는 늦게 불러오는 썸네일도');
});

test('쿠폰: 원문이 같은 칸 → 클릭으로만 열리는 게시판은 메뉴·근거가 글 제목을 담고 있을 때 그 글 썸네일', () => {
  const card = couponCardFor({ brand: '스타벅스', menu: 'HELLO KITTY 텀블러', source_url: SB + '3626' }, sbCards, sbPosts);
  assert.match(card.img.src, /20261113083317806/);
  const fabe = couponCardFor({ brand: '스타벅스', menu: '파베 초콜릿', evidence: '카카오톡 선물하기 파베 초콜릿 이벤트 구매 시 아메리카노 쿠폰 증정', source_url: 'https://www.starbucks.co.kr/whats_new/campaign_list.do' }, [], sbPosts);
  assert.match(fabe.img.src, /20261110100052400/);
  assert.equal(couponCardFor({ brand: '스타벅스', menu: '제조 음료', evidence: '제조 음료 1+1', source_url: 'https://www.starbucks.co.kr/whats_new/campaign_list.do' }, [], sbPosts), null);
});

test('쿠폰 행사 썸네일은 종류 표시로 상품 사진과 구분하고, 쿠폰에서 만든 공지는 그 썸네일을 쓴다', () => {
  const url = encodeArtworkUrl('https://image.istarbucks.co.kr/upload/promotion/WEB_THUM_20261110100052400.png', { kind: 'official_event', source: SB + '3603', checkedAt: '2026-11-19T00:00:00Z' });
  assert.equal(couponEventImage({ image_url: url }), 'https://image.istarbucks.co.kr/upload/promotion/WEB_THUM_20261110100052400.png');
  assert.equal(couponEventImage({ image_url: 'https://image.istarbucks.co.kr/upload/store/skuimg/x.jpg' }), '', '표시 없는 주소 = 상품 사진 → 공지에 쓰지 않음');
  assert.equal(couponEventImage({ event_image: 'https://a.kr/e.jpg' }), 'https://a.kr/e.jpg');
});

let site;
before(async () => { site = await serveDir(fileURLToPath(new URL('./fixtures/site', import.meta.url))); });
after(async () => { await site.close(); });

test('화면 읽기: 목록 칸마다 글 주소·글·썸네일(늦게 불러오는 data-src 포함)을 묶는다', { timeout: 60000 }, async () => {
  clearRobotsCache();
  const ctx = await openBrowser();
  try {
    const page = await renderPage(ctx, `${site.base}/cards/list.html`, { selector: 'main', maxShots: 0 });
    const by = Object.fromEntries(page.cards.map((c) => [new URL(c.href).pathname, c]));
    assert.equal(by['/cards/ev-101.html'].img.src, 'https://img.cards.test/upload/thumb-101.jpg');
    assert.match(by['/cards/ev-101.html'].title, /해피 스낵/);
    assert.equal(by['/cards/ev-102.html'].img.src, 'https://img.cards.test/upload/thumb-102.jpg', '같은 칸의 data-src');
    assert.equal(by['/cards/ev-103.html'].img, undefined);
    assert.ok(!page.cards.some((c) => /logo/.test(c.img?.src || '')), '선택 영역(main) 밖 머리글 로고는 없음');
  } finally { await ctx.close(); }
});

test('수집 실행: 대체텍스트로 못 고른 공지 → 목록 칸 썸네일 · 썸네일 없는 글은 상세 포스터', { timeout: 120000 }, async () => {
  clearRobotsCache();
  const outDir = mkdtempSync(join(tmpdir(), 'among-cards-'));
  const sources = [{ id: 'cards-event', brand: '카드버거', category: '햄버거', url: `${site.base}/cards/list.html`, selector: 'main', max_follow: 0, official_link: 'https://cards.test/', active: true }];
  const opened = [];
  const renderDetail = async (url) => {
    opened.push(url);
    return { url, finalUrl: url, title: '말차 전 메뉴 2,026원 프로모션', text: "2026 말차 전 메뉴 2,026원 프로모션\n앱 픽업오더 전용", links: [], cards: [], posts: [], ogImage: '',
      images: [{ src: 'https://img.cards.test/upload/matcha-poster.jpg', alt: '', w: 900, h: 1600, near: '', nearLen: 0 }] };
  };
  const report = await runCollector({ env: { MOCK_CLAUDE: '1', OUT_DIR: outDir, TRIGGER: 'test', PERIOD_CHECK: '0', ARTWORK_LOOKUP: '0' }, now: new Date('2026-11-19T03:00:00Z'), sources, sheet: null, quiet: true, imageReads: true, renderDetail });
  assert.equal(report.state, 'success');
  const news = JSON.parse(readFileSync(join(outDir, 'news.json'), 'utf8'));
  const by = Object.fromEntries(news.map((n) => [n.title, n]));
  assert.equal(by['시즌 한정 해피 스낵'].image_url, 'https://img.cards.test/upload/thumb-101.jpg');
  assert.match(by['시즌 한정 해피 스낵'].source_url, /\/cards\/ev-101\.html$/, "'공식 원문'은 그 행사 글로");
  assert.equal(by['겨울 굿즈 프로모션'].image_url, 'https://img.cards.test/upload/thumb-102.jpg');
  assert.equal(by['2026 말차 전 메뉴 2,026원 프로모션'].image_url, 'https://img.cards.test/upload/matcha-poster.jpg');
  assert.deepEqual(opened.map((u) => new URL(u).pathname), ['/cards/ev-103.html'], '이미지를 못 찾은 글 하나만 열었다');
  assert.equal(report.image_reads, 1);
});
