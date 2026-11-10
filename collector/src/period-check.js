// 기간 팩트체크 (11/10 대표 결정)
// "기간을 모르겠으면 공지 이미지나 기사 여러개 확인하고 팩트체크해서 명시해줘."
//
// 대상: 브랜드 공식 출처에서 잡혔지만 끝나는 날이 없는 소식 (예: 버거킹 '26년 11월 와퍼 3900원 프로모션').
// 근거 순서 — 앞 단계에서 확정되면 거기서 멈춘다:
//   1) 공식 원문 글자 (상세 화면의 글자)  2) 공식 공지 이미지 (목록 배너·상세 화면을 AI가 '기간만' 읽음)
//   3) 언론 기사 — 서로 다른 언론사 2곳 이상이 같은 시작일·종료일을 적고, 다른 날짜를 적은 곳이 없을 때만
// 원칙:
//   - 기사로 새 핫딜을 만들지 않는다 (10/28 대표 결정 '핫딜은 네이버 뉴스에서 가져오지 않는다'는 그대로). 이미 공식 출처에서 찾은 행사의 기간만 확인.
//   - 날짜를 추측하지 않는다. 달만 있으면 채우지 않는다. 연도 없는 날짜는 근거(기사 게시일·처음 본 날)의 연도로.
//   - 커뮤니티 글(블로그·카페·어미새·뽐뿌·루리웹·SNS 개인 글)은 근거가 아니다.
//   - 같은 행사인지 확인: 브랜드 + 메뉴/대상 낱말 + 가격·할인 숫자. 행사 시작 14일 전보다 오래된 기사는 보지 않는다(버거킹은 7월에도 와퍼 3,900원을 했다).
//   - 기사 본문은 저장·표시하지 않는다. 남기는 것: 언론사·주소·게시일·읽어 낸 기간.
//   - 이미지 파일은 저장하지 않는다(브라우저 화면을 읽을 때만 잠깐 사용).
import { inferPeriod, todayKST, diffDays, monthTag, weeklyDay, pad } from './engine.js';

export const PERIOD_SOURCE = { text: '공식 원문', image: '공식 공지 이미지', press: '언론 보도' };
export const PERIOD_LIMITS = { items: 10, queriesPerItem: 3, articlesPerItem: 8, minOutlets: 2, windowDays: 14, recheckHours: 20, maxDays: 75 };
// 공식 근거를 다시 찾을 필요가 없는 근거
const FINAL_SOURCES = [PERIOD_SOURCE.text, PERIOD_SOURCE.image];
// 기간 확인으로 풀리는 보류·표시 사유
const PERIOD_ISSUES = ['기간 없는 상시 행사', '다음 달 행사', '끝나는 날 미공개 — 공식 이벤트 목록 기준'];

// 근거로 쓰지 않는 곳: 커뮤니티·블로그·카페·SNS·위키·지식인, 포털 재전송(원 언론사를 알 수 없음), 보도자료 배포 사이트
const NOT_PRESS = [
  'blog.naver.com', 'cafe.naver.com', 'post.naver.com', 'kin.naver.com', 'in.naver.com', 'tistory.com', 'brunch.co.kr', 'velog.io', 'medium.com',
  'cafe.daum.net', 'blog.daum.net', 'eomisae.co.kr', 'ppomppu.co.kr', 'ruliweb.com', 'clien.net', 'fmkorea.com', 'dcinside.com', 'theqoo.net',
  'instiz.net', 'bobaedream.co.kr', 'quasarzone.com', 'arca.live', 'mlbpark.donga.com', '82cook.com', 'humoruniv.com', 'todayhumor.co.kr',
  'instagram.com', 'facebook.com', 'x.com', 'twitter.com', 'threads.net', 'youtube.com', 'tiktok.com', 'namu.wiki', 'wikipedia.org',
  'news.naver.com', 'v.daum.net', 'news.daum.net', 'news.nate.com', 'news.zum.com', 'news.google.com', 'msn.com',
  'newswire.co.kr', 'prnewswire.com', 'businesswire.com',
];
const SLD = /^(co|or|go|ac|ne|re|pe|kr)$/;

