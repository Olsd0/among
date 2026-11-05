// 온라인 특가 자동 실행: 공급처별로 따로 (한 곳 실패가 다른 곳을 막지 않음)
//   시작(잠금) → 공급처 호출 → 표준화 → 시트 반영(검증·게시 판단은 Apps Script가 같은 규칙으로) → 마무리
// 연결된 공급처가 없으면 호출 없이 상태만 기록한다.
//
// 사용: node src/online/run.js          (APPS_SCRIPT_URL · COLLECTOR_TOKEN 필요)
//       ONLINE_MODE=dry node src/online/run.js   (시트에 쓰지 않고 결과만 출력)
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { OD_SUPPLIERS, OD_RESULTS, odNormalize, odRules, odSupplierStates } from '../online-deals-core.js';
import { ADAPTERS } from './suppliers.js';
import { createHttpClient, RateLimitError, safeError } from './http.js';
import { SheetClient } from '../sheet.js';

export async function runOnlineDeals({
  api, adapters = ADAPTERS, env = process.env, now = () => Date.now(), httpFactory = createHttpClient,
  trigger = 'schedule', dry = false, log = () => {},
} = {}) {
  const runId = 'odr_' + randomUUID().replace(/-/g, '').slice(0, 16);
  let start;
  if (dry) start = { ok: true, rules: odRules(), suppliers: odSupplierStates() };
  else {
    start = await api.post('online_run_start', { run_id: runId, trigger });
    if (start.busy) { log('다른 온라인 특가 실행이 진행 중이라 건너뜀'); return { runId, skipped: 'busy', results: [] }; }
  }
  const states = odSupplierStates(start.suppliers);
  const results = [];
  for (const id of Object.keys(OD_SUPPLIERS)) {
    const st = states[id], ad = adapters[id];
    const base = { supplier: id, received: 0, invalid: 0 };
    let r;
    if (st.mode === 'off') r = { ...base, result: 'off' };
    else if (!ad || typeof ad.fetch !== 'function') r = { ...base, result: 'awaiting_access' };
    else if ((ad.requiredSecrets || []).some(k => !env[k])) r = { ...base, result: 'missing_secrets' };
    else if (st.pauseUntil && Date.parse(st.pauseUntil) > now()) r = { ...base, result: 'paused' };
    else if (st.lastAttemptAt && now() - Date.parse(st.lastAttemptAt) < (ad.minIntervalMinutes ?? 30) * 60000) r = { ...base, result: 'too_soon' };
    else r = await runSupplier({ id, ad, api, env, now, httpFactory, rules: start.rules, runId, dry, base });
    results.push(r);
    log(`${OD_SUPPLIERS[id].name}: ${OD_RESULTS[r.result] || r.result}${r.received ? ` · 받은 상품 ${r.received}개` : ''}${r.error ? ` · ${r.error}` : ''}`);
  }
  if (!dry) {
    try { await api.post('online_run_finish', { run_id: runId, trigger, results }); }
    catch (e) { log('마무리 기록 실패 (잠금은 20분 뒤 자동 해제): ' + safeError(e)); }
  }
  return { runId, results };
}

async function runSupplier({ id, ad, api, env, now, httpFactory, rules, runId, dry, base }) {
  const observedAt = new Date(now()).toISOString();
  let items;
  try {
    const http = httpFactory({ allowedHosts: ad.apiHosts || [], ...(ad.http || {}) });
    const out = await ad.fetch({ http, env, rules, now: now() });
    const raw = Array.isArray(out?.items) ? out.items : [];
    items = raw.map(x => odNormalize({ ...x, observedAt: x?.observedAt || observedAt }, id)).filter(Boolean);
    base.invalid = raw.length - items.length;
  } catch (e) {
    const rate = e instanceof RateLimitError;
    const r = { ...base, result: rate ? 'rate_limited' : 'failed', error: safeError(e) };
    if (!dry) {
      // 실패를 알려 다음 시도 시각만 늦춘다. 기존 상품은 그대로 둔다.
      try { await api.post('online_ingest', { run_id: runId, supplier: id, ok: false, error: r.error, rate_limited: rate, retry_after_ms: rate ? e.retryAfterMs : null }); }
      catch (err) { r.error += ' / 기록 실패: ' + safeError(err); }
    }
    return r;
  }
  const r = { ...base, result: items.length ? 'ok' : 'empty', received: items.length };
  if (!dry) {
    try {
      const res = await api.post('online_ingest', { run_id: runId, supplier: id, ok: true, items, observed_at: observedAt, invalid: base.invalid });
      Object.assign(r, { stats: res.stats, counts: res.counts });
    } catch (e) { r.result = 'failed'; r.error = '시트 반영 실패: ' + safeError(e); }
  } else r.items = items;
  return r;
}

function summary(out) {
  const rows = out.results.map(r => `| ${OD_SUPPLIERS[r.supplier].name} | ${OD_RESULTS[r.result] || r.result} | ${r.received} | ${r.invalid} | ${r.counts ? `${r.counts.published ?? 0} / ${r.counts.held ?? 0}` : '—'} | ${r.error || ''} |`);
  return [`### 온라인 특가 실행 ${out.runId}${out.skipped ? ' (건너뜀: 다른 실행 진행 중)' : ''}`, '',
    '| 공급처 | 결과 | 받은 상품 | 형식 오류 | 게시 / 보류 | 비고 |', '| --- | --- | --- | --- | --- | --- |', ...rows,
    '', '실제 연결 상태: 승인·키가 확인된 공급처만 호출합니다. "승인 대기"는 실제 상품을 받지 않았다는 뜻입니다.'].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dry = process.env.ONLINE_MODE === 'dry';
  const api = dry ? null : new SheetClient(process.env.APPS_SCRIPT_URL, process.env.COLLECTOR_TOKEN);
  try {
    const out = await runOnlineDeals({ api, dry, trigger: process.env.TRIGGER || 'schedule', log: m => console.log(m) });
    if (dry) for (const r of out.results) if (r.items) console.log(JSON.stringify({ supplier: r.supplier, items: r.items.slice(0, 5) }, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(out) + '\n');
    console.log(summary(out));
  } catch (e) {
    console.error('온라인 특가 실행 실패:', e.message?.replace(/token=[^&\s]+/gi, 'token=***'));
    process.exit(1);
  }
}
