import { fileURLToPath } from 'node:url';
// 종단 테스트: 가상 공식 페이지 → Playwright 렌더링 → (모의) 추출 → 엔진 → 시트 반영
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveDir } from './helpers.js';
import { runCollector } from '../src/run.js';
import { clearRobotsCache } from '../src/robots.js';
import { encodeArtworkUrl } from '../src/artwork-meta.js';

const NOW = new Date('2026-10-25T03:00:00Z');
let site;

before(async () => { site = await serveDir(fileURLToPath(new URL('./fixtures/site', import.meta.url))); });
after(async () => { await site.close(); });

function recordingSheet() {
  const calls = [];
  return {
    calls,
    async post(action, payload) {
      calls.push({ action, payload });
      if (action === 'ingest') return { ok: true, result: { inserted: payload.coupons.length, updated: 0, unchanged: 0, gone: 0, expired: 0 } };
      return { ok: true };
    },
  };
}

test('가상 페이지 수집: 목록 + 상세, robots 차단 경로 제외, 종료 쿠폰 버림', { timeout: 120000 }, async () => {
  clearRobotsCache();
  const outDir = mkdtempSync(join(tmpdir(), 'among-e2e-'));
  const sheet = recordingSheet();
  const sources = [{
    id: 'test-promo', brand: '테스트버거', category: '햄버거', url: `${site.base}/promo/list.html`,
    selector: 'main', exclude: '.gnb', follow: 'a.event-link', max_follow: 5, official_link: 'https://example.com/app', active: true,
  }, {
    id: 'paused', brand: '멈춤', category: '햄버거', url: `${site.base}/promo/1.html`, active: 'false',
  }];

  const report = await runCollector({ env: { MOCK_CLAUDE: '1', OUT_DIR: outDir, TRIGGER: 'test' }, now: NOW, sources, sheet, quiet: true });

  assert.equal(report.state, 'success');
  assert.equal(report.sources.length, 1, '비활성 출처는 건너뜀');
  assert.equal(report.pages, 3, '목록 1 + 상세 2 (robots 차단 1건 제외)');
  assert.ok(report.errors.some((e) => e.includes('robots.txt')), 'robots 차단 기록');
  assert.ok(!site.hits.includes('/private/secret.html'), '차단 경로는 요청 자체를 하지 않음');

  const coupons = JSON.parse(readFileSync(join(outDir, 'coupons.json'), 'utf8'));
  const byMenu = Object.fromEntries(coupons.map((c) => [c.menu, c]));
  assert.equal(byMenu['불고기버거 세트'].status, 'published');
  assert.equal(byMenu['불고기버거 세트'].coupon_price, 5500);
  assert.deepEqual(byMenu['불고기버거 세트'].channels, ['매장', '픽업']);
  assert.equal(byMenu['치즈버거 세트'].coupon_price, 5900);
  assert.equal(byMenu['치즈버거 세트'].app_only, true);
  assert.equal(byMenu['클래식버거 세트'].coupon_price, 6320);
  assert.equal(byMenu['클래식버거 세트'].audience, '신규회원');
  assert.equal(byMenu['새우버거 세트'].status, 'rejected');
  assert.ok(byMenu['새우버거 세트'].issues.includes('이미 종료'));
  assert.ok(!byMenu.secret);

  assert.deepEqual(sheet.calls.map((c) => c.action), ['run_start', 'ingest', 'run_finish']);
  const ingest = sheet.calls[1].payload;
  assert.equal(ingest.coupons.length, 3, '버림은 시트에 올리지 않음');
  assert.deepEqual(ingest.sources_ok, ['test-promo']);
  assert.equal(report.summary.published, 3);
  assert.equal(report.summary.rejected, 1);
});

