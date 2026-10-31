// 모바일 화면에서 실제로 보이는 최신성 안내, 재시도, 키보드와 초기 표시를 검증한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import { productImage } from '../src/product-images.js';
import { noticeImage } from '../src/notice-images.js';
import { officialBrandLogo } from '../../web/brand-logos.js';
import { serveDir } from './helpers.js';

let site, browser;
before(async () => {
  site = await serveDir(new URL('../../web/', import.meta.url).pathname);
  browser = await chromium.launch();
});
after(async () => { if (browser) await browser.close(); if (site) await site.close(); });

const ago = (hours) => new Date(Date.now() - hours * 3600e3).toISOString();
function coupon(id, checkedAt = ago(1)) {
  return { id, brand: '테스트버거', category: '햄버거', menu: `테스트 혜택 ${id}`, item_type: '단품',
    discount_type: 'price', regular_price: 8000, coupon_price: 5000, discount_rate: 38,
    channels: ['매장'], audience: '전체', programs: [], start_date: null, end_date: null,
    checked_at: checkedAt, first_seen: ago(1), source_url: 'https://example.test/event', official_link: 'https://example.test/event' };
}
function news(id, checkedAt) {
  return { id, brand: '테스트버거', category: '햄버거', title: `테스트 행사 ${id}`, summary: '할인 행사',
    discount_label: '40%', programs: [], checked_at: checkedAt, first_seen: ago(1), end_date: new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10),
    source_url: 'https://example.test/event', related_ids: [] };
}
async function setup(data, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
  const page = await context.newPage();
  let couponCalls = 0;
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (options.requests) options.requests.push(url.href);
    // 실제 상품 사진처럼 최소 너비(80px) 검증을 통과하는 100px PNG.
    if (options.photoUrl === url.href || (options.photoUrls || []).includes(url.href)) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAA6ElEQVR4nO3QwQ3AIBDAsNL9dz5WIC+EZE8QZc3Mx5n/dsBLzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCjbP8QPFyqa8aAAAAABJRU5ErkJggg==', 'base64') });
    if ((options.failImages || []).some((path) => url.href === new URL(path, site.base).href)) return route.abort();
    if (url.origin === site.base) return route.continue();
    if (url.hostname === 'script.google.com') {
      if (url.searchParams.get('action') === 'coupons') {
        couponCalls++;
        if (options.failCoupons && couponCalls <= options.failCoupons) return route.abort('failed');
        return route.fulfill({ status: 200, json: data, headers: { 'access-control-allow-origin': '*' } });
      }
      return route.fulfill({ status: 200, json: { ok: true, state: 'idle', last_checked_at: data.last_checked_at }, headers: { 'access-control-allow-origin': '*' } });
    }
    if (url.hostname === 'example.test') return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>공식 행사</title>' });
    return route.abort();
  });
  if (options.cache) await page.addInitScript((cache) => localStorage.setItem('among_cache', JSON.stringify(cache)), options.cache);
  if (options.blockFollowing) await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === 'among_following') throw new DOMException('Storage blocked', 'QuotaExceededError'); return set.call(this, key, value); };
  });
  return { context, page };
}

