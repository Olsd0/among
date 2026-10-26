/**
 * AMONG 시트 백엔드 (Google Apps Script 웹앱)
 * ------------------------------------------------------------
 * 탭: coupons · sources · run_log · events · reports
 * 공개 API (토큰 없음): GET coupons · status / POST refresh · event · report
 * 수집기 API (COLLECTOR_TOKEN): POST run_start · sources · ingest · run_finish
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
 *
 * 최초 1회: 편집기에서 setup() 실행 → 탭·머리글 생성, 예시 출처 입력.
 */

// 최초 1회 실행 함수 (편집기 기본 선택이 되도록 맨 위에 둠)
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach((name) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const headers = SHEETS[name];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // 날짜·숫자 자동 변환 방지 (시트가 '2026-10-31'을 날짜 객체로 바꾸지 않게)
    sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
  });
  const src = sheet_('sources');
  if (src.getLastRow() < 2) {
    SAMPLE_SOURCES_.forEach((s) => appendRow_('sources', s));
  }
  const p = PropertiesService.getScriptProperties();
  ['COLLECTOR_TOKEN', 'ADMIN_TOKEN'].forEach((k) => {
    if (!p.getProperty(k)) p.setProperty(k, Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  });
  setState_(p, 'idle');
  Logger.log('설정 완료. 스크립트 속성에서 COLLECTOR_TOKEN·ADMIN_TOKEN 값을 확인해 GitHub Secret과 대시보드에 넣으세요.');
}

const TZ = 'Asia/Seoul';
const SHEETS = {
  coupons: ['id', 'status', 'brand', 'category', 'menu', 'item_type', 'regular_price', 'coupon_price', 'discount_rate',
    'discount_type', 'discount_value', 'max_discount', 'min_order', 'channels', 'audience', 'app_only',
    'start_date', 'end_date', 'conditions', 'confidence', 'issues', 'evidence', 'source_id', 'source_url',
    'official_link', 'first_seen', 'checked_at', 'updated_at', 'hash', 'last_run_id'],
  sources: ['id', 'active', 'brand', 'category', 'url', 'selector', 'exclude', 'follow', 'detail_selector',
    'max_follow', 'max_shots', 'wait_ms', 'official_link', 'notes', 'last_ok_at', 'last_error'],
  run_log: ['run_id', 'trigger', 'state', 'started_at', 'finished_at', 'duration_s', 'model', 'sources_ok',
    'sources_failed', 'pages', 'found', 'published', 'pending', 'rejected', 'auto_publish_rate', 'inserted',
    'updated', 'unchanged', 'gone', 'expired', 'input_tokens', 'output_tokens', 'errors'],
  events: ['ts', 'sid', 'type', 'coupon_id', 'brand', 'value'],
  reports: ['ts', 'sid', 'coupon_id', 'brand', 'menu', 'reason', 'memo', 'status'],
};
const PUBLIC_FIELDS = ['id', 'brand', 'category', 'menu', 'item_type', 'regular_price', 'coupon_price', 'discount_rate',
  'discount_type', 'discount_value', 'max_discount', 'min_order', 'channels', 'audience', 'app_only', 'start_date', 'end_date',
  'conditions', 'source_url', 'official_link', 'first_seen', 'checked_at'];
const NUM_FIELDS = ['regular_price', 'coupon_price', 'discount_rate', 'discount_value', 'max_discount', 'min_order', 'confidence'];
const EVENT_TYPES = ['visit', 'click', 'detail', 'refresh', 'share', 'filter'];
const REPORT_REASONS = ['가격이 달라요', '이미 끝났어요', '조건이 달라요', '공식 앱에 없어요', '기타'];
const STALE_MIN = 30;           // queued/running 상태가 이보다 오래되면 멈춘 것으로 본다
const CACHE_KEY = 'coupons_v2';

// ============ 진입점 ============

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    switch (p.action || 'coupons') {
      case 'coupons': return json_(getCoupons_());
      case 'status': return json_(getStatus_());
      default: return json_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  try {
    switch (body.action) {
      // 공개
      case 'refresh': return json_(requestRefresh_());
      case 'event': return json_(logEvent_(body));
      case 'report': return json_(logReport_(body));
      // 수집기
      case 'run_start': auth_(body, 'COLLECTOR_TOKEN'); return json_(runStart_(body));
      case 'sources': auth_(body, 'COLLECTOR_TOKEN'); return json_({ ok: true, sources: getSources_() });
      case 'ingest': auth_(body, 'COLLECTOR_TOKEN'); return json_({ ok: true, result: withLock_(() => ingest_(body)) });
      case 'run_finish': auth_(body, 'COLLECTOR_TOKEN'); return json_(runFinish_(body.report || {}));
      // 관리
      case 'metrics': auth_(body, 'ADMIN_TOKEN'); return json_(getMetrics_(body));
      default: return json_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
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
      o.app_only = r.app_only === true || String(r.app_only).toUpperCase() === 'TRUE';
      return o;
    });
  const props = PropertiesService.getScriptProperties();
  const out = { ok: true, today: today, last_checked_at: props.getProperty('LAST_SUCCESS_AT') || '', count: rows.length, coupons: rows };
  try { cache.put(CACHE_KEY, JSON.stringify(out), 120); } catch (err) { /* 100KB 초과 시 캐시 생략 */ }
  return out;
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

    const res = dispatchWorkflow_('button');
    if (!res.ok) return { ok: false, error: res.error };
    p.setProperty('LAST_REFRESH_REQ_MS', String(Date.now()));
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
  appendRow_('events', {
    ts: nowIso_(), sid: clip_(b.sid, 40), type: type,
    coupon_id: clip_(b.coupon_id, 40), brand: clip_(b.brand, 30), value: clip_(b.value, 100),
  });
  return { ok: true };
}

