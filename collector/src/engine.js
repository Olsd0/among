// AMONG 할인 판단 엔진
// ------------------------------------------------------------
// - AI(Claude)는 페이지에서 "읽기"만 한다. 숫자 계산·검증·게시 여부 결정은 전부 이 파일에서.
// - 이 파일은 Node와 브라우저에서 모두 동작해야 한다 (node 전용 import 금지).
//   web/engine.js 는 이 파일의 사본이다: `npm run sync-web` 으로 갱신, 테스트가 불일치를 잡는다.
// - 모든 날짜는 KST(Asia/Seoul) 기준 'YYYY-MM-DD' 문자열. 종료일은 그날 23:59까지 유효(포함).

export const CHANNELS = ['매장', '픽업', '배달', '드라이브스루'];
export const AUDIENCES = ['전체', '신규회원', '멤버십', '개인'];
export const ITEM_TYPES = ['단품', '세트', '기타'];
// point_back = 결제 후 포인트 적립 (네이버페이 500원 적립 등). 결제액을 줄이지 않으므로 쿠폰가 계산에 쓰지 않는다
export const DISCOUNT_TYPES = ['price', 'amount', 'percent', 'free_item', 'point_back'];
export const CATEGORIES = ['햄버거', '카페', '치킨', '피자', '디저트'];

