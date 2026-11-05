// 쿠팡 특가 후보 찾기 (11/05 대표 결정: 상품 선별 정보만 핫딜 게시판에서 얻고, 공개 화면에는 우리 카드·우리 링크만)
// - robots.txt가 허용하는 게시판의 공개 RSS만 읽는다 (뽐뿌·루리웹 유저 핫딜). 에펨코리아는 robots.txt가 막아 제외.
// - 쿠팡 상품 글만 골라 제목·가격 단서·쿠팡 상품 주소·게시글 주소를 관리 화면에만 보낸다 (공개 응답에는 없음).
// - 다른 사람의 제휴 링크(link.coupang.com)는 저장하지 않는다. 상품 주소를 찾지 못하면 '직접 찾기 필요'로만 표시.
// - 같은 사이트 요청 사이 1.5초, 한 번에 게시글 페이지는 최대 6개, 이미 본 글은 다시 열지 않는다.
// 사용: node src/online/leads.js   (APPS_SCRIPT_URL · COLLECTOR_TOKEN 필요, LEADS_MODE=dry면 시트에 쓰지 않음)
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OD_LEAD_SOURCES, odLeadInput, odLeadPrice } from '../online-deals-core.js';
import { createHttpClient, safeError } from './http.js';
import { robotsAllows, BOT_NAME } from '../robots.js';
import { SheetClient } from '../sheet.js';

export const LEAD_FEEDS = [
  { source: 'ppomppu', url: 'https://www.ppomppu.co.kr/rss.php?id=ppomppu' },
  { source: 'ruliweb', url: 'https://bbs.ruliweb.com/market/board/1020/rss' },
];
export const LEAD_HOSTS = Object.values(OD_LEAD_SOURCES).flatMap(s => s.hosts);
export const leadUserAgent = (contact = process.env.BOT_CONTACT_URL || 'https://github.com/among-kr') => `Mozilla/5.0 (compatible; ${BOT_NAME}/0.2; +${contact})`;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const tag = (xml, name) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  if (!m) return '';
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(m[1]);
  return cdata ? cdata[1] : decodeEntities(m[1]);
};

/** RSS 2.0 → [{ title, link, description, pubDate }] (XML 라이브러리 없이, 항목 50개까지) */
export function parseRss(xml) {
  const items = [];
  const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(String(xml || ''))) && items.length < 50) {
    items.push({ title: decodeEntities(tag(m[1], 'title')).replace(/\s+/g, ' ').trim(), link: tag(m[1], 'link').trim(), description: tag(m[1], 'description'), pubDate: tag(m[1], 'pubDate').trim() });
  }
  return items;
}

/** 쿠팡 상품 글인가: 제목에 [쿠팡]·쿠팡) 같은 판매처 표시, 또는 본문 미리보기에 쿠팡 주소 */
export function isCoupangDeal(item) {
  return /^\s*[[(（【]?\s*쿠팡\s*[\])）】:]/.test(item.title || '') || /\bcoupang\.com\//i.test(item.description || '');
}

/** 게시글 번호 (뽐뿌 no=, 루리웹 /read/) */
export function postId(source, url) {
  const m = source === 'ppomppu' ? /[?&]no=(\d{1,12})\b/.exec(url || '') : /\/read\/(\d{1,12})\b/.exec(url || '');
  return m ? m[1] : null;
}

/**
 * 글·HTML에서 쿠팡 상품 주소를 찾는다. 상품 번호·옵션 번호만 남긴 공식 주소로 바꾸고, 추적 값은 버린다.
 * 다른 사람의 제휴 단축 링크(link.coupang.com)만 있으면 주소는 비우고 affiliateOnly.
 */
