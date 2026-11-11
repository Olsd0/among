/**
 * AMONG 시트 백엔드 (Google Apps Script 웹앱)
 * ------------------------------------------------------------
 * 탭: coupons · news · sources · run_log · events · reports · nutrition · app_coupons · online_items · online_runs · online_picks · online_leads
 * 공개 API (토큰 없음): GET coupons(+ 소식 news 포함) · status · nutrition · online_deals / POST refresh · event · report
 * 수집기 API (COLLECTOR_TOKEN): POST run_start · sources · ingest · run_finish · nutrition_ingest · online_prices_ingest · online_item_rotate
 *                               · online_run_start · online_ingest · online_run_finish (온라인 특가 — 쿠폰과 분리)
 *
 * 코드를 새 버전으로 배포하면 첫 요청 때 migrate_()가 새 열·탭·출처를 자동으로 추가한다 (SCHEMA_VERSION).
 * 00시 정시 수집: 편집기에서 installTriggers() 1회 실행 → 매일 00시대에 scheduledCollect()가 GitHub 수집을 부른다.
 * 관리 API (ADMIN_TOKEN): POST metrics · app_coupon_* · online_admin · online_admin_set
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
  seedAppCouponDrafts_();
  setState_(p, 'idle');
  Logger.log('설정 완료. 스크립트 속성에서 COLLECTOR_TOKEN·ADMIN_TOKEN 값을 확인해 GitHub Secret과 대시보드에 넣으세요.');
}

const TZ = 'Asia/Seoul';
const SHEETS = {
  app_coupons: ['id', 'status', 'issuer_app', 'brand', 'product_name', 'issue_end', 'use_end', 'checked_at', 'updated_at', 'revision', 'payload'],
  // 열은 항상 뒤에만 추가한다 (기존 시트의 열 순서를 바꾸지 않기 위해 — migrate_가 빠진 열을 끝에 붙임)
  coupons: ['id', 'status', 'brand', 'category', 'menu', 'item_type', 'regular_price', 'coupon_price', 'discount_rate',
    'discount_type', 'discount_value', 'max_discount', 'min_order', 'channels', 'audience', 'app_only',
    'start_date', 'end_date', 'conditions', 'confidence', 'issues', 'evidence', 'source_id', 'source_url',
    'official_link', 'first_seen', 'checked_at', 'updated_at', 'hash', 'last_run_id',
    'programs', 'program_note', 'how_to_use', 'stackable', 'image_url'],
  // 소식(핫딜·기간 한정 행사): 쿠폰을 가져오는 공식 이벤트·공지 페이지에서 수집 때 함께 갱신 (v5)
  news: ['id', 'status', 'brand', 'category', 'title', 'summary', 'discount_label', 'start_date', 'end_date', 'programs',
    'image_url', 'related_ids', 'evidence', 'issues', 'confidence', 'source_id', 'source_url', 'official_link',
    'first_seen', 'checked_at', 'updated_at', 'hash', 'last_run_id',
    // 12: 기간 팩트체크 (11/10 대표 결정) — 근거(공식 원문 | 공식 공지 이미지 | 언론 보도), 기사 '언론사|주소|게시일' 줄(최대 3), 확인 시각
    'period_source', 'period_refs', 'period_checked_at'],
  sources: ['id', 'active', 'brand', 'category', 'url', 'selector', 'exclude', 'follow', 'detail_selector',
    'max_follow', 'max_shots', 'wait_ms', 'official_link', 'notes', 'last_ok_at', 'last_error', 'program', 'follow_text'],
  nutrition: ['brand', 'name', 'serving', 'kcal', 'protein_g', 'fat_g', 'sat_fat_g', 'carb_g', 'sugar_g', 'sodium_mg', 'source', 'updated_at'],
  run_log: ['run_id', 'trigger', 'state', 'started_at', 'finished_at', 'duration_s', 'model', 'sources_ok',
    'sources_failed', 'pages', 'found', 'published', 'pending', 'rejected', 'auto_publish_rate', 'inserted',
    'updated', 'unchanged', 'gone', 'expired', 'input_tokens', 'output_tokens', 'errors'],
  events: ['ts', 'sid', 'type', 'coupon_id', 'brand', 'value'],
  reports: ['ts', 'sid', 'coupon_id', 'brand', 'menu', 'reason', 'memo', 'status'],
  // 온라인 특가 (v7): 프랜차이즈 쿠폰과 분리. 상태·보류 사유 열은 사람이 읽기 위한 사본이며 판단은 읽을 때마다 다시 계산한다.
  online_items: ['key', 'id', 'supplier', 'status', 'holds', 'title', 'price', 'seller', 'category', 'last_received_at', 'ends_at',
    'hidden', 'hidden_reason', 'hidden_at', 'category_override', 'override_until', 'first_seen_at', 'updated_at', 'payload'],
  online_runs: ['run_id', 'trigger', 'started_at', 'finished_at', 'results', 'received', 'published', 'held', 'errors'],
  // 직접 고른 쿠팡 특가 (v8): 최종 승인 전 대표가 관리 화면에서 고른 상품의 파트너스 간편 링크. memo는 관리 화면에만
  online_picks: ['id', 'status', 'title', 'url', 'category', 'note', 'price', 'price_checked_at', 'ends_at', 'hidden', 'memo', 'created_at', 'updated_at', 'image_url', 'item', 'rank'],
  online_price_log: ['pick_id', 'price', 'checked_at'],
  // 핫딜 게시판에서 자동으로 찾은 쿠팡 상품 후보 (관리 화면 전용, 공개 응답에 싣지 않음). 3일 보관
  online_leads: ['key', 'status', 'source', 'title', 'price_hint', 'free_shipping', 'coupang_url', 'affiliate_only', 'post_url', 'posted_at', 'found_at'],
};
const PUBLIC_FIELDS = ['id', 'brand', 'category', 'menu', 'item_type', 'regular_price', 'coupon_price', 'discount_rate',
  'discount_type', 'discount_value', 'max_discount', 'min_order', 'channels', 'audience', 'app_only', 'start_date', 'end_date',
  'conditions', 'source_url', 'official_link', 'first_seen', 'checked_at', 'programs', 'program_note', 'how_to_use', 'stackable', 'image_url'];
const NEWS_PUBLIC = ['id', 'brand', 'category', 'title', 'summary', 'discount_label', 'start_date', 'end_date', 'programs',
  'image_url', 'related_ids', 'source_url', 'official_link', 'first_seen', 'checked_at', 'period_source', 'period_refs'];
const NUTRITION_NUM = ['kcal', 'protein_g', 'fat_g', 'sat_fat_g', 'carb_g', 'sugar_g', 'sodium_mg'];
const SCHEMA_VERSION = 13;   // 13: online_picks.rank (항목별 인기순), 9: online_picks.image_url (쿠팡 파트너스 배너 사진), 10: online_picks.item (항목별 상품), 11: online_price_log (30일 최저), 12: news 기간 팩트체크 열
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
      case 'coupons': return json_(withAppCoupons_(getCoupons_()));
      case 'app_coupons': return json_(getAppCoupons_());
      case 'status': return json_(getStatus_());
      case 'nutrition': return json_(getNutrition_());
      case 'online_deals': return json_(getOnlineDeals_());
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
      case 'news_periods': authed = auth_(body, 'COLLECTOR_TOKEN'); return json_({ ok: true, periods: newsPeriods_() });
      // 관리
      case 'app_coupon_list': authed = auth_(body, 'ADMIN_TOKEN'); return json_(adminAppCoupons_());
      case 'app_coupon_save':
        authed = auth_(body, 'ADMIN_TOKEN');
        if (raw.length > 80000) throw new Error('입력이 너무 커요.');
        return json_(withLock_(() => saveAppCoupon_(body)));
      case 'app_coupon_close': authed = auth_(body, 'ADMIN_TOKEN'); return json_(withLock_(() => closeAppCoupon_(body)));
      case 'app_coupon_duplicates': authed = auth_(body, 'ADMIN_TOKEN'); return json_({ ok: true, duplicates: acDuplicates(acNormalize(body.coupon), readAppCoupons_()).map(c => ({ id: c.id, product_name: c.product_name, audience: acAudience(c) })) });
      case 'metrics': authed = auth_(body, 'ADMIN_TOKEN'); return json_(getMetrics_(body));
      // 온라인 특가 (쿠폰 탭과 분리된 online_items · online_runs만 바꾼다)
      case 'online_run_start': authed = auth_(body, 'COLLECTOR_TOKEN'); return json_(withLock_(() => odRunStart_(body)));
      case 'online_ingest':
        authed = auth_(body, 'COLLECTOR_TOKEN');
        if (raw.length > 800000) throw new Error('입력이 너무 커요.');
        return json_(withLock_(() => odIngest_(body)));
      case 'online_run_finish': authed = auth_(body, 'COLLECTOR_TOKEN'); return json_(withLock_(() => odRunFinish_(body)));
      case 'online_leads_known': authed = auth_(body, 'COLLECTOR_TOKEN'); return json_({ ok: true, keys: odReadLeads_().map(function (l) { return l.key; }) });
      case 'online_leads_ingest':
        authed = auth_(body, 'COLLECTOR_TOKEN');
        if (raw.length > 200000) throw new Error('입력이 너무 커요.');
        return json_(withLock_(() => odLeadsIngest_(body)));
      case 'online_prices_ingest':
        authed = auth_(body, 'COLLECTOR_TOKEN');
        if (raw.length > 50000) throw new Error('입력이 너무 커요.');
        return json_(withLock_(() => odPricesIngest_(body)));
      case 'online_item_rotate':
        authed = auth_(body, 'COLLECTOR_TOKEN');
        if (raw.length > 60000) throw new Error('입력이 너무 커요.');
        return json_(withLock_(() => odItemRotateIngest_(body)));
      case 'online_admin': authed = auth_(body, 'ADMIN_TOKEN'); return json_(odAdmin_());
      case 'online_admin_set':
        authed = auth_(body, 'ADMIN_TOKEN');
        if (raw.length > 60000) throw new Error('입력이 너무 커요.');
        return json_(withLock_(() => odAdminSet_(body)));
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

function dispatchWorkflow_(trigger, workflow) {
  const p = PropertiesService.getScriptProperties();
  // 붙여넣을 때 딸려 온 앞뒤 공백·줄바꿈은 무시한다
  const token = String(p.getProperty('GITHUB_TOKEN') || '').trim();
  const repo = String(p.getProperty('GITHUB_REPO') || '').trim();
  if (!token || !repo) return { ok: false, error: 'GITHUB_TOKEN / GITHUB_REPO 미설정' };
  const wf = workflow || p.getProperty('GITHUB_WORKFLOW') || 'collect.yml';
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
      keepPeriod_(row, old);
      if (old.status === 'hidden' || (old.hash === row.hash && old.status === row.status)) {
        if (old.status !== 'hidden') ['period_source', 'period_refs', 'period_checked_at'].forEach((h) => { if (row[h] !== '') old[h] = row[h]; });
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

/**
 * 기간 팩트체크로 채운 기간은 다음 수집에서 수집기가 확인을 건너뛰어도(끝나는 날 없이 들어와도) 지우지 않는다.
 * 실패 기록(확인 시각만 있음)도 남겨 같은 날 다시 찾지 않게 한다.
 */
function keepPeriod_(row, old) {
  if (!row.period_source && old.period_source && !row.end_date && old.end_date) {
    row.start_date = old.start_date; row.end_date = old.end_date;
    row.period_source = old.period_source; row.period_refs = old.period_refs;
  }
  if (!row.period_checked_at && old.period_checked_at) row.period_checked_at = old.period_checked_at;
}

