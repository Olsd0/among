// AMONG 운영 DB (Cloudflare D1) — 쿠폰·공지·출처·수집 기록의 기준 저장소. 설계: docs/d1-migration.md (11/17 대표 승인)
// Apps Script(Code.gs)의 ingest_·ingestNews_·getCoupons_·runStart_·runFinish_·getSources_·newsPeriods_ 규칙을 그대로 옮기고,
// 관리자 수정 값 분리(overrides)·수정 이력(audit_log)·정상 확인 시각(confirmed_at)·브랜드 표를 더했다.
// 모든 쿼리는 준비된 문장 + 바인딩. 토큰은 Cloudflare Secrets(env)에서만 읽고 DB·로그에 넣지 않는다.

export const TEXT = 'TEXT NOT NULL DEFAULT \'\'';
export const COUPON_NUM = ['regular_price', 'coupon_price', 'discount_rate', 'discount_value', 'max_discount', 'min_order', 'confidence'];
export const COUPON_LIST = ['channels', 'programs', 'issues'];
// 시트 coupons 탭과 같은 열 (순서 포함) + confirmed_at · brand_id
export const COUPON_COLS = ['id', 'status', 'brand', 'category', 'menu', 'item_type', 'regular_price', 'coupon_price', 'discount_rate',
  'discount_type', 'discount_value', 'max_discount', 'min_order', 'channels', 'audience', 'app_only',
  'start_date', 'end_date', 'conditions', 'confidence', 'issues', 'evidence', 'source_id', 'source_url',
  'official_link', 'first_seen', 'checked_at', 'updated_at', 'hash', 'last_run_id',
  'programs', 'program_note', 'how_to_use', 'stackable', 'image_url'];
export const NEWS_LIST = ['programs', 'related_ids', 'issues'];
export const NEWS_COLS = ['id', 'status', 'brand', 'category', 'title', 'summary', 'discount_label', 'start_date', 'end_date', 'programs',
  'image_url', 'related_ids', 'evidence', 'issues', 'confidence', 'source_id', 'source_url', 'official_link',
  'first_seen', 'checked_at', 'updated_at', 'hash', 'last_run_id', 'period_source', 'period_refs', 'period_checked_at'];
export const SOURCE_COLS = ['id', 'active', 'brand', 'category', 'url', 'selector', 'exclude', 'follow', 'detail_selector',
  'max_follow', 'max_shots', 'wait_ms', 'official_link', 'notes', 'last_ok_at', 'last_error', 'program', 'follow_text'];
export const RUN_COLS = ['run_id', 'trigger', 'state', 'started_at', 'finished_at', 'duration_s', 'model', 'sources_ok',
  'sources_failed', 'pages', 'found', 'published', 'pending', 'rejected', 'auto_publish_rate', 'inserted',
  'updated', 'unchanged', 'gone', 'expired', 'input_tokens', 'output_tokens', 'errors'];
// 공개 응답에 싣는 열 (Code.gs PUBLIC_FIELDS · NEWS_PUBLIC와 같다)
export const PUBLIC_FIELDS = ['id', 'brand', 'category', 'menu', 'item_type', 'regular_price', 'coupon_price', 'discount_rate',
  'discount_type', 'discount_value', 'max_discount', 'min_order', 'channels', 'audience', 'app_only', 'start_date', 'end_date',
  'conditions', 'source_url', 'official_link', 'first_seen', 'checked_at', 'programs', 'program_note', 'how_to_use', 'stackable', 'image_url'];
export const NEWS_PUBLIC = ['id', 'brand', 'category', 'title', 'summary', 'discount_label', 'start_date', 'end_date', 'programs',
  'image_url', 'related_ids', 'source_url', 'official_link', 'first_seen', 'checked_at', 'period_source', 'period_refs'];
// 관리자가 고칠 수 있는 열 (수집기는 이 값을 건드리지 못한다)
export const OVERRIDE_FIELDS = {
  coupon: ['menu', 'conditions', 'image_url', 'official_link', 'start_date', 'end_date', 'how_to_use', 'program_note', 'category'],
  news: ['title', 'summary', 'discount_label', 'image_url', 'official_link', 'source_url', 'start_date', 'end_date', 'category'],
};
const STALE_MIN = 30;
const KIND_TABLE = { coupon: 'coupons', news: 'news' };

