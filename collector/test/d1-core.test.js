// 운영 DB(D1) 핵심 규칙 — docs/d1-migration.md의 완료 기준을 시험으로 고정
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './d1-fake.js';
import { ingest, publicCoupons, runStart, runFinish, runState, getSources, newsPeriods, setOverride, setHidden, auditList, importSheet, handleCollector, handleAdmin } from '../../server/core.js';

const T0 = Date.UTC(2026, 10, 17, 1, 0, 0);   // 11/17 10:00 KST
const DAY = 86400e3;
const C = (id, o = {}) => ({ id, status: 'published', brand: 'A버거', category: '햄버거', menu: '와퍼', item_type: '단품', regular_price: 7900, coupon_price: 3900, discount_rate: 51, discount_type: 'price', discount_value: 3900, max_discount: null, min_order: null, channels: ['매장', '픽업'], audience: '전체', app_only: true, start_date: '2026-11-10', end_date: '2026-11-30', conditions: '1인 1회', confidence: 0.9, issues: [], evidence: '와퍼 3,900원', source_id: 'bk-event', source_url: 'https://a.test/e', official_link: 'https://a.test/', hash: 'h-' + id, programs: [], program_note: '', how_to_use: '', stackable: '', image_url: '', ...o });
const N = (id, o = {}) => ({ id, status: 'published', brand: 'A버거', category: '햄버거', title: '와퍼 3,900원', summary: '11월 한 달 와퍼 3,900원', discount_label: '3,900원', start_date: '2026-11-10', end_date: '2026-11-30', programs: [], image_url: '', related_ids: ['c1'], evidence: '', issues: [], confidence: 0.9, source_id: 'bk-event', source_url: 'https://a.test/e', official_link: 'https://a.test/', hash: 'n-' + id, ...o });
const run = (db, o, now = T0) => ingest(db, { run_id: 'r1', sources_ok: ['bk-event'], coupons: [], news: [], ...o }, { now });
const pub = async (db, now = T0) => JSON.parse(await publicCoupons(db, { now }));
const status = (db, table, id) => db.sql.prepare(`SELECT status FROM ${table} WHERE id = ?`).get(id)?.status;

test('같은 수집을 두 번 돌려도 건수가 늘지 않고, 그대로인 행은 확인 시각만 고친다', async () => {
  const db = fakeD1();
  const body = { coupons: [C('c1'), C('c2'), C('c1')], news: [N('n1')] };
  const a = await run(db, body);
  assert.deepEqual({ ...a, news: undefined }, { inserted: 2, updated: 0, unchanged: 0, gone: 0, expired: 0, news: undefined });
  assert.equal(a.news.inserted, 1);
  const b = await run(db, { ...body, run_id: 'r2', checked_at: '2026-11-18T00:00:00.000Z' }, T0 + DAY);
  assert.equal(b.unchanged, 2); assert.equal(b.inserted, 0); assert.equal(b.news.unchanged, 1);
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM coupons').get().n, 2);
  const row = db.sql.prepare("SELECT first_seen, checked_at, confirmed_at, updated_at, last_run_id FROM coupons WHERE id = 'c1'").get();
  assert.equal(row.first_seen, new Date(T0).toISOString());
  assert.equal(row.updated_at, new Date(T0).toISOString());
  assert.equal(row.confirmed_at, '2026-11-18T00:00:00.000Z');
  assert.equal(row.last_run_id, 'r2');
});

