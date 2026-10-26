// 추출 정확도 표본 대조용 체크리스트 만들기
// 사용: node scripts/audit-sample.js out/coupons.json 20  → out/audit.csv
// 게시(published)된 쿠폰 중 무작위 N개를 뽑아, 사람이 공식 페이지와 대조해 O/X를 적을 칸을 만든다.
// (운영 입력이 아니라 2R 보고서용 "추출 정확도" 측정 절차)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [file = 'out/coupons.json', nArg = '20'] = process.argv.slice(2);
const all = JSON.parse(readFileSync(file, 'utf8')).filter((c) => c.status === 'published');
const n = Math.min(+nArg, all.length);
const pick = [...all].sort(() => Math.random() - 0.5).slice(0, n);
const cols = ['id', 'brand', 'menu', 'regular_price', 'coupon_price', 'discount_rate', 'channels', 'audience', 'app_only', 'end_date', 'source_url',
  '메뉴_OX', '쿠폰가_OX', '기간_OX', '채널_OX', '대상_OX', '메모'];
const q = (v) => `"${String(Array.isArray(v) ? v.join(',') : v ?? '').replace(/"/g, '""')}"`;
const csv = [cols.join(','), ...pick.map((c) => cols.map((k) => q(c[k] ?? '')).join(','))].join('\n');
const out = join(dirname(file), 'audit.csv');
writeFileSync(out, '﻿' + csv);
console.log(`게시 쿠폰 ${all.length}개 중 ${n}개 표본 → ${out}`);
console.log('정확도 = 모든 항목이 O인 쿠폰 수 / 표본 수 (항목별 정확도도 함께 기록)');
