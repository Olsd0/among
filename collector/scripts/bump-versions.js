// 바꾼 파일의 캐시 버전 올리기: web/·collector/src 안의 '<파일>?v=YYYYMMDD-N'을 오늘(KST) 다음 번호로, sw.js 캐시 이름 +1
// 사용: node collector/scripts/bump-versions.js app.js home.css   (파일 이름만)
// 바꾼 뒤 공유 파일이면 npm --prefix collector run sync-web 도 (collector/src → web 사본)
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = [...walk(join(root, 'web')), ...walk(join(root, 'collector/src'))].filter((p) => /\.(html|js|css|webmanifest)$/.test(p));
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const name of process.argv.slice(2)) {
  const re = new RegExp(`(^|[^\\w-])${esc(name)}\\?v=(\\d{8})-(\\d+)`, 'g');
  let best = null;
  for (const p of files) for (const m of readFileSync(p, 'utf8').matchAll(re)) { const v = `${m[2]}-${m[3].padStart(4, '0')}`; if (!best || v > best.v) best = { v, d: m[2], n: +m[3] }; }
  if (!best) { console.log(`  ✗ ${name}: 버전 표시 없음`); continue; }
  const next = best.d === today ? `${today}-${best.n + 1}` : `${today}-1`;
  for (const p of files) { const s = readFileSync(p, 'utf8'); const t = s.replace(re, (_, pre) => `${pre}${name}?v=${next}`); if (t !== s) writeFileSync(p, t); }
  console.log(`  ✓ ${name} → ${next}`);
}
const sw = join(root, 'web/sw.js');
const s = readFileSync(sw, 'utf8');
const m = s.match(/among-shell-v(\d+)/);
writeFileSync(sw, s.replace(m[0], `among-shell-v${+m[1] + 1}`));
console.log(`  ✓ sw.js → among-shell-v${+m[1] + 1}`);