test('출처 실패 시: 실패로 기록되고 sources_ok에서 빠진다 (기존 쿠폰을 사라짐 처리하지 않도록)', { timeout: 60000 }, async () => {
  clearRobotsCache();
  const outDir = mkdtempSync(join(tmpdir(), 'among-e2e-'));
  const sheet = recordingSheet();
  const sources = [
    { id: 'ok', brand: 'A', category: '햄버거', url: `${site.base}/promo/1.html`, max_follow: 0 },
    { id: 'broken', brand: 'B', category: '햄버거', url: `${site.base}/promo/없는페이지.html` },
  ];
  const report = await runCollector({ env: { MOCK_CLAUDE: '1', OUT_DIR: outDir }, now: NOW, sources, sheet, quiet: true });
  assert.equal(report.state, 'partial');
  assert.deepEqual(sheet.calls.find((c) => c.action === 'ingest').payload.sources_ok, ['ok']);
  assert.ok(report.sources.find((s) => s.id === 'broken').error.includes('404'));
});

test('여러 브랜드가 섞인 멤버십 페이지: 다루는 브랜드 링크만 따라가고(글자·이미지 대체텍스트), 브랜드·카테고리·통신사를 붙임', { timeout: 120000 }, async () => {
  clearRobotsCache();
  const outDir = mkdtempSync(join(tmpdir(), 'among-e2e-'));
  const sheet = recordingSheet();
  const sources = [{
    id: 'tmem', brand: '', category: '', program: 'SKT', url: `${site.base}/membership/list.html`,
    selector: 'main', follow: 'a.p', follow_text: '도미노|버거킹|파리바게', max_follow: 5, active: 'TRUE',
  }];
  const report = await runCollector({ env: { MOCK_CLAUDE: '1', OUT_DIR: outDir }, now: NOW, sources, sheet, quiet: true });
  assert.equal(report.state, 'success');
  assert.ok(!site.hits.includes('/membership/gs.html'), '다루지 않는 브랜드 링크는 열지 않음');
  assert.ok(site.hits.includes('/membership/bk.html'), '이미지 링크는 대체텍스트로 판단');
  const coupons = JSON.parse(readFileSync(join(outDir, 'coupons.json'), 'utf8'));
  const by = Object.fromEntries(coupons.map((c) => [c.brand, c]));
  assert.equal(by['파리바게뜨'].category, '디저트');
  assert.deepEqual(by['파리바게뜨'].programs, ['SKT']);
  assert.equal(by['파리바게뜨'].status, 'published');
  assert.equal(by['도미노피자'].category, '피자');
  assert.equal(by['도미노피자'].discount_rate, 20);
  assert.equal(by['버거킹'].coupon_price, 5900);
  assert.equal(by.GS25.status, 'rejected');
  const ingested = sheet.calls.find((c) => c.action === 'ingest').payload.coupons;
  assert.deepEqual(ingested.map((c) => c.brand).sort(), ['도미노피자', '버거킹', '파리바게뜨']);
});

test('예약 실행: 00시 트리거가 오늘 이미 수집했으면 GitHub 예약 실행은 건너뜀', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'among-e2e-'));
  const sheet = recordingSheet();
  const now = new Date('2026-10-26T20:19:00Z');  // KST 10/27 05:19 (GitHub 지연 도착)
  const status = (last, state = 'idle') => ({ get: async () => ({ ok: true, state, last_checked_at: last }) });
  const skip = await runCollector({ env: { MOCK_CLAUDE: '1', OUT_DIR: outDir, TRIGGER: 'schedule' }, now, sheet, sheetRead: status('2026-10-26T15:12:00Z'), sources: [], quiet: true });
  assert.equal(skip.state, 'skipped');
  assert.equal(sheet.calls.length, 0, '시트에 아무것도 쓰지 않음');
  const run = await runCollector({ env: { MOCK_CLAUDE: '1', OUT_DIR: outDir, TRIGGER: 'schedule' }, now, sheet, sheetRead: status('2026-10-25T15:12:00Z'), sources: [], quiet: true, browser: { close: async () => {} } });
  assert.notEqual(run.state, 'skipped', '어제 수집이 마지막이면 실행');
  // 00시 트리거가 부르면서 'queued'로 바꿔 둔 상태에서도 자기 자신을 건너뛰지 않음 (검토에서 발견한 버그)
  const queued = await runCollector({ env: { MOCK_CLAUDE: '1', OUT_DIR: outDir, TRIGGER: 'schedule' }, now, sheet, sheetRead: status('2026-10-25T15:12:00Z', 'queued'), sources: [], quiet: true, browser: { close: async () => {} } });
  assert.notEqual(queued.state, 'skipped');
  const manual = await runCollector({ env: { MOCK_CLAUDE: '1', OUT_DIR: outDir, TRIGGER: 'button' }, now, sheet, sheetRead: status('2026-10-26T15:12:00Z'), sources: [], quiet: true, browser: { close: async () => {} } });
  assert.notEqual(manual.state, 'skipped', '갱신 버튼은 항상 실행');
});