// ---------- 브랜드 목록 (여러 브랜드가 한 페이지에 나오는 멤버십·결제 출처에서 브랜드 이름을 맞추는 데 사용) ----------
// [표준 이름, 카테고리, 같은 브랜드로 볼 표기]
export const BRANDS = [
  ['맥도날드', '햄버거', /맥도날드|mcdonald/i],
  ['버거킹', '햄버거', /버거킹|burger\s*king|비케이알/i],
  ['롯데리아', '햄버거', /롯데리아|lotteria/i],
  ['맘스터치', '햄버거', /맘스터치|mom'?s\s*touch/i],
  ['KFC', '햄버거', /kfc|케이에프씨/i],
  ['파파이스', '햄버거', /파파이스|popeyes/i],
  ['노브랜드버거', '햄버거', /노브랜드\s*버거/],
  ['프랭크버거', '햄버거', /프랭크\s*버거/],
  ['쉐이크쉑', '햄버거', /쉐이크\s*쉑|shake\s*shack/i],
  ['스타벅스', '카페', /스타벅스|starbucks/i],
  ['이디야', '카페', /이디야|ediya/i],
  ['메가MGC커피', '카페', /메가\s*(mgc)?\s*커피|mega\s*(mgc)?\s*coffee/i],
  ['빽다방', '카페', /빽다방/],
  ['할리스', '카페', /할리스|hollys/i],
  ['폴바셋', '카페', /폴\s*바셋|paul\s*bassett/i],
  ['투썸플레이스', '카페', /투썸/],
  ['컴포즈커피', '카페', /컴포즈/],
  ['공차', '카페', /공차|gong\s*cha/i],
  ['파스쿠찌', '카페', /파스쿠찌|pascucci/i],
  ['커피빈', '카페', /커피빈|coffee\s*bean/i],
  ['BBQ', '치킨', /bbq|비비큐/i],
  ['bhc', '치킨', /bhc|비에이치씨/i],
  ['교촌치킨', '치킨', /교촌/],
  ['굽네치킨', '치킨', /굽네/],
  ['푸라닭', '치킨', /푸라닭/],
  ['처갓집양념치킨', '치킨', /처갓집/],
  ['네네치킨', '치킨', /네네\s*치킨/],
  ['도미노피자', '피자', /도미노|domino/i],
  ['피자헛', '피자', /피자헛|pizza\s*hut/i],
  ['파파존스', '피자', /파파존스|papa\s*john/i],
  ['미스터피자', '피자', /미스터\s*피자|mr\.?\s*pizza/i],
  ['반올림피자', '피자', /반올림/],
  ['파리바게뜨', '디저트', /파리바게(뜨|트)|paris\s*baguette/i],
  ['뚜레쥬르', '디저트', /뚜레쥬르|tous\s*les\s*jours/i],
  ['배스킨라빈스', '디저트', /배스킨|베스킨|baskin/i],
  ['던킨', '디저트', /던킨|dunkin/i],
  ['설빙', '디저트', /설빙/],
];

/** 표기가 달라도 같은 브랜드면 표준 이름과 카테고리를. 모르는 브랜드면 null */
export function canonicalBrand(name) {
  const s = String(name || '').trim();
  if (!s) return null;
  for (const [brand, category, re] of BRANDS) if (brand === s || re.test(s)) return { brand, category };
  return null;
}

// ---------- 혜택 프로그램 (통신사 멤버십 · 간편결제 · 포인트) ----------
// 쿠폰을 쓰려면 이 중 하나가 필요하다는 뜻. 여러 개면 "그중 하나만 있으면 됨"
export const PROGRAMS = ['SKT', 'KT', 'LGU+', '네이버페이', '카카오페이', '토스페이', '해피포인트', 'CJ ONE', '카드'];
export const PROGRAM_LABEL = {
  SKT: 'SKT T멤버십', KT: 'KT 멤버십', 'LGU+': 'U+ 멤버십', 네이버페이: '네이버페이', 카카오페이: '카카오페이',
  토스페이: '토스페이', 해피포인트: '해피포인트', 'CJ ONE': 'CJ ONE', 카드: '특정 카드 결제',
};
const PROGRAM_PATTERNS = [
  // 'KT 멤버십' 안의 'T 멤버십'을 SKT로 읽지 않도록 T 앞에 영문자가 없어야 함 (구형 사파리 호환 위해 lookbehind 미사용)
  ['SKT', /\bSKT\b|SK\s*텔레콤|(^|[^A-Za-z])T\s*(멤버십|membership|우주|day\b)|티\s*멤버십/i],
  ['KT', /\bKT\b|(^|[^A-Za-z])kt\s*(멤버십|membership)|케이티\s*멤버십|달\.?\s*달\.?\s*혜택/i],
  ['LGU+', /LG\s*U\s*\+|LGU\s*\+|\bU\s*\+\s*(멤버십|membership)|유플러스|유플투쁠/i],
  ['네이버페이', /네이버\s*페이|\bN\s*pay\b|\bnpay\b/i],
  ['카카오페이', /카카오\s*페이|kakao\s*pay/i],
  ['토스페이', /토스\s*페이|toss\s*pay/i],
  ['해피포인트', /해피\s*포인트|happy\s*point|해피\s*오더/i],
  ['CJ ONE', /cj\s*one|씨제이\s*원/i],
  // 특정 카드사 결제 할인 — 가진 사람이 적어 기본 목록에서 제외한다 (D20)
  ['카드', /(신한|국민|KB|삼성|현대|롯데|하나|우리|NH|농협|BC|비씨|씨티|IBK|카카오뱅크|토스뱅크|모빌리언스)[^\s,·]{0,8}\s*카드|청구\s*할인|카드\s*(로\s*)?결제\s*시\s*\d/i],
];

// "T멤버십 할인과 중복 불가", "네이버페이 결제 시 사용 불가"처럼 제외·불가 문맥에서 나온 이름은 '필요 조건'이 아니다
const EXCLUDE_CONTEXT = /중복|제외|불가|미적용|적용\s*(안|않)|사용\s*(안|못)|안\s*됨|대상\s*아님/;

/** 문장에서 필요한 프로그램 찾기 ("T멤버십, KT 멤버십 VIP 30%" → ['SKT','KT']). 제외 문맥 구절은 건너뜀 */
export function detectPrograms(text) {
  // 구절 = 쉼표·마침표·줄바꿈·' / ' 단위. 혜택 표시(N%·N원·전용·대상·회원)가 있으면 제외 단어가 있어도 필요 조건으로 본다
  const parts = String(text || '').split(/[,.;\n]|\s\/\s/)
    .filter((x) => !EXCLUDE_CONTEXT.test(x) || /\d+\s*(%|원)|전용|대상|회원|고객/.test(x));
  const s = parts.join(' | ');
  return PROGRAM_PATTERNS.filter(([, re]) => re.test(s)).map(([p]) => p);
}

/** AI가 준 프로그램 이름을 표준 이름으로 ("T멤버십" → 'SKT'), 모르는 이름은 버린다 */
export function normPrograms(list) {
  const out = new Set();
  for (const v of Array.isArray(list) ? list : String(list || '').split(/[,/·|]/)) {
    const s = String(v || '').trim();
    if (!s) continue;
    if (PROGRAMS.includes(s)) { out.add(s); continue; }
    detectPrograms(s).forEach((p) => out.add(p));
  }
  return PROGRAMS.filter((p) => out.has(p));
}

const PROGRAM_NAME_WORDS = /SKT|SK\s*텔레콤|T\s*멤버십|KT|LG\s*U\s*\+|U\s*\+|유플러스|네이버\s*페이|N\s*pay|카카오\s*페이|토스\s*페이|해피\s*포인트\s*(플러스)?|CJ\s*ONE/gi;
const DELIVERY_APPS = /쿠팡\s*이츠|배달의\s*민족|배민|요기요|땡겨요|위메프오|먹깨비/;
const DELIVERY_EXCLUDED = /(쿠팡\s*이츠|배달의\s*민족|배민|요기요|땡겨요|배달\s*앱)[^.·\n]{0,20}(제외|불가|미적용|적용\s*(안|않|불가)|사용\s*(안|불가))/;
/** 외부 배달앱 전용 행사인가 (경쟁 서비스가 이미 다루는 영역이라 제외, D7·HANDOFF 4장) */
export function isDeliveryAppOnly(text) {
  const s = String(text || '');
  return DELIVERY_APPS.test(s) && !DELIVERY_EXCLUDED.test(s);
}

/** "1천원당 150원 할인" → 15 (%). 등급별로 여러 번 나오면 가장 낮은 값 (D21: 과장하지 않기) */
export function perThousandRate(text) {
  const all = [...String(text || '').matchAll(/(?:1\s*천|1,?000|천)\s*원\s*당\s*(?:최대\s*)?(\d{1,3})\s*원/g)].map((m) => +m[1] / 10);
  return all.length ? Math.min(...all) : null;
}

const TIER_WORDS = /vvip|vip|gold|골드|silver|실버|lite|라이트|우수|일반|등급|diamond|다이아/i;
/**
 * 등급별 할인율이 적힌 문장에서 가장 낮은 % ("VIP 30% · GOLD/SILVER 20%" → 20). 등급 표기가 없으면 null
 * AI가 '가장 낮은 등급 값'을 지키지 않는 경우가 많아(10/27 시험: T멤버십 11건 중 5건이 VIP 값) 엔진이 강제한다 (D21)
 */
export function lowestTierPercent(text) {
  const s = String(text || '');
  if (!TIER_WORDS.test(s)) return null;
  const all = [...s.matchAll(/(\d{1,2}(?:\.\d)?)\s*%/g)].map((m) => +m[1]).filter((n) => n > 0 && n < 100);
  return all.length >= 2 ? Math.min(...all) : null;
}

/** 등급별 할인액 중 가장 낮은 값 ("VVIP 9천원 OFF, VIP 6천원 OFF" → 6000). 등급 표기가 없으면 null */
export function lowestTierAmount(text) {
  const s = String(text || '');
  if (!TIER_WORDS.test(s)) return null;
  const all = [...s.matchAll(/(\d+(?:,\d{3})*\s*원|\d+\s*천\s*원)\s*(?:OFF|off|할인)/g)].map((m) => toInt(m[1].replace(/천/, '000').replace(/\s/g, ''))).filter((n) => n > 0);
  return all.length >= 2 ? Math.min(...all) : null;
}

/** '최대 30%', '최대 5천원 할인'처럼 상한만 적힌 홍보 문구인가 (할인 크기가 조건에 따라 달라짐) */
export function isUpTo(text, value) {
  if (value === null || value === undefined) return false;
  const s = String(text || '').replace(/,/g, '');
  const v = String(value);
  const k = value >= 1000 && value % 1000 === 0 ? `${value / 1000}\\s*천` : null;
  return new RegExp(`최대\\s*(${v}\\s*%|${v}\\s*원${k ? `|${k}` : ''})`).test(s);
}

/** 등급별로 적힌 서로 다른 % 목록 (작은 순). 등급 표기가 없으면 [] */
export function tierPercents(text) {
  const s = String(text || '');
  if (!TIER_WORDS.test(s)) return [];
  return [...new Set([...s.matchAll(/(\d{1,2}(?:\.\d)?)\s*%/g)].map((m) => +m[1]).filter((n) => n > 0 && n < 100))].sort((a, b) => a - b);
}

// 우리가 다루지 않는 결제수단 (D20과 같은 이유: 가진 사람이 적고, 쓰면 누구나 받는 할인처럼 보임)
// 10/27 실제 수집: '페이코인 앱 결제 시 20% 추가 할인'이 조건 없는 전 메뉴 20%로 게시됨
const OTHER_PAY = /페이코인|페이코|payco|애플\s*페이|apple\s*pay|삼성\s*페이|samsung\s*pay|ssg\s*pay|쓱\s*페이|\bL\.?\s*pay\b|엘\s*페이|스마일\s*페이|제로\s*페이|하나\s*페이|kb\s*pay|페이북|paybooc|우리\s*won\s*페이/i;
/** 특정 결제수단(우리 목록 밖)으로 결제해야 받는 할인인가. 제외 문맥("삼성페이 사용 불가")은 조건으로 보지 않음 */
export function needsOtherPayment(text) {
  return String(text || '').split(/[,;\n!·]|\.(?!\d)|\s\/\s/)
    .some((x) => OTHER_PAY.test(x) && /결제|이용\s*시|사용\s*시|로\s*구매/.test(x) && !EXCLUDE_CONTEXT.test(x));
}

/**
 * 'N% 적립'처럼 적립 안내에만 나온 프로그램 — 할인을 받는 데 필요한 조건이 아니다.
 * 10/27 실제 수집: '블록팩 4개 12,000원'이 '해피포인트 0.1% 적립' 문구 때문에 해피포인트 전용으로 분류됨
 */
export function accrualOnlyPrograms(text) {
  const acc = new Set(), other = new Set();
  // 소수점('0.1%')은 나누지 않는다
  for (const x of String(text || '').split(/[,;\n·]|\.(?!\d)|\s\/\s/)) {
    if (EXCLUDE_CONTEXT.test(x)) continue;
    const accrual = /적립/.test(x) && !/결제\s*시|전용|대상|할인|OFF|회원\s*(가입|전용|한정)/i.test(x);
    for (const [p, re] of PROGRAM_PATTERNS) if (re.test(x)) (accrual ? acc : other).add(p);
  }
  return [...acc].filter((p) => !other.has(p));
}

/** 다른 할인과 같이 쓸 수 있는지: 'no' | 'yes' | '' (모름) */
export function detectStackable(text) {
  const s = String(text || '');
  if (/중복\s*(적용|사용|할인)?\s*(불가|안\s*됨|안\s*됩니다|되지\s*않|제한)|타\s*(할인|쿠폰|프로모션|제휴)[^.·\n]{0,12}(불가|제외|안\s*됨)/.test(s)) return 'no';
  if (/중복\s*(적용|사용|할인)?\s*가능/.test(s)) return 'yes';
  return '';
}

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

/**
 * 근거 문구에 적힌 기간 읽기 — AI가 날짜 칸을 비워 둔 경우의 보완.
 * "(8/19~8/21)", "10.20~10.31", "2026.10.20 ~ 2026.10.31", "(~12/31)". 구분자는 물결표만 (전화번호·범위와 혼동 방지)
 * 연도가 없으면: 시작일이 오늘 기준 300일 전 ~ 60일 뒤 안에 들도록, 끝만 있으면 parseDate 규칙(180일 넘게 지났으면 내년)
 * 10/27 실제 수집에서 '빽다방 20주년 아메리카노 1천원 (8/19~8/21)'이 종료일 없이 게시된 문제로 추가
 * @returns {{start: string|null, end: string|null}|null}
 */
const PERIOD_DATE = '(?:(20\\d{2}|\\d{2})\\s*[./년-]\\s*)?(\\d{1,2})\\s*[./월]\\s*(\\d{1,2})\\s*일?\\.?(?:\\s*\\([월화수목금토일]\\))?';
const PERIOD_RANGE = new RegExp(`(?:^|[^\\d.,/])${PERIOD_DATE}\\s*[~∼〜]\\s*(?:${PERIOD_DATE}|(\\d{1,2})\\s*일?(?![\\d.,/]))`);
const PERIOD_END = new RegExp(`(?:^|[^\\d.,/\\s]|\\s)[~∼〜]\\s*${PERIOD_DATE}`);
export function inferPeriod(text, now = new Date()) {
  const s = String(text || '').replace(/\s+/g, ' ');
  const today = todayKST(now);
  const iso = (y, m, d) => {
    const v = `${y}-${pad(m)}-${pad(d)}`;
    const t = new Date(v + 'T00:00:00Z');
    return m >= 1 && m <= 12 && !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === v ? v : null;
  };
  const fullYear = (y) => (y ? (+y < 100 ? 2000 + +y : +y) : null);
  let m = s.match(PERIOD_RANGE);
  if (m) {
    const [, y1, m1, d1, y2, m2, d2, dOnly] = m;
    let sy = fullYear(y1) || +today.slice(0, 4);
    let start = iso(sy, +m1, +d1);
    if (!start) return null;
    if (!y1) {
      if (diffDays(start, today) > 60) start = iso(--sy, +m1, +d1);
      else if (diffDays(start, today) < -300) start = iso(++sy, +m1, +d1);
    }
    const em = m2 ? +m2 : +m1;
    const ed = m2 ? +d2 : +dOnly;
    let ey = fullYear(y2) || sy;
    let end = iso(ey, em, ed);
    if (end && m2 && !y2 && end < start) end = iso(++ey, em, ed); // 12/20~1/10 → 해를 넘김 ('1.5~2'처럼 일만 있으면 넘기지 않음)
    return end && end >= start ? { start, end } : null;
  }
  m = s.match(PERIOD_END);
  if (m) {
    const [, y, mo, d] = m;
    const end = y ? iso(fullYear(y), +mo, +d) : parseDate(`${mo}/${d}`, now);
    return end ? { start: null, end } : null;
  }
  return null;
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
  if (/적립|캐시백|cashback|point/.test(s)) return 'point_back';
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
export function computeCouponPrice({ regular_price, coupon_price, discount_type, discount_value, max_discount, discount_unit }) {
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
    case 'point_back':
      // 적립: 결제액은 그대로. %면 할인율 자리에 적립률을, 원이면 적립액만 (discount_unit은 normalize에서 판단)
      if (val !== null && val > 0) {
        return discount_unit === 'percent'
          ? { coupon_price: null, discount_rate: Math.round(val * 10) / 10, saved: null, scope: 'order' }
          : { coupon_price: null, discount_rate: null, saved: Math.round(val), scope: 'order' };
      }
      return { coupon_price: null, discount_rate: null, saved: null, scope: 'order' };
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

const PROMO_WORDS = /할인|특가|적립|캐시백|쿠폰|이벤트|프로모션|행사|세일|반값|단돈|딜|해피|스낵|1\s*\+\s*1|증정|무료|%|원에|인하|혜택|한정|기념|오픈|첫\s*주문|신규|멤버십|데이|타임/;
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
  const evMissing = ev && ev.length >= 4 && !text.includes(ev);
  const nums = [];
  const type = raw.discount_type;
  if ((type === 'price' || !type) && toInt(raw.coupon_price) !== null) nums.push(toInt(raw.coupon_price));
  if ((type === 'amount' || type === 'percent' || type === 'point_back') && toNumber(raw.discount_value) !== null) nums.push(Math.round(toNumber(raw.discount_value)));
  let numsOk = true;
  for (const n of nums) {
    // "1천원당 150원" → 15%: 페이지에는 15가 아니라 150원으로 적혀 있다
    const perK = type === 'percent' && [raw.evidence, raw.conditions, raw.program_note].some((t) => perThousandRate(t) === n && text.includes(squash(String(t).match(/(?:1\s*천|1,?000|천)\s*원\s*당\s*(?:최대\s*)?\d{1,3}\s*원/)[0])));
    if (!perK && !priceVariants(n).some((p) => text.includes(p))) {
      issues.push(`숫자 ${n}이(가) 페이지에 없음`);
      penalty += RULES.pricePenalty;
      numsOk = false;
      break;
    }
  }
  // 근거 문장을 그대로 옮기지 않고 요약한 경우: 숫자가 페이지에 있으면 감점을 작게 (AI마다 인용 습관이 다름)
  if (evMissing) {
    issues.push(numsOk && nums.length ? '근거 문구 요약됨 (숫자는 확인)' : '근거 문구가 페이지에 없음');
    penalty += numsOk && nums.length ? RULES.evidencePenalty / 3 : RULES.evidencePenalty;
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

  // 브랜드: 브랜드 자체 출처면 출처의 브랜드, 멤버십·결제처럼 여러 브랜드가 섞인 출처면 AI가 읽은 이름을 표준 이름으로
  const fixed = clean(ctx.brand);
  const known = fixed ? canonicalBrand(fixed) : canonicalBrand(raw.brand);
  const brand = fixed || known?.brand || clean(raw.brand);
  // 여러 브랜드 출처(예: 네이버페이 카페 캠페인)에서는 출처 카테고리보다 브랜드 본래 카테고리가 맞다
  const category = fixed ? (clean(ctx.category) || known?.category || clean(raw.category)) : (known?.category || clean(ctx.category) || clean(raw.category));

  const allText = [raw.menu, raw.conditions, raw.evidence, raw.program_note, raw.how_to_use].map(clean).join(' ');
  let discount_type = normDiscountType(raw.discount_type, raw);
  let discount_value = toNumber(raw.discount_value);
  // "1천원당 100원 할인"은 10% 할인. AI가 정액 100원으로 읽었거나 값을 비워 둔 경우 엔진이 환산한다
  const perK = perThousandRate(allText);
  if (perK !== null && ((discount_type === 'percent' && discount_value === null) || (discount_type === 'amount' && discount_value !== null && discount_value <= 300 && toInt(raw.regular_price) === null))) {
    discount_type = 'percent';
    discount_value = perK;
  }
  let programs = normPrograms([...normPrograms(raw.programs), ...(ctx.programs || []), ...detectPrograms(allText)]);
  // 등급별 할인: 가장 낮은 등급 값으로 (과장 방지)
  const tierText = [raw.program_note, raw.evidence, raw.conditions].map(clean).join(' ');
  // 통신사 등급별 '가격'(VIP 50% 할인 2,150원 · GOLD/SILVER 30%)은 VIP 가격이라 → 가장 낮은 등급 %로 바꾼다
  const tiers = tierPercents(tierText);
  const priceTier = discount_type === 'price' && tiers.length >= 2 && programs.some((p) => ['SKT', 'KT', 'LGU+'].includes(p));
  if (priceTier) { discount_type = 'percent'; discount_value = tiers[0]; }
  const tierMin = discount_type === 'percent' ? lowestTierPercent(tierText) : null;
  const tierAmt = discount_type === 'amount' ? lowestTierAmount(tierText) : null;
  const tierLowered = priceTier || (tierMin !== null && discount_value !== null && tierMin < discount_value)
    || (tierAmt !== null && discount_value !== null && tierAmt < discount_value);
  if (tierLowered && !priceTier) discount_value = discount_type === 'amount' ? tierAmt : tierMin;
  // '3천 머니 지급', '2,000포인트 적립'은 할인이 아니라 적립 (결제액이 줄지 않음)
  if (discount_type === 'amount' && toInt(raw.coupon_price) === null && /(머니|포인트|\bP\b|캐시)\s*(을|를)?\s*(지급|적립|증정|드려|드립니다|충전)|적립금/.test(allText)) discount_type = 'point_back';
  const upTo = (discount_type === 'percent' || discount_type === 'amount' || discount_type === 'point_back') && isUpTo(allText, discount_value);
  // 적립 단위: 원 / % (AI가 알려주지 않으면 근거 문장에 'N%'가 있는지로 판단)
  const discount_unit = discount_type !== 'point_back' ? ''
    : (raw.discount_unit === 'percent' || raw.discount_unit === 'won') ? raw.discount_unit
      : (discount_value !== null && discount_value < 100 && new RegExp(`${discount_value}\\s*%`).test(allText)) ? 'percent' : 'won';
  // 할인·가격 쿠폰에서 '해피포인트 0.1% 적립'처럼 적립 안내에만 나온 이름은 필요 조건이 아니다 (출처가 정한 프로그램은 유지)
  if (discount_type !== 'point_back') {
    const acc = accrualOnlyPrograms(allText);
    programs = programs.filter((p) => !acc.includes(p) || (ctx.programs || []).includes(p));
  }
  // AI가 기간을 비워 두었으면 근거 문구의 '(8/19~8/21)' 같은 표기에서 읽는다
  // (AI가 '상시'·'null'처럼 날짜가 아닌 글자를 넣은 경우도 비운 것으로 본다 — 10/27 재실행에서 확인)
  const sd0 = parseDate(raw.start_date, now), ed0 = parseDate(raw.end_date, now);
  const period = (!sd0 || !ed0) ? inferPeriod([raw.evidence, raw.conditions, raw.menu, raw.program_note].map(clean).join(' '), now) : null;

  // 메뉴 자리에 프로그램 이름만 적힌 경우('해피포인트 적립', '네이버페이 결제') → '전 메뉴'
  let menu = clean(raw.menu);
  if (menu && detectPrograms(menu).length && !menu.replace(PROGRAM_NAME_WORDS, '').replace(/적립|할인|결제|혜택|이벤트|쿠폰|회원|멤버십|앱|\s|[+·,/()]/g, '')) menu = '전 메뉴';

  const c = {
    brand,
    category,
    menu,
    item_type: normItemType(raw.item_type, raw.menu),
    regular_price: toInt(raw.regular_price),
    coupon_price: null,
    discount_rate: null,
    discount_type,
    discount_value,
    max_discount: toInt(raw.max_discount),
    min_order: toInt(raw.min_order),
    channels: normChannels(raw.channels),
    audience: normAudience(raw.audience),
    app_only: toBool(raw.app_only),
    start_date: sd0 || period?.start || null,
    end_date: ed0 || period?.end || null,
    conditions: clean(raw.conditions),
    confidence: Math.max(0, Math.min(1, toNumber(raw.confidence) ?? 0.5)),
    issues,
    evidence: clean(raw.evidence).slice(0, 300),
    source_id: clean(ctx.sourceId || raw.source_id),
    source_url: clean(ctx.sourceUrl || raw.source_url),
    official_link: clean(ctx.officialLink || raw.official_link),
    // 이용자에게 필요한 정보: 무엇이 있어야 쓰는지 · 어떻게 쓰는지 · 다른 할인과 같이 되는지
    programs,
    // '최대'는 화면이 '최대 30%'로 보여주는 신호 (program_note에 담아 공개)
    program_note: [upTo ? '최대 (조건에 따라 다름)' : '', clean(raw.program_note).slice(0, 120) || (tierLowered ? '등급에 따라 더 큰 할인' : '')].filter(Boolean).join(' · '),
    how_to_use: clean(raw.how_to_use).slice(0, 160),
    stackable: raw.stackable === true ? 'yes' : raw.stackable === false ? 'no' : detectStackable(allText),
  };
  // 통신사 멤버십이 필요한데 대상이 '전체'로 읽혔으면 멤버십으로 (누구나 쓰는 쿠폰과 구분)
  if (programs.some((p) => ['SKT', 'KT', 'LGU+', 'CJ ONE'].includes(p)) && c.audience === '전체') c.audience = '멤버십';

  // 등급 %로 바꾼 가격(priceTier)은 AI가 읽은 VIP 가격을 쓰지 않는다
  const calc = computeCouponPrice({ ...raw, discount_type, discount_value, discount_unit, ...(priceTier ? { coupon_price: null } : {}) });
  c.coupon_price = calc.coupon_price;
  c.discount_rate = calc.discount_rate;
  // 주문 전체 할인(쿠폰가 없음): 정액이면 할인액을 discount_value에 둔다 (화면 표시용)
  if (calc.coupon_price === null && calc.saved !== null && c.discount_value === null) c.discount_value = calc.saved;
  // 엔진이 환산한 값(1천원당 → %)은 AI 원래 값으로 근거를 대조한다
  const ev = checkEvidence({ ...raw, discount_type, discount_value }, ctx.pageText);
  issues.push(...ev.issues);
  c.confidence = Math.max(0, +(c.confidence - ev.penalty).toFixed(2));

  // ---- rejected: 확실히 잘못된 것 ----
  const reject = [];
  if (!c.menu) reject.push('메뉴명 없음');
  if (c.end_date && c.end_date < today) reject.push('이미 종료');
  if (c.start_date && c.end_date && c.start_date > c.end_date) reject.push('기간 역전');
  if (c.coupon_price !== null && (c.coupon_price < RULES.minPrice || c.coupon_price > RULES.maxPrice)) reject.push('쿠폰가 범위 벗어남');
  if (c.discount_type !== 'free_item' && c.coupon_price !== null && c.regular_price !== null && c.coupon_price >= c.regular_price) reject.push('쿠폰가 ≥ 정상가');
  if (!fixed && !known) reject.push('지원하지 않는 브랜드');
  if (isDeliveryAppOnly(allText)) reject.push('외부 배달앱 전용 행사');
  if (programs.includes('카드')) reject.push('특정 카드 결제 할인');
  else if (!programs.length && needsOtherPayment(allText)) reject.push('특정 결제수단 할인');

  // ---- pending: 사람이 보기 전엔 게시하지 않을 것 ----
  const hold = [];
  // 쿠폰가·할인율·할인액 중 하나라도 있으면 비교 가능 (주문 전체 할인 포함). 아무것도 없으면 보류
  if (c.coupon_price === null && c.discount_rate === null && !((c.discount_type === 'amount' || c.discount_type === 'point_back') && c.discount_value > 0) && c.discount_type !== 'free_item') hold.push('쿠폰가 계산 불가');
  if (c.discount_rate !== null && c.discount_rate > RULES.maxRate) hold.push('할인율 90% 초과');
  if (c.confidence < RULES.minConfidence) hold.push('신뢰도 낮음');
  // 연도(2025~2027)를 가격으로 읽은 경우: 페이지에 'N원'으로 적혀 있지 않으면 보류
  const yr = +today.slice(0, 4);
  if (c.coupon_price !== null && Math.abs(c.coupon_price - yr) <= 1
    && !priceVariants(c.coupon_price).some((v) => squash(ctx.pageText || '').includes(`${v}원`))) hold.push(`가격 ${c.coupon_price}이(가) 연도일 수 있음`);
  // 정상가 없이 가격만 있는 항목은 메뉴판 가격·신메뉴 출시가일 수 있다 → 근거에 행사 표현이 있어야 게시
  if (c.discount_type === 'price' && c.regular_price === null && !PROMO_WORDS.test(`${raw.evidence || ''} ${c.conditions || ''} ${c.menu || ''}`)) hold.push('할인 행사인지 불명확 (정상가 없음)');
  // 종료일을 적지 않는 상시·시즌 프로모션이 많다(예: 맥도날드 공식 프로모션). 보류하면 아무것도 게시되지 않으므로
  // 게시하되 표시만 남긴다. 공식 페이지에서 사라지면 다음 수집에서 gone 처리돼 화면에서 빠진다.
  const notes = c.end_date ? [] : ['종료일 미정 (매일 재확인)'];

  if (tierLowered) notes.push('등급별 할인 중 가장 낮은 값으로 표시');
  if (period?.end && !ed0) notes.push('기간은 근거 문구에서 읽음');
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

/** 같은 행사가 목록·상세 페이지에서 메뉴 표기만 조금 달리 두 번 잡힌 것을 하나로 (D17) */
function bigrams(s) { const a = new Set(); for (let i = 0; i < s.length - 1; i++) a.add(s.slice(i, i + 2)); return a; }
/** '전체', '전 메뉴', '모든 피자', '피자 전 메뉴' 처럼 특정 메뉴가 아닌 표기인가 */
export function isGenericMenu(menu) {
  const k = menuKey(menu).replace(/^(모든|전체|전|all)/, '').replace(/(전체|전|모든)?(메뉴|상품|제품|품목)$/, '');
  return !k || /^(피자|치킨|버거|햄버거|커피|음료|디저트|도넛|빵|케이크|아이스크림|사이드|제휴메뉴)$/.test(k);
}
export function similarMenu(a, b, minContain = 2) {
  if (isGenericMenu(a) && isGenericMenu(b)) return true;
  const x = menuKey(a).replace(/^new/, '').replace(/^(모든|전체)/, ''), y = menuKey(b).replace(/^new/, '').replace(/^(모든|전체)/, '');
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.length >= minContain && l.includes(s)) return true;
  const A = bigrams(x), B = bigrams(y);
  const inter = [...A].filter((g) => B.has(g)).length;
  return inter / (A.size + B.size - inter) >= 0.5;
}
export function mergeSimilar(list) {
  const rank = (c) => (c.status === 'published' ? 4 : c.status === 'pending' ? 2 : 0) + (c.end_date ? 1 : 0) + (c.regular_price ? 0.5 : 0) + (c.confidence || 0) / 10;
  const out = [];
  for (const c of [...list].sort((p, q) => rank(q) - rank(p))) {
    const sig = (z) => [z.brand, z.discount_type, z.discount_type === 'price' ? (z.coupon_price ?? '') : '', z.discount_type === 'price' ? '' : (z.discount_value ?? ''), z.audience].join('|');
    const dup = c.status !== 'rejected' && out.find((o) => o.status !== 'rejected' && sig(o) === sig(c)
      && (!o.end_date || !c.end_date || o.end_date === c.end_date)
      && similarMenu(o.menu, c.menu, c.discount_type === 'free_item' ? 3 : 2));
    if (dup) {
      const urls = new Set(String(dup.source_url).split(' ').concat(String(c.source_url).split(' ')).filter(Boolean));
      dup.source_url = [...urls].join(' ');
      // 같은 할인을 통신사마다 따로 공지한 경우(SKT 20% · KT 20%) → 하나로 합치고 프로그램을 모은다
      if ((c.programs || []).length) dup.programs = normPrograms([...(dup.programs || []), ...c.programs]);
      if (c.program_note && !String(dup.program_note || '').includes(c.program_note)) dup.program_note = [dup.program_note, c.program_note].filter(Boolean).join(' · ').slice(0, 160);
      if (!dup.how_to_use && c.how_to_use) dup.how_to_use = c.how_to_use;
      if (!dup.image_url && c.image_url) dup.image_url = c.image_url;
      continue;
    }
    out.push(c);
  }
  // '통신사 최대 30%' 홍보 문구와 실제 등급 값('일반 15%')이 같은 행사로 따로 잡히면 낮은 값 하나만 남긴다 (D21 과장 방지)
  // 10/27 실제 수집: 파파존스 불닭 까르보 치킨이 '최대 30%'와 '15%' 두 장으로 나옴
  const isUp = (z) => /^최대/.test(z.program_note || '');
  const progKey = (z) => (z.programs || []).join(',');
  return out.filter((u) => {
    if (u.status === 'rejected' || !isUp(u) || u.discount_value === null) return true;
    const n = out.find((o) => o !== u && o.status !== 'rejected' && !isUp(o) && (o.status === 'published' || u.status !== 'published')
      && o.brand === u.brand && o.discount_type === u.discount_type && o.audience === u.audience && progKey(o) === progKey(u)
      && o.discount_value !== null && o.discount_value <= u.discount_value
      && (!o.end_date || !u.end_date || o.end_date === u.end_date) && similarMenu(o.menu, u.menu));
    if (!n) return true;
    n.source_url = [...new Set(String(n.source_url).split(' ').concat(String(u.source_url).split(' ')).filter(Boolean))].join(' ');
    return false;
  });
}

/**
 * 쿠폰 id 안정화: AI가 같은 행사를 날마다 조금씩 다르게 적어(메뉴 표기·구성 구분) id가 바뀌면
 * 예전 행은 '사라짐', 새 행은 '새로 생김'이 되어 이력이 끊긴다. 지금 게시 중인 쿠폰과
 * 브랜드·할인 종류·할인 크기·대상이 같고 메뉴가 비슷하며 종료일이 다르지 않으면 예전 id를 그대로 쓴다.
 * @param list     이번 수집 결과 (id 있음)
 * @param existing 지금 게시 중인 쿠폰 (공개 API 형식)
 * @returns { list, reused } — reused = 예전 id로 바꾼 개수
 */
export function stabilizeIds(list, existing) {
  const pool = (existing || []).filter((e) => e && e.id);
  const taken = new Set(list.map((c) => c.id));
  const byId = new Set(pool.map((e) => e.id));
  const sig = (z) => [z.discount_type, z.discount_type === 'price' ? (toInt(z.coupon_price) ?? '') : (toNumber(z.discount_value) ?? ''), z.audience].join('|');
  let reused = 0;
  const out = list.map((c) => {
    if (c.status === 'rejected' || byId.has(c.id)) return c;
    const hit = pool.find((e) => !taken.has(e.id) && e.brand === c.brand && sig(e) === sig(c)
      && (!e.end_date || !c.end_date || e.end_date === c.end_date)
      && similarMenu(e.menu, c.menu, c.discount_type === 'free_item' ? 3 : 2));
    if (!hit) return c;
    taken.add(hit.id);
    reused++;
    return { ...c, id: hit.id };
  });
  return { list: out, reused };
}

/** 한 행사(예: 치킨 1+1)가 메뉴별로 4건 이상 잡히면 카드 하나로: '갓양념치킨 외 8종' (D18) */
export function groupFreeItems(list, min = 4) {
  const key = (c) => [c.brand, c.audience, c.start_date || '', c.end_date || '', c.status].join('|');
  const groups = new Map();
  for (const c of list) {
    if (c.discount_type !== 'free_item' || c.status === 'rejected' || c.regular_price || c.coupon_price) continue;
    const k = key(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const drop = new Set();
  const out = [];
  for (const g of groups.values()) {
    if (g.length < min) continue;
    const head = { ...g[0] };
    const names = g.map((x) => x.menu);
    head.menu = `${names[0]} 외 ${names.length - 1}종`;
    head.conditions = [`대상: ${names.join(', ')}`, head.conditions].filter(Boolean).join(' · ').slice(0, 300);
    head.source_url = [...new Set(g.flatMap((x) => String(x.source_url).split(' ')).filter(Boolean))].join(' ');
    g.forEach((x) => drop.add(x));
    out.push(head);
  }
  return list.filter((c) => !drop.has(c)).concat(out);
}

export function menuKey(menu) {
  return clean(menu).toLowerCase().replace(/[\s()\[\]·,.\-_/+]/g, '');
}

// ---------- 영양성분 매칭 (식약처 공공데이터 ↔ 쿠폰 메뉴) ----------
// 틀린 영양정보를 보여주는 것보다 안 보여주는 게 낫다: 확실할 때만 붙이고, 어떤 메뉴 기준인지 항상 함께 보여준다.
const SET_WORDS = /(세트|콤보|combo|meal|박스|팩)$/;
const SIZE_TAIL = /(m|l|r|s|라지|미디엄|레귤러|스몰|톨|그란데|벤티|\d+(pcs|조각|ml|g|oz))$/;

/**
 * @param coupon {brand, menu, item_type}
 * @param items  [{brand, name, ...영양값}]
 * @returns {item, basis: 'exact'|'size'|'similar', set: boolean} | null
 */
export function matchNutrition(coupon, items) {
  if (!coupon || !Array.isArray(items) || !items.length) return null;
  const menu = clean(coupon.menu);
  if (!menu || isGenericMenu(menu) || /외\s*\d+\s*종|,|·|\/|중\s*택|\d+\s*종/.test(menu)) return null;  // 여러 메뉴·전 메뉴는 붙일 메뉴가 없음
  const pool = items.filter((i) => i.brand === coupon.brand && i.name);
  if (!pool.length) return null;
  let key = menuKey(menu).replace(/^new/, '');
  const set = coupon.item_type === '세트' || SET_WORDS.test(key);
  key = key.replace(/(세트|콤보|combo|meal)/g, '').replace(/단품$/, '');
  if (key.length < 2) return null;
  const keyed = pool.map((i) => ({ i, k: menuKey(i.name).replace(/단품$/, '') }));
  let hit = keyed.find((x) => x.k === key);
  if (hit) return { item: hit.i, basis: 'exact', set };
  // 사이즈 표기만 다른 경우 (아이스 드립 커피 M ↔ 아이스드립커피)
  const core = key.replace(SIZE_TAIL, '');
  hit = keyed.find((x) => x.k.replace(SIZE_TAIL, '') === core && core.length >= 2);
  if (hit) return { item: hit.i, basis: 'size', set };
  // 한쪽이 다른 쪽을 거의 포함 (길이 차이 25% 이내) — '치즈버거'와 '더블치즈버거'처럼 다른 메뉴는 붙이지 않음
  const cands = keyed
    .filter((x) => x.k.length >= 3 && (key.includes(x.k) || x.k.includes(key)))
    .filter((x) => Math.min(x.k.length, key.length) / Math.max(x.k.length, key.length) >= 0.75)
    .sort((a, b) => Math.abs(a.k.length - key.length) - Math.abs(b.k.length - key.length));
  if (cands.length === 1 || (cands.length > 1 && Math.abs(cands[0].k.length - key.length) < Math.abs(cands[1].k.length - key.length))) {
    return { item: cands[0].i, basis: 'similar', set };
  }
  return null;
}

/** 나트륨 하루 기준치(2,000mg) 대비 % */
export function sodiumPercent(mg) {
  const n = toNumber(mg);
  return n === null ? null : Math.round((n / 2000) * 100);
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

/** 앱만 있으면 누구나 쓸 수 있는 쿠폰인가 (신규·멤버십·개인 전용, 통신사·결제 조건 제외) */
export function isOpenToEveryone(c) {
  return c.audience === '전체' && !(c.programs || []).length;
}

/**
 * 이 사람이 쓸 수 있는 쿠폰인가. profile: { programs: ['KT','네이버페이'], newMember: true|false }
 * - 필요한 프로그램이 여러 개면 그중 하나만 있으면 된다 (예: SKT·KT·U+ 멤버십 20%)
 * - 개인 발급 쿠폰은 누구에게나 보장되지 않으므로 제외
 * - newMember=false면 '신규 가입' 혜택 제외 (기본은 포함: 앱을 새로 깔면 받을 수 있으므로)
 */
export function usableBy(c, profile = {}) {
  const have = new Set(profile.programs || []);
  const need = c.programs || [];
  if (need.length && !need.some((p) => have.has(p))) return false;
  if (c.audience === '개인') return false;
  if (c.audience === '신규회원' && profile.newMember === false) return false;
  return true;
}

/** 쿠폰에 필요한 것 중 이 사람이 가진 프로그램 (화면의 '내 KT 할인' 표시용) */
export function myPrograms(c, profile = {}) {
  const have = new Set(profile.programs || []);
  return (c.programs || []).filter((p) => have.has(p));
}

// 홈 아이콘 아래 줄(혜택 종류) — 누르면 목록이 그 조건으로 걸러진다 (v5)
export const PAY_PROGRAMS = ['네이버페이', '카카오페이', '토스페이', '해피포인트', 'CJ ONE'];
export const KINDS = [
  { id: 'free', label: '1+1·증정' },
  { id: 'ending', label: '곧 마감' },
  { id: 'telecom', label: '통신사' },
  { id: 'pay', label: '페이·포인트' },
  { id: 'new', label: '신규가입' },
];
export function matchesKind(c, kind, today = todayKST()) {
  const progs = c.programs || [];
  switch (kind) {
    case 'free': return c.discount_type === 'free_item';
    case 'ending': { const d = daysLeft(c.end_date, today); return d !== null && d <= 3; }
    case 'telecom': return progs.some((p) => ['SKT', 'KT', 'LGU+'].includes(p));
    case 'pay': return progs.some((p) => PAY_PROGRAMS.includes(p));
    case 'new': return c.audience === '신규회원';
    default: return true;
  }
}

/**
 * 화면 필터. f: { category, kind, itemType, channel, everyoneOnly, q, mine, programsOnly, maxPrice, fresh, endingSoon, ids }
 * ctx: { today, profile, since(지난 방문 시각) }
 */
export function matchesFilters(c, f = {}, ctx = {}) {
  const today = ctx.today || todayKST();
  if (f.category && f.category !== '전체' && c.category !== f.category) return false;
  if (f.kind && !matchesKind(c, f.kind, today)) return false;
  if (f.itemType && c.item_type !== f.itemType) return false;
  if (f.channel && !(c.channels || []).includes(f.channel)) return false;
  if (f.everyoneOnly && !isOpenToEveryone(c)) return false;
  if (f.mine && !usableBy(c, ctx.profile || {})) return false;
  if (f.programsOnly && !(c.programs || []).length) return false;
  if (f.maxPrice && !(c.coupon_price !== null && c.coupon_price !== undefined && c.coupon_price !== '' && +c.coupon_price <= +f.maxPrice)) return false;
  if (f.fresh && !isFresh(c, today, ctx.since)) return false;
  if (f.endingSoon) { const d = daysLeft(c.end_date, today); if (d === null || d > 3) return false; }
  if (f.ids && !f.ids.has(c.id)) return false;
  if (f.q) {
    const q = String(f.q).toLowerCase().replace(/\s/g, '');
    const progs = (c.programs || []).map((p) => `${p}${PROGRAM_LABEL[p] || ''}`).join('');
    const hay = `${c.brand}${c.menu}${c.conditions}${progs}`.toLowerCase().replace(/\s/g, '');
    if (!hay.includes(q)) return false;
  }
  return true;
}

/**
 * '새로 생긴 혜택'인가. since(지난 방문 시각)가 있으면 그 뒤에 처음 보인 것, 없으면(첫 방문) 오늘 처음 보인 것
 */
export function isFresh(c, today = todayKST(), since = null) {
  if (!c.first_seen) return false;
  const t = Date.parse(c.first_seen);
  if (Number.isNaN(t)) return false;
  if (since) return t > Date.parse(since);
  return diffDays(today, todayKST(new Date(t))) === 0;
}

/** 혜택 종류 순서: 쿠폰가 있음 → 할인율 → 할인액 → 적립 → 1+1·증정 (DESIGN_NEXT 4장) */
export function benefitKind(c) {
  if (c.coupon_price !== null && c.coupon_price !== undefined && c.coupon_price !== '' && c.discount_type !== 'free_item') return 0;
  if (c.discount_type === 'percent') return 1;
  if (c.discount_type === 'amount') return 2;
  if (c.discount_type === 'point_back') return 3;
  return 4;
}

/**
 * 정렬: best(추천순) | price(쿠폰가 낮은 순) | rate(할인율 높은 순) | deadline(마감 임박 순). 시작 전 쿠폰은 뒤로.
 * 추천순: 내가 쓸 수 있는 것 → 누구나 쓰는 것 → 조건 있는 것, 그 안에서 혜택 종류 → 혜택 크기
 */
export function sortCoupons(list, key = 'price', today = todayKST(), profile = null) {
  const notStarted = (c) => (c.start_date && c.start_date > today ? 1 : 0);
  const num = (v, dflt) => (v === null || v === undefined || v === '' ? dflt : +v);
  // 내 통신사·페이로 받는 혜택 → 조건 없는 혜택 → 그 밖에 쓸 수 있는 것(신규가입 등) → 내가 못 쓰는 것
  const access = (c) => (profile && !usableBy(c, profile) ? 3 : profile && myPrograms(c, profile).length ? 0 : isOpenToEveryone(c) ? 1 : 2);
  const size = (c) => {
    const k = benefitKind(c);
    if (k === 0) return num(c.coupon_price, 1e9);
    if (k === 1) return -num(c.discount_rate, 0);
    if (k === 2 || k === 3) return -num(c.discount_value, 0);
    return 0;
  };
  const cmp = {
    best: (a, b) => access(a) - access(b) || benefitKind(a) - benefitKind(b) || size(a) - size(b),
    price: (a, b) => num(a.coupon_price, 1e9) - num(b.coupon_price, 1e9),
    rate: (a, b) => num(b.discount_rate, -1) - num(a.discount_rate, -1),
    deadline: (a, b) => num(daysLeft(a.end_date, today), 1e6) - num(daysLeft(b.end_date, today), 1e6),
  }[key] || (() => 0);
  return [...list].sort((a, b) => notStarted(a) - notStarted(b) || cmp(a, b) || num(a.coupon_price, 1e9) - num(b.coupon_price, 1e9));
}

// ---------- v5: 쿠폰과 함께 온 사진 · 소식(핫딜) · 홈 상단 선정 ----------

/** 화면에 크게 보여줄 혜택 한 줄 ("1+1", "40%", "2,500원", "5,000원 할인", "2,000원 적립") */
export function benefitLabel(c) {
  const won = (n) => `${Math.round(+n).toLocaleString('en-US')}원`;
  const has = (v) => v !== null && v !== undefined && v !== '';
  const upTo = /^최대/.test(c.program_note || '') ? '최대 ' : '';
  if (c.discount_type === 'free_item') return /1\s*\+\s*1/.test(`${c.menu} ${c.conditions || ''} ${c.evidence || ''}`) ? '1+1' : '증정';
  if (c.discount_type === 'point_back') {
    if (!has(c.discount_value)) return '적립';
    return c.discount_rate !== null && c.discount_rate !== undefined && c.discount_rate !== '' ? `${upTo}${+c.discount_rate}% 적립` : `${upTo}${won(c.discount_value)} 적립`;
  }
  if (has(c.discount_rate) && c.discount_type !== 'amount') return `${upTo}${+c.discount_rate}%`;
  if (c.discount_type === 'price' && has(c.coupon_price)) return won(c.coupon_price);
  if (c.discount_type === 'amount' && has(c.discount_value)) return `${upTo}${won(c.discount_value)} 할인`;
  if (c.discount_type === 'percent' && has(c.discount_value)) return `${upTo}${+c.discount_value}%`;
  if (has(c.coupon_price)) return won(c.coupon_price);
  return '할인';
}

// 로고·아이콘·버튼·장식 이미지 (사진으로 쓰지 않음)
const NON_PHOTO = /logo|로고|icon|아이콘|ico[_-]|btn|button|버튼|arrow|sns|facebook|instagram|insta_|youtube|twitter|blog|gnb|lnb|footer|header|qr|badge|favicon|sprite|bullet|loading|spinner|placeholder|blank|appdown|app_down|googleplay|google_play|appstore|app_store|share_default|og_default|default_og|no_?image/i;
/**
 * 사진으로 쓸 수 없는 이미지인가: https가 아님(섞인 콘텐츠로 막힘), svg·gif, 로고·아이콘 이름, 너무 작음,
 * 가로로 긴 띠 배너·세로로 긴 상세 통이미지, 대체텍스트가 브랜드 이름뿐(=로고)
 */
export function isNonPhoto(img = {}, brand = '') {
  const src = String(img.src || '');
  if (!/^https:\/\//i.test(src) || /\.(svg|gif)(\?|#|$)/i.test(src)) return true;
  if (NON_PHOTO.test(src) || NON_PHOTO.test(img.alt || '')) return true;
  const w = +img.w || 0, h = +img.h || 0;
  if (w && h) {
    if (w < 200 || h < 120) return true;
    if (w / h > 4 || h / w > 2.5) return true;
  }
  if (brand && img.alt && squash(img.alt) === squash(brand)) return true;
  return false;
}

/**
 * 쿠폰(또는 소식)과 함께 온 사진 고르기 — 쿠폰 정보를 가져온 바로 그 공식 페이지의 이미지만 쓴다. 저장하지 않고 주소만 둔다.
 * 1) 이미지 대체텍스트·주변 글에 메뉴 이름이나 근거 문구 앞부분이 있으면 그 이미지
 * 2) 행사 1개짜리 상세 페이지면 공유용 대표 이미지(og:image), 없으면 큰 사진이 하나뿐일 때 그 사진
 * 3) 그 밖에는 사진 없음 ('') — 다른 곳의 사진이나 예시 사진으로 채우지 않는다
 * page: { images: [{src, alt, w, h, near}], ogImage, isDetail }
 */
export function pickImage(item = {}, page = {}, brand = '') {
  const imgs = (page.images || []).filter((i) => !isNonPhoto(i, brand));
  const mk = item.menu && !isGenericMenu(item.menu) ? menuKey(item.menu) : '';
  const ev = menuKey(item.evidence || '').slice(0, 14);
  const score = (i) => {
    const alt = menuKey(i.alt || ''), near = menuKey(i.near || '');
    let s = 0;
    if (mk.length >= 2 && alt && (alt.includes(mk) || (alt.length >= 3 && mk.includes(alt)))) s += 3;
    if (mk.length >= 2 && near.includes(mk)) s += 2;
    if (ev.length >= 6 && near.includes(ev)) s += 2;
    return s;
  };
  // 점수가 같으면 정사각형에 가까운 사진 (작은 칸에 넣어도 잘리지 않게: 모바일용 배너가 PC용보다 나음)
  const squareness = (i) => ((+i.w || 0) && (+i.h || 0) ? Math.abs(Math.log(i.w / i.h)) : 9);
  let best = null, bestS = 0;
  for (const i of imgs) { const s = score(i); if (s > bestS || (s === bestS && best && squareness(i) < squareness(best))) { best = i; bestS = s; } }
  if (best && bestS >= 2) return best.src;
  if (page.isDetail) {
    if (page.ogImage && !isNonPhoto({ src: page.ogImage, alt: '' }, brand)) return page.ogImage;
    const big = imgs.filter((i) => (+i.w || 0) >= 300 && (+i.h || 0) >= 200);
    if (big.length === 1) return big[0].src;
  }
  return '';
}

const WEEKDAYS = '일월화수목금토';
/** '매주 화요일 도미노스데이', '목요일 Special Day'처럼 요일마다 돌아오는 행사면 요일 번호(일=0), 아니면 null */
export function weeklyDay(text) {
  const s = String(text || '');
  const m = s.match(/([월화수목금토일])요일/);
  if (!m || !/매주|마다|데이|day/i.test(s)) return null;
  return WEEKDAYS.indexOf(m[1]);
}

/**
 * 소식(핫딜·기간 한정 행사) 정규화·검증 — 쿠폰과 같은 원칙: 페이지에 근거가 있어야 하고, 지난 행사는 버린다.
 * 제목·요약은 AI가 사실만 우리 문장으로 쓴 것 (원문 복사 아님). 상태: published | pending | rejected
 */
export function normalizeNews(raw = {}, ctx = {}) {
  const now = ctx.now || new Date();
  const today = todayKST(now);
  const fixed = clean(ctx.brand);
  const known = fixed ? canonicalBrand(fixed) : canonicalBrand(raw.brand);
  const ctxPrograms = ctx.programs || [];
  const allText = [raw.title, raw.summary, raw.evidence, raw.discount_label].map(clean).join(' ');
  let programs = normPrograms([...normPrograms(raw.programs), ...ctxPrograms, ...detectPrograms(allText)]);
  const acc = accrualOnlyPrograms(allText);
  if (!/적립/.test(clean(raw.discount_label))) programs = programs.filter((p) => !acc.includes(p) || ctxPrograms.includes(p));
  // 여러 브랜드가 섞인 출처(멤버십·결제)의 소식이 특정 브랜드가 아니면 프로그램 이름으로 (예: '네이버페이')
  const brand = fixed || known?.brand || (ctxPrograms[0] ? PROGRAM_LABEL[ctxPrograms[0]] : '');
  const category = fixed ? (clean(ctx.category) || known?.category || '') : (known?.category || clean(ctx.category) || '');
  const sd0 = parseDate(raw.start_date, now), ed0 = parseDate(raw.end_date, now);
  const period = (!sd0 || !ed0) ? inferPeriod([raw.evidence, raw.summary, raw.title].map(clean).join(' '), now) : null;
  const pageSq = squash(ctx.pageText || '');
  // 라벨의 숫자(10 이상)는 페이지에 있어야 한다 — 없으면 라벨만 지운다
  // 라벨은 크게 보이는 짧은 혜택 표시 — 12자를 넘으면 쓰지 않는다 (연결된 쿠폰의 혜택으로 대신)
  let label = clean(raw.discount_label).replace(/\s+/g, ' ');
  if (label.length > 12) label = '';
  if (label && pageSq) {
    const nums = (label.match(/\d[\d,]*/g) || []).map((x) => +x.replace(/,/g, '')).filter((x) => x >= 10);
    const thousand = /(\d+)\s*천/.exec(label);
    if (thousand) nums.push(+thousand[1] * 1000);
    if (nums.some((x) => !priceVariants(x).some((p) => pageSq.includes(p)) && !pageSq.includes(`${x}%`) && !(x % 1000 === 0 && pageSq.includes(`${x / 1000}천`)))) label = '';
  }
  const n = {
    brand, category,
    title: clean(raw.title).replace(/\s+/g, ' ').slice(0, 40),
    summary: clean(raw.summary).replace(/\s+/g, ' ').slice(0, 200),
    discount_label: label,
    start_date: sd0 || period?.start || null,
    end_date: ed0 || period?.end || null,
    programs,
    evidence: clean(raw.evidence).slice(0, 200),
    source_id: clean(ctx.sourceId || raw.source_id),
    source_url: clean(ctx.sourceUrl || raw.source_url),
    official_link: clean(ctx.officialLink || raw.official_link),
    image_url: '',
    related_ids: [],
    confidence: Math.max(0, Math.min(1, toNumber(raw.confidence) ?? 0.5)),
    issues: [],
  };
  const reject = [];
  if (!n.title) reject.push('제목 없음');
  if (!n.brand) reject.push('지원하지 않는 브랜드');
  // 여러 브랜드가 섞인 출처(멤버십·결제)에서 우리 브랜드가 아닌 소식은 외식·카페 업종일 때만 (영화·쇼핑·여행 등 제외)
  else if (!fixed && !known && !/카페|커피|버거|치킨|피자|베이커리|빵|디저트|아이스크림|도넛|외식|음료|라떼/.test(allText)) reject.push('다루지 않는 업종');
  if (n.end_date && n.end_date < today) reject.push('이미 종료');
  if (n.start_date && n.end_date && n.start_date > n.end_date) reject.push('기간 역전');
  if (isDeliveryAppOnly(allText)) reject.push('외부 배달앱 전용 행사');
  if (programs.includes('카드')) reject.push('특정 카드 결제 할인');
  else if (!n.programs.length && needsOtherPayment(allText)) reject.push('특정 결제수단 할인');
  if (!PROMO_WORDS.test(allText)) reject.push('혜택 소식이 아님');
  const hold = [];
  const ev = squash(n.evidence);
  if (raw.evidence_source !== 'image' && pageSq && ev.length >= 4 && !pageSq.includes(ev)) {
    // 근거를 요약해 옮겼어도 라벨의 숫자가 페이지에 있으면 감점을 작게 (쿠폰과 같은 기준)
    const numsOk = /\d{2,}/.test(n.discount_label);
    n.issues.push(numsOk ? '근거 문구 요약됨 (숫자는 확인)' : '근거 문구가 페이지에 없음');
    n.confidence = Math.max(0, +(n.confidence - (numsOk ? RULES.evidencePenalty / 3 : RULES.evidencePenalty)).toFixed(2));
  }
  if (n.confidence < RULES.minConfidence) hold.push('신뢰도 낮음');
  // 핫딜은 기간이 있는 행사만 (끝나는 날이 있거나 요일마다 돌아오는 행사). 상시 혜택·가입 혜택은 쿠폰 목록에만
  if (!n.end_date && weeklyDay(allText) === null) hold.push('기간 없는 상시 행사');
  if (period?.end && !ed0) n.issues.push('기간은 근거 문구에서 읽음');
  n.issues.unshift(...reject, ...hold);
  n.status = reject.length ? 'rejected' : hold.length ? 'pending' : 'published';
  return n;
}

/**
 * 같은 행사가 목록·상세 페이지에서 소식 두 개로 잡히면 하나로: 같은 브랜드이고 연결된 쿠폰이 겹치거나,
 * 끝나는 날이 같고 제목이 비슷하면. 게시 > 보류, 라벨 있음, 연결 쿠폰 많음, 신뢰도 높은 쪽을 남기고 연결 쿠폰은 합친다
 */
export function mergeNews(list) {
  const rank = (n) => (n.status === 'published' ? 100 : n.status === 'pending' ? 50 : 0) + (n.discount_label ? 10 : 0) + (n.related_ids || []).length + (n.confidence || 0);
  const out = [];
  for (const n of [...list].sort((a, b) => rank(b) - rank(a))) {
    if (n.status === 'rejected') { out.push(n); continue; }
    const dup = out.find((o) => o.status !== 'rejected' && o.brand === n.brand && (
      (o.related_ids || []).some((id) => (n.related_ids || []).includes(id))
      || ((o.end_date || '') === (n.end_date || '') && similarMenu(o.title, n.title, 4))));
    if (dup) {
      dup.related_ids = [...new Set([...(dup.related_ids || []), ...(n.related_ids || [])])].slice(0, 6);
      if (!dup.image_url && n.image_url) dup.image_url = n.image_url;
      if (!dup.start_date && n.start_date) dup.start_date = n.start_date;
      continue;
    }
    out.push({ ...n });
  }
  return out;
}

/** 소식과 같은 페이지·같은 브랜드(멀티 브랜드 출처면 같은 프로그램)의 게시 쿠폰을 연결 (최대 6개) */
export function linkNews(newsList, coupons) {
  return newsList.map((n) => {
    const urlHit = (c) => String(c.source_url || '').split(' ').includes(n.source_url);
    const overlap = (c) => !(n.end_date && c.start_date && c.start_date > n.end_date) && !(n.start_date && c.end_date && c.end_date < n.start_date);
    const sameWho = (c) => c.brand === n.brand || (n.programs || []).some((p) => (c.programs || []).includes(p) && PROGRAM_LABEL[p] === n.brand);
    const rel = coupons.filter((c) => c.status === 'published' && urlHit(c) && sameWho(c) && overlap(c)).slice(0, 6);
    return { ...n, related_ids: rel.map((c) => c.id), image_url: n.image_url || rel.find((c) => c.image_url)?.image_url || '' };
  });
}

/**
 * 홈 맨 위 '오늘의 핫딜' 고르기 (하루 최대 limit장, 같은 브랜드 2장까지)
 * - 소식: 공식 이벤트·공지에서 잡힌 기간 한정 행사 (수집 때 함께 갱신)
 * - 쿠폰: 남은 기간 3일 이하 + 큰 혜택(할인율 30% 이상·1+1) = 긴급, 오늘·어제 처음 잡힌 큰 혜택 = 새로 시작
 * 점수 = 혜택 크기 + 마감 임박 + 새로움 + 누구나 사용 가능. 내 할인 수단으로 못 쓰는 것은 뒤로
 */
export function pickHeadlines(coupons = [], news = [], { today = todayKST(), profile = null, limit = 8 } = {}) {
  const has = (v) => v !== null && v !== undefined && v !== '';
  const live = (x) => (!x.end_date || x.end_date >= today) && (!x.start_date || diffDays(x.start_date, today) <= 7);
  const size = (c) => (c.discount_type === 'free_item' ? 50 : has(c.discount_rate) ? +c.discount_rate
    : c.discount_type === 'amount' ? Math.min(40, (+c.discount_value || 0) / 250) : c.discount_type === 'point_back' ? 10 : 0);
  const urgency = (end) => { const d = daysLeft(end, today); return d === null ? 0 : d <= 0 ? 30 : d <= 1 ? 25 : d <= 3 ? 18 : d <= 7 ? 8 : 0; };
  const newness = (first) => {
    if (!first || Number.isNaN(Date.parse(first))) return 0;
    const d = diffDays(today, todayKST(new Date(first)));
    return d <= 0 ? 15 : d <= 1 ? 10 : d <= 3 ? 4 : 0;
  };
  const mineOrOpen = (x) => !profile || !(x.programs || []).length || (x.programs || []).some((p) => (profile.programs || []).includes(p));
  const reasonOf = (x) => {
    const d = daysLeft(x.end_date, today);
    if (x.start_date && x.start_date > today) return `${x.start_date.slice(5).replace('-', '/')} 시작`;
    if (d !== null && d <= 0) return '오늘 마감';
    if (d !== null && d <= 3) return `D-${d}`;
    if (newness(x.first_seen) >= 10) return 'NEW';
    return d !== null && d <= 30 ? `${x.end_date.slice(5).replace('-', '/')}까지` : '';
  };
  const byId = new Map(coupons.map((c) => [c.id, c]));
  const used = new Set();
  const out = [];
  const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
  for (const n of news) {
    if ((n.status && n.status !== 'published') || !live(n)) continue;
    // 요일 행사(끝나는 날 없음)는 그 요일에만 올린다
    const wd = n.end_date ? null : weeklyDay(`${n.title} ${n.summary || ''}`);
    if (!n.end_date && wd !== todayDow) continue;
    const rel = (n.related_ids || []).map((id) => byId.get(id)).filter(Boolean);
    rel.forEach((c) => used.add(c.id));
    const best = rel.reduce((m, c) => Math.max(m, size(c)), 0);
    let score = 40 + best * 0.6 + (wd !== null ? 30 : urgency(n.end_date)) + newness(n.first_seen) + (!(n.programs || []).length ? 8 : 0);
    if (!mineOrOpen(n)) score -= 30;
    out.push({
      kind: 'news', id: n.id, brand: n.brand, category: n.category || rel[0]?.category || '', title: n.title, summary: n.summary,
      label: n.discount_label || (rel[0] ? benefitLabel(rel[0]) : ''), start_date: n.start_date || null, end_date: n.end_date || null,
      image_url: n.image_url || rel.find((c) => c.image_url)?.image_url || '', programs: n.programs || [], related_ids: rel.map((c) => c.id),
      reason: wd !== null ? `오늘(${WEEKDAYS[wd]})만` : reasonOf(n), score,
    });
  }
  for (const c of coupons) {
    if (used.has(c.id) || !live(c) || c.audience === '개인' || (c.start_date && c.start_date > today)) continue;
    const big = size(c) >= 30 || c.discount_type === 'free_item';
    const d = daysLeft(c.end_date, today);
    const urgent = big && d !== null && d <= 3;
    const fresh = big && newness(c.first_seen) >= 10;
    if (!urgent && !fresh) continue;
    let score = size(c) * 0.6 + urgency(c.end_date) + newness(c.first_seen) + (isOpenToEveryone(c) ? 8 : 0);
    if (profile && !usableBy(c, profile)) score -= 30;
    out.push({
      kind: 'coupon', id: c.id, brand: c.brand, category: c.category, title: `${c.brand} ${c.menu}`,
      summary: '', label: benefitLabel(c), start_date: c.start_date || null, end_date: c.end_date || null, image_url: c.image_url || '',
      programs: c.programs || [], related_ids: [c.id], reason: reasonOf(c), score,
    });
  }
  out.sort((a, b) => b.score - a.score);
  const perBrand = {};
  return out.filter((h) => (perBrand[h.brand] = (perBrand[h.brand] || 0) + 1) <= 2).slice(0, limit);
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