/** 'https://m.segye.com/a/1' → 'segye.com' (같은 언론사의 www·m·모바일 주소를 하나로) */
export function outletOf(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const p = host.split('.');
    const n = SLD.test(p.at(-2)) && p.at(-1).length === 2 ? 3 : 2;
    return p.slice(-n).join('.');
  } catch { return ''; }
}

/** 언론사 기사로 볼 수 있는 주소인가 (커뮤니티·포털 재전송·보도자료 배포·브랜드 공식 사이트 제외) */
export function isPressUrl(url, officialHosts = []) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  if (!/^https?:/.test(url)) return false;
  const hit = (d) => host === d || host.endsWith('.' + d);
  if (NOT_PRESS.some(hit)) return false;
  return !officialHosts.some((h) => outletOf(`https://${h}`) === outletOf(url));
}

const clean = (s) => String(s || '').normalize('NFKC').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
const iso = (y, m, d) => {
  const v = `${y}-${pad(m)}-${pad(d)}`;
  const t = new Date(v + 'T00:00:00Z');
  return m >= 1 && m <= 12 && !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === v ? v : null;
};

/**
 * 글에 적힌 행사 기간 (시작일·종료일 둘 다 있을 때만).
 * '11.9(일) ~ 11.13(목)', '2026.11.09 ~ 11.13', '11월 9일부터 13일까지', '11월 9일(일)부터 11월 13일(목)까지', '이달 9일부터 13일까지'
 * 연도가 없으면 기준일(기사 게시일·처음 본 날)의 연도, 기준일보다 60일 넘게 앞서면 다음 해 (12월 기사의 '1월 2일부터')
 */
export function parsePeriodText(text, base = new Date()) {
  const s = clean(text);
  const baseDay = typeof base === 'string' ? base : todayKST(base);
  const by = +baseDay.slice(0, 4);
  const fix = (m, d) => { let v = iso(by, m, d); if (v && diffDays(baseDay, v) > 60) v = iso(by + 1, m, d); return v; };
  const ok = (start, end) => (start && end && start <= end && diffDays(end, start) <= 366 ? { start, end } : null);
  const DOW = '(?:\\s*\\([월화수목금토일]\\))?';
  // ① 'M월 D일(요일)부터 [M월] D일(요일)까지'
  let m = s.match(new RegExp(`(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일${DOW}\\s*(?:부터|에서)\\s*(?:(\\d{1,2})\\s*월\\s*)?(\\d{1,2})\\s*일${DOW}\\s*까지`));
  if (m) {
    const start = fix(+m[1], +m[2]);
    let end = iso(+start?.slice(0, 4), m[3] ? +m[3] : +m[1], +m[4]);
    if (start && end && end < start && m[3]) end = iso(+start.slice(0, 4) + 1, +m[3], +m[4]);
    const r = ok(start, end);
    if (r) return r;
  }
  // ② '이달·이번 달 D일부터 D일까지' → 기준일의 달
  m = s.match(new RegExp(`(?:이달|이번\\s*달)\\s*(\\d{1,2})\\s*일${DOW}\\s*(?:부터|에서)\\s*(\\d{1,2})\\s*일${DOW}\\s*까지`));
  if (m) {
    const mo = +baseDay.slice(5, 7);
    const r = ok(iso(by, mo, +m[1]), iso(by, mo, +m[2]));
    if (r) return r;
  }
  // ③ 물결표 범위 ('11.9 ~ 11.13', '11월 9일 ~ 13일', '2026.11.09 ~ 2026.11.13') — 기존 규칙 (연도 추정은 기준일 기준)
  const r = inferPeriod(s, new Date(`${baseDay}T03:00:00Z`));
  if (r && r.start && r.end) return ok(r.start, r.end);
  // ④ 달 없는 '(오는) 9일부터 13일까지' — 기사에 흔한 표기. 기준일(게시일)의 달, 시작일이 게시일보다 열흘 넘게 앞서면 다음 달
  m = s.match(new RegExp(`(?:^|[^\\d월])(?:오는\\s*)?(\\d{1,2})\\s*일${DOW}\\s*부터\\s*(?:오는\\s*)?(\\d{1,2})\\s*일${DOW}\\s*까지`));
  if (m && +m[1] <= +m[2]) {
    let y = by, mo = +baseDay.slice(5, 7);
    let start = iso(y, mo, +m[1]);
    if (start && diffDays(baseDay, start) > 10) { mo += 1; if (mo > 12) { mo = 1; y += 1; } start = iso(y, mo, +m[1]); }
    return ok(start, iso(y, mo, +m[2]));
  }
  return null;
}

