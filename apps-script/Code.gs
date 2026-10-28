/**
 * AMONG 시트 백엔드 (Google Apps Script 웹앱)
 * ------------------------------------------------------------
 * 탭: coupons · news · sources · run_log · events · reports · nutrition
 * 공개 API (토큰 없음): GET coupons(+ 소식 news 포함) · status · nutrition / POST refresh · event · report
 * 수집기 API (COLLECTOR_TOKEN): POST run_start · sources · ingest · run_finish · nutrition_ingest
 *
 * 코드를 새 버전으로 배포하면 첫 요청 때 migrate_()가 새 열·탭·출처를 자동으로 추가한다 (SCHEMA_VERSION).
 * 00시 정시 수집: 편집기에서 installTriggers() 1회 실행 → 매일 00시대에 scheduledCollect()가 GitHub 수집을 부른다.
 * 관리 API (ADMIN_TOKEN): POST metrics
 *
 * 스크립트 속성 (프로젝트 설정 → 스크립트 속성):
 *   COLLECTOR_TOKEN   수집기와 공유하는 임의의 긴 문자열 (GitHub Secret과 같은 값)
 *   ADMIN_TOKEN       지표 대시보드용 임의의 긴 문자열
 *   GITHUB_TOKEN      fine-grained PAT (대상 저장소 1개, Actions: Read and write)
 *   GITHUB_REPO       owner/repo
 *   GITHUB_WORKFLOW   collect.yml (기본값)
 *   GITHUB_REF        main (기본값)
 *   REFRESH_COOLDOWN_MIN  10 (기본값)
 *   REFRESH_DAILY_MAX     6 (기본값, '바로 갱신' 버튼 하루 상한 — AI 무료 한도 보호)
 *
 * 보안 (v6):
 *   - 공개 POST(refresh·event·report)는 시트의 쿠폰·소식·출처를 바꿀 수 없다. 바꾸는 요청은 모두 토큰 필요
 *   - 공개 요청은 크기 4KB 이하, 브라우저 id 형식 검사, 빈도 제한(CacheService), 동시 기록은 잠금으로 순서대로
 *   - 공개 입력은 시트 수식으로 해석되지 않게 막고(=,+,-,@ 시작), 제보 메모의 전화번호·메일 주소는 지워서 저장
 *   - 이용 기록 180일·제보 365일이 지나면 수집 마무리(run_finish) 때 자동 삭제
 *   - 토큰 없는 요청에는 내부 오류 문구를 돌려주지 않음 (server_error)
 *
 * 최초 1회: 편집기에서 setup() 실행 → 탭·머리글 생성, 예시 출처 입력.
 */

// 최초 1회 실행 함수 (편집기 기본 선택이 되도록 맨 위에 둠)
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach((name) => ensureSheet_(ss, name));
  const src = sheet_('sources');
  if (src.getLastRow() < 2) {
    SAMPLE_SOURCES_.forEach((s) => appendRow_('sources', s));
  }
  const p = PropertiesService.getScriptProperties();
  p.setProperty('SCHEMA_VERSION', String(SCHEMA_VERSION));
  ['COLLECTOR_TOKEN', 'ADMIN_TOKEN'].forEach((k) => {
    if (!p.getProperty(k)) p.setProperty(k, Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  });
  setState_(p, 'idle');
  Logger.log('설정 완료. 스크립트 속성에서 COLLECTOR_TOKEN·ADMIN_TOKEN 값을 확인해 GitHub Secret과 대시보드에 넣으세요.');
}

const TZ = 'Asia/Seoul';
const SHEETS = {
  // 열은 항상 뒤에만 추가한다 (기존 시트의 열 순서를 바꾸지 않기 위해 — migrate_가 빠진 열을 끝에 붙임)
  coupons: ['id', 'status', 'brand', 'category', 'menu', 'item_type', 'regular_price', 'coupon_price', 'discount_rate',
    'discount_type', 'discount_value', 'max_discount', 'min_order', 'channels', 'audience', 'app_only',
    'start_date', 'end_date', 'conditions', 'confidence', 'issues', 'evidence', 'source_id', 'source_url',
    'official_link', 'first_seen', 'checked_at', 'updated_at', 'hash', 'last_run_id',
    'programs', 'program_note', 'how_to_use', 'stackable', 'image_url'],
  // 소식(핫딜·기간 한정 행사): 쿠폰을 가져오는 공식 이벤트·공지 페이지에서 수집 때 함께 갱신 (v5)
  news: ['id', 'status', 'brand', 'category', 'title', 'summary', 'discount_label', 'start_date', 'end_date', 'programs',
    'image_url', 'related_ids', 'evidence', 'issues', 'confidence', 'source_id', 'source_url', 'official_link',
    'first_seen', 'checked_at', 'updated_at', 'hash', 'last_run_id'],
  sources: ['id', 'active', 'brand', 'category', 'url', 'selector', 'exclude', 'follow', 'detail_selector',
    'max_follow', 'max_shots', 'wait_ms', 'official_link', 'notes', 'last_ok_at', 'last_error', 'program', 'follow_text'],
  nutrition: ['brand', 'name', 'serving', 'kcal', 'protein_g', 'fat_g', 'sat_fat_g', 'carb_g', 'sugar_g', 'sodium_mg', 'source', 'updated_at'],
  run_log: ['run_id', 'trigger', 'state', 'started_at', 'finished_at', 'duration_s', 'model', 'sources_ok',
    'sources_failed', 'pages', 'found', 'published', 'pending', 'rejected', 'auto_publish_rate', 'inserted',
    'updated', 'unchanged', 'gone', 'expired', 'input_tokens', 'output_tokens', 'errors'],
  events: ['ts', 'sid', 'type', 'coupon_id', 'brand', 'value'],
  reports: ['ts', 'sid', 'coupon_id', 'brand', 'menu', 'reason', 'memo', 'status'],
};
const PUBLIC_FIELDS = ['id', 'brand', 'category', 'menu', 'item_type', 'regular_price', 'coupon_price', 'discount_rate',
  'discount_type', 'discount_value', 'max_discount', 'min_order', 'channels', 'audience', 'app_only', 'start_date', 'end_date',
  'conditions', 'source_url', 'official_link', 'first_seen', 'checked_at', 'programs', 'program_note', 'how_to_use', 'stackable', 'image_url'];
const NEWS_PUBLIC = ['id', 'brand', 'category', 'title', 'summary', 'discount_label', 'start_date', 'end_date', 'programs',
  'image_url', 'related_ids', 'source_url', 'official_link', 'first_seen', 'checked_at'];
const NUTRITION_NUM = ['kcal', 'protein_g', 'fat_g', 'sat_fat_g', 'carb_g', 'sugar_g', 'sodium_mg'];
const SCHEMA_VERSION = 5;
// 버전별로 새로 생긴 출처 (기존 시트에 자동 추가, 이미 있으면 건드리지 않음)
const NEW_SOURCES = {
  4: ['tmembership-brand', 'kt-membership-food', 'uplus-membership', 'npay-cafe', 'baskin-event', 'paris-promo', 'dunkin-event'],
  5: ['tworld-benefit'],
};
const NUM_FIELDS = ['regular_price', 'coupon_price', 'discount_rate', 'discount_value', 'max_discount', 'min_order', 'confidence'];
const EVENT_TYPES = ['visit', 'click', 'detail', 'refresh', 'share', 'filter'];
const REPORT_REASONS = ['가격이 달라요', '이미 끝났어요', '조건이 달라요', '공식 앱에 없어요', '기타'];
// 공개 API 남용 방지 (v6): [횟수, 초] — 브라우저 하나(sid)와 전체에 각각 적용
const PUBLIC_POST = ['refresh', 'event', 'report'];
const PUBLIC_BODY_MAX = 4000;
const PUBLIC_LIMITS = {
  event: { sid: [120, 600], all: [3000, 3600] },
  report: { sid: [5, 3600], all: [60, 3600] },
};
const REFRESH_DAILY_MAX = 6;
const RETENTION_DAYS = { events: 180, reports: 365 };   // 개인정보처리방침의 보관 기간과 같아야 함
const MAX_ROWS = { events: 200000, reports: 5000 };     // 넘으면 오래된 것부터 지움 (시트 용량 보호)
const SID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const STALE_MIN = 30;           // queued/running 상태가 이보다 오래되면 멈춘 것으로 본다
const CACHE_KEY = 'coupons_v5';
const NUTRITION_CACHE_KEY = 'nutrition_v1';

