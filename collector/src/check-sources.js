// 출처 점검: Claude를 호출하지 않고 각 URL이 robots 허용·렌더링·텍스트 추출이 되는지만 확인한다.
// 사용: SOURCES_FILE=sources.json npm run check-sources   (ONLY=mcd-promo 로 하나만)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openBrowser, collectSource } from './fetch.js';
import { loadLocalSources } from './run.js';
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
for (const s of sources) {
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
  // GitHub Actions 주석으로도 남긴다 (로그를 열지 않고 API·요약 화면에서 확인 가능)
  if (process.env.GITHUB_ACTIONS) {
    const msg = `${s.id}: ${row.ok ? '수집 가능' : '실패'} · 페이지 ${row.pages} · 텍스트 ${row.text_chars}자 · 상세링크 ${row.detail_links}${row.error ? ' · ' + row.error : ''}${row.sample ? ' · ' + row.sample.slice(0, 120) : ''}`;
    console.log(`::${row.ok ? 'notice' : 'warning'} title=출처 점검 ${s.id}::${msg.replace(/\r?\n/g, ' ')}`);
  }
}
await ctx.close();
writeFileSync(join(outDir, 'check-sources.json'), JSON.stringify(rows, null, 2));
console.log(`\n스크린샷: ${join(outDir, 'shots')}  결과: ${join(outDir, 'check-sources.json')}`);