test('공개 공지로 확인한 해피포인트 50% 할인만 추천하고 작은 할인과 종료 행사는 제외한다', { timeout: 30000 }, async (t) => {
  const now = '2026-10-29T03:00:00.000Z';
  const eligible = { id: 'happy-public', brand: '테스트버거', category: '햄버거', title: '기간 한정 50% 할인', summary: '공식 웹 공지에서 조건을 확인한 행사', discount_label: '50% 할인', programs: ['해피포인트'], source_url: 'https://example.test/event', start_date: '2026-10-26', end_date: '2026-10-30', checked_at: now };
  const low = { ...eligible, id: 'happy-small', brand: '테스트카페', title: '40% 할인', summary: '기간 한정 40% 할인 행사', discount_label: '40%' };
  const { context, page } = await setup({ ok: true, last_checked_at: now, coupons: [], news: [eligible, low] });
  t.after(() => context.close());
  await page.clock.setFixedTime(new Date(now));
  await page.goto(`${site.base}/index.html`);
  const card = page.locator('[data-hot="news:happy-public"]');
  await card.waitFor();
  assert.equal(await page.locator('[data-hot="news:happy-small"]').count(), 0);
  assert.equal(await card.locator('.lbl').count(), 0);
  await card.click();
  assert.equal(await page.locator('[data-news-src]').getAttribute('href'), eligible.source_url);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.clock.setFixedTime(new Date('2026-10-31T03:00:00.000Z'));
  await page.reload();
  await page.locator('#list[aria-busy="false"]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('[data-hot="news:happy-public"]').count(), 0);
});

test('브랜드 검색·구독·상세·새로고침·구독 취소가 이어지고 모바일·데스크톱에서 넘치지 않는다', { timeout: 30000 }, async (t) => {
  const data = { ok: true, last_checked_at: ago(1), coupons: [coupon('burger'), { ...coupon('coffee'), brand: '테스트카페', category: '카페' }], news: [] };
  const { context, page } = await setup(data);
  t.after(() => context.close());
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${site.base}/index.html`);
  await page.locator('#card-burger').waitFor();
  assert.equal(await page.locator('.wordmark').innerText(), 'AMONG');
  await page.locator('[data-view="following"]').click();
  await page.getByRole('button', { name: '브랜드 둘러보기' }).click();
  assert.equal(await page.locator('#list').isHidden(), true);
  await page.getByRole('searchbox', { name: '브랜드 찾기' }).fill('버거');
  assert.equal(await page.locator('.brand-tile').count(), 1);
  await page.getByRole('button', { name: '테스트버거 구독', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '테스트버거 구독 취소' }).getAttribute('aria-pressed'), 'true');
  await page.locator('.brand-open').click();
  assert.equal(await page.locator('#brandTitle').innerText(), '테스트버거');
  assert.equal(await page.locator('#list .card').count(), 1);
  assert.equal(await page.locator('#card-coffee').count(), 0);
  await page.reload();
  await page.locator('#card-coffee').waitFor();
  await page.locator('[data-view="following"]').click();
  assert.equal(await page.locator('#followingCount').innerText(), '1');
  assert.equal(await page.locator('#list .card').count(), 1);
  for (const width of [360, 390, 820]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `폭 ${width}`);
  }
  await page.getByRole('button', { name: '테스트버거 구독 취소' }).click();
  await page.getByRole('button', { name: '브랜드 둘러보기' }).waitFor();
  assert.equal(await page.locator('#list').isHidden(), true);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('among_following'))), []);
  assert.deepEqual(errors, []);
});

test('구독을 저장하지 못하면 구독 버튼과 개수를 바꾸지 않고 안내한다', { timeout: 30000 }, async (t) => {
  const { context, page } = await setup({ ok: true, last_checked_at: ago(1), coupons: [coupon('one')], news: [] }, { blockFollowing: true });
  t.after(() => context.close());
  await page.goto(`${site.base}/index.html`);
  await page.locator('#card-one').waitFor();
  await page.locator('[data-view="brands"]').click();
  const button = page.getByRole('button', { name: '테스트버거 구독', exact: true });
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#followingCount').innerText(), '');
  assert.match(await page.locator('#toast').innerText(), /저장하지 못했어요/);
});

test('제휴 혜택과 공지만 있는 브랜드도 공식 로고를 쓰고, 이미지 실패 시 첫 글자를 유지한다', { timeout: 30000 }, async (t) => {
  const gong = officialBrandLogo('공차').image;
  const popeyes = officialBrandLogo('파파이스').image;
  const data = { ok: true, last_checked_at: ago(1), coupons: [
    { ...coupon('gong'), brand: '공차', category: '카페', source_url: 'https://m.tworld.co.kr/membership/benefit/brand', official_link: 'https://m.tworld.co.kr/membership/benefit/brand' },
    { ...coupon('domino'), brand: '도미노피자' },
  ], news: [{ ...news('popeyes', ago(1)), brand: '파파이스' }] };
  const requests = [];
  const { context, page } = await setup(data, { photoUrls: [gong, popeyes], requests, failImages: [officialBrandLogo('도미노피자').image] });
  t.after(() => context.close());
  await page.goto(`${site.base}/index.html`);
  await page.locator('#card-gong').waitFor();
  assert.equal(await page.locator('#card-gong .logo').getAttribute('src'), gong);
  await page.locator('[data-view="brands"]').click();
  for (const [brand, src] of [['공차', gong], ['파파이스', popeyes]]) {
    const img = page.locator(`.brand-open[data-brand-open="${brand}"] img.logo`);
    await img.scrollIntoViewIfNeeded();
    await page.waitForFunction((brand) => document.querySelector(`.brand-open[data-brand-open="${brand}"] img`)?.naturalWidth > 0, brand);
    assert.equal(await img.getAttribute('src'), src);
  }
  const failed = page.locator('.brand-open[data-brand-open="도미노피자"]');
  await failed.scrollIntoViewIfNeeded();
  await failed.locator('img.logo').waitFor({ state: 'detached' });
  assert.equal(await failed.locator('.brand-avatar').innerText(), '도');
  assert.ok(!requests.some((url) => /gong-cha|popeyes\.co\.kr|dominos\.co\.kr/.test(url)), '확인된 로고는 외부 브랜드 서버에 요청하지 않는다');
  assert.ok(!requests.some((url) => url.includes('favicons?domain=tworld') || url.includes('tworld.co.kr/favicon')), '통신사 아이콘을 브랜드 로고로 요청하지 않는다');
});

test('핫딜은 해당 공식 공지 이미지를 보여주고 상세에서 원본과 정확한 공지로 연결한다', { timeout: 30000 }, async (t) => {
  const now = '2026-10-29T03:00:00.000Z';
  const n = { id: 'official', brand: 'KFC', category: '치킨', title: '더블 커넬위크', summary: '공식 행사', discount_label: '1+1', programs: [], checked_at: now, first_seen: now, start_date: '2026-10-27', end_date: '2026-11-01', source_url: 'https://www.kfckorea.com/promotion/promotionList/A801' };
  const photoUrl = noticeImage(n, '2026-10-29');
  const { context, page } = await setup({ ok: true, last_checked_at: now, coupons: [], news: [n] }, { photoUrl });
  t.after(() => context.close());
  await page.clock.setFixedTime(new Date(now));
  await page.goto(`${site.base}/index.html`);
  const hot = page.locator('[data-hot="news:official"]');
  await hot.waitFor();
  assert.equal(await hot.locator('.lbl').count(), 0, '공지 카드 아래에 혜택 숫자를 중복 표시하지 않는다');
  assert.equal(await hot.locator('img.ph').getAttribute('src'), photoUrl);
  assert.match(await hot.locator('.hot-source').getAttribute('href'), /detail\/1130$/);
  assert.equal(await hot.locator('img.ph').evaluate((el) => getComputedStyle(el).objectFit), 'cover');
  await hot.click();
  assert.equal(await page.locator('.notice-original').getAttribute('href'), photoUrl);
  assert.match(await page.locator('[data-news-src]').getAttribute('href'), /detail\/1130$/);
  assert.equal(await page.locator('#newsBody img.ph').evaluate((el) => getComputedStyle(el).objectFit), 'contain');
});

test('일부 출처가 오래됐으면 경고와 카드 표시를 보이고 최신 핫딜만 추천한다', { timeout: 30000 }, async (t) => {
  const data = { ok: true, last_checked_at: ago(1), coupons: [coupon('fresh'), coupon('old', ago(72))],
    news: [news('fresh', ago(1)), news('old', ago(72))] };
  const { context, page } = await setup(data);
  t.after(() => context.close());
  await page.goto(`${site.base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#list .card').first().waitFor();
  assert.match(await page.locator('#errNote').innerText(), /일부 혜택/);
  assert.match(await page.locator('#card-old').innerText(), /출처 재확인 필요/);
  assert.doesNotMatch(await page.locator('#card-fresh').innerText(), /출처 재확인 필요/);
  assert.match(await page.locator('#hotRail').innerText(), /테스트 행사 fresh/);
  assert.doesNotMatch(await page.locator('#hotRail').innerText(), /테스트 행사 old/);

  // 링크의 Enter는 바깥 카드의 키보드 핸들러에 가로채이지 않는다.
  const link = page.locator('#card-fresh a.cta');
  await link.focus();
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('Enter')]);
  await popup.waitForLoadState('domcontentloaded');
  assert.equal(new URL(popup.url()).hostname, 'example.test');
  assert.equal(await page.locator('#card-fresh .body').getAttribute('aria-expanded'), 'false');
});

