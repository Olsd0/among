// AMONG 새 백엔드 1단계 (11/17 대표 결정: Cloudflare D1로 단계별 전환).
// 방문자용 조회(쿠폰·공지·앱 쿠폰·영양성분·온라인 특가)를 D1에서 내려 준다.
// - 지금은 수집·관리가 아직 Apps Script(시트)에 쓰므로, D1은 시트 쪽 공개 응답을 몇 분마다 받아 와 저장한다(공개 자료만 · 토큰 없음).
// - 응답은 시트 쪽과 글자 하나까지 같다(api_snapshots). 쿠폰·공지는 행 단위 테이블에도 넣어 둔다 → 다음 단계(찜·새 쿠폰 알림)의 바탕.
// - D1이 없거나 실패하면 { ok:false }를 주고, 화면은 기존 Apps Script로 돌아간다(중단 없음).
// 비밀값·개인정보는 저장하지 않는다.

export const UPSTREAM_DEFAULT = 'https://script.google.com/macros/s/AKfycbyF_tCoI5S-k1zZOvTbH9YNB7gaW7poFks4meja13ggJX8T29RUEZbONotyzaoiUoXQ/exec';
const UPSTREAM_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
// 다시 받아 오는 간격(초). 그 사이에는 저장된 응답을 그대로 준다.
export const ACTIONS = { coupons: 180, app_coupons: 180, online_deals: 300, nutrition: 6 * 3600 };
const MAX_BODY = 1_800_000;        // D1 한 칸 한도(2MB)보다 작게
const MAX_STALE_S = 36 * 3600;     // 이보다 오래 못 받아 왔으면 D1 응답을 쓰지 않는다(화면이 Apps Script로)
const LOCK_S = 60;

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS api_snapshots (
     action TEXT PRIMARY KEY, body TEXT NOT NULL DEFAULT '', hash TEXT NOT NULL DEFAULT '',
     fetched_at TEXT NOT NULL DEFAULT '', changed_at TEXT NOT NULL DEFAULT '', refresh_started_at TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS coupons (
     id TEXT PRIMARY KEY, brand TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
     start_date TEXT, end_date TEXT, hash TEXT NOT NULL, data TEXT NOT NULL,
     first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL, gone_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS news (
     id TEXT PRIMARY KEY, brand TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
     start_date TEXT, end_date TEXT, hash TEXT NOT NULL, data TEXT NOT NULL,
     first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL, gone_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS coupons_brand ON coupons (brand, gone_at)`,
  `CREATE INDEX IF NOT EXISTS coupons_seen ON coupons (first_seen_at)`,
  `CREATE INDEX IF NOT EXISTS news_brand ON news (brand, gone_at)`,
  `CREATE INDEX IF NOT EXISTS news_seen ON news (first_seen_at)`,
];

let schemaReady = new WeakSet();
async function ensureSchema(db) {
  if (schemaReady.has(db)) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  schemaReady.add(db);
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const iso = (ms) => new Date(ms).toISOString();
const str = (v) => (v === null || v === undefined ? '' : String(v)).slice(0, 300);
const dateOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

/** 행 단위 테이블 맞추기: 바뀐 행만 쓰고(무료 쓰기 한도 보호), 사라진 행은 지우지 않고 gone_at만 적는다 */
export async function syncRows(db, table, rows, nowIso) {
  if (table !== 'coupons' && table !== 'news') throw new Error('bad table');
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === 'object' && typeof r.id === 'string' && r.id && r.id.length <= 120);
  const known = new Map(((await db.prepare(`SELECT id, hash, gone_at FROM ${table}`).all()).results || []).map((r) => [r.id, r]));
  const seen = new Set();
  const stmts = [];
  for (const r of list) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const data = JSON.stringify(r);
    const hash = await sha256(data);
    const old = known.get(r.id);
    if (old && old.hash === hash && !old.gone_at) continue;
    stmts.push(db.prepare(
      `INSERT INTO ${table} (id, brand, category, title, start_date, end_date, hash, data, first_seen_at, updated_at, gone_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, NULL)
       ON CONFLICT(id) DO UPDATE SET brand = ?2, category = ?3, title = ?4, start_date = ?5, end_date = ?6, hash = ?7, data = ?8, updated_at = ?9, gone_at = NULL`,
    ).bind(r.id, str(r.brand), str(r.category), str(r.title || r.menu), dateOrNull(r.start_date), dateOrNull(r.end_date), hash, data, nowIso));
  }
  for (const [id, old] of known) {
    if (!seen.has(id) && !old.gone_at) stmts.push(db.prepare(`UPDATE ${table} SET gone_at = ?1 WHERE id = ?2`).bind(nowIso, id));
  }
  for (let i = 0; i < stmts.length; i += 40) await db.batch(stmts.slice(i, i + 40));
  return { rows: seen.size, written: stmts.length };
}

/** 시트 쪽 공개 응답을 받아 와 저장. 같은 내용이면 확인 시각만 고친다 */
export async function refresh(env, action, { fetchImpl = fetch, now = Date.now() } = {}) {
  const db = env.DB;
  const upstream = String(env.UPSTREAM_API_URL || UPSTREAM_DEFAULT).trim();
  if (!UPSTREAM_RE.test(upstream)) throw new Error('bad upstream');
  const u = new URL(upstream); u.searchParams.set('action', action);
  const res = await fetchImpl(u.href, { redirect: 'follow', signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const body = await res.text();
  if (body.length > MAX_BODY) throw new Error('upstream too large');
  let data;
  try { data = JSON.parse(body); } catch { throw new Error('upstream not json'); }
  if (!data || data.ok !== true) throw new Error('upstream not ok');
  const hash = await sha256(body);
  const nowIso = iso(now);
  const prev = await db.prepare('SELECT hash FROM api_snapshots WHERE action = ?1').bind(action).first();
  if (prev && prev.hash === hash) {
    await db.prepare('UPDATE api_snapshots SET fetched_at = ?1 WHERE action = ?2').bind(nowIso, action).run();
    return { body, changed: false };
  }
  if (action === 'coupons') {
    await syncRows(db, 'coupons', data.coupons, nowIso);
    await syncRows(db, 'news', data.news, nowIso);
  }
  await db.prepare(
    `INSERT INTO api_snapshots (action, body, hash, fetched_at, changed_at) VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT(action) DO UPDATE SET body = ?2, hash = ?3, fetched_at = ?4, changed_at = ?4`,
  ).bind(action, body, hash, nowIso).run();
  return { body, changed: true };
}

/** 한 번에 한 요청만 다시 받아 오게 (동시에 여러 방문자가 와도 Apps Script를 한 번만 부른다) */
async function takeLock(db, action, now) {
  await db.prepare('INSERT OR IGNORE INTO api_snapshots (action) VALUES (?1)').bind(action).run();
  const r = await db.prepare('UPDATE api_snapshots SET refresh_started_at = ?1 WHERE action = ?2 AND refresh_started_at < ?3')
    .bind(iso(now), action, iso(now - LOCK_S * 1000)).run();
  return !!(r.meta && r.meta.changes === 1);
}

const reply = (body, extra = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra },
});
const fail = (error) => reply({ ok: false, error });

/**
 * GET /api/public?action=coupons[&min=ISO시각]
 * min: 이 시각 뒤에 받아 온 응답이어야 한다(바로 확인을 누른 뒤 새 결과를 받을 때). 아니면 그 자리에서 다시 받아 온다.
 */
export async function handlePublic(request, env, ctx = {}, { fetchImpl = fetch, now = Date.now() } = {}) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'coupons';
  if (!Object.hasOwn(ACTIONS, action)) return fail('unknown action');
  if (!env || !env.DB) return fail('no_db');
  try {
    await ensureSchema(env.DB);
    const row = await env.DB.prepare('SELECT body, fetched_at FROM api_snapshots WHERE action = ?1').bind(action).first();
    const has = !!(row && row.body);
    const age = has ? (now - Date.parse(row.fetched_at)) / 1000 : Infinity;
    const minMs = Date.parse(url.searchParams.get('min') || '');
    const wantNewer = has && Number.isFinite(minMs) && minMs <= now && Date.parse(row.fetched_at) < minMs && age > 20;
    const headers = (at, how) => ({ 'x-among-source': 'd1', 'x-among-fetched-at': at, 'x-among-cache': how });
    if (has && age < ACTIONS[action] && !wantNewer) return reply(row.body, headers(row.fetched_at, 'hit'));
    const run = () => refresh(env, action, { fetchImpl, now });
    if (has && !wantNewer && age < MAX_STALE_S) {
      // 저장된 응답을 먼저 주고, 뒤에서 새로 받아 온다
      if (await takeLock(env.DB, action, now)) {
        const p = run().catch((e) => console.error('refresh failed', action, e && e.message));
        if (ctx.waitUntil) ctx.waitUntil(p); else await p;
      }
      return reply(row.body, headers(row.fetched_at, 'stale'));
    }
    await takeLock(env.DB, action, now);
    const fresh = await run();
    return reply(fresh.body, headers(iso(now), 'fresh'));
  } catch (e) {
    console.error('public api failed', action, e && e.message);
    return fail('unavailable');
  }
}