/** 수집기용: 기간 확인 기록 (확인한 적 있는 소식만) */
function newsPeriods_() {
  return readTable_('news').rows.filter((r) => r.period_checked_at).map((r) => ({
    id: r.id, status: r.status, start_date: r.start_date, end_date: r.end_date,
    period_source: r.period_source, period_refs: r.period_refs, period_checked_at: r.period_checked_at,
  }));
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
    seedAppCouponDrafts_();
    odSeedPriceLog_();
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

/**
 * 편집기에서 실행: '새로 확인' 버튼 연결 점검. 수집을 시작하지 않고(워크플로 조회만) 토큰 값도 기록하지 않는다.
 * 마지막 버튼 오류, 속성 형식, GitHub 응답 코드(401 토큰 틀림·만료 / 403 권한 부족 / 404 저장소 미선택·이름 틀림)를 보여 준다.
 */
function checkRefreshSetup() {
  const p = PropertiesService.getScriptProperties();
  const rawToken = String(p.getProperty('GITHUB_TOKEN') || '');
  const rawRepo = String(p.getProperty('GITHUB_REPO') || '');
  const token = rawToken.trim();
  const repo = rawRepo.trim();
  Logger.log('GITHUB_TOKEN: ' + (token ? '있음 · ' + (/^github_pat_/.test(token) ? 'fine-grained 형식' : /^gh[pousr]_/.test(token) ? 'classic 형식' : '알 수 없는 형식') + (token !== rawToken ? ' · 앞뒤 공백 있음(무시함)' : '') : '없음'));
  Logger.log('GITHUB_REPO: ' + (repo ? JSON.stringify(repo) + (/^[\w.-]+\/[\w.-]+$/.test(repo) ? '' : ' · owner/repo 형식 아님') + (repo !== rawRepo ? ' · 앞뒤 공백 있음(무시함)' : '') : '없음'));
  Logger.log('마지막 버튼 오류: ' + (p.getProperty('LAST_REFRESH_ERROR') || '없음') + ' (' + (p.getProperty('LAST_REFRESH_ERROR_AT') || '-') + ')');
  Logger.log('설치된 트리거: ' + ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction()).join(', '));
  if (!token || !repo) return;
  const wf = p.getProperty('GITHUB_WORKFLOW') || 'collect.yml';
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + repo + '/actions/workflows/' + wf, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  Logger.log('GitHub 워크플로 조회: ' + code + (code === 200 ? ' (토큰·저장소 정상)' : ' ' + String(res.getContentText()).slice(0, 200)));
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

// BEGIN GENERATED APP COUPONS
// Canonical app-coupon rules. sync-web.js also embeds this module in Apps Script.
// No network, account sessions, device scraping, or inferred eligibility.
const AC_APPS = ['버거킹', '맥도날드', '해피포인트'];
const AC_AUDIENCES = { unknown: '미확인', all_members: '전체 회원', tier: '멤버십 등급', new_member: '신규 회원', personalized: '맞춤 혜택', points_member: '포인트 교환 대상', other: '별도 대상' };
const AC_BENEFITS = { unknown: '미확인', price: '구매 가격', amount: '즉시 할인액', percent: '즉시 할인율', bogo: '1+1', point_back: '포인트 환급', point_exchange: '포인트 교환' };
const AC_LINK_LABELS = { event: '공식 행사 보기', app: '공식 앱에서 확인', install: '앱 설치 안내' };
const AC_FACTS = {
  composition: '상품 구성·수량', issue_requirements: '발급 조건', use_hours: '사용 가능 시간',
  channels: '사용 경로·매장', excluded_stores: '제외 매장', min_purchase: '최소 구매액',
  max_discount: '최대 할인액', payment: '결제수단', points: '포인트 차감·환급 조건',
  per_person: '1인 사용 횟수', per_order: '주문당 사용 수', stacking: '중복 할인', early_end: '선착순·조기 종료 조건', other: '기타 유의사항',
};
const AC_STATES = { issuing: '발급 가능', redeem_only: '발급 종료 · 받은 쿠폰 사용 가능', redeem_scheduled: '발급 종료 · 받은 쿠폰 사용 예정', upcoming: '발급 예정', ended: '사용 종료', draft: '초안', archived: '보관' };
const AC_TEXT = ['issuer_app', 'brand', 'product_name', 'item_type', 'benefit_type', 'benefit_note', 'audience_type', 'audience_detail', 'audience_evidence', 'issue_period_state', 'issue_period_note', 'use_period_state', 'source_url', 'source_note', 'official_link', 'link_type', 'app_path', 'rights_state', 'rights_note', 'admin_notes', 'missing_info', 'duplicate_note'];
const AC_NUMBERS = ['final_price', 'regular_price', 'discount_amount', 'discount_rate', 'points_cost'];
function acText(v, max = 12000) {
  const s = v == null ? '' : String(v).trim();
  if (s.length > max) throw new Error('입력이 너무 길어요. 내용을 나누어 주세요.');
  return s;
}
function acTimestamp(value, end = false) {
  if (!value) return '';
  let s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += end ? 'T23:59:59.999+09:00' : 'T00:00:00+09:00';
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s += end ? ':59.999+09:00' : ':00+09:00';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(s) || !Number.isFinite(Date.parse(s))) throw new Error('날짜·시간 형식을 확인해 주세요.');
  return new Date(s).toISOString();
}
function acNormalize(input = {}) {
  const c = {};
  AC_TEXT.forEach(k => { c[k] = acText(input[k]); });
  c.id = acText(input.id, 60);
  if (c.id && !/^[a-zA-Z0-9_-]+$/.test(c.id)) throw new Error('잘못된 쿠폰 ID');
  c.status = ['draft', 'published', 'archived'].includes(input.status) ? input.status : 'draft';
  c.revision = Number.isSafeInteger(Number(input.revision)) ? Number(input.revision) : 0;
  c.tiers = (Array.isArray(input.tiers) ? input.tiers : String(input.tiers || '').split(',')).map(v => acText(v, 80)).filter(Boolean);
  AC_NUMBERS.forEach(k => {
    c[k] = input[k] === '' || input[k] == null ? null : Number(input[k]);
    if (c[k] !== null && (!Number.isFinite(c[k]) || c[k] < 0 || c[k] > 1e8)) throw new Error('금액·비율은 0 이상의 숫자로 입력하세요.');
  });
  if (c.discount_rate !== null && c.discount_rate > 100) throw new Error('할인율은 100% 이하여야 해요.');
  ['issue_start', 'issue_end', 'use_start', 'use_end', 'checked_at', 'link_checked_at', 'updated_at', 'researched_at'].forEach(k => { c[k] = acTimestamp(input[k], /_end$/.test(k)); });
  ['is_max', 'hotdeal_enabled', 'recurring', 'issue_closed', 'use_closed', 'review_required'].forEach(k => { c[k] = input[k] === true; });
  c.facts = {};
  Object.keys(AC_FACTS).forEach(k => {
    const f = input.facts && input.facts[k] || {};
    c.facts[k] = { state: ['verified', 'na'].includes(f.state) ? f.state : 'unknown', value: acText(f.value) };
  });
  c.legacy_refs = (Array.isArray(input.legacy_refs) ? input.legacy_refs : String(input.legacy_refs || '').split(',')).map(v => acText(v, 80)).filter(v => /^(coupon|news):[\w-]+$/.test(v));
  return c;
}
function acOfficialUrl(value, app) {
  const s = String(value || '');
  // HTTPS public links only. Preserve public event IDs, never personal codes or sessions.
  const m = /^https:\/\/([a-z0-9.-]+)(\/[^\s\\<>]*)?$/i.exec(s);
  if (!m || /[\u0000-\u0020]/.test(s) || /%(?:0[0-9a-f]|1[0-9a-f])/i.test(s)) return false;
  const hosts = { '버거킹': ['burgerking.co.kr'], '맥도날드': ['mcdonalds.co.kr'], '해피포인트': ['happypointcard.com', 'happymarket.co.kr', 'shakeshack.kr', 'baskinrobbins.co.kr', 'paris.co.kr', 'dunkindonuts.co.kr'] }[app] || [];
  const host = m[1].toLowerCase();
  if (!hosts.some(h => host === h || host.endsWith('.' + h)) && !['apps.apple.com', 'play.google.com'].includes(host)) return false;
  let decoded;
  try { decoded = decodeURIComponent(s); } catch { return false; }
  return !/(?:[?&#/])(?:access_?token|id_?token|token|session\w*|auth\w*|password|member\w*|user\w*|barcode|coupon_?code|redeem_?code|email|phone|code)=/i.test(decoded) && !/#/.test(s);
}
function acValidate(c, now = Date.now()) {
  const errors = [];
  if (!AC_APPS.includes(c.issuer_app)) errors.push('발급 앱');
  if (!c.brand || !c.product_name || !c.item_type) errors.push('사용 브랜드·상품명·단품/세트 구분');
  if (!c.facts?.composition || c.facts.composition.state !== 'verified' || !c.facts.composition.value) errors.push('상품 구성·수량');
  const benefitOK = { price: c.final_price !== null, amount: c.discount_amount > 0, percent: c.discount_rate > 0, bogo: true, point_back: !!c.benefit_note && (c.discount_rate > 0 || c.discount_amount > 0), point_exchange: c.points_cost > 0 };
  if (!benefitOK[c.benefit_type]) errors.push('혜택 방식·금액');
  if (c.final_price !== null && c.regular_price !== null && c.final_price > c.regular_price) errors.push('기준 가격보다 높은 구매 가격');
  if (!AC_AUDIENCES[c.audience_type] || c.audience_type === 'unknown' || !c.audience_evidence) errors.push('쿠폰별 이용 대상·확인 근거');
  if (c.audience_type === 'tier' && !c.tiers.length) errors.push('확인된 정확한 멤버십 등급');
  if (['other', 'personalized', 'points_member'].includes(c.audience_type) && !c.audience_detail) errors.push('이용 대상의 구체적 조건');
  if (c.issuer_app === '해피포인트' && c.audience_type !== 'all_members') errors.push('해피포인트 전체 회원 대상 확인');
  if (c.issue_period_state === 'na') { if (!c.issue_period_note) errors.push('발급 기간 해당 없음의 근거'); }
  else if (c.issue_period_state !== 'verified' || !c.issue_start || !c.issue_end) errors.push('발급 시작·마감 시점');
  if (c.use_period_state !== 'verified' || !c.use_start || !c.use_end) errors.push('사용 시작·종료 시점');
  for (const p of ['issue', 'use']) if (c[p + '_start'] && c[p + '_end'] && c[p + '_start'] > c[p + '_end']) errors.push(p === 'issue' ? '발급 기간 순서' : '사용 기간 순서');
  if (c.issue_end && c.use_end && c.issue_end > c.use_end) errors.push('사용 종료 이후 발급 마감');
  if (!c.facts?.issue_requirements || c.facts.issue_requirements.state === 'unknown' || (c.facts.issue_requirements.state === 'verified' && !c.facts.issue_requirements.value)) errors.push('발급 조건');
  Object.keys(AC_FACTS).forEach(k => { const f = c.facts?.[k]; if (f?.state === 'verified' && !f.value) errors.push(AC_FACTS[k] + ' 확인 내용'); });
  if (!acOfficialUrl(c.source_url, c.issuer_app) || !c.source_note) errors.push('공식 출처·확인 내용');
  if (!acOfficialUrl(c.official_link, c.issuer_app) || !AC_LINK_LABELS[c.link_type]) errors.push('공식 이용 링크·목적지 종류');
  if (!c.link_checked_at || Date.parse(c.link_checked_at) > now) errors.push('공식 링크 목적지 확인 시점');
  if (c.link_type === 'install' && !c.app_path) errors.push('실제로 확인한 앱 내 이동 경로');
  if (!c.checked_at || Date.parse(c.checked_at) > now) errors.push('실제 조건 확인 시점');
  if (!['facts_only', 'permission'].includes(c.rights_state) || !c.rights_note) errors.push('출처 자료 이용 범위 확인');
  if (c.review_required) errors.push('변경된 조건 재확인');
  return errors;
}
function acLifecycle(c, now = Date.now()) {
  if (c.status !== 'published') return c.status === 'archived' ? 'archived' : 'draft';
  if (c.use_closed || (c.use_end && now > Date.parse(c.use_end))) return 'ended';
  if (c.issue_closed || (c.issue_end && now > Date.parse(c.issue_end))) return c.use_start && now < Date.parse(c.use_start) ? 'redeem_scheduled' : 'redeem_only';
  if (c.issue_start && now < Date.parse(c.issue_start)) return 'upcoming';
  return 'issuing';
}
function acNeedsReview(c, now = Date.now()) {
  return c.review_required || !c.checked_at || now - Date.parse(c.checked_at) > 48 * 3600e3 || acValidate(c, now).length > 0;
}
function acPublic(c, now = Date.now()) {
  if (c.status !== 'published' || acValidate(c, now).length || acLifecycle(c, now) === 'ended') return null;
  const out = { ...c, facts: { ...c.facts }, lifecycle: acLifecycle(c, now), needs_review: acNeedsReview(c, now) };
  ['admin_notes', 'missing_info', 'duplicate_note', 'researched_at'].forEach(k => { delete out[k]; });
  return out;
}
function acAudience(c) {
  return c.audience_type === 'tier' ? c.tiers.join(' · ') + ' 등급' : [AC_AUDIENCES[c.audience_type] || '미확인', c.audience_detail].filter(Boolean).join(' · ');
}
function acBenefit(c) {
  const won = n => Number(n).toLocaleString('ko-KR') + '원';
  const max = c.is_max ? '최대 ' : '';
  switch (c.benefit_type) {
    case 'price': return c.final_price === null ? '가격 미확인' : won(c.final_price);
    case 'amount': return max + won(c.discount_amount) + ' 할인';
    case 'percent': return max + c.discount_rate + '% 즉시 할인';
    case 'bogo': return '1+1';
    case 'point_back': return max + (c.discount_rate !== null ? c.discount_rate + '% ' : c.discount_amount !== null ? won(c.discount_amount) + ' 상당 ' : '') + '포인트 환급';
    case 'point_exchange': return Number(c.points_cost).toLocaleString('ko-KR') + 'P 교환';
    default: return '혜택 미확인';
  }
}
function acHotEligible(c, now = Date.now()) {
  if (!c.hotdeal_enabled || !acPublic(c, now) || acNeedsReview(c, now) || acLifecycle(c, now) !== 'issuing') return false;
  // Happy Point policy applies only to hot deals, never the app-coupon list.
  const rate = ['price', 'amount', 'percent'].includes(c.benefit_type) ? c.discount_rate || 0 : 0;
  return c.benefit_type === 'bogo' || rate >= (c.issuer_app === '해피포인트' ? 50 : 30);
}
function acDuplicates(c, rows) {
  const key = s => String(s || '').replace(/\s+/g, '').toLowerCase();
  return rows.filter(x => x.id !== c.id && x.status !== 'archived' && x.issuer_app === c.issuer_app && x.brand === c.brand &&
    ((c.link_type === 'event' && c.official_link && x.official_link === c.official_link) ||
      (key(c.product_name) && key(x.product_name) === key(c.product_name) && (!c.use_end || !x.use_start || c.use_end >= x.use_start) && (!x.use_end || !c.use_start || x.use_end >= c.use_start))));
}
function acKST(v, short = false) {
  if (!v || !Number.isFinite(Date.parse(v))) return '미확인';
  const s = new Date(Date.parse(v) + 9 * 3600e3).toISOString();
  return (short ? s.slice(5, 10) : s.slice(0, 10)) + ' ' + s.slice(11, 16);
}

// Embedded into Code.gs by collector/scripts/sync-web.js. Do not paste as a second GAS file.
function readAppCoupons_() {
  return readTable_('app_coupons').rows.map(function(r) {
    try { return acNormalize(JSON.parse(r.payload)); } catch (err) { console.error('Invalid app coupon row: ' + r.id); return null; }
  }).filter(Boolean);
}
function appCouponRow_(c) {
  const payload = JSON.stringify(c);
  if (payload.length > 45000) throw new Error('쿠폰 내용은 45,000자 이내로 저장하세요. 긴 조건을 삭제하지 말고 공식 출처를 함께 정리해 주세요.');
  const r = { payload: payload };
  SHEETS.app_coupons.filter(function(k) { return k !== 'payload'; }).forEach(function(k) { const s = String(c[k] == null ? '' : c[k]); r[k] = /^[=+@-]/.test(s) ? "'" + s : s; });
  return r;
}
function getAppCoupons_() {
  const rows = readAppCoupons_();
  return { ok: true, app_coupons: rows.map(function(c) { return acPublic(c); }).filter(Boolean),
    // References keep old collected copies out of both surfaces after the managed record ends.
    app_coupon_refs: [].concat.apply([], rows.filter(function(c) { return c.status !== 'draft'; }).map(function(c) { return c.legacy_refs; })) };
}
function withAppCoupons_(out) {
  const app = getAppCoupons_();
  out.coupons = out.coupons.filter(function(c) { return app.app_coupon_refs.indexOf('coupon:' + c.id) < 0; });
  out.news = out.news.filter(function(c) { return app.app_coupon_refs.indexOf('news:' + c.id) < 0; });
  out.count = out.coupons.length;
  out.app_coupons = app.app_coupons;
  out.app_coupon_refs = app.app_coupon_refs;
  return out;
}
function adminAppCoupons_() {
  return { ok: true, coupons: readAppCoupons_().map(function(c) {
    return Object.assign({}, c, { lifecycle: acLifecycle(c), needs_review: acNeedsReview(c), publish_errors: acValidate(c) });
  }), now: nowIso_(), timezone: TZ };
}
function appCouponContent_(c) {
  const copy = Object.assign({}, c);
  ['id', 'revision', 'status', 'checked_at', 'updated_at', 'link_checked_at', 'researched_at', 'review_required', 'hotdeal_enabled', 'recurring', 'issue_closed', 'use_closed', 'admin_notes', 'missing_info', 'duplicate_note', 'legacy_refs'].forEach(function(k) { delete copy[k]; });
  return JSON.stringify(copy);
}
function saveAppCoupon_(body) {
  const rows = readAppCoupons_();
  let c = acNormalize(body.coupon || {});
  const previous = rows.find(function(x) { return x.id === c.id; });
  if (previous && ((previous.issue_closed && !c.issue_closed) || (previous.use_closed && !c.use_closed)) && body.confirm_checked !== true) throw new Error('마감을 취소하려면 실제 조건을 다시 확인해 주세요.');
  if (c.id && !previous) throw new Error('존재하지 않는 쿠폰입니다. 목록을 다시 불러오세요.');
  if (previous && Number(body.expected_revision) !== previous.revision) throw new Error('다른 곳에서 수정됐어요. 목록을 다시 불러온 뒤 수정하세요.');
  if (!c.id) c.id = 'ac_' + Utilities.getUuid().replace(/-/g, '').slice(0, 26);
  const changed = !previous || appCouponContent_(c) !== appCouponContent_(previous);
  c.checked_at = previous ? previous.checked_at : '';
  c.link_checked_at = previous ? previous.link_checked_at : '';
  c.researched_at = previous ? previous.researched_at : '';
  c.review_required = changed || !!(previous && previous.review_required);
  if (previous && (previous.official_link !== c.official_link || previous.link_type !== c.link_type || previous.app_path !== c.app_path)) c.link_checked_at = '';
  if (body.confirm_link === true) c.link_checked_at = nowIso_();
  if (body.confirm_checked === true) {
    c.checked_at = body.checked_at ? acTimestamp(body.checked_at) : nowIso_();
    if (Date.parse(c.checked_at) > Date.now()) throw new Error('미래 시각을 확인 시점으로 기록할 수 없어요.');
    c.review_required = false;
  }
  const duplicates = acDuplicates(c, rows).map(function(x) { return { id: x.id, product_name: x.product_name, audience: acAudience(x) }; });
  if (c.status === 'published') {
    const errors = acValidate(c);
    if (errors.length) return { ok: false, error: '공개 전 확인 필요: ' + errors.join(' / '), publish_errors: errors };
    if (duplicates.length && !c.duplicate_note) return { ok: false, error: '중복 후보를 먼저 확인하고 다른 쿠폰인 이유를 입력하세요.', duplicates: duplicates };
  }
  c.updated_at = nowIso_();
  c.revision = (previous ? previous.revision : 0) + 1;
  const row = appCouponRow_(c);
  if (previous) {
    const table = readTable_('app_coupons');
    writeTable_(sheet_('app_coupons'), table.headers, table.rows.map(function(r) { return r.id === c.id ? row : r; }));
  } else appendRow_('app_coupons', row);
  CacheService.getScriptCache().remove(CACHE_KEY);
  return { ok: true, coupon: c, duplicates: duplicates, publish_errors: acValidate(c), lifecycle: acLifecycle(c) };
}
function closeAppCoupon_(body) {
  const c = readAppCoupons_().find(function(x) { return x.id === body.id; });
  if (!c) throw new Error('쿠폰을 찾을 수 없어요.');
  if (Number(body.expected_revision) !== c.revision) throw new Error('다른 곳에서 수정됐어요. 목록을 다시 불러오세요.');
  if (!['issue', 'use'].includes(body.phase)) throw new Error('발급 또는 사용 마감 중에서 선택하세요.');
  c[body.phase + '_closed'] = true;
  // Closure is operational, never a new verification of the offer's conditions.
  c.revision += 1;
  c.updated_at = nowIso_();
  const table = readTable_('app_coupons');
  writeTable_(sheet_('app_coupons'), table.headers, table.rows.map(function(r) { return r.id === c.id ? appCouponRow_(c) : r; }));
  CacheService.getScriptCache().remove(CACHE_KEY);
  return { ok: true, coupon: c, lifecycle: acLifecycle(c) };
}
function seedAppCouponDrafts_() {
  const have = readAppCoupons_().map(function(c) { return c.id; });
  const drafts = [
    { id: 'ac_research_bk_tiers', issuer_app: '버거킹', brand: '버거킹', product_name: '등급별 앱 쿠폰 · 개별 쿠폰 확인 대기', audience_type: 'tier',
      source_url: 'https://www.burgerking.co.kr/notice/90', official_link: 'https://www.burgerking.co.kr/notice/90', link_type: 'event',
      source_note: '2025년 앱 개편 공지 검색 결과에서 등급별·맞춤 쿠폰 안내를 확인. 현재 개별 쿠폰 상세는 공개 웹에서 확인하지 못함.',
      missing_info: '현재 쿠폰 상품·구성·가격, 정확한 이용 가능 등급 범위, 발급/사용 기간, 시간·매장·킹오더·배달 조건, 발급 경로, 자료 이용 범위. 이 기록은 개별 쿠폰을 확보하기 위한 조사 초안.' },
    { id: 'ac_research_mcd_rewards', issuer_app: '맥도날드', brand: '맥도날드', product_name: '리워드 교환 쿠폰 · 개별 쿠폰 확인 대기', benefit_type: 'point_exchange', audience_type: 'points_member',
      source_url: 'https://m.mcdonalds.co.kr/gmal/kor/more/tnc/tnc_202512.html', official_link: 'https://m.mcdonalds.co.kr/gmal/kor/more/tnc/tnc_202512.html', link_type: 'event',
      source_note: '공식 앱 약관에서 포인트 교환 쿠폰과 일반 쿠폰의 구분을 확인. 약관은 개별 발급 화면이 아니므로 공개용 이용 링크로 사용하지 않음.',
      missing_info: '현재 교환 상품·차감 포인트·구성, 해당 쿠폰 대상과 발급/사용 기간, 공식 이용 링크와 앱 내 경로, 자료 이용 범위. 일반 앱 쿠폰의 전체 회원 대상 여부도 개별 확인 필요.' },
    { id: 'ac_research_hp_shack_202610', issuer_app: '해피포인트', brand: '쉐이크쉑', product_name: '10월 쉑버거 선착순 1+1 · 상세 확인 대기', benefit_type: 'bogo',
      source_url: 'https://napi.happypointcard.com/page/event/event-view.spc?eventseq=7697c69cceaf1837b60334bd16728343&share=Y',
      official_link: 'https://napi.happypointcard.com/page/event/event-view.spc?eventseq=7697c69cceaf1837b60334bd16728343&share=Y', link_type: 'event',
      source_note: '사용자가 제공한 공식 공유 페이지의 제목 메타데이터에 10/26–10/30, 쉑버거 선착순 1+1이 표시됨. 본문은 앱 안내 화면만 보여 세부 조건을 확인하지 못함. 이 날짜를 발급·사용 기간으로 추정하지 않음.',
      missing_info: '전체 회원 대상 근거, 수량·상품 구성, 발급 기간과 사용 기간 각각, 선착순 수량·발급 시각·횟수, 사용 경로·제외 매장, 중복 할인, 공식 자료 이용 범위.' },
  ];
  drafts.forEach(function(input) {
    if (have.indexOf(input.id) >= 0) return;
    const c = acNormalize(Object.assign({ status: 'draft', revision: 1, researched_at: '2026-10-29T00:00:00Z', review_required: true,
      rights_state: 'unknown', rights_note: '공식 공개 페이지·약관을 살펴보았으나 자료 게시 허용 범위를 확정하지 못해 초안으로 보관. 배너·앱 화면·개별 코드는 복제하지 않음.' }, input));
    // checked_at intentionally empty: deployment and partial research are not coupon verification.
    appendRow_('app_coupons', appCouponRow_(c));
  });
}

// END GENERATED APP COUPONS

// BEGIN GENERATED ONLINE DEALS
// 온라인 특가 공통 규칙 — 수집기(Node)·Apps Script(Code.gs 생성 구역)·화면(web/)이 같은 판단을 쓴다.
// 프랜차이즈 쿠폰 데이터와 섞지 않는다.
// 공급처 응답의 필드 이름은 여기서 추측하지 않는다. 공급처별 어댑터가 공식 문서로 확인한 필드만
// 아래 '표준 후보' 형식으로 옮기고, 이 파일은 표준 후보만 다룬다.
// import 없이 순수 함수만 둔다 (Apps Script에 그대로 붙여 넣기 위해 — collector/scripts/sync-web.js).

const OD_HOUR = 3600000;
const OD_DAY = 24 * OD_HOUR;
const OD_MAX_INGEST = 200;      // 공급처 응답 1회에서 받는 최대 후보 수
const OD_MAX_RECORDS = 2000;    // 시트에 보관하는 최대 상품 수 (운영자 숨김은 별도로 항상 보관)
const OD_RETENTION_DAYS = 7;    // 다시 받지 못한 상품 기록 보관 기간 (가격 이력은 저장하지 않음)
const OD_HARD_MAX_AGE_HOURS = 24;

const OD_CATEGORIES = { food: '식품', household: '생활용품' };
const OD_MODES = { off: '끄기', observe: '관찰 (비공개)', publish: '자동 게시' };
const OD_STATUSES = { published: '게시 중', held: '보류', scheduled: '시작 전', stale: '재확인 기한 지남', ended: '종료', hidden: '운영자 숨김' };
const OD_SHIPPING = ['free', 'paid', 'conditional', 'unknown'];
const OD_PRICE_BASIS = ['item_total', 'unit', 'discount', 'points', 'min_order', 'unknown'];
const OD_RESULTS = {
  ok: '정상', empty: '빈 응답 (기존 상품 유지)', failed: '실패 (기존 상품 유지)', rate_limited: '호출 제한 (일시 중지)',
  paused: '일시 중지 중', off: '꺼짐', awaiting_access: '승인 대기 (연결 안 됨)', missing_secrets: '키 미등록', too_soon: '최소 간격 전',
};
const OD_HOLD_LABELS = {
  MISSING_TITLE: '상품명 없음',
  BAD_PRICE: '가격이 없거나 형식이 맞지 않음',
  BAD_CURRENCY: '원화 가격이 아님',
  PRICE_NOT_TOTAL: '상품 실구매가가 아님 (단위가·할인액·적립금·최소주문금액 등)',
  OPTION_PRICE_UNCLEAR: '옵션별 가격이 불분명',
  PERSONAL_PRICE: '개인별 가격이거나 개인별 여부 미확인',
  CONDITION_UNCLEAR: '적용 조건이 완전하지 않음',
  BAD_LINK: '허용되지 않은 링크',
  SELLER_UNKNOWN: '판매자 불명',
  CATEGORY_UNMAPPED: '분류 규칙에 없는 분류',
  CATEGORY_EXCLUDED: '게시하지 않는 분류',
  SELLER_EXCLUDED: '제외한 판매자',
  KEYWORD_EXCLUDED: '제외 키워드 포함',
  DUPLICATE: '같은 상품이 이미 게시 중',
  OVER_LIMIT: '게시 개수 상한 밖',
  SUPPLIER_OBSERVE: '공급처 관찰 모드 (비공개)',
  SUPPLIER_OFF: '공급처 꺼짐',
};

// 공급처 목록. 연결 여부와 무관하게 '어떤 링크·사진 주소를 허용하는지'만 정한다.
// 실제 호출 방식은 collector/src/online/suppliers.js (승인 전에는 비활성).
const OD_SUPPLIERS = {
  coupang: {
    name: '쿠팡', store: '쿠팡', cta: '쿠팡에서 가격 확인',
    // AMONG의 쿠팡 파트너스 ID (11/05 가입, 공개 값 — 링크에 실리는 추적 코드이며 비밀번호·API 키가 아니다).
    // 링크에 파트너스 추적 코드(lptag)가 있으면 이 ID여야 한다 (다른 사람의 제휴 링크를 싣지 않음).
    partnerId: 'AF1327603',
    linkHosts: ['link.coupang.com', 'www.coupang.com', 'm.coupang.com', 'coupang.com'],
    imageHosts: ['thumbnail.coupangcdn.com', 'image.coupangcdn.com'],
    // 사진 사용·저장 범위를 약관·승인 조건으로 확인하기 전에는 사진을 보이지 않는다.
    imagesAllowed: false,
    // 쿠팡 파트너스 공식 가이드의 필수 문구 (게시물 제목 또는 첫 부분)
    disclosure: '이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',
  },
  linkprice: {
    name: '링크프라이스', store: '', cta: '판매처에서 가격 확인',
    // 승인 후 발급되는 제휴 링크 주소를 공식 문서로 확인한 뒤 추가한다. 비어 있으면 모든 링크가 보류된다.
    linkHosts: [],
    imageHosts: [],
    imagesAllowed: false,
    disclosure: '이 페이지의 일부 링크는 링크프라이스 제휴 링크로, 구매가 이루어지면 AMONG이 일정액의 수수료를 받을 수 있습니다.',
  },
};

const OD_DEFAULT_RULES = {
  // 11/06 21:08 대표 결정: 먹거리만. 생활용품 분류 연결은 남겨 두어 생활용품으로 분류된 상품이 '분류 제외'로 보류되게 한다.
  includeCategories: ['food'],
  // 공급처 분류 경로의 한 단계와 정확히 같을 때만 연결한다 (부분 일치로 가전 '냉동고'가 식품이 되는 일을 막음).
  categoryKeywords: { food: ['식품'], household: ['생활용품'] },
  excludeKeywords: ['주류', '담배', '전자담배', '의약품', '성인용품'],
  excludeSellers: [],
  maxItems: 30,
  maxAgeHours: 6,
};

const OD_CONTROL = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;
function odText(v, max) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return String(v).replace(OD_CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function odOneOf_(v, list, fallback) { return list.indexOf(v) >= 0 ? v : fallback; }
function odPosInt_(v) { return Number.isSafeInteger(v) && v > 0 ? v : null; }
function odIso_(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)) return '';
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}
const odMs_ = v => (v ? Date.parse(v) : NaN);

/** 53비트 해시 (cyrb53) → 11자리 36진수. 공개 id용이며 비밀 보호용이 아니다. */
function odHash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0');
}

