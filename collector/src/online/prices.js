// 매일 아침 가격 확인 기록 (online-prices.yml, 수동 실행 입력 prices).
// 입력: [{"id":"pk_…","price":12900}, …] — 쿠팡 파트너스 화면에서 그날 확인한 가격. 카드 번호와 가격만 받는다(링크·이름은 바꾸지 않음).
// 시트의 online_prices_ingest(수집기 토큰)로 보내고, 있는 카드만 기록된다. 30일 최저는 기록이 3일 이상 쌓인 카드만 화면에 보인다.
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SheetClient } from '../sheet.js';
import { odPriceObservations } from '../online-deals-core.js';

/** 입력 글 → 기록할 가격 목록. 형식이 틀리면 이유와 함께 멈춘다(잘못 읽은 값을 고쳐 넣지 않음) */
export function parsePrices(text) {
  let raw;
  try { raw = JSON.parse(String(text || '').trim()); } catch { throw new Error('가격 입력이 JSON이 아니에요. [{"id":"pk_…","price":12900}] 형식으로 넣으세요.'); }
  if (!Array.isArray(raw)) throw new Error('가격 입력은 목록이어야 해요.');
  const list = odPriceObservations(raw);
  if (!list.length) throw new Error('기록할 가격이 없어요. 카드 번호(pk_…)와 원 단위 정수 가격을 넣으세요.');
  return { list, skipped: Math.min(raw.length, 200) - list.length };
}

export async function runPrices({ api, text, dry = false } = {}) {
  const { list, skipped } = parsePrices(text);
  if (dry) return { list, skipped, recorded: 0, missing: [] };
  const r = await api.post('online_prices_ingest', { prices: list });
  return { list, skipped, recorded: r.recorded, missing: r.missing || [] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dry = process.env.PRICES_MODE === 'dry';
  try {
    const api = dry ? null : new SheetClient(process.env.APPS_SCRIPT_URL, process.env.COLLECTOR_TOKEN);
    const out = await runPrices({ api, text: process.env.PRICES_JSON, dry });
    const lines = [`### 매일 아침 가격 확인${dry ? ' (시험 — 시트에 쓰지 않음)' : ''}`, '',
      `받은 가격 ${out.list.length}개 · 형식이 틀려 뺀 줄 ${out.skipped}개 · 기록 ${out.recorded}개 · 없는(또는 숨긴) 카드 ${out.missing.length}개`];
    if (out.missing.length) lines.push('', `없는 카드: ${out.missing.join(', ')}`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
    console.log(lines.join('\n'));
  } catch (e) {
    console.error('가격 기록 실패:', String(e && e.message || e).slice(0, 200));
    process.exit(1);
  }
}
