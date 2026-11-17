// 새 백엔드 1단계(D1): 저장·재사용·바뀐 행만 쓰기·실패 시 화면이 Apps Script로 돌아갈 수 있는 응답
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handlePublic, syncRows, SCHEMA, ACTIONS } from '../../server/d1-store.js';

// D1과 같은 모양의 시험용 DB (node:sqlite)
function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  const stats = { writes: 0 };
  const prep = (text, args = []) => ({
    bind: (...a) => prep(text, a),
    all: async () => ({ results: sql.prepare(text).all(...args) }),
    first: async () => sql.prepare(text).get(...args) ?? null,
    run: async () => { const r = sql.prepare(text).run(...args); if (/^\s*(INSERT|UPDATE|DELETE)/i.test(text)) stats.writes += Number(r.changes); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (t) => prep(t), batch: async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out; }, sql, stats };
}
const T0 = Date.UTC(2026, 10, 17, 0, 0, 0);
const body = (coupons, news = []) => JSON.stringify({ ok: true, last_checked_at: '2026-11-16T15:00:00.000Z', coupons, news });
const upstream = (text) => { const calls = []; const f = async (u) => { calls.push(u); return new Response(typeof text === 'function' ? text() : text); }; f.calls = calls; return f; };
const get = (env, f, now, q = 'action=coupons') => handlePublic(new Request('https://www.amongpick.com/api/public?' + q), env, {}, { fetchImpl: f, now });
const C = (id, extra = {}) => ({ id, brand: 'A버거', category: '햄버거', menu: '와퍼', end_date: '2026-11-30', ...extra });

test('DB가 없거나 모르는 요청이면 ok:false (화면은 기존 서버로)', async () => {
  assert.deepEqual(await (await get({}, upstream(''), T0)).json(), { ok: false, error: 'no_db' });
  assert.deepEqual(await (await get({ DB: fakeD1() }, upstream(''), T0, 'action=sources')).json(), { ok: false, error: 'unknown action' });
  assert.deepEqual(await (await get({ DB: fakeD1() }, upstream(''), T0, 'action=status')).json(), { ok: false, error: 'unknown action' });
});

test('처음에는 받아 와 저장하고, 그 뒤 3분 동안은 저장된 응답을 그대로 준다', async () => {
  const env = { DB: fakeD1() };
  const text = body([C('c1'), C('c2')], [{ id: 'n1', brand: 'A버거', title: '와퍼 행사' }]);
  const f = upstream(text);
  const a = await get(env, f, T0);
  assert.equal(await a.text(), text, '시트 쪽 응답과 글자까지 같다');
  assert.equal(a.headers.get('x-among-cache'), 'fresh');
  assert.equal(a.headers.get('cache-control'), 'no-store');
  assert.match(f.calls[0], /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec\?action=coupons$/);
  const b = await get(env, f, T0 + 100e3);
  assert.equal(await b.text(), text);
  assert.equal(b.headers.get('x-among-cache'), 'hit');
  assert.equal(f.calls.length, 1);
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) n FROM coupons').get().n, 2);
  assert.equal(env.DB.sql.prepare('SELECT title FROM news').get().title, '와퍼 행사');
});

test('3분이 지나면 저장된 응답을 주면서 새로 받아 오고, 바뀐 행만 쓴다 (사라진 쿠폰은 gone_at)', async () => {
  const env = { DB: fakeD1() };
  let text = body([C('c1'), C('c2')]);
  const f = upstream(() => text);
  await get(env, f, T0);
  text = body([C('c1'), C('c3')]);
  const stale = await get(env, f, T0 + 200e3);
  assert.equal(stale.headers.get('x-among-cache'), 'stale');
  assert.match(await stale.text(), /"c2"/);
  const next = await get(env, f, T0 + 210e3);
  assert.match(await next.text(), /"c3"/);
  const rows = Object.fromEntries(env.DB.sql.prepare('SELECT id, gone_at, first_seen_at, updated_at FROM coupons').all().map((r) => [r.id, r]));
  assert.equal(rows.c1.updated_at, new Date(T0).toISOString(), '그대로인 행은 다시 쓰지 않음');
  assert.ok(rows.c2.gone_at);
  assert.equal(rows.c3.gone_at, null);
  // 내용이 같으면 확인 시각 한 칸만 고친다
  const before = env.DB.stats.writes;
  await get(env, f, T0 + 600e3);
  assert.ok(env.DB.stats.writes - before <= 3, `쓰기 ${env.DB.stats.writes - before}번`);
});

test('바로 확인 뒤(min)에는 그 자리에서 새로 받아 온다. 미래 시각·엉뚱한 값은 무시', async () => {
  const env = { DB: fakeD1() };
  let text = body([C('c1')]);
  const f = upstream(() => text);
  await get(env, f, T0);
  text = body([C('c1'), C('c9')]);
  const min = encodeURIComponent(new Date(T0 + 30e3).toISOString());
  const r = await get(env, f, T0 + 60e3, 'action=coupons&min=' + min);
  assert.equal(r.headers.get('x-among-cache'), 'fresh');
  assert.match(await r.text(), /"c9"/);
  const n = f.calls.length;
  await get(env, f, T0 + 70e3, 'action=coupons&min=' + encodeURIComponent(new Date(T0 + 9e9).toISOString()));
  await get(env, f, T0 + 71e3, 'action=coupons&min=abc');
  assert.equal(f.calls.length, n);
});

test('받아 오기에 실패하면: 저장분이 있으면 그것을, 없으면 ok:false', async () => {
  const env = { DB: fakeD1() };
  const bad = async () => new Response('<html>오류</html>');
  assert.deepEqual(await (await get(env, bad, T0)).json(), { ok: false, error: 'unavailable' });
  const notOk = async () => new Response(JSON.stringify({ ok: false, error: 'server_error' }));
  assert.deepEqual(await (await get(env, notOk, T0 + 61e3)).json(), { ok: false, error: 'unavailable' });
  const text = body([C('c1')]);
  await get(env, upstream(text), T0 + 130e3);
  const kept = await get(env, bad, T0 + 500e3);
  assert.equal(await kept.text(), text);
  // 36시간 넘게 못 받아 왔으면 D1 응답을 쓰지 않는다
  assert.deepEqual(await (await get(env, bad, T0 + 40 * 3600e3)).json(), { ok: false, error: 'unavailable' });
});

test('다른 주소로는 받아 오지 않는다 · 조회 종류는 공개 자료 네 가지뿐', async () => {
  const env = { DB: fakeD1(), UPSTREAM_API_URL: 'https://evil.example/exec' };
  const f = upstream(body([]));
  assert.deepEqual(await (await get(env, f, T0)).json(), { ok: false, error: 'unavailable' });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(Object.keys(ACTIONS).sort(), ['app_coupons', 'coupons', 'nutrition', 'online_deals']);
});

test('행 맞추기: id 없는 행·중복은 건너뛰고 표 이름은 정해진 것만', async () => {
  const db = fakeD1();
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  const r = await syncRows(db, 'coupons', [C('a'), C('a'), { brand: 'x' }, null, C('b', { start_date: '어제' })], '2026-11-17T00:00:00.000Z');
  assert.deepEqual(r, { rows: 2, written: 2 });
  assert.equal(db.sql.prepare("SELECT start_date FROM coupons WHERE id = 'b'").get().start_date, null);
  await assert.rejects(() => syncRows(db, 'users; DROP TABLE coupons', [], ''), /bad table/);
});
