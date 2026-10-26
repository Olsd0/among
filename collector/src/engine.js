// AMONG 할인 판단 엔진
// ------------------------------------------------------------
// - AI(Claude)는 페이지에서 "읽기"만 한다. 숫자 계산·검증·게시 여부 결정은 전부 이 파일에서.
// - 이 파일은 Node와 브라우저에서 모두 동작해야 한다 (node 전용 import 금지).
//   web/engine.js 는 이 파일의 사본이다: `npm run sync-web` 으로 갱신, 테스트가 불일치를 잡는다.
// - 모든 날짜는 KST(Asia/Seoul) 기준 'YYYY-MM-DD' 문자열. 종료일은 그날 23:59까지 유효(포함).

export const CHANNELS = ['매장', '픽업', '배달', '드라이브스루'];
export const AUDIENCES = ['전체', '신규회원', '멤버십', '개인'];
export const ITEM_TYPES = ['단품', '세트', '기타'];
export const DISCOUNT_TYPES = ['price', 'amount', 'percent', 'free_item'];

export const RULES = {
  minPrice: 500,
  maxPrice: 100000,
  maxRate: 90,
  minConfidence: 0.8,
  evidencePenalty: 0.3,      // 근거 문구가 페이지 텍스트에 없을 때 신뢰도 감점
  pricePenalty: 0.3,         // 가격 숫자가 근거/페이지 어디에도 없을 때 감점
  percentRoundTo: 10,        // 정률 할인액은 10원 단위 내림 (할인을 부풀리지 않는 쪽)
};

const DAY = 24 * 60 * 60 * 1000;
const KST_OFFSET = 9 * 60 * 60 * 1000;

// ---------- 기본 변환 ----------

export function todayKST(now = new Date()) {
  return new Date(now.getTime() + KST_OFFSET).toISOString().slice(0, 10);
}

/** "5,500원", "₩5500", 5500 → 5500. 숫자가 없으면 null. */
export function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  const s = String(v).replace(/[,\s원₩]/g, '');
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const man = /만/.test(s) && !/\d{4,}/.test(s) ? 10000 : 1; // "1만" → 10000
  return Math.round(parseFloat(m[0]) * man);
}

export function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

export function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (v === null || v === undefined) return false;
  return /^(true|1|y|yes|o|예|앱\s*전용)$/i.test(String(v).trim());
}

