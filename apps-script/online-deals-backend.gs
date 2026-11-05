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
      id: r.id, title: odUncell_(r.title), url: String(r.url), category: String(r.category), note: odUncell_(r.note), memo: odUncell_(r.memo),
      price: r.price === '' || r.price == null ? null : Number(r.price), priceCheckedAt: String(r.price_checked_at || ''), endsAt: String(r.ends_at || ''),
      hidden: String(r.hidden).toUpperCase() === 'TRUE', createdAt: String(r.created_at || ''), updatedAt: String(r.updated_at || ''),
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
      created_at: p.createdAt, updated_at: p.updatedAt,
    };
  }));
  CacheService.getScriptCache().remove(OD_CACHE_KEY);
}
const odNewest_ = function (a, b) { return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0; };

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
  const picks = odReadPicks_().sort(odNewest_).map(function (p) { return odPickPublic(p, ctx.now); }).filter(Boolean).slice(0, OD_PICK_MAX);
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
    picks: odReadPicks_().sort(odNewest_).map(function (p) {
      const pub = odPickPublic(p, ctx.now);
      return Object.assign({}, p, { live: !!pub, price_fresh: !!(pub && pub.price) });
    }),
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
    } else picks[picks.indexOf(prev)] = res.pick;
    odWritePicks_(picks);
    // 자동 후보로 만든 카드면 그 후보를 '사용함'으로 (목록에서 빠짐)
    if (b.lead_key) {
      const leads = odReadLeads_();
      const lead = leads.filter(function (l) { return l.key === String(b.lead_key); })[0];
      if (lead) { lead.status = 'used'; odWriteLeads_(leads); }
    }
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