test('공개 응답은 시트 쪽과 같은 모양 (공개 열만 · 숫자·목록·참거짓 형식)', async () => {
  const db = fakeD1();
  await run(db, { coupons: [C('c1'), C('c2', { status: 'pending' }), C('c3', { end_date: '', coupon_price: null })], news: [N('n1'), N('n2', { status: 'pending' })] });
  await runFinish(db, { run_id: 'r1', state: 'success', finished_at: '2026-11-17T01:05:00.000Z', sources: [] }, { now: T0 });
  const d = await pub(db);
  assert.deepEqual(Object.keys(d), ['ok', 'today', 'last_checked_at', 'count', 'coupons', 'news']);
  assert.equal(d.today, '2026-11-17'); assert.equal(d.last_checked_at, '2026-11-17T01:05:00.000Z'); assert.equal(d.count, 2);
  assert.deepEqual(d.coupons.map((c) => c.id), ['c1', 'c3']);
  const c = d.coupons[0];
  assert.deepEqual([c.regular_price, c.coupon_price, c.max_discount, c.channels, c.programs, c.app_only], [7900, 3900, null, ['매장', '픽업'], [], true]);
  assert.equal(d.coupons[1].coupon_price, null);
  for (const hiddenField of ['status', 'evidence', 'confidence', 'issues', 'hash', 'source_id', 'last_run_id', 'brand_id', 'confirmed_at']) assert.ok(!(hiddenField in c), hiddenField);
  assert.deepEqual(d.news.map((n) => n.id), ['n1']);
  assert.deepEqual(d.news[0].related_ids, ['c1']);
  assert.ok(!('evidence' in d.news[0]) && !('status' in d.news[0]));
});

test('수집 실패와 행사 종료 구분: 정상 수집한 출처에서 사라진 것만 gone, 실패한 출처의 행사는 남는다', async () => {
  const db = fakeD1();
  await run(db, { sources_ok: ['bk-event', 'mcd-promo'], coupons: [C('c1'), C('m1', { source_id: 'mcd-promo', brand: 'M버거' })], news: [N('n1'), N('nm', { source_id: 'mcd-promo', brand: 'M버거' })] });
  // 다음 날: 맥도날드는 읽지 못함(sources_ok에 없음), 버거킹은 정상인데 c1이 사라짐
  const r = await run(db, { run_id: 'r2', sources_ok: ['bk-event'], coupons: [], news: [] }, T0 + DAY);
  assert.equal(r.gone, 1); assert.equal(r.news.gone, 1);
  assert.equal(status(db, 'coupons', 'c1'), 'gone');
  assert.equal(status(db, 'coupons', 'm1'), 'published');
  assert.equal(status(db, 'news', 'nm'), 'published');
  assert.deepEqual((await pub(db, T0 + DAY)).coupons.map((c) => c.id), ['m1']);
  // 다시 보이면 되살아난다
  await run(db, { run_id: 'r3', coupons: [C('c1')], news: [] }, T0 + 2 * DAY);
  assert.equal(status(db, 'coupons', 'c1'), 'published');
});

test('종료일이 지나면 내려간다 (수집이 실패한 날에도)', async () => {
  const db = fakeD1();
  await run(db, { coupons: [C('c1', { end_date: '2026-11-18' }), C('c2')], news: [N('n1', { end_date: '2026-11-18' })] });
  assert.equal((await pub(db, T0 + DAY)).coupons.length, 2, '종료일 당일까지는 보임');
  assert.deepEqual((await pub(db, T0 + 2 * DAY)).coupons.map((c) => c.id), ['c2'], '수집 전이라도 날짜가 지나면 응답에서 빠짐');
  const r = await run(db, { run_id: 'r2', sources_ok: [], coupons: [], news: [] }, T0 + 2 * DAY);
  assert.equal(r.expired, 1); assert.equal(r.news.expired, 1);
  assert.equal(status(db, 'coupons', 'c1'), 'expired');
});

