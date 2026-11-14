import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { robotsAllows, BOT_NAME } from './robots.js';
import { decodeBody } from './online/http.js';
import { decodeArtworkUrl, encodeArtworkUrl } from './artwork-meta.js';

// Public publisher RSS, not search-result HTML. Individual release/photo checks still apply.
export const DEFAULT_ARTWORK_FEEDS = [
  'https://www.smdnewsroom.co.kr/feed/',
  'https://api.newswire.co.kr/rss/industry/916',
  'https://api.newswire.co.kr/rss/industry/912',
];
const PRESSROOMS = new Set(['smdnewsroom.co.kr', 'www.smdnewsroom.co.kr', 'www.newswire.co.kr', 'newswire.co.kr']);
const DAY = 86400000;
const compact = s => String(s || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
const ALIASES = [['쉐이크쉑', '쉑쉑', 'shakeshack'], ['파스쿠찌', 'pascucci'], ['한스케익', '한스케이크', 'hans'], ['네이버페이', 'npay', 'naverpay']];
function brandWords(brand) {
  const word = compact(brand);
  return [...new Set([word, ...(ALIASES.find(g => g.map(compact).includes(word)) || []).map(compact)])].filter(Boolean);
}
const hasBrand = (text, brand) => brandWords(brand).some(w => compact(text).includes(w));
function entities(s) {
  return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => { const cp = parseInt(n[0].toLowerCase() === 'x' ? n.slice(1) : n, n[0].toLowerCase() === 'x' ? 16 : 10); return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''; })
    .replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g, m => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' })[m]);
}
const plain = s => entities(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = entities(m[2] ?? m[3] ?? m[4]);
  return out;
}
function publicAddress(address) {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
  }
  // Only global-unicast IPv6; exclude mapped addresses and transition/tunnel ranges.
  return isIP(ip) === 6 && /^[23]/.test(ip) && !/^200[12]:/.test(ip) && !/^2001:db8:/.test(ip);
}
function safeUrl(value, base) {
  const u = new URL(value, base);
  const host = u.hostname.toLowerCase().replace(/\.+$/, '');
  u.hostname = host;
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.href.length > 4096
    || !host.includes('.') && !isIP(host.replace(/^\[|\]$/g, ''))
    || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
    || /(?:^|\.)(?:blog|cafe)\.naver\.com$/.test(host)
    || (isIP(host.replace(/^\[|\]$/g, '')) && !publicAddress(host))) throw new Error('unsafe_url');
  u.hash = '';
  return u;
}
function pinnedFetch(url, options, addresses) {
  // Pin the socket to the addresses validated above; fetch's second DNS lookup could rebind.
  return new Promise((resolve, reject) => {
    const resolved = addresses.map(a => ({ address: a.address, family: a.family || isIP(a.address) }));
    const req = httpsRequest(url, {
      method: 'GET', headers: options.headers, signal: options.signal, agent: false,
      lookup: (_host, config, callback) => config.all ? callback(null, resolved) : callback(null, resolved[0].address, resolved[0].family),
    }, res => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(res.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      resolve(new Response([204, 205, 304].includes(res.statusCode) ? null : Readable.toWeb(res), { status: res.statusCode, headers }));
    });
    req.on('error', reject);
    req.end();
  });
}
async function cappedBody(res, maxBytes) {
  if (Number(res.headers.get('content-length')) > maxBytes) throw new Error('response_too_large');
  const chunks = []; let size = 0;
  if (!res.body?.getReader) {
    const b = Buffer.from(await res.arrayBuffer());
    if (b.length > maxBytes) throw new Error('response_too_large');
    return b;
  }
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('response_too_large');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally { try { await reader.cancel(); } catch { /* closed */ } }
}
function createReader({ fetchImpl, lookup, robotsCheck, maxRequests, timeoutMs, deadline, summary }) {
  const cache = new Map(); const dns = new Map();
  async function rawFetch(input, options = {}) {
    let url = safeUrl(input);
    for (let hop = 0; hop < 4; hop++) {
      if (summary.requests >= maxRequests) throw new Error('request_budget');
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('time_budget');
      summary.requests++;
      const controller = new AbortController();
      let timer;
      try {
        const result = await Promise.race([
          (async () => {
            const host = url.hostname.replace(/^\[|\]$/g, '');
            if (!dns.has(host)) dns.set(host, isIP(host) ? Promise.resolve([{ address: host }]) : lookup(host, { all: true, verbatim: true }));
            const addresses = await dns.get(host);
            if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('unsafe_address');
            const requestOptions = { headers: { 'User-Agent': BOT_NAME, ...options.headers }, redirect: 'manual', signal: controller.signal };
            const res = await (fetchImpl ? fetchImpl(url.href, requestOptions) : pinnedFetch(url.href, requestOptions, addresses));
            if ([301, 302, 303, 307, 308].includes(res.status)) {
              const next = safeUrl(res.headers.get('location') || '', url.href);
              try { await res.body?.cancel(); } catch { /* closed */ }
              if (options.checkRedirectRobots) {
                const allowed = await robotsCheck(next.href, { fetchImpl: rawFetch, timeoutMs });
                if (!(typeof allowed === 'boolean' ? allowed : allowed?.allowed)) throw new Error('robots_denied');
              }
              return { redirectTo: next };
            }
            const bytes = await cappedBody(res, 2 * 1024 * 1024);
            const response = new Response([204, 205, 304].includes(res.status) ? null : bytes, { status: res.status, headers: res.headers });
            Object.defineProperty(response, 'url', { value: url.href });
            return response;
          })(),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('request_timeout')); }, Math.min(timeoutMs, remaining)); }),
        ]);
        if (result.redirectTo) { url = result.redirectTo; continue; }
        return result;
      } finally { clearTimeout(timer); }
    }
    throw new Error('too_many_redirects');
  }
  const request = rawFetch;
  async function read(url, kind) {
    const clean = safeUrl(url).href;
    const key = kind + ':' + clean;
    if (!cache.has(key)) cache.set(key, (async () => {
      const allowed = await robotsCheck(clean, { fetchImpl: request, timeoutMs });
      if (!(typeof allowed === 'boolean' ? allowed : allowed?.allowed)) throw new Error('robots_denied');
      const res = await request(clean, { checkRedirectRobots: true });
      if (!res?.ok) throw new Error('http_error');
      const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (kind === 'image' ? !/^image\/(?:jpeg|png|webp|gif)$/.test(mime) : !/^(?:text\/(?:html|xml)|application\/(?:rss\+xml|atom\+xml|xml|xhtml\+xml))$/.test(mime)) throw new Error('unexpected_mime');
      const bytes = Buffer.from(await res.arrayBuffer());
      if (kind === 'image') {
        const signature = bytes.subarray(0, 12);
        const valid = mime === 'image/png' ? signature.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
          : mime === 'image/jpeg' ? signature[0] === 255 && signature[1] === 216 && signature[2] === 255
            : mime === 'image/gif' ? /^GIF8[79]a/.test(signature.toString('ascii'))
              : signature.toString('ascii', 0, 4) === 'RIFF' && signature.toString('ascii', 8, 12) === 'WEBP';
        if (!valid || bytes.length < 1024) throw new Error('invalid_image');
        return { url: res.url };
      }
      return { url: res.url, text: decodeBody(bytes, res.headers.get('content-type')) };
    })());
    return cache.get(key);
  }
  return read;
}
function feedEntries(xml, base) {
  return [...xml.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)].slice(0, 100).map(m => {
    const text = m[1];
    const link = /<link\b[^>]*>([\s\S]*?)<\/link>/i.exec(text)?.[1] || attrs(/<link\b[^>]*>/i.exec(text)?.[0] || '').href;
    try { return { url: safeUrl(entities(link || '').trim(), base).href, text: plain(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1] || ''), published: plain(/<(?:pubDate|published)\b[^>]*>([\s\S]*?)<\/(?:pubDate|published)>/i.exec(text)?.[1] || '') }; }
    catch { return null; }
  }).filter(Boolean);
}
function articleCandidate(html, url, item, entry, now, maxAgeDays) {
  const metas = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) { const a = attrs(m[0]); metas[(a.property || a.name || '').toLowerCase()] = a.content || ''; }
  const title = plain(metas['og:title'] || /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]);
  if (!hasBrand(title, item.brand)) return null;
  const published = Date.parse(metas['article:published_time'] || metas.pubdate || /"datePublished"\s*:\s*"([^"]+)"/.exec(html)?.[1] || entry.published || '');
  if (!Number.isFinite(published) || published > now.getTime() + DAY || now.getTime() - published > maxAgeDays * DAY) return null;
  const body = (/<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] || html)
    .replace(/<(script|style|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const bodyText = plain(body);
  if (/(?:AI|인공지능|생성형)\s*(?:생성|제작|이미지|그림)|(?:생성|제작)\s*(?:AI|인공지능)|AI[- ]generated|일러스트\s*[:=]/i.test(bodyText)) return null;
  // A current product photo can illustrate a brand; another campaign's discount poster cannot.
  const benefits = text => [...String(text).matchAll(/\d+\s*%|[1-9]\s*\+\s*[1-9]|무료|반값|증정/g)].map(m => compact(m[0]));
  const headlineBenefits = benefits(title);
  if (headlineBenefits.length) {
    const wanted = benefits(`${item.title || ''} ${item.discount_label || ''} ${item.summary || ''}`);
    const end = item.end_date || '';
    const [, month, day] = end.split('-');
    const endMentioned = bodyText.includes(end) || new RegExp(`${Number(month)}\\s*월\\s*${Number(day)}\\s*일`).test(bodyText);
    if (!endMentioned || headlineBenefits.some(b => !wanted.includes(b))) return null;
  }
  const newsroom = PRESSROOMS.has(new URL(url).hostname);
  const matches = [];
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const src = a['data-src'] || a['data-original'] || a.src;
    const near = plain(body.slice(Math.max(0, m.index - 180), Math.min(body.length, m.index + m[0].length + 600)));
    const described = `${a.alt || ''} ${a.title || ''} ${near}`;
    if (!src || /logo|favicon|sprite|avatar|icon|advert|pixel|tracking/i.test(src + ' ' + (a.alt || ''))
      || /AI[- ]generated|인공지능|AI\s*(?:생성|제작|이미지)|일러스트/i.test(described)
      || (a.width && Number(a.width) < 200) || (a.height && Number(a.height) < 120)) continue;
    const imageBenefits = benefits(`${a.alt || ''} ${a.title || ''}`);
    if (imageBenefits.length && !headlineBenefits.length) continue;
    if ([...`${title} ${a.alt || ''}`.matchAll(/(20\d{2})\s*(?:년|[./-]\d{1,2})/g)].some(m => Number(m[1]) < now.getFullYear())) continue;
    const creditMatch = /(?:사진|이미지|자료)\s*[:=／/]\s*([^.!<>]{2,70})|([^.!<>]{2,50})\s*(?:사진\s*)?제공/i.exec(near);
    const creditText = creditMatch ? plain(creditMatch[0]) : '';
    const creditedBrand = hasBrand(creditText, item.brand) || /SPC|에스피씨|상미당/i.test(creditText) && /쉐이크쉑|쉑쉑|파스쿠찌/.test(item.brand);
    if (!creditedBrand && !newsroom) continue;
    if (newsroom && !hasBrand(described, item.brand) && !hasBrand(a.alt, item.brand)) continue;
    try {
      const image = safeUrl(src, url).href;
      matches.push({ url: image, credit: creditText || `${item.brand} 공식 보도자료`, score: (creditedBrand ? 5 : 0) + (hasBrand(a.alt, item.brand) ? 3 : 0) + (image === metas['og:image'] ? 2 : 0) });
    } catch { /* unsafe image */ }
  }
  return matches.sort((a, b) => b.score - a.score)[0] || null;
}
function eligible(item, today) {
  return !['rejected', 'expired', 'deleted', 'hidden', 'gone', 'archived', 'disabled'].includes(item.status) && /^\d{4}-\d{2}-\d{2}$/.test(item.end_date || '') && item.end_date >= today && Boolean(item.brand);
}
function canReplace(item) {
  const { meta } = decodeArtworkUrl(item.image_url);
  return !item.image_url || (meta?.kind || item.image_kind) === 'official_related';
}
function applyImage(item, image, meta) {
  return { ...item, image_url: encodeArtworkUrl(image, meta), image_kind: meta.kind, image_source_url: meta.source, image_checked_at: meta.checkedAt, image_credit: meta.credit };
}

