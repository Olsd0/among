// 목록 위 예산 버튼: 실제 필터(state.filters.maxPrice)와 상세 필터 시트가 같은 값을 쓰는지, 다른 조건을 건드리지 않는지,
// 작은 화면에서 줄 안에서만 넘기는지, 버튼을 눌러도 API를 다시 부르지 않는지 확인한다.
// 아래 혜택·브랜드는 모두 가상 데이터이며 실제 사이트에 게시되지 않는다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serveDir } from './helpers.js';

let site, browser;
before(async () => {
  site = await serveDir(new URL('../../web/', import.meta.url).pathname);
  browser = await chromium.launch();
});
after(async () => { if (browser) await browser.close(); if (site) await site.close(); });

const now = new Date(Date.now() - 3600e3).toISOString();
const plus = (d) => new Date(Date.now() + d * 864e5 + 9 * 3600e3).toISOString().slice(0, 10);
const c = (id, fields) => ({
  id, brand: '가상버거', category: '햄버거', menu: `가상 메뉴 ${id}`, item_type: '단품', discount_type: 'price', regular_price: null, coupon_price: null,
  discount_rate: null, discount_value: null, channels: ['매장', '픽업'], audience: '전체', programs: [], app_only: false, start_date: null, end_date: plus(20),
  checked_at: now, first_seen: now, source_url: 'https://example.test/event', official_link: 'https://example.test/event', ...fields,
});
const COUPONS = [
  c('p4900', { menu: '가상 불고기 버거 세트', item_type: '세트', regular_price: 7000, coupon_price: 4900, discount_rate: 30 }),
  c('p5000', { regular_price: 6000, coupon_price: 5000, discount_rate: 17, end_date: plus(2) }),
  c('p5001', { coupon_price: 5001 }),
  c('p9800', { brand: '가상카페', category: '카페', menu: '가상 라떼 2잔 세트', item_type: '세트', coupon_price: 9800, channels: ['픽업'], audience: '신규회원', app_only: true }),
  c('p8000', { brand: '가상카페', category: '카페', menu: '가상 케이크 세트', item_type: '세트', coupon_price: 8000 }),
  c('p15000', { brand: '가상피자', category: '피자', menu: '가상 피자 미디엄', coupon_price: 15000 }),
  c('p19000', { brand: '가상피자', category: '피자', menu: '가상 피자 라지', coupon_price: 19000 }),
  c('amount', { discount_type: 'amount', discount_value: 3000, min_order: 15000 }),
  c('percent', { discount_type: 'percent', discount_value: 30, discount_rate: 30, programs: ['KT'], audience: '멤버십' }),
  c('points', { discount_type: 'point_back', discount_value: 50, discount_rate: 50, min_order: 10000, programs: ['네이버페이'] }),
  c('bogo', { brand: '가상카페', category: '카페', menu: '가상 아메리카노 1+1', discount_type: 'free_item', regular_price: 4500, coupon_price: 4500 }),
  c('bad-price', { coupon_price: '' }),
];
const NEWS = [{ id: 'hot1', brand: '가상피자', category: '피자', title: '가상 피자 주말 할인 공지', summary: '가상 공지', discount_label: '40%', programs: [],
  checked_at: now, first_seen: now, start_date: plus(-1), end_date: plus(10), source_url: 'https://example.test/notice', image_url: '' }];

