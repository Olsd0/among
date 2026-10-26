// 브랜드 탐색(probe): 홈 → 이벤트·프로모션·쿠폰 페이지 찾기 → 수집 가능성 점검. Claude 호출 없음.
// 판정: 수집가능(가격 글자 있음) / 이미지위주(글자 가격 거의 없음) / robots차단 / 접속실패 / 후보없음
// 사용: node src/probe.js            (probe-brands.json 전체)
//       ONLY=starbucks,ediya node src/probe.js
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openBrowser, sameSite } from './fetch.js';
import { robotsAllows } from './robots.js';

const LINK_RE = /이벤트|프로모션|쿠폰|혜택|할인|EVENT|PROMOTION|COUPON|BENEFIT|NEWS|소식/i;
const HREF_RE = /event|promo|coupon|benefit|news|notice/i;
const PRICE_RE = /\d{1,3}(?:,\d{3})+\s*원|\d{4,6}\s*원/g;
const PCT_RE = /\d{1,2}\s*%/g;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = JSON.parse(readFileSync(process.env.BRANDS_FILE || 'probe-brands.json', 'utf8')).brands;
const only = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim()) : null;
const brands = list.filter((b) => !only || only.includes(b.id));
const outDir = resolve(process.env.OUT_DIR || 'out');
mkdirSync(join(outDir, 'probe'), { recursive: true });

async function visit(ctx, url, { links = false, shot } = {}) {
  const robots = await robotsAllows(url);
  if (!robots.allowed) {
    // robots.txt 자체를 못 받아온 경우(연결 실패·서버 오류)는 차단이 아니라 접속 문제로 분류
    if (/확인 실패|robots\.txt 5\d\d/.test(robots.reason)) return { url, error: robots.reason };
    return { url, blocked: robots.reason };
  }
  const page = await ctx.context.newPage();
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    await sleep(800);
    const data = await page.evaluate((wantLinks) => {
      const text = document.body ? document.body.innerText : '';
      const imgs = [...document.images].filter((i) => i.naturalWidth >= 200).length;
      const links = wantLinks ? [...document.querySelectorAll('a[href]')].map((a) => ({ t: (a.innerText || a.title || a.getAttribute('aria-label') || '').trim().slice(0, 40), h: a.href })) : [];
      return { title: document.title, text, imgs, links };
    }, links);
    if (shot) await page.screenshot({ path: shot, type: 'jpeg', quality: 60, fullPage: false }).catch(() => {});
    return {
      url, final: page.url(), status: res ? res.status() : 0, title: data.title,
      chars: data.text.length, prices: (data.text.match(PRICE_RE) || []).length, pcts: (data.text.match(PCT_RE) || []).length,
      imgs: data.imgs, links: data.links, sample: data.text.replace(/\s+/g, ' ').slice(0, 160),
    };
  } catch (e) {
    return { url, error: e.message.split('\n')[0].slice(0, 120) };
  } finally {
    await page.close();
  }
}

function verdict(r) {
  if (r.homeError) return '접속실패';
  if (r.homeBlocked) return 'robots차단';
  const ok = r.pages.filter((p) => !p.error && !p.blocked);
  if (!r.pages.length) return '후보없음';
  if (!ok.length) return r.pages.some((p) => p.blocked) ? 'robots차단' : '접속실패';
  const best = ok.reduce((a, b) => (b.prices + b.pcts > a.prices + a.pcts ? b : a));
  if (best.prices >= 3 || best.pcts >= 2) return '수집가능';
  if (best.imgs >= 3) return '이미지위주';
  return '정보적음';
}

const ctx = await openBrowser();
const results = [];
const emit = (list, tag) => {
  if (!process.env.GITHUB_ACTIONS || !list.length) return;
  const lines = list.map(line);
  console.log(`::notice title=브랜드 탐색 ${tag}::${lines.join('\n').replace(/[\r]/g, ' ').replace(/%/g, '%25').replace(/\n/g, '%0A')}`);
};
const line = (r) => `${r.verdict}|${r.category}|${r.brand}|${r.best ? `${r.best.url}|가격${r.best.prices}|%${r.best.pcts}|img${r.best.imgs}|${(r.best.label || '').replace(/\|/g, '/')}` : (r.homeError || r.homeBlocked || (r.candidates || []).slice(0, 2).join(' ; ') || '-')}`;

async function probeBrand(b) {
  const r = { ...b, pages: [] };
  const home = await visit(ctx, b.home, { links: true, shot: join(outDir, 'probe', `${b.id}_home.jpg`) });
  if (home.blocked) r.homeBlocked = home.blocked;
  else if (home.error || home.status >= 400) r.homeError = home.error || `HTTP ${home.status}`;
  else {
    r.homeFinal = home.final;
    const cands = [];
    for (const l of home.links) {
      if (!l.h || !/^https?:/.test(l.h) || !sameSite(l.h, home.final)) continue;
      if (!(LINK_RE.test(l.t) || HREF_RE.test(l.h))) continue;
      if (/login|member|join|cart|order|faq|recruit|franchise|store|map/i.test(l.h)) continue;
      if (!cands.find((c) => c.h === l.h)) cands.push(l);
    }
    cands.sort((a, b2) => (/쿠폰|coupon/i.test(b2.t + b2.h) - /쿠폰|coupon/i.test(a.t + a.h)) || (LINK_RE.test(b2.t) - LINK_RE.test(a.t)));
    r.candidates = cands.slice(0, 8).map((c) => `${c.t}|${c.h}`);
    for (const c of cands.slice(0, 3)) {
      await sleep(800);
      const p = await visit(ctx, c.h, { shot: join(outDir, 'probe', `${b.id}_${r.pages.length + 1}.jpg`) });
      p.label = c.t;
      delete p.links;
      r.pages.push(p);
    }
  }
  r.verdict = verdict(r);
  const best = r.pages.filter((p) => !p.error && !p.blocked).sort((a, b2) => (b2.prices + b2.pcts) - (a.prices + a.pcts))[0];
  r.best = best ? { url: best.final || best.url, label: best.label, prices: best.prices, pcts: best.pcts, imgs: best.imgs, chars: best.chars } : null;
  console.log(line(r));
  return r;
}

// 4개씩 병렬, 한 묶음(8개)이 끝날 때마다 주석으로 남겨 중간에 끊겨도 결과가 보이게
const CONC = +(process.env.PROBE_CONCURRENCY || 4);
const batches = [];
for (let i = 0; i < brands.length; i += 8) batches.push(brands.slice(i, i + 8));
for (const [bi, batch] of batches.entries()) {
  const done = [];
  for (let i = 0; i < batch.length; i += CONC) {
    done.push(...(await Promise.all(batch.slice(i, i + CONC).map((b) => probeBrand(b).catch((e) => ({ ...b, pages: [], verdict: '오류', homeError: e.message.slice(0, 100) }))))));
  }
  results.push(...done);
  writeFileSync(join(outDir, 'probe.json'), JSON.stringify(results, null, 2));
  emit(done, `${bi + 1}/${batches.length}`);
}
await ctx.close();
writeFileSync(join(outDir, 'probe.json'), JSON.stringify(results, null, 2));