test('관리자가 고친 이미지·설명은 재수집 뒤에도 남고, 이력이 남고, 지우면 수집 값으로 돌아간다', async () => {
  const db = fakeD1();
  await run(db, { coupons: [C('c1')], news: [N('n1', { image_url: 'https://a.test/list.jpg' })] });
  await setOverride(db, { kind: 'news', id: 'n1', field: 'image_url', value: 'https://a.test/poster.jpg', note: '공식 포스터' }, { now: T0 + 1000 });
  await setOverride(db, { kind: 'news', id: 'n1', field: 'summary', value: '11/30까지 와퍼 단품 3,900원 (1인 1회)' }, { now: T0 + 2000 });
  // 다음 수집: 이미지 주소를 못 찾아 빈 값, 내용도 바뀜
  await run(db, { run_id: 'r2', coupons: [C('c1')], news: [N('n1', { image_url: '', summary: '와퍼 행사', hash: 'n-changed' })] }, T0 + DAY);
  const n = (await pub(db, T0 + DAY)).news[0];
  assert.equal(n.image_url, 'https://a.test/poster.jpg');
  assert.equal(n.summary, '11/30까지 와퍼 단품 3,900원 (1인 1회)');
  assert.equal(db.sql.prepare("SELECT image_url, summary FROM news WHERE id = 'n1'").get().summary, '와퍼 행사', '수집 값은 따로 보관');
  const log = await auditList(db, { kind: 'news', id: 'n1' });
  assert.deepEqual(log.map((l) => l.action), ['set:summary', 'set:image_url']);
  await setOverride(db, { kind: 'news', id: 'n1', field: 'summary', value: '' }, { now: T0 + DAY + 1000 });
  assert.equal((await pub(db, T0 + DAY)).news[0].summary, '와퍼 행사');
  // 관리자가 종료일을 고치면 그 날짜로 내려간다
  await setOverride(db, { kind: 'coupon', id: 'c1', field: 'end_date', value: '2026-11-17' });
  assert.equal((await pub(db, T0 + DAY)).coupons.length, 0);
});

test('고칠 수 없는 열·잘못된 값·없는 항목은 거절', async () => {
  const db = fakeD1();
  await run(db, { coupons: [C('c1')], news: [] });
  const bad = (o, re) => assert.rejects(() => setOverride(db, { kind: 'coupon', id: 'c1', ...o }), re);
  await bad({ field: 'coupon_price', value: '100' }, /고칠 수 없는/);
  await bad({ field: 'status', value: 'published' }, /고칠 수 없는/);
  await bad({ field: 'end_date', value: '내일' }, /날짜/);
  await bad({ field: 'image_url', value: 'http://a.test/x.jpg' }, /https/);
  await bad({ field: 'image_url', value: 'javascript:alert(1)' }, /https/);
  await assert.rejects(() => setOverride(db, { kind: 'coupon', id: 'nope', field: 'menu', value: 'x' }), /찾을 수 없/);
  await assert.rejects(() => setOverride(db, { kind: 'users', id: 'c1', field: 'menu', value: 'x' }), /종류/);
});

test('숨긴 항목은 재수집해도 다시 나오지 않고, 되살리면 다음 수집부터 나온다', async () => {
  const db = fakeD1();
  await run(db, { coupons: [C('c1')], news: [N('n1')] });
  await setHidden(db, { kind: 'coupon', id: 'c1', hidden: true, note: '가격 오류 제보' });
  await run(db, { run_id: 'r2', coupons: [C('c1', { hash: 'new' })], news: [N('n1')] }, T0 + DAY);
  assert.equal(status(db, 'coupons', 'c1'), 'hidden');
  assert.equal((await pub(db, T0 + DAY)).coupons.length, 0);
  await setHidden(db, { kind: 'coupon', id: 'c1', hidden: false });
  assert.equal((await pub(db, T0 + DAY)).coupons.length, 0, '되살린 직후는 보류');
  await run(db, { run_id: 'r3', coupons: [C('c1', { hash: 'new' })], news: [N('n1')] }, T0 + 2 * DAY);
  assert.equal((await pub(db, T0 + 2 * DAY)).coupons.length, 1);
  assert.deepEqual((await auditList(db, {})).map((l) => l.action), ['unhide', 'hide']);
});

test('팩트체크로 채운 기간은 다음 수집이 기간을 못 읽어도 유지', async () => {
  const db = fakeD1();
  await run(db, { news: [N('n1', { end_date: '2026-11-25', period_source: '공식 원문', period_refs: '', period_checked_at: '2026-11-17T00:00:00Z' })] });
  await run(db, { run_id: 'r2', news: [N('n1', { end_date: '', start_date: '', hash: 'other' })] }, T0 + DAY);
  const row = db.sql.prepare("SELECT end_date, period_source, period_checked_at FROM news WHERE id = 'n1'").get();
  assert.deepEqual({ ...row }, { end_date: '2026-11-25', period_source: '공식 원문', period_checked_at: '2026-11-17T00:00:00Z' });
  assert.equal((await newsPeriods(db)).length, 1);
});

