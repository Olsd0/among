// 종단 테스트: 가상 공식 페이지 → Playwright 렌더링 → (모의) 추출 → 엔진 → 시트 반영
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveDir } from './helpers.js';
import { runCollector } from '../src/run.js';
import { clearRobotsCache } from '../src/robots.js';

const NOW = new Date('2026-10-25T03:00:00Z');
let site;

before(async () => { site = await serveDir(new URL('./fixtures/site', import.meta.url).pathname); });
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