// ============ 진입점 ============

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    migrate_();
    switch (p.action || 'coupons') {
      case 'coupons': return json_(getCoupons_());
      case 'status': return json_(getStatus_());
      case 'nutrition': return json_(getNutrition_());
      default: return json_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server_error' });
  }
}

function doPost(e) {
  const raw = String((e && e.postData && e.postData.contents) || '{}');
  let body = {};
  try { body = JSON.parse(raw); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json_({ ok: false, error: 'bad json' });
  if (PUBLIC_POST.indexOf(body.action) >= 0 && raw.length > PUBLIC_BODY_MAX) return json_({ ok: false, error: 'too large' });
  let authed = false;
  try {
    migrate_();
    switch (body.action) {
      // 공개 (토큰 없음 — 쿠폰·소식·출처는 바꿀 수 없다)
      case 'refresh': return json_(requestRefresh_());
      case 'event': return json_(logEvent_(body));
      case 'report': return json_(logReport_(body));
      // 수집기
      case 'run_start': authed = auth_(body, 'COLLECTOR_TOKEN'); return json_(runStart_(body));
      case 'sources': authed = auth_(body, 'COLLECTOR_TOKEN'); return json_({ ok: true, sources: getSources_() });
      case 'ingest': authed = auth_(body, 'COLLECTOR_TOKEN'); return json_({ ok: true, result: withLock_(() => ingest_(body)) });
      case 'run_finish': authed = auth_(body, 'COLLECTOR_TOKEN'); return json_(runFinish_(body.report || {}));
      case 'nutrition_ingest': authed = auth_(body, 'COLLECTOR_TOKEN'); return json_({ ok: true, result: withLock_(() => ingestNutrition_(body)) });
      // 관리
      case 'metrics': authed = auth_(body, 'ADMIN_TOKEN'); return json_(getMetrics_(body));
      default: return json_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    console.error(err);
    const msg = String(err && err.message || err);
    // 토큰을 확인한 요청(수집기·관리)에만 자세한 오류를 돌려준다
    return json_({ ok: false, error: msg === 'unauthorized' || authed ? msg : 'server_error' });
  }
}

// ============ 공개: 쿠폰 · 상태 ============

function getCoupons_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CACHE_KEY);
  if (hit) return JSON.parse(hit);
  const today = todayKST_();
  const rows = readTable_('coupons').rows
    .filter((r) => r.status === 'published' && (!r.end_date || r.end_date >= today))
    .map((r) => {
      const o = {};
      PUBLIC_FIELDS.forEach((f) => { o[f] = r[f]; });
      NUM_FIELDS.forEach((f) => { if (f in o) o[f] = o[f] === '' ? null : Number(o[f]); });
      o.channels = r.channels ? String(r.channels).split(',').filter(String) : [];
      o.programs = r.programs ? String(r.programs).split(',').filter(String) : [];
      o.app_only = r.app_only === true || String(r.app_only).toUpperCase() === 'TRUE';
      return o;
    });
  const props = PropertiesService.getScriptProperties();
  const out = { ok: true, today: today, last_checked_at: props.getProperty('LAST_SUCCESS_AT') || '', count: rows.length, coupons: rows, news: getNews_(today) };
  try { cache.put(CACHE_KEY, JSON.stringify(out), 120); } catch (err) { /* 100KB 초과 시 캐시 생략 */ }
  return out;
}

/** 게시 중이고 끝나지 않은 소식 (홈 '오늘의 핫딜'용) */
function getNews_(today) {
  return readTable_('news').rows
    .filter((r) => r.status === 'published' && (!r.end_date || r.end_date >= today))
    .map((r) => {
      const o = {};
      NEWS_PUBLIC.forEach((f) => { o[f] = r[f]; });
      o.programs = r.programs ? String(r.programs).split(',').filter(String) : [];
      o.related_ids = r.related_ids ? String(r.related_ids).split(',').filter(String) : [];
      return o;
    });
}

function getStatus_() {
  const p = PropertiesService.getScriptProperties();
  const state = currentState_(p);
  const cooldownMin = Number(p.getProperty('REFRESH_COOLDOWN_MIN') || 10);
  const lastReq = Number(p.getProperty('LAST_REFRESH_REQ_MS') || 0);
  const remain = Math.max(0, Math.ceil((lastReq + cooldownMin * 60000 - Date.now()) / 1000));
  return {
    ok: true,
    state: state,                                   // idle | queued | running
    run_id: p.getProperty('RUN_ID') || '',
    started_at: p.getProperty('RUN_STARTED_AT') || '',
    last_finished_at: p.getProperty('LAST_FINISHED_AT') || '',
    last_state: p.getProperty('LAST_STATE') || '',
    last_checked_at: p.getProperty('LAST_SUCCESS_AT') || '',
    cooldown_s: remain,
    schedule: '매일 00:00 (KST)',
    nutrition_updated_at: p.getProperty('NUTRITION_UPDATED_AT') || '',
  };
}

function currentState_(p) {
  const state = p.getProperty('RUN_STATE') || 'idle';
  const since = Number(p.getProperty('RUN_STATE_MS') || 0);
  if (state !== 'idle' && Date.now() - since > STALE_MIN * 60000) return 'idle';
  return state;
}

function setState_(p, state) {
  p.setProperties({ RUN_STATE: state, RUN_STATE_MS: String(Date.now()) });
}

// ============ 공개: 즉시 갱신 (D4) ============

function requestRefresh_() {
  return withLock_(() => {
    const p = PropertiesService.getScriptProperties();
    const state = currentState_(p);
    if (state !== 'idle') return { ok: true, accepted: false, reason: state, status: getStatus_() };
    const cooldownMin = Number(p.getProperty('REFRESH_COOLDOWN_MIN') || 10);
    const lastReq = Number(p.getProperty('LAST_REFRESH_REQ_MS') || 0);
    const lastFinished = Date.parse(p.getProperty('LAST_FINISHED_AT') || '') || 0;
    const since = Math.max(lastReq, lastFinished);
    const remain = Math.ceil((since + cooldownMin * 60000 - Date.now()) / 1000);
    if (remain > 0) return { ok: true, accepted: false, reason: 'cooldown', retry_after_s: remain, status: getStatus_() };
    // 하루 상한: 누구나 누를 수 있는 버튼이 AI 무료 한도를 다 써서 00시 수집을 막지 않게
    const day = todayKST_();
    const used = p.getProperty('REFRESH_DAY') === day ? Number(p.getProperty('REFRESH_COUNT') || 0) : 0;
    const max = Number(p.getProperty('REFRESH_DAILY_MAX') || REFRESH_DAILY_MAX);
    if (used >= max) return { ok: true, accepted: false, reason: 'daily_limit', status: getStatus_() };

    const res = dispatchWorkflow_('button');
    if (!res.ok) {
      // 자세한 원인(토큰 미설정·GitHub 응답)은 관리 지표에서만 보이게
      p.setProperties({ LAST_REFRESH_ERROR: String(res.error).slice(0, 200), LAST_REFRESH_ERROR_AT: nowIso_() });
      return { ok: false, error: 'refresh_unavailable' };
    }
    p.setProperties({ LAST_REFRESH_REQ_MS: String(Date.now()), REFRESH_DAY: day, REFRESH_COUNT: String(used + 1) });
    setState_(p, 'queued');
    appendRow_('events', { ts: nowIso_(), sid: '', type: 'refresh', coupon_id: '', brand: '', value: 'dispatched' });
    return { ok: true, accepted: true, status: getStatus_() };
  });
}

