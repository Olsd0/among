// 11/21 외부 피드백: 버거킹 '전 메뉴 4000원 할인'(배달 전용·최소 주문)처럼 조건이 많은 혜택도
// 얼마나 할인되는지 → 내가 쓸 수 있는지 → 언제까지가 카드 한 장에서 같은 순서로 읽히고, 공식 행사 글로 바로 간다.
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serveDir } from './helpers.js';

let site, browser;
before(async () => { site = await serveDir(fileURLToPath(new URL('../../web/', import.meta.url))); browser = await chromium.launch(); });
after(async () => { if (browser) await browser.close(); if (site) await site.close(); });

const now = new Date().toISOString();
const kst = (n) => new Date(Date.now() + 9 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
const base = { channels: ['매장'], audience: '전체', programs: [], checked_at: now, first_seen: now, status: 'published', item_type: '단품', category: '햄버거' };
const COUPONS = [
  { ...base, id: 'bk', brand: '버거킹', menu: '전 메뉴', discount_type: 'amount', discount_value: 4000, min_order: 21000, channels: ['배달'], app_only: true, stackable: 'no',
    start_date: kst(-5), end_date: kst(1), // 실제 상세 글에서 읽은 문장 (11/21 수집) + 목록 제목에서 읽은 최소 주문 문장
    conditions: '21,000원 이상 주문 시 · 딜리버리 프로모션으로 매장 내 주문 불가, 다른 쿠폰/프로모션과 중복 할인 적용 불가 · 일부 매장 제외',
    source_url: 'https://www.burgerking.co.kr/event/detail/1793 https://www.burgerking.co.kr/event/ongoing', official_link: 'https://www.burgerking.co.kr/event/ongoing' },
  { ...base, id: 'kt', brand: '테스트버거', menu: '불고기 버거', discount_type: 'percent', discount_rate: 20, programs: ['KT'], end_date: null,
    source_url: 'https://membership.kt.com/x', official_link: 'https://membership.kt.com/x' },
  // 11/22 정확도 점검: 피자헛 주말 1+1 (메뉴에 'M SIZE + M SIZE'만 적힘) / 같은 피자헛의 굿즈 증정은 그대로 '증정'
  { ...base, id: 'ph11', brand: '피자헛', category: '피자', item_type: '세트', menu: '프리미엄 피자 또는 US 오리진 피자 (M SIZE + M SIZE)', discount_type: 'free_item',
    regular_price: 46400, coupon_price: 46400, channels: ['픽업'], start_date: kst(-3), end_date: kst(8), source_url: 'https://www.pizzahut.co.kr/cs/event/extra/hellopizzahut' },
  { ...base, id: 'phgift', brand: '피자헛', category: '피자', item_type: '세트', menu: '안창 스테이크 슈프림 + 피자헛 클리커', discount_type: 'free_item',
    regular_price: 35900, coupon_price: 35900, start_date: kst(-3), end_date: kst(30), source_url: 'https://www.pizzahut.co.kr/cs/event/829' },
];

async function open(colorScheme = 'light') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block', colorScheme });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === site.base) return route.continue();
    if (url.hostname === 'script.google.com') {
      const json = url.searchParams.get('action') === 'coupons' ? { ok: true, coupons: COUPONS, news: [], last_checked_at: now } : { ok: true, state: 'idle', last_checked_at: now };
      return route.fulfill({ status: 200, json, headers: { 'access-control-allow-origin': '*' } });
    }
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(site.base + '/index.html');
  await page.waitForSelector('#card-bk');
  return { context, page };
}

test('카드 한 장: 얼마나(낼 돈) → 누가·앱·배달 → 날짜와 D-day → 공식 행사 글', { timeout: 30000 }, async (t) => {
  const { context, page } = await open();
  t.after(() => context.close());
  const card = page.locator('#card-bk');
  assert.match(await card.locator('.price').innerText(), /^21000원 주문하면\s+17000원$/);
  assert.deepEqual(await card.locator('.conds > span').allInnerTexts(), ['누구나', '앱 전용', '배달 전용']);
  assert.match(await card.locator('.foot .chip').innerText(), /\d+\/\d+까지\s*D-1$/, '날짜와 D-day를 함께');
  // 읽는 순서 = 화면 위에서 아래로
  const ys = await card.evaluate((el) => ['.price', '.conds', '.foot'].map((s) => el.querySelector(s).getBoundingClientRect().top));
  assert.ok(ys[0] < ys[1] && ys[1] < ys[2], JSON.stringify(ys));
  // 목록이 아니라 혜택을 읽은 그 행사 글로, 줄바꿈 없이 한 줄
  const cta = card.locator('.cta');
  assert.equal(await cta.getAttribute('href'), 'https://www.burgerking.co.kr/event/detail/1793');
  assert.match(await cta.innerText(), /^공식 행사 보기/);
  const [chipBox, ctaBox] = [await card.locator('.foot .chip').boundingBox(), await cta.boundingBox()];
  assert.ok(Math.abs(chipBox.y + chipBox.height / 2 - (ctaBox.y + ctaBox.height / 2)) < 4, '기간과 버튼이 한 줄');

  // 다른 카드도 같은 자리: 멤버십이 필요한 혜택은 첫 마디가 '…회원', 끝나는 날을 모르면 모른다고
  const kt = page.locator('#card-kt');
  assert.match(await kt.locator('.conds').innerText(), /^KT 멤버십 회원/);
  assert.match(await kt.locator('.foot .chip').innerText(), /종료일 미정/);
  assert.match(await kt.locator('.cta').innerText(), /^KT 멤버십/);
  assert.equal(await kt.locator('.cta').getAttribute('href'), 'https://membership.kt.com/x', '제휴 페이지는 그대로');
});

