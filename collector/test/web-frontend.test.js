import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
// 모바일 화면에서 실제로 보이는 최신성 안내, 재시도, 키보드와 초기 표시를 검증한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import { productImage, brandPhoto } from '../src/product-images.js';
import { noticeImage } from '../src/notice-images.js';
import { officialBrandLogo } from '../../web/brand-logos.js';
import { serveDir } from './helpers.js';

let site, browser;
before(async () => {
  site = await serveDir(fileURLToPath(new URL('../../web/', import.meta.url)));
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

test('머리글 바둑판 칸은 가로 1.7 : 세로 1 직사각형 (밝은·어두운 화면 같은 배치)', () => {
  for (const file of ['banana-bricks.svg', 'banana-bricks-dark.svg']) {
    const svg = readFileSync(new URL(`../../web/${file}`, import.meta.url), 'utf8');
    assert.match(svg, /viewBox="0 0 204 80" width="306" height="120"/, '12×8 칸 타일, 넓은 화면 칸 25.5×15px (11/07 4분할)');
    const cells = [...svg.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)H\d+z/g)].map((m) => m.slice(1).map(Number)).filter(([, , w]) => w !== 204);
    assert.ok(cells.length >= 70 && cells.length <= 84, `${file}: 바탕색이 아닌 칸 ${cells.length}개`);
    assert.equal(new Set(cells.map(([x, y]) => `${x},${y}`)).size, cells.length, '칸이 겹치지 않음');
    for (const [x, y, w, h] of cells) { assert.equal(w / h, 1.7); assert.equal(x % 17, 0); assert.equal(y % 10, 0); }
  }
});

test('바나나 옐로우 로고와 머리글 바둑판이 화면 크기와 테마에 관계없이 표시된다', async (t) => {
  const { context, page } = await setup({ ok: true, coupons: [], news: [] });
  t.after(() => context.close());
  await page.goto(site.base + '/');
  const logo = page.getByRole('img', { name: 'AMONG', exact: true }).first();
  await logo.evaluate((img) => img.decode());
  const symbol = page.locator('.bar .brand-symbol');
  await symbol.evaluate((img) => img.decode());
  const cornerAlpha = await logo.evaluate((img) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 100, 28);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  });
  assert.equal(cornerAlpha, 0, '글자 로고 모서리가 투명하다');
  for (const [width, colorScheme] of [[360, 'light'], [390, 'dark'], [1280, 'light'], [1280, 'dark']]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme });
    const [left, right] = await Promise.all([symbol.boundingBox(), logo.boundingBox()]);
    assert.ok(left && right && left.x + left.width <= right.x);
    assert.ok(Math.abs((left.y + left.height / 2) - (right.y + right.height / 2)) < 1);
    assert.equal(await logo.evaluate((img) => getComputedStyle(img).filter), colorScheme === 'dark' ? 'invert(1)' : 'none');
    // 11/07 대표 요청: 바둑판 배너 = 머리글(로고·탭). 칸은 가로 1.7 : 세로 1 직사각형. 소개 상자는 바둑판 없이 옅은 바나나색
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    const header = page.locator('header.top');
    const dark = colorScheme === 'dark';
    const tile = dark ? 'banana-bricks-dark.svg' : 'banana-bricks.svg';
    const head = await header.evaluate((el) => {
      const css = getComputedStyle(el); const r = el.getBoundingClientRect();
      return { image: css.backgroundImage, border: css.borderImageSource, outset: css.borderImageOutset, left: r.left, right: r.right };
    });
    if (width >= 680) {
      assert.match(head.border, new RegExp(tile.replace('.', '\\.')), '넓은 화면: 화면 양끝까지 border-image 바깥 그림');
      assert.match(head.outset, /100vmax|\d{3,}px/);
    } else {
      assert.match(head.image, new RegExp(tile.replace('.', '\\.')));
    }
    const hero = page.locator('.hero');
    assert.doesNotMatch(await hero.evaluate((el) => getComputedStyle(el).backgroundImage), /banana-/, '소개 상자에는 바둑판 없음');
    const heroColor = await hero.evaluate((el) => getComputedStyle(el).color);
    assert.equal(heroColor, dark ? 'rgb(243, 242, 247)' : 'rgb(33, 28, 16)');
    assert.equal(await hero.locator('h1').evaluate((el) => getComputedStyle(el).color), heroColor);
    const selected = page.locator('.view-nav [aria-pressed="true"]');
    assert.equal(await selected.evaluate((el) => getComputedStyle(el).backgroundColor), dark ? 'rgb(255, 231, 101)' : 'rgb(33, 28, 16)');
    assert.equal(await selected.evaluate((el) => getComputedStyle(el).color), dark ? 'rgb(33, 28, 16)' : 'rgb(255, 231, 101)');
    const muted = await page.locator('.view-nav [aria-pressed="false"]').first().evaluate((el) => getComputedStyle(el).color);
    assert.equal(muted, dark ? 'rgb(155, 154, 169)' : 'rgb(90, 74, 18)', '노란 바둑판 위 탭 글자는 바나나 잉크색');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
});

