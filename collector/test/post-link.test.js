// 11/16 대표 지적: 스타벅스 핫딜이 그 이벤트 글이 아니라 이벤트 게시판으로만 열리고 설명이 부족함
import test from 'node:test';
import assert from 'node:assert/strict';
import { postLinkFor, mergeNews } from '../src/engine.js';
import { postRuleFor } from '../src/fetch.js';

const V = 'https://www.starbucks.co.kr/whats_new/campaign_view.do?pro_seq=';
const LIST = 'https://www.starbucks.co.kr/whats_new/campaign_list.do';
// 11/16 실제 목록 글자
const posts = [
  { href: V + '3627', text: '딜리버스 Special hour 할인 혜택 딜리버스 Special hour 할인 혜택 2026-11-09 ~ 2026-11-30' },
  { href: V + '3615', text: '딜리버스 만원 별 더블 적립 이벤트 2026-11-01 ~ 2026-11-30' },
  { href: V + '3610', text: '스타벅스 신한카드 청구할인 프로모션 2026-11-01 ~ 2026-11-30' },
  { href: V + '3609', text: '스타벅스 신한카드 11월 혜택 2026-11-01 ~ 2026-11-30' },
  { href: V + '3634', text: '스타벅스 카드 충전 이벤트 2026-11-16 ~ 2026-11-29' },
  { href: V + '3499', text: '중요2026 WINTER e-FREQUENCY 이벤트 안내 2026-10-22 ~ 2026-12-31' },
];

test('스타벅스 목록 주소에만 글 주소 규칙이 있다', () => {
  assert.equal(postRuleFor(LIST).attr, 'prod');
  assert.equal(postRuleFor(LIST + '?menu_cd=STB2812').attr, 'prod');
  assert.equal(postRuleFor('https://www.starbucks.co.kr/menu/drink_list.do'), null);
  assert.equal(postRuleFor('https://evil.example/whats_new/campaign_list.do'), null);
});

test('공지 제목에 맞는 행사 글 주소를 고른다', () => {
  assert.equal(postLinkFor({ title: '스타벅스 딜리버스 Special hour 할인', evidence: '딜리버스 Special hour 할인 혜택 2026-11-09' }, posts), V + '3627');
  assert.equal(postLinkFor({ title: '딜리버스 만원 이상 별 더블 적립', evidence: '딜리버스 만원 별 더블 적립 이벤트' }, posts), V + '3615');
  assert.equal(postLinkFor({ title: '스타벅스 카드 충전 이벤트', evidence: '' }, posts), V + '3634');
  assert.equal(postLinkFor({ title: '2026 윈터 e-프리퀀시', evidence: '2026 WINTER e-FREQUENCY 이벤트 안내' }, posts), V + '3499');
});

test('맞는 글이 없거나 헷갈리면 고르지 않는다 (틀린 글로 보내지 않음)', () => {
  assert.equal(postLinkFor({ title: '스타벅스 삼성카드 혜택', evidence: '' }, posts), '');
  assert.equal(postLinkFor({ title: '스타벅스 신한카드 혜택', evidence: '' }, posts), V + '3609');
  assert.equal(postLinkFor({ title: '아메리카노 1+1', evidence: '' }, posts), '');
  assert.equal(postLinkFor({ title: '딜리버스 할인', evidence: '' }, []), '');
  // 신한카드 글 둘 중 낱말이 더 맞는 쪽
  assert.equal(postLinkFor({ title: '스타벅스 신한카드 청구할인', evidence: '스타벅스 신한카드 청구할인 프로모션' }, posts), V + '3610');
});