test('수집 상태·출처 최근 상태·실행 기록', async () => {
  const db = fakeD1();
  await importSheet(db, { tables: { sources: [{ id: 'bk-event', active: 'TRUE', brand: 'A버거', url: 'https://a.test/e', max_follow: 3 }, { id: 'off', active: 'FALSE', url: 'https://b.test' }, { id: 'nourl', active: 'TRUE', url: '' }] } }, { now: T0 });
  assert.deepEqual((await getSources(db)).map((s) => [s.id, s.max_follow]), [['bk-event', '3']]);
  await runStart(db, { run_id: 'r1', started_at: '2026-11-17T01:00:00.000Z' }, { now: T0 });
  assert.equal((await runState(db, { now: T0 + 60e3 })).state, 'running');
  assert.equal((await runState(db, { now: T0 + 31 * 60e3 })).state, 'idle', '30분 넘게 멈춘 실행은 끝난 것으로 본다');
  await runFinish(db, { run_id: 'r1', trigger: 'schedule', state: 'partial', finished_at: '2026-11-17T01:04:00.000Z', pages: 9, summary: { total: 5, published: 4 }, ingest: { inserted: 4 }, sources: [{ id: 'bk-event', ok: false, error: 'HTTP 503' }], errors: ['bk-event: HTTP 503'] }, { now: T0 + 240e3 });
  const st = await runState(db, { now: T0 + 300e3 });
  assert.deepEqual([st.state, st.last_state, st.last_checked_at], ['idle', 'partial', '2026-11-17T01:04:00.000Z']);
  assert.equal(db.sql.prepare("SELECT last_error FROM sources WHERE id = 'bk-event'").get().last_error, 'HTTP 503');
  assert.equal(db.sql.prepare("SELECT sources_failed, errors FROM runs WHERE run_id = 'r1'").get().sources_failed, '1');
  await runFinish(db, { run_id: 'r2', state: 'failed', finished_at: '2026-11-18T01:04:00.000Z' }, { now: T0 + DAY });
  assert.equal((await runState(db, { now: T0 + DAY })).last_checked_at, '2026-11-17T01:04:00.000Z', '실패한 실행은 마지막 확인 시각을 바꾸지 않는다');
});

test('시트 가져오기: 시트 형식(쉼표 목록·TRUE)을 옮기고, 여러 번 해도 같은 결과, 전환 뒤에는 막힌다', async () => {
  const db = fakeD1();
  const tables = {
    coupons: [{ ...C('c1'), channels: '매장,픽업', programs: 'KT', issues: 'a; b', app_only: 'TRUE', coupon_price: '3900', max_discount: '', first_seen: '2026-11-01T00:00:00Z', checked_at: '2026-11-16T15:00:00Z', updated_at: '2026-11-02T00:00:00Z' },
      { ...C('c0'), status: 'gone', channels: '', programs: '', issues: '' }],
    news: [{ ...N('n1'), programs: '', related_ids: 'c1,c0', issues: '' }],
  };
  const a = await importSheet(db, { tables, props: { LAST_SUCCESS_AT: '2026-11-16T15:05:00Z', ADMIN_TOKEN: 'never' } }, { now: T0 });
  assert.deepEqual(a, { coupons: 2, news: 1, sources: 0, runs: 0 });
  await importSheet(db, { tables }, { now: T0 + 1000 });
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM coupons').get().n, 2);
  assert.equal(db.sql.prepare("SELECT COUNT(*) n FROM kv WHERE key = 'ADMIN_TOKEN'").get().n, 0, '토큰은 DB에 넣지 않는다');
  const d = await pub(db);
  assert.deepEqual([d.coupons.length, d.coupons[0].channels, d.coupons[0].programs, d.coupons[0].app_only, d.coupons[0].coupon_price, d.coupons[0].first_seen], [1, ['매장', '픽업'], ['KT'], true, 3900, '2026-11-01T00:00:00Z']);
  assert.deepEqual(d.news[0].related_ids, ['c1', 'c0']);
  assert.equal(d.last_checked_at, '2026-11-16T15:05:00Z');
  // 가져온 뒤 수집해도 같은 id·hash면 그대로
  const r = await run(db, { coupons: [C('c1')], news: [N('n1')] });
  assert.equal(r.unchanged, 1); assert.equal(r.news.unchanged, 1);
  db.sql.prepare("INSERT INTO kv (key, value) VALUES ('mode', 'd1')").run();
  await assert.rejects(() => importSheet(db, { tables }), /이미 D1/);
});

