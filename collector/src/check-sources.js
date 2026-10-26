// 출처 점검: Claude를 호출하지 않고 각 URL이 robots 허용·렌더링·텍스트 추출이 되는지만 확인한다.
// 사용: SOURCES_FILE=sources.json npm run check-sources   (ONLY=mcd-promo 로 하나만)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openBrowser, collectSource } from './fetch.js';
import { loadLocalSources, pool } from './run.js';
import { SheetClient } from './sheet.js';

const only = process.env.ONLY ? process.env.ONLY.split(',').map((x) => x.trim()).filter(Boolean) : null;
const outDir = resolve(process.env.OUT_DIR || 'out');
const all = process.env.APPS_SCRIPT_URL && !process.env.SOURCES_FILE
  ? (await new SheetClient(process.env.APPS_SCRIPT_URL, process.env.COLLECTOR_TOKEN).post('sources')).sources
  : loadLocalSources(process.env.SOURCES_FILE || 'sources.example.json');
const sources = all.filter((s) => !only || only.includes(s.id));
mkdirSync(outDir, { recursive: true });

const ctx = await openBrowser();
const rows = [];
await pool(sources, +(process.env.COLLECT_CONCURRENCY || 4), async (s) => {
  const row = { id: s.id, url: s.url, ok: false, pages: 0, text_chars: 0, detail_links: 0, sample: '', error: '' };
  try {
    const pages = await collectSource(ctx, s, { outDir: join(outDir, 'shots') });
    const ok = pages.filter((p) => !p.error);
    row.ok = true;
    row.pages = ok.length;
    row.text_chars = ok.reduce((n, p) => n + p.text.length, 0);
    row.detail_links = pages[0].links.length;
    row.sample = ok[0].text.slice(0, 200).replace(/\s+/g, ' ');
    row.errors = pages.filter((p) => p.error).map((p) => p.error);
  } catch (e) {
    row.error = e.message;
  }
  rows.push(row);
  console.log(`${row.ok ? '✓' : '✗'} ${s.id}  페이지 ${row.pages} · 텍스트 ${row.text_chars}자 · 상세링크 ${row.detail_links}  ${row.error}`);
  if (row.sample) console.log(`    ${row.sample}`);
});
await ctx.close();
// GitHub Actions 주석 (단계당 notice 10개 제한 → 묶어서, 줄바꿈 %0A)
if (process.env.GITHUB_ACTIONS) {
  const lines = rows.map((r) => `${r.ok ? '✓' : '✗'}|${r.id}|페이지${r.pages}|글자${r.text_chars}|상세${r.detail_links}${r.error ? '|' + r.error : ''}${r.errors && r.errors.length ? '|상세오류' + r.errors.length : ''}|${(r.sample || '').slice(0, 70)}`.replace(/[\r\n]+/g, ' '));
  for (let i = 0; i < lines.length; i += 8) console.log(`::notice title=출처 점검 ${i / 8 + 1}::${lines.slice(i, i + 8).join('\n').replace(/%/g, '%25').replace(/\n/g, '%0A')}`);
}
writeFileSync(join(outDir, 'check-sources.json'), JSON.stringify(rows, null, 2));
console.log(`\n스크린샷: ${join(outDir, 'shots')}  결과: ${join(outDir, 'check-sources.json')}`);