test('목록·상세에서 따로 읽은 같은 공지: 원문은 행사 글, 설명은 자세한 쪽', () => {
  const base = { brand: '스타벅스', status: 'published', end_date: '2026-11-30', related_ids: [], programs: [], source_id: 'starbucks-event', official_link: LIST, confidence: 0.9 };
  const list = { ...base, title: '딜리버스 Special hour 할인', summary: '딜리버스 할인 행사.', discount_label: '3천원', source_url: LIST };
  const detail = { ...base, title: '딜리버스 Special hour 할인 혜택', summary: '11월 30일까지 평일 오후 2~5시에 딜리버스로 1만 5천원 이상 주문하면 3천원을 할인해요.', discount_label: '', source_url: V + '3627' };
  const [m] = mergeNews([list, detail]);
  assert.equal(m.source_url, V + '3627');
  assert.match(m.summary, /평일 오후/);
  assert.equal(m.discount_label, '3천원');
});

test('같은 혜택을 목록 제목과 행사 상세 글에서 따로 읽으면 상세 글의 기간·조건으로 하나만 남긴다 (11/21 버거킹)', async () => {
  const { mergeSimilar } = await import('../src/engine.js');
  const base = { brand: '버거킹', category: '햄버거', menu: '전 메뉴', discount_type: 'amount', discount_value: 4000, audience: '전체', status: 'published', confidence: 0.9 };
  const list = { ...base, start_date: '2026-11-01', end_date: '2026-11-30', app_only: false, channels: ['배달'], min_order: 21000, source_url: 'https://www.burgerking.co.kr/event/ongoing' };
  const detail = { ...base, start_date: '2026-11-16', end_date: '2026-11-22', app_only: true, stackable: 'no', channels: ['배달'], min_order: 21000, source_url: 'https://www.burgerking.co.kr/event/detail/1793', from_detail: true };
  for (const order of [[list, detail], [detail, list]]) {
    const out = mergeSimilar(order.map((x) => ({ ...x })));
    assert.equal(out.length, 1);
    assert.equal(out[0].end_date, '2026-11-22');
    assert.equal(out[0].app_only, true);
    assert.equal(out[0].source_url.split(' ')[0], 'https://www.burgerking.co.kr/event/detail/1793', '원문 첫 주소 = 상세 글');
  }
  // 둘 다 목록에서 읽었는데 기간이 다르면 다른 행사로 둔다 (예전 규칙 그대로)
  assert.equal(mergeSimilar([{ ...list }, { ...list, start_date: '2026-12-01', end_date: '2026-12-31' }]).length, 2);
});

test('버튼으로만 열리는 이벤트 목록: 버튼을 차례로 눌러 상세 글 주소·제목·썸네일을 모은다', { timeout: 90000 }, async () => {
  const { fileURLToPath } = await import('node:url');
  const { serveDir } = await import('./helpers.js');
  const { openBrowser, clickPosts, postRuleFor: rule } = await import('../src/fetch.js');
  assert.equal(rule('https://www.burgerking.co.kr/event/ongoing').click, 'li button.btn_detail');
  const site = await serveDir(fileURLToPath(new URL('./fixtures/site', import.meta.url)));
  const ctx = await openBrowser();
  try {
    const posts = await clickPosts(ctx, `${site.base}/bk/ongoing.html`, { ...rule('https://www.burgerking.co.kr/event/ongoing'), urlPattern: '/bk/detail/\\d+\\.html$' });
    assert.deepEqual(posts.map((p) => new URL(p.href).pathname), ['/bk/detail/1793.html', '/bk/detail/1801.html', '/bk/detail/1700.html']);
    assert.equal(posts[0].text, '26년 11월 딜리버리 21,000원 이상 주문 시 4,000원 할인', '제목 칸만 (분류 꼬리표·detail 글자 제외)');
    assert.equal(posts[0].img.src, 'https://img.bk.test/list/1793.jpg');
    assert.equal(posts[2].img, undefined);
    // 목록 제목으로 그 글을 찾는다 (공지·쿠폰 원문 연결에 쓰임)
    assert.equal(new URL(postLinkFor({ title: '26년 11월 딜리버리 21,000원 이상 주문 시 4,000원 할인', evidence: '' }, posts.map((p) => ({ ...p, href: p.href.replace('http:', 'https:') })))).pathname, '/bk/detail/1793.html');
  } finally { await ctx.close(); await site.close(); }
});

