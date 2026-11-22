// 화면 점검표 (AI 호출 없음): 실제 공개 데이터 사본으로 주요 화면을 휴대폰·PC × 밝은·어두운 화면으로 찍고,
// 자동 점검(가로 넘침 · 작은 누름 영역 · 글자 대비 · 깨진 사진 · 화면 오류)을 함께 적는다.
// 사진(브랜드 공식 이미지·로고)은 받지 않고 회색 칸으로 대신한다 — 화면 사진에 브랜드 이미지를 담지 않기 위해.
// 결과 사진은 저장소에 넣지 않는다(작업 폴더에만).
//
// 사용:
//   1) 사본 받기: collect.yml mode=snapshot 실행 → gh run view <id> --log > run.log
//      node scripts/ux-screens.js --from-log run.log <사본 폴더>
//   2) 찍기:   node scripts/ux-screens.js <사본 폴더> <출력 폴더> [화면이름,...] [--variants=ml,md,pl,pd]
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveDir } from '../test/helpers.js';

const args = process.argv.slice(2);

if (args[0] === '--from-log') {
  const [, logFile, dir] = args;
  const parts = {};
  for (const line of readFileSync(logFile, 'utf8').split('\n')) {
    const m = line.match(/SNAP (\w+) (\d+)\/(\d+) ([A-Za-z0-9+/=]+)\s*$/);
    if (!m) continue;
    (parts[m[1]] ||= { n: +m[3], chunks: [] }).chunks[+m[2] - 1] = m[4];
  }
  mkdirSync(dir, { recursive: true });
  for (const [action, { n, chunks }] of Object.entries(parts)) {
    if (chunks.filter(Boolean).length !== n) { console.log(`  ✗ ${action}: ${chunks.filter(Boolean).length}/${n}줄`); continue; }
    const body = gunzipSync(Buffer.from(chunks.join(''), 'base64')).toString('utf8');
    JSON.parse(body);
    writeFileSync(join(dir, `${action}.json`), body);
    console.log(`  ✓ ${action}: ${body.length}자`);
  }
  process.exit(0);
}

const [snapDir, outDir, onlyArg = ''] = args.filter((a) => !a.startsWith('--'));
const variantArg = (args.find((a) => a.startsWith('--variants=')) || '').split('=')[1];
const snap = (a) => (existsSync(join(snapDir, `${a}.json`)) ? JSON.parse(readFileSync(join(snapDir, `${a}.json`), 'utf8')) : { ok: false, error: 'no_snapshot' });
const DATA = { coupons: snap('coupons'), app_coupons: snap('app_coupons'), nutrition: snap('nutrition'), online_deals: snap('online_deals'), status: snap('status') };
mkdirSync(outDir, { recursive: true });