test('연결 실패 시 저장본임을 알리고, 저장본이 없으면 다시 불러올 수 있다', { timeout: 30000 }, async (t) => {
  const data = { ok: true, last_checked_at: ago(1), coupons: [coupon('available')], news: [] };
  const first = await setup(data, { failCoupons: 1, cache: { ...data, last_checked_at: ago(72), coupons: [coupon('cached', ago(72))] } });
  t.after(() => first.context.close());
  await first.page.goto(`${site.base}/index.html`, { waitUntil: 'domcontentloaded' });
  await first.page.locator('#card-cached').waitFor();
  await first.page.getByText(/연결이 불안정해/).waitFor();
  assert.match(await first.page.locator('#card-cached').innerText(), /출처 재확인 필요/);

  const second = await setup(data, { failCoupons: 1 });
  t.after(() => second.context.close());
  await second.page.goto(`${site.base}/index.html`, { waitUntil: 'domcontentloaded' });
  await second.page.getByRole('button', { name: '다시 불러오기' }).click();
  await second.page.locator('#card-available').waitFor();
  // 날짜에 따라 수동 공지의 최신성 경고가 남을 수 있다. 통신 실패 상태는 해제돼야 한다.
  assert.doesNotMatch(await second.page.locator('#errNote').innerText(), /연결이 불안정|불러오지 못|저장된 혜택/);
  assert.doesNotMatch(await second.page.locator('#card-available').innerText(), /출처 재확인 필요/);
});