test('목록 주소로 소식과 쿠폰을 잇는 것은 쿠폰도 그 목록에서 읽었을 때만 (다른 행사 글의 쿠폰은 잇지 않음)', async () => {
  const { linkNews } = await import('../src/engine.js');
  const L = 'https://www.burgerking.co.kr/event/ongoing';
  const n = { id: 'n1', brand: '버거킹', source_url: 'https://www.burgerking.co.kr/event/detail/1815', list_url: L, start_date: '2026-11-14', end_date: '2026-11-22', programs: [] };
  const base = { brand: '버거킹', status: 'published', start_date: '2026-11-14', end_date: '2026-11-22', programs: [] };
  const coupons = [
    { ...base, id: 'c1815', source_url: `https://www.burgerking.co.kr/event/detail/1815 ${L}` },
    { ...base, id: 'c1793', source_url: `https://www.burgerking.co.kr/event/detail/1793 ${L}` },
    { ...base, id: 'clist', source_url: L },
  ];
  assert.deepEqual(linkNews([n], coupons)[0].related_ids, ['c1815', 'clist']);
});

test('주소가 있는 목록 링크(파파이스 a.box): 링크 주소 그대로 + 제목 칸(dt)만 글 제목으로 → 공지가 그 행사 글로 이어진다 (11/21)', { timeout: 90000 }, async () => {
  const { fileURLToPath } = await import('node:url');
  const { serveDir } = await import('./helpers.js');
  const { openBrowser, renderPage, postRuleFor: rule } = await import('../src/fetch.js');
  const r = rule('https://www.popeyes.co.kr/event');
  assert.equal(r.selector, 'a.box[href]');
  assert.equal(rule('https://popeyes.co.kr/event'), r);
  const site = await serveDir(fileURLToPath(new URL('./fixtures/site', import.meta.url)));
  const ctx = await openBrowser();
  try {
    const page = await renderPage(ctx, `${site.base}/popeyes/event.html`, { selector: 'main', maxShots: 0, post: { ...r, pattern: '^/popeyes/event/\\d{1,6}$' } });
    assert.deepEqual(page.posts.map((p) => [new URL(p.href).pathname, p.text]), [['/popeyes/event/72', '두배로데이 블프위크🎉'], ['/popeyes/event/70', '파파이스 앱 전용 쿠폰 릴레이 위크, 혜택이 팡팡잇스!']]);
    assert.equal(page.posts[0].img.src, 'https://img.popeyes.test/72.jpg');
    const https = page.posts.map((p) => ({ ...p, href: p.href.replace('http:', 'https:') }));
    assert.equal(new URL(postLinkFor({ title: '두배로데이 블프위크 1+1', evidence: '' }, https)).pathname, '/popeyes/event/72');
  } finally { await ctx.close(); await site.close(); }
});

test('요약에 시작·끝이 함께 적힌 기간은 기간 칸이 비어도 읽는다 — 끝난 행사는 버린다 (11/21 파파이스 루이 치킨휠레)', async () => {
  const { textPeriod, normalizeNews } = await import('../src/engine.js');
  const now = new Date('2026-11-21T05:00:00Z');
  assert.deepEqual(textPeriod('10월 23일부터 11월 8일까지 루이 치킨휠레 버거 1개와 치킨샌드위치 1개를 7,900원에', now), { start: '2026-10-23', end: '2026-11-08' });
  assert.deepEqual(textPeriod('행사기간 2026/11/20~2026/11/30', now), { start: '2026-11-20', end: '2026-11-30' });
  assert.deepEqual(textPeriod('12월 20일부터 1월 5일까지', now), { start: '2026-12-20', end: '2027-01-05' });
  for (const t of ['11월 11일 하루', '1+1 행사 10-20개 한정', '오전 11시 ~ 오후 2시', '3,000원 추가 시 세트 업그레이드']) assert.equal(textPeriod(t, now), null, t);
  const n = normalizeNews({ brand: '파파이스', title: '루이 치킨휠레 버거+치킨샌드위치 특가', summary: '10월 23일부터 11월 8일까지 루이 치킨휠레 버거 1개와 치킨샌드위치 1개를 7,900원에 판매합니다.', discount_label: '7,900원' },
    { sourceUrl: 'https://popeyes.co.kr/event', brand: '파파이스', now });
  assert.equal(n.end_date, '2026-11-08');
  assert.equal(n.status, 'rejected');
});

