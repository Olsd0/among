// Code.gs를 가짜 Apps Script 환경에서 실행해 수집기와 실제로 맞물리는지 확인
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAppsScript, sheetAdapter } from './gas-harness.js';
import { serveDir } from './helpers.js';
import { runCollector } from '../src/run.js';
import { normalizeAndValidate } from '../src/engine.js';
import { couponId, contentHash } from '../src/ids.js';
import { clearRobotsCache } from '../src/robots.js';

const CODE = new URL('../../apps-script/Code.gs', import.meta.url).pathname;
const T0 = Date.parse('2026-10-25T03:00:00Z'); // KST 12:00
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

function boot(now = T0) {
  const gas = loadAppsScript(CODE, { now });
  gas.ctx.setup();
  const token = gas.props.get('COLLECTOR_TOKEN');
  const admin = gas.props.get('ADMIN_TOKEN');
  return { gas, token, admin, sheet: sheetAdapter(gas, token) };
}

function coupon(over = {}, now = new Date(T0)) {
  const c = normalizeAndValidate({
    menu: '불고기버거 세트', item_type: '세트', regular_price: 8000, coupon_price: 5500, discount_type: 'price',
    channels: ['매장', '픽업'], audience: '전체', end_date: '2026-10-31', confidence: 0.95, ...over,
  }, { now, brand: over.brand || '맥도날드', category: '햄버거', sourceId: over.source_id || 'mcd', sourceUrl: 'https://example.com' });
  c.id = couponId(c); c.hash = contentHash(c); c.checked_at = now.toISOString();
  return c;
}

let site;
before(async () => { site = await serveDir(new URL('./fixtures/site', import.meta.url).pathname); });
after(async () => { await site.close(); });

test('setup: 탭·머리글·토큰 생성', () => {
  const { gas, token, admin } = boot();
  for (const n of ['coupons', 'sources', 'run_log', 'events', 'reports']) assert.ok(gas.sheet(n), n);
  assert.equal(gas.sheet('coupons').data[0][0], 'id');
  assert.ok(token.length >= 32 && admin.length >= 32 && token !== admin);
});

test('수집기 → 시트 → 공개 API 종단: 게시·확인시각·상태', { timeout: 120000 }, async () => {
  clearRobotsCache();
  const { gas, sheet } = boot();
  const sources = [{ id: 'test-promo', brand: '테스트버거', category: '햄버거', url: `${site.base}/promo/list.html`, selector: 'main', follow: 'a.event-link' }];
  const report = await runCollector({ env: { MOCK_CLAUDE: '1', OUT_DIR: mkdtempSync(join(tmpdir(), 'among-gas-')), TRIGGER: 'schedule' }, now: new Date(T0), sources, sheet, quiet: true });
  assert.equal(report.state, 'success');
  assert.deepEqual(report.ingest, { inserted: 3, updated: 0, unchanged: 0, gone: 0, expired: 0, news: { inserted: 0, updated: 0, unchanged: 0, gone: 0, expired: 0 } });

  const pub = gas.get({ action: 'coupons' });
  assert.equal(pub.ok, true);
  assert.equal(pub.count, 3);
  const cheese = pub.coupons.find((c) => c.menu === '치즈버거 세트');
  assert.equal(cheese.coupon_price, 5900);
  assert.equal(cheese.app_only, true);
  assert.deepEqual(cheese.channels, ['매장']);
  assert.ok(!('evidence' in cheese) && !('confidence' in cheese), '내부 필드는 공개하지 않음');
  assert.ok(pub.last_checked_at);

  const st = gas.get({ action: 'status' });
  assert.equal(st.state, 'idle');
  assert.equal(st.last_state, 'success');
  assert.equal(gas.sheet('run_log').objects()[0].published, '3');
});

test('ingest: 변경·유지·사라짐·실패 출처 보존·숨김 유지·만료', () => {
  const { gas, sheet, token } = boot();
  const a = coupon();
  const b = coupon({ menu: '치즈버거 세트', coupon_price: 5900, regular_price: 8100 });
  const k = coupon({ menu: '와퍼 세트', brand: '버거킹', source_id: 'bk', coupon_price: 6900, regular_price: 9900 });
  const h = coupon({ menu: '숨긴 세트', coupon_price: 3000 });
  let r = gas.post({ action: 'ingest', token, run_id: 'r1', coupons: [a, b, k, h], sources_ok: ['mcd', 'bk'] });
  assert.deepEqual(r.result, { inserted: 4, updated: 0, unchanged: 0, gone: 0, expired: 0 });

  // 팀원이 잘못된 쿠폰을 숨김 처리
  const rows = gas.sheet('coupons');
  const hi = rows.data.findIndex((row) => row[0] === h.id);
  rows.data[hi][1] = 'hidden';

  // 다음 날: a 가격 변경, b 사라짐, 버거킹 출처 실패(k 미수집), h 다시 수집됨
  gas.clock.now = T0 + DAY;
  const a2 = coupon({ coupon_price: 5300 }, new Date(T0 + DAY));
  const h2 = coupon({ menu: '숨긴 세트', coupon_price: 3000 }, new Date(T0 + DAY));
  r = gas.post({ action: 'ingest', token, run_id: 'r2', coupons: [a2, h2], sources_ok: ['mcd'] });
  assert.deepEqual(r.result, { inserted: 0, updated: 1, unchanged: 1, gone: 1, expired: 0 });
  const byMenu = Object.fromEntries(gas.sheet('coupons').objects().map((o) => [o.menu, o]));
  assert.equal(byMenu['불고기버거 세트'].coupon_price, '5300');
  assert.equal(byMenu['불고기버거 세트'].first_seen, new Date(T0).toISOString(), 'first_seen 유지');
  assert.equal(byMenu['치즈버거 세트'].status, 'gone');
  assert.equal(byMenu['와퍼 세트'].status, 'published', '실패한 출처의 쿠폰은 그대로');
  assert.equal(byMenu['숨긴 세트'].status, 'hidden', '숨김은 자동으로 되살리지 않음');

  // 11/1: 종료일(10/31) 지남 → 만료, 공개 목록에서 빠짐
  gas.clock.now = T0 + 7 * DAY;
  r = gas.post({ action: 'ingest', token, run_id: 'r3', coupons: [], sources_ok: [] });
  assert.equal(r.result.expired, 3);
  assert.equal(gas.get({ action: 'coupons' }).count, 0);

  // 잘못된 토큰
  assert.equal(gas.post({ action: 'ingest', token: 'x', coupons: [] }).error, 'unauthorized');
});