test('할인 숫자와 단위를 분리해도 금액·할인·적립 티켓 표시를 유지한다', { timeout: 30000 }, async (t) => {
  const cases = [
    ['percent', { discount_type: 'percent', coupon_price: null, discount_rate: 20 }, '20%', '%'],
    ['amount', { discount_type: 'amount', coupon_price: null, discount_rate: null, discount_value: 20000 }, '20000원', '원'],
    ['amount-small', { discount_type: 'amount', coupon_price: null, discount_rate: 20, discount_value: 3000 }, '3000원', '원'],
    ['amount-large', { discount_type: 'amount', coupon_price: null, discount_rate: 30, discount_value: 15000 }, '15000원', '원'],
    ['price', { discount_rate: null, coupon_price: 5500 }, '5500원', '원'],
    ['points', { discount_type: 'point_back', coupon_price: null, discount_rate: null, discount_value: 5000 }, '5000원', '원'],
    ['point-rate', { discount_type: 'point_back', coupon_price: null, discount_rate: 5, discount_value: 5 }, '5%', '%'],
    ['gift', { discount_type: 'free_item', menu: '아메리카노 1+1', coupon_price: null, discount_rate: null }, '1+1', ''],
  ];
  const { context, page } = await setup({ ok: true, last_checked_at: ago(1), coupons: cases.map(([id, fields]) => ({ ...coupon(id), ...fields })), news: [] });
  t.after(() => context.close());
  await page.goto(`${site.base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#card-gift').waitFor();
  for (const [id, , text, unit] of cases) {
    const label = page.locator(`#card-${id} .big`);
    assert.equal(await label.innerText(), text, id);
    assert.deepEqual(await label.locator('small').allTextContents(), unit ? [unit] : [], id);
    if (unit === '원') assert.equal(await label.evaluate((el) => getComputedStyle(el).fontSize), '18px', id);
    assert.equal(await label.evaluate((el) => el.scrollWidth <= el.clientWidth), true, `${id} 넘침 없음`);
  }
});

test('할인율 응답의 HTML은 티켓과 가격 줄에서 요소로 삽입되지 않는다', { timeout: 30000 }, async (t) => {
  const payload = '<img src=x data-injected="yes">';
  const coupons = ['percent', 'point_back'].map((type) => ({ ...coupon(type), discount_type: type, coupon_price: null, discount_rate: payload, discount_value: 5 }));
  const { context, page } = await setup({ ok: true, last_checked_at: ago(1), coupons, news: [] });
  t.after(() => context.close());
  await page.goto(`${site.base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#card-point_back').waitFor();
  assert.equal(await page.locator('[data-injected]').count(), 0);
  for (const type of ['percent', 'point_back']) {
    assert.equal(await page.locator(`#card-${type} .big`).innerText(), `${payload}%`);
    assert.ok((await page.locator(`#card-${type} .price`).innerText()).includes(payload));
  }
});