test('파파이스 두배로데이 핫딜: 확인 목록이 공식 행사 글(/event/72)과 그 행사 포스터를 준다', async () => {
  const { noticePhoto, noticeImage } = await import('../src/notice-images.js');
  const n = { brand: '파파이스', title: '두배로데이 블프위크 1+1', source_url: 'https://popeyes.co.kr/event', start_date: '2026-11-20', end_date: '2026-11-30' };
  assert.equal(noticePhoto(n, '2026-11-21').source, 'https://popeyes.co.kr/event/72');
  assert.equal(noticeImage(n, '2026-11-21'), './event-images/popeyes-double-day-bfweek-20261130.webp');
  assert.equal(noticePhoto({ ...n, source_url: 'https://popeyes.co.kr/event/72' }, '2026-11-21').source, 'https://popeyes.co.kr/event/72', '다음 수집부터 상세 글에서 읽어도 같은 공지');
  assert.equal(noticePhoto(n, '2026-12-01'), null, '행사가 끝나면 쓰지 않는다');
});

test('버튼 목록에서 이번에 못 연 글은 지난 실행에서 기억한 주소로 채운다 — 제목이 지금 목록에 있을 때만 (11/22)', async () => {
  const { mergeKnownPosts } = await import('../src/fetch.js');
  const opened = Object.assign([{ href: 'https://bk.test/event/detail/1815', text: '트머와 세트 4종 1,500원 할인' }], { missed: 1 });
  const known = [
    { href: 'https://bk.test/event/detail/1793', text: '26년 11월 딜리버리 21,000원 이상 주문 시 4,000원 할인', seen_at: '2026-11-21T13:00:00Z' },
    { href: 'https://bk.test/event/detail/1815', text: '트머와 세트 4종 1,500원 할인', seen_at: '2026-11-21T13:00:00Z' },
    { href: 'https://bk.test/event/detail/1700', text: '지난달 끝난 행사', seen_at: '2026-11-20T13:00:00Z' },
  ];
  const list = '일반 26년 11월 딜리버리 21,000원 이상 주문 시 4,000원 할인 detail 일반 트머와 세트 4종 1,500원 할인 detail';
  const out = mergeKnownPosts(opened, known, list);
  assert.deepEqual(out.map((p) => [p.href.split('/').pop(), !!p.remembered]), [['1815', false], ['1793', true]]);
  assert.equal(out.missed, 1);
});

test('글 주소 기억은 7일만, 기억으로 채운 글은 다시 기억하지 않는다', async () => {
  const { PageCache } = await import('../src/page-cache.js');
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const file = join(mkdtempSync(join(tmpdir(), 'pc-')), 'pages.json');
  const c = new PageCache(file);
  const L = 'https://www.burgerking.co.kr/event/ongoing';
  c.rememberPosts(L, [{ href: 'a', text: '가' }, { href: 'b', text: '나', remembered: true }], new Date('2026-11-21T13:00:00Z'));
  c.save(new Date('2026-11-21T13:00:00Z'));
  const d = new PageCache(file);
  assert.deepEqual(d.knownPosts(L, new Date('2026-11-22T00:00:00Z')).map((p) => p.href), ['a']);
  assert.deepEqual(d.knownPosts(L, new Date('2026-11-29T00:00:00Z')), [], '7일 지나면 잊는다');
});