test('수집기·관리자 주소: 토큰이 없거나 틀리면 거절, 토큰이 등록되지 않았으면 전부 거절', async () => {
  const db = fakeD1();
  const TOKEN = 'collector-token-0123456789abcdef', ADMIN = 'admin-token-0123456789abcdefgh';
  const post = (handler, env, body) => handler(new Request('https://www.amongpick.com/api/x', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), env, { now: T0 }).then((r) => r.json());
  assert.deepEqual(await post(handleCollector, {}, { action: 'sources' }), { ok: false, error: 'no_db' });
  assert.deepEqual(await post(handleCollector, { DB: db }, { action: 'sources', token: '' }), { ok: false, error: 'unauthorized' });
  assert.deepEqual(await post(handleCollector, { DB: db, COLLECTOR_TOKEN: 'short' }, { action: 'sources', token: 'short' }), { ok: false, error: 'unauthorized' });
  assert.deepEqual(await post(handleCollector, { DB: db, COLLECTOR_TOKEN: TOKEN }, { action: 'sources', token: TOKEN + 'x' }), { ok: false, error: 'unauthorized' });
  assert.deepEqual(await post(handleCollector, { DB: db, COLLECTOR_TOKEN: TOKEN }, { action: 'sources', token: ADMIN }), { ok: false, error: 'unauthorized' });
  assert.deepEqual(await post(handleCollector, { DB: db, COLLECTOR_TOKEN: TOKEN }, '[1]'), { ok: false, error: 'bad json' });
  const env = { DB: db, COLLECTOR_TOKEN: TOKEN, ADMIN_TOKEN: ADMIN };
  assert.deepEqual(await post(handleCollector, env, { action: 'sources', token: TOKEN }), { ok: true, sources: [] });
  const ing = await post(handleCollector, env, { action: 'ingest', token: TOKEN, run_id: 'r1', sources_ok: ['bk-event'], coupons: [C('c1')], news: [N('n1')] });
  assert.equal(ing.result.inserted, 1);
  assert.deepEqual(await post(handleCollector, env, { action: 'override_set', token: TOKEN }), { ok: false, error: 'unknown action' });
  assert.deepEqual(await post(handleAdmin, env, { action: 'hide', token: TOKEN, kind: 'coupon', id: 'c1' }), { ok: false, error: 'unauthorized' }, '수집기 토큰으로는 관리 기능을 못 쓴다');
  assert.deepEqual(await post(handleAdmin, env, { action: 'hide', token: ADMIN, kind: 'coupon', id: 'c1' }), { ok: true, status: 'hidden' });
  assert.equal((await post(handleAdmin, env, { action: 'audit_list', token: ADMIN })).log.length, 1);
  assert.deepEqual(await post(handleAdmin, env, { action: 'override_set', token: ADMIN, kind: 'coupon', id: 'c1', field: 'status', value: 'published' }), { ok: false, error: '고칠 수 없는 항목이에요.' });
});

test('SQL에 값이 끼어들지 않는다 (id·글자에 따옴표가 있어도 그대로 저장)', async () => {
  const db = fakeD1();
  await run(db, { coupons: [C("c'1; DROP TABLE coupons;--", { menu: "와퍼'); DELETE FROM news;--" })], news: [N('n1')] });
  const d = await pub(db);
  assert.equal(d.coupons[0].menu, "와퍼'); DELETE FROM news;--");
  assert.equal(d.news.length, 1);
});