function dispatchWorkflow_(trigger) {
  const p = PropertiesService.getScriptProperties();
  const token = p.getProperty('GITHUB_TOKEN');
  const repo = p.getProperty('GITHUB_REPO');
  if (!token || !repo) return { ok: false, error: 'GITHUB_TOKEN / GITHUB_REPO 미설정' };
  const wf = p.getProperty('GITHUB_WORKFLOW') || 'collect.yml';
  const ref = p.getProperty('GITHUB_REF') || 'main';
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + repo + '/actions/workflows/' + wf + '/dispatches', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    payload: JSON.stringify({ ref: ref, inputs: { trigger: trigger } }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 204) return { ok: true };
  return { ok: false, error: 'GitHub ' + code + ': ' + String(res.getContentText()).slice(0, 200) };
}

// ============ 공개: 이용 기록 · 제보 ============

function logEvent_(b) {
  const type = String(b.type || '');
  if (EVENT_TYPES.indexOf(type) < 0) return { ok: false, error: 'bad type' };
  const sid = String(b.sid || '');
  if (!SID_RE.test(sid)) return { ok: false, error: 'bad sid' };
  // 너무 잦거나 잠금이 바쁜 기록은 조용히 버린다 (화면 동작에는 영향 없음)
  const result = appendPublic_('events', {
    ts: nowIso_(), sid: sid, type: type,
    coupon_id: idOrEmpty_(b.coupon_id), brand: text_(b.brand, 30), value: text_(b.value, 100),
  }, 'event', sid);
  return result === 'saved' ? { ok: true } : { ok: true, dropped: true };
}

function logReport_(b) {
  const sid = String(b.sid || '');
  if (!SID_RE.test(sid)) return { ok: false, error: 'bad sid' };
  const reason = REPORT_REASONS.indexOf(b.reason) >= 0 ? b.reason : '기타';
  const result = appendPublic_('reports', {
    ts: nowIso_(), sid: sid, coupon_id: idOrEmpty_(b.coupon_id), brand: text_(b.brand, 30),
    menu: text_(b.menu, 80), reason: reason, memo: text_(scrubPersonal_(b.memo), 500, true), status: '새 제보',
  }, 'report', sid);
  return result === 'saved' ? { ok: true } : { ok: false, error: result === 'limited' ? 'too_many' : 'busy' };
}

/** 공개 요청 빈도 제한. 호출자는 반드시 스크립트 잠금을 갖고 있어야 한다. CacheService는 축출될 수 있어 보조적인 제한이다. */
function rateOk_(kind, sid) {
  const L = PUBLIC_LIMITS[kind];
  const now = Date.now();
  const keys = [
    ['rl_' + kind + '_a_' + Math.floor(now / (L.all[1] * 1000)), L.all],
    ['rl_' + kind + '_s_' + sid + '_' + Math.floor(now / (L.sid[1] * 1000)), L.sid],
  ];
  const cache = CacheService.getScriptCache();
  const got = cache.getAll(keys.map((k) => k[0])) || {};
  if (keys.some((k) => Number(got[k[0]] || 0) >= k[1][0])) return false;
  keys.forEach((k) => cache.put(k[0], String(Number(got[k[0]] || 0) + 1), k[1][1] + 60));
  return true;
}

/** 빈도 검사·기록을 같은 잠금 안에서 처리해 동시 요청이 횟수 제한을 지나치지 않게 한다. */
function appendPublic_(name, obj, kind, sid) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return 'busy';
  try {
    if (!rateOk_(kind, sid)) return 'limited';
    appendRow_(name, obj);
    return 'saved';
  } finally { lock.releaseLock(); }
}