test('120개 혜택의 첫 표시와 검색이 모바일 화면에서 동작한다', { timeout: 30000 }, async (t) => {
  const data = { ok: true, last_checked_at: ago(1), coupons: Array.from({ length: 120 }, (_, i) => coupon(String(i))), news: [] };
  const { context, page } = await setup(data);
  t.after(() => context.close());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const started = performance.now();
  await page.goto(`${site.base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#card-119').waitFor();
  const elapsed = Math.round(performance.now() - started);
  assert.equal(await page.locator('#list .card').count(), 120);
  await page.getByRole('button', { name: '메뉴 검색' }).click();
  await page.getByRole('searchbox', { name: '메뉴·브랜드 검색' }).fill('혜택 113');
  assert.equal(await page.locator('#list .card').count(), 1);
  assert.deepEqual(errors, []);
  t.diagnostic(`모의 API, 외부 이미지·글꼴 제외: 120개 첫 표시 ${elapsed}ms`);
});


test('실제 상품 사진만 표시하고 API와 저장본의 배너·다른 상품 사진은 요청하지 않는다', { timeout: 30000 }, async (t) => {
  const known = { ...coupon('known'), brand: '맥도날드', menu: '불고기버거', image_url: 'https://example.test/banner.jpg' };
  const photoUrl = productImage(known);
  const unknown = { ...coupon('unknown'), menu: '전 메뉴', image_url: photoUrl };
  const n = { ...news('banner', ago(1)), discount_label: '15천원', related_ids: ['known'], image_url: 'https://example.test/news-banner.jpg' };
  const data = { ok: true, last_checked_at: ago(1), coupons: [known, unknown], news: [n] };
  const requests = [];
  const { context, page } = await setup(data, { cache: data, failCoupons: 1, photoUrl, requests });
  t.after(() => context.close());
  page.setDefaultTimeout(5000);
  await page.goto(`${site.base}/index.html`, { waitUntil: 'domcontentloaded' });
  const photo = page.locator('#card-known .stub img.ph');
  await photo.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('#card-known .ph')?.naturalWidth > 0, null, { timeout: 5000 });
  assert.equal(await photo.getAttribute('src'), photoUrl);
  assert.equal(await photo.evaluate((el) => getComputedStyle(el).objectFit), 'contain');
  assert.equal(await page.locator('#card-unknown .ph').count(), 0);
  assert.equal(await page.locator('#hotRail [data-hot="news:banner"] .ph').count(), 0);
  assert.equal(await page.locator('#hotRail [data-hot="news:banner"] .lbl').count(), 0, '사진 없는 공지도 아래 금액 표시를 생략한다');
  await page.locator('#hotRail [data-hot="news:banner"]').click();
  await page.locator('#newsSheet').waitFor();
  assert.equal(await page.locator('#newsBody .ph').count(), 0);
  assert.equal(await page.locator('#newsBody .lbl').innerText(), '15000원');
  assert.ok(!requests.some((url) => url.includes('banner.jpg')), '저장본의 행사 배너도 요청하지 않는다');
});

test('정렬·구독 때 그대로인 핫딜과 검색 입력을 보존하고 동작 줄이기를 따른다', { timeout: 30000 }, async (t) => {
  const data = { ok: true, last_checked_at: ago(1), coupons: [coupon('a'), coupon('b')], news: [news('one', ago(1)), news('two', ago(1))] };
  const { context, page } = await setup(data);
  t.after(() => context.close());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${site.base}/index.html`);
  await page.locator('#card-a').waitFor();
  await page.evaluate(() => { window.testHot = document.querySelector('#hotRail').firstElementChild; window.testGrid = document.querySelector('#grid').firstElementChild; });
  await page.locator('#sortSel').focus();
  await page.locator('#sortSel').selectOption('price');
  assert.equal(await page.evaluate(() => window.testHot === document.querySelector('#hotRail').firstElementChild), true, '핫딜 이미지 노드를 재생성하지 않는다');
  assert.equal(await page.evaluate(() => window.testGrid === document.querySelector('#grid').firstElementChild), true);
  assert.equal(await page.locator('#sortSel').evaluate((el) => document.activeElement === el), true);
  assert.equal(await page.locator('.toast').evaluate((el) => getComputedStyle(el).transitionDuration), '0s');
  await page.locator('[data-view="brands"]').click();
  await page.getByRole('searchbox', { name: '브랜드 찾기' }).fill('버거');
  await page.evaluate(() => { window.testInput = document.querySelector('#brandSearch'); });
  await page.getByRole('button', { name: '테스트버거 구독', exact: true }).click();
  assert.equal(await page.evaluate(() => window.testInput === document.querySelector('#brandSearch')), true);
  assert.equal(await page.locator('#brandSearch').inputValue(), '버거');
  assert.equal(await page.getByRole('button', { name: '테스트버거 구독 취소' }).evaluate((el) => document.activeElement === el), true);
});