async function setup(options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block', colorScheme: options.colorScheme || 'light' });
  const page = await context.newPage();
  const calls = { coupons: 0, other: 0, events: 0 };
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === site.base) return route.continue();
    if (url.hostname === 'script.google.com') {
      if (req.method() === 'POST') {
        // 익명 이용 기록(event)은 기존 동작. 공식 출처 수집 요청(refresh)은 따로 센다.
        const action = (() => { try { return JSON.parse(req.postData() || '{}').action; } catch { return ''; } })();
        if (action === 'refresh') calls.refresh = (calls.refresh || 0) + 1; else calls.events++;
        return route.fulfill({ status: 200, json: { ok: true }, headers: { 'access-control-allow-origin': '*' } });
      }
      if (url.searchParams.get('action') === 'coupons') {
        calls.coupons++;
        if (options.fail) return route.abort('failed');
        return route.fulfill({ status: 200, json: { ok: true, last_checked_at: now, coupons: options.coupons || COUPONS, news: NEWS }, headers: { 'access-control-allow-origin': '*' } });
      }
      calls.other++;
      return route.fulfill({ status: 200, json: { ok: true, state: 'idle', last_checked_at: now }, headers: { 'access-control-allow-origin': '*' } });
    }
    if (url.hostname === 'example.test') return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>가상 공식 페이지</title>' });
    return route.abort();
  });
  if (options.prefs) await page.addInitScript((p) => localStorage.setItem('among_prefs', JSON.stringify(p)), options.prefs);
  await page.goto(`${site.base}/index.html`);
  await page.locator('#list .card').first().waitFor();
  return { context, page, calls };
}
const ids = (page) => page.locator('#list .card').evaluateAll((els) => els.map((e) => e.dataset.id));
const pressed = (page) => page.locator('#budgetOpts [aria-pressed="true"]').innerText();
const sheetPressed = (page) => page.locator('#filterSheet [data-key="maxPrice"] [aria-pressed="true"]').innerText();

test('예산 버튼: 하나만 선택되고 누르면 바로 적용되며, 가격이 확인된 혜택만 남는다', { timeout: 30000 }, async (t) => {
  const { context, page, calls } = await setup();
  t.after(() => context.close());
  assert.equal(await pressed(page), '제한 없음', '처음에는 제한 없음');
  assert.equal(await page.locator('#budgetNote').isHidden(), true);
  const all = await ids(page);
  assert.equal(all.length, COUPONS.length, '제한 없음: 가격 없는 혜택도 그대로');
  const before = { ...calls };

  await page.getByRole('button', { name: '5000원 이하', exact: true }).click();
  assert.deepEqual((await ids(page)).sort(), ['bogo', 'p4900', 'p5000']);
  assert.equal(await page.locator('#budgetOpts [aria-pressed="true"]').count(), 1);
  assert.equal(await pressed(page), '5000원 이하');
  assert.equal(await page.locator('#budgetNote').innerText(), '가격이 확인된 혜택만 보여드려요.');
  assert.match(await page.locator('#summary').innerText(), /^5000원 이하 · 3개 · 브랜드 2곳/);
  assert.equal(await page.locator('#filterBtn').getAttribute('data-on'), 'true');

  await page.getByRole('button', { name: '8000원 이하', exact: true }).click();
  assert.deepEqual((await ids(page)).sort(), ['bogo', 'p4900', 'p5000', 'p5001', 'p8000']);
  await page.getByRole('button', { name: '10000원 이하', exact: true }).click();
  assert.deepEqual((await ids(page)).sort(), ['bogo', 'p4900', 'p5000', 'p5001', 'p8000', 'p9800']);
  await page.getByRole('button', { name: '15000원 이하', exact: true }).click();
  assert.deepEqual((await ids(page)).sort(), ['bogo', 'p15000', 'p4900', 'p5000', 'p5001', 'p8000', 'p9800'], '15000원 경계값 포함, 19000원 제외');
  // 20000원 선택지는 없다
  assert.deepEqual(await page.locator('#budgetOpts button').allInnerTexts(), ['제한 없음', '5000원 이하', '8000원 이하', '10000원 이하', '15000원 이하']);
  assert.deepEqual(await page.locator('#filterSheet [data-key="maxPrice"] button').allTextContents(), ['제한 없음', '5000원 이하', '8000원 이하', '10000원 이하', '15000원 이하']);
  // 개수 표시와 실제 카드 수가 같다
  assert.match(await page.locator('#summary').innerText(), new RegExp(`· ${(await ids(page)).length}개 ·`));

  await page.getByRole('button', { name: '제한 없음', exact: true }).click();
  assert.equal((await ids(page)).length, COUPONS.length);
  assert.equal(await page.locator('#budgetNote').isHidden(), true);
  assert.equal(await page.locator('#filterBtn').getAttribute('data-on'), 'false');
  // 예산은 이미 받은 혜택으로만 다시 그린다 (혜택 조회·상태 조회·수집 요청 없음. 익명 이용 기록만 기존처럼)
  assert.equal(calls.coupons, before.coupons);
  assert.equal(calls.other, before.other);
  assert.equal(calls.refresh, undefined);
  // 선택 상태는 색만이 아니라 테두리·✓ 표시로도 구분된다
  await page.getByRole('button', { name: '5000원 이하', exact: true }).click();
  const look = await page.locator('#budgetOpts [aria-pressed="true"]').evaluate((el) => ({ mark: getComputedStyle(el, '::before').content, border: getComputedStyle(el).borderColor }));
  assert.equal(look.mark, '"✓"');
  assert.notEqual(look.border, await page.locator('#budgetOpts [aria-pressed="false"]').first().evaluate((el) => getComputedStyle(el).borderColor));
});

