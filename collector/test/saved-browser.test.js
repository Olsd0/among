import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serveDir } from './helpers.js';

let site, browser;
before(async () => {
  site = await serveDir(fileURLToPath(new URL('../../web/', import.meta.url)));
  browser = await chromium.launch();
});
after(async () => {
  if (browser) await browser.close();
  if (site) await site.close();
});

function coupon(id) {
  const now = new Date().toISOString();
  return {
    id, brand: '테스트버거', category: '햄버거', menu: `테스트 버거 ${id}`, item_type: '단품',
    discount_type: 'price', regular_price: 8000, coupon_price: 5000, discount_rate: 38,
    channels: ['매장'], audience: '전체', programs: [], start_date: null, end_date: null,
    checked_at: now, first_seen: now,
    source_url: 'https://example.test/event', official_link: 'https://example.test/event',
  };
}

async function setup(t, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block',
  });
  t.after(() => context.close());
  const data = { ok: true, coupons: ['one', 'two', 'three'].map(coupon), news: [], last_checked_at: new Date().toISOString() };
  // 실제 운영 API나 광고에는 요청하지 않고, 찜 동작만 고정된 쿠폰으로 검증한다.
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === site.base) {
      if (url.pathname === '/config.js') return route.fulfill({
        contentType: 'text/javascript',
        body: "window.AMONG_CONFIG = { apiUrl: 'https://script.google.com/macros/s/saved-test/exec', contactEmail: '', onlineDeals: { enabled: false }, sponsorship: null };",
      });
      return route.continue();
    }
    if (url.hostname === 'script.google.com') return route.fulfill({
      json: url.searchParams.get('action') === 'coupons' ? data : { ok: true, items: [] },
      headers: { 'access-control-allow-origin': '*' },
    });
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(({ hasInitial, rawSaved, blockWrites }) => {
    if (hasInitial) localStorage.setItem('among_saved', rawSaved);
    if (!blockWrites) return;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'among_saved') throw new DOMException('Storage blocked', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  }, { hasInitial: Object.hasOwn(options, 'rawSaved'), rawSaved: options.rawSaved, blockWrites: !!options.blockWrites });
  await page.goto(site.base + '/');
  await page.locator('#card-one').waitFor();
  return { context, page, errors };
}

async function saveButton(page, id) {
  const card = page.locator(`#card-${id}`);
  const toggle = card.locator('[data-toggle]');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  return card.locator(`[data-save="${id}"]`);
}

const savedIds = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('among_saved')));

test('찜을 저장하면 새로고침 뒤에도 유지하고 찜 목록에서 모아 볼 수 있다', async (t) => {
  const { page, errors } = await setup(t);
  const button = await saveButton(page, 'one');
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await savedIds(page), ['one']);
  await page.reload();
  await page.locator('#card-one').waitFor();
  assert.equal(await (await saveButton(page, 'one')).getAttribute('aria-pressed'), 'true');
  await page.locator('[data-quick="saved"]').click();
  assert.deepEqual(await page.locator('#list .card').evaluateAll((cards) => cards.map((card) => card.dataset.id)), ['one']);
  assert.match(await page.locator('#summary').innerText(), /1개/);
  assert.deepEqual(errors, []);
});

test('찜 목록에서 중간 항목과 마지막 항목을 해제하면 목록과 개수가 즉시 바뀌고 필터를 끌 수 있다', async (t) => {
  const { page, errors } = await setup(t);
  await (await saveButton(page, 'one')).click();
  await (await saveButton(page, 'two')).click();
  const filter = page.locator('[data-quick="saved"]');
  await filter.click();
  assert.equal(await page.locator('#list .card').count(), 2);
  await (await saveButton(page, 'one')).click();
  assert.equal(await page.locator('#card-one').count(), 0);
  assert.equal(await page.locator('#list .card').count(), 1);
  assert.match(await page.locator('#summary').innerText(), /1개/);
  assert.equal(await filter.locator('.n').innerText(), '1');
  await (await saveButton(page, 'two')).click();
  assert.deepEqual(await savedIds(page), []);
  assert.equal(await page.locator('#list .card').count(), 0);
  assert.equal(await filter.getAttribute('aria-pressed'), 'true');
  assert.equal(await filter.locator('.n').innerText(), '0');
  assert.equal(await filter.evaluate((button) => button === document.activeElement), true, '마지막 카드가 사라지면 찜 필터로 초점을 옮긴다');
  assert.doesNotMatch(await page.locator('#summary').innerText(), /[1-9]\d*개/);
  await filter.click();
  assert.equal(await page.locator('#list .card').count(), 3);
  assert.deepEqual(errors, []);
});

