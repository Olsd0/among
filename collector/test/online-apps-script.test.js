// 온라인 특가 전체 경로 모의 검증: 실행기(run.js) → Apps Script(Code.gs, Node 가짜 환경) → 공개 API
// 공급처는 테스트 안의 가짜 어댑터·가짜 네트워크다. 실제 공급처 연결을 검증하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAppsScript } from './gas-harness.js';
import { runOnlineDeals } from '../src/online/run.js';
import { ADAPTERS } from '../src/online/suppliers.js';
import { createHttpClient } from '../src/online/http.js';
import { candidate, mixedBatch, OD_T0, MIN, HOUR } from './online-fixtures.js';

const CODE = new URL('../../apps-script/Code.gs', import.meta.url).pathname;
const SECRET = 'SECRET-VALUE-do-not-log-123';
const ENV = { COUPANG_PARTNERS_ACCESS_KEY: SECRET, COUPANG_PARTNERS_SECRET_KEY: SECRET + '-2' };

function boot() {
  const gas = loadAppsScript(CODE, { now: OD_T0 });
  gas.ctx.setup();
  const token = gas.props.get('COLLECTOR_TOKEN'), admin = gas.props.get('ADMIN_TOKEN');
  const sent = [];
  const api = {
    async post(action, payload) {
      sent.push({ action, payload });
      const r = gas.post({ ...payload, action, token });
      if (!r.ok) throw new Error(`시트 ${action} 실패: ${r.error}`);
      return r;
    },
  };
  const adminSet = body => gas.post({ action: 'online_admin_set', token: admin, ...body });
  const adminGet = () => gas.post({ action: 'online_admin', token: admin });
  return { gas, token, admin, api, sent, adminSet, adminGet };
}

/** 가짜 공급처: 실제 http.js 규칙을 그대로 쓰고, 네트워크만 가짜 */
function mockSupplier(responses) {
  const net = { calls: 0, headers: [] };
  const fetchImpl = async (url, init) => {
    const step = responses[Math.min(net.calls, responses.length - 1)];
    net.calls++;
    net.headers.push(init.headers || {});
    if (step.throw) throw new Error('ECONNRESET ' + url);
    return new Response(JSON.stringify(step.body ?? { items: [] }), { status: step.status ?? 200, headers: step.headers || {} });
  };
  const adapters = {
    ...ADAPTERS,
    coupang: {
      ...ADAPTERS.coupang, apiHosts: ['api.mock.test'], http: { minIntervalMs: 0, maxRetries: 0 },
      async fetch({ http, env }) {
        const res = await http.request('https://api.mock.test/deals', { headers: { authorization: 'mock ' + env.COUPANG_PARTNERS_ACCESS_KEY } });
        return { items: res.json().items };
      },
    },
  };
  const httpFactory = opts => createHttpClient({ ...opts, fetchImpl, sleep: async () => {}, random: () => 0 });
  return { net, adapters, httpFactory };
}
const run = (b, m, extra = {}) => runOnlineDeals({ api: b.api, adapters: m?.adapters, httpFactory: m?.httpFactory, env: ENV, now: () => b.gas.clock.now, ...extra });
const pub = b => b.gas.get({ action: 'online_deals' });
const later = (b, ms) => { b.gas.clock.now += ms; b.gas.cache.clear(); };

test('실제 상태: 승인된 공급처가 없으면 아무 데도 호출하지 않고 "승인 대기"만 기록, 공개 목록은 빈 준비 중', async () => {
  const b = boot();
  const out = await run(b, null, { env: {} });
  assert.deepEqual(out.results.map(r => [r.supplier, r.result]), [['coupang', 'awaiting_access'], ['linkprice', 'awaiting_access']]);
  assert.deepEqual(b.sent.map(s => s.action), ['online_run_start', 'online_run_finish']);
  const p = pub(b);
  assert.deepEqual({ state: p.state, count: p.count, items: p.items, disclosures: p.disclosures }, { state: 'preparing', count: 0, items: [], disclosures: [] });
  const runs = b.gas.sheet('online_runs').objects();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].results, 'coupang:awaiting_access linkprice:awaiting_access');
  const adm = b.adminGet();
  assert.deepEqual(adm.suppliers.map(s => [s.id, s.mode, s.lastResult]), [['coupang', 'observe', 'awaiting_access'], ['linkprice', 'observe', 'awaiting_access']]);
  assert.equal(b.gas.props.get('ONLINE_RUN_LOCK'), '', '잠금 해제');
  // 프랜차이즈 쿠폰 탭은 건드리지 않음
  assert.equal(b.gas.sheet('coupons').objects().length, 0);
  assert.equal(b.gas.get({ action: 'coupons' }).coupons.length, 0);
});