test('브랜드 검색·구독·상세·새로고침·구독 취소가 이어지고 모바일·데스크톱에서 넘치지 않는다', { timeout: 30000 }, async (t) => {
  const data = { ok: true, last_checked_at: ago(1), coupons: [coupon('burger'), { ...coupon('coffee'), brand: '테스트카페', category: '카페' }], news: [] };
  const { context, page } = await setup(data);
  t.after(() => context.close());
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${site.base}/index.html`);
  await page.locator('#card-burger').waitFor();
  assert.equal(await page.locator('.bar .wordmark').getAttribute('alt'), 'AMONG');
  assert.equal(await page.locator('.bar .wordmark').evaluate((img) => img.complete && img.naturalWidth > 0), true);
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
  // 핫딜의 공식 상품 사진(관련 상품·대표 메뉴)은 별개 — 로고만 확인한다
  const productUrls = ['공차', '도미노피자', '파파이스'].map((b) => brandPhoto(b, '')?.url).filter(Boolean);
  // 로고는 파일로 저장하지 않고 확인한 공식 로고 주소만 부른다 (다른 아이콘 주소를 더듬지 않음)
  const logoUrls = ['공차', '도미노피자', '파파이스'].map((b) => officialBrandLogo(b).image);
  assert.ok(!requests.some((url) => /gong-cha|popeyes\.co\.kr|dominos\.co\.kr/.test(url) && !productUrls.includes(url) && !logoUrls.includes(url)), '확인된 로고 외의 브랜드 서버 주소는 요청하지 않는다');
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
  const cover = await hot.locator('img.ph').evaluate(img => {
    const frame = img.closest('.hot-visual').getBoundingClientRect();
    const box = img.getBoundingClientRect();
    return { fit: getComputedStyle(img).objectFit, padding: getComputedStyle(img).padding,
      fills: Math.abs(box.width - frame.width) < 1 && Math.abs(box.height - frame.height) < 1 };
  });
  assert.deepEqual(cover, { fit: 'cover', padding: '0px', fills: true });
  await hot.click();
  assert.equal(await page.locator('.notice-original').getAttribute('href'), photoUrl);
  assert.match(await page.locator('[data-news-src]').getAttribute('href'), /detail\/1130$/);
  assert.equal(await page.locator('#newsBody img.ph').evaluate((el) => getComputedStyle(el).objectFit), 'contain');
});

test('일부 출처가 오래됐으면 위쪽 경고만 보이고(카드 문구 없음) 최신 핫딜만 추천한다', { timeout: 30000 }, async (t) => {
  const data = { ok: true, last_checked_at: ago(1), coupons: [coupon('fresh'), coupon('old', ago(72))],
    news: [news('fresh', ago(1)), news('old', ago(72))] };
  const { context, page } = await setup(data);
  t.after(() => context.close());
  await page.goto(`${site.base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#list .card').first().waitFor();
  assert.match(await page.locator('#errNote').innerText(), /일부 혜택/);
  // 카드에는 상태 문구를 붙이지 않는다 (확인 시각은 펼친 상세의 출처 줄)
  for (const id of ['#card-old', '#card-fresh']) assert.doesNotMatch(await page.locator(id).innerText(), /재확인 필요|지난 방문 후 새로|새로 생김/);
  assert.match(await page.locator('#hotRail').innerText(), /테스트 행사 fresh/);
  assert.doesNotMatch(await page.locator('#hotRail').innerText(), /테스트 행사 old/);

  // 링크의 Enter는 바깥 카드의 키보드 핸들러에 가로채이지 않는다.
  const link = page.locator('#card-fresh a.cta');
  await link.focus();
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.keyboard.press('Enter')]);
  await popup.waitForLoadState('domcontentloaded');
  assert.equal(new URL(popup.url()).hostname, 'example.test');
  assert.equal(await page.locator('#card-fresh .more').getAttribute('aria-expanded'), 'false');
});