/** Add only verified, recent, brand-supplied press photography; never change event facts. */
export async function resolveEventArtwork(news, options = {}) {
  const { pages = [], press = null, feeds = DEFAULT_ARTWORK_FEEDS, knownNews = [], fetchImpl, lookup = dnsLookup, robotsCheck = robotsAllows } = options;
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const today = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const maxItems = Math.min(8, Math.max(0, options.maxItems ?? 8));
  const maxArticles = Math.min(2, Math.max(0, options.maxArticles ?? 2));
  const deadline = Date.now() + Math.max(0, Math.min(60000, options.budgetMs ?? 60000));
  const summary = { checked: 0, filled: 0, reused: 0, preserved: 0, requests: 0, feedsRead: 0, articlesRead: 0, searchConnected: Boolean(press?.connected && press.search), missing: [], errors: [] };
  const result = news.map(n => ({ ...n }));
  const read = createReader({ fetchImpl, lookup, robotsCheck, maxRequests: Math.min(64, options.maxRequests ?? 48), timeoutMs: Math.min(15000, options.timeoutMs ?? 7000), deadline, summary });
  const failures = (stage, error) => { if (summary.errors.length < 12) summary.errors.push({ stage, reason: /^[a-z_]+$/.test(error?.message || '') ? error.message : 'request_failed' }); };
  const targets = [];
  for (let i = 0; i < result.length; i++) {
    const item = result[i];
    if (!eligible(item, today) || !canReplace(item)) { summary.preserved++; continue; }
    const previous = knownNews.find(n => ['id', 'brand', 'start_date', 'end_date'].every(k => (n[k] || '') === (item[k] || '')));
    const previousImage = decodeArtworkUrl(previous?.image_url);
    if (previousImage.meta?.kind?.startsWith('press_')) {
      try { safeUrl(previousImage.url); safeUrl(previousImage.meta.source); result[i] = applyImage(item, previousImage.url, previousImage.meta); summary.reused++; continue; } catch { /* recheck */ }
    }
    if (targets.length < maxItems) targets.push(i);
  }
  if (!targets.length || !maxArticles) return { news: result, summary };
  const entries = [];
  for (const url of feeds.slice(0, 3)) {
    if (Date.now() >= deadline) break;
    try { const feed = await read(url, 'text'); entries.push(...feedEntries(feed.text, feed.url)); summary.feedsRead++; }
    catch (error) { failures('feed', error); }
  }
  for (const index of targets) {
    if (Date.now() >= deadline) { failures('budget', new Error('time_budget')); break; }
    const item = result[index]; summary.checked++;
    let candidates = entries.filter(e => hasBrand(e.text, item.brand));
    for (const page of pages.filter(p => p.source_id === item.source_id || p.brand === item.brand)) {
      for (const link of (page.links || []).slice(0, 10)) {
        const url = typeof link === 'string' ? link : link.href;
        const text = typeof link === 'string' ? page.title : link.text;
        if (url && hasBrand(text, item.brand)) candidates.push({ url, text, published: '' });
      }
    }
    if (summary.searchConnected) {
      let timer;
      try {
        const hits = await Promise.race([
          press.search(`${item.brand} ${String(item.title || '').slice(0, 80)}`),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('request_timeout')), Math.max(1, Math.min(7000, deadline - Date.now()))); }),
        ]);
        if (Array.isArray(hits)) candidates.push(...hits.slice(0, 20));
      } catch (error) { failures('search', error); }
      finally { clearTimeout(timer); }
    }
    candidates = [...new Map(candidates.filter(e => {
      const published = Date.parse(e?.published || '');
      return e?.url && hasBrand(e.text || e.title, item.brand) && (!Number.isFinite(published) || published <= now.getTime() + DAY && now.getTime() - published <= 45 * DAY);
    }).map(e => [e.url, e])).values()].slice(0, maxArticles);
    let found = false;
    for (const entry of candidates) {
      try {
        const article = await read(entry.url, 'text'); summary.articlesRead++;
        const candidate = articleCandidate(article.text, article.url, item, entry, now, 45);
        if (!candidate) continue;
        const image = await read(candidate.url, 'image');
        const meta = { kind: 'press_related', source: article.url, checkedAt: now.toISOString(), credit: candidate.credit };
        result[index] = applyImage(item, image.url, meta); summary.filled++; found = true; break;
      } catch (error) { failures('article', error); }
    }
    if (!found) summary.missing.push(item.id);
  }
  return { news: result, summary };
}
