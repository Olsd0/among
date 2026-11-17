// 시트 → D1 가져오기 + 비교 (docs/d1-migration.md 3단계). GitHub Actions(d1-import.yml)에서만 실행 — 토큰은 Secrets.
// 1) Apps Script에서 전체 행 내보내기 2) D1에 가져오기(여러 번 해도 같은 결과) 3) 두 쪽의 공개 응답 비교
// 출력에는 건수와 다른 항목의 id·열 이름만 적는다(토큰·내용 전체는 적지 않는다).
import { SheetClient } from '../src/sheet.js';

/** 시트 쪽 공개 응답과 D1 표로 만든 응답을 비교해 다른 점을 돌려준다 */
export function comparePublic(sheet, d1) {
  const diffs = [];
  const norm = (v) => (v === null || v === undefined ? '' : Array.isArray(v) ? v.map(String).join(',') : typeof v === 'boolean' ? String(v) : String(v));
  for (const key of ['coupons', 'news']) {
    const a = sheet[key] || [], b = d1[key] || [];
    const bm = new Map(b.map((x) => [x.id, x]));
    const am = new Map(a.map((x) => [x.id, x]));
    for (const x of a) {
      const y = bm.get(x.id);
      if (!y) { diffs.push(`${key} ${x.id}: D1에 없음`); continue; }
      for (const f of Object.keys(x)) if (norm(x[f]) !== norm(y[f])) diffs.push(`${key} ${x.id}: ${f} 다름`);
    }
    for (const y of b) if (!am.has(y.id)) diffs.push(`${key} ${y.id}: 시트 응답에 없음`);
    if (a.map((x) => x.id).join() !== b.map((x) => x.id).join() && !diffs.length) diffs.push(`${key}: 순서 다름`);
  }
  if ((sheet.last_checked_at || '') !== (d1.last_checked_at || '')) diffs.push('last_checked_at 다름');
  return diffs;
}

async function main(env) {
  const sheet = new SheetClient(env.APPS_SCRIPT_URL, env.COLLECTOR_TOKEN);
  const d1 = new SheetClient(env.D1_API_URL || 'https://www.amongpick.com/api/collector', String(env.D1_COLLECTOR_TOKEN || '').trim());
  const dump = await sheet.post('export');
  const count = (k) => (dump.tables[k] || []).length;
  console.log(`시트 내보내기: 쿠폰 ${count('coupons')} · 공지 ${count('news')} · 출처 ${count('sources')} · 실행 기록 ${count('run_log')}`);
  if (env.COMPARE_ONLY !== '1') {
    const r = await d1.post('import', { tables: dump.tables, props: dump.props });
    console.log(`D1 가져오기: ${JSON.stringify(r.result)}`);
  }
  const [a, b] = await Promise.all([sheet.get('coupons'), d1.post('preview_public')]);
  const diffs = comparePublic(a, b.body);
  console.log(`공개 응답 비교: 시트 쿠폰 ${a.coupons.length}·공지 ${(a.news || []).length} / D1 쿠폰 ${b.body.coupons.length}·공지 ${b.body.news.length} · 다른 점 ${diffs.length}개`);
  for (const d of diffs.slice(0, 40)) console.log('  - ' + d);
  const line = `시트 쿠폰 ${a.coupons.length}·공지 ${(a.news || []).length} → D1 쿠폰 ${b.body.coupons.length}·공지 ${b.body.news.length} · 다른 점 ${diffs.length}개${diffs.length ? ' (' + diffs.slice(0, 5).join(' / ') + ')' : ''}`;
  if (env.GITHUB_ACTIONS) console.log(`::notice title=D1 가져오기 비교::${line}`);
  if (diffs.length) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith('d1-import.js')) {
  if (!process.env.D1_COLLECTOR_TOKEN) { console.log('::notice title=D1 가져오기 건너뜀::D1_COLLECTOR_TOKEN이 아직 등록되지 않았어요.'); process.exit(0); }
  main(process.env).catch((e) => { console.error(`::error title=D1 가져오기 실패::${e.message}`); process.exit(1); });
}
