// 11/22 로드맵 2번: 처음 온 사람이 홈에서 바로 통신사 → 결제 두 단계로 '내 조건'을 끝내고 '내가 쓸 수 있는' 목록으로 간다.
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serveDir } from './helpers.js';

let site, browser;
before(async () => { site = await serveDir(fileURLToPath(new URL('../../web/', import.meta.url))); browser = await chromium.launch(); });
after(async () => { if (browser) await browser.close(); if (site) await site.close(); });

async function open(init) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'ko-KR' });
  await context.route('**/*', (r) => new URL(r.request().url()).origin === site.base ? r.continue() : r.abort());
  const page = await context.newPage();
  if (init) await page.addInitScript(init);
  await page.goto(site.base + '/index.html?demo=1');
  await page.waitForSelector('#list .card');
  return { context, page };
}

test('처음 온 사람: 통신사 하나 → 결제 고르기 → 내 혜택 보기 (창 없이 홈 안에서, 3번 누르기)', { timeout: 30000 }, async (t) => {
  const { context, page } = await open();
  t.after(() => context.close());
  const bar = page.locator('#meBar.flow');
  await bar.waitFor();
  assert.match(await bar.locator('.me-q').innerText(), /어느 통신사를 쓰세요\?/);
  assert.deepEqual(await bar.locator('[data-me-telecom]').allInnerTexts(), ['SKT', 'KT', 'LG U+', '알뜰폰·없음']);
  assert.equal(await page.locator('dialog[open]').count(), 0, '창을 띄우지 않는다');
  await bar.locator('[data-me-telecom="KT"]').click();
  assert.match(await bar.locator('.me-q').innerText(), /자주 쓰는 결제·포인트는요\?[\s\S]*2\/2/);
  assert.match(await bar.locator('[data-me-done]').innerText(), /없음 · 내 혜택 보기/);
  await bar.locator('[data-me-pay="네이버페이"]').click();
  assert.equal(await bar.locator('[data-me-pay="네이버페이"]').getAttribute('aria-pressed'), 'true');
  await bar.locator('[data-me-done]').click();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('among_profile'))), { telecom: 'KT', pays: ['네이버페이'], newMember: true });
  assert.equal(await page.locator('[data-quick="mine"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#meLabel').innerText(), 'KT·네이버페이');
  assert.match(await page.locator('#meBar').innerText(), /KT 멤버십 · 네이버페이 기준으로 내가 쓸 수 있는 혜택 \d+개를 먼저 보여드려요/);
  assert.equal(await page.locator('#meBar.flow').count(), 0);
});

test('이전으로 돌아가 통신사를 바꿀 수 있고, 닫으면 7일 동안 다시 묻지 않는다', { timeout: 30000 }, async (t) => {
  const { context, page } = await open();
  t.after(() => context.close());
  const bar = page.locator('#meBar.flow');
  await bar.locator('[data-me-telecom="SKT"]').click();
  await bar.locator('[data-me-back]').click();
  assert.equal(await bar.locator('[data-me-telecom]').count(), 4);
  await bar.locator('[data-dismiss-me]').click();
  assert.equal(await page.locator('#meBar').isHidden(), true);
  await page.reload(); await page.waitForSelector('#list .card');
  assert.equal(await page.locator('#meBar').isHidden(), true, '7일 안에는 다시 묻지 않음');
  await page.evaluate(() => localStorage.setItem('among_me_dismissed_at', JSON.stringify(new Date(Date.now() - 8 * 864e5).toISOString())));
  await page.reload(); await page.waitForSelector('#list .card');
  assert.equal(await page.locator('#meBar.flow').isVisible(), true, '7일이 지나면 다시 묻는다');
});

test('예전에 안내를 영구로 닫은 사람은 오늘부터 7일 쉬는 것으로 바뀐다', { timeout: 30000 }, async (t) => {
  const { context, page } = await open(() => { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', '1'); localStorage.setItem('among_me_dismissed', 'true'); } });
  t.after(() => context.close());
  assert.equal(await page.locator('#meBar').isHidden(), true);
  const at = await page.evaluate(() => JSON.parse(localStorage.getItem('among_me_dismissed_at')));
  assert.ok(Date.now() - Date.parse(at) < 60000);
});
