// 전체 경로 점검 확인: 공개 coupons API에서 점검 쿠폰이 보이는지/사라졌는지, 실제 쿠폰 수가 그대로인지
// 사용: node src/e2e-verify.js expect-on|expect-off <실제 쿠폰 기준 수 파일>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const [, , mode, baseFile = 'out/e2e-base.json'] = process.argv;
const url = new URL(process.env.APPS_SCRIPT_URL);
url.searchParams.set('action', 'coupons');
url.searchParams.set('nocache', String(Date.now()));
const j = JSON.parse(await (await fetch(url, { redirect: 'follow' })).text());
const list = j.coupons || [];
const test = list.filter((c) => c.brand === 'AMONG점검');
const real = list.filter((c) => c.brand !== 'AMONG점검');
const ids = real.map((c) => c.id).sort();
let ok = true; const lines = [];
if (mode === 'base') { writeFileSync(baseFile, JSON.stringify(ids)); lines.push(`기준: 실제 쿠폰 ${ids.length}건`); }
else {
  const base = existsSync(baseFile) ? JSON.parse(readFileSync(baseFile, 'utf8')) : null;
  if (base) { const same = base.length === ids.length && base.every((x, i) => x === ids[i]); lines.push(`실제 쿠폰 ${ids.length}건 (기준 ${base.length}) ${same ? '그대로' : '변경됨!'}`); if (!same) ok = false; }
  if (mode === 'expect-on') {
    const price = test.find((c) => c.coupon_price === 5500); const pct = test.find((c) => c.discount_rate === 20);
    lines.push(`점검 쿠폰 ${test.length}건 공개 (기대 2) · 쿠폰가 5500 ${price ? 'O' : 'X'} · 20% ${pct ? 'O' : 'X'}`);
    if (test.length !== 2 || !price || !pct) ok = false;
  } else { lines.push(`점검 쿠폰 ${test.length}건 공개 (기대 0 — 행사 종료 시 자동 내림)`); if (test.length) ok = false; }
}
console.log(`::${ok ? 'notice' : 'error'} title=전체 경로 점검 ${mode}::${lines.join(' · ')}`);
process.exitCode = ok ? 0 : 1;
