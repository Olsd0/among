// 매일 아침 작업용: 파트너스 검색(쿠팡랭킹순)에서 읽은 후보 → 항목별 오늘 올릴 상품과 '새 링크가 필요한 상품'을 고른다.
// 입력(stdin JSON): { "candidates": { "protein": [{"title":"…","price":23750}, …(검색 결과 순서, 위에서 24개쯤)] },
//                    "current": { "protein": ["지금 보이는 카드 상품명", …] }, "watch": [{"item","title","low","high","days"}] (공개 online_deals 응답의 watch) }
// 출력(JSON): { "protein": { "same": true|false, "top": [{"title","price","deal","needLink"}], "watch": [{"title","price"}] } }
// top = 가격 내린 상품(deal) 먼저 → 인기순으로 브랜드마다 하나씩(odRotateOrder). watch = 가격만 기록할 후보(워크플로 입력 watch로 그대로 보낸다).
// same이면 올릴 상품이 지금 카드와 같아 새 링크가 필요 없다(가격만 기록). 실제 판단은 Apps Script(odRotatePlan)가 다시 한다.
import { readFileSync } from 'node:fs';
import { odRotateOrder, odWatchInput } from '../online-deals-core.js';

const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
export function selectRotation({ candidates = {}, current = {}, watch = [] } = {}) {
  const out = {};
  for (const [item, list] of Object.entries(candidates)) {
    const stats = {};
    (Array.isArray(watch) ? watch : []).forEach(w => { if (w && w.item === item) stats[norm(w.title)] = w; });
    const top = odRotateOrder(list, item, stats);
    const now = new Set((current[item] || []).map(norm));
    top.forEach(t => { t.needLink = !now.has(norm(t.title)); });
    out[item] = { same: top.length === now.size && top.every(t => !t.needLink), top, watch: odWatchInput(list, item) };
  }
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  console.log(JSON.stringify(selectRotation(JSON.parse(readFileSync(0, 'utf8'))), null, 1));
}