test('상단 예산과 상세 필터는 같은 상태: 적용하면 함께 바뀌고 닫기·취소·바깥 누르기는 바꾸지 않는다', { timeout: 30000 }, async (t) => {
  const { context, page } = await setup();
  t.after(() => context.close());
  await page.getByRole('button', { name: '5000원 이하', exact: true }).click();
  await page.click('#filterBtn');
  assert.equal(await sheetPressed(page), '5000원 이하');
  // 시트에서 10000원을 고르고 적용 → 상단·목록 함께
  await page.click('#filterSheet [data-key="maxPrice"] [data-v="10000"]');
  assert.equal(await pressed(page), '5000원 이하', '적용 전에는 실제 필터가 그대로');
  await page.click('#filterSheet .btn.primary');
  assert.equal(await pressed(page), '10000원 이하');
  assert.equal((await ids(page)).length, 6);
  // 닫기(✕), Esc, 바깥 누르기는 고르던 값을 버린다
  for (const close of ['x', 'esc', 'backdrop']) {
    await page.click('#filterBtn');
    await page.click('#filterSheet [data-key="maxPrice"] [data-v="15000"]');
    await page.click('#filterSheet [data-key="itemType"] [data-v="세트"]');
    if (close === 'x') await page.locator('#filterSheet').getByRole('button', { name: '닫기' }).click();
    if (close === 'esc') await page.keyboard.press('Escape');
    if (close === 'backdrop') await page.mouse.click(5, 5);
    assert.equal(await page.locator('#filterSheet').evaluate((d) => d.open), false, close);
    assert.equal(await pressed(page), '10000원 이하', close);
    assert.equal((await ids(page)).length, 6, close);
    await page.click('#filterBtn');
    assert.equal(await sheetPressed(page), '10000원 이하', `${close}: 다시 열면 실제 값`);
    await page.keyboard.press('Escape');
  }
  // 시트를 닫으면 포커스는 필터 버튼으로 돌아온다
  assert.equal(await page.evaluate(() => document.activeElement.id), 'filterBtn');
});

test('예산을 바꾸거나 예산만 해제해도 카테고리·검색어·정렬·다른 필터는 그대로다', { timeout: 30000 }, async (t) => {
  const { context, page } = await setup();
  t.after(() => context.close());
  await page.selectOption('#sortSel', 'deadline');
  await page.click('#grid [data-cat="햄버거"]');
  await page.click('#filterBtn');
  await page.click('#filterSheet [data-key="itemType"] [data-v="세트"]');
  await page.click('#filterSheet .btn.primary');
  assert.deepEqual(await ids(page), ['p4900']);
  await page.getByRole('button', { name: '5000원 이하', exact: true }).click();
  assert.equal(await page.inputValue('#sortSel'), 'deadline', '예산을 골라도 정렬은 바뀌지 않는다');
  assert.match(await page.locator('#summary').innerText(), /^5000원 이하 · 세트 · 1개/);
  assert.equal(await page.locator('#listTitle').innerText(), '햄버거 혜택');

  // 결과 없음 → '예산만 해제'는 maxPrice만 지운다
  await page.click('#searchBtn');
  await page.fill('#q', '불고기 버거');
  await page.getByRole('button', { name: '10000원 이하', exact: true }).click();
  await page.fill('#q', '라떼');
  await page.getByText('선택한 조건에 맞는 혜택이 없어요.').waitFor();
  await page.getByRole('button', { name: '예산만 해제' }).click();
  assert.equal(await pressed(page), '제한 없음');
  assert.equal(await page.inputValue('#q'), '라떼');
  assert.equal(await page.inputValue('#sortSel'), 'deadline');
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('among_prefs')));
  assert.equal(prefs.category, '햄버거');
  assert.equal(prefs.filters.itemType, '세트');
  assert.equal(prefs.filters.maxPrice, '');
  // 예산이 없으면 '예산만 해제' 버튼은 보이지 않는다 (다른 조건 때문에 여전히 결과가 없을 수 있음)
  assert.equal(await page.getByRole('button', { name: '예산만 해제' }).count(), 0);
  assert.match(await page.locator('#list').innerText(), /라떼.*없어요/);
});

