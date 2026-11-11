// 매일 아침 작업용: 파트너스 검색(쿠팡랭킹순)에서 읽은 후보 → 항목별 오늘 상위 5개와 '새 링크가 필요한 상품'을 고른다.
// 입력(stdin JSON): { "candidates": { "protein": [{"title":"…","price":23750}, …(검색 결과 순서)] }, "current": { "protein": ["지금 보이는 카드 상품명", …] } }
// 출력(JSON): { "protein": { "same": true|false, "top": [{"title","price","needLink"}] } }
// same이면 순위에 든 상품이 지금 카드와 같아 새 링크가 필요 없다(가격만 기록). 실제 판단은 Apps Script(odRotatePlan)가 다시 한다.
import { readFileSync } from 'node:fs';
import { OD_ROTATE_SIZE, odRotateCandidate, odText } from '../online-deals-core.js';

const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
export function selectRotation({ candidates = {}, current = {} } = {}) {
  const out = {};
  for (const [item, list] of Object.entries(candidates)) {
    const seen = new Set(), top = [];
    for (const c of Array.isArray(list) ? list : []) {
      const title = odText(c && c.title, 81);
      if (top.length >= OD_ROTATE_SIZE || seen.has(norm(title))) continue;
      if (!odRotateCandidate(title, item) || !Number.isSafeInteger(c.price)) continue;
      seen.add(norm(title)); top.push({ title, price: c.price });
    }
    const now = new Set((current[item] || []).map(norm));
    top.forEach(t => { t.needLink = !now.has(norm(t.title)); });
    out[item] = { same: top.length === now.size && top.every(t => !t.needLink), top };
  }
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  console.log(JSON.stringify(selectRotation(JSON.parse(readFileSync(0, 'utf8'))), null, 1));
}