test('시험 실행: 시트에 아직 없는 출처 id는 예시 파일에서 보충', async () => {
  const { withExampleSources } = await import('../src/run.js');
  const cwd = process.cwd();
  process.chdir(fileURLToPath(new URL('..', import.meta.url)));
  try {
    const out = withExampleSources([{ id: 'mcd-promo' }], ['mcd-promo', 'tmembership-brand', 'dunkin-event', 'nope']);
    assert.deepEqual(out.map((s) => s.id), ['mcd-promo', 'tmembership-brand', 'dunkin-event']);
    assert.equal(out.find((s) => s.id === 'dunkin-event').active, 'TRUE', '꺼둔 출처도 시험은 가능');
    assert.equal(out.find((s) => s.id === 'tmembership-brand').program, 'SKT');
  } finally { process.chdir(cwd); }
});

test('v5: 공식 이벤트 페이지에서 소식(핫딜)을 함께 갱신, 미확인 상품에는 상세 페이지 대표 이미지도 사용하지 않음, robots 거부 출처는 내림', { timeout: 120000 }, async () => {
  clearRobotsCache();
  const outDir = mkdtempSync(join(tmpdir(), 'among-e2e-v5-'));
  const sheet = recordingSheet();
  const sources = [
    { id: 'v5-promo', brand: '테스트버거', category: '햄버거', url: `${site.base}/v5/list.html`, selector: 'main', follow: 'a.event-link', max_follow: 3, active: true },
    { id: 'now-blocked', brand: '막힘치킨', category: '치킨', url: `${site.base}/private/secret.html`, active: true },
  ];
  const report = await runCollector({ env: { MOCK_CLAUDE: '1', OUT_DIR: outDir, TRIGGER: 'test' }, now: NOW, sources, sheet, quiet: true });
  assert.equal(report.state, 'success');
  const blocked = report.sources.find((s) => s.id === 'now-blocked');
  assert.equal(blocked.robots_blocked, true);
  const ingest = sheet.calls.find((c) => c.action === 'ingest').payload;
  assert.ok(ingest.sources_ok.includes('now-blocked'), 'robots 거부 출처는 성공으로 보고 → 시트의 예전 쿠폰이 사라짐 처리됨');
  assert.ok(report.errors.some((e) => e.includes('now-blocked') && e.includes('내림')));

  const coupons = JSON.parse(readFileSync(join(outDir, 'coupons.json'), 'utf8'));
  const bul = coupons.find((c) => c.menu === '불고기버거 세트');
  assert.equal(bul.image_url, '', '미확인 세트에 행사 배너를 표시하지 않는다');

  const news = JSON.parse(readFileSync(join(outDir, 'news.json'), 'utf8'));
  const weekend = news.find((n) => n.title === '테스트버거 주말 1+1');
  assert.equal(weekend.status, 'published');
  assert.equal(weekend.brand, '테스트버거');
  assert.equal(weekend.end_date, '2026-10-26');
  assert.match(weekend.id, /^n_/);
  assert.equal(news.find((n) => n.title === '지난 여름 반값').status, 'rejected');
  assert.deepEqual(ingest.news.map((n) => n.title), ['테스트버거 주말 1+1'], '버린 소식은 시트에 올리지 않음');
  assert.deepEqual(report.news, { published: 1, pending: 0, rejected: 1 });
});