// Apps Script에는 URL 클래스가 없으므로 정규식으로 엄격하게 검사한다 (https, 허용 호스트, 계정·포트 없음).
function odUrlFor_(value, hosts) {
  if (typeof value !== 'string' || !hosts || !hosts.length || value.length > 2000 || /[\x00-\x20\x7f\\]/.test(value)) return '';
  const m = /^https:\/\/([A-Za-z0-9.-]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/.exec(value);
  if (!m || hosts.indexOf(m[1].toLowerCase()) < 0) return '';
  // 로그인·결제·개인 쿠폰 정보는 공개 링크에 싣지 않는다.
  const bad = /^(token|access_token|authorization|password|session|sessionid|coupon_code|couponcode)$/i;
  const pairs = m[3] ? m[3].slice(1).split('&') : [];
  for (let i = 0; i < pairs.length; i++) {
    let key;
    try { key = decodeURIComponent(pairs[i].split('=')[0].replace(/\+/g, ' ')); } catch (e) { return ''; }
    if (bad.test(key.trim())) return '';
  }
  return value;
}
function odLink(value, supplier, registry) {
  const s = (registry || OD_SUPPLIERS)[supplier];
  const url = s ? odUrlFor_(value, s.linkHosts) : '';
  if (!url || !s.partnerId) return url;
  const q = /\?([^#]*)/.exec(url);
  const pairs = q ? q[1].split('&') : [];
  for (let i = 0; i < pairs.length; i++) {
    const kv = pairs[i].split('=');
    let key, val;
    try { key = decodeURIComponent(kv[0]).trim().toLowerCase(); val = decodeURIComponent(kv.slice(1).join('=')).trim(); } catch (e) { return ''; }
    if (key === 'lptag' && val !== s.partnerId) return '';
  }
  return url;
}
/** 제휴 링크인가: 쿠팡 단축 링크(link.coupang.com) 또는 파트너스 추적 코드(lptag)가 있는 링크 */
function odIsAffiliateLink(url) {
  return /^https:\/\/link\.coupang\.com\//i.test(url || '') || /[?&]lptag=/i.test(url || '');
}
function odImage(value, supplier, registry) { const s = (registry || OD_SUPPLIERS)[supplier]; return s ? odUrlFor_(value, s.imageHosts) : ''; }

/**
 * 표준 후보 → 저장 형식. 식별할 수 없으면 null. 판단(게시·보류)은 하지 않고 값만 정리한다.
 * 같은 결과를 다시 넣어도 같은 결과가 나온다 (Apps Script가 수집기 결과를 다시 검사할 수 있게).
 */
function odNormalize(raw, supplier, registry) {
  const reg = registry || OD_SUPPLIERS;
  if (!raw || typeof raw !== 'object' || !reg[supplier]) return null;
  const sid = odText(raw.supplierItemId, 81), opt = odText(raw.optionKey, 81);
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(sid) || (opt && !/^[A-Za-z0-9._:-]{1,80}$/.test(opt))) return null;
  const observedAt = odIso_(raw.observedAt);
  if (!observedAt) return null;
  const list = Array.isArray(raw.conditions) ? raw.conditions : [];
  const conditions = [];
  // 조건은 줄이거나 자르지 않는다. 길거나 빈 조건이 있으면 '불완전'으로 보고 보류한다.
  let complete = raw.conditionsComplete === true && Array.isArray(raw.conditions) && list.length <= 8;
  list.slice(0, 8).forEach(c => { const t = odText(c, 301); if (!t || t.length > 300) complete = false; else conditions.push(t); });
  const sp = reg[supplier];
  const item = {
    supplier, supplierItemId: sid, optionKey: opt,
    title: odText(raw.title, 160), option: odText(raw.option, 100),
    store: odText(raw.store, 40) || sp.store || '', seller: odText(raw.seller, 60),
    price: Number.isSafeInteger(raw.price) ? raw.price : null,
    currency: odText(raw.currency, 3).toUpperCase(),
    priceBasis: odOneOf_(raw.priceBasis, OD_PRICE_BASIS, 'unknown'),
    optionPrice: odOneOf_(raw.optionPrice, ['single', 'varies', 'unknown'], 'unknown'),
    membership: odText(raw.membership, 30),
    personalized: raw.personalized === false ? false : raw.personalized === true ? true : null,
    shipping: odOneOf_(raw.shipping, OD_SHIPPING, 'unknown'),
    shippingFee: odPosInt_(raw.shippingFee), shippingThreshold: odPosInt_(raw.shippingThreshold),
    conditions, conditionsComplete: complete,
    categoryPath: odText(raw.categoryPath, 200),
    url: odLink(raw.url, supplier, reg), imageUrl: odImage(raw.imageUrl, supplier, reg),
    affiliate: raw.affiliate === true,
    pick: odText(raw.pick, 20),
    availability: odOneOf_(raw.availability, ['available', 'sold_out', 'ended', 'unknown'], 'unknown'),
    startsAt: odIso_(raw.startsAt), endsAt: odIso_(raw.endsAt),
    observedAt,
  };
  // 같은 상품·옵션이라도 회원 전용 가격은 다른 혜택으로 본다. 조건 문구가 조금 바뀌면 같은 기록을 갱신한다.
  item.key = [supplier, sid, opt, item.membership].join(':');
  item.id = 'od_' + odHash(item.key);
  return item;
}

/** 운영 규칙 정리 (관리 화면 입력은 이 함수를 거쳐야 저장된다) */
function odRules(input) {
  const d = OD_DEFAULT_RULES;
  const r = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const words = (v, max, len, fallback) => {
    if (!Array.isArray(v)) return fallback.slice();
    const out = [];
    v.forEach(x => { const t = odText(x, len + 1); if (t && t.length <= len && out.indexOf(t) < 0 && out.length < max) out.push(t); });
    return out;
  };
  const int = (v, lo, hi, fallback) => (Number.isSafeInteger(v) && v >= lo && v <= hi ? v : fallback);
  const ck = r.categoryKeywords && typeof r.categoryKeywords === 'object' ? r.categoryKeywords : {};
  return {
    includeCategories: words(r.includeCategories, 2, 20, d.includeCategories).filter(c => c === 'food'),
    categoryKeywords: { food: words(ck.food, 50, 30, d.categoryKeywords.food), household: words(ck.household, 50, 30, d.categoryKeywords.household) },
    excludeKeywords: words(r.excludeKeywords, 100, 30, d.excludeKeywords),
    excludeSellers: words(r.excludeSellers, 100, 60, d.excludeSellers),
    maxItems: int(r.maxItems, 1, 60, d.maxItems),
    maxAgeHours: int(r.maxAgeHours, 1, OD_HARD_MAX_AGE_HOURS, d.maxAgeHours),
  };
}

/** 공급처 운영 상태 정리. 새 공급처는 '관찰(비공개)'로 시작한다. */
function odSupplierStates(input, registry) {
  const reg = registry || OD_SUPPLIERS;
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  Object.keys(reg).forEach(id => {
    const s = src[id] && typeof src[id] === 'object' ? src[id] : {};
    out[id] = {
      mode: odOneOf_(s.mode, Object.keys(OD_MODES), 'observe'),
      pauseUntil: odIso_(s.pauseUntil), failures: Number.isSafeInteger(s.failures) && s.failures > 0 ? Math.min(s.failures, 99) : 0,
      lastResult: odOneOf_(s.lastResult, Object.keys(OD_RESULTS), ''), lastError: odText(s.lastError, 200),
      lastRunAt: odIso_(s.lastRunAt), lastAttemptAt: odIso_(s.lastAttemptAt), lastSuccessAt: odIso_(s.lastSuccessAt),
      lastReceived: Number.isSafeInteger(s.lastReceived) && s.lastReceived >= 0 ? s.lastReceived : 0,
    };
  });
  return out;
}

/** 실패 뒤 다음 시도 시각: 429는 Retry-After(15분~24시간), 연속 실패 3회부터 15분·30분…최대 12시간 */
function odAfterFailure(state, failure, now) {
  const s = Object.assign({}, state);
  s.failures = Math.min((s.failures || 0) + 1, 99);
  s.lastAttemptAt = new Date(now).toISOString();
  s.lastError = odText(failure.error, 200);
  let pause = 0;
  if (failure.rateLimited) {
    const ra = Number.isFinite(failure.retryAfterMs) ? failure.retryAfterMs : OD_HOUR;
    pause = Math.min(Math.max(ra, 15 * 60000), OD_DAY);
    s.lastResult = 'rate_limited';
  } else {
    s.lastResult = 'failed';
    if (s.failures >= 3) pause = Math.min(15 * 60000 * Math.pow(2, s.failures - 3), 12 * OD_HOUR);
  }
  if (pause) s.pauseUntil = new Date(now + pause).toISOString();
  return s;
}

/** 분류: 운영자 지정(기한 내) → 분류 규칙(경로의 한 단계와 정확히 일치) → 없음 */
function odCategory(rec, rules, now) {
  if (rec.categoryOverride && (!rec.overrideUntil || odMs_(rec.overrideUntil) > now)) return rec.categoryOverride;
  const parts = String(rec.item.categoryPath || '').split('>').map(s => s.trim()).filter(Boolean);
  const keys = Object.keys(OD_CATEGORIES);
  for (let i = 0; i < keys.length; i++) {
    const words = rules.categoryKeywords[keys[i]] || [];
    if (parts.some(p => words.indexOf(p) >= 0)) return keys[i];
  }
  return '';
}

/** 보류 사유 (공급처 모드·중복·상한은 odEvaluate에서 더한다) */
function odHolds(item, category, rules, registry) {
  const h = [];
  if (!item.title) h.push('MISSING_TITLE');
  if (!odPosInt_(item.price) || item.price > 10000000) h.push('BAD_PRICE');
  if (item.currency !== 'KRW') h.push('BAD_CURRENCY');
  if (item.priceBasis !== 'item_total') h.push('PRICE_NOT_TOTAL');
  if (item.optionPrice === 'unknown' || (item.optionPrice === 'varies' && !item.optionKey)) h.push('OPTION_PRICE_UNCLEAR');
  if (item.personalized !== false) h.push('PERSONAL_PRICE');
  if (!item.conditionsComplete) h.push('CONDITION_UNCLEAR');
  if (!odLink(item.url, item.supplier, registry)) h.push('BAD_LINK');
  if (!item.seller) h.push('SELLER_UNKNOWN');
  if (!category) h.push('CATEGORY_UNMAPPED');
  else if (category === 'excluded' || rules.includeCategories.indexOf(category) < 0) h.push('CATEGORY_EXCLUDED');
  if (item.seller && rules.excludeSellers.indexOf(item.seller) >= 0) h.push('SELLER_EXCLUDED');
  const title = (item.title + ' ' + item.option).toLowerCase();
  if (rules.excludeKeywords.some(k => title.indexOf(k.toLowerCase()) >= 0)) h.push('KEYWORD_EXCLUDED');
  return h;
}

/** AMONG 재확인 기한(마지막 수신 + maxAgeHours)과 실제 행사 종료 중 이른 시각 */
function odVisibleUntil(rec, rules) {
  const recheck = odMs_(rec.lastReceivedAt) + rules.maxAgeHours * OD_HOUR;
  const end = odMs_(rec.item.endsAt);
  return Number.isFinite(end) ? Math.min(end, recheck) : recheck;
}

function odFingerprint_(item) {
  const n = s => String(s || '').toLowerCase().replace(/[\s()[\]{}·,./+_-]+/g, '');
  return [n(item.title), n(item.option), n(item.store)].join('|');
}
function odCompare(a, b) {
  const ea = odMs_(a.item.endsAt), eb = odMs_(b.item.endsAt);
  if (Number.isFinite(ea) !== Number.isFinite(eb)) return Number.isFinite(ea) ? -1 : 1;
  if (Number.isFinite(ea) && ea !== eb) return ea - eb;
  const la = odMs_(a.lastReceivedAt), lb = odMs_(b.lastReceivedAt);
  if (la !== lb) return lb - la;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 저장된 기록 전체의 현재 상태. 상태는 저장값이 아니라 읽을 때마다 계산한다
 * (시간이 지나거나 규칙·공급처 모드가 바뀌면 다음 조회부터 바로 반영).
 * ctx: { rules, suppliers(상태), now, registry? }
 */
function odEvaluate(records, ctx) {
  const rules = odRules(ctx.rules), now = ctx.now, reg = ctx.registry || OD_SUPPLIERS;
  const sup = odSupplierStates(ctx.suppliers, reg);
  const out = records.map(rec => {
    const r = Object.assign({}, rec);
    r.category = odCategory(rec, rules, now);
    r.visibleUntil = odVisibleUntil(rec, rules);
    r.holds = [];
    const it = rec.item;
    if (rec.hidden) r.status = 'hidden';
    else if (it.availability === 'ended' || it.availability === 'sold_out' || odMs_(it.endsAt) <= now) r.status = 'ended';
    else if (!(r.visibleUntil > now)) r.status = 'stale';
    else {
      r.holds = odHolds(it, r.category, rules, reg);
      const mode = sup[rec.supplier] ? sup[rec.supplier].mode : 'off';
      if (mode === 'off') r.holds.push('SUPPLIER_OFF');
      else if (mode === 'observe') r.holds.push('SUPPLIER_OBSERVE');
      if (r.holds.length) r.status = 'held';
      else r.status = odMs_(it.startsAt) > now ? 'scheduled' : 'published';
    }
    return r;
  });
  // 같은 상품(상품명·옵션·판매처)은 가장 최근에 확인한 하나만 게시한다.
  const live = out.filter(r => r.status === 'published').sort((a, b) => {
    const la = odMs_(a.lastReceivedAt), lb = odMs_(b.lastReceivedAt);
    return la !== lb ? lb - la : (a.id < b.id ? -1 : 1);
  });
  const seen = {};
  live.forEach(r => {
    const f = odFingerprint_(r.item);
    if (seen[f]) { r.status = 'held'; r.holds = ['DUPLICATE']; } else seen[f] = true;
  });
  out.filter(r => r.status === 'published').sort(odCompare).forEach((r, i) => {
    if (i >= rules.maxItems) { r.status = 'held'; r.holds = ['OVER_LIMIT']; }
  });
  return out;
}

/**
 * 공급처 응답 1회를 기존 기록에 반영한다.
 * - 실패·빈 응답·전부 잘못된 응답이면 기존 기록을 그대로 둔다 (삭제·종료 처리하지 않음).
 * - 이번 응답에 없는 상품도 품절로 보지 않는다. 다시 받지 못하면 재확인 기한이 지나 자동으로 내려간다.
 * - 운영자 숨김·분류 지정은 새 응답이 와도 유지한다.
 * run: { supplier, ok, items, observedAt }, now: 서버 시각(ms)
 */
function odMerge(records, run, now, registry) {
  const out = records.map(r => Object.assign({}, r));
  const stats = { received: 0, inserted: 0, updated: 0, invalid: 0, duplicate: 0, skipped: false };
  const items = run && run.ok && Array.isArray(run.items) ? run.items.slice(0, OD_MAX_INGEST) : [];
  const observed = odMs_(odIso_(run && run.observedAt));
  // 수신 시각은 서버 시각을 넘지 않는다 (오래된 응답을 새것처럼 보이게 하지 않음).
  const at = new Date(Number.isFinite(observed) ? Math.min(observed, now) : now).toISOString();
  const byKey = {};
  out.forEach(r => { byKey[r.key] = r; });
  const seen = {};
  items.forEach(raw => {
    const item = odNormalize(raw, run.supplier, registry);
    if (!item) { stats.invalid++; return; }
    if (seen[item.key]) { stats.duplicate++; return; }
    seen[item.key] = true;
    stats.received++;
    const prev = byKey[item.key];
    if (prev) { prev.item = item; prev.lastReceivedAt = at; stats.updated++; return; }
    const rec = { key: item.key, id: item.id, supplier: run.supplier, item, hidden: false, hiddenReason: '', hiddenAt: '',
      categoryOverride: '', overrideUntil: '', firstSeenAt: at, lastReceivedAt: at };
    out.push(rec); byKey[item.key] = rec; stats.inserted++;
  });
  if (!stats.received) stats.skipped = true;
  return { records: out, stats };
}

/** 보관 정리: 7일간 다시 받지 못한 기록은 지우고, 운영자 숨김은 남긴다 (다시 들어와도 숨김 유지). */
function odPrune(records, now) {
  const from = now - OD_RETENTION_DAYS * OD_DAY;
  const hidden = records.filter(r => r.hidden);
  const rest = records.filter(r => !r.hidden && odMs_(r.lastReceivedAt) >= from)
    .sort((a, b) => odMs_(b.lastReceivedAt) - odMs_(a.lastReceivedAt))
    .slice(0, Math.max(0, OD_MAX_RECORDS - hidden.length));
  return hidden.concat(rest);
}

/** 공개 응답에 싣는 필드 (보류 사유·운영 메모·공급처 내부 id는 싣지 않는다) */
function odPublic(r, registry) {
  const it = r.item, sp = (registry || OD_SUPPLIERS)[r.supplier];
  return {
    id: r.id, supplier: r.supplier, store: it.store, title: it.title, option: it.option, seller: it.seller,
    price: it.price, membership: it.membership, conditions: it.conditions.slice(),
    shipping: it.shipping, shippingFee: it.shippingFee, shippingThreshold: it.shippingThreshold,
    category: r.category, url: it.url, imageUrl: sp && sp.imagesAllowed ? it.imageUrl : '',
    affiliate: it.affiliate, pick: it.pick,
    checkedAt: r.lastReceivedAt, endsAt: it.endsAt, visibleUntil: new Date(r.visibleUntil).toISOString(),
  };
}

/** 화면에서 다시 검사 (서버 응답도 그대로 믿지 않는다). 통과하지 못하면 null */
function odClientItem(raw, now, registry) {
  const reg = registry || OD_SUPPLIERS;
  if (!raw || typeof raw !== 'object' || !reg[raw.supplier]) return null;
  const sp = reg[raw.supplier];
  const id = typeof raw.id === 'string' && /^od_[0-9a-z]{11}$/.test(raw.id) ? raw.id : '';
  const title = odText(raw.title, 160), url = odLink(raw.url, raw.supplier, reg);
  const checked = odMs_(odIso_(raw.checkedAt)), until = odMs_(odIso_(raw.visibleUntil)), end = odMs_(odIso_(raw.endsAt));
  if (!id || !title || !url || !odPosInt_(raw.price) || !Array.isArray(raw.conditions) || raw.conditions.length > 9) return null;
  const conditions = raw.conditions.map(c => odText(c, 301));
  if (conditions.some(c => !c || c.length > 300)) return null;
  if (!Number.isFinite(checked) || checked > now + 5 * 60000 || !Number.isFinite(until) || until <= now) return null;
  if (until > checked + OD_HARD_MAX_AGE_HOURS * OD_HOUR) return null;
  if (Number.isFinite(end) && end <= now) return null;
  return {
    id, supplier: raw.supplier, store: odText(raw.store, 40) || sp.store, title, option: odText(raw.option, 100), seller: odText(raw.seller, 60),
    price: raw.price, membership: odText(raw.membership, 30), conditions,
    shipping: odOneOf_(raw.shipping, OD_SHIPPING, 'unknown'), shippingFee: odPosInt_(raw.shippingFee), shippingThreshold: odPosInt_(raw.shippingThreshold),
    category: OD_CATEGORIES[raw.category] ? raw.category : '', url,
    imageUrl: sp.imagesAllowed ? odImage(raw.imageUrl, raw.supplier, reg) : '',
    // 제휴 여부는 서버 표시와 링크 주소 중 하나라도 해당하면 제휴로 본다.
    affiliate: raw.affiliate === true || odIsAffiliateLink(url),
    pick: odText(raw.pick, 20), checkedAt: new Date(checked).toISOString(),
    endsAt: Number.isFinite(end) ? new Date(end).toISOString() : '', visibleUntil: until,
  };
}

/** 배송비 안내. 확인되지 않은 배송비를 무료로 표시하지 않는다. */
function odShippingText(it) {
  if (it.shipping === 'free') return '무료배송';
  if (it.shipping === 'paid') return it.shippingFee ? `배송비 ${it.shippingFee}원` : '배송비 별도';
  if (it.shipping === 'conditional') return it.shippingThreshold ? `${it.shippingThreshold}원 이상 구매 시 무료배송` : '조건부 무료배송 (조건 확인 필요)';
  return '배송비 확인 필요';
}

// ---------- 직접 고른 쿠팡 특가 (11/05 대표 결정: 최종 승인 전에는 대표가 고른 상품의 간편 링크를 카드로 올리고, 승인 후 API로 자동) ----------
// 상품 선별 정보는 운영자가 어디서 얻든(게시판 등) 공개 화면에는 상품명·쿠팡 링크·항목·한 줄 설명·확인한 가격만 싣는다.
// 가격을 넣은 카드는 운영자가 확인한 시각과 함께 24시간만 보이고 그 뒤 자동으로 내려간다 (11/05 14:56 대표 결정, '다시 확인'하면 다시 24시간).
// 가격 없이 올린 카드는 '쿠팡에서 가격 확인'으로 노출 종료일까지 보인다.
const OD_PICK_CATEGORIES = { food: '먹거리', household: '생활용품', etc: '기타' };
// 먹거리만 (11/06 21:08 대표 결정: "마스크 이런 거 말고 먹거리와 관련된 것만. 어몽은 자사앱 쿠폰이랑 자취생 기반의 가성비 앱이니까").
// 새로 올리는 카드는 먹거리만 받고, 전에 올린 생활용품·기타 카드는 시트에 그대로 두되 공개 화면에 내보내지 않는다(관리 화면에서 숨김·삭제).
const OD_PICK_PUBLIC_CATEGORY = 'food';
const OD_PICK_PRICE_HOURS = 24;
const OD_PICK_DEFAULT_DAYS = 1;
const OD_PICK_MAX_DAYS = 30;
const OD_PICK_MAX = 120;
// 항목별 상품 (11/06 08:14 대표 요청: 항목별에서도 상품을 띄워 달라). 위쪽 특가 목록과 따로, 자취 먹거리 항목마다 고른 상품.
// 11/06 21:08 먹거리만: 화장지·물티슈·세탁세제·주방세제 칸을 빼고 레토르트·닭가슴살·단백질·통조림 칸을 더했다(대표 예시: 단백질 파우더, 자취 음식, 레토르트).
// 가격은 특가와 같이 확인 후 24시간만 보이고, 그 뒤에는 카드를 내리지 않고 가격만 뺀다('가격은 쿠팡에서 확인'). 노출은 기본 30일.
const OD_PICK_ITEMS = {
  water: { label: '생수', category: 'food' }, ramen: { label: '라면', category: 'food' }, rice: { label: '즉석밥', category: 'food' }, frozen: { label: '냉동 간편식', category: 'food' },
  retort: { label: '레토르트', category: 'food' }, chicken: { label: '닭가슴살', category: 'food' }, protein: { label: '단백질', category: 'food' }, canned: { label: '통조림', category: 'food' },
};
const OD_PICK_ITEM_DAYS = 30;
const odItem_ = v => (typeof v === 'string' && Object.prototype.hasOwnProperty.call(OD_PICK_ITEMS, v) ? v : '');
/** 상품명으로 항목 짐작 (관리 화면 '여러 개 한 번에'의 기본값. 대표가 바꿀 수 있다). 먹거리가 아니면 '' */
function odGuessItem(title) {
  const t = String(title || '');
  if (/마스크|세제|화장지|휴지|물티슈|샴푸|치약|칫솔|섬유\s*유연|생리대|기저귀|건전지|전기요|사료/.test(t)) return '';
  if (/닭\s*가슴살|닭\s*안심|훈제\s*닭|가슴살\s*(?:스테이크|소시지|큐브)/.test(t)) return 'chicken';
  if (/단백|프로틴|protein|웨이\s*(?:프로틴|파우더)|\bWP[IC]\b|게이너|쉐이크/i.test(t)) return 'protein';
  if (/참치|스팸|통조림|리챔|런천\s*미트|캔\s*햄|꽁치|골뱅이|황도|스위트\s*콘/.test(t)) return 'canned';
  if (/즉석\s*밥|햇반|오뚜기밥|백미밥|흰밥|쌀\s*밥|잡곡밥|현미밥|컵밥|컵반/.test(t)) return 'rice';
  if (/레토르트|카레|짜장|3분|국밥|육개장|미역국|곰탕|설렁탕|갈비탕|북엇국|사골|덮밥\s*소스|[가-힣]죽(?=[\s,(]|$)/.test(t)) return 'retort';
  if (/라면|짜파게티|컵면|봉지면|스낵면|우동|쌀국수/.test(t)) return 'ramen';
  if (/냉동|만두|교자|볶음밥|돈까스|피자|핫도그/.test(t)) return 'frozen';
  if (/생수|먹는\s*샘물|삼다수|탄산수|\d+(?:\.\d+)?\s*(?:L|리터)\b.*(?:병|개)/i.test(t)) return 'water';
  return '';
}
const OD_PICK_LINK = /^https:\/\/link\.coupang\.com\/[A-Za-z0-9/_-]+$/;
// 카드 사진 (11/05 17:38 대표 요청: 사진과 가격이 바로 보이게): 쿠팡 파트너스 '상품 링크' → 링크 생성 → HTML(이미지+텍스트)이
// 주는 쿠팡 배너 사진만 받는다 (예: https://img5c.coupangcdn.com/image/affiliate/banner/…@2x.jpg, 120×240).
// 쿠팡이 파트너스 활동용으로 주는 사진이라 자르거나 다른 그림을 덮지 않고 비율 그대로 보여 준다.
// 상품 페이지·게시판 사진은 받지 않는다 (판매자·게시자의 저작물).
const OD_PICK_IMAGE = /^https:\/\/[a-z0-9][a-z0-9-]{0,30}\.coupangcdn\.com\/image\/affiliate\/[A-Za-z0-9_@.\/-]{1,200}$/;
function odPickImage(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return OD_PICK_IMAGE.test(s) && s.indexOf('..') < 0 && s.indexOf('//', 8) < 0 ? s : '';
}
function odUnent_(s) {
  return String(s).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/gi, function (m, e) {
    const k = e.toLowerCase();
    if (k[0] !== '#') return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[k];
    const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : Number(k.slice(1));
    return n > 31 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
  });
}
function odAttr_(tag, name) {
  const m = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag || '');
  if (!m) return '';
  return odUnent_(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]).trim();
}
/**
 * 파트너스 '상품 링크' HTML → { url, imageUrl, title, imageRejected }. HTML을 화면에 넣거나 실행하지 않고 글자로만 읽는다.
 * url은 AMONG 파트너스 간편 링크 형식, imageUrl은 쿠팡 파트너스 배너 사진일 때만 채운다.
 */
function odPartnerHtml(html) {
  const s = String(html || '').slice(0, 5000);
  const a = /<a\b[^>]*>/i.exec(s), img = /<img\b[^>]*>/i.exec(s);
  const link = odLink(odAttr_(a ? a[0] : '', 'href'), 'coupang');
  const src = odAttr_(img ? img[0] : '', 'src');
  const imageUrl = odPickImage(src);
  return { url: link && OD_PICK_LINK.test(link) ? link : '', imageUrl, title: odText(odAttr_(img ? img[0] : '', 'alt'), 80), imageRejected: !!src && !imageUrl };
}

// ---------- 최근 30일 최저 (11/06 10:19 대표 요청: 최근 30일 최저를 쿠폰에 표시하고 알림을 설정할 수 있게) ----------
// AMONG이 확인한 가격 기록(관리 화면 저장·매일 아침 확인)만으로 계산한다. 쿠팡 가격 이력·다른 가격비교 사이트의 기록은 쓰지 않는다.
// 확인한 날이 3일 이상 쌓인 상품만 표시하고, 화면 문구는 'AMONG 확인 30일 최저'로 기준을 밝힌다 (가격 보장·쿠팡 전체 비교처럼 들리는 표현 없음).
const OD_LOW_DAYS = 30;
const OD_LOW_MIN_DAYS = 3;
const odKstDay_ = ms => new Date(ms + 9 * OD_HOUR).toISOString().slice(0, 10);
/** 가격 기록 [{price, at(ISO 또는 ms)}] → 최근 30일 { low, high, days(확인한 한국 날짜 수), since } 또는 null */
function odPriceStats(records, now) {
  const from = now - OD_LOW_DAYS * OD_DAY, days = {};
  let low = Infinity, high = 0, since = Infinity;
  (records || []).forEach(function (r) {
    const at = typeof r.at === 'number' ? r.at : odMs_(r.at), price = odPosInt_(r.price);
    if (!price || !(at >= from) || at > now + 5 * 60000) return;
    if (price < low) low = price;
    if (price > high) high = price;
    if (at < since) since = at;
    days[odKstDay_(at)] = true;
  });
  const n = Object.keys(days).length;
  return n ? { low: low, high: high, days: n, since: new Date(since).toISOString() } : null;
}
/** 매일 확인한 가격 [{id, price}] 검사 (관리 화면 '가격 일괄 기록'). 형식이 맞는 것만, 같은 카드는 한 번 */
function odPriceObservations(list) {
  const out = [], seen = {};
  (Array.isArray(list) ? list : []).slice(0, 200).forEach(function (o) {
    const id = o && typeof o.id === 'string' && /^pk_[0-9a-z]{8,24}$/.test(o.id) ? o.id : '';
    const price = o && Number.isSafeInteger(o.price) && o.price >= 100 && o.price <= 10000000 ? o.price : 0;
    if (id && price && !seen[id]) { seen[id] = true; out.push({ id: id, price: price }); }
  });
  return out;
}

/** 관리 화면 입력 → 저장 형식. 잘못된 값은 고치지 않고 오류로 돌려준다 */
function odPickInput(raw, now, prev) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const p = prev || {};
  const errors = [];
  const title = odText(r.title, 81);
  if (title.length < 2 || title.length > 80) errors.push('상품명은 2~80자로 입력하세요.');
  const url = odLink(odText(r.url, 301), 'coupang');
  if (!url || !OD_PICK_LINK.test(url)) errors.push('쿠팡 파트너스 간편 링크(https://link.coupang.com/a/…)를 넣으세요.');
  const item = odItem_(r.item);
  if (r.item && !item) errors.push('항목별 칸을 다시 고르세요.');
  const category = item ? OD_PICK_ITEMS[item].category : OD_PICK_CATEGORIES[r.category] ? r.category : '';
  if (!category) errors.push('올릴 곳(특가 항목 또는 항목별 칸)을 고르세요.');
  else if (category !== OD_PICK_PUBLIC_CATEGORY) errors.push('AMONG 온라인 특가는 먹거리만 올려요. 올릴 곳을 먹거리로 고르세요.');
  const note = odText(r.note, 61);
  if (note.length > 60) errors.push('한 줄 설명은 60자 이내로 입력하세요.');
  const memo = odText(r.memo, 200);
  const imageUrl = r.imageUrl ? odPickImage(r.imageUrl) : '';
  if (r.imageUrl && !imageUrl) errors.push('사진은 쿠팡 파트너스 상품 링크 HTML의 사진(…coupangcdn.com/image/affiliate/…)만 쓸 수 있어요.');
  let price = null;
  if (r.price !== '' && r.price !== null && r.price !== undefined) {
    const t = String(r.price).trim();
    const n = typeof r.price === 'number' ? r.price : /^\d+$/.test(t) ? Number(t) : NaN;
    if (!Number.isSafeInteger(n) || n < 100 || n > 10000000) errors.push('가격은 100원~1000만원 사이 숫자로 입력하세요.');
    else price = n;
  }
  const ends = r.endsAt ? odMs_(odIso_(r.endsAt)) : (p.endsAt ? odMs_(p.endsAt) : now + (item ? OD_PICK_ITEM_DAYS : OD_PICK_DEFAULT_DAYS) * OD_DAY);
  if (!Number.isFinite(ends) || ends <= now || ends > now + OD_PICK_MAX_DAYS * OD_DAY) errors.push('노출 종료는 지금부터 30일 안으로 정하세요.');
  if (errors.length) return { errors, pick: null };
  const at = new Date(now).toISOString();
  // 가격을 새로 넣거나 바꾸거나 '다시 확인'을 누르면 지금 확인한 것으로 본다. 같은 가격으로 다른 칸만 고치면 처음 확인 시각을 유지한다.
  const priceCheckedAt = price === null ? '' : (r.recheck === true || price !== p.price || !p.priceCheckedAt ? at : p.priceCheckedAt);
  return { errors, pick: { id: p.id || '', title, url, imageUrl, category, item, note, memo, price, priceCheckedAt, endsAt: new Date(ends).toISOString(),
    hidden: p.hidden === true, createdAt: p.createdAt || at, updatedAt: at } };
}