function logReport_(b) {
  const reason = REPORT_REASONS.indexOf(b.reason) >= 0 ? b.reason : '기타';
  appendRow_('reports', {
    ts: nowIso_(), sid: clip_(b.sid, 40), coupon_id: clip_(b.coupon_id, 40), brand: clip_(b.brand, 30),
    menu: clip_(b.menu, 80), reason: reason, memo: clip_(b.memo, 500), status: '새 제보',
  });
  return { ok: true };
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
  CacheService.getScriptCache().remove(CACHE_KEY);
  return result;
}

function couponToRow_(c, runId, checkedAt) {
  const r = {};
  SHEETS.coupons.forEach((h) => { r[h] = c[h] === undefined || c[h] === null ? '' : c[h]; });
  r.channels = (c.channels || []).join(',');
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
  if (rep.state === 'success' || rep.state === 'partial') p.setProperty('LAST_SUCCESS_AT', rep.finished_at || nowIso_());
  CacheService.getScriptCache().remove(CACHE_KEY);
  return { ok: true };
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
  };
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
    "max_follow": 6,
    "max_shots": 4,
    "wait_ms": 1500,
    "official_link": "https://www.mcdonalds.co.kr/kor/promotion/list",
    "notes": "10/26 점검: 수집 가능. 상세 페이지에 정상가·행사가가 글자로 있음(종료일은 대부분 없음)"
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
    "notes": "10/26: 이벤트 목록 주소 확인. 상세는 클릭으로만 열려 목록 배너(이미지)만 읽음. 신메뉴 소개 위주"
  },
  {
    "id": "lotte-coupon",
    "active": "FALSE",
    "brand": "롯데리아",
    "category": "햄버거",
    "url": "https://www.lotteeatz.com/coupon/main",
    "selector": "",
    "exclude": "header; footer",
    "follow": "",
    "detail_selector": "",
    "max_follow": 0,
    "max_shots": 4,
    "wait_ms": 1500,
    "official_link": "https://www.lotteeatz.com/coupon/main",
    "notes": "10/26 점검: robots.txt가 수집 차단 → 자동 수집 불가. 제휴·점주 등록 대상"
  },
  {
    "id": "lotte-event",
    "active": "FALSE",
    "brand": "롯데리아",
    "category": "햄버거",
    "url": "https://www.lotteeatz.com/event/main",
    "selector": "",
    "exclude": "header; footer",
    "follow": "a[href*='/event/main/selectEvent/']",
    "detail_selector": "",
    "max_follow": 6,
    "max_shots": 4,
    "wait_ms": 1500,
    "official_link": "https://www.lotteeatz.com/event/main",
    "notes": "10/26 점검: robots.txt가 수집 차단 → 자동 수집 불가"
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
    "max_follow": 6,
    "max_shots": 4,
    "wait_ms": 1000,
    "official_link": "https://momstouch.co.kr/promotion/list.php",
    "notes": "10/26 점검 3회: GitHub(해외 서버)에서 사이트 접속 자체가 안 됨(해외 IP 차단 추정) → 비활성. 국내 서버에서 돌리거나 제휴로 해결"
  }
];

// ============ 유틸 ============

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function auth_(body, key) {
  const expected = PropertiesService.getScriptProperties().getProperty(key);
  if (!expected || body.token !== expected) throw new Error('unauthorized');
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
  const range = sh.getRange(r, 1, 1, headers.length);
  range.setNumberFormat('@');
  range.setValues([row]);
}

function clip_(v, n) { return String(v === undefined || v === null ? '' : v).slice(0, n); }
function nowIso_() { return new Date().toISOString(); }
function todayKST_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function kstDay_(iso) { const t = Date.parse(iso); return isNaN(t) ? '' : Utilities.formatDate(new Date(t), TZ, 'yyyy-MM-dd'); }
function addDays_(day, n) { const t = Date.parse(day + 'T00:00:00Z') + n * 86400000; return new Date(t).toISOString().slice(0, 10); }
function round_(x, d) { const m = Math.pow(10, d); return Math.round(x * m) / m; }