test('펼친 상세도 같은 순서이고, 같은 조건을 두 번 쓰지 않는다', { timeout: 30000 }, async (t) => {
  const { context, page } = await open('dark');
  t.after(() => context.close());
  await page.click('#card-bk .more');
  const dl = page.locator('#dt-bk dl');
  const terms = await dl.locator('dt').allInnerTexts();
  assert.deepEqual(terms, ['혜택', '대상', '주문', '기간', '중복', '유의']);
  const text = (await dl.innerText()).replace(/\s+/g, ' ');
  assert.match(text, /21000원 이상 주문 시 4000원 할인/);
  assert.match(text, /21000원 주문하면 17000원을 내요/);
  assert.match(text, /누구나 \(버거킹 앱 회원\)/);
  assert.doesNotMatch(text, /필요/);
  assert.equal((text.match(/21,?000원 이상/g) || []).length, 1, '최소 주문은 한 번만: ' + text);
  assert.equal((text.match(/중복/g) || []).length, 1, '중복 불가도 한 번만');
  assert.match(text, /유의 딜리버리 프로모션으로 매장 내 주문 불가 · 일부 매장 제외/);
  assert.match(await page.locator('#dt-bk .src').innerText(), /burgerking\.co\.kr 공식 행사 글/);
  assert.equal(await page.locator('#dt-bk .coupon-artwork').count(), 0, '전 메뉴 할인에 브랜드 대표 메뉴 사진을 크게 걸지 않음');
});

