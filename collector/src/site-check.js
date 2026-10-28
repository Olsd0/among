// 공개 화면 점검 (AI 호출 없음): 실제 사이트를 휴대폰 크기로 열어 핫딜 카드·아이콘·티켓·소식 상세가 뜨는지,
// 쿠폰 사진(공식 행사 페이지 이미지 주소)이 실제 브라우저에서 불러와지는지(다른 사이트 표시를 막는지) 확인한다.
// 결과는 GitHub 주석으로만 남긴다 (화면 사진은 브랜드 이미지가 담기므로 저장하지 않음).
// 사용: SITE_URL=https://olsd0.github.io/among/ node src/site-check.js
import { chromium } from 'playwright';

const SITE = process.env.SITE_URL || 'https://olsd0.github.io/among/';
const browser = await chromium.launch();
const out = { errors: [], images: new Map() };
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    locale: 'ko-KR', timezoneId: 'Asia/Seoul',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => out.errors.push(`pageerror: ${e.message}`.slice(0, 200)));
  // 이미지·아이콘을 못 불러온 것은 사진 결과로 따로 보므로 화면 오류에서 뺀다
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) out.errors.push(`console: ${m.text()}`.slice(0, 200)); });
  page.on('response', (r) => { if (r.request().resourceType() === 'image') out.images.set(r.url(), r.status()); });
  page.on('requestfailed', (r) => { if (r.resourceType() === 'image') out.images.set(r.url(), `실패 ${r.failure()?.errorText || ''}`.trim()); });

  await page.goto(`${SITE}?check=${Date.now()}`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  const data = await page.evaluate(async () => {
    const r = await fetch(`${window.AMONG_CONFIG.apiUrl}?action=coupons&t=${Date.now()}`).then((x) => x.json());
    return { coupons: r.coupons || [], news: r.news || [] };
  });
  // 아래까지 천천히 내려 지연 로딩 사진을 모두 부른다
  for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, 700); await page.waitForTimeout(120); }
  await page.waitForTimeout(4000);
  // 핫딜 카드의 사진도 모두 부르도록 옆으로 넘김
  await page.evaluate(() => { const r = document.querySelector('#hotRail'); if (r) r.scrollLeft = r.scrollWidth; });
  await page.waitForTimeout(2500);

  const view = await page.evaluate(() => ({
    hot: [...document.querySelectorAll('.hcard')].map((h) => `${h.classList.contains('has-ph') ? '사진' : '그림'}|${h.dataset.hot.split(':')[0]}|${h.getAttribute('aria-label').replace(/^\d+번째 핫딜: /, '')}`),
    tickets: document.querySelectorAll('.ticket').length,
    stubPhoto: document.querySelectorAll('.stub.has-ph').length,
    stubFailed: document.querySelectorAll('.stub.noph').length,
    grid: [...document.querySelectorAll('.gi')].map((g) => g.innerText.replace(/\s+/g, '')).join(' '),
    summary: document.querySelector('#summary')?.textContent || '',
  }));

  // 소식 상세 열기
  let newsSheet = '소식 카드 없음';
  const firstNews = await page.$('.hcard[data-hot^="news"]');
  if (firstNews) {
    await page.evaluate(() => document.querySelector('#hotRail').scrollLeft = 0);
    await firstNews.click();
    await page.waitForTimeout(800);
    newsSheet = await page.evaluate(() => {
      const d = document.querySelector('#newsSheet');
      return d && d.open ? `열림|${location.search}|${d.querySelector('.news-title')?.textContent}|관련 쿠폰 ${d.querySelectorAll('[data-rel]').length}` : '안 열림';
    });
  }

  // 사진 주소별 결과 (사이트별로 묶음)
  const want = new Set([...data.coupons.map((c) => c.image_url), ...data.news.map((n) => n.image_url)].filter(Boolean));
  const byHost = {};
  for (const u of want) {
    const h = new URL(u).hostname;
    const st = out.images.get(u);
    const ok = st === 200 || st === 304;
    byHost[h] = byHost[h] || { ok: 0, bad: 0, notLoaded: 0, sample: '' };
    if (st === undefined) byHost[h].notLoaded++;
    else if (ok) byHost[h].ok++;
    else { byHost[h].bad++; byHost[h].sample = byHost[h].sample || `${st} ${u.slice(-60)}`; }
  }

  const n = (s) => String(s).replace(/\r?\n/g, ' ').replace(/%/g, '%25');
  const lines = [
    `쿠폰 ${data.coupons.length} (사진 주소 ${data.coupons.filter((c) => c.image_url).length}) · 소식 ${data.news.length} · 티켓 ${view.tickets} (사진 표시 ${view.stubPhoto}, 사진 실패→글자 ${view.stubFailed})`,
    `아이콘: ${view.grid}`,
    `목록: ${view.summary}`,
    `소식 상세: ${newsSheet}`,
    `화면 오류 ${out.errors.length}건${out.errors.length ? ': ' + out.errors.slice(0, 3).join(' / ') : ''}`,
  ];
  console.log(lines.join('\n'));
  console.log(view.hot.join('\n'));
  console.log(JSON.stringify(byHost, null, 1));
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::notice title=화면 점검::${lines.map(n).join('%0A')}`);
    console.log(`::notice title=핫딜 ${view.hot.length}장::${view.hot.map(n).join('%0A')}`);
    console.log(`::notice title=사진 불러오기 (사이트별)::${Object.entries(byHost).map(([h, v]) => n(`${h}|성공 ${v.ok}|실패 ${v.bad}|안 부름 ${v.notLoaded}${v.sample ? `|예: ${v.sample}` : ''}`)).join('%0A') || '사진 없음'}`);
  }
} finally {
  await browser.close();
}
