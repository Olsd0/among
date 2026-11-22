// 공개 데이터 사본을 실행 기록(로그)에 남긴다 — 화면 점검표(scripts/ux-screens.js)를 실제 데이터로 찍기 위해.
// 공개 API가 누구에게나 주는 응답만 받는다(토큰·관리 기능 없음). gzip + base64를 줄마다 나눠 찍고,
// 작업 셸에서 `gh run view --log`로 읽어 되살린다: node scripts/ux-screens.js --from-log <로그 파일>
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const SITE = (process.env.SITE_URL || 'https://www.amongpick.com/').replace(/\/?$/, '/');
const cfg = readFileSync(new URL('../../web/config.js', import.meta.url), 'utf8');
const GAS = (cfg.match(/apiUrl:\s*'([^']+)'/) || [])[1];
const sources = {
  coupons: `${SITE}api/public?action=coupons`,
  app_coupons: `${SITE}api/public?action=app_coupons`,
  nutrition: `${SITE}api/public?action=nutrition`,
  online_deals: GAS && `${GAS}?action=online_deals`,
  status: GAS && `${GAS}?action=status`,
};
const CHUNK = 16000;
for (const [action, url] of Object.entries(sources)) {
  if (!url) continue;
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'AMONG-ux-snapshot' } });
    const body = await res.text();
    JSON.parse(body); // 응답이 JSON인지 확인
    const b64 = gzipSync(body).toString('base64');
    const n = Math.ceil(b64.length / CHUNK);
    for (let i = 0; i < n; i++) console.log(`SNAP ${action} ${i + 1}/${n} ${b64.slice(i * CHUNK, (i + 1) * CHUNK)}`);
    console.log(`  · ${action}: ${body.length}자 → ${n}줄`);
  } catch (e) {
    console.log(`::warning title=사본 실패::${action}: ${e.message}`);
  }
}