test('브랜드 화면(버거킹 앱 흐름): 공식 행사 페이지 → 진행 중인 행사 배너(공지 + 공지 없는 쿠폰 행사) → 혜택', { timeout: 30000 }, async (t) => {
  const { context, page } = await open();
  t.after(() => context.close());
  // 공지 하나(1815)와, 공지는 없지만 공식 행사 배너가 있는 쿠폰(1793)
  await context.unroute('**/*');
  const banner = 'https://mob-prd.burgerking.co.kr/images/event/app/list/2026/11/06/bk1793.jpg';
  const art = `${banner}#among-artwork=${encodeURIComponent(JSON.stringify({ kind: 'official_event', source: 'https://www.burgerking.co.kr/event/detail/1793', checkedAt: now, credit: '' }))}`;
  const coupons = [{ ...COUPONS[0], image_url: art }, { ...COUPONS[0], id: 'bk2', menu: '트머와 세트 4종', discount_value: 1500, min_order: null, channels: [], app_only: false, stackable: '',
    source_url: 'https://www.burgerking.co.kr/event/detail/1815 https://www.burgerking.co.kr/event/ongoing' }];
  const news = [{ id: 'n1815', brand: '버거킹', category: '햄버거', title: '트머와 세트 4종 할인', summary: '', discount_label: '1,500원 할인', start_date: kst(-3), end_date: kst(1), programs: [],
    image_url: '', related_ids: ['bk2'], source_url: 'https://www.burgerking.co.kr/event/detail/1815', official_link: 'https://www.burgerking.co.kr/event/ongoing', first_seen: now, checked_at: now, status: 'published' }];
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === site.base) return route.continue();
    if (url.hostname === 'script.google.com') {
      const json = url.searchParams.get('action') === 'coupons' ? { ok: true, coupons, news, last_checked_at: now } : { ok: true, state: 'idle', last_checked_at: now };
      return route.fulfill({ status: 200, json, headers: { 'access-control-allow-origin': '*' } });
    }
    return route.abort();
  });
  await page.reload();
  await page.waitForSelector('#card-bk');
  await page.click('[data-view="brands"]');
  await page.click('[data-brand-open="버거킹"]');
  await page.locator('#hot.stack').waitFor();
  assert.match(await page.locator('.brand-heading p').innerText(), /진행 중인 행사 2개 · 혜택 2개/);
  assert.equal(await page.locator('.brand-events').getAttribute('href'), 'https://www.burgerking.co.kr/event/ongoing');
  assert.equal(await page.locator('#hot h2').innerText(), '진행 중인 행사');
  const cards = page.locator('#hotRail > .hcard');
  assert.equal(await cards.count(), 2);
  const titles = await page.locator('#hotRail .tt').allInnerTexts();
  assert.deepEqual(titles.sort(), ['전 메뉴 4000원 할인', '트머와 세트 4종 할인']);
  const ev = page.locator('[data-hot="coupon:bk"]');
  assert.equal(await ev.locator('.hot-source').getAttribute('href'), 'https://www.burgerking.co.kr/event/detail/1793');
  assert.match(await ev.locator('.period').innerText(), /D-1/);
  // 세로 목록: 두 배너가 위아래로, 넘김 버튼·점 없음, 카테고리 칸 없음
  // (화면이 스크롤되는 중일 수 있어 boundingBox 대신 문서 안 위치로 비교)
  const [a, b] = await cards.evaluateAll((els) => els.map((el) => ({ x: el.offsetLeft, y: el.offsetTop, h: el.offsetHeight })));
  assert.ok(b.y >= a.y + a.h && a.x === b.x, JSON.stringify([a, b]));
  assert.equal(await page.locator('#railControls').isHidden(), true);
  assert.equal(await page.locator('#grid').isHidden(), true);
  assert.equal(await page.locator('#showAllNotices').isHidden(), true);
  // 배너의 '상세 보기'는 아래 혜택 카드를 펼친다
  await ev.locator('.hot-open').click();
  await page.locator('#dt-bk dl').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('같은 공식 행사 글에서 읽은 쿠폰은 그 글의 포스터를 쓴다 — 여러 행사가 섞인 목록 주소로는 빌리지 않는다 (11/22 파파이스)', { timeout: 30000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  t.after(() => context.close());
  const poster = './event-images/popeyes-double-day-bfweek-20261130.webp';
  const p = { ...base, brand: '파파이스', category: '치킨', discount_type: 'free_item', start_date: kst(-2), end_date: kst(7), official_link: 'https://www.popeyes.co.kr/event' };
  const coupons = [
    { ...p, id: 'pp1', menu: '루이 블랙페퍼 버거', source_url: 'https://popeyes.co.kr/event/72 https://popeyes.co.kr/event' },
    { ...p, id: 'pp2', menu: '치킨', source_url: 'https://popeyes.co.kr/event/72' },
    { ...p, id: 'pp3', menu: '레그 순살 치킨', source_url: 'https://www.popeyes.co.kr/event' },
  ];
  const news = [{ id: 'n72', brand: '파파이스', category: '치킨', title: '두배로데이 블프위크 1+1', summary: '', start_date: kst(-2), end_date: kst(7), programs: [], related_ids: [],
    image_url: poster, source_url: 'https://popeyes.co.kr/event/72', official_link: 'https://www.popeyes.co.kr/event', checked_at: now, first_seen: now, status: 'published' }];
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === site.base) return route.continue();
    if (url.hostname === 'script.google.com') {
      const json = url.searchParams.get('action') === 'coupons' ? { ok: true, coupons, news, last_checked_at: now } : { ok: true, state: 'idle', last_checked_at: now };
      return route.fulfill({ status: 200, json, headers: { 'access-control-allow-origin': '*' } });
    }
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(site.base + '/index.html');
  await page.waitForSelector('#card-pp1');
  for (const id of ['pp1', 'pp2']) assert.match(await page.locator(`#card-${id} .stub img`).getAttribute('src'), /popeyes-double-day-bfweek/, id);
  const other = page.locator('#card-pp3 .stub img');
  assert.ok(!(await other.count()) || !/popeyes-double-day-bfweek/.test(await other.getAttribute('src')), '목록 주소에서 읽은 다른 행사 쿠폰은 빌리지 않음');
});

test('피자 두 판이 적힌 증정은 1+1로, 굿즈 증정은 그대로 증정으로 (11/22 피자헛 주말 1+1)', { timeout: 30000 }, async (t) => {
  const { context, page } = await open();
  t.after(() => context.close());
  const one = page.locator('#card-ph11');
  assert.match(await one.innerText(), /1\+1/);
  assert.match(await one.locator('.price').innerText(), /46400원\s*결제 시\s*하나 더 \(1\+1\)/);
  const gift = page.locator('#card-phgift');
  assert.match(await gift.locator('.price').innerText(), /35900원\s*결제 시\s*함께 증정/);
});