/** 공개 입력 → 시트에 넣을 안전한 글자: 제어문자 제거, 길이 제한, 수식으로 해석될 시작 글자(= + - @) 무력화 */
function text_(v, n, multiline) {
  let s = String(v === undefined || v === null ? '' : v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '');
  s = multiline ? s.replace(/\r\n?/g, '\n') : s.replace(/[\r\n\t]+/g, ' ');
  s = s.replace(/^\s+/, '').slice(0, n);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function idOrEmpty_(v) { const s = String(v === undefined || v === null ? '' : v); return ID_RE.test(s) ? s : ''; }

/** 제보 메모에 적힌 전화번호·메일 주소는 저장하지 않는다 (개인정보 최소 수집) */
function scrubPersonal_(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[메일 주소 지움]')
    .replace(/(?:\+?82[-\s.]?)?0?1[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g, '[전화번호 지움]');
}

/** 보관 기간이 지난 이용 기록·제보를 지운다 (오래된 것부터 · 행 수 상한도 함께). 수집 마무리 때 실행 */
function purgeOld_() {
  const out = {};
  Object.keys(RETENTION_DAYS).forEach((name) => {
    const sh = sheet_(name);
    const last = sh.getLastRow();
    if (last < 2) { out[name] = 0; return; }
    const cutoff = Date.now() - RETENTION_DAYS[name] * 86400000;
    const ts = sh.getRange(2, 1, last - 1, 1).getValues();
    // 요청이 동시에 도착하면 기록 시각 순서가 달라질 수 있으므로 전체 행을 확인한다.
    // 시각을 해석할 수 없는 기존 행은 임의로 삭제하지 않고 보존한다.
    const remove = ts.map((r) => {
      const ms = r[0] instanceof Date ? r[0].getTime() : Date.parse(String(r[0]));
      return !isNaN(ms) && ms < cutoff;
    });
    let n = remove.filter(Boolean).length;
    let excess = Math.max(0, ts.length - n - MAX_ROWS[name]);
    // 행 상한을 넘으면 앞에 기록된 행부터 추가로 삭제한다.
    for (let i = 0; excess && i < remove.length; i++) {
      if (!remove[i]) { remove[i] = true; n++; excess--; }
    }
    if (n === ts.length) sh.getRange(2, 1, ts.length, Math.max(1, sh.getLastColumn())).clearContent();
    else {
      // 뒤에서 연속 구간별로 지워 나머지 행 번호가 바뀌어도 빠뜨리지 않는다.
      for (let i = remove.length - 1; i >= 0;) {
        if (!remove[i]) { i--; continue; }
        const end = i;
        while (i >= 0 && remove[i]) i--;
        sh.deleteRows(i + 3, end - i);
      }
    }
    out[name] = n;
  });
  return out;
}

// ============ 수집기 ============

function runStart_(b) {
  const p = PropertiesService.getScriptProperties();
  setState_(p, 'running');
  p.setProperties({ RUN_ID: String(b.run_id || ''), RUN_STARTED_AT: String(b.started_at || nowIso_()) });
  return { ok: true };
}

function getSources_() {
  return readTable_('sources').rows.filter((r) => r.url && String(r.active).toUpperCase() !== 'FALSE');
}

/**
 * 수집 결과 반영.
 * - 새 쿠폰: 추가 (first_seen 기록)
 * - 같은 id: 내용(hash)이 바뀌었으면 갱신, 아니면 확인 시각만 갱신
 * - 이번 실행에 성공한 출처에서 더 이상 보이지 않는 쿠폰: gone
 *   (실패한 출처의 쿠폰은 건드리지 않는다 — 일시적 오류로 쿠폰이 사라지지 않게)
 * - 종료일이 지난 쿠폰: expired
 * - 팀원이 status를 hidden으로 바꾼 쿠폰은 자동으로 되살리지 않는다 (제보 처리용)
 */
function ingest_(b) {
  const sh = sheet_('coupons');
  const t = readTable_('coupons');
  const headers = t.headers;
  const rows = t.rows;
  const index = {};
  rows.forEach((r, i) => { index[r.id] = i; });
  const now = nowIso_();
  const today = todayKST_();
  const okSources = {};
  (b.sources_ok || []).forEach((s) => { okSources[s] = true; });
  const seen = {};
  const result = { inserted: 0, updated: 0, unchanged: 0, gone: 0, expired: 0 };

  (b.coupons || []).forEach((c) => {
    if (!c || !c.id || seen[c.id]) return;
    seen[c.id] = true;
    const row = couponToRow_(c, b.run_id, b.checked_at || now);
    if (c.id in index) {
      const old = rows[index[c.id]];
      if (old.status === 'hidden') {
        old.checked_at = row.checked_at; old.last_run_id = row.last_run_id;
        result.unchanged++;
      } else if (old.hash === row.hash && old.status === row.status) {
        old.checked_at = row.checked_at; old.last_run_id = row.last_run_id;
        result.unchanged++;
      } else {
        row.first_seen = old.first_seen || now;
        row.updated_at = now;
        rows[index[c.id]] = row;
        result.updated++;
      }
    } else {
      row.first_seen = now;
      row.updated_at = now;
      index[c.id] = rows.length;
      rows.push(row);
      result.inserted++;
    }
  });

  rows.forEach((r) => {
    if (seen[r.id]) return;
    if ((r.status === 'published' || r.status === 'pending') && okSources[r.source_id]) {
      r.status = 'gone'; r.updated_at = now; result.gone++;
    }
  });
  rows.forEach((r) => {
    if (r.status !== 'expired' && r.status !== 'hidden' && r.end_date && r.end_date < today) {
      r.status = 'expired'; r.updated_at = now; result.expired++;
    }
  });

  writeTable_(sh, headers, rows);
  // 소식: 예전 수집기(소식을 보내지 않음)면 소식 탭을 건드리지 않는다
  if (Array.isArray(b.news)) result.news = ingestNews_(b, okSources);
  CacheService.getScriptCache().remove(CACHE_KEY);
  return result;
}

/** 소식 반영: 쿠폰과 같은 규칙 (id로 upsert · 성공한 출처에서 안 보이면 gone · 기간 지나면 expired · hidden은 되살리지 않음) */
function ingestNews_(b, okSources) {
  const sh = sheet_('news');
  const t = readTable_('news');
  const rows = t.rows;
  const index = {};
  rows.forEach((r, i) => { index[r.id] = i; });
  const now = nowIso_();
  const today = todayKST_();
  const seen = {};
  const result = { inserted: 0, updated: 0, unchanged: 0, gone: 0, expired: 0 };
  b.news.forEach((n) => {
    if (!n || !n.id || seen[n.id]) return;
    seen[n.id] = true;
    const row = {};
    SHEETS.news.forEach((h) => { row[h] = n[h] === undefined || n[h] === null ? '' : n[h]; });
    row.programs = (n.programs || []).join(',');
    row.related_ids = (n.related_ids || []).join(',');
    row.issues = (n.issues || []).join('; ');
    row.title = clip_(n.title, 60);
    row.summary = clip_(n.summary, 300);
    row.checked_at = b.checked_at || now;
    row.last_run_id = b.run_id || '';
    if (n.id in index) {
      const old = rows[index[n.id]];
      if (old.status === 'hidden' || (old.hash === row.hash && old.status === row.status)) {
        old.checked_at = row.checked_at; old.last_run_id = row.last_run_id;
        result.unchanged++;
      } else {
        row.first_seen = old.first_seen || now;
        row.updated_at = now;
        rows[index[n.id]] = row;
        result.updated++;
      }
    } else {
      row.first_seen = now;
      row.updated_at = now;
      index[n.id] = rows.length;
      rows.push(row);
      result.inserted++;
    }
  });
  rows.forEach((r) => {
    if (!seen[r.id] && (r.status === 'published' || r.status === 'pending') && okSources[r.source_id]) { r.status = 'gone'; r.updated_at = now; result.gone++; }
    if (r.status !== 'expired' && r.status !== 'hidden' && r.end_date && r.end_date < today) { r.status = 'expired'; r.updated_at = now; result.expired++; }
  });
  writeTable_(sh, t.headers, rows);
  return result;
}

function couponToRow_(c, runId, checkedAt) {
  const r = {};
  SHEETS.coupons.forEach((h) => { r[h] = c[h] === undefined || c[h] === null ? '' : c[h]; });
  r.channels = (c.channels || []).join(',');
  r.programs = (c.programs || []).join(',');
  r.issues = (c.issues || []).join('; ');
  r.app_only = c.app_only ? 'TRUE' : 'FALSE';
  r.checked_at = checkedAt;
  r.last_run_id = runId || '';
  return r;
}

function runFinish_(rep) {
  const p = PropertiesService.getScriptProperties();
  const s = rep.summary || {};
  const ing = rep.ingest || {};
  const srcs = rep.sources || [];
  appendRow_('run_log', {
    run_id: rep.run_id, trigger: rep.trigger, state: rep.state, started_at: rep.started_at, finished_at: rep.finished_at,
    duration_s: rep.duration_s, model: rep.model,
    sources_ok: srcs.filter((x) => x.ok).length, sources_failed: srcs.filter((x) => !x.ok).length,
    pages: rep.pages, found: s.total, published: s.published, pending: s.pending, rejected: s.rejected,
    auto_publish_rate: s.auto_publish_rate === null || s.auto_publish_rate === undefined ? '' : s.auto_publish_rate,
    inserted: ing.inserted, updated: ing.updated, unchanged: ing.unchanged, gone: ing.gone, expired: ing.expired,
    input_tokens: rep.input_tokens, output_tokens: rep.output_tokens, errors: (rep.errors || []).join(' | ').slice(0, 2000),
  });

  // 출처별 최근 상태
  const t = readTable_('sources');
  const byId = {};
  srcs.forEach((x) => { byId[x.id] = x; });
  let touched = false;
  t.rows.forEach((r) => {
    const x = byId[r.id];
    if (!x) return;
    touched = true;
    if (x.ok) { r.last_ok_at = rep.finished_at || nowIso_(); r.last_error = ''; }
    else r.last_error = String(x.error || '').slice(0, 300);
  });
  if (touched) writeTable_(sheet_('sources'), t.headers, t.rows);

  setState_(p, 'idle');
  p.setProperties({ LAST_FINISHED_AT: rep.finished_at || nowIso_(), LAST_STATE: rep.state || '' });
  if ((rep.state === 'success' || rep.state === 'partial') && rep.trigger !== 'e2e') p.setProperty('LAST_SUCCESS_AT', rep.finished_at || nowIso_());
  CacheService.getScriptCache().remove(CACHE_KEY);
  // 매일 수집이 끝날 때 보관 기간이 지난 이용 기록·제보를 지운다 (실패해도 수집 결과에는 영향 없음)
  let purged = null;
  try { purged = withLock_(() => purgeOld_()); } catch (err) { console.error(err); }
  if (purged) p.setProperties({ LAST_PURGE_AT: nowIso_(), LAST_PURGE: JSON.stringify(purged) });
  return { ok: true, purged: purged };
}

// ============ 관리: 지표 ============

function getMetrics_(b) {
  const days = Math.min(Number(b.days) || 30, 90);
  const today = todayKST_();
  const sinceDay = addDays_(today, -(days - 1));
  const coupons = readTable_('coupons').rows;
  const runs = readTable_('run_log').rows;
  const events = readTable_('events').rows.filter((e) => kstDay_(e.ts) >= sinceDay);
  const reports = readTable_('reports').rows;
  const sources = readTable_('sources').rows;

  // 쿠폰 현황
  const byStatus = {};
  const byBrand = {};
  const byProgram = {};
  coupons.filter((c) => c.status === 'published' && (!c.end_date || c.end_date >= today)).forEach((c) => {
    String(c.programs || '').split(',').filter(String).forEach((pg) => { byProgram[pg] = (byProgram[pg] || 0) + 1; });
  });
  let nutritionCount = 0;
  try { nutritionCount = readTable_('nutrition').rows.length; } catch (err) { /* 탭 없음 */ }
  coupons.forEach((c) => {
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    if (c.status === 'published' && (!c.end_date || c.end_date >= today)) byBrand[c.brand] = (byBrand[c.brand] || 0) + 1;
  });
  const pendingReasons = {};
  coupons.filter((c) => c.status === 'pending').forEach((c) => {
    String(c.issues || '').split('; ').filter(String).forEach((i) => { pendingReasons[i] = (pendingReasons[i] || 0) + 1; });
  });

  // 이용 지표 (sid = 브라우저별 무작위 id, 개인정보 없음)
  const daily = {};
  for (let d = sinceDay; d <= today; d = addDays_(d, 1)) daily[d] = { date: d, visitors: 0, clicks: 0, details: 0, refresh: 0 };
  const visitorsByDay = {};
  const firstVisit = {};
  const visitDays = {};
  const brandsBySession = {};   // sid|day → { brand: true }
  const clickedSession = {};
  const visitSession = {};
  readTable_('events').rows.forEach((e) => {
    if (e.type !== 'visit' || !e.sid) return;
    const d = kstDay_(e.ts);
    if (!firstVisit[e.sid] || d < firstVisit[e.sid]) firstVisit[e.sid] = d;
    (visitDays[e.sid] = visitDays[e.sid] || {})[d] = true;
  });
  events.forEach((e) => {
    const d = kstDay_(e.ts);
    const row = daily[d];
    if (!row) return;
    const key = e.sid + '|' + d;
    if (e.type === 'visit' && e.sid) {
      visitorsByDay[d] = visitorsByDay[d] || {};
      if (!visitorsByDay[d][e.sid]) { visitorsByDay[d][e.sid] = true; row.visitors++; }
      visitSession[key] = true;
    }
    if (e.type === 'click') { row.clicks++; clickedSession[key] = true; }
    if (e.type === 'detail') row.details++;
    if (e.type === 'refresh') row.refresh++;
    if ((e.type === 'click' || e.type === 'detail') && e.brand && e.sid) {
      (brandsBySession[key] = brandsBySession[key] || {})[e.brand] = true;
    }
  });
  const sessions = Object.keys(visitSession);
  const withClick = sessions.filter((k) => clickedSession[k]).length;
  const engaged = Object.keys(brandsBySession);
  const multiBrand = engaged.filter((k) => Object.keys(brandsBySession[k]).length >= 2).length;
  // 7일 재방문율: 첫 방문 후 1~7일 안에 다시 온 비율 (첫 방문이 7일 이상 지난 사람 기준)
  const eligible = Object.keys(firstVisit).filter((s) => firstVisit[s] <= addDays_(today, -7) && firstVisit[s] >= sinceDay);
  const returned = eligible.filter((s) => {
    const f = firstVisit[s];
    return Object.keys(visitDays[s]).some((d) => d > f && d <= addDays_(f, 7));
  }).length;

  const allVisitors = {};
  Object.keys(visitorsByDay).forEach((d) => { Object.keys(visitorsByDay[d]).forEach((sid) => { allVisitors[sid] = true; }); });
  const recentRuns = runs.slice(-14).reverse();
  const rates = runs.slice(-7).map((r) => Number(r.auto_publish_rate)).filter((x) => !isNaN(x) && String(x) !== '');
  return {
    ok: true,
    generated_at: nowIso_(),
    period: { from: sinceDay, to: today, days: days },
    collection: {
      last_success_at: PropertiesService.getScriptProperties().getProperty('LAST_SUCCESS_AT') || '',
      auto_publish_rate_7runs: rates.length ? round_(rates.reduce((a, b2) => a + Number(b2), 0) / rates.length, 3) : null,
      coupons_by_status: byStatus,
      published_by_brand: byBrand,
      published_by_program: byProgram,
      nutrition_items: nutritionCount,
      news_published: readTable_('news').rows.filter((r) => r.status === 'published' && (!r.end_date || r.end_date >= today)).length,
      coupons_with_image: readTable_('coupons').rows.filter((r) => r.status === 'published' && r.image_url).length,
      nutrition_updated_at: PropertiesService.getScriptProperties().getProperty('NUTRITION_UPDATED_AT') || '',
      pending_reasons: pendingReasons,
      runs: recentRuns,
      tokens_7runs: runs.slice(-7).reduce((a, r) => a + Number(r.input_tokens || 0) + Number(r.output_tokens || 0), 0),
      sources: sources.map((s) => ({ id: s.id, brand: s.brand, active: s.active, url: s.url, last_ok_at: s.last_ok_at, last_error: s.last_error })),
    },
    usage: {
      visitors: Object.keys(allVisitors).length,
      sessions: sessions.length,
      click_session_rate: sessions.length ? round_(withClick / sessions.length, 3) : null,
      multi_brand_rate: engaged.length ? round_(multiBrand / engaged.length, 3) : null,
      engaged_sessions: engaged.length,
      retention_7d: eligible.length ? round_(returned / eligible.length, 3) : null,
      retention_7d_base: eligible.length,
      daily: Object.keys(daily).sort().map((d) => daily[d]),
    },
    reports: {
      total: reports.length,
      open: reports.filter((r) => r.status === '새 제보').length,
      recent: reports.slice(-20).reverse(),
    },
    security: (() => {
      const p = PropertiesService.getScriptProperties();
      return {
        refresh_today: p.getProperty('REFRESH_DAY') === today ? Number(p.getProperty('REFRESH_COUNT') || 0) : 0,
        refresh_daily_max: Number(p.getProperty('REFRESH_DAILY_MAX') || REFRESH_DAILY_MAX),
        last_refresh_error: p.getProperty('LAST_REFRESH_ERROR') || '',
        last_refresh_error_at: p.getProperty('LAST_REFRESH_ERROR_AT') || '',
        retention_days: RETENTION_DAYS,
        last_purge_at: p.getProperty('LAST_PURGE_AT') || '',
        last_purge: p.getProperty('LAST_PURGE') || '',
      };
    })(),
  };
}

// ============ 영양성분 (식약처 공공데이터 → 수집기 → 이 탭) ============

function getNutrition_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(NUTRITION_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  const items = readTable_('nutrition').rows.filter((r) => r.brand && r.name).map((r) => {
    const o = { brand: r.brand, name: r.name, serving: r.serving, source: r.source };
    NUTRITION_NUM.forEach((f) => { o[f] = r[f] === '' || r[f] === undefined ? null : Number(r[f]); });
    return o;
  });
  const out = { ok: true, updated_at: PropertiesService.getScriptProperties().getProperty('NUTRITION_UPDATED_AT') || '', count: items.length, items: items };
  try { cache.put(NUTRITION_CACHE_KEY, JSON.stringify(out), 3600); } catch (err) { /* 100KB 초과 시 캐시 생략 */ }
  return out;
}

/** 영양성분 표 전체 교체. 빈 목록으로 지우는 실수를 막기 위해 items가 없으면 거절 */
function ingestNutrition_(b) {
  const items = (b.items || []).filter((x) => x && x.brand && x.name);
  if (!items.length) throw new Error('nutrition items가 비어 있음 (기존 표 유지)');
  const now = nowIso_();
  const t = readTable_('nutrition');
  const rows = items.map((x) => {
    const r = {};
    SHEETS.nutrition.forEach((h) => { r[h] = x[h] === undefined || x[h] === null ? '' : x[h]; });
    r.updated_at = now;
    return r;
  });
  writeTable_(sheet_('nutrition'), t.headers, rows);
  PropertiesService.getScriptProperties().setProperty('NUTRITION_UPDATED_AT', now);
  CacheService.getScriptCache().remove(NUTRITION_CACHE_KEY);
  const brands = {};
  rows.forEach((r) => { brands[r.brand] = (brands[r.brand] || 0) + 1; });
  return { count: rows.length, brands: brands };
}

// ============ 자동 마이그레이션 (새 버전 배포 후 첫 요청에서 1회) ============

function migrate_() {
  const p = PropertiesService.getScriptProperties();
  if (Number(p.getProperty('SCHEMA_VERSION') || 0) >= SCHEMA_VERSION) return;
  withLock_(() => {
    if (Number(p.getProperty('SCHEMA_VERSION') || 0) >= SCHEMA_VERSION) return;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    Object.keys(SHEETS).forEach((name) => ensureSheet_(ss, name));
    const have = {};
    readTable_('sources').rows.forEach((r) => { have[r.id] = true; });
    const from = Number(p.getProperty('SCHEMA_VERSION') || 0);
    const add = [];
    Object.keys(NEW_SOURCES).forEach((v) => { if (Number(v) > from) NEW_SOURCES[v].forEach((id) => add.push(id)); });
    SAMPLE_SOURCES_.filter((x) => add.indexOf(x.id) >= 0 && !have[x.id]).forEach((x) => appendRow_('sources', x));
    CacheService.getScriptCache().remove(CACHE_KEY);
    p.setProperty('SCHEMA_VERSION', String(SCHEMA_VERSION));
  });
}

/** 탭이 없으면 만들고, 머리글에 빠진 열을 끝에 붙인다 (기존 열 순서·데이터는 그대로) */
function ensureSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const want = SHEETS[name];
  const lastCol = sh.getLastColumn();
  const have = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String).filter(String) : [];
  const missing = want.filter((h) => have.indexOf(h) < 0);
  if (!have.length) {
    sh.getRange(1, 1, 1, want.length).setValues([want]).setFontWeight('bold');
  } else if (missing.length) {
    sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
  }
  sh.setFrozenRows(1);
  // 날짜·숫자 자동 변환 방지 (시트가 '2026-10-31'을 날짜 객체로 바꾸지 않게)
  sh.getRange(1, 1, sh.getMaxRows(), Math.max(have.length + missing.length, want.length)).setNumberFormat('@');
}