test('기간 팩트체크 연결 (11/10): 끝나는 날 없는 공식 소식만 저장된 기간 기록을 읽고 확인 → 기간·근거가 시트로, 요일 행사는 건너뜀', { timeout: 60000 }, async () => {
  clearRobotsCache();
  const outDir = mkdtempSync(join(tmpdir(), 'among-e2e-'));
  const calls = [];
  const sheet = {
    async post(action, payload) {
      calls.push({ action, payload });
      if (action === 'news_periods') return { ok: true, periods: [] };
      if (action === 'ingest') return { ok: true, result: { inserted: 0, updated: 0, unchanged: 0, gone: 0, expired: 0 } };
      return { ok: true };
    },
  };
  const asked = [];
  let artworkCalls = 0;
  const artworkUrl = encodeArtworkUrl('https://press.example/burger.jpg', { kind: 'press_related', source: 'https://press.example/article/1', checkedAt: '2026-11-10T03:00:00.000Z', credit: '브랜드 제공' });
  const artwork = async (news, options) => {
    artworkCalls++;
    const event = news.find(n => /와퍼/.test(n.title));
    assert.equal(event.end_date, '2026-11-13', 'image lookup runs after the official period check');
    assert.equal(options.pages.length, 1);
    assert.ok(options.pages.every(page => !('screenshots' in page)), 'image lookup keeps links rather than screenshot buffers');
    return { news: news.map(n => n.id === event.id ? { ...n, image_url: artworkUrl } : n), summary: { checked: 1, filled: 1 } };
  };
  const official = async (n) => { asked.push(n.title); return { start: '2026-11-09', end: '2026-11-13', source: '공식 공지 이미지' }; };
  const sources = [{ id: 'bk-event', brand: '버거킹', category: '햄버거', url: `${site.base}/period/list.html`, selector: 'main', max_follow: 0, active: true }];
  const report = await runCollector({ env: { MOCK_CLAUDE: '1', OUT_DIR: outDir, TRIGGER: 'test' }, now: new Date('2026-11-10T03:00:00Z'), sources, sheet, official, artwork, press: { connected: false, name: '연결 안 됨 (시험)' }, quiet: true });
  assert.equal(report.state, 'success');
  assert.deepEqual(calls.map((c) => c.action), ['run_start', 'news_periods', 'ingest', 'run_finish']);
  assert.deepEqual(asked, ['26년 11월 와퍼 3900원 프로모션'], '요일 행사는 상시라 확인하지 않음');
  const sent = calls.find((c) => c.action === 'ingest').payload.news.find((n) => /와퍼/.test(n.title));
  assert.deepEqual([sent.status, sent.start_date, sent.end_date, sent.period_source], ['published', '2026-11-09', '2026-11-13', '공식 공지 이미지']);
  assert.equal(report.period.filled.length, 1);
  assert.equal(report.period.press, '연결 안 됨 (시험)');
  assert.equal(artworkCalls, 1);
  assert.equal(report.artwork.filled, 1);
  assert.equal(sent.image_url, artworkUrl, 'the complete provenance URL reaches existing ingest');
});

