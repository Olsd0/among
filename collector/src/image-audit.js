// 사진 점검 (AI 호출 없음, 시트에 쓰지 않음) — GitHub 주석으로만 결과를 남긴다.
// 1) 공지 이미지: 확인 목록(notice-images.js) 밖에서 수집기가 고른 공지 이미지가, 그 공지의 공식 출처 페이지에서
//    어느 카드(주변 글·대체텍스트)에 붙어 있던 것인지 보여 준다 → 공지 제목과 같은 카드인지 사람이 대조.
// 2) 메뉴 사진: 공식 메뉴 페이지의 상품 사진(이름·주소·크기) 목록 → product-images.js BRAND_MENUS 등록용.
// 사용:
//   APPS_SCRIPT_URL=... node src/image-audit.js                      (공개 중인 소식 전체)
//   AUDIT='[{"brand":"..","title":"..","image_url":"..","source_url":"..","official_link":".."}]' node src/image-audit.js
//   AUDIT='menu=https://brand.kr/menu,https://other.kr/menu' node src/image-audit.js
import { openBrowser, renderPage } from './fetch.js';
import { noticePhoto } from './notice-images.js';

const input = String(process.env.AUDIT || '').trim();
const gh = !!process.env.GITHUB_ACTIONS;
const esc = (s) => String(s).replace(/\r?\n/g, ' ').replace(/%/g, '%25');
const note = (title, lines) => {
  console.log(`## ${title}\n${lines.join('\n')}`);
  if (gh) console.log(`::notice title=${esc(title)}::${lines.map(esc).join('%0A')}`);
};
const pathKey = (u) => { try { const x = new URL(u); return decodeURIComponent(x.host + x.pathname); } catch { return String(u || ''); } };
const short = (u) => { try { return decodeURIComponent(new URL(u).pathname.split('/').pop()); } catch { return String(u || ''); } };

const ctx = await openBrowser();
const cache = new Map();
async function page(url) {
  if (!cache.has(url)) cache.set(url, renderPage(ctx, url, { maxShots: 0 }).catch((e) => ({ error: e.message })));
  return cache.get(url);
}

try {
  if (input.startsWith('menu=')) {
    for (const url of input.slice(5).split(',').map((s) => s.trim()).filter(Boolean)) {
      const p = await page(url);
      if (p.error) { note(`메뉴 ${url}`, [`열지 못함: ${p.error}`]); continue; }
      const seen = new Set();
      const lines = p.images.filter((i) => !seen.has(i.src) && seen.add(i.src)).slice(0, 40)
        .map((i) => `${i.alt || '-'}|${(i.near || '').slice(0, 40)}|${i.w}x${i.h}|${i.src}`.slice(0, 300));
      note(`메뉴 ${new URL(url).host} (${lines.length})`, lines.length ? lines : ['사진 없음 (스크립트·배경 이미지일 수 있음)']);
    }
  } else {
    let news = [];
    if (input.startsWith('[')) news = JSON.parse(input);
    else if (process.env.APPS_SCRIPT_URL) news = (await (await fetch(`${process.env.APPS_SCRIPT_URL}?action=coupons&t=${Date.now()}`)).json()).news || [];
    const targets = news.filter((n) => /^https:\/\//.test(n.image_url || '') && !noticePhoto(n));
    const lines = [];
    for (const n of targets) {
      const want = pathKey(n.image_url);
      let found = '';
      for (const url of [...new Set([n.source_url, n.official_link].filter(Boolean))]) {
        const p = await page(url);
        if (p.error) continue;
        const hit = (p.images || []).find((i) => pathKey(i.src) === want);
        if (hit) { found = `카드 글 "${(hit.near || '').slice(0, 60)}" · 대체텍스트 "${(hit.alt || '').slice(0, 30)}" @${pathKey(url).slice(0, 50)}`; break; }
        if (p.ogImage && pathKey(p.ogImage) === want) { found = `공유 대표 이미지(og) @${pathKey(url).slice(0, 50)}`; break; }
      }
      lines.push(`${n.brand}|${n.title}|${short(n.image_url)} → ${found || '출처 페이지에서 못 찾음'}`.slice(0, 300));
    }
    note(`공지 이미지 대조 ${targets.length}건`, lines.length ? lines : ['확인 목록 밖 공지 이미지 없음']);
  }
} finally {
  await ctx.close();
}