// ============ 00시 정시 수집 (GitHub 예약 실행은 지연이 커서 백업으로만) ============

/** 시간 트리거가 매일 00시대에 부른다. 오늘 이미 성공했거나 실행 중이면 건너뜀 */
function scheduledCollect() {
  migrate_();
  const p = PropertiesService.getScriptProperties();
  if (kstDay_(p.getProperty('LAST_SUCCESS_AT') || '') === todayKST_()) return 'skip: 오늘 이미 수집함';
  if (currentState_(p) !== 'idle') return 'skip: 실행 중';
  const res = withLock_(() => dispatchWorkflow_('schedule'));
  if (!res.ok) { Logger.log('00시 수집 호출 실패: ' + res.error); return res.error; }
  p.setProperty('LAST_REFRESH_REQ_MS', String(Date.now()));
  setState_(p, 'queued');
  return 'dispatched';
}

/** 편집기에서 1회 실행: 매일 00시대 트리거 설치 (다시 실행해도 1개만 유지) */
function installTriggers() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'scheduledCollect')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('scheduledCollect').timeBased().atHour(0).nearMinute(5).everyDays(1).inTimezone(TZ).create();
  Logger.log('설치 완료: 매일 00시대에 scheduledCollect 실행 (GitHub 토큰 GITHUB_TOKEN·GITHUB_REPO 필요)');
}