test('관찰 모드 → 자동 게시: 처음엔 비공개로 모으고, 운영자가 켜면 검증을 통과한 것만 공개', async () => {
  const b = boot();
  const m = mockSupplier([{ body: { items: mixedBatch() } }]);
  const out = await run(b, m);
  assert.equal(out.results[0].result, 'ok');
  assert.equal(out.results[0].received, 7);
  assert.deepEqual(out.results[0].counts, { published: 0, held: 7, scheduled: 0, stale: 0, ended: 0, hidden: 0 });
  assert.equal(pub(b).count, 0, '관찰 모드는 공개하지 않음');
  const held = b.adminGet().items;
  assert.ok(held.every(i => i.holds.includes('SUPPLIER_OBSERVE')));
  const r = b.adminSet({ op: 'supplier_mode', supplier: 'coupang', mode: 'publish' });
  assert.equal(r.ok, true);
  const p = pub(b);
  assert.equal(p.state, 'live');
  assert.deepEqual(p.items.map(i => i.title).sort(), ['테스트 생수 2L', '테스트 화장지 30롤']);
  assert.deepEqual(p.disclosures, ['이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.']);
  const water = p.items.find(i => i.title === '테스트 생수 2L');
  assert.equal(water.shipping, 'unknown');
  assert.equal(water.imageUrl, '', '사진 이용 범위 확인 전');
  assert.equal(water.visibleUntil, new Date(OD_T0 + 6 * HOUR).toISOString());
  const holds = Object.fromEntries(b.adminGet().items.filter(i => i.status === 'held').map(i => [i.title, i.holds]));
  assert.deepEqual(holds, {
    '테스트 쌀': ['PRICE_NOT_TOTAL'], '테스트 라면': ['SELLER_UNKNOWN'], '테스트 커피': ['BAD_LINK'],
    '테스트 냉동고': ['CATEGORY_UNMAPPED'], '테스트 우유': ['CONDITION_UNCLEAR'],
  });
  const json = JSON.stringify(p);
  for (const leak of ['holds', 'hidden', 'OK-WATER', 'supplierItemId', 'payload', 'categoryPath']) assert.ok(!json.includes(leak), leak);
});

test('실패·빈 응답·호출 제한: 기존 상품을 지우지 않고, 연속 실패와 429는 공급처만 일시 중지', async () => {
  const b = boot();
  b.adminSet({ op: 'supplier_mode', supplier: 'coupang', mode: 'publish' });
  const m = mockSupplier([
    { body: { items: mixedBatch() } },
    { status: 500 }, { body: { items: [] } }, { throw: true }, { status: 500 }, { status: 500 },
    { status: 429, headers: { 'retry-after': '7200' } },
  ]);
  await run(b, m);
  assert.equal(pub(b).count, 2);
  const step = async expect => { later(b, 31 * MIN); const out = await run(b, m); assert.equal(out.results[0].result, expect); assert.equal(pub(b).count, 2, `${expect} 뒤에도 상품 유지`); return out; };
  await step('failed');
  await step('empty');
  const third = await step('failed');
  assert.equal(third.results[0].error, 'network_error', '오류 문구에 주소·키 없음');
  const st = () => b.adminGet().suppliers[0];
  assert.equal(st().failures, 1, '빈 응답은 실패로 세지 않고 연속 실패 수를 초기화');
  await step('failed');
  assert.equal(st().pauseUntil, '', '2회까지는 다음 예약 실행에 다시 시도');
  await step('failed');
  assert.equal(st().failures, 3);
  assert.equal(st().pauseUntil, new Date(b.gas.clock.now + 15 * MIN).toISOString(), '연속 3회 실패 → 15분 일시 중지');
  const calls = m.net.calls;
  later(b, 5 * MIN);
  assert.equal((await run(b, m)).results[0].result, 'paused');
  assert.equal(m.net.calls, calls, '중지 중에는 호출하지 않음');
  b.adminSet({ op: 'supplier_resume', supplier: 'coupang' });
  later(b, 30 * MIN);
  const limited = await run(b, m);
  assert.equal(limited.results[0].result, 'rate_limited');
  assert.equal(st().pauseUntil, new Date(b.gas.clock.now + 2 * HOUR).toISOString(), 'Retry-After 2시간');
  assert.equal(pub(b).count, 2, '호출 제한도 상품을 지우지 않음');
  b.gas.clock.now = OD_T0 + 6 * HOUR;
  b.gas.cache.clear();
  assert.equal(pub(b).count, 0, '마지막 성공 수신 + 6시간이 지나면 자동으로 내려감 (삭제는 아님)');
  assert.equal(b.adminGet().counts.stale, 7, '보류 상품도 기한이 지나면 재확인 대상');
});

