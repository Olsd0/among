import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serveDir } from './helpers.js';

test('홈 안내·제휴 화면은 모바일과 데스크톱에서 동작하고 광고는 명확하게 구분한다', { timeout: 60000 }, async t => {
  const site = await serveDir(fileURLToPath(new URL('../../web/', import.meta.url)));
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await site.close(); });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const requests = [], errors = [];
  let sponsorship = null;
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    if (url.origin !== site.base) return route.abort();
    if (url.pathname === '/config.js') return route.fulfill({ contentType: 'text/javascript', body: `window.AMONG_CONFIG=${JSON.stringify({ apiUrl: '', contactEmail: 'hello@example.com', onlineDeals: { enabled: true, dataUrl: './online-deals.json' }, sponsorship })};` });
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${site.base}/index.html?demo=1`);
    await page.locator('#list .card').first().waitFor();
    assert.equal(await page.locator('#sponsor').isHidden(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `home ${width}`);
    await page.getByText('50% 적립은 반값 할인과 같은가요?', { exact: true }).click();
    assert.equal(await page.locator('.service-guide details[open]').count(), 1);
    if (width === 390) { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: '/tmp/among-launch-home.png' }); }
    for (const path of ['about.html', 'partners.html']) {
      await page.goto(`${site.base}/${path}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${path} ${width}`);
    }
  }
  // 할인 계산기(가이드)는 11/21에 없앴다: 홈에 계산기 링크가 남아 있지 않다
  await page.goto(`${site.base}/index.html?demo=1`);
  assert.equal(await page.getByRole('link', { name: '할인 계산기' }).count(), 0);
  await page.goto(`${site.base}/partners.html`);
  assert.equal(await page.locator('[data-contact] a').getAttribute('href'), 'mailto:hello@example.com');
  await page.screenshot({ path: '/tmp/among-launch-partners.png', fullPage: true });
  await page.clock.install({ time: new Date() });
  sponsorship = { enabled: true, advertiser: '테스트 광고주', title: '<img src=x onerror=alert(1)>', description: '검증용 문구', url: 'https://example.com/offer', startsAt: new Date(Date.now()-1000).toISOString(), endsAt: new Date(Date.now()+60000).toISOString() };
  await page.goto(`${site.base}/index.html?demo=1`);
  await page.locator('#sponsor a').waitFor();
  assert.match(await page.locator('#sponsor').innerText(), /광고 · 테스트 광고주/);
  assert.equal(await page.locator('#sponsor img').count(), 0);
  assert.equal(await page.locator('#sponsor a').getAttribute('rel'), 'sponsored noopener noreferrer');
  assert.equal(requests.some(url => /example.com\/offer|adsbygoogle|googlesyndication/.test(url)), false);
  await page.clock.fastForward(61000);
  assert.equal(await page.locator('#sponsor').isHidden(), true, '열린 탭에서도 광고 기간 종료를 반영');
  assert.deepEqual(errors, []);
});