test('저장된 예산은 다시 열어도 유지되고, 없어진 값(예전 20000원)은 제한 없음으로 시작한다', { timeout: 30000 }, async (t) => {
  const first = await setup({ prefs: { v: 5, category: '전체', kind: '', sort: 'best', filters: { itemType: '', channel: '', everyoneOnly: false, maxPrice: '10000' }, quick: {} } });
  t.after(() => first.context.close());
  assert.equal(await pressed(first.page), '10000원 이하');
  assert.equal((await ids(first.page)).length, 6);
  const second = await setup({ prefs: { v: 5, category: '전체', kind: '', sort: 'best', filters: { itemType: '', channel: '', everyoneOnly: false, maxPrice: '20000' }, quick: {} } });
  t.after(() => second.context.close());
  assert.equal(await pressed(second.page), '제한 없음');
  assert.equal((await ids(second.page)).length, COUPONS.length);
});

test('핫딜 공지는 예산과 상관없이 그대로이고, 카드에는 가격·핵심 조건·공식 페이지 안내가 보인다', { timeout: 30000 }, async (t) => {
  const { context, page } = await setup();
  t.after(() => context.close());
  const hot = await page.locator('#hotRail [data-hot]').count();
  assert.ok(hot >= 1);
  await page.getByRole('button', { name: '5000원 이하', exact: true }).click();
  assert.equal(await page.locator('#hotRail [data-hot]').count(), hot, '예산은 혜택 목록만 좁힌다');
  // 공지 카드: 이미지·제목·확인된 기간만 (할인 숫자 표시 없음)
  const notice = page.locator('[data-hot="news:hot1"]');
  assert.equal(await notice.locator('.lbl').count(), 0);
  assert.match(await notice.locator('.period').innerText(), /까지$/);
  await page.getByRole('button', { name: '제한 없음', exact: true }).click();

  const card = page.locator('#card-p4900');
  assert.equal(await card.locator('.price b').innerText(), '4900원', '금액은 쉼표·축약 없이');
  assert.equal(await card.locator('.price s').innerText(), '7000원');
  assert.match(await card.locator('.cta').innerText(), /^공식 페이지에서 확인/);
  assert.equal(await card.locator('.cta').getAttribute('target'), '_blank');
  // 앱 신규가입·픽업 전용 같은 조건은 접힌 카드에서도 보인다
  assert.match(await page.locator('#card-p9800 .conds').innerText(), /앱 신규가입 혜택\s+앱 전용\s+픽업 전용/);
  assert.match(await page.locator('#card-amount .conds').innerText(), /15000원 이상 주문/);
  // 가격이 없는 혜택은 혜택 종류를 분명하게: 할인과 적립을 섞지 않는다
  assert.equal(await page.locator('#card-amount .price').innerText(), '3000원 할인');
  assert.equal(await page.locator('#card-percent .price').innerText(), '주문 금액 30% 할인');
  assert.equal(await page.locator('#card-points .price').innerText(), '결제 후 50% 적립');
  assert.match(await page.locator('#card-bogo .price').innerText(), /^4500원\s*결제 시 하나 더 \(1\+1\)$/, '1+1은 구성 가격 그대로(개당 환산 없음)');
  // 크기: 메뉴 16px, 적용가 20px, 조건 13px 이상
  const sizes = await card.evaluate((el) => ['.menu', '.price b'].map((s) => getComputedStyle(el.querySelector(s)).fontSize));
  assert.deepEqual(sizes, ['16px', '20px']);
  const condSize = await page.locator('#card-p9800 .conds').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(condSize >= 13);
});