// ---------- 항목별 인기순 교체 (11/11 대표 요청: "같은 제품 갱신 말고 인기순으로 매일 변경. 인기순 내용이 같으면 변경 안 해도 돼") ----------
// 매일 아침 작업이 쿠팡 파트너스 '상품 링크' 검색(쿠팡랭킹순)에서 항목마다 위에서부터 고른 상품으로 항목 카드를 바꾼다.
// 순위에 든 상품이 어제와 같으면 카드는 그대로 두고 가격만 기록한다. 순위에서 빠진 카드는 노출만 끝내고(30일 뒤 정리)
// 다시 순위에 들면 같은 카드(같은 링크·가격 기록)를 다시 보여 준다. 대표가 숨긴 카드와 같은 상품은 올리지 않는다.
const OD_ROTATE_SIZE = 5;          // 항목마다 보여 줄 인기 상품 수
const OD_ROTATE_MIN = 3;           // 이보다 적게 고르면 그 항목은 바꾸지 않는다 (검색 결과가 이상한 날)
const OD_ROTATE_QUERIES = {        // 파트너스 검색어 (항목 이름과 다르게 찾는 게 나은 것만 다르게)
  water: '생수', ramen: '라면', rice: '즉석밥', frozen: '냉동 간편식', retort: '레토르트', chicken: '닭가슴살', protein: '단백질', canned: '통조림',
};
const OD_ROTATE_MARK = 'rotated:';  // 순위에서 빠져 노출을 끝낸 카드의 관리 메모 머리글
/** 인기순 후보로 쓸 수 있는 상품명인지: 그 항목으로 분류되고, 알약·캡슐 같은 건강기능식품이 아니고, 80자 이내 */
function odRotateCandidate(title, item) {
  const t = odText(title, 81);
  if (!odItem_(item) || t.length < 2 || t.length > 80) return false;
  if (/\d+\s*정(?=[\s,)]|$)|타블렛|캡슐|정제|환(?=[\s,)]|$)|보충제\s*정/.test(t)) return false;
  return odGuessItem(t) === item;
}
const odSameTitle_ = (a, b) => String(a || '').replace(/\s+/g, ' ').trim() === String(b || '').replace(/\s+/g, ' ').trim();
/**
 * 항목 하나의 교체 계획 (순수 함수 — 시트에 쓰지 않음).
 * picks: 지금 카드 전체(odReadPicks_ 형식), entries: 오늘 순위 순서 [{title, price, url?, imageUrl?}] (url은 새 상품만)
 * → { ok, reason, changed, keep:[{pick, rank, price}], add:[{input, rank}], retire:[pick], skipped:[{title, reason}] }
 */