test('메뉴 자리에 주문 방법만 있으면 전 메뉴 + 그 주문 방법, 행사 이름만 있으면 게시하지 않고 보류한다 (11/22 버거킹)', async () => {
  const { normalizeAndValidate } = await import('../src/engine.js');
  const now = new Date('2026-11-22T05:00:00Z');
  const a = normalizeAndValidate({ brand: '버거킹', menu: '딜리버리', discount_type: 'amount', discount_value: 4000, min_order: 21000, evidence: '26년 11월 딜리버리 21,000원 이상 주문 시 4,000원 할인' }, { brand: '버거킹', now });
  assert.equal(a.menu, '전 메뉴');
  assert.deepEqual(a.channels, ['배달']);
  const b = normalizeAndValidate({ brand: '버거킹', menu: '프로모션', discount_type: 'price', coupon_price: 6000, evidence: '26년 11월 2FOR6000 + 2FOR7000원 프로모션' }, { brand: '버거킹', now });
  assert.equal(b.status, 'pending', '게시하지 않고 사람이 확인');
  assert.ok(b.issues.includes('메뉴가 행사 이름뿐 (어떤 메뉴인지 불명확)'));
  const c = normalizeAndValidate({ brand: '버거킹', menu: '와퍼 세트', discount_type: 'price', coupon_price: 6000, evidence: '와퍼 세트 6,000원' }, { brand: '버거킹', now });
  assert.equal(c.menu, '와퍼 세트');
});

// 11/22 정확도 점검: 자정 수집에서 목록 한 장만 읽던 출처들 — 실제 목록 모양(11/22 공식 사이트 확인)으로 글 주소와 제목을 뽑는다
test('메가·도미노·굽네·할리스·BBQ 목록에서 행사 글 주소를 뽑는다 (목록만 읽던 출처, 11/22)', async () => {
  const { fileURLToPath } = await import('node:url');
  const { serveDir } = await import('./helpers.js');
  const { openBrowser, renderPage, postRuleFor: rule } = await import('../src/fetch.js');
  const R = {
    mega: rule('https://www.mega-mgccoffee.com/bbs/?bbs_category=3'),
    dominos: rule('https://web.dominos.co.kr/event/list?gubun=E0200'),
    goobne: rule('https://www.goobne.co.kr/brd/event/list_p'),
    hollys: rule('https://www.hollys.co.kr/news/event/list.do'),
    bbq: rule('https://bbq.co.kr/events'),
  };
  for (const [k, r] of Object.entries(R)) assert.ok(r && r.selector, k);
  const site = await serveDir(fileURLToPath(new URL('./fixtures/site', import.meta.url)));
  const ctx = await openBrowser();
  const read = async (name) => (await renderPage(ctx, `${site.base}/accuracy/${name}.html`, { selector: 'main', maxShots: 0, post: R[name] })).posts;
  try {
    const mega = await read('mega');
    assert.deepEqual(mega.map((p) => p.text), ['[이벤트] 11월 메가MGC커피 X 신한 SOL페이 적립 EVENT', '[출시] 샌드위치 신메뉴 출시']);
    assert.match(new URL(mega[0].href).pathname + new URL(mega[0].href).search, /^\/accuracy\/detail\/\?YmJz/);
    assert.equal(mega[0].img.src, 'https://img.mega.test/714.jpg');

    const dom = await read('dominos');
    assert.deepEqual(dom.map((p) => p.href), [2100, 2184, 2493].map((n) => `https://web.dominos.co.kr/event/viewHtml?seq=${n}&gubun=E0200`));
    assert.match(dom[1].text, /도미노스데이: 모든 피자 포장 40% 할인/);
    assert.equal(postLinkFor({ title: '도미노스데이 모든 피자 포장 40% 할인', evidence: '' }, dom), dom[1].href);

    const goob = await read('goobne');
    assert.deepEqual(goob.map((p) => [p.href, p.text]), [
      ['https://www.goobne.co.kr/brd/event/view_p?seq=90127', '콕 찍어도 굽네는 정답! 수능 대박 기원 굽네 할인!'],
      ['https://www.goobne.co.kr/brd/event/view_p?seq=90126', '입맛도는 가을엔 굽네 먹자! 매주 금토일 4천원 할인!'],
    ]);

    const hol = await read('hollys');
    assert.deepEqual(hol.map((p) => p.href), ['https://www.hollys.co.kr/news/event/view.do?idx=572&pageNo=1', 'https://www.hollys.co.kr/news/event/view.do?idx=569&pageNo=1'], '한 칸의 링크 둘은 글 하나');
    assert.match(hol[0].text, /11월의 선물/);

    const bbq = await read('bbq');
    assert.deepEqual(bbq.map((p) => new URL(p.href).pathname), ['/events/200'], '진행/지난 이벤트 탭 링크는 글이 아니다');
    assert.equal(postLinkFor({ title: 'BBQ 리니지2M 콜라보', evidence: '' }, bbq.map((p) => ({ ...p, href: p.href.replace('http:', 'https:') }))), '', '제목 없는 글로는 공지를 보내지 않는다');
  } finally { await ctx.close(); await site.close(); }
});

