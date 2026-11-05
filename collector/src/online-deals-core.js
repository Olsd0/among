// 온라인 특가 공통 규칙 — 수집기(Node)·Apps Script(Code.gs 생성 구역)·화면(web/)이 같은 판단을 쓴다.
// 프랜차이즈 쿠폰 데이터와 섞지 않는다.
// 공급처 응답의 필드 이름은 여기서 추측하지 않는다. 공급처별 어댑터가 공식 문서로 확인한 필드만
// 아래 '표준 후보' 형식으로 옮기고, 이 파일은 표준 후보만 다룬다.
// import 없이 순수 함수만 둔다 (Apps Script에 그대로 붙여 넣기 위해 — collector/scripts/sync-web.js).

export const OD_HOUR = 3600000;
export const OD_DAY = 24 * OD_HOUR;
export const OD_MAX_INGEST = 200;      // 공급처 응답 1회에서 받는 최대 후보 수
export const OD_MAX_RECORDS = 2000;    // 시트에 보관하는 최대 상품 수 (운영자 숨김은 별도로 항상 보관)
export const OD_RETENTION_DAYS = 7;    // 다시 받지 못한 상품 기록 보관 기간 (가격 이력은 저장하지 않음)
export const OD_HARD_MAX_AGE_HOURS = 24;