test('바로 확인(버튼) 실행 (11/27): 기간을 새로 찾지 않고 저장된 기간만 반영', { timeout: 60000 }, async () => {
  clearRobotsCache();
  const outDir = mkdtempSync(join(tmpdir(), 'among-e2e-'));
  const calls = [];
  const stored = { start_date: '2026-11-09', end_date: '2026-11-13', period_source: '공식 공지 이미지', period_refs: '', period_checked_at: '2026-11-09T15:00:00Z' };
  let wid = '';
  const sheet = {
    async post(action, payload) {
      calls.push({ action, payload });
      if (action === 'news_periods') return { ok: true, periods: wid ? [{ id: wid, ...stored }] : [] };
      if (action === 'ingest') return { ok: true, result: { inserted: 0, updated: 0, unchanged: 0, gone: 0, expired: 0 } };
      return { ok: true };
    },
  };
  const asked = [];
  const official = async (n) => { asked.push(n.title); return { start: '2026-11-09', end: '2026-11-13', source: '공식 공지 이미지' }; };
  const sources = [{ id: 'bk-event', brand: '버거킹', category: '햄버거', url: `${site.base}/period/list.html`, selector: 'main', max_follow: 0, active: true }];
  const opts = { now: new Date('2026-11-10T03:00:00Z'), sources, sheet, official, artwork: async (news) => ({ news, summary: {} }), press: { connected: false, name: '연결 안 됨 (시험)' }, quiet: true };
  // 처음 한 번은 저장된 기간이 없다 → 버튼 실행이라 새로 찾지 않아 끝나는 날이 비어 있다
  const first = await runCollector({ ...opts, env: { MOCK_CLAUDE: '1', OUT_DIR: outDir, TRIGGER: 'button' } });
  assert.equal(first.state, 'success');
  assert.deepEqual(asked, [], '공식 상세·기사 확인을 부르지 않음');
  const w1 = calls.find((c) => c.action === 'ingest').payload.news.find((n) => /와퍼/.test(n.title));
  assert.equal(w1.end_date || '', '');
  // 저장된 기간이 있으면 그대로 반영
  wid = w1.id;
  calls.length = 0;
  const second = await runCollector({ ...opts, env: { MOCK_CLAUDE: '1', OUT_DIR: outDir, TRIGGER: 'button' } });
  assert.deepEqual(asked, []);
  const w2 = calls.find((c) => c.action === 'ingest').payload.news.find((n) => /와퍼/.test(n.title));
  assert.deepEqual([w2.start_date, w2.end_date, w2.period_source], ['2026-11-09', '2026-11-13', '공식 공지 이미지']);
  assert.equal(second.period.reused, 1);
});

test('바로 확인(버튼) 실행 (11/27): 목록이 지난 수집과 같은 출처는 건너뛰고, 바뀐 출처만 끝까지 수집', { timeout: 120000 }, async () => {
  const { PageCache } = await import('../src/page-cache.js');
  clearRobotsCache();
  const outDir = mkdtempSync(join(tmpdir(), 'among-e2e-'));
  const pageCache = new PageCache('');
  let lastChecked = '';
  const sheetRead = { async get(action) { return action === 'status' ? { ok: true, last_checked_at: lastChecked } : { ok: true, coupons: [], news: [] }; } };
  const sources = [
    { id: 'test-promo', brand: '테스트버거', category: '햄버거', url: `${site.base}/promo/list.html`, selector: 'main', exclude: '.gnb', follow: 'a.event-link', max_follow: 5, active: true },
    { id: 'ok', brand: 'A', category: '햄버거', url: `${site.base}/promo/1.html`, max_follow: 0 },
  ];
  const run = async (trigger) => {
    const sheet = recordingSheet();
    const report = await runCollector({ env: { MOCK_CLAUDE: '1', OUT_DIR: outDir, TRIGGER: trigger, PERIOD_CHECK: '0', ARTWORK_LOOKUP: '0' }, now: NOW, sources, sheet, sheetRead, pageCache, quiet: true });
    return { report, ingest: sheet.calls.find((c) => c.action === 'ingest').payload };
  };
  // ① 오늘 아직 수집이 없으면 버튼이어도 전체 수집 → 성공한 출처의 목록 지문을 기억
  let { report, ingest } = await run('button');
  assert.equal(report.state, 'success');
  assert.equal(report.unchanged_sources, undefined);
  assert.deepEqual(ingest.sources_ok.sort(), ['ok', 'test-promo']);
  assert.deepEqual(Object.keys(pageCache.lists).sort(), ['ok', 'test-promo']);
  // ② 오늘 수집이 있고 목록이 그대로면 두 곳 다 건너뜀: 시트에는 아무 출처도 성공으로 보내지 않아 기존 쿠폰·소식이 그대로
  lastChecked = new Date(NOW - 3600000).toISOString();
  ({ report, ingest } = await run('button'));
  assert.equal(report.state, 'success');
  assert.deepEqual(report.unchanged_sources.sort(), ['ok', 'test-promo']);
  assert.equal(report.sources.length, 0);
  assert.equal(report.pages, 0, '상세·AI 없음');
  assert.deepEqual([ingest.coupons.length, ingest.sources_ok.length], [0, 0]);
  // ③ 한 곳의 목록이 바뀌면 그 출처만 끝까지 수집
  pageCache.lists['test-promo'].key = 'old';
  ({ report, ingest } = await run('button'));
  assert.deepEqual(report.unchanged_sources, ['ok']);
  assert.deepEqual(report.sources.map((x) => x.id), ['test-promo']);
  assert.deepEqual(ingest.sources_ok, ['test-promo']);
  assert.equal(ingest.coupons.length, 3);
  assert.notEqual(pageCache.lists['test-promo'].key, 'old', '다시 수집한 목록을 기억');
  // ④ 예약 실행은 목록이 같아도 항상 전체
  ({ report } = await run('test'));
  assert.equal(report.unchanged_sources, undefined);
  assert.equal(report.sources.length, 2);
});