test('재확인 기한·행사 종료: 새 수집 없이도 기한이 지나면 공개 목록에서 빠지고, 다시 받으면 돌아온다', async () => {
  const b = boot();
  b.adminSet({ op: 'supplier_mode', supplier: 'coupang', mode: 'publish' });
  const batch = () => [candidate({ observedAt: new Date(b.gas.clock.now).toISOString() }),
    candidate({ supplierItemId: 'ENDS', title: '오늘 끝나는 상품', endsAt: new Date(OD_T0 + 2 * HOUR).toISOString(), observedAt: new Date(b.gas.clock.now).toISOString() })];
  const m = mockSupplier([{ body: { items: batch() } }]);
  await run(b, m);
  assert.equal(pub(b).count, 2);
  assert.equal(pub(b).items[0].title, '오늘 끝나는 상품', '종료가 가까운 순');
  assert.equal(pub(b).items[0].endsAt, new Date(OD_T0 + 2 * HOUR).toISOString());
  later(b, 2 * HOUR);
  assert.deepEqual(pub(b).items.map(i => i.title), ['테스트 생수 2L']);
  later(b, 4 * HOUR);
  assert.equal(pub(b).count, 0);
  const statuses = Object.fromEntries(b.adminGet().items.map(i => [i.title, i.status]));
  assert.deepEqual(statuses, { '테스트 생수 2L': 'stale', '오늘 끝나는 상품': 'ended' });
  const m2 = mockSupplier([{ body: { items: [candidate({ observedAt: new Date(b.gas.clock.now).toISOString() })] } }]);
  await run(b, m2);
  assert.equal(pub(b).count, 1);
});