function odRotatePlan(picks, item, entries, now) {
  const out = { ok: false, reason: '', changed: false, keep: [], add: [], retire: [], skipped: [] };
  if (!odItem_(item)) { out.reason = '알 수 없는 항목'; return out; }
  const mine = (Array.isArray(picks) ? picks : []).filter(p => p && p.item === item);
  const live = mine.filter(p => !p.hidden && odMs_(p.endsAt) > now);
  const used = {}, seenTitle = [];
  let rank = 0;
  (Array.isArray(entries) ? entries : []).slice(0, OD_ROTATE_SIZE * 3).forEach(raw => {
    if (rank >= OD_ROTATE_SIZE) return;
    const e = raw && typeof raw === 'object' ? raw : {};
    const title = odText(e.title, 81);
    if (seenTitle.some(t => odSameTitle_(t, title))) return;
    if (!odRotateCandidate(title, item)) { out.skipped.push({ title, reason: '항목에 맞지 않는 상품' }); return; }
    const price = Number.isSafeInteger(e.price) && e.price >= 100 && e.price <= 10000000 ? e.price : null;
    if (!price) { out.skipped.push({ title, reason: '가격 없음' }); return; }
    if (mine.some(p => p.hidden && odSameTitle_(p.title, title))) { out.skipped.push({ title, reason: '대표가 숨긴 상품' }); return; }
    // 같은 상품명의 카드가 있으면(지금 보이는 것 먼저, 다음으로 순위에서 빠졌던 것) 그 카드를 다시 쓴다
    const prev = live.filter(p => !used[p.id] && odSameTitle_(p.title, title))[0] || mine.filter(p => !used[p.id] && !p.hidden && odSameTitle_(p.title, title)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
    if (prev) { used[prev.id] = true; seenTitle.push(title); out.keep.push({ pick: prev, rank: ++rank, price }); return; }
    const input = { title, url: e.url, imageUrl: e.imageUrl || '', item, price, memo: '인기순 ' + odKstDay_(now) };
    const check = odPickInput(input, now, null);
    if (check.errors.length) { out.skipped.push({ title, reason: check.errors.join(' ') }); return; }
    seenTitle.push(title); out.add.push({ input, rank: ++rank });
  });
  if (rank < OD_ROTATE_MIN) { out.reason = `고른 상품이 ${rank}개뿐이라 바꾸지 않음`; out.keep = []; out.add = []; return out; }
  out.retire = live.filter(p => !used[p.id]);
  const before = live.map(p => p.id).sort().join(), after = out.keep.map(k => k.pick.id).sort().join();
  out.changed = out.add.length > 0 || out.retire.length > 0 || before !== after;
  out.ok = true;
  return out;
}

/**
 * 공개 응답용 (관리 메모·숨김·작성 시각 없음). 숨김·노출 종료면 null. 가격 확인 24시간이 지나면 특가는 null, 항목별 상품은 가격만 뺀다.
 * stats(odPriceStats): 확인한 날이 3일 이상이면 30일 최저(low30)·기록 일수(lowDays), 지금 가격이 그 최저이고 기간 중 더 비싼 날이 있었으면 atLow.
 */
function odPickPublic(p, now, stats) {
  if (!p || p.hidden || !(odMs_(p.endsAt) > now)) return null;
  const item = odItem_(p.item);
  if ((item ? OD_PICK_ITEMS[item].category : p.category) !== OD_PICK_PUBLIC_CATEGORY) return null;
  const until = odMs_(p.priceCheckedAt) + OD_PICK_PRICE_HOURS * OD_HOUR;
  const priced = !!odPosInt_(p.price), fresh = priced && until > now;
  if (priced && !fresh && !item) return null;
  const st = stats && stats.days >= OD_LOW_MIN_DAYS && odPosInt_(stats.low) ? stats : null;
  const visible = fresh && !item ? Math.min(odMs_(p.endsAt), until) : odMs_(p.endsAt);
  return { id: p.id, title: p.title, url: p.url, imageUrl: odPickImage(p.imageUrl), category: item ? OD_PICK_ITEMS[item].category : p.category, item, note: p.note || '',
    price: fresh ? p.price : null, priceCheckedAt: fresh ? p.priceCheckedAt : '', priceUntil: fresh ? new Date(until).toISOString() : '',
    visibleUntil: new Date(visible).toISOString(), low30: st ? st.low : null, lowDays: st ? st.days : 0, atLow: !!(st && fresh && p.price <= st.low && st.high > st.low) };
}

/** 화면에서 다시 검사. 통과하지 못하면 null, 가격 기한이 지났거나 맞지 않으면 가격만 뺀다 */
function odClientPick(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && /^pk_[0-9a-z]{8,24}$/.test(raw.id) ? raw.id : '';
  const title = odText(raw.title, 81), note = odText(raw.note, 61);
  const url = odLink(raw.url, 'coupang');
  const until = odMs_(odIso_(raw.visibleUntil));
  const item = odItem_(raw.item);
  if (!id || title.length < 2 || title.length > 80 || note.length > 60 || !url || !OD_PICK_LINK.test(url) || raw.category !== OD_PICK_PUBLIC_CATEGORY) return null;
  if (raw.item && (!item || OD_PICK_ITEMS[item].category !== raw.category)) return null;
  if (!Number.isFinite(until) || until <= now || until > now + (OD_PICK_MAX_DAYS + 1) * OD_DAY) return null;
  let price = null, checked = NaN, priceUntil = 0;
  if (raw.price !== null && raw.price !== undefined && raw.price !== '') {
    // 가격이 있는 카드는 확인 시각부터 24시간 안이어야 보인다 (기한이 맞지 않으면 특가는 카드째, 항목별 상품은 가격만 뺀다)
    checked = odMs_(odIso_(raw.priceCheckedAt)); priceUntil = odMs_(odIso_(raw.priceUntil));
    const fresh = odPosInt_(raw.price) && Number.isFinite(checked) && checked <= now + 5 * 60000 && Number.isFinite(priceUntil)
      && priceUntil > now && priceUntil <= checked + OD_PICK_PRICE_HOURS * OD_HOUR;
    if (fresh) price = raw.price;
    else if (!item) return null;
  }
  // 30일 최저: 기록 일수가 기준 이상일 때만, 최저 표시는 지금 보이는 가격이 그 최저 이하일 때만
  const lowDays = Number.isInteger(raw.lowDays) && raw.lowDays >= OD_LOW_MIN_DAYS && raw.lowDays <= OD_LOW_DAYS + 1 ? raw.lowDays : 0;
  const low30 = lowDays ? odPosInt_(raw.low30) : null;
  return { id, title, url, imageUrl: odPickImage(raw.imageUrl), category: raw.category, item, note, affiliate: true,
    price, priceCheckedAt: price ? new Date(checked).toISOString() : '', priceUntil: price ? priceUntil : 0, visibleUntil: price && !item ? Math.min(until, priceUntil) : until,
    low30: low30 || null, lowDays: low30 ? lowDays : 0, atLow: !!(low30 && raw.atLow === true && price && price <= low30) };
}

// ---------- 자동으로 찾은 후보 (11/05 14:56 대표 결정) ----------
// 핫딜 게시판의 공개 RSS에서 쿠팡 상품 글만 골라 관리 화면에만 보여 준다. 게시글 내용은 공개 화면에 싣지 않는다.
// 대표가 쿠팡에서 직접 확인하고 파트너스 간편 링크를 만들어 '직접 고른 쿠팡 특가'로 올린다.
// robots.txt가 허용하는 게시판만 쓴다 (에펨코리아는 robots.txt가 막아 제외, 클리앙은 AI·콘텐츠 수집기를 막아 제외).
const OD_LEAD_SOURCES = {
  ppomppu: { name: '뽐뿌', hosts: ['www.ppomppu.co.kr', 'm.ppomppu.co.kr'] },
  ruliweb: { name: '루리웹', hosts: ['bbs.ruliweb.com', 'm.ruliweb.com'] },
};
const OD_LEAD_KEEP_DAYS = 3;
const OD_LEAD_MAX = 300;
const OD_LEAD_PRODUCT = /^https:\/\/www\.coupang\.com\/vp\/products\/\d{1,15}(?:\?itemId=\d{1,15}(?:&vendorItemId=\d{1,15})?)?$/;

/** 제목 속 가격 단서 (예: '(9,370원/무료)', '12900원') — 후보 정리용, 공개 가격이 아니다 */
function odLeadPrice(title) {
  const t = String(title || '');
  const m = /(\d{1,3}(?:,\d{3})+|\d{3,8})\s*원/.exec(t) || /\(\s*(\d{1,3}(?:,\d{3})+)\s*[\/)]/.exec(t);
  const n = m ? Number(m[1].replace(/,/g, '')) : NaN;
  return Number.isSafeInteger(n) && n >= 100 && n <= 10000000 ? n : null;
}
/** 카드 상품명 제안: 앞의 [쿠팡]·뒤의 (가격/배송) 묶음을 뺀다 */
function odLeadName(title) {
  return odText(String(title || '').replace(/^\s*[[(（【]?\s*쿠팡\s*[\])）】]?\s*[:\-·)]?\s*/, '')
    .replace(/\s*[(（][^()（）]*(?:원|무료|무배|배송)[^()（）]*[)）]\s*$/, '').replace(/\s+\d{1,3}(?:,\d{3})+\s*원.*$/, ''), 80);
}
/** 수집기·Apps Script가 같은 기준으로 후보를 정리한다. 맞지 않으면 null */
function odLeadInput(raw, now) {
  if (!raw || typeof raw !== 'object' || !OD_LEAD_SOURCES[raw.source]) return null;
  const src = OD_LEAD_SOURCES[raw.source];
  const key = odText(raw.key, 61);
  if (!/^[a-z]+:\d{1,12}$/.test(key) || key.split(':')[0] !== raw.source) return null;
  const postUrl = odUrlFor_(odText(raw.postUrl, 401), src.hosts);
  const title = odText(raw.title, 121);
  if (!postUrl || title.length < 2) return null;
  const coupangUrl = typeof raw.coupangUrl === 'string' && OD_LEAD_PRODUCT.test(raw.coupangUrl) ? raw.coupangUrl : '';
  const priceHint = Number.isSafeInteger(raw.priceHint) && raw.priceHint >= 100 && raw.priceHint <= 10000000 ? raw.priceHint : null;
  const posted = odIso_(raw.postedAt);
  return {
    key, source: raw.source, title: title.slice(0, 120), postUrl, coupangUrl,
    affiliateOnly: raw.affiliateOnly === true && !coupangUrl, priceHint, freeShipping: raw.freeShipping === true,
    postedAt: posted && odMs_(posted) <= now + 10 * 60000 ? posted : '', foundAt: new Date(now).toISOString(),
  };
}