test('공지 배너 눌러 상세 열기 (11/10 버거킹 실제 구조): 이미지가 아니라 카드의 detail 버튼 → 상세 글자에서 공식 기간 · 이미지 없는 공지는 제목 낱말로', { timeout: 60000 }, async () => {
  clearRobotsCache();
  const { openBrowser, captureNoticeDetail } = await import('../src/fetch.js');
  const { officialReader } = await import('../src/official-period.js');
  const ctx = await openBrowser();
  try {
    const list = `${site.base}/period/bk.html`;
    const cap = await captureNoticeDetail(ctx, list, `${site.base}/period/banner.png?v=2`, { clickWaitMs: 300 });
    assert.equal(cap.moved, true);
    assert.match(cap.detailUrl, /bk-detail\.html$/);
    assert.ok(cap.banner && cap.banner.data.length > 10, '배너는 화면을 찍은 것(파일을 받지 않음)');
    const sources = new Map([['bk-event', { brand: '버거킹', url: list }], ['paik-event', { brand: '빽다방', url: list }]]);
    const read = officialReader({ capture: (u, img, words) => captureNoticeDetail(ctx, u, img, { words, clickWaitMs: 300 }), sources, llm: { provider: 'mock' }, now: new Date('2026-11-10T03:00:00Z') });
    const bk = { brand: '버거킹', title: '26년 11월 와퍼 3900원 프로모션', discount_label: '3900원', source_id: 'bk-event', source_url: list, image_url: `${site.base}/period/banner.png`, first_seen: '2026-11-08T15:23:18Z' };
    assert.deepEqual(await read(bk), { start: '2026-11-09', end: '2026-11-13', source: '공식 원문', quote: '' });
    const paik = { brand: '빽다방', title: '말차 전 메뉴 2,026원 프로모션', discount_label: '2,026원', source_id: 'paik-event', source_url: list, image_url: '', first_seen: '2026-11-05T00:00:00Z' };
    assert.deepEqual(await read(paik), { start: '2026-11-03', end: '2026-11-16', source: '공식 원문', quote: '' });
    // 글자가 이미지 대체텍스트에만 있고 이미지는 늦게 불러오는(data-src) 목록 (도미노)
    sources.set('dominos-event', { brand: '도미노피자', url: list });
    const dominos = { brand: '도미노피자', title: '도미노스데이 40% 할인', discount_label: '40%', source_id: 'dominos-event', source_url: list, image_url: '', first_seen: '2026-11-05T00:00:00Z' };
    assert.deepEqual(await read(dominos), { start: '2026-11-03', end: '2026-11-24', source: '공식 원문', quote: '' });
    assert.equal((await captureNoticeDetail(ctx, list, `${site.base}/period/dominos.jpg`, { clickWaitMs: 300 })).moved, true, 'data-src 주소로도 찾음');
  } finally { await ctx.close(); }
});
