// 실행: node collector/scripts/share-image.cjs web web/share.png (Playwright 필요). 로고·분류 아이콘·머리글 무늬가 바뀌면 다시 만든다.
// 공유 미리보기 이미지 (1200×630) — 저장소의 로고·바둑판·분류 아이콘 SVG와 Pretendard로 그림
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const WEB = process.argv[2], OUT = process.argv[3];
const b64 = (f, type) => `data:${type};base64,` + fs.readFileSync(path.join(WEB, f)).toString('base64');
const app = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(WEB, 'home.css'), 'utf8');
const vars = css.match(/:root \{ --ic-tile:[^}]+\}/)[0];
const cls = css.match(/\.i-a \{[\s\S]*?\.l-c \{ stroke: var\(--ic-c\); \}/)[0];
const mask = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8').match(/<mask id="m-donut"[\s\S]*?<\/mask>/)[0];
const art = (k) => app.match(new RegExp(`\\n  ${k}: '(<svg[^']+)'`))[1];
const html = `<!doctype html><html><head><style>
@font-face{font-family:P;src:url(${b64('fonts/PretendardVariable.woff2', 'font/woff2')}) format('woff2');font-weight:100 900}
${vars} ${cls}
html,body{margin:0}
body{width:1200px;height:630px;background:url(${b64('banana-bricks.svg', 'image/svg+xml')}) repeat center top / 408px 160px;display:grid;place-items:center;font-family:P,sans-serif;color:#211c10}
.card{width:880px;padding:54px 60px 50px;box-sizing:border-box;background:#fffdf5;border-radius:44px;box-shadow:0 10px 0 rgb(33 28 16 / .12)}
.logo{display:flex;align-items:center;gap:16px;height:76px}
.logo .s{height:76px;width:auto}.logo .w{height:50px;width:auto}
h1{margin:30px 0 0;font-size:68px;line-height:1.16;font-weight:800;letter-spacing:-.045em}
p{margin:16px 0 0;font-size:29px;font-weight:600;letter-spacing:-.03em;color:#5b5342}
.row{display:flex;gap:16px;margin-top:34px}
.row span{width:84px;height:84px;border-radius:26px;background:var(--ic-tile);display:grid;place-items:center}
.row svg{width:58px;height:58px}
</style></head><body><svg width="0" height="0" style="position:absolute"><defs>${mask}</defs></svg>
<div class="card"><div class="logo"><img class="s" src="${b64('among-symbol.svg', 'image/svg+xml')}"><img class="w" src="${b64('among-logo.svg', 'image/svg+xml')}"></div>
<h1>오늘 한 끼, 내 예산에 맞게.</h1><p>프랜차이즈 쿠폰과 통신사·페이 할인을 한눈에 비교해요</p>
<div class="row">${['햄버거', '카페', '치킨', '피자', '디저트'].map((k) => `<span>${art(k)}</span>`).join('')}</div></div></body></html>`;
(async () => {
  const br = await chromium.launch(); const page = await br.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html); await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  await page.screenshot({ path: OUT }); await br.close();
})();