const colDef = (cols, nums = [], extra = '') => cols.map((c) => (c === 'id' || c === 'run_id' ? `${c} TEXT PRIMARY KEY` : nums.includes(c) ? `${c} REAL` : c === 'app_only' ? 'app_only INTEGER NOT NULL DEFAULT 0' : `"${c}" ${TEXT}`)).join(', ') + extra;
export const CORE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS brands (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, category ${TEXT}, official_url ${TEXT}, created_at ${TEXT})`,
  `CREATE TABLE IF NOT EXISTS sources (${colDef(SOURCE_COLS)})`,
  `CREATE TABLE IF NOT EXISTS coupons (${colDef(COUPON_COLS, COUPON_NUM, `, confirmed_at ${TEXT}, brand_id INTEGER`)})`,
  `CREATE TABLE IF NOT EXISTS news (${colDef(NEWS_COLS, ['confidence'], `, confirmed_at ${TEXT}, brand_id INTEGER`)})`,
  'CREATE TABLE IF NOT EXISTS news_brands (news_id TEXT NOT NULL, brand_id INTEGER NOT NULL, PRIMARY KEY (news_id, brand_id))',
  `CREATE TABLE IF NOT EXISTS overrides (kind TEXT NOT NULL, item_id TEXT NOT NULL, field TEXT NOT NULL, value ${TEXT}, note ${TEXT}, updated_at ${TEXT}, PRIMARY KEY (kind, item_id, field))`,
  `CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor ${TEXT}, kind ${TEXT}, item_id ${TEXT}, action TEXT NOT NULL, before ${TEXT}, after ${TEXT})`,
  `CREATE TABLE IF NOT EXISTS runs (${colDef(RUN_COLS)})`,
  'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS coupons_live ON coupons (status, end_date)',
  'CREATE INDEX IF NOT EXISTS coupons_by_brand ON coupons (brand_id, status)',
  'CREATE INDEX IF NOT EXISTS coupons_first_seen ON coupons (first_seen)',
  'CREATE INDEX IF NOT EXISTS news_live ON news (status, end_date)',
  'CREATE INDEX IF NOT EXISTS news_by_brand ON news (brand_id, status)',
  'CREATE INDEX IF NOT EXISTS audit_item ON audit_log (kind, item_id, id)',
];

const ready = new WeakSet();
export async function ensureCore(db) {
  if (ready.has(db)) return;
  await db.batch(CORE_SCHEMA.map((sql) => db.prepare(sql)));
  ready.add(db);
}

export const nowIso = (ms = Date.now()) => new Date(ms).toISOString();
export const todayKST = (ms = Date.now()) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const text = (v, max = 4000) => (v === undefined || v === null ? '' : String(v)).slice(0, max);
const num = (v) => { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const list = (v) => (Array.isArray(v) ? v : []).map((x) => text(x, 200)).filter(Boolean);
const parseList = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
async function runAll(db, stmts) { for (const part of chunk(stmts, 40)) await db.batch(part); }
const validId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 120;

// ---------- kv (상태값만. 토큰 금지) ----------
export async function kvGet(db, keys) {
  const out = {};
  for (const part of chunk(keys, 50)) {
    const r = await db.prepare(`SELECT key, value FROM kv WHERE key IN (${part.map(() => '?').join(',')})`).bind(...part).all();
    for (const row of r.results || []) out[row.key] = row.value;
  }
  return out;
}
const kvSetStmt = (db, key, value) => db.prepare('INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2').bind(key, String(value));
const dropPublicCache = (db) => db.prepare("DELETE FROM kv WHERE key LIKE 'public:%'");

// ---------- 행 변환 ----------
function couponRow(c, runId, checkedAt) {
  const r = {};
  for (const h of COUPON_COLS) r[h] = COUPON_NUM.includes(h) ? num(c[h]) : COUPON_LIST.includes(h) ? JSON.stringify(list(c[h])) : text(c[h]);
  r.app_only = c.app_only === true || String(c.app_only).toUpperCase() === 'TRUE' ? 1 : 0;
  r.checked_at = checkedAt; r.last_run_id = text(runId, 80);
  return r;
}
function newsRow(n, runId, checkedAt) {
  const r = {};
  for (const h of NEWS_COLS) r[h] = h === 'confidence' ? num(n[h]) : NEWS_LIST.includes(h) ? JSON.stringify(list(n[h])) : text(n[h]);
  r.title = text(n.title, 60); r.summary = text(n.summary, 300);
  r.checked_at = checkedAt; r.last_run_id = text(runId, 80);
  return r;
}
function upsertStmt(db, table, cols, row, extra = {}) {
  const all = [...cols, ...Object.keys(extra)];
  const vals = all.map((c) => (c in extra ? extra[c] : row[c]));
  const sets = all.filter((c) => c !== 'id').map((c) => `"${c}" = excluded."${c}"`).join(', ');
  return db.prepare(`INSERT INTO ${table} (${all.map((c) => `"${c}"`).join(', ')}) VALUES (${all.map(() => '?').join(', ')}) ON CONFLICT(id) DO UPDATE SET ${sets}`).bind(...vals);
}
async function brandIds(db, rows, now) {
  const names = [...new Set(rows.map((r) => r.brand).filter(Boolean))];
  if (!names.length) return new Map();
  await runAll(db, names.map((n) => db.prepare('INSERT OR IGNORE INTO brands (name, category, created_at) VALUES (?1, ?2, ?3)').bind(n, rows.find((r) => r.brand === n).category || '', now)));
  const map = new Map();
  for (const part of chunk(names, 50)) {
    const r = await db.prepare(`SELECT id, name FROM brands WHERE name IN (${part.map(() => '?').join(',')})`).bind(...part).all();
    for (const b of r.results || []) map.set(b.name, b.id);
  }
  return map;
}

// ---------- 수집 결과 반영 ----------
/**
 * Code.gs ingest_·ingestNews_와 같은 규칙:
 *  - id로 넣거나 고친다 (같은 행사는 같은 id → 다시 수집해도 늘지 않는다)
 *  - 숨긴(hidden) 항목은 되살리지 않는다. 내용·상태가 같으면 확인 시각만 고친다
 *  - 정상 수집한 출처(sources_ok)에서 안 보이는 게시·보류 항목만 gone. 실패한 출처의 항목은 그대로
 *  - 종료일이 지나면 expired
 */
async function ingestTable(db, table, cols, rows, body, okSources, now, today, tweak) {
  const result = { inserted: 0, updated: 0, unchanged: 0, gone: 0, expired: 0 };
  const extraCols = table === 'news' ? ', start_date, period_source, period_refs, period_checked_at' : '';
  const old = new Map(((await db.prepare(`SELECT id, status, hash, first_seen, end_date, source_id${extraCols} FROM ${table}`).all()).results || []).map((r) => [r.id, r]));
  const brands = await brandIds(db, rows, now);
  const seen = new Set();
  const stmts = [];
  const touch = [];
  for (const row of rows) {
    if (!validId(row.id) || seen.has(row.id)) continue;
    seen.add(row.id);
    const o = old.get(row.id);
    const extra = { confirmed_at: row.checked_at, brand_id: brands.get(row.brand) ?? null };
    if (!o) {
      row.first_seen = now; row.updated_at = now;
      stmts.push(upsertStmt(db, table, cols, row, extra));
      result.inserted++;
      continue;
    }
    const patch = tweak ? tweak(row, o) : null;
    if (o.status === 'hidden' || (o.hash === row.hash && o.status === row.status)) {
      touch.push(row.id);
      if (patch && o.status !== 'hidden') stmts.push(patch);
      result.unchanged++;
    } else {
      row.first_seen = o.first_seen || now; row.updated_at = now;
      stmts.push(upsertStmt(db, table, cols, row, extra));
      result.updated++;
    }
  }
  const checkedAt = text(body.checked_at) || now;
  for (const part of chunk(touch, 80)) {
    stmts.push(db.prepare(`UPDATE ${table} SET checked_at = ?, confirmed_at = ?, last_run_id = ? WHERE id IN (${part.map(() => '?').join(',')})`).bind(checkedAt, checkedAt, text(body.run_id, 80), ...part));
  }
  const gone = [...old.values()].filter((r) => !seen.has(r.id) && (r.status === 'published' || r.status === 'pending') && okSources.has(r.source_id)).map((r) => r.id);
  for (const part of chunk(gone, 80)) {
    stmts.push(db.prepare(`UPDATE ${table} SET status = 'gone', updated_at = ? WHERE id IN (${part.map(() => '?').join(',')})`).bind(now, ...part));
  }
  result.gone = gone.length;
  await runAll(db, stmts);
  const exp = await db.prepare(`UPDATE ${table} SET status = 'expired', updated_at = ?1 WHERE status NOT IN ('expired', 'hidden') AND end_date <> '' AND end_date < ?2`).bind(now, today).run();
  result.expired = (exp.meta && exp.meta.changes) || 0;
  return result;
}

export async function ingest(db, body, { now = Date.now() } = {}) {
  await ensureCore(db);
  const at = nowIso(now), today = todayKST(now);
  const checkedAt = text(body.checked_at) || at;
  const okSources = new Set((Array.isArray(body.sources_ok) ? body.sources_ok : []).map((s) => text(s, 120)));
  const coupons = (Array.isArray(body.coupons) ? body.coupons : []).filter((c) => c && typeof c === 'object').map((c) => couponRow(c, body.run_id, checkedAt));
  const result = await ingestTable(db, 'coupons', COUPON_COLS, coupons, body, okSources, at, today);
  // 소식: 예전 수집기(소식을 보내지 않음)면 소식 표를 건드리지 않는다
  if (Array.isArray(body.news)) {
    const news = body.news.filter((n) => n && typeof n === 'object').map((n) => newsRow(n, body.run_id, checkedAt));
    result.news = await ingestTable(db, 'news', NEWS_COLS, news, body, okSources, at, today, (row, o) => {
      // Code.gs keepPeriod_: 팩트체크로 채운 기간은 다음 수집이 기간을 못 읽어도 유지
      if (!row.period_source && o.period_source && !row.end_date && o.end_date) {
        row.start_date = o.start_date; row.end_date = o.end_date; row.period_source = o.period_source; row.period_refs = o.period_refs;
      }
      if (!row.period_checked_at && o.period_checked_at) row.period_checked_at = o.period_checked_at;
      const set = ['period_source', 'period_refs', 'period_checked_at'].filter((h) => row[h] !== '');
      return set.length ? db.prepare(`UPDATE news SET ${set.map((h) => `${h} = ?`).join(', ')} WHERE id = ?`).bind(...set.map((h) => row[h]), row.id) : null;
    });
  }
  await dropPublicCache(db).run();
  return result;
}

// ---------- 수집 실행 상태 ----------
export async function runStart(db, body, { now = Date.now() } = {}) {
  await ensureCore(db);
  await db.batch([
    kvSetStmt(db, 'RUN_STATE', 'running'), kvSetStmt(db, 'RUN_STATE_MS', now),
    kvSetStmt(db, 'RUN_ID', text(body.run_id, 80)), kvSetStmt(db, 'RUN_STARTED_AT', text(body.started_at, 40) || nowIso(now)),
  ]);
  return { ok: true };
}

export async function runFinish(db, rep, { now = Date.now() } = {}) {
  await ensureCore(db);
  rep = rep && typeof rep === 'object' ? rep : {};
  const s = rep.summary || {}, ing = rep.ingest || {};
  const srcs = (Array.isArray(rep.sources) ? rep.sources : []).filter((x) => x && validId(x.id));
  const finished = text(rep.finished_at, 40) || nowIso(now);
  const row = {
    run_id: text(rep.run_id, 80) || `r_${now}`, trigger: rep.trigger, state: rep.state, started_at: rep.started_at, finished_at: rep.finished_at,
    duration_s: rep.duration_s, model: rep.model, sources_ok: srcs.filter((x) => x.ok).length, sources_failed: srcs.filter((x) => !x.ok).length,
    pages: rep.pages, found: s.total, published: s.published, pending: s.pending, rejected: s.rejected,
    auto_publish_rate: s.auto_publish_rate === null || s.auto_publish_rate === undefined ? '' : s.auto_publish_rate,
    inserted: ing.inserted, updated: ing.updated, unchanged: ing.unchanged, gone: ing.gone, expired: ing.expired,
    input_tokens: rep.input_tokens, output_tokens: rep.output_tokens, errors: (Array.isArray(rep.errors) ? rep.errors : []).join(' | ').slice(0, 2000),
  };
  const stmts = [db.prepare(`INSERT OR REPLACE INTO runs (${RUN_COLS.map((c) => `"${c}"`).join(', ')}) VALUES (${RUN_COLS.map(() => '?').join(', ')})`).bind(...RUN_COLS.map((c) => text(row[c], 2000)))];
  // 출처별 최근 상태: 성공하면 마지막 정상 시각, 실패하면 오류만 (기존 항목은 ingest에서 그대로 둔다)
  for (const x of srcs) {
    stmts.push(x.ok
      ? db.prepare("UPDATE sources SET last_ok_at = ?1, last_error = '' WHERE id = ?2").bind(finished, x.id)
      : db.prepare('UPDATE sources SET last_error = ?1 WHERE id = ?2').bind(text(x.error, 300), x.id));
  }
  stmts.push(kvSetStmt(db, 'RUN_STATE', 'idle'), kvSetStmt(db, 'RUN_STATE_MS', now), kvSetStmt(db, 'LAST_FINISHED_AT', finished), kvSetStmt(db, 'LAST_STATE', text(rep.state, 20)));
  if ((rep.state === 'success' || rep.state === 'partial') && rep.trigger !== 'e2e') stmts.push(kvSetStmt(db, 'LAST_SUCCESS_AT', finished));
  stmts.push(dropPublicCache(db));
  await runAll(db, stmts);
  return { ok: true, purged: null };
}

export async function runState(db, { now = Date.now() } = {}) {
  const p = await kvGet(db, ['RUN_STATE', 'RUN_STATE_MS', 'RUN_ID', 'RUN_STARTED_AT', 'LAST_FINISHED_AT', 'LAST_STATE', 'LAST_SUCCESS_AT']);
  let state = p.RUN_STATE || 'idle';
  if (state !== 'idle' && now - Number(p.RUN_STATE_MS || 0) > STALE_MIN * 60000) state = 'idle';
  return { state, run_id: p.RUN_ID || '', started_at: p.RUN_STARTED_AT || '', last_finished_at: p.LAST_FINISHED_AT || '', last_state: p.LAST_STATE || '', last_checked_at: p.LAST_SUCCESS_AT || '' };
}

export async function getSources(db) {
  await ensureCore(db);
  const r = await db.prepare(`SELECT ${SOURCE_COLS.map((c) => `"${c}"`).join(', ')} FROM sources ORDER BY rowid`).all();
  return (r.results || []).filter((s) => s.url && String(s.active).toUpperCase() !== 'FALSE');
}

export async function newsPeriods(db) {
  await ensureCore(db);
  const r = await db.prepare("SELECT id, status, start_date, end_date, period_source, period_refs, period_checked_at FROM news WHERE period_checked_at <> '' ORDER BY rowid").all();
  return r.results || [];
}

// ---------- 공개 조회 ----------
async function overridesFor(db, kind) {
  const map = new Map();
  const r = await db.prepare('SELECT item_id, field, value FROM overrides WHERE kind = ?1').bind(kind).all();
  for (const o of r.results || []) {
    if (!OVERRIDE_FIELDS[kind].includes(o.field)) continue;
    if (!map.has(o.item_id)) map.set(o.item_id, {});
    map.get(o.item_id)[o.field] = o.value;
  }
  return map;
}

/** Code.gs getCoupons_와 같은 모양: 게시 중이고 끝나지 않은 쿠폰·공지 (관리자 수정 값 우선) */
export async function publicCoupons(db, { now = Date.now() } = {}) {
  await ensureCore(db);
  const today = todayKST(now);
  const hit = (await kvGet(db, ['public:coupons']))['public:coupons'];
  if (hit && hit.startsWith(today + '\n')) return hit.slice(today.length + 1);
  const [cr, nr, co, no, st] = await Promise.all([
    db.prepare(`SELECT ${COUPON_COLS.map((c) => `"${c}"`).join(', ')} FROM coupons ORDER BY rowid`).all(),
    db.prepare(`SELECT ${NEWS_COLS.map((c) => `"${c}"`).join(', ')} FROM news ORDER BY rowid`).all(),
    overridesFor(db, 'coupon'), overridesFor(db, 'news'), runState(db, { now }),
  ]);
  // 관리자가 기간을 고쳤을 수 있으므로 수정 값을 입힌 뒤에 '끝났는지'를 본다
  const alive = (r) => r.status === 'published' && (!r.end_date || r.end_date >= today);
  const coupons = (cr.results || []).map((r) => ({ ...r, ...(co.get(r.id) || {}) })).filter(alive).map((r) => {
    const o = {};
    for (const f of PUBLIC_FIELDS) o[f] = r[f];
    for (const f of COUPON_NUM) if (f in o) o[f] = num(o[f]);
    o.channels = parseList(r.channels); o.programs = parseList(r.programs); o.app_only = r.app_only === 1 || r.app_only === true;
    return o;
  });
  const news = (nr.results || []).map((r) => ({ ...r, ...(no.get(r.id) || {}) })).filter(alive).map((r) => {
    const o = {};
    for (const f of NEWS_PUBLIC) o[f] = r[f];
    o.programs = parseList(r.programs); o.related_ids = parseList(r.related_ids);
    return o;
  });
  const body = JSON.stringify({ ok: true, today, last_checked_at: st.last_checked_at, count: coupons.length, coupons, news });
  if (body.length < 1_500_000) await kvSetStmt(db, 'public:coupons', today + '\n' + body).run();
  return body;
}

// ---------- 관리자 수정 (값 분리 + 이력) ----------
function audit(db, at, actor, kind, itemId, action, before, after) {
  return db.prepare('INSERT INTO audit_log (at, actor, kind, item_id, action, before, after) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(at, text(actor, 40), kind, itemId, action, text(before, 2000), text(after, 2000));
}
async function mustExist(db, kind, id) {
  if (!KIND_TABLE[kind]) throw new Error('종류가 올바르지 않아요.');
  if (!validId(id)) throw new Error('항목을 찾을 수 없어요.');
  const row = await db.prepare(`SELECT id, status FROM ${KIND_TABLE[kind]} WHERE id = ?1`).bind(id).first();
  if (!row) throw new Error('항목을 찾을 수 없어요.');
  return row;
}

/** 관리자가 한 칸을 고친다. value가 빈 글자면 수정 값을 지우고 수집 값으로 돌아간다 */
export async function setOverride(db, { kind, id, field, value, note = '', actor = 'admin' }, { now = Date.now() } = {}) {
  await ensureCore(db);
  await mustExist(db, kind, id);
  if (!OVERRIDE_FIELDS[kind].includes(field)) throw new Error('고칠 수 없는 항목이에요.');
  const v = text(value, 600).trim();
  if (/_date$/.test(field) && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('날짜는 2026-11-30처럼 적어 주세요.');
  if (/(_url|_link)$/.test(field) && v && !/^https:\/\/[^\s<>"']+$/.test(v)) throw new Error('https 주소만 넣을 수 있어요.');
  const before = await db.prepare('SELECT value FROM overrides WHERE kind = ?1 AND item_id = ?2 AND field = ?3').bind(kind, id, field).first();
  const at = nowIso(now);
  await db.batch([
    v ? db.prepare('INSERT INTO overrides (kind, item_id, field, value, note, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(kind, item_id, field) DO UPDATE SET value = ?4, note = ?5, updated_at = ?6').bind(kind, id, field, v, text(note, 300), at)
      : db.prepare('DELETE FROM overrides WHERE kind = ?1 AND item_id = ?2 AND field = ?3').bind(kind, id, field),
    audit(db, at, actor, kind, id, v ? `set:${field}` : `clear:${field}`, before ? before.value : '', v),
    dropPublicCache(db),
  ]);
  return { ok: true };
}

/** 숨김·되살림. 숨긴 항목은 수집기가 다시 가져와도 나오지 않는다 */
export async function setHidden(db, { kind, id, hidden, note = '', actor = 'admin' }, { now = Date.now() } = {}) {
  await ensureCore(db);
  const row = await mustExist(db, kind, id);
  const next = hidden ? 'hidden' : 'pending';   // 되살리면 보류로 — 다음 수집이 게시 여부를 다시 정한다
  if ((row.status === 'hidden') === !!hidden) return { ok: true, status: row.status };
  const at = nowIso(now);
  await db.batch([
    db.prepare(`UPDATE ${KIND_TABLE[kind]} SET status = ?1, updated_at = ?2, hash = '' WHERE id = ?3`).bind(next, at, id),
    audit(db, at, actor, kind, id, hidden ? 'hide' : 'unhide', row.status, text(note, 300) || next),
    dropPublicCache(db),
  ]);
  return { ok: true, status: next };
}

export async function auditList(db, { kind = '', id = '', limit = 50 } = {}) {
  await ensureCore(db);
  const n = Math.max(1, Math.min(200, Number(limit) || 50));
  const r = kind && id
    ? await db.prepare('SELECT id, at, actor, kind, item_id, action, before, after FROM audit_log WHERE kind = ?1 AND item_id = ?2 ORDER BY id DESC LIMIT ?3').bind(kind, id, n).all()
    : await db.prepare('SELECT id, at, actor, kind, item_id, action, before, after FROM audit_log ORDER BY id DESC LIMIT ?1').bind(n).all();
  return r.results || [];
}

// ---------- 시트에서 가져오기 (전환 전에만 · 여러 번 해도 같은 결과) ----------
const splitCsv = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
const IMPORT_PROPS = ['LAST_FINISHED_AT', 'LAST_STATE', 'LAST_SUCCESS_AT'];
export async function importSheet(db, body, { now = Date.now() } = {}) {
  await ensureCore(db);
  const mode = (await kvGet(db, ['mode'])).mode || 'sheet';
  if (mode === 'd1') throw new Error('이미 D1 기준으로 전환됐어요. 가져오기를 하면 새 데이터가 덮어써져요.');
  const t = body.tables && typeof body.tables === 'object' ? body.tables : {};
  const arr = (k) => (Array.isArray(t[k]) ? t[k] : []).filter((r) => r && typeof r === 'object');
  const at = nowIso(now);
  const out = {};
  const stmts = [];
  const cRows = arr('coupons').filter((r) => validId(String(r.id || ''))).map((r) => {
    const row = couponRow({ ...r, id: String(r.id), channels: splitCsv(r.channels), programs: splitCsv(r.programs), issues: String(r.issues || '').split('; ').filter(Boolean) }, r.last_run_id, text(r.checked_at));
    row.first_seen = text(r.first_seen); row.updated_at = text(r.updated_at);
    return row;
  });
  const nRows = arr('news').filter((r) => validId(String(r.id || ''))).map((r) => {
    const row = newsRow({ ...r, id: String(r.id), programs: splitCsv(r.programs), related_ids: splitCsv(r.related_ids), issues: String(r.issues || '').split('; ').filter(Boolean) }, r.last_run_id, text(r.checked_at));
    row.first_seen = text(r.first_seen); row.updated_at = text(r.updated_at);
    return row;
  });
  const brands = await brandIds(db, [...cRows, ...nRows], at);
  for (const row of cRows) stmts.push(upsertStmt(db, 'coupons', COUPON_COLS, row, { confirmed_at: row.checked_at, brand_id: brands.get(row.brand) ?? null }));
  for (const row of nRows) stmts.push(upsertStmt(db, 'news', NEWS_COLS, row, { confirmed_at: row.checked_at, brand_id: brands.get(row.brand) ?? null }));
  out.coupons = cRows.length; out.news = nRows.length;
  const sRows = arr('sources').filter((r) => validId(String(r.id || '')));
  for (const r of sRows) {
    const row = {}; for (const c of SOURCE_COLS) row[c] = text(r[c], 1000);
    stmts.push(upsertStmt(db, 'sources', SOURCE_COLS, row));
  }
  out.sources = sRows.length;
  const rRows = arr('run_log').filter((r) => validId(String(r.run_id || ''))).slice(-400);
  for (const r of rRows) stmts.push(db.prepare(`INSERT OR REPLACE INTO runs (${RUN_COLS.map((c) => `"${c}"`).join(', ')}) VALUES (${RUN_COLS.map(() => '?').join(', ')})`).bind(...RUN_COLS.map((c) => text(r[c], 2000))));
  out.runs = rRows.length;
  const props = body.props && typeof body.props === 'object' ? body.props : {};
  for (const k of IMPORT_PROPS) if (typeof props[k] === 'string' && props[k]) stmts.push(kvSetStmt(db, k, text(props[k], 40)));
  stmts.push(kvSetStmt(db, 'imported_at', at), dropPublicCache(db));
  await runAll(db, stmts);
  return out;
}

// ---------- HTTP ----------
const json = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
async function sameToken(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || expected.length < 24 || given.length > 400) return false;
  const h = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([h(given), h(expected)]);
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function readBody(request, max) {
  const raw = await request.text();
  if (raw.length > max) throw new Error('too large');
  const body = JSON.parse(raw);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('bad json');
  return body;
}

/** POST /api/collector — 수집기 전용 (COLLECTOR_TOKEN). 토큰이 등록되지 않았으면 전부 거절 */
export async function handleCollector(request, env, { now = Date.now() } = {}) {
  if (!env || !env.DB) return json({ ok: false, error: 'no_db' });
  let body;
  try { body = await readBody(request, 4_000_000); } catch (e) { return json({ ok: false, error: e.message === 'too large' ? 'too large' : 'bad json' }); }
  if (!(await sameToken(body.token, env.COLLECTOR_TOKEN))) return json({ ok: false, error: 'unauthorized' });
  const db = env.DB;
  try {
    switch (body.action) {
      case 'run_start': return json(await runStart(db, body, { now }));
      case 'sources': return json({ ok: true, sources: await getSources(db) });
      case 'ingest': return json({ ok: true, result: await ingest(db, body, { now }) });
      case 'run_finish': return json(await runFinish(db, body.report, { now }));
      case 'news_periods': return json({ ok: true, periods: await newsPeriods(db) });
      case 'import': return json({ ok: true, result: await importSheet(db, body, { now }) });
      // 전환 전 비교용: D1 표로 만든 공개 응답 (아직 방문자에게는 나가지 않는다)
      case 'preview_public': return json({ ok: true, body: JSON.parse(await publicCoupons(db, { now })) });
      default: return json({ ok: false, error: 'unknown action' });
    }
  } catch (e) {
    console.error('collector api failed', body.action, e && e.message);
    return json({ ok: false, error: String((e && e.message) || 'server_error').slice(0, 200) });
  }
}

/** POST /api/admin — 관리자 전용 (ADMIN_TOKEN) */
export async function handleAdmin(request, env, { now = Date.now() } = {}) {
  if (!env || !env.DB) return json({ ok: false, error: 'no_db' });
  let body;
  try { body = await readBody(request, 100_000); } catch (e) { return json({ ok: false, error: e.message === 'too large' ? 'too large' : 'bad json' }); }
  if (!(await sameToken(body.token, env.ADMIN_TOKEN))) return json({ ok: false, error: 'unauthorized' });
  const db = env.DB;
  try {
    switch (body.action) {
      case 'override_set': return json(await setOverride(db, body, { now }));
      case 'hide': return json(await setHidden(db, { ...body, hidden: true }, { now }));
      case 'unhide': return json(await setHidden(db, { ...body, hidden: false }, { now }));
      case 'audit_list': return json({ ok: true, log: await auditList(db, body) });
      default: return json({ ok: false, error: 'unknown action' });
    }
  } catch (e) {
    console.error('admin api failed', body.action, e && e.message);
    return json({ ok: false, error: String((e && e.message) || 'server_error').slice(0, 200) });
  }
}