test('날짜 하나에 \'단 하루\'가 붙은 혜택은 그 날 하루로 — 기간 칸이 비어 \'종료일 미정\'으로 남지 않게 (11/22 파리바게뜨 수험생 츄러스)', async () => {
  const { oneDay, normalizeAndValidate } = await import('../src/engine.js');
  const now = new Date('2026-11-22T03:00:00Z');
  assert.equal(oneDay('11/22(일), 단 하루! 수험생 대상. 수험표 제시 및 27년 필적문구 언급 시', now), '2026-11-22');
  assert.equal(oneDay('단 하루! 11월 22일', now), '2026-11-22');
  for (const t of ['11/20 ~ 11/22 단 하루', '매월 22일 하루 한정', '11/22 수험생 대상', '11/22(일) 당일 한정, 11/23 사용 불가', '1인 1회, 수험표 제시']) assert.equal(oneDay(t, now), null, t);
  const c = normalizeAndValidate({ brand: '파리바게뜨', menu: '초코쫀득츄러스', discount_type: 'free_item', conditions: '11/22(일), 단 하루! 수험생 대상. 수험표 제시 및 27년 필적문구 언급 시', evidence: '수험생 초코쫀득츄러스 1+1', confidence: 0.9 },
    { sourceUrl: 'https://www.paris.co.kr/promotion/', brand: '파리바게뜨', now });
  assert.equal(c.start_date, '2026-11-22');
  assert.equal(c.end_date, '2026-11-22');
  const next = normalizeAndValidate({ brand: '파리바게뜨', menu: '초코쫀득츄러스', discount_type: 'free_item', conditions: '11/22(일), 단 하루!', confidence: 0.9 },
    { sourceUrl: 'https://www.paris.co.kr/promotion/', brand: '파리바게뜨', now: new Date('2026-11-23T03:00:00Z') });
  assert.equal(next.status, 'rejected', '다음 날에는 끝난 혜택');
});

test('조건에 적힌 기간(10/29(목)-11/3(화))으로 기간 칸을 채워 끝난 특가를 게시하지 않는다 (11/23 메가커피)', async () => {
  const { textPeriod, normalizeAndValidate } = await import('../src/engine.js');
  const now = new Date('2026-11-22T03:00:00Z');
  assert.deepEqual(textPeriod('10/29(목)-11/3(화)', now), { start: '2026-10-29', end: '2026-11-03' });
  assert.deepEqual(textPeriod('행사 기간 11/20(목)-11/30(일)', now), { start: '2026-11-20', end: '2026-11-30' });
  for (const t of ['1+1 행사 10-20개 한정', '문의 010-1234-5678', '11월 11일 하루']) assert.equal(textPeriod(t, now), null, t);
  const ended = normalizeAndValidate({ brand: '메가MGC커피', menu: '쫀득 모찌 밀크티', regular_price: 3800, coupon_price: 3300, discount_type: 'price', conditions: '10/29(목)-11/3(화)', evidence: '쫀득 모찌 밀크티 3,800원 → 3,300원', confidence: 0.95 },
    { sourceUrl: 'https://www.mega-mgccoffee.com/bbs/detail/?x', brand: '메가MGC커피', now });
  assert.equal(ended.status, 'rejected');
  assert.equal(ended.end_date, '2026-11-03');
  const live = normalizeAndValidate({ brand: '메가MGC커피', menu: '딥 초코 체리 프라페', regular_price: 4400, coupon_price: 3900, discount_type: 'price', conditions: '11/20(금)-11/25(수)', evidence: '딥 초코 체리 프라페 4,400원 → 3,900원', confidence: 0.95 },
    { sourceUrl: 'https://www.mega-mgccoffee.com/bbs/detail/?y', brand: '메가MGC커피', now });
  assert.equal(live.start_date, '2026-11-20');
  assert.equal(live.end_date, '2026-11-25');
  assert.notEqual(live.status, 'rejected');
});