// ============ 초기 설정 ============


// 출처 초기값 (2026-10-25 확인 — README의 출처 표 참고, active=FALSE는 확인이 더 필요한 것)
// collector/sources.example.json 과 같아야 한다 (테스트가 확인)
const SAMPLE_SOURCES_ = [
  {
    "id": "mcd-promo",
    "active": "TRUE",
    "brand": "맥도날드",
    "category": "햄버거",
    "url": "https://www.mcdonalds.co.kr/kor/promotion/list",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='/kor/promotion/detail/']",
    "detail_selector": "",
    "max_follow": 5,
    "max_shots": 3,
    "wait_ms": 1500,
    "official_link": "https://www.mcdonalds.co.kr/kor/promotion/list",
    "notes": "상세에 정상가·행사가 글자. 종료일 대부분 없음",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "bk-event",
    "active": "TRUE",
    "brand": "버거킹",
    "category": "햄버거",
    "url": "https://www.burgerking.co.kr/event/ongoing",
    "selector": "",
    "exclude": "header; footer",
    "follow": "",
    "detail_selector": "",
    "max_follow": 0,
    "max_shots": 4,
    "wait_ms": 2500,
    "official_link": "https://www.burgerking.co.kr/event/ongoing",
    "notes": "목록 배너만(상세는 클릭으로만 열림)",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "kfc-promo",
    "active": "TRUE",
    "brand": "KFC",
    "category": "햄버거",
    "url": "https://www.kfckorea.com/promotion/promotionList/A801",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='/promotion/promotionList/detail/']",
    "detail_selector": "",
    "max_follow": 4,
    "max_shots": 3,
    "wait_ms": 1500,
    "official_link": "https://www.kfckorea.com/promotion/promotionList/A801",
    "notes": "목록에 행사명·기간 글자, 상세는 이미지",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "popeyes-event",
    "active": "TRUE",
    "brand": "파파이스",
    "category": "햄버거",
    "url": "https://www.popeyes.co.kr/event",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='popeyes.co.kr/event/']",
    "detail_selector": "",
    "max_follow": 4,
    "max_shots": 3,
    "wait_ms": 1500,
    "official_link": "https://www.popeyes.co.kr/event",
    "notes": "1+1·할인 행사 목록",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "moms-promo",
    "active": "FALSE",
    "brand": "맘스터치",
    "category": "햄버거",
    "url": "https://momstouch.co.kr/promotion/list.php",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='promotion/view.php']",
    "detail_selector": "",
    "max_follow": 4,
    "max_shots": 3,
    "wait_ms": 1000,
    "official_link": "https://momstouch.co.kr/promotion/list.php",
    "notes": "해외 서버 접속 차단 → 국내에서 실행 필요",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "lotte-event",
    "active": "FALSE",
    "brand": "롯데리아",
    "category": "햄버거",
    "url": "https://www.lotteeatz.com/event/main",
    "selector": "",
    "exclude": "header; footer",
    "follow": "",
    "detail_selector": "",
    "max_follow": 0,
    "max_shots": 3,
    "wait_ms": 1500,
    "official_link": "https://www.lotteeatz.com/event/main",
    "notes": "robots.txt 차단 → 자동 수집 불가",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "starbucks-event",
    "active": "TRUE",
    "brand": "스타벅스",
    "category": "카페",
    "url": "https://www.starbucks.co.kr/whats_new/campaign_list.do",
    "selector": "",
    "exclude": "header; footer",
    "follow": "",
    "detail_selector": "",
    "max_follow": 0,
    "max_shots": 3,
    "wait_ms": 2000,
    "official_link": "https://www.starbucks.co.kr/whats_new/campaign_list.do",
    "notes": "이벤트 목록(행사명·기간 글자). 상세는 클릭으로만 열림",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "ediya-event",
    "active": "TRUE",
    "brand": "이디야",
    "category": "카페",
    "url": "https://www.ediya.com/contents/event.html?tb_name=event",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='bbs_section=view']",
    "detail_selector": "",
    "max_follow": 4,
    "max_shots": 3,
    "wait_ms": 1500,
    "official_link": "https://www.ediya.com/contents/event.html?tb_name=event",
    "notes": "이벤트 목록(이미지 위주)",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "mega-event",
    "active": "TRUE",
    "brand": "메가MGC커피",
    "category": "카페",
    "url": "https://www.mega-mgccoffee.com/bbs/?bbs_category=3",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='/bbs/detail/']",
    "detail_selector": "",
    "max_follow": 4,
    "max_shots": 3,
    "wait_ms": 1500,
    "official_link": "https://www.mega-mgccoffee.com/bbs/?bbs_category=3",
    "notes": "이벤트 게시판",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "paik-event",
    "active": "TRUE",
    "brand": "빽다방",
    "category": "카페",
    "url": "https://paikdabang.com/news/?cate=event",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='/post_news/']",
    "detail_selector": "",
    "max_follow": 4,
    "max_shots": 3,
    "wait_ms": 1500,
    "official_link": "https://paikdabang.com/news/?cate=event",
    "notes": "이벤트 게시판",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "hollys-event",
    "active": "TRUE",
    "brand": "할리스",
    "category": "카페",
    "url": "https://www.hollys.co.kr/news/event/list.do",
    "selector": "",
    "exclude": "header; footer",
    "follow": "",
    "detail_selector": "",
    "max_follow": 0,
    "max_shots": 3,
    "wait_ms": 1500,
    "official_link": "https://www.hollys.co.kr/news/event/list.do",
    "notes": "이벤트 목록(행사명·기간 글자). 상세는 클릭으로만 열림",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "paulbassett-benefit",
    "active": "TRUE",
    "brand": "폴바셋",
    "category": "카페",
    "url": "https://www.baristapaulbassett.co.kr/society/Partnership.pb",
    "selector": "",
    "exclude": "header; footer",
    "follow": "",
    "detail_selector": "",
    "max_follow": 0,
    "max_shots": 3,
    "wait_ms": 1500,
    "official_link": "https://www.baristapaulbassett.co.kr/society/Partnership.pb",
    "notes": "제휴 할인(% 글자)",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "twosome-event",
    "active": "FALSE",
    "brand": "투썸플레이스",
    "category": "카페",
    "url": "https://www.twosome.co.kr/",
    "selector": "",
    "exclude": "header; footer",
    "follow": "",
    "detail_selector": "",
    "max_follow": 0,
    "max_shots": 3,
    "wait_ms": 1500,
    "official_link": "https://www.twosome.co.kr/",
    "notes": "해외 서버 403 → 국내에서 실행 필요",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "compose-event",
    "active": "FALSE",
    "brand": "컴포즈커피",
    "category": "카페",
    "url": "https://composecoffee.com/",
    "selector": "",
    "exclude": "header; footer",
    "follow": "",
    "detail_selector": "",
    "max_follow": 0,
    "max_shots": 3,
    "wait_ms": 1500,
    "official_link": "https://composecoffee.com/",
    "notes": "해외 서버 403 → 국내에서 실행 필요",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "bbq-event",
    "active": "TRUE",
    "brand": "BBQ",
    "category": "치킨",
    "url": "https://bbq.co.kr/events",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='bbq.co.kr/events/']",
    "detail_selector": "",
    "max_follow": 2,
    "max_shots": 3,
    "wait_ms": 2000,
    "official_link": "https://bbq.co.kr/events",
    "notes": "이벤트 목록",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "bhc-event",
    "active": "TRUE",
    "brand": "bhc",
    "category": "치킨",
    "url": "https://www.bhc.co.kr/event/currentEvent",
    "selector": "",
    "exclude": "header; footer",
    "follow": "",
    "detail_selector": "",
    "max_follow": 0,
    "max_shots": 3,
    "wait_ms": 1500,
    "official_link": "https://www.bhc.co.kr/event/currentEvent",
    "notes": "진행중 이벤트 목록(행사명·기간 글자)",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "kyochon-event",
    "active": "TRUE",
    "brand": "교촌치킨",
    "category": "치킨",
    "url": "https://m.kyochon.com/event/event_list",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='event_view']",
    "detail_selector": "",
    "max_follow": 4,
    "max_shots": 3,
    "wait_ms": 1500,
    "official_link": "https://m.kyochon.com/event/event_list",
    "notes": "이벤트 목록",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "goobne-event",
    "active": "TRUE",
    "brand": "굽네치킨",
    "category": "치킨",
    "url": "https://www.goobne.co.kr/brd/event/list_p",
    "selector": "",
    "exclude": "header; footer",
    "follow": "",
    "detail_selector": "",
    "max_follow": 0,
    "max_shots": 3,
    "wait_ms": 1500,
    "official_link": "https://www.goobne.co.kr/brd/event/list_p",
    "notes": "이벤트 목록(할인액·기간 글자). 상세는 클릭으로만 열림",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "purak-event",
    "active": "TRUE",
    "brand": "푸라닭",
    "category": "치킨",
    "url": "https://www.puradakchicken.com/news/event.asp",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='mode=view']",
    "detail_selector": "",
    "max_follow": 4,
    "max_shots": 3,
    "wait_ms": 1500,
    "official_link": "https://www.puradakchicken.com/news/event.asp",
    "notes": "이벤트 목록",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "dominos-event",
    "active": "TRUE",
    "brand": "도미노피자",
    "category": "피자",
    "url": "https://web.dominos.co.kr/event/list?gubun=E0200",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='/event/viewHtml']",
    "detail_selector": "",
    "max_follow": 4,
    "max_shots": 3,
    "wait_ms": 2000,
    "official_link": "https://web.dominos.co.kr/event/list?gubun=E0200",
    "notes": "이벤트·제휴",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "pizzahut-event",
    "active": "TRUE",
    "brand": "피자헛",
    "category": "피자",
    "url": "https://www.pizzahut.co.kr/cs/event",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='/cs/event/']",
    "detail_selector": "",
    "max_follow": 4,
    "max_shots": 3,
    "wait_ms": 2000,
    "official_link": "https://www.pizzahut.co.kr/cs/event",
    "notes": "이벤트 목록(이미지 위주)",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "papajohns-event",
    "active": "TRUE",
    "brand": "파파존스",
    "category": "피자",
    "url": "https://www.pji.co.kr/event/ongoing",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='/event/ongoing/']",
    "detail_selector": "",
    "max_follow": 4,
    "max_shots": 3,
    "wait_ms": 1500,
    "official_link": "https://www.pji.co.kr/event/ongoing",
    "notes": "목록에 할인율·기간 글자",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "mrpizza-event",
    "active": "TRUE",
    "brand": "미스터피자",
    "category": "피자",
    "url": "https://www.mrpizza.co.kr/bbs/board.php?bo_table=event",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='bo_table=event&wr_id']",
    "detail_selector": "",
    "max_follow": 4,
    "max_shots": 3,
    "wait_ms": 1500,
    "official_link": "https://www.mrpizza.co.kr/bbs/board.php?bo_table=event",
    "notes": "이벤트 게시판(앱 전용 행사 포함)",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "banolim-event",
    "active": "TRUE",
    "brand": "반올림피자",
    "category": "피자",
    "url": "https://order.banolimpizza.com/event/list?eventStatus=all",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='/event/detail/']",
    "detail_selector": "",
    "max_follow": 4,
    "max_shots": 3,
    "wait_ms": 2000,
    "official_link": "https://order.banolimpizza.com/event/list?eventStatus=all",
    "notes": "이벤트 목록",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "tmembership-brand",
    "active": "TRUE",
    "brand": "",
    "category": "",
    "url": "https://m.tworld.co.kr/membership/benefit/brand",
    "selector": "",
    "exclude": "header; footer",
    "follow": "",
    "detail_selector": "",
    "max_follow": 0,
    "max_shots": 6,
    "wait_ms": 2500,
    "official_link": "https://m.tworld.co.kr/membership/benefit/brand",
    "notes": "[v4] 10/27 점검·시험: 글자 3.5천자, 11건 추출(파리바게뜨·뚜레쥬르·공차·도미노·롯데리아·폴바셋·던킨·메가·피자헛·파파존스)",
    "program": "SKT",
    "follow_text": ""
  },
  {
    "id": "tworld-benefit",
    "active": "TRUE",
    "brand": "",
    "category": "",
    "url": "https://m.tworld.co.kr/v6/benefit",
    "selector": "",
    "exclude": "header; footer",
    "follow": "",
    "detail_selector": "",
    "max_follow": 0,
    "max_shots": 6,
    "wait_ms": 2500,
    "official_link": "https://m.tworld.co.kr/v6/benefit",
    "notes": "[v5] 10/28 탐색: T world 혜택 모음(가격 10·% 12) — T멤버십 이달의 행사·소식용. 우리 브랜드·외식 업종만 추출",
    "program": "SKT",
    "follow_text": ""
  },
  {
    "id": "kt-membership-food",
    "active": "FALSE",
    "brand": "",
    "category": "",
    "url": "https://membership.kt.com/discount/partner/PartnerList.do",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='/discount/partner/']",
    "detail_selector": "",
    "max_follow": 10,
    "max_shots": 3,
    "wait_ms": 2000,
    "official_link": "https://membership.kt.com/discount/partner/PartnerList.do",
    "notes": "[v4] 10/27 점검: 해외(GitHub) 서버에서 robots.txt 응답 없음(시간 초과) → 국내 수집기 필요. 상세 예: /discount/partner/C21/68/PartnerDetail.do = 도미노",
    "program": "KT",
    "follow_text": "맥도날드|버거킹|롯데리아|맘스터치|KFC|파파이스|스타벅스|이디야|메가|빽다방|할리스|폴바셋|투썸|컴포즈|공차|파스쿠찌|BBQ|bhc|교촌|굽네|푸라닭|도미노|피자헛|파파존스|미스터피자|반올림|파리바게|뚜레쥬르|배스킨|던킨"
  },
  {
    "id": "uplus-membership",
    "active": "FALSE",
    "brand": "",
    "category": "",
    "url": "https://m.lguplus.com/benefit-membership?urcMbspDivsCd=01&urcMbspBnftDivsCd=02",
    "selector": "",
    "exclude": "header; footer",
    "follow": "",
    "detail_selector": "",
    "max_follow": 0,
    "max_shots": 6,
    "wait_ms": 3000,
    "official_link": "https://m.lguplus.com/membership/intro",
    "notes": "[v4] 10/27 점검: 글자 105자만 보임(목록을 스크립트로 그림) → 다른 주소 찾기 전까지 꺼둠",
    "program": "LGU+",
    "follow_text": ""
  },
  {
    "id": "npay-cafe",
    "active": "TRUE",
    "brand": "",
    "category": "카페",
    "url": "https://campaign2.naver.com/npay/cafe/",
    "selector": "",
    "exclude": "header; footer",
    "follow": "",
    "detail_selector": "",
    "max_follow": 0,
    "max_shots": 4,
    "wait_ms": 2000,
    "official_link": "https://campaign2.naver.com/npay/cafe/",
    "notes": "[v4] 10/27 점검: robots 허용, 캠페인 글자 확인(카페 결제 최대 5천원 혜택 10/26~11/1)",
    "program": "네이버페이",
    "follow_text": ""
  },
  {
    "id": "baskin-event",
    "active": "TRUE",
    "brand": "배스킨라빈스",
    "category": "디저트",
    "url": "https://www.baskinrobbins.co.kr/play/event/list.php",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='view.php?seq=']",
    "detail_selector": "",
    "max_follow": 4,
    "max_shots": 4,
    "wait_ms": 1500,
    "official_link": "https://www.baskinrobbins.co.kr/play/event/list.php",
    "notes": "[v4] 10/27 시험: 상세 24개 중 4개, 9건 게시(해피포인트 결제·적립 혜택 포함)",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "paris-promo",
    "active": "TRUE",
    "brand": "파리바게뜨",
    "category": "디저트",
    "url": "https://www.paris.co.kr/promotion/",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='/promotion/']",
    "detail_selector": "",
    "max_follow": 4,
    "max_shots": 4,
    "wait_ms": 1500,
    "official_link": "https://www.paris.co.kr/promotion/",
    "notes": "[v4] 10/27 시험: 상세 17개 중 4개, 3건 게시",
    "program": "",
    "follow_text": ""
  },
  {
    "id": "dunkin-event",
    "active": "FALSE",
    "brand": "던킨",
    "category": "디저트",
    "url": "https://www.dunkindonuts.co.kr/event",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='/event/view']",
    "detail_selector": "",
    "max_follow": 4,
    "max_shots": 4,
    "wait_ms": 1500,
    "official_link": "https://www.dunkindonuts.co.kr/",
    "notes": "[v4] 10/27 점검: 목록이 이미지뿐(글자 160자), 상세 링크 0개 → 꺼둠",
    "program": "",
    "follow_text": ""
  }
];