export const OD_CATEGORIES = { food: '식품', household: '생활용품' };
export const OD_MODES = { off: '끄기', observe: '관찰 (비공개)', publish: '자동 게시' };
export const OD_STATUSES = { published: '게시 중', held: '보류', scheduled: '시작 전', stale: '재확인 기한 지남', ended: '종료', hidden: '운영자 숨김' };
export const OD_SHIPPING = ['free', 'paid', 'conditional', 'unknown'];
export const OD_PRICE_BASIS = ['item_total', 'unit', 'discount', 'points', 'min_order', 'unknown'];
export const OD_RESULTS = {
  ok: '정상', empty: '빈 응답 (기존 상품 유지)', failed: '실패 (기존 상품 유지)', rate_limited: '호출 제한 (일시 중지)',
  paused: '일시 중지 중', off: '꺼짐', awaiting_access: '승인 대기 (연결 안 됨)', missing_secrets: '키 미등록', too_soon: '최소 간격 전',
};
export const OD_HOLD_LABELS = {
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
export const OD_SUPPLIERS = {
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

export const OD_DEFAULT_RULES = {
  includeCategories: ['food', 'household'],
  // 공급처 분류 경로의 한 단계와 정확히 같을 때만 연결한다 (부분 일치로 가전 '냉동고'가 식품이 되는 일을 막음).
  categoryKeywords: { food: ['식품'], household: ['생활용품'] },
  excludeKeywords: ['주류', '담배', '전자담배', '의약품', '성인용품'],
  excludeSellers: [],
  maxItems: 30,
  maxAgeHours: 6,
};

const OD_CONTROL = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;
export function odText(v, max) {
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
export function odHash(str) {
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
export function odLink(value, supplier, registry) {
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
export function odIsAffiliateLink(url) {
  return /^https:\/\/link\.coupang\.com\//i.test(url || '') || /[?&]lptag=/i.test(url || '');
}
export function odImage(value, supplier, registry) { const s = (registry || OD_SUPPLIERS)[supplier]; return s ? odUrlFor_(value, s.imageHosts) : ''; }

/**
 * 표준 후보 → 저장 형식. 식별할 수 없으면 null. 판단(게시·보류)은 하지 않고 값만 정리한다.
 * 같은 결과를 다시 넣어도 같은 결과가 나온다 (Apps Script가 수집기 결과를 다시 검사할 수 있게).
 */
export function odNormalize(raw, supplier, registry) {
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
export function odRules(input) {
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
    includeCategories: words(r.includeCategories, 2, 20, d.includeCategories).filter(c => OD_CATEGORIES[c]),
    categoryKeywords: { food: words(ck.food, 50, 30, d.categoryKeywords.food), household: words(ck.household, 50, 30, d.categoryKeywords.household) },
    excludeKeywords: words(r.excludeKeywords, 100, 30, d.excludeKeywords),
    excludeSellers: words(r.excludeSellers, 100, 60, d.excludeSellers),
    maxItems: int(r.maxItems, 1, 60, d.maxItems),
    maxAgeHours: int(r.maxAgeHours, 1, OD_HARD_MAX_AGE_HOURS, d.maxAgeHours),
  };
}

/** 공급처 운영 상태 정리. 새 공급처는 '관찰(비공개)'로 시작한다. */
export function odSupplierStates(input, registry) {
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
export function odAfterFailure(state, failure, now) {
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
export function odCategory(rec, rules, now) {
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
export function odHolds(item, category, rules, registry) {
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
export function odVisibleUntil(rec, rules) {
  const recheck = odMs_(rec.lastReceivedAt) + rules.maxAgeHours * OD_HOUR;
  const end = odMs_(rec.item.endsAt);
  return Number.isFinite(end) ? Math.min(end, recheck) : recheck;
}

function odFingerprint_(item) {
  const n = s => String(s || '').toLowerCase().replace(/[\s()[\]{}·,./+_-]+/g, '');
  return [n(item.title), n(item.option), n(item.store)].join('|');
}
export function odCompare(a, b) {
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
export function odEvaluate(records, ctx) {
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
export function odMerge(records, run, now, registry) {
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
export function odPrune(records, now) {
  const from = now - OD_RETENTION_DAYS * OD_DAY;
  const hidden = records.filter(r => r.hidden);
  const rest = records.filter(r => !r.hidden && odMs_(r.lastReceivedAt) >= from)
    .sort((a, b) => odMs_(b.lastReceivedAt) - odMs_(a.lastReceivedAt))
    .slice(0, Math.max(0, OD_MAX_RECORDS - hidden.length));
  return hidden.concat(rest);
}

/** 공개 응답에 싣는 필드 (보류 사유·운영 메모·공급처 내부 id는 싣지 않는다) */
export function odPublic(r, registry) {
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
export function odClientItem(raw, now, registry) {
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
export function odShippingText(it) {
  if (it.shipping === 'free') return '무료배송';
  if (it.shipping === 'paid') return it.shippingFee ? `배송비 ${it.shippingFee}원` : '배송비 별도';
  if (it.shipping === 'conditional') return it.shippingThreshold ? `${it.shippingThreshold}원 이상 구매 시 무료배송` : '조건부 무료배송 (조건 확인 필요)';
  return '배송비 확인 필요';
}

// ---------- 직접 고른 쿠팡 특가 (11/05 대표 결정: 최종 승인 전에는 대표가 고른 상품의 간편 링크를 카드로 올리고, 승인 후 API로 자동) ----------
// 상품 선별 정보는 운영자가 어디서 얻든(게시판 등) 공개 화면에는 상품명·쿠팡 링크·항목·한 줄 설명·확인한 가격만 싣는다.
// 가격을 넣은 카드는 운영자가 확인한 시각과 함께 24시간만 보이고 그 뒤 자동으로 내려간다 (11/05 14:56 대표 결정, '다시 확인'하면 다시 24시간).
// 가격 없이 올린 카드는 '쿠팡에서 가격 확인'으로 노출 종료일까지 보인다.
export const OD_PICK_CATEGORIES = { food: '먹거리', household: '생활용품', etc: '기타' };
export const OD_PICK_PRICE_HOURS = 24;
export const OD_PICK_DEFAULT_DAYS = 1;
export const OD_PICK_MAX_DAYS = 30;
export const OD_PICK_MAX = 60;
const OD_PICK_LINK = /^https:\/\/link\.coupang\.com\/[A-Za-z0-9/_-]+$/;

/** 관리 화면 입력 → 저장 형식. 잘못된 값은 고치지 않고 오류로 돌려준다 */
export function odPickInput(raw, now, prev) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const p = prev || {};
  const errors = [];
  const title = odText(r.title, 81);
  if (title.length < 2 || title.length > 80) errors.push('상품명은 2~80자로 입력하세요.');
  const url = odLink(odText(r.url, 301), 'coupang');
  if (!url || !OD_PICK_LINK.test(url)) errors.push('쿠팡 파트너스 간편 링크(https://link.coupang.com/a/…)를 넣으세요.');
  const category = OD_PICK_CATEGORIES[r.category] ? r.category : '';
  if (!category) errors.push('항목을 고르세요.');
  const note = odText(r.note, 61);
  if (note.length > 60) errors.push('한 줄 설명은 60자 이내로 입력하세요.');
  const memo = odText(r.memo, 200);
  let price = null;
  if (r.price !== '' && r.price !== null && r.price !== undefined) {
    const t = String(r.price).trim();
    const n = typeof r.price === 'number' ? r.price : /^\d+$/.test(t) ? Number(t) : NaN;
    if (!Number.isSafeInteger(n) || n < 100 || n > 10000000) errors.push('가격은 100원~1000만원 사이 숫자로 입력하세요.');
    else price = n;
  }
  const ends = r.endsAt ? odMs_(odIso_(r.endsAt)) : (p.endsAt ? odMs_(p.endsAt) : now + OD_PICK_DEFAULT_DAYS * OD_DAY);
  if (!Number.isFinite(ends) || ends <= now || ends > now + OD_PICK_MAX_DAYS * OD_DAY) errors.push('노출 종료는 지금부터 30일 안으로 정하세요.');
  if (errors.length) return { errors, pick: null };
  const at = new Date(now).toISOString();
  // 가격을 새로 넣거나 바꾸거나 '다시 확인'을 누르면 지금 확인한 것으로 본다. 같은 가격으로 다른 칸만 고치면 처음 확인 시각을 유지한다.
  const priceCheckedAt = price === null ? '' : (r.recheck === true || price !== p.price || !p.priceCheckedAt ? at : p.priceCheckedAt);
  return { errors, pick: { id: p.id || '', title, url, category, note, memo, price, priceCheckedAt, endsAt: new Date(ends).toISOString(),
    hidden: p.hidden === true, createdAt: p.createdAt || at, updatedAt: at } };
}

/** 공개 응답용 (관리 메모·숨김·작성 시각 없음). 숨김·노출 종료·가격 확인 24시간 지남이면 null */
export function odPickPublic(p, now) {
  if (!p || p.hidden || !(odMs_(p.endsAt) > now)) return null;
  const priced = !!odPosInt_(p.price);
  const until = odMs_(p.priceCheckedAt) + OD_PICK_PRICE_HOURS * OD_HOUR;
  if (priced && !(until > now)) return null;
  const visible = priced ? Math.min(odMs_(p.endsAt), until) : odMs_(p.endsAt);
  return { id: p.id, title: p.title, url: p.url, category: p.category, note: p.note || '',
    price: priced ? p.price : null, priceCheckedAt: priced ? p.priceCheckedAt : '', priceUntil: priced ? new Date(until).toISOString() : '',
    visibleUntil: new Date(visible).toISOString() };
}

/** 화면에서 다시 검사. 통과하지 못하면 null, 가격 기한이 지났거나 맞지 않으면 가격만 뺀다 */
export function odClientPick(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && /^pk_[0-9a-z]{8,24}$/.test(raw.id) ? raw.id : '';
  const title = odText(raw.title, 81), note = odText(raw.note, 61);
  const url = odLink(raw.url, 'coupang');
  const until = odMs_(odIso_(raw.visibleUntil));
  if (!id || title.length < 2 || title.length > 80 || note.length > 60 || !url || !OD_PICK_LINK.test(url) || !OD_PICK_CATEGORIES[raw.category]) return null;
  if (!Number.isFinite(until) || until <= now || until > now + (OD_PICK_MAX_DAYS + 1) * OD_DAY) return null;
  let price = null, checked = NaN, priceUntil = 0;
  if (raw.price !== null && raw.price !== undefined && raw.price !== '') {
    // 가격이 있는 카드는 확인 시각부터 24시간 안이어야 보인다 (기한이 맞지 않으면 카드째 뺀다)
    checked = odMs_(odIso_(raw.priceCheckedAt)); priceUntil = odMs_(odIso_(raw.priceUntil));
    const fresh = odPosInt_(raw.price) && Number.isFinite(checked) && checked <= now + 5 * 60000 && Number.isFinite(priceUntil)
      && priceUntil > now && priceUntil <= checked + OD_PICK_PRICE_HOURS * OD_HOUR;
    if (!fresh) return null;
    price = raw.price;
  }
  return { id, title, url, category: raw.category, note, affiliate: true,
    price, priceCheckedAt: price ? new Date(checked).toISOString() : '', priceUntil: price ? priceUntil : 0, visibleUntil: price ? Math.min(until, priceUntil) : until };
}
