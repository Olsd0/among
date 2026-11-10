// 기간 팩트체크용 언론 기사 검색·읽기 (11/10 대표 결정)
// - 검색: 네이버 뉴스 검색 API. 2026-07-31부터 새 신청은 NAVER API HUB(네이버클라우드)로만 →
//   GitHub Secrets NAVER_API_KEY_ID / NAVER_API_KEY (HUB 콘솔에서 대표가 발급·등록). 예전 개발자센터 키(NAVER_CLIENT_ID/SECRET)도 2027-06-30까지 지원.
//   키가 없으면 '연결 안 됨' — 연결된 것처럼 보고하지 않는다.
// - Gemini의 Google 검색 그라운딩은 쓰지 않는다: 약관상 결과 링크로 크롤링할 페이지를 찾거나 결과를 자동으로 수집하는 것이 금지되고,
//   결과는 검색 제안과 함께 질문한 사용자에게만 보여 줘야 한다(Gemini API 추가 약관 'Grounding with Google Search').
// - 기사 본문은 robots.txt가 허용할 때만 읽고, 기간을 찾는 데만 쓴다(저장·표시하지 않음).
import { robotsAllows, BOT_NAME } from './robots.js';
import { decodeBody } from './online/http.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'");
const UA = (contact = process.env.BOT_CONTACT_URL || 'https://github.com/among-kr') => `Mozilla/5.0 (compatible; ${BOT_NAME}/0.2; +${contact})`;

export const NAVER_HUB_NEWS = 'https://naverapihub.apigw.ntruss.com/search/v1/news';
export const NAVER_LEGACY_NEWS = 'https://openapi.naver.com/v1/search/news.json';

/** env에서 기사 검색 연결을 만든다. 키가 없으면 { connected: false } */
export function pressFromEnv(env = process.env, { fetchImpl = fetch, gapMs = 1000 } = {}) {
  if (env.PERIOD_PRESS === 'off') return { connected: false, name: '꺼 둠 (PERIOD_PRESS=off)' };
  if (env.NAVER_API_KEY_ID && env.NAVER_API_KEY) {
    return naverPress({ url: NAVER_HUB_NEWS, headers: { 'X-NCP-APIGW-API-KEY-ID': env.NAVER_API_KEY_ID, 'X-NCP-APIGW-API-KEY': env.NAVER_API_KEY }, name: '네이버 뉴스 검색 API (NAVER API HUB)', fetchImpl, gapMs });
  }
  if (env.NAVER_CLIENT_ID && env.NAVER_CLIENT_SECRET) {
    return naverPress({ url: NAVER_LEGACY_NEWS, headers: { 'X-Naver-Client-Id': env.NAVER_CLIENT_ID, 'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET }, name: '네이버 뉴스 검색 API (개발자센터)', fetchImpl, gapMs });
  }
  return { connected: false, name: '연결 안 됨 (네이버 뉴스 검색 키 없음)' };
}

export function naverPress({ url, headers, name, fetchImpl = fetch, gapMs = 1000 }) {
  let last = 0;
  return {
    connected: true, name,
    async search(query) {
      const wait = last + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const res = await fetchImpl(`${url}?query=${encodeURIComponent(query)}&display=20&start=1&sort=sim`, { headers, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`네이버 뉴스 검색 ${res.status}: ${(await res.text()).slice(0, 120)}`);
      const j = await res.json();
      return (j.items || []).map((it) => ({
        url: it.originallink || it.link,
        published: Number.isFinite(Date.parse(it.pubDate)) ? new Date(it.pubDate).toISOString() : '',
        text: `${strip(it.title)} ${strip(it.description)}`,
      })).filter((a) => /^https?:\/\//.test(a.url));
    },
    read: (u) => readArticle(u, { fetchImpl }),
  };
}

/** 기사 HTML → 게시일·본문 글자 (robots.txt가 막으면 읽지 않음) */
export async function readArticle(url, { fetchImpl = fetch, maxBytes = 2_000_000 } = {}) {
  const r = await robotsAllows(url, { fetchImpl });
  if (!r.allowed) throw new Error(`${new URL(url).hostname}: ${r.reason}`);
  const res = await fetchImpl(url, { headers: { 'user-agent': UA() }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`기사 ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error('기사가 너무 큼');
  return articleFromHtml(decodeBody(buf, res.headers.get('content-type') || ''));
}

export function articleFromHtml(html) {
  const s = String(html || '');
  const meta = (re) => (s.match(re) || [])[1] || '';
  const published = meta(/<meta[^>]+(?:property|name|itemprop)=["'](?:article:published_time|og:article:published_time|datePublished|pubdate|publish-date)["'][^>]+content=["']([^"']+)["']/i)
    || meta(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["'](?:article:published_time|og:article:published_time|datePublished)["']/i)
    || meta(/"datePublished"\s*:\s*"([^"]+)"/);
  const text = strip(s.replace(/<(script|style|noscript|svg|nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n'))
    .replace(/\s+/g, ' ').trim().slice(0, 20000);
  return { published: Number.isFinite(Date.parse(published)) ? new Date(published).toISOString() : '', text };
}