const VARIANTS = {
  ml: { label: '휴대폰 · 밝게', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' },
  md: { label: '휴대폰 · 어둡게', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' },
  pl: { label: 'PC · 밝게', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light' },
  pd: { label: 'PC · 어둡게', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'dark' },
};
const GRAY = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="100%" height="100%" fill="#c9c6bd"/><text x="50%" y="54%" font-size="40" text-anchor="middle" fill="#8b877c" font-family="sans-serif">사진</text></svg>`;

const coupons = DATA.coupons.coupons || [];
const news = DATA.coupons.news || [];
const bk = coupons.find((c) => c.brand === '버거킹' && c.min_order) || coupons.find((c) => c.brand === '버거킹') || coupons[0];
const notice = news.find((n) => n.image_url && n.brand === '파파이스') || news.find((n) => n.image_url) || news[0];

// 화면 목록: name, 이름, 주소, 준비 동작, 찍을 범위
const SCREENS = [
  { name: 'home', label: '홈 첫 화면 (처음 방문)', path: '/index.html' },
  { name: 'home-list', label: '홈 · 혜택 목록', path: '/index.html', prep: async (p) => { await p.locator('#grid').scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -80)); } },
  { name: 'hot-tiles', label: '핫딜 전체 보기', path: '/index.html', prep: async (p) => { await p.click('#showAllNotices'); await p.locator('#hot').scrollIntoViewIfNeeded(); await p.evaluate(() => document.querySelector('#hot').scrollIntoView({ block: 'start' })); } },
  { name: 'brand', label: '브랜드 화면 (버거킹)', path: '/index.html', prep: async (p) => { await p.locator('[data-brand-open="버거킹"]').first().click(); await p.waitForTimeout(500); await p.evaluate(() => window.scrollTo(0, 0)); } },
  { name: 'brand-events', label: '브랜드 화면 · 진행 중인 행사', path: '/index.html', prep: async (p) => { await p.locator('[data-brand-open="버거킹"]').first().click(); await p.waitForTimeout(500); await p.evaluate(() => document.querySelector('#hot')?.scrollIntoView({ block: 'start' })); } },
  { name: 'coupon-detail', label: '쿠폰 펼친 상세', path: `/index.html?c=${encodeURIComponent(bk?.id || '')}`, prep: async (p) => { await p.waitForTimeout(800); } },
  { name: 'notice-sheet', label: '공지 상세 (아래에서 올라오는 창)', path: `/index.html?n=${encodeURIComponent(notice?.id || '')}`, prep: async (p) => { await p.waitForTimeout(800); } },
  { name: 'me-sheet', label: '내 조건 창', path: '/index.html', prep: async (p) => { await p.click('#meBtn'); await p.waitForTimeout(400); } },
  { name: 'app-coupons', label: '앱 쿠폰 모음', path: '/index.html?view=appCoupons', prep: async (p) => { await p.waitForTimeout(800); } },
  { name: 'online', label: '온라인 먹거리 특가', path: '/index.html', prep: async (p) => { await p.click('[data-view="onlineDeals"]'); await p.waitForTimeout(900); await p.evaluate(() => window.scrollTo(0, 0)); } },
  { name: 'empty', label: '검색 결과 없음', path: '/index.html', prep: async (p) => { const s = p.locator('#searchBtn'); if (await s.isVisible()) await s.click(); await p.fill('#q', '없는메뉴이름zz'); await p.keyboard.press('Enter'); await p.waitForTimeout(500); await p.locator('#list').scrollIntoViewIfNeeded(); } },
  { name: 'loading', label: '불러오는 중', path: '/index.html', api: 'hang', settle: 1500 },
  { name: 'error', label: '연결 실패 (저장본 없음)', path: '/index.html', api: 'fail', settle: 3000 },
  { name: 'about', label: '소개', path: '/about.html' },
  { name: 'about-more', label: '소개 · 아래쪽', path: '/about.html', prep: async (p) => { await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.45)); await p.waitForTimeout(800); } },
  { name: 'partners', label: '제휴', path: '/partners.html' },
  { name: 'privacy', label: '개인정보처리방침', path: '/privacy.html' },
  { name: 'terms', label: '이용약관', path: '/terms.html' },
  { name: '404', label: '없는 주소', path: '/404.html' },
];

const only = onlyArg ? new Set(onlyArg.split(',')) : null;
const variants = (variantArg || 'ml,md,pl,pd').split(',');
const site = await serveDir(fileURLToPath(new URL('../../web/', import.meta.url)), { reviewedEvents: true });
const browser = await chromium.launch();
const report = [];
try {
  for (const s of SCREENS) {
    if (only && !only.has(s.name)) continue;
    for (const v of variants) {
      const cfg = VARIANTS[v];
      const ctx = await browser.newContext({ ...cfg, label: undefined, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block', reducedMotion: 'reduce' });
      const errors = [];
      await ctx.route('**/*', (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const api = url.pathname.endsWith('/api/public') || url.hostname === 'script.google.com';
        if (api) {
          if (s.api === 'fail') return route.abort();
          if (s.api === 'hang') return; // 응답하지 않음 → 불러오는 중
          if (req.method() === 'POST') return route.fulfill({ status: 200, json: { ok: true }, headers: { 'access-control-allow-origin': '*' } });
          const body = DATA[url.searchParams.get('action')] || { ok: false, error: 'unknown' };
          return route.fulfill({ status: 200, json: body, headers: { 'access-control-allow-origin': '*' } });
        }
        if (url.origin === site.base) return route.continue();
        if (req.resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: GRAY });
        return route.abort();
      });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`.slice(0, 160)));
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push(`console: ${m.text()}`.slice(0, 160)); });
      const file = `${s.name}-${v}.jpg`;
      try {
        await page.goto(site.base + s.path, { waitUntil: s.api === 'hang' ? 'domcontentloaded' : 'networkidle', timeout: 30000 });
        await page.waitForTimeout(s.settle || 900);
        if (s.prep) await s.prep(page);
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(outDir, file), type: 'jpeg', quality: 72 });
        const auto = await page.evaluate(({ mobile }) => {
          const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
          const txt = (el) => (el.innerText || el.getAttribute('aria-label') || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 30);
          const overflowX = document.documentElement.scrollWidth - innerWidth;
          // 누름 영역: 휴대폰에서 40px 미만 (보이는 것만)
          const small = mobile ? [...document.querySelectorAll('a[href], button, input, select, summary, [role="button"]')].filter(vis).map((el) => { const r = el.getBoundingClientRect(); return { t: txt(el) || el.className.toString().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.w < 40 || x.h < 40) : [];
          // 글자 대비 (배경 그림은 무시하고 가장 가까운 배경색 기준)
          const rgb = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
          const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
          const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c && c.a > 0.85) return c; if (getComputedStyle(e).backgroundImage !== 'none' && e !== document.documentElement) return null; } return rgb(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255 }; };
          const low = new Map();
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const el = n.parentElement; if (!el || !n.textContent.trim() || !vis(el)) continue;
            const cs = getComputedStyle(el); const fg = rgb(cs.color); const bg = bgOf(el); if (!fg || !bg || fg.a < 0.5 || +cs.opacity < 0.5) continue;
            const [a, b] = [lum(fg) + 0.05, lum(bg) + 0.05]; const ratio = Math.max(a, b) / Math.min(a, b);
            const size = parseFloat(cs.fontSize); const big = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
            if (ratio < (big ? 3 : 4.5)) { const k = `${cs.color}|${getComputedStyle(el).backgroundColor}`; if (!low.has(k)) low.set(k, { ratio: Math.round(ratio * 100) / 100, size, sample: n.textContent.trim().slice(0, 24), cls: el.className.toString().slice(0, 30) }); }
          }
          const broken = [...document.images].filter((i) => vis(i) && i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')?.slice(0, 60));
          return { overflowX, small: small.slice(0, 12), smallCount: small.length, lowContrast: [...low.values()].slice(0, 10), broken: broken.slice(0, 6) };
        }, { mobile: !!cfg.isMobile });
        report.push({ screen: s.name, label: s.label, variant: v, variantLabel: cfg.label, file, errors, ...auto });
        console.log(`  ✓ ${s.name} ${v}${auto.overflowX > 1 ? ` 가로넘침 ${auto.overflowX}` : ''}${auto.smallCount ? ` 작은누름 ${auto.smallCount}` : ''}${auto.lowContrast.length ? ` 대비 ${auto.lowContrast.length}` : ''}${errors.length ? ` 오류 ${errors.length}` : ''}`);
      } catch (e) {
        report.push({ screen: s.name, label: s.label, variant: v, variantLabel: cfg.label, file: null, errors: [...errors, `찍기 실패: ${e.message.slice(0, 160)}`] });
        console.log(`  ✗ ${s.name} ${v}: ${e.message.slice(0, 120)}`);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await site.close();
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 1));
}
