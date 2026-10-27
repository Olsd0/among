// 공개 공식 페이지 렌더링 (Playwright, 모바일 폭 430px)
// - 로그인 영역, 앱 내부 API, 비공개 경로는 다루지 않는다 (D7)
// - robots.txt 확인 후 접속, 페이지 사이 간격을 둬 부담을 줄인다 (저빈도)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { robotsAllows, BOT_NAME } from './robots.js';

export const VIEWPORT = { width: 430, height: 932 };
const SHOT_HEIGHT = 1600;
const MAX_TEXT = 30000;

export function userAgent(contact = process.env.BOT_CONTACT_URL || 'https://github.com/among-kr') {
  return `Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 ${BOT_NAME}/0.2 (+${contact})`;
}

export async function openBrowser() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    locale: 'ko-KR', timezoneId: 'Asia/Seoul', userAgent: userAgent(),
  });
  await context.route('**/*', (route) => (route.request().resourceType() === 'media' ? route.abort() : route.continue()));
  return { browser, context, close: () => browser.close() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function autoScroll(page, maxSteps = 25) {
  for (let i = 0; i < maxSteps; i++) {
    const done = await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
      return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    });
    await sleep(350);
    if (done) break;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * 한 페이지를 렌더링해 텍스트·이미지 대체텍스트·스크린샷·링크를 돌려준다.
 * opts: { selector, exclude, follow, followText, maxShots, outDir, waitMs }
 */
export async function renderPage(ctx, url, opts = {}) {
  const robots = await robotsAllows(url);
  if (!robots.allowed) throw Object.assign(new Error(`${url}: ${robots.reason}`), { code: 'ROBOTS' });

  const page = await ctx.context.newPage();
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const status = res ? res.status() : 0;
    if (status >= 400) throw Object.assign(new Error(`${url}: HTTP ${status}`), { code: 'HTTP' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    if (opts.waitMs) await sleep(opts.waitMs);
    await autoScroll(page);

    const selector = opts.selector || 'body';
    const root = await page.$(selector);
    if (!root) throw Object.assign(new Error(`${url}: selector "${selector}" 없음`), { code: 'SELECTOR' });

    const data = await page.evaluate(({ selector, exclude, follow }) => {
      const el = document.querySelector(selector);
      const clone = el.cloneNode(true);
      for (const sel of exclude || []) clone.querySelectorAll(sel).forEach((n) => n.remove());
      clone.querySelectorAll('script,style,noscript,svg').forEach((n) => n.remove());
      // innerText는 렌더링된 노드에서만 정확하므로, 제외 대상만 숨긴 원본에서 읽는다
      const hidden = [];
      for (const sel of exclude || []) el.querySelectorAll(sel).forEach((n) => { hidden.push([n, n.style.display]); n.style.display = 'none'; });
      const text = el.innerText;
      hidden.forEach(([n, d]) => { n.style.display = d; });
      const alts = [...el.querySelectorAll('img[alt]')].map((i) => i.alt.trim()).filter((a) => a.length > 3);
      // 링크 글자(이미지 링크면 대체텍스트)도 함께 — follow_text로 '우리가 다루는 브랜드' 링크만 고르기 위해
      const links = follow ? [...document.querySelectorAll(follow)].map((a) => ({
        href: a.href,
        text: [a.innerText, a.getAttribute('title'), a.getAttribute('aria-label'), ...[...a.querySelectorAll('img[alt]')].map((i) => i.alt)].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
      })).filter((l) => l.href) : [];
      return { title: document.title, text, alts: [...new Set(alts)], links };
    }, { selector, exclude: opts.exclude || [], follow: opts.follow || '' });

    let text = data.text.replace(/\n{3,}/g, '\n\n').trim();
    if (data.alts.length) text += '\n\n[이미지 대체텍스트]\n' + data.alts.join('\n');
    if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + '\n…(이하 생략)';

    const screenshots = await takeShots(page, root, selector, opts.maxShots ?? 4);
    if (opts.outDir) {
      mkdirSync(opts.outDir, { recursive: true });
      screenshots.forEach((s, i) => writeFileSync(join(opts.outDir, `${opts.name || 'page'}_${i + 1}.jpg`), s.buffer));
    }

    const textRe = opts.followText ? new RegExp(opts.followText, 'i') : null;
    const links = [...new Set(data.links
      .filter((l) => sameSite(l.href, page.url()))
      .filter((l) => !textRe || textRe.test(l.text) || textRe.test(decodeURIComponent(l.href)))
      .map((l) => l.href))];
    return {
      url, finalUrl: page.url(), status, title: data.title, text, links,
      screenshots: screenshots.map(({ base64 }) => ({ media_type: 'image/jpeg', data: base64 })),
    };
  } finally {
    await page.close();
  }
}

async function takeShots(page, root, selector, maxShots) {
  if (!maxShots) return [];
  const box = selector === 'body' ? null : await root.boundingBox();
  const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const top = box ? Math.max(0, Math.floor(box.y)) : 0;
  const bottom = box ? Math.ceil(box.y + box.height) : fullHeight;
  const shots = [];
  for (let y = top; y < bottom && shots.length < maxShots; y += SHOT_HEIGHT) {
    const height = Math.min(SHOT_HEIGHT, bottom - y);
    if (height < 80) break;
    const buffer = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 70, clip: { x: 0, y, width: VIEWPORT.width, height } });
    shots.push({ buffer, base64: buffer.toString('base64') });
  }
  return shots;
}

/**
 * 출처 1개 수집: 목록 페이지 + (follow 설정 시) 상세 페이지 최대 max_follow개.
 * @returns {Promise<Array<page>>}
 */
export async function collectSource(ctx, source, { outDir, delayMs = 1500 } = {}) {
  const opts = {
    selector: source.selector || undefined,
    exclude: splitList(source.exclude),
    follow: source.follow || '',
    followText: source.follow_text || '',
    maxShots: source.max_shots === '' || source.max_shots === undefined ? 4 : +source.max_shots,
    waitMs: +source.wait_ms || 0,
    outDir, name: source.id,
  };
  const first = await renderPage(ctx, source.url, opts);
  const pages = [first];
  const limit = source.max_follow === '' || source.max_follow === undefined ? 6 : +source.max_follow;
  const seen = new Set([first.finalUrl, source.url]);
  const detailSelector = source.detail_selector || undefined;
  for (const link of first.links) {
    if (pages.length - 1 >= limit) break;
    if (seen.has(link)) continue;
    seen.add(link);
    await sleep(delayMs);
    try {
      pages.push(await renderPage(ctx, link, { ...opts, follow: '', selector: detailSelector, name: `${source.id}_d${pages.length}` }));
    } catch (e) {
      pages.push({ url: link, error: e.message });
    }
  }
  return pages;
}

/** 같은 사이트인지 (www.burgerking.co.kr ↔ event.burgerking.co.kr 허용, 다른 도메인 차단) */
export function sameSite(a, b) {
  try {
    const key = (h) => {
      const p = new URL(h).hostname.split('.');
      const n = /^(co|or|go|ac|ne|re)$/.test(p.at(-2)) && p.at(-1).length === 2 ? 3 : 2;
      return p.slice(-n).join('.');
    };
    return /^https?:/.test(a) && key(a) === key(b);
  } catch { return false; }
}

export function splitList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return String(v).split(/\s*;\s*|\n/).filter(Boolean);
}