test('가이드는 자바스크립트 없이 읽히고 작은 화면에서도 안내 페이지가 넘치지 않는다', { timeout: 30000 }, async (t) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 360, height: 800 } });
  t.after(() => context.close());
  await context.route('**/*', (route) => new URL(route.request().url()).origin === site.base ? route.continue() : route.abort());
  const page = await context.newPage();
  for (const path of ['guide.html', 'about.html', 'partners.html', 'privacy.html', 'terms.html']) {
    await page.goto(`${site.base}/${path}`);
    assert.equal(await page.locator('h1').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, path);
    assert.ok(await page.locator('a[href="guide.html"]').count());
  }
  await page.goto(`${site.base}/guide.html`);
  assert.equal(await page.locator('main h2').count(), 6);
  assert.ok((await page.locator('main').innerText()).includes('실제 행사가 아닙니다'));
});

test('펼친 카드는 같은 전체 목록으로 돌아와도 닫히고 키보드로 다시 열 수 있다', { timeout: 30000 }, async (t) => {
  const { context, page } = await setup({ ok: true, last_checked_at: ago(1), coupons: [coupon('a')], news: [] });
  t.after(() => context.close());
  await page.goto(`${site.base}/index.html`);
  const body = page.locator('#card-a .body');
  await body.click();
  assert.equal(await page.locator('#dt-a').isVisible(), true);
  await page.locator('[data-view="all"]').click();
  assert.equal(await page.locator('#dt-a').isHidden(), true);
  assert.equal(await body.getAttribute('aria-expanded'), 'false');
  await body.press('Enter');
  assert.equal(await page.locator('#dt-a').isVisible(), true);
});

test('핫딜 목록은 썸네일만 받고 상세를 열면 큰 공지 원본을 불러온다', { timeout: 30000 }, async (t) => {
  const now = '2026-10-29T03:00:00.000Z';
  const n = { id: 'weekend', brand: '피자헛', category: '피자', title: '피자헛 주말 1+1 핫딜', summary: '주말 한정 행사', discount_label: '1+1', checked_at: now, start_date: '2026-10-01', end_date: '2026-10-31', source_url: 'https://www.pizzahut.co.kr/cs/event/extra/hellopizzahut' };
  const thumb = noticeImage(n, '2026-10-29');
  const full = 'https://akamai.pizzahut.co.kr/event/hellopizzahut_2610_event_weekend_down_pc_3_1.png';
  const requests = [];
  const { context, page } = await setup({ ok: true, last_checked_at: now, coupons: [], news: [n] }, { photoUrls: [thumb, full], requests });
  t.after(() => context.close());
  await page.clock.setFixedTime(new Date(now));
  await page.goto(`${site.base}/index.html`);
  const card = page.locator('[data-hot="news:weekend"]');
  await card.waitFor();
  assert.equal(await card.locator('img.ph').getAttribute('src'), thumb);
  assert.equal(requests.includes(full), false, '목록에서 긴 포스터를 미리 내려받지 않는다');
  await card.click();
  assert.equal(await page.locator('#newsBody img.ph').getAttribute('src'), full);
  assert.equal(await page.locator('.notice-original').getAttribute('href'), full);
});