test('11/23 표본 점검: 배달앱 제휴(푸라닭 X 요기요)·친구 초대 미션은 버리고, 요일 한정은 조건에 남긴다', async () => {
  const { normalizeAndValidate, normalizeNews, weekdayNote, isDeliveryAppOnly } = await import('../src/engine.js');
  const now = new Date('2026-11-23T01:00:00Z');
  assert.equal(isDeliveryAppOnly('[푸라닭 X 요기요] 전메뉴 최대 5,500원 할인! 요기요 회원 대상, 비회원 적용 불가'), true);
  assert.equal(isDeliveryAppOnly('배민 주문 시 적용 불가, 매장 전용'), false, '배달앱 제외 문구는 그대로 게시 대상');
  const yogiyo = normalizeAndValidate({ brand: '푸라닭', menu: '전 메뉴', discount_type: 'amount', discount_value: 5500, conditions: '요기요 회원 대상, 비회원 적용 불가', evidence: '[푸라닭 X 요기요] 전메뉴 최대 5,500원 할인!', start_date: '2026-11-09', end_date: '2026-11-30', confidence: 0.9 },
    { sourceUrl: 'https://www.puradakchicken.com/news/event.asp', brand: '푸라닭', now });
  assert.equal(yogiyo.status, 'rejected');
  assert.ok(yogiyo.issues.some((x) => /배달앱/.test(x)));
  const invite = normalizeNews({ title: 'KFC 친구 초대 이벤트', summary: '초대 미션을 완수하면 최대 10만원 할인 쿠폰', discount_label: '최대 10만원 할인', start_date: '2026-11-10', end_date: '2027-01-04', evidence: 'THE MISSION : 친구초대 초대 미션을 완수하고 보상을 받으세요' },
    { sourceUrl: 'https://www.kfckorea.com/promotion/promotionList/detail/1133', brand: 'KFC', now });
  assert.equal(invite.status, 'rejected');
  assert.equal(weekdayNote('피자 라지 사이즈 이상 주문 시', '매주 수요일은 반올림데이 APP 주문 시 배달 4천원'), '매주 수요일 한정 · 피자 라지 사이즈 이상 주문 시');
  assert.equal(weekdayNote('', '매주 금토일 4천원 할인!'), '매주 금토일 한정');
  assert.equal(weekdayNote('x', '수퍼데이 매주 수요일 / 프라이데이 매주 금요일'), 'x', '요일이 둘 이상이면 건드리지 않는다');
  const wed = normalizeAndValidate({ brand: '반올림피자', menu: '전 메뉴', discount_type: 'amount', discount_value: 4000, channels: ['배달'], conditions: '피자 라지 사이즈 이상 주문 시 사용 가능', evidence: '매주 수요일은 반올림데이 APP 주문 시 전메뉴 배달 4천원', start_date: '2024-07-01', end_date: '2027-08-03', confidence: 0.9 },
    { sourceUrl: 'https://order.banolimpizza.com/event/detail/x', brand: '반올림피자', now });
  assert.match(wed.conditions, /^매주 수요일 한정/);
});