test('찜 저장소 쓰기가 막히면 추가와 해제 모두 기존 표시와 저장 내용을 유지한다', async (t) => {
  for (const initial of [[], ['one']]) {
    await t.test(initial.length ? '기존 찜 해제 실패' : '새 찜 저장 실패', async (t) => {
      const { page, errors } = await setup(t, { rawSaved: JSON.stringify(initial), blockWrites: true });
      const button = await saveButton(page, 'one');
      await button.click();
      assert.equal(await button.getAttribute('aria-pressed'), String(initial.length > 0));
      assert.deepEqual(await savedIds(page), initial);
      assert.match(await page.locator('#toast').innerText(), /저장하지 못|저장할 수 없/);
      if (initial.length) {
        await page.locator('[data-quick="saved"]').click();
        assert.equal(await page.locator('#card-one').count(), 1);
      } else assert.equal(await page.locator('[data-quick="saved"]').count(), 0);
      assert.deepEqual(errors, []);
    });
  }
});

test('찜 저장값이 배열이 아니거나 깨진 JSON이어도 쿠폰 화면이 열리고 새로 찜할 수 있다', async (t) => {
  for (const rawSaved of ['{}', 'null', '17', '"one"', 'true', '[']) {
    await t.test(rawSaved, async (t) => {
      const { page, errors } = await setup(t, { rawSaved });
      assert.equal(await page.locator('#list .card').count(), 3);
      assert.equal(await page.locator('[data-quick="saved"]').count(), 0);
      await (await saveButton(page, 'one')).click();
      assert.deepEqual(await savedIds(page), ['one']);
      assert.deepEqual(errors, []);
    });
  }
});

test('저장된 찜 배열의 잘못된 항목은 제외하고 문자열 쿠폰 ID만 이어서 저장한다', async (t) => {
  const { page, errors } = await setup(t, { rawSaved: JSON.stringify(['one', 17, null, {}, false, 'two']) });
  assert.equal(await (await saveButton(page, 'one')).getAttribute('aria-pressed'), 'true');
  assert.equal(await (await saveButton(page, 'two')).getAttribute('aria-pressed'), 'true');
  await (await saveButton(page, 'three')).click();
  assert.deepEqual((await savedIds(page)).sort(), ['one', 'three', 'two']);
  assert.deepEqual(errors, []);
});

test('다른 탭에서 찜을 추가하거나 해제하면 열린 상세와 찜 목록도 함께 갱신된다', async (t) => {
  const { context, page, errors } = await setup(t);
  const other = await context.newPage();
  other.on('pageerror', (error) => errors.push(error.message));
  await other.goto(site.base + '/');
  await other.locator('#card-one').waitFor();
  await saveButton(other, 'one');
  await (await saveButton(page, 'one')).click();
  await other.waitForFunction(() => document.querySelector('[data-save="one"]')?.getAttribute('aria-pressed') === 'true');
  await other.locator('[data-quick="saved"]').click();
  assert.equal(await other.locator('#list .card').count(), 1);
  await (await saveButton(page, 'one')).click();
  await other.waitForFunction(() => document.querySelectorAll('#list .card').length === 0);
  const filter = other.locator('[data-quick="saved"]');
  assert.equal(await filter.getAttribute('aria-pressed'), 'true');
  assert.equal(await filter.locator('.n').innerText(), '0');
  await filter.click();
  assert.equal(await other.locator('#list .card').count(), 3);
  assert.deepEqual(errors, []);
});

test('다른 탭에서 기기 저장 내용을 모두 비우면 열린 찜 목록도 비워지고 필터를 해제할 수 있다', async (t) => {
  const { context, page, errors } = await setup(t);
  await (await saveButton(page, 'one')).click();
  await page.locator('[data-quick="saved"]').click();
  const other = await context.newPage();
  other.on('pageerror', (error) => errors.push(error.message));
  await other.goto(site.base + '/');
  await other.locator('#card-one').waitFor();
  await other.evaluate(() => localStorage.clear());
  await page.waitForFunction(() => document.querySelectorAll('#list .card').length === 0);
  assert.equal(await savedIds(page), null);
  const filter = page.locator('[data-quick="saved"]');
  assert.equal(await filter.getAttribute('aria-pressed'), 'true');
  assert.equal(await filter.locator('.n').innerText(), '0');
  await filter.click();
  assert.equal(await page.locator('#list .card').count(), 3);
  assert.deepEqual(errors, []);
});

test('다른 탭의 찜 변경이 검색 중인 입력란의 초점과 내용을 빼앗지 않는다', async (t) => {
  const { context, page, errors } = await setup(t);
  const other = await context.newPage();
  other.on('pageerror', (error) => errors.push(error.message));
  await other.goto(site.base + '/');
  await other.locator('#card-one').waitFor();
  await page.locator('#searchBtn').click();
  const search = page.locator('#q');
  await search.fill('테스트');
  await search.evaluate((input) => input.setSelectionRange(1, 2));
  await (await saveButton(other, 'one')).click();
  await page.waitForFunction(() => document.querySelector('[data-quick="saved"] .n')?.textContent === '1');
  assert.equal(await search.evaluate((input) => input === document.activeElement), true);
  assert.equal(await search.inputValue(), '테스트');
  assert.deepEqual(await search.evaluate((input) => [input.selectionStart, input.selectionEnd]), [1, 2]);
  assert.deepEqual(errors, []);
});