function clean(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

function pad(n) { return String(n).padStart(2, '0'); }

/**
 * 날짜 문자열을 'YYYY-MM-DD'로. 연도가 없으면 기준일(now) 연도를 쓰되,
 * 결과가 기준일보다 180일 넘게 과거면 다음 해로 본다 (12월에 "1/5"는 내년 1월 5일).
 */
export function parseDate(v, now = new Date()) {
  if (!v) return null;
  const s = String(v).trim();
  let y, m, d;
  let mm = s.match(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (mm) { [y, m, d] = [+mm[1], +mm[2], +mm[3]]; }
  else if ((mm = s.match(/(\d{2})\s*[.]\s*(\d{1,2})\s*[.]\s*(\d{1,2})/))) { [y, m, d] = [2000 + +mm[1], +mm[2], +mm[3]]; }
  else if ((mm = s.match(/(\d{1,2})\s*[./월]\s*(\d{1,2})/))) { [m, d] = [+mm[1], +mm[2]]; }
  else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const base = todayKST(now);
  if (!y) {
    y = +base.slice(0, 4);
    const cand = `${y}-${pad(m)}-${pad(d)}`;
    if (diffDays(cand, base) < -180) y += 1;
  }
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  // 존재하지 않는 날짜(2/30 등) 거르기
  const t = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/** a - b (일). 둘 다 'YYYY-MM-DD'. */
export function diffDays(a, b) {
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY);
}

/** 종료일까지 남은 일수. 0 = 오늘 종료, 음수 = 종료됨, null = 미상 */
export function daysLeft(endDate, today = todayKST()) {
  if (!endDate) return null;
  return diffDays(endDate, today);
}

// ---------- 표기 정규화 ----------

const CHANNEL_SYNONYMS = [
  [/드라이브\s*스루|드라이브\s*thru|\bDT\b|드스/i, '드라이브스루'],
  [/배달|딜리버리|delivery|맥딜/i, '배달'],
  [/픽업|포장|테이크\s*아웃|take\s*out|스마트\s*오더|오더\s*픽업|킹오더|사이렌/i, '픽업'],
  [/매장|홀|dine|오프라인|카운터|키오스크/i, '매장'],
];

export function normChannels(v) {
  const parts = Array.isArray(v) ? v : String(v || '').split(/[,/·|+]|및|\s&\s/);
  const out = new Set();
  for (const p of parts) {
    const s = String(p).trim();
    if (!s) continue;
    if (/전\s*채널|모든\s*채널|전체/.test(s)) CHANNELS.forEach((c) => out.add(c));
    for (const [re, ch] of CHANNEL_SYNONYMS) if (re.test(s)) out.add(ch);
  }
  return CHANNELS.filter((c) => out.has(c)); // 고정 순서
}

export function normAudience(v) {
  const s = clean(v);
  if (!s) return '전체';
  if (/개인|생일|지정|발급\s*대상|받은\s*분|선물/.test(s)) return '개인';
  if (/신규|첫\s*(주문|구매|가입)|웰컴|welcome|가입\s*축하/i.test(s)) return '신규회원';
  if (/멤버십|등급|vip|vvip|클럽|club|골드|실버|플래티넘/i.test(s)) return '멤버십';
  return '전체'; // "앱 회원 누구나", "전체 고객" 등
}

export function normItemType(v, menu = '') {
  const s = clean(v) + ' ' + clean(menu);
  if (/세트|콤보|combo|팩|pack|meal/i.test(clean(v))) return '세트';
  if (/단품|single/i.test(clean(v))) return '단품';
  if (/세트|콤보|combo|팩|meal/i.test(s)) return '세트';
  if (/버거|와퍼|싸이|커피|라떼|아메리카노/.test(s)) return '단품';
  return ITEM_TYPES.includes(clean(v)) ? clean(v) : '기타';
}

export function normDiscountType(v, raw = {}) {
  const s = clean(v).toLowerCase();
  if (DISCOUNT_TYPES.includes(s)) return s;
  if (/%|퍼센트|percent|정률/.test(s)) return 'percent';
  if (/원\s*할인|정액|amount/.test(s)) return 'amount';
  if (/증정|무료|1\s*\+\s*1|free|덤/.test(s)) return 'free_item';
  if (toInt(raw.coupon_price) !== null) return 'price';
  return 'price';
}

// ---------- 계산 ----------

/**
 * 적용가(쿠폰가)와 할인율 계산.
 * - price:   discount_value(또는 coupon_price)가 곧 쿠폰가
 * - amount:  정상가 - 할인액
 * - percent: 정상가 × 할인율 (10원 단위 내림), max_discount 상한 적용
 * - free_item: 결제액은 정상가 그대로, 증정품 가치(discount_value)로 체감 할인율 계산
 * 계산 불가면 coupon_price = null.
 */
export function computeCouponPrice({ regular_price, coupon_price, discount_type, discount_value, max_discount }) {
  const reg = toInt(regular_price);
  const val = toNumber(discount_value);
  const cap = toInt(max_discount);
  let price = null;
  let rate = null;
  let saved = null;

  switch (discount_type) {
    case 'amount':
      if (reg !== null && val !== null) { saved = Math.round(val); price = reg - saved; }
      else if (toInt(coupon_price) !== null) price = toInt(coupon_price);
      // 주문 전체 정액 할인 (예: "신규가입 3,000원 할인") — 결제액은 주문에 따라 달라 쿠폰가 없이 할인액만
      else if (val !== null && val > 0) saved = Math.round(val);
      break;
    case 'percent':
      if (reg !== null && val !== null && val > 0 && val < 100) {
        const unit = RULES.percentRoundTo;
        saved = Math.floor((reg * val) / 100 / unit) * unit;
        if (cap !== null && cap > 0) saved = Math.min(saved, cap);
        price = reg - saved;
      } else if (toInt(coupon_price) !== null) price = toInt(coupon_price);
      // 주문 전체 정률 할인 (예: "앱 첫 주문 25% 할인") — 쿠폰가 없이 할인율만
      else if (val !== null && val > 0 && val < 100) return { coupon_price: null, discount_rate: Math.round(val), saved: null, scope: 'order' };
      break;
    case 'free_item':
      price = reg !== null ? reg : toInt(coupon_price);
      if (reg !== null && val !== null && val > 0) {
        saved = Math.round(val);
        rate = Math.round((saved / (reg + saved)) * 100);
      }
      return { coupon_price: price, discount_rate: rate, saved };
    case 'price':
    default:
      price = toInt(coupon_price) ?? (val !== null && val >= 100 ? Math.round(val) : null);
  }

  if (price !== null && reg !== null && reg > 0) {
    saved = reg - price;
    rate = Math.round((saved / reg) * 100);
  }
  return { coupon_price: price, discount_rate: rate, saved, scope: price === null && saved !== null ? 'order' : 'item' };
}

// ---------- 근거 대조 (AI 환각 방지) ----------

function squash(s) { return String(s || '').replace(/[\s,·•\-–—~()\[\]"'“”‘’]/g, '').toLowerCase(); }

function priceVariants(n) {
  if (n === null || n === undefined) return [];
  const v = [String(n), n.toLocaleString('en-US')];
  // 한글 단위 표기: 10000 → "1만", 4000 → "4천", 15000 → "1만5천", 1.5만
  if (n >= 10000 && n % 1000 === 0) {
    const man = Math.floor(n / 10000), cheon = (n % 10000) / 1000;
    v.push(cheon ? `${man}만${cheon}천` : `${man}만`);
    if (cheon) v.push(`${man}.${cheon}만`);
  } else if (n >= 1000 && n < 10000 && n % 1000 === 0) v.push(`${n / 1000}천`);
  return v.map(squash);
}

/**
 * Claude가 준 근거 문구(evidence)와 숫자가 실제 페이지 텍스트에 있는지 확인.
 * 이미지에서 읽은 항목(evidence_source = 'image')은 텍스트 대조를 하지 않는다.
 */
export function checkEvidence(raw, pageText) {
  const issues = [];
  let penalty = 0;
  if (!pageText || raw.evidence_source === 'image') return { issues, penalty };
  const text = squash(pageText);
  const ev = squash(raw.evidence);
  if (ev && ev.length >= 4 && !text.includes(ev)) {
    issues.push('근거 문구가 페이지에 없음');
    penalty += RULES.evidencePenalty;
  }
  const nums = [];
  const type = raw.discount_type;
  if ((type === 'price' || !type) && toInt(raw.coupon_price) !== null) nums.push(toInt(raw.coupon_price));
  if ((type === 'amount' || type === 'percent') && toNumber(raw.discount_value) !== null) nums.push(Math.round(toNumber(raw.discount_value)));
  for (const n of nums) {
    if (!priceVariants(n).some((p) => text.includes(p))) {
      issues.push(`숫자 ${n}이(가) 페이지에 없음`);
      penalty += RULES.pricePenalty;
      break;
    }
  }
  return { issues, penalty };
}

// ---------- 정규화 · 검증 · 상태 결정 ----------

/**
 * Claude 추출 결과 1건을 표준 쿠폰으로 바꾸고 게시 상태를 정한다.
 * @returns 쿠폰 객체 (status: published | pending | rejected, issues: string[])
 */
export function normalizeAndValidate(raw, ctx = {}) {
  const now = ctx.now || new Date();
  const today = todayKST(now);
  const issues = [];

  const discount_type = normDiscountType(raw.discount_type, raw);
  const c = {
    brand: clean(ctx.brand || raw.brand),
    category: clean(ctx.category || raw.category),
    menu: clean(raw.menu),
    item_type: normItemType(raw.item_type, raw.menu),
    regular_price: toInt(raw.regular_price),
    coupon_price: null,
    discount_rate: null,
    discount_type,
    discount_value: toNumber(raw.discount_value),
    max_discount: toInt(raw.max_discount),
    min_order: toInt(raw.min_order),
    channels: normChannels(raw.channels),
    audience: normAudience(raw.audience),
    app_only: toBool(raw.app_only),
    start_date: parseDate(raw.start_date, now),
    end_date: parseDate(raw.end_date, now),
    conditions: clean(raw.conditions),
    confidence: Math.max(0, Math.min(1, toNumber(raw.confidence) ?? 0.5)),
    issues,
    evidence: clean(raw.evidence).slice(0, 300),
    source_id: clean(ctx.sourceId || raw.source_id),
    source_url: clean(ctx.sourceUrl || raw.source_url),
    official_link: clean(ctx.officialLink || raw.official_link),
  };

  const calc = computeCouponPrice({ ...raw, discount_type });
  c.coupon_price = calc.coupon_price;
  c.discount_rate = calc.discount_rate;
  // 주문 전체 할인(쿠폰가 없음): 정액이면 할인액을 discount_value에 둔다 (화면 표시용)
  if (calc.coupon_price === null && calc.saved !== null && c.discount_value === null) c.discount_value = calc.saved;

  const ev = checkEvidence({ ...raw, discount_type }, ctx.pageText);
  issues.push(...ev.issues);
  c.confidence = Math.max(0, +(c.confidence - ev.penalty).toFixed(2));

  // ---- rejected: 확실히 잘못된 것 ----
  const reject = [];
  if (!c.menu) reject.push('메뉴명 없음');
  if (c.end_date && c.end_date < today) reject.push('이미 종료');
  if (c.start_date && c.end_date && c.start_date > c.end_date) reject.push('기간 역전');
  if (c.coupon_price !== null && (c.coupon_price < RULES.minPrice || c.coupon_price > RULES.maxPrice)) reject.push('쿠폰가 범위 벗어남');
  if (c.discount_type !== 'free_item' && c.coupon_price !== null && c.regular_price !== null && c.coupon_price >= c.regular_price) reject.push('쿠폰가 ≥ 정상가');

  // ---- pending: 사람이 보기 전엔 게시하지 않을 것 ----
  const hold = [];
  // 쿠폰가·할인율·할인액 중 하나라도 있으면 비교 가능 (주문 전체 할인 포함). 아무것도 없으면 보류
  if (c.coupon_price === null && c.discount_rate === null && !(c.discount_type === 'amount' && c.discount_value > 0) && c.discount_type !== 'free_item') hold.push('쿠폰가 계산 불가');
  if (c.discount_rate !== null && c.discount_rate > RULES.maxRate) hold.push('할인율 90% 초과');
  if (c.confidence < RULES.minConfidence) hold.push('신뢰도 낮음');
  // 종료일을 적지 않는 상시·시즌 프로모션이 많다(예: 맥도날드 공식 프로모션). 보류하면 아무것도 게시되지 않으므로
  // 게시하되 표시만 남긴다. 공식 페이지에서 사라지면 다음 수집에서 gone 처리돼 화면에서 빠진다.
  const notes = c.end_date ? [] : ['종료일 미정 (매일 재확인)'];

  issues.push(...reject, ...hold, ...notes);
  c.status = reject.length ? 'rejected' : hold.length ? 'pending' : 'published';
  return c;
}

/** 같은 id의 중복을 하나로. 신뢰도 높은 쪽을 기준으로 출처를 합친다. idFn은 수집기(ids.js)에서 주입. */
export function dedupe(list, idFn) {
  const byId = new Map();
  for (const c of list) {
    const id = c.id || idFn(c);
    const cur = byId.get(id);
    if (!cur) { byId.set(id, { ...c, id }); continue; }
    const [hi, lo] = (c.confidence > cur.confidence) ? [{ ...c, id }, cur] : [cur, c];
    const urls = new Set(String(hi.source_url).split(' ').concat(String(lo.source_url).split(' ')).filter(Boolean));
    hi.source_url = [...urls].join(' ');
    byId.set(id, hi);
  }
  return [...byId.values()];
}

export function menuKey(menu) {
  return clean(menu).toLowerCase().replace(/[\s()\[\]·,.\-_/+]/g, '');
}

// ---------- 사용 조건 판단 (화면 필터 · 적용 가능 여부) ----------

/**
 * 이 쿠폰을 주어진 상황에서 쓸 수 있는지.
 * ctx: { today, channel, orderAmount, member: '비회원'|'회원'|'신규회원'|'멤버십' }
 */
export function checkApplicable(c, ctx = {}) {
  const reasons = [];
  const today = ctx.today || todayKST();
  if (c.start_date && c.start_date > today) reasons.push(`${c.start_date.slice(5).replace('-', '/')} 시작`);
  if (c.end_date && c.end_date < today) reasons.push('종료됨');
  if (ctx.channel && c.channels?.length && !c.channels.includes(ctx.channel)) reasons.push(`${ctx.channel} 불가`);
  if (ctx.orderAmount != null && c.min_order && ctx.orderAmount < c.min_order) reasons.push(`${c.min_order.toLocaleString()}원 이상 주문`);
  if (ctx.member) {
    if (c.audience === '신규회원' && ctx.member !== '신규회원') reasons.push('신규회원 전용');
    if (c.audience === '멤버십' && ctx.member !== '멤버십') reasons.push('멤버십 전용');
    if (c.audience === '개인') reasons.push('개인 발급 쿠폰');
    if (c.app_only && ctx.member === '비회원') reasons.push('앱 회원 전용');
  }
  return { ok: reasons.length === 0, reasons };
}

/** 앱만 있으면 누구나 쓸 수 있는 쿠폰인가 (신규·멤버십·개인 전용 제외) */
export function isOpenToEveryone(c) {
  return c.audience === '전체';
}

/**
 * 화면 필터. f: { category, itemType, channel, everyoneOnly, q }
 */
export function matchesFilters(c, f = {}) {
  if (f.category && f.category !== '전체' && c.category !== f.category) return false;
  if (f.itemType && c.item_type !== f.itemType) return false;
  if (f.channel && !(c.channels || []).includes(f.channel)) return false;
  if (f.everyoneOnly && !isOpenToEveryone(c)) return false;
  if (f.q) {
    const q = String(f.q).toLowerCase().replace(/\s/g, '');
    const hay = `${c.brand}${c.menu}${c.conditions}`.toLowerCase().replace(/\s/g, '');
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** 정렬: price(쿠폰가 낮은 순) | rate(할인율 높은 순) | deadline(마감 임박 순). 시작 전 쿠폰은 뒤로. */
export function sortCoupons(list, key = 'price', today = todayKST()) {
  const notStarted = (c) => (c.start_date && c.start_date > today ? 1 : 0);
  const num = (v, dflt) => (v === null || v === undefined || v === '' ? dflt : +v);
  const cmp = {
    price: (a, b) => num(a.coupon_price, 1e9) - num(b.coupon_price, 1e9),
    rate: (a, b) => num(b.discount_rate, -1) - num(a.discount_rate, -1),
    deadline: (a, b) => num(daysLeft(a.end_date, today), 1e6) - num(daysLeft(b.end_date, today), 1e6),
  }[key] || (() => 0);
  return [...list].sort((a, b) => notStarted(a) - notStarted(b) || cmp(a, b) || num(a.coupon_price, 1e9) - num(b.coupon_price, 1e9));
}

// ---------- 실행 요약 ----------

export function summarize(coupons) {
  const s = { total: coupons.length, published: 0, pending: 0, rejected: 0, issues: {} };
  for (const c of coupons) {
    s[c.status] = (s[c.status] || 0) + 1;
    for (const i of c.issues || []) s.issues[i] = (s.issues[i] || 0) + 1;
  }
  const decided = s.published + s.pending;
  s.auto_publish_rate = decided ? +(s.published / decided).toFixed(3) : null;
  return s;
}