export function findCoupangUrl(text) {
  const s = decodeEntities(String(text || ''));
  const re = /https?:\/\/(?:www\.|m\.)?coupang\.com\/vp\/products\/(\d{1,15})([^\s"'<>]*)/gi;
  const m = re.exec(s);
  if (m) {
    const q = m[2] || '';
    const item = /[?&]itemId=(\d{1,15})/.exec(q), vendor = /[?&]vendorItemId=(\d{1,15})/.exec(q);
    return { url: `https://www.coupang.com/vp/products/${m[1]}${item ? `?itemId=${item[1]}${vendor ? `&vendorItemId=${vendor[1]}` : ''}` : ''}`, affiliateOnly: false };
  }
  return { url: '', affiliateOnly: /https?:\/\/link\.coupang\.com\//i.test(s) };
}

const isoOf = v => { const t = Date.parse(v || ''); return Number.isFinite(t) ? new Date(t).toISOString() : ''; };

/**
 * 후보 찾기. known: 이미 저장된 후보 key 목록(다시 열지 않음).
 * robots: (url) => Promise<{allowed, reason}> — 기본은 robots.js (AI 수집 거부도 따름)
 */
export async function findLeads({ http, robots = url => robotsAllows(url), known = [], now = Date.now(), maxPosts = 6, feeds = LEAD_FEEDS, log = () => {} } = {}) {
  const seen = new Set(known);
  const leads = [], stats = [];
  let posts = 0;
  for (const feed of feeds) {
    const st = { source: feed.source, items: 0, coupang: 0, added: 0, error: '' };
    stats.push(st);
    try {
      const ok = await robots(feed.url);
      if (!ok.allowed) { st.error = `robots: ${ok.reason}`; continue; }
      const items = parseRss((await http.request(feed.url, { headers: { 'user-agent': leadUserAgent() } })).text);
      st.items = items.length;
      for (const item of items.filter(isCoupangDeal)) {
        st.coupang++;
        const id = postId(feed.source, item.link);
        if (!id) continue;
        const key = `${feed.source}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let found = findCoupangUrl(item.description);
        // 미리보기에 상품 주소가 없으면 게시글 페이지 한 번 (robots 확인, 한 번에 최대 maxPosts개)
        if (!found.url && posts < maxPosts) {
          const allowed = await robots(item.link);
          if (allowed.allowed) {
            posts++;
            try { found = findCoupangUrl((await http.request(item.link, { headers: { 'user-agent': leadUserAgent() } })).text); }
            catch (e) { log(`${feed.source} 게시글 열기 실패: ${safeError(e)}`); }
          }
        }
        const lead = odLeadInput({
          key, source: feed.source, title: item.title, postUrl: item.link, coupangUrl: found.url, affiliateOnly: found.affiliateOnly,
          priceHint: odLeadPrice(item.title), freeShipping: /무료\s*배송|무배|\/\s*무료|무료\s*\)/.test(item.title), postedAt: isoOf(item.pubDate),
        }, now);
        if (lead) { leads.push(lead); st.added++; }
      }
    } catch (e) { st.error = safeError(e); }
    log(`${OD_LEAD_SOURCES[feed.source].name}: 글 ${st.items}개 · 쿠팡 ${st.coupang}개 · 새 후보 ${st.added}개${st.error ? ` · ${st.error}` : ''}`);
  }
  return { leads, stats, posts };
}

export async function runLeads({ api, dry = false, httpFactory = createHttpClient, robots, now = () => Date.now(), log = () => {} } = {}) {
  const known = dry ? [] : (await api.post('online_leads_known')).keys || [];
  const http = httpFactory({ allowedHosts: LEAD_HOSTS, minIntervalMs: 1500, timeoutMs: 15000, maxRetries: 1, maxBytes: 2_000_000 });
  const out = await findLeads({ http, robots, known, now: now(), log });
  if (!dry && out.leads.length) out.saved = await api.post('online_leads_ingest', { leads: out.leads });
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dry = process.env.LEADS_MODE === 'dry';
  try {
    const api = dry ? null : new SheetClient(process.env.APPS_SCRIPT_URL, process.env.COLLECTOR_TOKEN);
    const out = await runLeads({ api, dry, log: m => console.log(m) });
    const lines = [`### 쿠팡 특가 후보 찾기${dry ? ' (시험 — 시트에 쓰지 않음)' : ''}`, '', '| 게시판 | 글 | 쿠팡 글 | 새 후보 | 비고 |', '| --- | --- | --- | --- | --- |',
      ...out.stats.map(s => `| ${OD_LEAD_SOURCES[s.source].name} | ${s.items} | ${s.coupang} | ${s.added} | ${s.error} |`), '',
      `게시글 페이지 ${out.posts}개 확인 · 저장 ${out.saved ? `${out.saved.added}개 추가` : '없음'}. 후보는 관리 화면에만 보이며 공개 화면에 올라가지 않습니다.`];
    if (dry) for (const l of out.leads) lines.push(`- ${l.title} → ${l.coupangUrl || (l.affiliateOnly ? '(남의 제휴 링크만 있음)' : '(상품 주소 못 찾음)')}`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
    console.log(lines.join('\n'));
    // 게시판 하나가 실패해도 실행은 성공으로 끝낸다 (다음 시간에 다시). 모두 실패하면 알 수 있게 실패로.
    if (out.stats.every(s => s.error)) process.exit(1);
  } catch (e) {
    console.error('후보 찾기 실패:', safeError(e) === 'adapter_error' ? e.message.slice(0, 200) : safeError(e));
    process.exit(1);
  }
}