const GENERIC = /^(프로모션|할인|행사|이벤트|특가|데이|혜택|시즌|한정|최대|선착순|기념|진행|판매|가격|단돈|오픈|신규|전|메뉴|세트|구매|주문|시|및|또는|공식|매장|앱|포장|배달|방문|쿠폰|증정|무료|특별|기간|오늘|단|하루)$/;
/** 소식 제목에서 메뉴·대상 낱말 (브랜드·숫자·흔한 행사 낱말 제외) */
export function eventWords(n) {
  const brand = String(n.brand || '').replace(/\s+/g, '');
  return [...new Set(clean(n.title).replace(/[\d,.%+~·()[\]'"!?/:]/g, ' ').split(/\s+/)
    .map((w) => w.replace(/(은|는|이|가|을|를|의|에|도|로|으로)$/, ''))
    .filter((w) => w.length >= 2 && w !== brand && !brand.includes(w) && !GENERIC.test(w) && !/^\d|년$|월$|일$|원$/.test(w)))];
}

/** 라벨의 혜택 숫자: '3900원'→['3900'], '7,900원'→['7900'], '50% 할인'→['50%'], '1+1'→['1+1'] */
export function benefitNumbers(label) {
  const s = String(label || '').normalize('NFKC').replace(/,/g, '');
  if (/1\s*\+\s*1|원\s*[쁠플]\s*원/.test(s)) return ['1+1'];
  return [...s.matchAll(/(\d+)\s*(%|원|천\s*원)?/g)].map((m) => (m[2] === '%' ? `${m[1]}%` : /천/.test(m[2] || '') ? String(+m[1] * 1000) : m[1]));
}

/** 같은 행사인가: 브랜드 + (메뉴 낱말이 있으면 그중 하나) + 혜택 숫자 모두 */
export function sameEvent(n, text) {
  const t = clean(text).replace(/,/g, '');
  const flat = t.replace(/\s+/g, '');
  const brand = String(n.brand || '').replace(/\s+/g, '');
  if (!brand || !flat.includes(brand)) return false;
  const words = eventWords(n);
  if (words.length && !words.some((w) => flat.includes(w))) return false;
  const nums = benefitNumbers(n.discount_label);
  return nums.every((x) => (x === '1+1' ? /1\s*\+\s*1|원\s*[쁠플]\s*원/.test(t) : x.endsWith('%') ? new RegExp(`(^|[^\\d])${x.slice(0, -1)}\\s*%`).test(t) : new RegExp(`(^|[^\\d])${x}\\s*원`).test(t) || (+x >= 1000 && +x % 1000 === 0 && new RegExp(`(^|[^\\d])${+x / 1000}\\s*천\\s*원`).test(t))));
}

const firstSeenDay = (n, now) => (n.first_seen && Number.isFinite(Date.parse(n.first_seen)) ? todayKST(new Date(n.first_seen)) : todayKST(now));

/**
 * 찾은 기간이 이 행사와 맞는가 — 처음 본 날(공식 목록에 진행 중으로 있던 날)보다 먼저 끝났거나,
 * 제목의 달 표시('26년 11월')와 다르거나, 두 달 반을 넘으면 쓰지 않는다
 */
export function periodFits(n, p, now = new Date()) {
  if (!p || !p.start || !p.end || p.start > p.end) return false;
  if (p.end < firstSeenDay(n, now)) return false;
  if (diffDays(p.end, p.start) > PERIOD_LIMITS.maxDays) return false;
  const tag = monthTag(`${n.title} ${n.evidence || ''}`, new Date(`${firstSeenDay(n, now)}T03:00:00Z`));
  return !tag || p.start.slice(0, 7) === tag || p.end.slice(0, 7) === tag;
}

/**
 * 기사 여러 개로 기간 판단 (순수 함수 — 검색·본문 읽기는 밖에서).
 * articles: [{ url, outlet?, published: ISO 또는 'YYYY-MM-DD', text }]
 * @returns {{ start, end, refs: [{outlet,url,published}] } | { fail: string }}
 */
export function judgePress(n, articles = [], { now = new Date(), officialHosts = [] } = {}) {
  const anchor = n.start_date || firstSeenDay(n, now);
  const since = new Date(Date.parse(`${anchor}T00:00:00+09:00`) - PERIOD_LIMITS.windowDays * 864e5);
  const byOutlet = new Map();
  let community = 0, old = 0, other = 0, nodate = 0;
  for (const a of articles) {
    if (!a || !a.url) continue;
    if (!isPressUrl(a.url, officialHosts)) { community++; continue; }
    const pub = a.published && Number.isFinite(Date.parse(a.published)) ? new Date(a.published) : null;
    if (!pub || pub < since || pub > new Date(now.getTime() + 864e5)) { old++; continue; }
    if (!sameEvent(n, a.text)) { other++; continue; }
    const p = parsePeriodText(a.text, todayKST(pub));
    if (!p || !periodFits(n, p, now)) { nodate++; continue; }
    const outlet = a.outlet || outletOf(a.url);
    const list = byOutlet.get(outlet) || [];
    list.push({ ...p, outlet, url: a.url, published: todayKST(pub) });
    byOutlet.set(outlet, list);
  }
  const keys = new Set();
  for (const list of byOutlet.values()) for (const x of list) keys.add(`${x.start}~${x.end}`);
  const seen = `언론사 ${byOutlet.size}곳 (커뮤니티 ${community} · 기간 밖 ${old} · 다른 행사 ${other} · 날짜 없음 ${nodate})`;
  if (keys.size > 1) return { fail: `기사마다 기간이 다름 (${[...keys].join(', ')})` };
  if (byOutlet.size < PERIOD_LIMITS.minOutlets) return { fail: `기간을 적은 ${seen} — ${PERIOD_LIMITS.minOutlets}곳 이상 필요` };
  const [start, end] = [...keys][0].split('~');
  const refs = [...byOutlet.values()].map((list) => list.sort((a, b) => a.published.localeCompare(b.published))[0]).slice(0, 3)
    .map(({ outlet, url, published }) => ({ outlet, url, published }));
  return { start, end, refs };
}

/** 기간 확인 대상: 공식(한 브랜드) 출처의 소식인데 끝나는 날이 없음. 요일·매월 반복 행사는 상시라 대상 아님 */
export function needsPeriod(n, { fixedSource = () => true } = {}) {
  if (!n || n.end_date || (n.status !== 'published' && n.status !== 'pending')) return false;
  if (!fixedSource(n.source_id)) return false;
  const all = `${n.title || ''} ${n.summary || ''}`;
  if (weeklyDay(all) !== null || /매주|매월|매달|매일|상시|언제나/.test(all)) return false;
  if (n.status === 'pending') return (n.issues || []).some((i) => i === '기간 없는 상시 행사' || i === '다음 달 행사');
  return true;
}

const refsText = (refs = []) => refs.map((r) => [r.outlet, r.url, r.published].join('|')).join('\n');
export function parseRefs(v) {
  return String(v || '').split('\n').map((l) => l.split('|')).filter((p) => p.length >= 2 && /^https?:\/\//.test(p[1]))
    .map(([outlet, url, published = '']) => ({ outlet, url, published })).slice(0, 3);
}

/**
 * 확인한 기간을 소식에 반영 (id는 바꾸지 않는다 — 공식 원문 날짜로 만든 id를 그대로 둬야 다음 수집과 같은 줄이 된다)
 * 보류 사유가 기간뿐이었으면 게시, 이미 끝났으면 버림, 두 달 반이 넘으면 보류
 */
export function applyPeriod(n, p, { now = new Date() } = {}) {
  const today = todayKST(now);
  const out = { ...n, start_date: p.start, end_date: p.end, period_source: p.source, period_refs: typeof p.refs === 'string' ? p.refs : refsText(p.refs), period_checked_at: p.checked_at || now.toISOString() };
  let issues = (n.issues || []).filter((i) => !PERIOD_ISSUES.includes(i) && !/^기간 확인/.test(i));
  const holds = issues.filter((i) => i === '신뢰도 낮음' || i === '기간이 긴 상시성 행사');
  if (p.end < today) { out.status = 'rejected'; issues = ['이미 종료', ...issues]; }
  else if (diffDays(p.end, p.start) > PERIOD_LIMITS.maxDays) { out.status = 'pending'; issues = ['기간이 긴 상시성 행사', ...issues]; }
  else out.status = n.status === 'rejected' ? 'rejected' : holds.length ? 'pending' : 'published';
  out.issues = [...issues, `기간 확인: ${p.source}`];
  return out;
}

/** 확인 실패 기록 (공개 화면은 그대로 '끝나는 날 공지 없음') */
export function markPeriodFail(n, reason, { now = new Date() } = {}) {
  return { ...n, period_checked_at: now.toISOString(), issues: [...(n.issues || []).filter((i) => !/^기간 확인/.test(i)), `기간 확인 실패: ${reason}`.slice(0, 160)] };
}

/** 검색어 2~3개: 브랜드 + 메뉴 + 혜택 숫자 + 연·월 */
export function pressQueries(n, now = new Date()) {
  const day = firstSeenDay(n, now);
  const words = eventWords(n).slice(0, 3).join(' ');
  const label = String(n.discount_label || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const ym = `${+day.slice(0, 4)}년 ${+day.slice(5, 7)}월`;
  return [...new Set([
    [n.brand, words, label].filter(Boolean).join(' '),
    [n.brand, words, label, ym].filter(Boolean).join(' '),
    [n.brand, label || words, '행사 기간'].filter(Boolean).join(' '),
  ].map((q) => q.replace(/\s+/g, ' ').trim()))].slice(0, PERIOD_LIMITS.queriesPerItem);
}

/**
 * 끝나는 날이 없는 소식들의 기간 확인 (수집 1회에 최대 10개).
 * deps.known: Map(id → 시트에 저장된 기간 기록) — 확인된 것은 다시 찾지 않고 그대로 반영
 * deps.official(n) → { start, end, source } | null    공식 상세 글자·공지 이미지
 * deps.press: { connected, name, search(query) → [{url, published, text}], read(url) → {published, text} } | null
 * @returns {{ news, summary }}
 */
export async function checkPeriods(news, deps = {}) {
  const { now = new Date(), known = new Map(), fixedSource = () => true, official = null, press = null, log = () => {}, officialHosts = () => [] } = deps;
  const summary = { checked: 0, filled: [], failed: [], reused: 0, press: press ? press.name || (press.connected ? '연결됨' : '연결 안 됨') : '연결 안 됨' };
  const hoursSince = (iso) => (iso && Number.isFinite(Date.parse(iso)) ? (now - Date.parse(iso)) / 36e5 : Infinity);
  let budget = PERIOD_LIMITS.items;
  const out = [];
  for (const n0 of news) {
    let n = n0;
    if (!needsPeriod(n, { fixedSource })) { out.push(n); continue; }
    const k = known.get(n.id);
    if (k && k.period_source && k.end_date) {
      n = applyPeriod(n, { start: k.start_date, end: k.end_date, source: k.period_source, refs: k.period_refs, checked_at: k.period_checked_at }, { now });
      summary.reused++;
      // 공식 근거로 확인된 것은 끝. 기사 근거는 공식 공지에서 다시 확인될 수 있으니 공식 단계만 하루 한 번 더
      if (FINAL_SOURCES.includes(k.period_source) || hoursSince(k.period_checked_at) < PERIOD_LIMITS.recheckHours || budget <= 0 || !official) { out.push(n); continue; }
      budget--;
      const o = await safe(() => official(n0), log);
      if (o && periodFits(n0, o, now)) {
        if (o.start !== n.start_date || o.end !== n.end_date) log(`  기간 바뀜(공식 공지): ${n.brand} ${n.title} ${n.start_date}~${n.end_date} → ${o.start}~${o.end}`);
        n = applyPeriod(n0, { ...o, refs: '' }, { now });
        n.issues.push('기사 근거보다 공식 공지 우선');
        summary.filled.push({ id: n.id, brand: n.brand, title: n.title, start: o.start, end: o.end, source: o.source, refs: [] });
      }
      out.push(n); continue;
    }
    if (k && !k.period_source && hoursSince(k.period_checked_at) < PERIOD_LIMITS.recheckHours) { out.push({ ...n, period_checked_at: k.period_checked_at }); continue; }
    if (budget <= 0) { out.push(n); continue; }
    budget--;
    summary.checked++;
    // 1·2) 공식 상세 글자 → 공식 공지 이미지
    const o = official ? await safe(() => official(n), log) : null;
    if (o && periodFits(n, o, now)) {
      const r = applyPeriod(n, { ...o, refs: '' }, { now });
      summary.filled.push({ id: n.id, brand: n.brand, title: n.title, start: o.start, end: o.end, source: o.source, refs: [] });
      out.push(r); continue;
    }
    // 3) 언론 기사
    if (!press || !press.connected) {
      out.push(markPeriodFail(n, `공식 공지에 기간 없음${o ? '(맞지 않는 날짜)' : ''} · 기사 확인 연결 안 됨`, { now }));
      summary.failed.push({ id: n.id, brand: n.brand, title: n.title, reason: '공식 공지에 기간 없음 · 기사 확인 연결 안 됨' });
      continue;
    }
    const seen = new Map();
    for (const q of pressQueries(n, now)) {
      const found = await safe(() => press.search(q), log) || [];
      for (const a of found) if (a && a.url && !seen.has(a.url)) seen.set(a.url, a);
    }
    const hosts = officialHosts(n) || [];
    const articles = [];
    for (const a of [...seen.values()].filter((x) => isPressUrl(x.url, hosts)).slice(0, PERIOD_LIMITS.articlesPerItem)) {
      // 검색 요약에 기간이 없으면 기사 본문에서 (robots.txt 허용일 때만, 본문은 저장하지 않음)
      if (parsePeriodText(a.text, a.published ? todayKST(new Date(a.published)) : todayKST(now)) || !press.read) { articles.push(a); continue; }
      const body = await safe(() => press.read(a.url), log);
      articles.push(body ? { ...a, text: `${a.text} ${body.text}`, published: a.published || body.published } : a);
    }
    const j = judgePress(n, [...articles, ...[...seen.values()].filter((x) => !isPressUrl(x.url, hosts))], { now, officialHosts: hosts });
    if (j.fail) {
      out.push(markPeriodFail(n, j.fail, { now }));
      summary.failed.push({ id: n.id, brand: n.brand, title: n.title, reason: j.fail });
      continue;
    }
    const r = applyPeriod(n, { start: j.start, end: j.end, source: PERIOD_SOURCE.press, refs: j.refs }, { now });
    summary.filled.push({ id: n.id, brand: n.brand, title: n.title, start: j.start, end: j.end, source: PERIOD_SOURCE.press, refs: j.refs });
    out.push(r);
  }
  return { news: out, summary };
}

async function safe(fn, log) {
  try { return await fn(); } catch (e) { log(`  기간 확인 오류: ${String(e && e.message || e).slice(0, 200)}`); return null; }
}