test('즉시 갱신 버튼: 워크플로 호출 · 실행 중 거절 · 10분 쿨다운', () => {
  const { gas, token } = boot();
  gas.props.set('GITHUB_TOKEN', 'ghp_test');
  gas.props.set('GITHUB_REPO', 'among-kr/among');

  let r = gas.post({ action: 'refresh' });
  assert.equal(r.accepted, true);
  assert.equal(gas.fetches.length, 1);
  assert.equal(gas.fetches[0].url, 'https://api.github.com/repos/among-kr/among/actions/workflows/collect.yml/dispatches');
  assert.deepEqual(JSON.parse(gas.fetches[0].opts.payload), { ref: 'main', inputs: { trigger: 'button' } });
  assert.equal(gas.get({ action: 'status' }).state, 'queued');

  r = gas.post({ action: 'refresh' });
  assert.equal(r.accepted, false);
  assert.equal(r.reason, 'queued');

  gas.post({ action: 'run_start', token, run_id: 'r1' });
  assert.equal(gas.post({ action: 'refresh' }).reason, 'running');
  gas.clock.now += 3 * MIN;
  gas.post({ action: 'run_finish', token, report: { run_id: 'r1', state: 'success', finished_at: new Date(gas.clock.now).toISOString(), summary: {}, sources: [] } });

  r = gas.post({ action: 'refresh' });
  assert.equal(r.reason, 'cooldown');
  assert.ok(r.retry_after_s > 0 && r.retry_after_s <= 600);
  assert.equal(gas.fetches.length, 1, '쿨다운 중에는 호출하지 않음');

  gas.clock.now += 11 * MIN;
  assert.equal(gas.post({ action: 'refresh' }).accepted, true);
  assert.equal(gas.fetches.length, 2);

  // 실행이 멈춘 채 30분이 지나면 다시 받을 수 있다
  gas.clock.now += 31 * MIN;
  assert.equal(gas.get({ action: 'status' }).state, 'idle');

  // GitHub 오류는 그대로 알려준다
  gas.clock.now += 11 * MIN;
  gas.setFetchResponse(404, 'Not Found');
  r = gas.post({ action: 'refresh' });
  assert.equal(r.ok, false);
  assert.match(r.error, /GitHub 404/);
});

test('이용 기록·제보 → 지표 (이동률 · 2개 브랜드 비교율 · 7일 재방문율)', () => {
  const { gas, admin } = boot(T0 - 10 * DAY);
  const ev = (sid, type, brand = '', coupon_id = '') => gas.post({ action: 'event', sid, type, brand, coupon_id });
  // 10/15: s1, s2 첫 방문
  ev('s1', 'visit'); ev('s1', 'detail', '맥도날드'); ev('s1', 'click', '버거킹');
  ev('s2', 'visit'); ev('s2', 'detail', '맥도날드');
  // 10/18: s1 재방문
  gas.clock.now = T0 - 7 * DAY; ev('s1', 'visit');
  // 10/25: s3 첫 방문, 클릭
  gas.clock.now = T0; ev('s3', 'visit'); ev('s3', 'click', '롯데리아');
  assert.equal(gas.post({ action: 'event', sid: 's3', type: 'hack' }).ok, false);
  gas.post({ action: 'report', sid: 's3', coupon_id: 'c_1', reason: '가격이 달라요', memo: '앱에선 5,900원' });
  gas.post({ action: 'report', sid: 's3', coupon_id: 'c_2', reason: '<script>' });

  assert.equal(gas.post({ action: 'metrics', token: 'wrong' }).error, 'unauthorized');
  const m = gas.post({ action: 'metrics', token: admin, days: 30 });
  assert.equal(m.ok, true);
  assert.equal(m.usage.visitors, 3);
  assert.equal(m.usage.sessions, 4);                   // s1×2일, s2, s3
  assert.equal(m.usage.click_session_rate, 0.5);       // s1(10/15), s3
  assert.equal(m.usage.multi_brand_rate, 0.333);       // s1(10/15)만 2개 브랜드
  assert.equal(m.usage.retention_7d_base, 2);          // s1, s2 (첫 방문 7일 이상 경과)
  assert.equal(m.usage.retention_7d, 0.5);             // s1만 재방문
  assert.equal(m.reports.total, 2);
  assert.equal(m.reports.recent[0].reason, '기타', '허용 목록 밖 사유는 기타로');
  assert.equal(m.usage.daily.length, 30);
});

test('setup의 출처 초기값 = collector/sources.example.json', () => {
  const { gas } = boot();
  const fromSheet = gas.sheet('sources').objects().map((o) => o.id);
  const json = JSON.parse(readFileSync(new URL('../sources.example.json', import.meta.url), 'utf8')).sources;
  assert.deepEqual(fromSheet, json.map((s) => s.id));
  const mcd = gas.sheet('sources').objects()[0];
  assert.equal(mcd.follow, json[0].follow);
  assert.equal(mcd.max_follow, String(json[0].max_follow));
});
