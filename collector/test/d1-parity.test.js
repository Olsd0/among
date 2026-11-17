// 시트 쪽 백엔드(Code.gs)와 D1 백엔드(server/core.js)에 같은 수집 결과를 넣으면 같은 공개 응답이 나와야 한다.
// 내보내기(export) → 가져오기(import)를 거쳐도 같아야 한다 (docs/d1-migration.md 3·4단계의 검사)
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadAppsScript } from './gas-harness.js';
import { fakeD1 } from './d1-fake.js';
import { ingest, runFinish, publicCoupons, importSheet } from '../../server/core.js';
import { comparePublic } from '../scripts/d1-import.js';

const CODE = fileURLToPath(new URL('../../apps-script/Code.gs', import.meta.url));
const T0 = Date.parse('2026-11-17T01:00:00Z');
const DAY = 86400e3;
const C = (id, o = {}) => ({ id, status: 'published', brand: 'A버거', category: '햄버거', menu: '와퍼 ' + id, item_type: '단품', regular_price: 7900, coupon_price: 3900, discount_rate: 51, discount_type: 'price', discount_value: 3900, max_discount: null, min_order: null, channels: ['매장', '픽업'], audience: '전체', app_only: true, start_date: '2026-11-10', end_date: '2026-11-30', conditions: '1인 1회', confidence: 0.9, issues: [], evidence: '와퍼 3,900원', source_id: 'bk-event', source_url: 'https://a.test/e', official_link: 'https://a.test/', hash: 'h-' + id, programs: ['KT'], program_note: '', how_to_use: '', stackable: '', image_url: '', ...o });
const N = (id, o = {}) => ({ id, status: 'published', brand: 'A버거', category: '햄버거', title: '와퍼 행사 ' + id, summary: '11월 한 달 와퍼 3,900원', discount_label: '3,900원', start_date: '2026-11-10', end_date: '2026-11-30', programs: [], image_url: 'https://a.test/p.jpg', related_ids: ['c1'], evidence: '', issues: [], confidence: 0.9, source_id: 'bk-event', source_url: 'https://a.test/e', official_link: 'https://a.test/', hash: 'n-' + id, ...o });

// 사흘치 수집: 새로 생김 → 바뀜·사라짐·출처 실패 → 종료일 지남
const DAYS = [
  { sources_ok: ['bk-event', 'mcd-promo'], coupons: [C('c1'), C('c2', { end_date: '2026-11-18' }), C('c3', { status: 'pending' }), C('m1', { source_id: 'mcd-promo', brand: 'M버거', end_date: '', discount_type: 'percent', coupon_price: null, discount_value: 20, discount_rate: 20, app_only: false, channels: [] })], news: [N('n1'), N('n2', { end_date: '' }), N('nm', { source_id: 'mcd-promo', brand: 'M버거' })] },
  { sources_ok: ['bk-event'], coupons: [C('c1', { coupon_price: 4500, hash: 'h-c1b' }), C('c3')], news: [N('n1', { summary: '와퍼 4,500원', hash: 'n-n1b' })] },
  { sources_ok: ['bk-event', 'mcd-promo'], coupons: [C('c1', { coupon_price: 4500, hash: 'h-c1b' }), C('c3'), C('c4'), C('m1', { source_id: 'mcd-promo', brand: 'M버거', end_date: '', hash: 'h-m1' })], news: [N('n1', { summary: '와퍼 4,500원', hash: 'n-n1b' }), N('n3')] },
];