test('불러오기 실패는 결과 없음과 구분하고, 다시 시도는 혜택 조회만 다시 한다(수집 요청 없음)', { timeout: 30000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
  t.after(() => context.close());
  const page = await context.newPage();
  let fail = true; let coupons = 0; let posts = 0;
  await context.route('**/*', async (route) => {
    const req = route.request(); const url = new URL(req.url());
    if (url.origin === site.base) return route.continue();
    if (url.hostname === 'script.google.com') {
      if (req.method() === 'POST') { posts++; return route.fulfill({ status: 200, json: { ok: true }, headers: { 'access-control-allow-origin': '*' } }); }
      if (url.searchParams.get('action') === 'coupons') { coupons++; if (fail) return route.abort('failed'); return route.fulfill({ status: 200, json: { ok: true, last_checked_at: now, coupons: COUPONS, news: [] }, headers: { 'access-control-allow-origin': '*' } }); }
      return route.fulfill({ status: 200, json: { ok: true, state: 'idle', last_checked_at: now }, headers: { 'access-control-allow-origin': '*' } });
    }
    return route.abort();
  });
  await page.goto(`${site.base}/index.html`);
  await page.getByText('혜택을 불러오지 못했어요.').waitFor();
  assert.equal(await page.getByText('선택한 조건에 맞는 혜택이 없어요.').count(), 0);
  fail = false;
  const before = coupons;
  const postsBefore = posts;
  await page.getByRole('button', { name: '다시 시도' }).click();
  await page.locator('#list .card').first().waitFor();
  assert.equal(coupons, before + 1);
  assert.equal(posts - postsBefore, 0, '다시 시도는 공식 출처 수집(새로 확인)을 부르지 않는다');
});

test('작은 화면(320~430px)과 넓은 화면에서 예산 줄은 줄 안에서만 넘기고 페이지가 가로로 밀리지 않는다', { timeout: 60000 }, async (t) => {
  for (const [width, scheme] of [[320, 'light'], [390, 'dark'], [430, 'light'], [1280, 'dark']]) {
    const { context, page } = await setup({ viewport: { width, height: 800 }, colorScheme: scheme });
    t.after(() => context.close());
    await page.getByRole('button', { name: '15000원 이하', exact: true }).click();
    const m = await page.evaluate(() => {
      const row = document.querySelector('#budgetOpts'); const on = row.querySelector('[aria-pressed="true"]');
      const r = row.getBoundingClientRect(); const b = on.getBoundingClientRect();
      const btns = [...row.querySelectorAll('button')].map((x) => ({ h: x.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(x).fontSize), clipped: x.scrollWidth > x.clientWidth }));
      return { page: document.documentElement.scrollWidth <= innerWidth, visible: b.left >= r.left - 1 && b.right <= r.right + 1, btns };
    });
    assert.equal(m.page, true, `${width}: 페이지 가로 넘침 없음`);
    assert.equal(m.visible, true, `${width}: 고른 예산 버튼이 보인다`);
    for (const b of m.btns) { assert.ok(b.h >= 36, `${width}: 버튼 높이`); assert.ok(b.fs >= 14, `${width}: 글자 크기`); assert.equal(b.clipped, false); }
    // 카드 안 버튼(상세 보기·공식 페이지)이 서로 겹치지 않는다
    const overlap = await page.locator('#list .card').evaluateAll((cards) => cards.some((card) => {
      const r = [...card.querySelectorAll('.more, .cta, .brand-link')].map((e) => e.getBoundingClientRect());
      return r.some((a, i) => r.some((b, j) => i < j && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom));
    }));
    assert.equal(overlap, false, `${width}: 카드 버튼 겹침 없음`);
    // 정렬·필터 줄은 하나만 화면 위에 붙는다 (예산 줄은 붙지 않음)
    assert.equal(await page.locator('#budget').evaluate((el) => getComputedStyle(el).position), 'static');
  }
});
