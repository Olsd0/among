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
      // 공지 이미지 후보 (주소·대체텍스트·크기·주변 글만 — 이미지 파일은 받지도 저장하지도 않음)
      // nearLen: 주변 글 전체 길이 — 카드 하나 분량인지(목록 전체가 아닌지) 판단용
      const nearText = (img) => {
        let p = img.parentElement;
        for (let k = 0; p && k < 5; k++, p = p.parentElement) {
          const t = (p.innerText || '').replace(/\s+/g, ' ').trim();
          if (t.length >= 4) return [t.slice(0, 160), t.length];
        }
        return ['', 0];
      };
      const images = [...el.querySelectorAll('img')].slice(0, 300)
        .map((i) => { const [near, nearLen] = nearText(i); return { src: i.currentSrc || i.src || '', alt: (i.alt || i.title || '').trim().slice(0, 80), w: i.naturalWidth || 0, h: i.naturalHeight || 0, near, nearLen }; })
        .filter((x) => x.src && x.w >= 150 && x.h >= 100)
        .slice(0, 60);
      const og = document.querySelector('meta[property="og:image"], meta[name="og:image"], meta[property="og:image:url"]');
      let ogImage = '';
      try { ogImage = og && og.content ? new URL(og.content, location.href).href : ''; } catch (e) { ogImage = ''; }
      return { title: document.title, text, alts: [...new Set(alts)], links, images, ogImage };
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
      url, finalUrl: page.url(), status, title: data.title, text, links, images: data.images || [], ogImage: data.ogImage || '',
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
      const d = await renderPage(ctx, link, { ...opts, follow: '', selector: detailSelector, name: `${source.id}_d${pages.length}` });
      d.isDetail = true;
      // 목록 페이지와 같은 og:image는 사이트 기본 공유 이미지(대개 로고) → 행사 사진이 아님
      if (d.ogImage && d.ogImage === first.ogImage) d.ogImage = '';
      pages.push(d);
    } catch (e) {
      pages.push({ url: link, error: e.message });
    }
  }
  return dropCommonOg(pages);
}

/**
 * 상세 페이지 여러 곳에 똑같이 붙은 공유 이미지(og:image)는 행사 이미지가 아니라 사이트 공통 그림이다 → 뗀다.
 * (11/03 맥도날드: 프로모션 상세마다 og:image가 '앱 다운로드' 배너라 '해피 스낵' 공지에 잘못 붙음)
 */
export function dropCommonOg(pages = []) {
  const count = new Map();
  for (const p of pages) if (p && p.isDetail && p.ogImage) count.set(p.ogImage, (count.get(p.ogImage) || 0) + 1);
  for (const p of pages) if (p && p.isDetail && p.ogImage && count.get(p.ogImage) > 1) p.ogImage = '';
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

/**
 * 기간 팩트체크용 (11/10 대표 결정): 목록에서 공지 배너(이미지 주소로 찾음)를 화면 그대로 찍고, 눌러서 열리는 상세 화면을 읽는다.
 * 상세가 '클릭으로만 열림'인 출처(bk-event 등)를 위해. 이미지 파일을 내려받거나 저장하지 않는다 — 브라우저 화면만 찍어 AI에게 잠깐 보여 준다.
 * @returns {Promise<null | { banner: {media_type,data}|null, detailUrl: string, moved: boolean, text: string, screenshots: Array<{media_type,data}> }>}
 */
export async function captureNoticeDetail(ctx, listUrl, imageUrl, { maxShots = 3, waitMs = 0, clickWaitMs = 1500 } = {}) {
  const robots = await robotsAllows(listUrl);
  if (!robots.allowed) throw Object.assign(new Error(`${listUrl}: ${robots.reason}`), { code: 'ROBOTS' });
  const page = await ctx.context.newPage();
  let popup = null;
  const jpeg = (buf) => (buf ? { media_type: 'image/jpeg', data: buf.toString('base64') } : null);
  try {
    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    if (waitMs) await sleep(waitMs);
    await autoScroll(page);
    const key = (u) => { try { const x = new URL(u, listUrl); return x.host + x.pathname; } catch { return String(u); } };
    const found = await page.evaluate((target) => {
      const norm = (u) => { try { const x = new URL(u, location.href); return x.host + x.pathname; } catch { return u; } };
      const img = [...document.images].find((i) => norm(i.currentSrc || i.src) === target);
      if (!img) return false;
      img.setAttribute('data-among-target', '1');
      img.scrollIntoView({ block: 'center' });
      return true;
    }, key(imageUrl));
    if (!found) return null;
    const target = page.locator('img[data-among-target="1"]').first();
    const banner = jpeg(await target.screenshot({ type: 'jpeg', quality: 80, timeout: 10000 }).catch(() => null));
    const before = page.url();
    const popupWait = ctx.context.waitForEvent('page', { timeout: 6000 }).catch(() => null);
    await target.click({ timeout: 10000 }).catch(() => {});
    popup = await popupWait;
    const p = popup || page;
    await p.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await sleep(clickWaitMs);
    const url = p.url();
    const moved = !!popup || url !== before;
    if (moved && !(await robotsAllows(url)).allowed) return { banner, detailUrl: url, moved, text: '', screenshots: [] };
    if (!moved) {
      // 같은 화면에 겹쳐 열리는 상세(레이어)일 수 있어 지금 보이는 화면만 한 장
      const shot = jpeg(await page.screenshot({ type: 'jpeg', quality: 70 }).catch(() => null));
      return { banner, detailUrl: '', moved, text: '', screenshots: shot ? [shot] : [] };
    }
    const text = String(await p.evaluate(() => document.body.innerText).catch(() => '')).replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT);
    await autoScroll(p);
    const body = await p.$('body');
    const shots = body ? await takeShots(p, body, 'body', maxShots) : [];
    return { banner, detailUrl: url, moved, text, screenshots: shots.map(({ base64 }) => ({ media_type: 'image/jpeg', data: base64 })) };
  } finally {
    if (popup) await popup.close().catch(() => {});
    await page.close().catch(() => {});
  }
}
