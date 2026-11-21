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