// 온라인 특가 저장·공개·관리 (collector/scripts/sync-web.js가 Code.gs 생성 구역에 넣는다. 따로 붙여 넣지 말 것)
// 프랜차이즈 쿠폰(coupons·news 탭)과 섞지 않는다. 탭: online_items · online_runs
// 스크립트 속성: ONLINE_RULES(운영 규칙) · ONLINE_SUPPLIERS(공급처 모드·중지) · ONLINE_RUN_LOCK(동시 실행 방지)
const OD_CACHE_KEY = 'online_deals_v1';
const OD_LOCK_MIN = 20;
const OD_RERUN_COOLDOWN_MIN = 10;
const OD_RUNS_KEEP = 500;
const OD_WORKFLOW = 'online-deals.yml';

function odJsonProp_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) return null;
  try { return JSON.parse(v); } catch (err) { return null; }
}
function odSetJsonProp_(key, value) { PropertiesService.getScriptProperties().setProperty(key, value ? JSON.stringify(value) : ''); }
function odCtx_() {
  return { rules: odRules(odJsonProp_('ONLINE_RULES')), suppliers: odSupplierStates(odJsonProp_('ONLINE_SUPPLIERS')), now: Date.now() };
}
function odCell_(s) { s = String(s == null ? '' : s); return /^[=+@-]/.test(s) ? "'" + s : s; }
function odUncell_(s) { s = String(s == null ? '' : s); return /^'[=+@-]/.test(s) ? s.slice(1) : s; }
function odRunId_(v) { return typeof v === 'string' && /^odr_[0-9a-f]{16}$/.test(v) ? v : ''; }

function odReadRecords_() {
  return readTable_('online_items').rows.map(function (r) {
    let item = null;
    try { item = odNormalize(JSON.parse(r.payload), r.supplier); } catch (err) { item = null; }
    if (!item || item.key !== r.key) { console.error('online_items 잘못된 행: ' + r.key); return null; }
    const cat = odUncell_(r.category_override);
    return {
      key: item.key, id: item.id, supplier: item.supplier, item: item,
      hidden: String(r.hidden).toUpperCase() === 'TRUE', hiddenReason: odUncell_(r.hidden_reason), hiddenAt: r.hidden_at,
      categoryOverride: ['food', 'household', 'excluded'].indexOf(cat) >= 0 ? cat : '', overrideUntil: r.override_until,
      firstSeenAt: r.first_seen_at, lastReceivedAt: r.last_received_at,
    };
  }).filter(Boolean);
}

function odWriteRecords_(records, ctx) {
  const ev = odEvaluate(records, ctx);
  const now = nowIso_();
  const rows = ev.map(function (r) {
    return {
      key: r.key, id: r.id, supplier: r.supplier, status: r.status, holds: r.holds.join(','),
      title: odCell_(r.item.title), price: r.item.price == null ? '' : r.item.price, seller: odCell_(r.item.seller), category: r.category,
      last_received_at: r.lastReceivedAt, ends_at: r.item.endsAt, hidden: r.hidden ? 'TRUE' : '', hidden_reason: odCell_(r.hiddenReason),
      hidden_at: r.hiddenAt || '', category_override: r.categoryOverride || '', override_until: r.overrideUntil || '',
      first_seen_at: r.firstSeenAt, updated_at: now, payload: JSON.stringify(r.item),
    };
  });
  writeTable_(sheet_('online_items'), SHEETS.online_items, rows);
  CacheService.getScriptCache().remove(OD_CACHE_KEY);
  return ev;
}

function odCounts_(ev, supplier) {
  const c = { published: 0, held: 0, scheduled: 0, stale: 0, ended: 0, hidden: 0 };
  ev.forEach(function (r) { if (!supplier || r.supplier === supplier) c[r.status] = (c[r.status] || 0) + 1; });
  return c;
}

// ============ 직접 고른 쿠팡 특가 (online_picks) ============

function odReadPicks_() {
  return readTable_('online_picks').rows.filter(function (r) { return /^pk_[0-9a-z]{8,24}$/.test(String(r.id)); }).map(function (r) {
    return {
      id: r.id, title: odUncell_(r.title), url: String(r.url), imageUrl: odPickImage(String(r.image_url || '')), category: String(r.category), item: String(r.item || ''), note: odUncell_(r.note), memo: odUncell_(r.memo),
      price: r.price === '' || r.price == null ? null : Number(r.price), priceCheckedAt: String(r.price_checked_at || ''), endsAt: String(r.ends_at || ''),
      hidden: String(r.hidden).toUpperCase() === 'TRUE', createdAt: String(r.created_at || ''), updatedAt: String(r.updated_at || ''),
      rank: /^[1-9]\d?$/.test(String(r.rank || '')) ? Number(r.rank) : 0,
    };
  });
}
function odWritePicks_(picks) {
  const now = Date.now();
  // 노출이 끝난 지 30일 지난 것은 정리한다 (숨김도 같은 기준)
  const keep = picks.filter(function (p) { return Date.parse(p.endsAt) > now - OD_PICK_MAX_DAYS * OD_DAY; });
  writeTable_(sheet_('online_picks'), SHEETS.online_picks, keep.map(function (p) {
    return {
      id: p.id, status: p.hidden ? 'hidden' : Date.parse(p.endsAt) > now ? 'published' : 'ended',
      title: odCell_(p.title), url: p.url, category: p.category, note: odCell_(p.note), price: p.price == null ? '' : p.price,
      price_checked_at: p.priceCheckedAt || '', ends_at: p.endsAt, hidden: p.hidden ? 'TRUE' : '', memo: odCell_(p.memo),
      created_at: p.createdAt, updated_at: p.updatedAt, image_url: p.imageUrl || '', item: p.item || '', rank: p.rank || '',
    };
  }));
  CacheService.getScriptCache().remove(OD_CACHE_KEY);
}
const odNewest_ = function (a, b) { return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0; };
// 공개 순서: 인기순으로 고른 항목 카드는 오늘 순위대로(1위 먼저), 나머지는 최근에 올린 것 먼저
const odPublicOrder_ = function (a, b) { return ((a.rank || 99) - (b.rank || 99)) || odNewest_(a, b); };

// ============ 자동으로 찾은 후보 (online_leads, 관리 화면 전용) ============

function odReadLeads_() {
  return readTable_('online_leads').rows.filter(function (r) { return /^[a-z]+:\d{1,12}$/.test(String(r.key)); }).map(function (r) {
    return {
      key: String(r.key), status: ['new', 'used', 'dismissed'].indexOf(r.status) >= 0 ? r.status : 'new', source: String(r.source), title: odUncell_(r.title),
      priceHint: r.price_hint === '' || r.price_hint == null ? null : Number(r.price_hint), freeShipping: String(r.free_shipping).toUpperCase() === 'TRUE',
      coupangUrl: String(r.coupang_url || ''), affiliateOnly: String(r.affiliate_only).toUpperCase() === 'TRUE', postUrl: String(r.post_url || ''),
      postedAt: String(r.posted_at || ''), foundAt: String(r.found_at || ''),
    };
  });
}
function odWriteLeads_(leads) {
  const from = Date.now() - OD_LEAD_KEEP_DAYS * OD_DAY;
  const keep = leads.filter(function (l) { return Date.parse(l.foundAt) > from; })
    .sort(function (a, b) { return a.foundAt < b.foundAt ? 1 : a.foundAt > b.foundAt ? -1 : 0; }).slice(0, OD_LEAD_MAX);
  writeTable_(sheet_('online_leads'), SHEETS.online_leads, keep.map(function (l) {
    return { key: l.key, status: l.status, source: l.source, title: odCell_(l.title), price_hint: l.priceHint == null ? '' : l.priceHint,
      free_shipping: l.freeShipping ? 'TRUE' : '', coupang_url: l.coupangUrl, affiliate_only: l.affiliateOnly ? 'TRUE' : '', post_url: l.postUrl,
      posted_at: l.postedAt, found_at: l.foundAt };
  }));
}
// ---------- 가격 기록 (11/06: AMONG이 확인한 가격으로 최근 30일 최저 계산) ----------
// 카드에 가격을 새로 확인해 저장할 때마다(관리 화면 저장·여러 개 한 번에·매일 아침 가격 일괄 기록) 한 줄씩 남긴다. 35일 지나면 정리.
const OD_PRICE_LOG_KEEP_DAYS = 35;
function odReadPriceLog_() {
  return readTable_('online_price_log').rows.map(function (r) {
    return { pickId: String(r.pick_id), price: Number(r.price), at: String(r.checked_at) };
  }).filter(function (r) { return /^pk_[0-9a-z]{8,24}$/.test(r.pickId) && Number.isSafeInteger(r.price) && r.price > 0 && Number.isFinite(Date.parse(r.at)); });
}
function odAppendPriceLog_(entries) {
  if (!entries.length) return;
  const from = Date.now() - OD_PRICE_LOG_KEEP_DAYS * OD_DAY;
  const rows = odReadPriceLog_().concat(entries).filter(function (r) { return Date.parse(r.at) > from; }).slice(-20000);
  writeTable_(sheet_('online_price_log'), SHEETS.online_price_log, rows.map(function (r) { return { pick_id: r.pickId, price: r.price, checked_at: r.at }; }));
}
/** 처음 배포 때 한 번: 기록이 비어 있으면 지금 카드에 있는 확인 가격을 첫 기록으로 (migrate_에서 잠금 안에서 부름) */
function odSeedPriceLog_() {
  if (odReadPriceLog_().length) return;
  const from = Date.now() - OD_LOW_DAYS * OD_DAY;
  odAppendPriceLog_(odReadPicks_().filter(function (p) { return odPosInt_(p.price) && Date.parse(p.priceCheckedAt) > from; })
    .map(function (p) { return { pickId: p.id, price: p.price, at: p.priceCheckedAt }; }));
}
/** 카드별 최근 30일 기록 통계 { pk_…: {low, high, days, since} } */
function odPriceStatsMap_(now) {
  const by = {}, out = {};
  odReadPriceLog_().forEach(function (r) { (by[r.pickId] = by[r.pickId] || []).push(r); });
  Object.keys(by).forEach(function (id) { out[id] = odPriceStats(by[id], now); });
  return out;
}
/**
 * 가격 일괄 기록 (관리 화면 '가격 일괄 기록' · 매일 아침 확인 워크플로 online-prices.yml).
 * 있는 카드만 바꾸고 가격·확인 시각을 지금으로, 항목별 상품은 노출을 30일 뒤까지 늘린다(계속 파는 상품). 특가·숨긴 카드는 그대로.
 */
function odApplyPrices_(list, now) {
  const obs = odPriceObservations(list);
  if (!obs.length) throw new Error('기록할 가격이 없어요. [{"id":"pk_…","price":12900}] 형식으로 넣으세요.');
  const picks = odReadPicks_();
  const at = new Date(now).toISOString();
  const done = [], missing = [];
  obs.forEach(function (o) {
    const p = picks.filter(function (x) { return x.id === o.id; })[0];
    if (!p || p.hidden) { missing.push(o.id); return; }
    p.price = o.price; p.priceCheckedAt = at; p.updatedAt = at;
    if (p.item) p.endsAt = new Date(Math.max(Date.parse(p.endsAt) || 0, now + OD_PICK_ITEM_DAYS * OD_DAY)).toISOString();
    done.push(p);
  });
  if (done.length) { odWritePicks_(picks); odAppendPriceLog_(odFreshLog_(done, at)); }
  return { recorded: done.length, missing: missing };
}
/** 매일 아침 확인 워크플로(COLLECTOR_TOKEN)가 부르는 입구. 카드 목록(공개 정보)과 기록 결과만 돌려준다 */
function odPricesIngest_(b) {
  const r = odApplyPrices_(b.prices, Date.now());
  return { ok: true, recorded: r.recorded, missing: r.missing };
}
/** 저장한 카드 중 지금 가격을 확인한 것(확인 시각 = 지금)을 기록 줄로 */
function odFreshLog_(picks, at) {
  return picks.filter(function (p) { return odPosInt_(p.price) && p.priceCheckedAt === at; }).map(function (p) { return { pickId: p.id, price: p.price, at: at }; });
}

/**
 * 항목별 인기순 교체 (매일 아침 작업 → online-item-rotate.yml → COLLECTOR_TOKEN).
 * b.items = { protein: [{title, price, url?, imageUrl?}, …(순위 순서)], … }. 항목마다 odRotatePlan으로 따로 판단하고,
 * 순위가 어제와 같으면 카드는 그대로 두고 가격만 기록한다. 한 항목이 실패해도 다른 항목은 반영한다.
 */
function odItemRotateIngest_(b) {
  const input = b && b.items && typeof b.items === 'object' ? b.items : null;
  if (!input) throw new Error('bad items');
  const keys = Object.keys(input).filter(function (k) { return odItem_(k); }).slice(0, 8);
  if (!keys.length) throw new Error('항목이 없어요.');
  const now = Date.now(), at = new Date(now).toISOString();
  const picks = odReadPicks_();
  const report = {}, fresh = [];
  keys.forEach(function (item) {
    const plan = odRotatePlan(picks, item, input[item], now);
    if (!plan.ok) { report[item] = { applied: false, reason: plan.reason, skipped: plan.skipped }; return; }
    if (picks.length + plan.add.length > 400) { report[item] = { applied: false, reason: '카드가 너무 많아요', skipped: plan.skipped }; return; }
    picks.forEach(function (p) { if (p.item === item && p.rank) p.rank = 0; });
    plan.keep.forEach(function (k) {
      const p = k.pick;
      p.rank = k.rank; p.price = k.price; p.priceCheckedAt = at; p.updatedAt = at;
      p.endsAt = new Date(Math.max(Date.parse(p.endsAt) > now ? Date.parse(p.endsAt) : 0, now + OD_PICK_ITEM_DAYS * OD_DAY)).toISOString();
      if (String(p.memo || '').indexOf(OD_ROTATE_MARK) === 0) p.memo = '인기순 ' + odKstDay_(now);
      fresh.push(p);
    });
    plan.add.forEach(function (a) {
      const res = odPickInput(a.input, now, null);
      res.pick.id = 'pk_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16).toLowerCase();
      res.pick.rank = a.rank;
      picks.push(res.pick); fresh.push(res.pick);
    });
    plan.retire.forEach(function (p) { p.endsAt = at; p.rank = 0; p.updatedAt = at; p.memo = OD_ROTATE_MARK + odKstDay_(now); });
    report[item] = { applied: true, changed: plan.changed, kept: plan.keep.length, added: plan.add.map(function (a) { return a.input.title; }),
      retired: plan.retire.map(function (p) { return p.title; }), skipped: plan.skipped };
  });
  if (fresh.length) { odWritePicks_(picks); odAppendPriceLog_(odFreshLog_(fresh, at)); }
  return { ok: true, items: report };
}

/** 수집기가 찾은 후보를 같은 기준(odLeadInput)으로 다시 검사해 새 것만 더한다 */
function odLeadsIngest_(b) {
  if (!Array.isArray(b.leads) || b.leads.length > 50) throw new Error('bad leads');
  const now = Date.now();
  const leads = odReadLeads_();
  const have = {};
  leads.forEach(function (l) { have[l.key] = true; });
  let added = 0;
  b.leads.forEach(function (raw) {
    const l = odLeadInput(raw, now);
    if (!l || have[l.key]) return;
    l.status = 'new'; leads.push(l); have[l.key] = true; added++;
  });
  odWriteLeads_(leads);
  return { ok: true, added: added, total: leads.length };
}

// ============ 공개 ============

/** 게시 중인 상품만. 상태는 읽을 때 다시 계산하므로 기한이 지난 상품은 새 수집 없이도 빠진다. */
function getOnlineDeals_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(OD_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  const ctx = odCtx_();
  const live = odEvaluate(odReadRecords_(), ctx).filter(function (r) { return r.status === 'published'; }).sort(odCompare);
  const items = live.map(function (r) { return odPublic(r); });
  const disclosures = [];
  items.forEach(function (i) {
    const d = i.affiliate && OD_SUPPLIERS[i.supplier].disclosure;
    if (d && disclosures.indexOf(d) < 0) disclosures.push(d);
  });
  // live: 자동 게시 중인 공급처가 재확인 기한 안에 응답함 / delayed: 연결은 됐지만 최근 확인이 늦어짐 / preparing: 아직 연결 전
  const pubs = Object.keys(ctx.suppliers).map(function (id) { return ctx.suppliers[id]; }).filter(function (s) { return s.mode === 'publish' && s.lastSuccessAt; });
  const recent = pubs.some(function (s) { return Date.parse(s.lastSuccessAt) > ctx.now - ctx.rules.maxAgeHours * OD_HOUR; });
  const state = items.length || recent ? 'live' : pubs.length ? 'delayed' : 'preparing';
  const stats = odPriceStatsMap_(ctx.now);
  const picks = odReadPicks_().sort(odPublicOrder_).map(function (p) { return odPickPublic(p, ctx.now, stats[p.id]); }).filter(Boolean).slice(0, OD_PICK_MAX);
  if (picks.length && disclosures.indexOf(OD_SUPPLIERS.coupang.disclosure) < 0) disclosures.unshift(OD_SUPPLIERS.coupang.disclosure);
  const out = { ok: true, generated_at: nowIso_(), state: state, count: items.length, items: items, picks: picks, disclosures: disclosures };
  try { cache.put(OD_CACHE_KEY, JSON.stringify(out), 60); } catch (err) { /* 100KB 초과 시 캐시 생략 */ }
  return out;
}

// ============ 수집기 (COLLECTOR_TOKEN) ============

function odLock_() {
  const l = odJsonProp_('ONLINE_RUN_LOCK');
  return l && l.run_id && Date.parse(l.until) > Date.now() ? l : null;
}

function odRunStart_(b) {
  const runId = odRunId_(b.run_id);
  if (!runId) throw new Error('bad run_id');
  const lock = odLock_();
  if (lock) return { ok: true, busy: true, running: lock.run_id };
  const now = Date.now();
  odSetJsonProp_('ONLINE_RUN_LOCK', { run_id: runId, trigger: String(b.trigger || '').slice(0, 20), started_at: new Date(now).toISOString(), until: new Date(now + OD_LOCK_MIN * 60000).toISOString() });
  const ctx = odCtx_();
  return { ok: true, run_id: runId, rules: ctx.rules, suppliers: ctx.suppliers };
}

function odCheckRun_(runId) {
  const lock = odLock_();
  if (!lock || lock.run_id !== odRunId_(runId)) throw new Error('run_not_active');
  return lock;
}

function odIngest_(b) {
  odCheckRun_(b.run_id);
  const sup = String(b.supplier || '');
  if (!OD_SUPPLIERS[sup]) throw new Error('unknown supplier');
  const now = Date.now();
  const states = odSupplierStates(odJsonProp_('ONLINE_SUPPLIERS'));
  if (b.ok !== true) {
    // 실패·호출 제한: 상품은 건드리지 않고 다음 시도 시각만 늦춘다.
    states[sup] = odAfterFailure(states[sup], { error: b.error, rateLimited: b.rate_limited === true, retryAfterMs: Number(b.retry_after_ms) }, now);
    odSetJsonProp_('ONLINE_SUPPLIERS', states);
    return { ok: true, stats: { skipped: true }, supplier: states[sup] };
  }
  if (!Array.isArray(b.items) || b.items.length > OD_MAX_INGEST) throw new Error('bad items');
  const observed = Date.parse(b.observed_at);
  if (!Number.isFinite(observed) || observed > now + 5 * 60000 || observed < now - OD_HOUR) throw new Error('stale payload');
  const merged = odMerge(odReadRecords_(), { supplier: sup, ok: true, items: b.items, observedAt: b.observed_at }, now);
  const s = states[sup];
  s.lastAttemptAt = new Date(now).toISOString();
  s.lastReceived = merged.stats.received;
  s.failures = 0; s.pauseUntil = ''; s.lastError = '';
  s.lastResult = merged.stats.received ? 'ok' : 'empty';
  if (merged.stats.received) s.lastSuccessAt = s.lastAttemptAt;
  odSetJsonProp_('ONLINE_SUPPLIERS', states);
  // 빈 응답·전부 형식 오류면 상품 탭을 다시 쓰지 않는다.
  if (merged.stats.skipped) return { ok: true, stats: merged.stats, counts: odCounts_(odEvaluate(odReadRecords_(), odCtx_()), sup) };
  const ev = odWriteRecords_(odPrune(merged.records, now), odCtx_());
  return { ok: true, stats: merged.stats, counts: odCounts_(ev, sup) };
}

function odRunFinish_(b) {
  const runId = odRunId_(b.run_id);
  const lock = odJsonProp_('ONLINE_RUN_LOCK') || {};
  const results = Array.isArray(b.results) ? b.results.slice(0, 10) : [];
  const states = odSupplierStates(odJsonProp_('ONLINE_SUPPLIERS'));
  const now = nowIso_();
  const errors = [];
  let received = 0;
  results.forEach(function (r) {
    if (!r || !OD_SUPPLIERS[r.supplier] || !OD_RESULTS[r.result]) return;
    const s = states[r.supplier];
    s.lastRunAt = now;
    // 호출하지 않은 공급처의 현재 상태(승인 대기·키 없음·중지 등)를 관리 화면에 보여 준다.
    if (['off', 'awaiting_access', 'missing_secrets', 'paused', 'too_soon'].indexOf(r.result) >= 0) s.lastResult = r.result;
    received += Number.isSafeInteger(r.received) && r.received > 0 ? r.received : 0;
    if (r.error) errors.push(r.supplier + ': ' + String(r.error).slice(0, 120));
  });
  odSetJsonProp_('ONLINE_SUPPLIERS', states);
  const c = odCounts_(odEvaluate(odReadRecords_(), odCtx_()));
  appendRow_('online_runs', {
    run_id: runId || 'invalid', trigger: odCell_(String(b.trigger || lock.trigger || '').slice(0, 20)), started_at: lock.run_id === runId ? lock.started_at : '', finished_at: now,
    results: results.filter(function (r) { return r && OD_SUPPLIERS[r.supplier]; }).map(function (r) { return r.supplier + ':' + (OD_RESULTS[r.result] ? r.result : 'unknown'); }).join(' '),
    received: received, published: c.published, held: c.held, errors: odCell_(errors.join(' / ').slice(0, 500)),
  });
  const sh = sheet_('online_runs');
  if (sh.getLastRow() > OD_RUNS_KEEP + 100) {
    const t = readTable_('online_runs');
    writeTable_(sh, t.headers, t.rows.slice(-OD_RUNS_KEEP));
  }
  if (lock.run_id && lock.run_id === runId) odSetJsonProp_('ONLINE_RUN_LOCK', null);
  return { ok: true, counts: c };
}

// ============ 관리 (ADMIN_TOKEN) ============

function odAdmin_() {
  const ctx = odCtx_();
  const order = { held: 0, published: 1, scheduled: 2, stale: 3, hidden: 4, ended: 5 };
  const ev = odEvaluate(odReadRecords_(), ctx).sort(function (a, b) { return (order[a.status] - order[b.status]) || odCompare(a, b); });
  const runs = readTable_('online_runs').rows.slice(-20).reverse();
  const lock = odLock_();
  return {
    ok: true, now: nowIso_(), rules: ctx.rules, lock: lock ? { run_id: lock.run_id, until: lock.until } : null,
    suppliers: Object.keys(OD_SUPPLIERS).map(function (id) {
      return Object.assign({ id: id, name: OD_SUPPLIERS[id].name, images_allowed: OD_SUPPLIERS[id].imagesAllowed, link_hosts_ready: OD_SUPPLIERS[id].linkHosts.length > 0 }, ctx.suppliers[id]);
    }),
    counts: odCounts_(ev),
    items: ev.slice(0, 500).map(function (r) {
      const it = r.item;
      return {
        id: r.id, supplier: r.supplier, status: r.status, holds: r.holds, category: r.category, category_path: it.categoryPath,
        title: it.title, option: it.option, store: it.store, seller: it.seller, price: it.price, price_basis: it.priceBasis,
        membership: it.membership, conditions: it.conditions, shipping: odShippingText(it), url: it.url, pick: it.pick,
        first_seen_at: r.firstSeenAt, last_received_at: r.lastReceivedAt, ends_at: it.endsAt, visible_until: new Date(r.visibleUntil).toISOString(),
        hidden: r.hidden, hidden_reason: r.hiddenReason, category_override: r.categoryOverride, override_until: r.overrideUntil,
      };
    }),
    runs: runs,
    picks: (function () {
      const stats = odPriceStatsMap_(ctx.now);
      return odReadPicks_().sort(odNewest_).map(function (p) {
        const pub = odPickPublic(p, ctx.now, stats[p.id]);
        return Object.assign({}, p, { live: !!pub, price_fresh: !!(pub && pub.price), price_stats: stats[p.id] || null, at_low: !!(pub && pub.atLow) });
      });
    })(),
    leads: odReadLeads_().filter(function (l) { return l.status === 'new'; })
      .sort(function (a, b) { return a.foundAt < b.foundAt ? 1 : a.foundAt > b.foundAt ? -1 : 0; }).slice(0, 60),
  };
}

function odAdminSet_(b) {
  const op = String(b.op || '');
  const now = Date.now();
  if (op === 'rules') {
    odSetJsonProp_('ONLINE_RULES', odRules(b.rules));
  } else if (op === 'supplier_mode' || op === 'supplier_resume') {
    const states = odSupplierStates(odJsonProp_('ONLINE_SUPPLIERS'));
    const s = states[String(b.supplier || '')];
    if (!s) throw new Error('알 수 없는 공급처예요.');
    if (op === 'supplier_mode') {
      if (!OD_MODES[b.mode]) throw new Error('알 수 없는 모드예요.');
      s.mode = b.mode;
    } else { s.pauseUntil = ''; s.failures = 0; }
    odSetJsonProp_('ONLINE_SUPPLIERS', states);
  } else if (op === 'hide' || op === 'unhide' || op === 'category') {
    const records = odReadRecords_();
    const rec = records.filter(function (r) { return r.id === b.id; })[0];
    if (!rec) throw new Error('상품을 찾을 수 없어요. 목록을 새로고침해 주세요.');
    if (op === 'hide') {
      rec.hidden = true; rec.hiddenAt = new Date(now).toISOString();
      rec.hiddenReason = String(b.reason || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100);
    } else if (op === 'unhide') {
      rec.hidden = false; rec.hiddenAt = ''; rec.hiddenReason = '';
    } else {
      const cat = String(b.category || '');
      if (['', 'food', 'household', 'excluded'].indexOf(cat) < 0) throw new Error('알 수 없는 분류예요.');
      const until = b.until ? Date.parse(b.until) : NaN;
      if (b.until && (!Number.isFinite(until) || until <= now || until > now + 366 * OD_DAY)) throw new Error('분류 지정 기한을 확인해 주세요.');
      rec.categoryOverride = cat;
      rec.overrideUntil = cat && Number.isFinite(until) ? new Date(until).toISOString() : '';
    }
    odWriteRecords_(records, odCtx_());
  } else if (op === 'pick_save') {
    const picks = odReadPicks_();
    const id = b.pick && b.pick.id ? String(b.pick.id) : '';
    const prev = id ? picks.filter(function (p) { return p.id === id; })[0] : null;
    if (id && !prev) throw new Error('카드를 찾을 수 없어요. 목록을 새로고침해 주세요.');
    if (!prev && picks.length >= 200) throw new Error('카드가 너무 많아요. 끝난 카드를 지운 뒤 다시 등록하세요.');
    const res = odPickInput(b.pick, now, prev);
    if (res.errors.length) throw new Error(res.errors.join(' '));
    if (!prev) {
      res.pick.id = 'pk_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16).toLowerCase();
      picks.push(res.pick);
    } else { res.pick.rank = prev.rank || 0; picks[picks.indexOf(prev)] = res.pick; }
    odWritePicks_(picks);
    odAppendPriceLog_(odFreshLog_([res.pick], new Date(now).toISOString()));
    // 자동 후보로 만든 카드면 그 후보를 '사용함'으로 (목록에서 빠짐)
    if (b.lead_key) {
      const leads = odReadLeads_();
      const lead = leads.filter(function (l) { return l.key === String(b.lead_key); })[0];
      if (lead) { lead.status = 'used'; odWriteLeads_(leads); }
    }
  } else if (op === 'pick_save_many') {
    // 여러 상품 한 번에 (11/06 항목별 상품): 모두 검사를 통과해야 한꺼번에 저장한다. 이미 올린 링크·같은 링크 두 번은 거절.
    const list = Array.isArray(b.picks) ? b.picks : [];
    if (!list.length || list.length > 30) throw new Error('한 번에 1~30개까지 올릴 수 있어요.');
    const picks = odReadPicks_();
    if (picks.length + list.length > 200) throw new Error('카드가 너무 많아요. 끝난 카드를 지운 뒤 다시 등록하세요.');
    const seen = {};
    picks.forEach(function (p) { seen[p.url] = true; });
    const errs = [], made = [];
    list.forEach(function (raw, i) {
      const input = raw && typeof raw === 'object' ? Object.assign({}, raw, { id: '' }) : raw;
      const res = odPickInput(input, now, null);
      if (res.errors.length) errs.push((i + 1) + '번: ' + res.errors.join(' '));
      else if (seen[res.pick.url]) errs.push((i + 1) + '번: 이미 올린 링크예요.');
      else {
        seen[res.pick.url] = true;
        res.pick.id = 'pk_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16).toLowerCase();
        made.push(res.pick);
      }
    });
    if (errs.length) throw new Error(errs.join(' / '));
    odWritePicks_(picks.concat(made));
    odAppendPriceLog_(odFreshLog_(made, new Date(now).toISOString()));
  } else if (op === 'pick_prices') {
    const result = odApplyPrices_(b.prices, now);
    return Object.assign(odAdmin_(), { price_result: result });
  } else if (op === 'lead_dismiss') {
    const leads = odReadLeads_();
    const lead = leads.filter(function (l) { return l.key === String(b.key || ''); })[0];
    if (!lead) throw new Error('후보를 찾을 수 없어요. 목록을 새로고침해 주세요.');
    lead.status = 'dismissed';
    odWriteLeads_(leads);
  } else if (op === 'pick_hide' || op === 'pick_delete') {
    const picks = odReadPicks_();
    const prev = picks.filter(function (p) { return p.id === b.id; })[0];
    if (!prev) throw new Error('카드를 찾을 수 없어요. 목록을 새로고침해 주세요.');
    if (op === 'pick_hide') { prev.hidden = b.hidden === true; prev.updatedAt = new Date(now).toISOString(); }
    else picks.splice(picks.indexOf(prev), 1);
    odWritePicks_(picks);
  } else if (op === 'rerun') {
    const p = PropertiesService.getScriptProperties();
    const last = Number(p.getProperty('ONLINE_RERUN_MS') || 0);
    if (now - last < OD_RERUN_COOLDOWN_MIN * 60000) throw new Error(OD_RERUN_COOLDOWN_MIN + '분 안에 다시 실행할 수 없어요.');
    if (odLock_()) throw new Error('이미 실행 중이에요.');
    const res = dispatchWorkflow_('admin', OD_WORKFLOW);
    if (!res.ok) throw new Error('실행 요청 실패: ' + res.error);
    p.setProperty('ONLINE_RERUN_MS', String(now));
  } else {
    throw new Error('알 수 없는 작업이에요.');
  }
  CacheService.getScriptCache().remove(OD_CACHE_KEY);
  return odAdmin_();
}

// END GENERATED ONLINE DEALS