async function both() {
  const gas = loadAppsScript(CODE, { now: T0 });
  gas.ctx.setup();
  const token = gas.props.get('COLLECTOR_TOKEN');
  const db = fakeD1();
  const results = [];
  for (let i = 0; i < DAYS.length; i++) {
    const now = T0 + i * DAY;
    gas.clock.now = now;
    const body = { run_id: 'r' + i, checked_at: new Date(now).toISOString(), ...DAYS[i] };
    const rep = { run_id: 'r' + i, state: 'success', finished_at: new Date(now + 60e3).toISOString(), summary: {}, sources: [] };
    const g = gas.post({ action: 'ingest', token, ...structuredClone(body) });
    gas.post({ action: 'run_finish', token, report: rep });
    const d = await ingest(db, structuredClone(body), { now });
    await runFinish(db, rep, { now });
    results.push([g.result, d]);
    const sheetOut = JSON.parse(gas.ctx.doGet({ parameter: { action: 'coupons' } }).content);
    const d1Out = JSON.parse(await publicCoupons(db, { now }));
    assert.deepEqual(comparePublic(sheetOut, d1Out), [], `${i + 1}일차 공개 응답`);
    assert.equal(sheetOut.today, d1Out.today);
    assert.equal(sheetOut.count, d1Out.count);
  }
  return { gas, token, db, results };
}

test('같은 사흘치 수집 → 시트 쪽과 D1의 공개 응답·반영 건수가 같다', async () => {
  const { results } = await both();
  for (const [g, d] of results) {
    for (const k of ['inserted', 'updated', 'unchanged', 'gone']) {
      assert.equal(d[k], g[k], `쿠폰 ${k}`);
      assert.equal(d.news[k], g.news[k], `공지 ${k}`);
    }
  }
});

test('시트 내보내기 → D1 가져오기를 거쳐도 공개 응답이 같고, 토큰은 내보내지 않는다', async () => {
  const { gas, token } = await both();
  const now = T0 + 2 * DAY;
  assert.equal(gas.post({ action: 'export' }).error, 'unauthorized');
  assert.equal(gas.post({ action: 'export', token: gas.props.get('ADMIN_TOKEN') }).error, 'unauthorized');
  const dump = gas.post({ action: 'export', token });
  assert.deepEqual(Object.keys(dump.tables).sort(), ['coupons', 'news', 'run_log', 'sources']);
  const text = JSON.stringify(dump);
  assert.ok(!text.includes(token) && !text.includes(gas.props.get('ADMIN_TOKEN')), '토큰이 응답에 없다');
  const fresh = fakeD1();
  const r = await importSheet(fresh, JSON.parse(text), { now });
  assert.equal(r.coupons, dump.tables.coupons.length);
  assert.ok(r.sources > 0);
  const sheetOut = JSON.parse(gas.ctx.doGet({ parameter: { action: 'coupons' } }).content);
  assert.deepEqual(comparePublic(sheetOut, JSON.parse(await publicCoupons(fresh, { now }))), []);
  // 가져온 DB에 다음 날 수집을 이어서 넣어도 시트 쪽과 같다
  const next = { run_id: 'r9', checked_at: new Date(now + DAY).toISOString(), sources_ok: ['bk-event'], coupons: [C('c4', { menu: '바뀐 와퍼', hash: 'h-c4b' })], news: [] };
  gas.clock.now = now + DAY;
  const g = gas.post({ action: 'ingest', token, ...structuredClone(next) }).result;
  const d = await ingest(fresh, structuredClone(next), { now: now + DAY });
  assert.deepEqual([d.inserted, d.updated, d.unchanged, d.gone], [g.inserted, g.updated, g.unchanged, g.gone]);
  assert.deepEqual(comparePublic(JSON.parse(gas.ctx.doGet({ parameter: { action: 'coupons' } }).content), JSON.parse(await publicCoupons(fresh, { now: now + DAY }))), []);
});

test('비교기는 다른 점을 잡아낸다', () => {
  const a = { last_checked_at: 'x', coupons: [{ id: 'c1', menu: '와퍼', channels: ['매장'] }, { id: 'c2', menu: 'b' }], news: [] };
  const b = { last_checked_at: 'y', coupons: [{ id: 'c1', menu: '와퍼2', channels: ['매장'] }, { id: 'c3', menu: 'b' }], news: [] };
  assert.deepEqual(comparePublic(a, b), ['coupons c1: menu 다름', 'coupons c2: D1에 없음', 'coupons c3: 시트 응답에 없음', 'last_checked_at 다름']);
});