test('사진 없는 공지는 브랜드·요약·원문을 보여주며 원문 링크는 상세를 열지 않는다', { timeout: 30000 }, async t => {
  const now = '2026-10-29T03:00:00.000Z';
  const n = { id: 'source-preview', brand: 'KFC', title: '공식 앱 한정 행사 안내', category: '햄버거', summary: '매장에서 공식 앱으로 사용 조건을 확인하세요. <img src=x onerror=alert(1)>', discount_label: '30%', start_date: '2026-10-28', end_date: '2026-10-31', checked_at: now, source_url: 'https://example.test/event', image_url: 'https://example.test/unverified-banner.jpg' };
  const requests = [];
  const { context, page } = await setup({ ok: true, last_checked_at: now, coupons: [], news: [n] }, { requests });
  t.after(() => context.close());
  await page.clock.setFixedTime(new Date(now));
  await page.goto(`${site.base}/index.html`);
  const card = page.locator('[data-hot="news:source-preview"]');
  await card.waitFor();
  assert.match(await card.locator('.notice-preview').innerText(), /공지 요약.*매장에서.*10\/28.*10\/31/s);
  assert.match(await card.locator('.notice-brand-icon img').getAttribute('src'), /assets\/brands\/kfc-/);
  assert.equal(await card.locator('img.ph').count(), 0);
  assert.equal(await card.locator('.notice-excerpt img').count(), 0);
  const link = card.getByRole('link', { name: 'KFC 공식 공지 원문 보기 (새 탭)' });
  assert.equal(await link.getAttribute('href'), n.source_url);
  await link.focus();
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('Enter')]);
  await popup.waitForLoadState('domcontentloaded');
  assert.equal(popup.url(), n.source_url);
  assert.equal(await page.locator('#newsSheet').evaluate(el => el.open), false);
  await popup.close();
  await card.getByRole('button').click();
  assert.equal(await page.locator('.notice-source-link').getAttribute('href'), n.source_url);
  assert.equal(await page.locator('.news-hero .notice-preview').isVisible(), true);
  assert.equal(requests.some(url => url.includes('unverified-banner')), false);
  await page.locator('#newsSheet').getByRole('button', { name: '닫기', exact: true }).click();
  for (const width of [320, 390, 820]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await card.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: '/tmp/among-hot-notice-source.png' });
});

test('공식 이미지 로딩 실패 시 공지 요약으로 복원하고 깨진 이미지 링크를 숨긴다', { timeout: 30000 }, async t => {
  const now = '2026-10-29T03:00:00.000Z';
  const n = { id: 'failed-photo', brand: '피자헛', category: '피자', title: '피자헛 주말 1+1 핫딜', summary: '주말 한정 행사 조건을 공식 원문에서 확인하세요.', checked_at: now, start_date: '2026-10-01', end_date: '2026-10-31', source_url: 'https://www.pizzahut.co.kr/cs/event/extra/hellopizzahut' };
  const { context, page } = await setup({ ok: true, last_checked_at: now, coupons: [], news: [n] });
  t.after(() => context.close());
  await page.clock.setFixedTime(new Date(now));
  await page.goto(`${site.base}/index.html`);
  const card = page.locator('[data-hot="news:failed-photo"]');
  await card.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('[data-hot="news:failed-photo"]')?.classList.contains('noph'));
  assert.equal(await card.locator('.notice-preview').isVisible(), true);
  assert.equal(await card.locator('.notice-image-label').isVisible(), false);
  assert.equal(await card.locator('.hot-source').getAttribute('href'), n.source_url);
  await card.getByRole('button').click();
  await page.locator('.notice-image-error').waitFor();
  assert.equal(await page.locator('.notice-original').isHidden(), true);
  assert.equal(await page.locator('.news-hero .notice-preview').isVisible(), true);
  assert.equal(await page.locator('.notice-source-link').getAttribute('href'), n.source_url);
});

test('설빙 적립 공지가 사진·조건과 함께 노출되고 종료 다음 날에는 사라진다', { timeout: 30000 }, async (t) => {
  const now = '2026-10-29T12:00:00.000Z';
  const { context, page } = await setup({ ok: true, last_checked_at: now, coupons: [], news: [] });
  t.after(() => context.close());
  await page.clock.setFixedTime(new Date(now));
  await page.goto(`${site.base}/index.html`);
  const card = page.locator('[data-hot="news:n_sulbing_npay_20261028"]');
  await card.waitFor();
  assert.equal(await card.locator('.lbl').count(), 0);
  assert.match(await card.innerText(), /50% 포인트 적립/);
  assert.match(await card.locator('img.ph').getAttribute('src'), /^assets\/notices\/sulbing-npay-[a-f0-9]{12}\.jpg$/);
  await card.screenshot({ path: '/tmp/among-hot-notice-image.png' });
  await card.click();
  assert.match(await page.locator('.news-meta').innerText(), /10\/28.*11\/1/);
  assert.match(await page.locator('.news-sum').innerText(), /9900원.*50%.*포인트.*30000원.*카드/);
  assert.equal(await page.locator('[data-news-src]').getAttribute('href'), 'https://www.instagram.com/p/De8DZxPDXBr/');
  for (const width of [360, 390, 820]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.clock.setFixedTime(new Date('2026-11-02T03:00:00Z'));
  await page.reload();
  await page.locator('#list').waitFor({ state: 'attached' });
  assert.equal(await card.count(), 0);
});