test('운영자: 숨김은 다시 받아도 유지, 규칙 변경은 다음 조회부터 바로 반영, 분류 지정', async () => {
  const b = boot();
  b.adminSet({ op: 'supplier_mode', supplier: 'coupang', mode: 'publish' });
  const m = mockSupplier([{ body: { items: mixedBatch() } }]);
  await run(b, m);
  const water = pub(b).items.find(i => i.title === '테스트 생수 2L');
  const hid = b.adminSet({ op: 'hide', id: water.id, reason: '=HYPERLINK("x") 설명과 다름' });
  assert.equal(hid.items.find(i => i.id === water.id).status, 'hidden');
  assert.equal(pub(b).count, 1);
  assert.ok(b.gas.sheet('online_items').objects().find(r => r.id === water.id).hidden_reason.startsWith("'="), '시트 수식 무력화');
  later(b, 31 * MIN);
  await run(b, mockSupplier([{ body: { items: mixedBatch(new Date(b.gas.clock.now).toISOString()) } }]));
  assert.equal(pub(b).items.some(i => i.id === water.id), false, '다시 받아도 숨김 유지');
  b.adminSet({ op: 'unhide', id: water.id });
  assert.equal(pub(b).count, 2);
  b.adminSet({ op: 'rules', rules: { ...b.adminGet().rules, excludeKeywords: ['화장지'] } });
  assert.deepEqual(pub(b).items.map(i => i.title), ['테스트 생수 2L']);
  const freezer = b.adminGet().items.find(i => i.title === '테스트 냉동고');
  b.adminSet({ op: 'category', id: freezer.id, category: 'household', until: new Date(b.gas.clock.now + HOUR).toISOString() });
  assert.ok(pub(b).items.some(i => i.title === '테스트 냉동고'));
  later(b, HOUR);
  assert.ok(!pub(b).items.some(i => i.title === '테스트 냉동고'), '지정 기한이 지나면 규칙으로 돌아감');
  for (const bad of [{ op: 'hide', id: 'od_nope' }, { op: 'category', id: freezer.id, category: 'weapons' }, { op: 'supplier_mode', supplier: 'coupang', mode: 'yolo' }, { op: 'drop_table' }]) {
    assert.equal(b.adminSet(bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(b.adminSet({ op: 'rules', rules: { maxItems: 9999, includeCategories: ['x'] } }).rules.maxItems, 30);
});

test('동시 실행 방지·잠금 만료·오래된 결과 거절', async () => {
  const b = boot();
  const first = await b.api.post('online_run_start', { run_id: 'odr_aaaaaaaaaaaaaaaa', trigger: 'schedule' });
  assert.equal(first.busy, undefined);
  const out = await run(b, null);
  assert.equal(out.skipped, 'busy', '실행 중이면 건너뜀');
  assert.equal(b.gas.post({ action: 'online_ingest', token: b.token, run_id: 'odr_bbbbbbbbbbbbbbbb', supplier: 'coupang', ok: true, items: [], observed_at: new Date(OD_T0).toISOString() }).error, 'run_not_active');
  assert.equal(b.gas.post({ action: 'online_ingest', token: b.token, run_id: 'odr_aaaaaaaaaaaaaaaa', supplier: 'coupang', ok: true, items: [candidate()], observed_at: new Date(OD_T0 - 2 * HOUR).toISOString() }).error, 'stale payload');
  assert.equal(b.gas.post({ action: 'online_ingest', token: b.token, run_id: 'odr_aaaaaaaaaaaaaaaa', supplier: 'nope', ok: true, items: [] }).error, 'unknown supplier');
  assert.equal(b.gas.post({ action: 'online_run_start', token: b.token, run_id: '../../x' }).error, 'bad run_id');
  later(b, 21 * MIN);
  const after = await run(b, null);
  assert.equal(after.skipped, undefined, '멈춘 실행의 잠금은 20분 뒤 풀림');
});

test('보안: 토큰 없이 쓰기 불가, 수집기 토큰으로 관리 불가, 비밀값은 시트·응답·기록 어디에도 없음', async () => {
  const b = boot();
  for (const action of ['online_run_start', 'online_ingest', 'online_run_finish', 'online_admin', 'online_admin_set']) {
    assert.equal(b.gas.post({ action, run_id: 'odr_aaaaaaaaaaaaaaaa' }).error, 'unauthorized', action);
  }
  for (const action of ['online_admin', 'online_admin_set']) assert.equal(b.gas.post({ action, token: b.token, op: 'rules' }).error, 'unauthorized');
  assert.equal(b.gas.post({ action: 'online_run_start', token: b.admin, run_id: 'odr_aaaaaaaaaaaaaaaa' }).error, 'unauthorized');
  b.adminSet({ op: 'supplier_mode', supplier: 'coupang', mode: 'publish' });
  const logs = [];
  const m = mockSupplier([{ body: { items: mixedBatch() } }]);
  await run(b, m, { log: x => logs.push(x) });
  assert.equal(m.net.headers[0].authorization, 'mock ' + SECRET, '키는 공급처 요청에만');
  const everywhere = JSON.stringify([b.sent, logs, [...b.gas.sheets.values()].map(s => s.data), [...b.gas.props.entries()].filter(([k]) => k.startsWith('ONLINE')), pub(b), b.adminGet()]);
  assert.ok(!everywhere.includes(SECRET), '비밀값 유출 없음');
  // 키가 없으면 호출하지 않음
  const nokey = await run(b, m, { env: {} });
  assert.equal(nokey.results[0].result, 'missing_secrets');
});

test('관리자 다시 실행: 온라인 특가 워크플로만 호출, 10분 재요청 제한', () => {
  const b = boot();
  b.gas.props.set('GITHUB_TOKEN', 'github_pat_test'); b.gas.props.set('GITHUB_REPO', 'owner/repo');
  b.gas.setFetchResponse(204);
  assert.equal(b.adminSet({ op: 'rerun' }).ok, true);
  assert.match(b.gas.fetches[0].url, /\/actions\/workflows\/online-deals\.yml\/dispatches$/);
  assert.equal(JSON.parse(b.gas.fetches[0].opts.payload).inputs.trigger, 'admin');
  assert.match(b.adminSet({ op: 'rerun' }).error, /10분/);
  later(b, 11 * MIN);
  b.gas.setFetchResponse(403, 'forbidden');
  assert.match(b.adminSet({ op: 'rerun' }).error, /GitHub 403/);
});

test('보관: 실행 기록은 최근 것만, 7일간 다시 받지 못한 상품은 정리', async () => {
  const b = boot();
  const m = mockSupplier([{ body: { items: [candidate()] } }]);
  await run(b, m);
  assert.equal(b.gas.sheet('online_items').objects().length, 1);
  later(b, 8 * 24 * HOUR);
  await run(b, mockSupplier([{ body: { items: [candidate({ supplierItemId: 'NEXT', title: '다음 상품', observedAt: new Date(b.gas.clock.now).toISOString() })] } }]));
  assert.deepEqual(b.gas.sheet('online_items').objects().map(r => r.title), ['다음 상품']);
  for (let i = 0; i < 620; i++) b.gas.ctx.appendRow_('online_runs', { run_id: 'odr_' + String(i).padStart(16, '0') });
  later(b, 31 * MIN);
  await run(b, null);
  assert.ok(b.gas.sheet('online_runs').objects().length <= 500);
});

test('직접 고른 쿠팡 특가: 관리 토큰으로 등록·수정·숨김·삭제, 공개 응답엔 메모 없이, 가격 카드는 확인 후 24시간만', async () => {
  const b = boot();
  const save = pick => b.adminSet({ op: 'pick_save', pick });
  const bad = save({ title: '테스트 생수', url: 'https://www.coupang.com/vp/products/1', category: 'food' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /간편 링크/);
  const r = save({ title: '=HYPERLINK("x") 테스트 생수', url: 'https://link.coupang.com/a/abcDEF123', category: 'food', note: '와우회원 가격', price: '7900', memo: '에펨코리아 핫딜 11/5' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.picks.length, 1);
  const id = r.picks[0].id;
  assert.match(id, /^pk_[0-9a-f]{16}$/);
  assert.ok(b.gas.sheet('online_picks').objects()[0].title.startsWith("'="), '시트 수식 무력화');
  let pub = pub_(b);
  assert.equal(pub.picks.length, 1);
  assert.equal(pub.picks[0].title, '=HYPERLINK("x") 테스트 생수');
  assert.equal(pub.picks[0].price, 7900);
  assert.ok(!JSON.stringify(pub).includes('에펨코리아'), '출처 메모 비공개');
  assert.deepEqual(pub.disclosures, ['이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.']);
  assert.equal(pub.picks[0].visibleUntil, new Date(OD_T0 + 24 * HOUR).toISOString(), '기본 노출은 하루, 가격 확인 24시간과 같음');
  later(b, 23 * HOUR);
  assert.equal(pub_(b).picks[0].price, 7900, '23시간 뒤에는 그대로');
  save({ id, title: '테스트 생수', url: 'https://link.coupang.com/a/abcDEF123', category: 'food', price: '7900', endsAt: new Date(OD_T0 + 5 * 24 * HOUR).toISOString() });
  later(b, HOUR);
  assert.equal(pub_(b).picks.length, 0, '노출 종료일을 늘려도 가격 확인 24시간이 지나면 카드가 내려감');
  assert.equal(b.adminGet().picks[0].live, false);
  save({ id, title: '테스트 생수', url: 'https://link.coupang.com/a/abcDEF123', category: 'food', price: '7900', recheck: true });
  assert.equal(pub_(b).picks[0].price, 7900, '다시 확인하면 다시 24시간');
  save({ id, title: '테스트 생수', url: 'https://link.coupang.com/a/abcDEF123', category: 'food', price: '' });
  later(b, 30 * HOUR);
  assert.equal(pub_(b).picks[0].price, null, '가격 없이 올린 카드는 노출 종료일까지');
  assert.equal(b.adminSet({ op: 'pick_hide', id, hidden: true }).ok, true);
  assert.equal(pub_(b).picks.length, 0);
  b.adminSet({ op: 'pick_hide', id, hidden: false });
  assert.equal(pub_(b).picks.length, 1);
  assert.equal(b.gas.post({ action: 'online_admin_set', token: b.token, op: 'pick_delete', id }).error, 'unauthorized', '수집기 토큰으로는 못 바꿈');
  assert.equal(b.adminSet({ op: 'pick_delete', id }).ok, true);
  assert.equal(pub_(b).picks.length, 0);
  assert.equal(b.adminSet({ op: 'pick_delete', id }).ok, false);
  assert.equal(b.adminSet({ op: 'pick_save', pick: { id: 'pk_ffffffffffffffff', title: '없는 카드', url: 'https://link.coupang.com/a/x', category: 'food' } }).ok, false);
});
function pub_(b) { b.gas.cache.clear(); return b.gas.get({ action: 'online_deals' }); }

test('자동 후보: 수집기 토큰으로만 저장, 같은 기준으로 재검사, 관리 화면에만 보이고 카드로 만들면 사용함, 3일 보관', () => {
  const b = boot();
  const lead = (n, over = {}) => ({ key: `ruliweb:${n}`, source: 'ruliweb', title: `[쿠팡] 테스트 상품 ${n} (9,900원/무료)`, postUrl: `https://bbs.ruliweb.com/market/board/1020/read/${n}`,
    coupangUrl: `https://www.coupang.com/vp/products/${n}`, priceHint: 9900, freeShipping: true, postedAt: new Date(OD_T0 - HOUR).toISOString(), ...over });
  assert.equal(b.gas.post({ action: 'online_leads_ingest', leads: [lead(1)] }).error, 'unauthorized');
  assert.equal(b.gas.post({ action: 'online_leads_ingest', token: b.admin, leads: [lead(1)] }).error, 'unauthorized', '관리 토큰으로는 저장 못 함');
  const r = b.gas.post({ action: 'online_leads_ingest', token: b.token, leads: [lead(1), lead(1), lead(2, { postUrl: 'https://www.fmkorea.com/2' }), lead(3, { coupangUrl: 'https://link.coupang.com/a/other' }), lead(4, { title: '=IMPORTXML("x") 상품' })] });
  assert.deepEqual([r.ok, r.added], [true, 3], '중복·허용 안 된 게시판은 버림');
  assert.equal(b.gas.sheet('online_leads').objects().find(x => x.key === 'ruliweb:3').coupang_url, '', '남의 제휴 링크는 저장 안 함');
  assert.ok(b.gas.sheet('online_leads').objects().find(x => x.key === 'ruliweb:4').title.startsWith("'="), '시트 수식 무력화');
  assert.deepEqual(b.gas.post({ action: 'online_leads_known', token: b.token }).keys.sort(), ['ruliweb:1', 'ruliweb:3', 'ruliweb:4']);
  assert.equal(b.gas.post({ action: 'online_leads_ingest', token: b.token, leads: [lead(1)] }).added, 0, '이미 있는 후보는 다시 넣지 않음');
  let adm = b.adminGet();
  assert.equal(adm.leads.length, 3);
  const pub = pub_(b);
  assert.ok(!JSON.stringify(pub).includes('테스트 상품') && !('leads' in pub), '공개 응답에 후보 없음');
  assert.equal(b.adminSet({ op: 'lead_dismiss', key: 'ruliweb:4' }).leads.length, 2);
  const made = b.adminSet({ op: 'pick_save', lead_key: 'ruliweb:1', pick: { title: '테스트 상품 1', url: 'https://link.coupang.com/a/among1', category: 'food', price: '9900' } });
  assert.equal(made.ok, true, made.error);
  assert.deepEqual(made.leads.map(l => l.key), ['ruliweb:3'], '카드로 만든 후보는 목록에서 빠짐');
  assert.equal(b.gas.sheet('online_leads').objects().find(x => x.key === 'ruliweb:1').status, 'used');
  assert.equal(b.adminSet({ op: 'lead_dismiss', key: 'ruliweb:999' }).ok, false);
  later(b, 3 * 24 * HOUR + MIN);
  b.gas.post({ action: 'online_leads_ingest', token: b.token, leads: [lead(5, { postedAt: new Date(b.gas.clock.now).toISOString() })] });
  assert.deepEqual(b.gas.sheet('online_leads').objects().map(x => x.key), ['ruliweb:5'], '3일 지난 후보는 정리');
});