// ============ 유틸 ============

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function auth_(body, key) {
  const expected = PropertiesService.getScriptProperties().getProperty(key);
  if (!expected || typeof body.token !== 'string' || body.token !== expected) throw new Error('unauthorized');
  return true;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('시트 탭 없음: ' + name + ' (setup() 실행 필요)');
  return sh;
}

function cellToStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return v;
}

function readTable_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const headers = (values[0] || []).map(String);
  const rows = values.slice(1).filter((r) => r.some((v) => v !== '')).map((r) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = cellToStr_(r[i]); });
    return o;
  });
  return { headers: headers.length ? headers : SHEETS[name], rows: rows };
}

function writeTable_(sh, headers, rows) {
  const data = rows.map((r) => headers.map((h) => (r[h] === undefined || r[h] === null ? '' : String(r[h]))));
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, headers.length).clearContent();
  if (data.length) {
    ensureRows_(sh, data.length + 1);
    const range = sh.getRange(2, 1, data.length, headers.length);
    range.setNumberFormat('@');
    range.setValues(data);
  }
}

function appendRow_(name, obj) {
  const sh = sheet_(name);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const row = headers.map((h) => (obj[h] === undefined || obj[h] === null ? '' : String(obj[h])));
  const r = sh.getLastRow() + 1;
  ensureRows_(sh, r);
  const range = sh.getRange(r, 1, 1, headers.length);
  range.setNumberFormat('@');
  range.setValues([row]);
}

/** 시트의 행이 모자라면 500행씩 늘린다 (탭의 마지막 행을 넘으면 기록이 실패하므로). 새 행도 글자 서식 */
function ensureRows_(sh, need) {
  const max = sh.getMaxRows();
  if (need <= max) return;
  const add = Math.max(need - max, 500);
  sh.insertRowsAfter(max, add);
  sh.getRange(max + 1, 1, add, Math.max(1, sh.getMaxColumns())).setNumberFormat('@');
}

function clip_(v, n) { return String(v === undefined || v === null ? '' : v).slice(0, n); }
function nowIso_() { return new Date().toISOString(); }
function todayKST_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function kstDay_(iso) { const t = Date.parse(iso); return isNaN(t) ? '' : Utilities.formatDate(new Date(t), TZ, 'yyyy-MM-dd'); }
function addDays_(day, n) { const t = Date.parse(day + 'T00:00:00Z') + n * 86400000; return new Date(t).toISOString().slice(0, 10); }
function round_(x, d) { const m = Math.pow(10, d); return Math.round(x * m) / m; }