test('연결 실패 시 저장본임을 알리고, 저장본이 없으면 다시 불러올 수 있다', { timeout: 30000 }, async (t) => {
  const data = { ok: true, last_checked_at: ago(1), coupons: [coupon('available')], news: [] };
  const first = await setup(data, { failCoupons: 1, cache: { ...data, last_checked_at: ago(72), coupons: [coupon('cached', ago(72))] } });
  t.after(() => first.context.close());
  await first.page.goto(`${site.base}/index.html`, { waitUntil: 'domcontentloaded' });
  await first.page.locator('#card-cached').waitFor();
  await first.page.getByText(/연결이 불안정해/).waitFor();
  assert.doesNotMatch(await first.page.locator('#card-cached').innerText(), /재확인 필요/);

  const second = await setup(data, { failCoupons: 1 });
  t.after(() => second.context.close());
  await second.page.goto(`${site.base}/index.html`, { waitUntil: 'domcontentloaded' });
  await second.page.getByRole('button', { name: '다시 시도' }).click();
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


test('쿠폰은 확인된 상품 사진만, 공지는 수집기가 고른 공식 이미지를 쓰고 못 불러오면 연결 쿠폰의 상품 사진으로 바꾼다', { timeout: 30000 }, async (t) => {
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
  // 공지: 공식 이미지(news-banner)를 먼저 시도 → 이미지가 아니라 실패 → 연결된 쿠폰의 상품 사진
  const hot = page.locator('#hotRail [data-hot="news:banner"]');
  await page.waitForFunction((src) => document.querySelector('[data-hot="news:banner"] img.ph')?.getAttribute('src') === src && document.querySelector('[data-hot="news:banner"] img.ph').naturalWidth > 0, photoUrl);
  assert.equal(await hot.locator('.notice-image-label').innerText(), '관련 상품 이미지');
  assert.equal(await hot.evaluate((el) => el.classList.contains('has-ph')), true);
  assert.equal(await hot.locator('.lbl').count(), 0, '공지 카드는 아래 금액 표시를 생략한다');
  await hot.locator('.hot-open').click();
  await page.locator('#newsSheet').waitFor();
  await page.waitForFunction((src) => document.querySelector('#newsBody img.ph')?.getAttribute('src') === src, photoUrl);
  assert.equal(await page.locator('#newsBody .notice-original').isHidden(), true, '상품 사진은 공지 원본 링크로 안내하지 않는다');
  assert.match(await page.locator('#newsBody .news-note').innerText(), /공식 메뉴의 상품 이미지/);
  assert.ok(requests.includes('https://example.test/news-banner.jpg'), '공지 이미지는 수집기가 고른 공식 주소를 먼저 쓴다');
  assert.ok(!requests.some((url) => url === 'https://example.test/banner.jpg'), '쿠폰의 API 배너는 요청하지 않는다');
});

test('명일방주 제휴 메뉴와 쉐이크쉑 전 메뉴 쿠폰에 공식 포스터·버거 모음을 보여준다', { timeout: 30000 }, async t => {
  const now = '2026-10-31T03:00:00.000Z';
  const collab = { ...coupon('collab', now), brand: '반올림피자', menu: '제휴 메뉴', item_type: '세트', category: '피자',
    discount_type: 'free_item', first_seen: now, end_date: '2026-11-08',
    source_url: 'https://order.banolimpizza.com/event/detail/163814c2-cc1e-4051-b35c-91ba2906ea36?eventStatus=ongoing' };
  const shack = { ...coupon('shack', now), brand: '쉐이크쉑', menu: '전 메뉴', item_type: '기타', discount_type: 'percent', discount_rate: 30, first_seen: now };
  // 사진은 파일로 저장하지 않고 공식 주소를 그대로 불러온다
  const photoUrls = ['https://cdn.banolimpizza.com/event/b6cb07152f824c0a91c40039dbb11a29.png', 'https://cdn.banolimpizza.com/event/5fc80c5e10204080979d1782a56f8f5e.jpg',
    'https://www.sangmidang.co.kr/files/brand/eng/2024/06/aef71c88-32b1-44a3-b0f5-55351f3d31a5.webp'];
  const { context, page } = await setup({ ok: true, coupons: [collab, shack], news: [], last_checked_at: now }, { photoUrls });
  t.after(() => context.close());
  await page.clock.setFixedTime(new Date(now));
  await page.goto(`${site.base}/index.html`);
  for (const [id, imageName, label] of [['collab', 'cdn.banolimpizza.com/event/', '공식 행사'], ['shack', 'aef71c88-32b1-44a3-b0f5-55351f3d31a5', '대표 메뉴']]) {
    const card = page.locator(`#card-${id}`);
    await card.scrollIntoViewIfNeeded();
    await page.waitForFunction(id => document.querySelector(`#card-${id} .stub img.ph`)?.naturalWidth > 0, id);
    assert.ok((await card.locator('.stub img.ph').getAttribute('src')).includes(imageName));
    assert.equal(await card.locator('.coupon-image-label').innerText(), label);
    await card.locator('.body').click();
    const art = card.locator('.coupon-artwork');
    await art.scrollIntoViewIfNeeded();
    assert.ok((await art.locator('img').getAttribute('src')).includes(imageName));
    assert.match(await art.innerText(), /공식 출처/);
    assert.equal(await art.locator('img').evaluate(el => getComputedStyle(el).objectFit), 'contain');
    await card.locator('.body').click();
    await card.screenshot({ path: `/tmp/among-coupon-${id}.png` });
    const hot = page.locator(`[data-hot="coupon:${id}"]`);
    assert.ok((await hot.locator('img.ph').getAttribute('src')).includes(imageName));
    assert.match(await hot.locator('.notice-image-label').innerText(), new RegExp(label));
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
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
  const more = page.locator('#card-a .more');
  // 카드의 빈 곳(메뉴 이름)을 눌러도 열린다
  await page.locator('#card-a .menu').click();
  assert.equal(await page.locator('#dt-a').isVisible(), true);
  assert.equal(await more.getAttribute('aria-expanded'), 'true');
  assert.equal(await more.innerText(), '상세 닫기');
  await page.locator('[data-view="all"]').click();
  assert.equal(await page.locator('#dt-a').isHidden(), true);
  assert.equal(await more.getAttribute('aria-expanded'), 'false');
  // 키보드: 카드 자체가 아니라 실제 버튼('상세 보기')으로 연다 (안쪽 링크·버튼과 겹치지 않게)
  assert.equal(await body.getAttribute('role'), null);
  await more.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#dt-a').isVisible(), true);
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#dt-a').isHidden(), true);
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

test('공지 이미지가 없고 상품 사진도 못 불러오면 공식 브랜드 로고만 보여주며 원문 링크는 상세를 열지 않는다', { timeout: 30000 }, async t => {
  const now = '2026-10-29T03:00:00.000Z';
  const n = { id: 'source-preview', brand: 'KFC', title: '공식 앱 한정 행사 안내', category: '햄버거', summary: '매장에서 공식 앱으로 사용 조건을 확인하세요. <img src=x onerror=alert(1)>', discount_label: '30%', start_date: '2026-10-28', end_date: '2026-10-31', checked_at: now, source_url: 'https://example.test/event' };
  const requests = [];
  const { context, page } = await setup({ ok: true, last_checked_at: now, coupons: [], news: [n] }, { requests, photoUrls: ['https://www.kfckorea.com/assets/favicon.ico?d230bc62da40125151da1a5391159397'] });
  t.after(() => context.close());
  await page.clock.setFixedTime(new Date(now));
  await page.goto(`${site.base}/index.html`);
  const card = page.locator('[data-hot="news:source-preview"]');
  await card.waitFor();
  // KFC 대표 메뉴 사진을 먼저 시도 (시험 환경에서는 외부 사진이 막혀 실패) → 로고
  assert.ok(requests.some((url) => url.startsWith('https://kfcapi.inicis.com/')));
  await page.waitForFunction(() => document.querySelector('[data-hot="news:source-preview"]')?.classList.contains('noph'));
  assert.equal((await card.locator('.notice-preview').innerText()).trim(), '브랜드 로고');
  assert.doesNotMatch(await card.locator('.hot-visual').innerText(), /매장에서|img src|공지 요약/);
  assert.match(await card.locator('.notice-brand-logo').getAttribute('src'), /^https:\/\/www\.kfckorea\.com\/assets\/favicon\.ico/);
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
  await page.waitForFunction(() => document.querySelector('.news-hero')?.classList.contains('noph'));
  assert.equal(await page.locator('.news-hero .notice-preview').isVisible(), true);
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

test('공식 이미지와 상품 사진을 모두 못 불러오면 브랜드 로고로 복원하고 깨진 이미지 링크를 숨긴다', { timeout: 30000 }, async t => {
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

test('공식 공지 이미지를 못 불러오면 같은 브랜드의 대표 메뉴 사진으로 바꾸고 표시 문구도 바꾼다', { timeout: 30000 }, async t => {
  const now = '2026-10-29T03:00:00.000Z';
  const n = { id: 'fallback', brand: '피자헛', category: '피자', title: '피자헛 주말 1+1 핫딜', summary: '주말 한정 행사', checked_at: now, start_date: '2026-10-01', end_date: '2026-10-31', source_url: 'https://www.pizzahut.co.kr/cs/event/extra/hellopizzahut' };
  const product = brandPhoto('피자헛', `${n.title} ${n.summary}`).url;
  const { context, page } = await setup({ ok: true, last_checked_at: now, coupons: [], news: [n] }, { photoUrls: [product] });
  t.after(() => context.close());
  await page.clock.setFixedTime(new Date(now));
  await page.goto(`${site.base}/index.html`);
  const card = page.locator('[data-hot="news:fallback"]');
  await page.waitForFunction((src) => document.querySelector('[data-hot="news:fallback"] img.ph')?.getAttribute('src') === src && document.querySelector('[data-hot="news:fallback"] img.ph').naturalWidth > 0, product);
  assert.equal(await card.locator('.notice-image-label').innerText(), '대표 메뉴 이미지');
  assert.equal(await card.locator('.notice-preview').isVisible(), false);
  assert.equal(await card.evaluate((el) => el.classList.contains('noph')), false);
});

test('행사 이미지가 없는 쿠폰 핫딜은 일러스트 대신 같은 브랜드의 관련 상품 사진, 그것도 없으면 로고', { timeout: 30000 }, async t => {
  const now = new Date().toISOString();
  const supreme = { ...coupon('supreme', now), brand: '피자헛', category: '피자', menu: '수퍼슈프림 L', discount_type: 'percent', coupon_price: null, regular_price: null, discount_rate: 40, end_date: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) };
  const plain = { ...coupon('plain', now), discount_type: 'free_item', coupon_price: null, regular_price: null, discount_rate: null, menu: '테스트 버거 1+1', end_date: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) };
  const product = brandPhoto('피자헛', supreme.menu).url;
  const { context, page } = await setup({ ok: true, last_checked_at: now, coupons: [supreme, plain], news: [] }, { photoUrls: [product] });
  t.after(() => context.close());
  await page.goto(`${site.base}/index.html`);
  const hot = page.locator('[data-hot="coupon:supreme"]');
  await page.waitForFunction((src) => document.querySelector('[data-hot="coupon:supreme"] img.ph')?.getAttribute('src') === src, product);
  assert.equal(await hot.locator('.notice-image-label').innerText(), '관련 상품 이미지');
  assert.equal(await page.locator('#hotRail .art').count(), 0, '핫딜에 우리 일러스트를 쓰지 않는다');
  const other = page.locator('[data-hot="coupon:plain"]');
  await other.waitFor();
  assert.equal(await other.locator('img.ph').count(), 0);
  assert.equal(await other.evaluate((el) => el.classList.contains('noph')), true);
  assert.equal(await other.locator('.notice-preview').isVisible(), true);
});

test('설빙 적립 공지가 사진·조건과 함께 노출되고 종료 다음 날에는 사라진다', { timeout: 30000 }, async (t) => {
  const now = '2026-10-29T12:00:00.000Z';
  const { context, page } = await setup({ ok: true, last_checked_at: now, coupons: [], news: [] }, { photoUrls: ['https://sulbing.com/new/data/product/regular_01.png'] });
  t.after(() => context.close());
  await page.clock.setFixedTime(new Date(now));
  await page.goto(`${site.base}/index.html`);
  const card = page.locator('[data-hot="news:n_sulbing_npay_20261028"]');
  await card.waitFor();
  assert.equal(await card.locator('.lbl').count(), 0);
  assert.match(await card.innerText(), /50% 포인트 적립/);
  // 포스터 파일은 저장하지 않으므로 설빙 공식 메뉴 사진으로 대신하고, 그렇다고 표시한다
  assert.equal(await card.locator('img.ph').getAttribute('src'), 'https://sulbing.com/new/data/product/regular_01.png');
  assert.match(await card.locator('.notice-image-label').innerText(), /대표 메뉴/);
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

test('검색하면 소개·핫딜을 접고 결과를 바로 보여 주며, 결과가 없으면 브랜드를 추천하고 Esc로 닫는다', { timeout: 30000 }, async (t) => {
  const coupons = [{ ...coupon('burger'), brand: '테스트버거', menu: '불고기 버거' }, { ...coupon('coffee'), brand: '테스트카페', category: '카페', menu: '아메리카노' }];
  const { context, page } = await setup({ ok: true, last_checked_at: ago(1), coupons, news: [news('event', ago(1))] });
  t.after(() => context.close());
  await page.goto(`${site.base}/index.html`);
  await page.locator('#card-burger').waitFor();
  await page.click('#searchBtn');
  await page.fill('#q', '아메리카노');
  assert.equal(await page.locator('#hot').isVisible(), false, '검색 중에는 핫딜을 접는다');
  assert.equal(await page.locator('#grid').isVisible(), false);
  assert.equal(await page.locator('#listTitle').innerText(), '‘아메리카노’ 검색 결과');
  const top = await page.locator('#card-coffee').evaluate((el) => el.getBoundingClientRect().top);
  assert.ok(top < 844, '첫 결과가 첫 화면 안에 보인다');
  await page.fill('#q', '없는 메뉴');
  assert.match(await page.locator('#list .empty').innerText(), /맞는 혜택이 없어요/);
  await page.locator('[data-suggest="테스트버거"]').click();
  assert.equal(await page.inputValue('#q'), '테스트버거');
  assert.equal(await page.locator('#card-burger').isVisible(), true);
  await page.locator('#q').press('Escape');
  assert.equal(await page.locator('#q').isVisible(), false);
  assert.equal(await page.locator('#hot').isVisible(), true, '검색을 닫으면 핫딜이 돌아온다');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'searchBtn');
});

test('내 조건 버튼은 고른 조건을 보여 주고, 시트의 닫기(✕)는 저장하지 않는다', { timeout: 30000 }, async (t) => {
  const { context, page } = await setup({ ok: true, last_checked_at: ago(1), coupons: [{ ...coupon('kt'), programs: ['KT'], audience: '멤버십' }], news: [] });
  t.after(() => context.close());
  await page.goto(`${site.base}/index.html`);
  await page.locator('#card-kt').waitFor();
  assert.equal(await page.locator('#meLabel').innerText(), '내 조건');
  await page.click('#meBtn');
  await page.click('#meSheet [data-v="KT"]');
  await page.locator('#meSheet').getByRole('button', { name: '닫기' }).click();
  assert.equal(await page.locator('#meSheet').evaluate((d) => d.open), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('among_profile')), null, '닫기는 저장하지 않음');
  await page.click('#meBtn');
  await page.click('#meSheet [data-v="KT"]');
  await page.click('#meSheet .btn.primary');
  assert.equal(await page.locator('#meLabel').innerText(), 'KT');
  assert.match(await page.locator('#card-kt .conds').innerText(), /내 KT 혜택/);
  // 목록을 내려도 정렬·필터 줄은 머리글 바로 아래에 남는다
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight / 2));
  const gap = await page.evaluate(() => document.querySelector('.tools').getBoundingClientRect().top - document.querySelector('header.top').getBoundingClientRect().bottom);
  assert.ok(Math.abs(gap) < 2 || (await page.evaluate(() => document.body.scrollHeight <= innerHeight * 1.6)), `정렬 줄 위치 ${gap}`);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `폭 ${width}`);
  }
});
