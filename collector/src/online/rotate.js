// 항목별 인기순 교체 (online-item-rotate.yml, 수동 실행 입력 items).
// 11/11 대표 요청: 항목 카드를 같은 제품 갱신 말고 인기순으로 매일 바꾸기. 인기순이 어제와 같으면 바꾸지 않는다.
// 입력: {"protein":[{"title":"…","price":23750,"html":"<a href=\"https://link.coupang.com/a/…\"><img src=\"…/image/affiliate/…\" alt=\"…\"></a>"}, …], …}
//   - 매일 아침 작업이 쿠팡 파트너스 '상품 링크' 검색(쿠팡랭킹순) 위에서부터 고른 순서 그대로.
//   - 지금 보이는 카드와 같은 상품은 html 없이 title·price만, 새 상품만 파트너스 '링크 생성'의 블로그용 태그 html을 넣는다.
// 시트의 online_item_rotate(수집기 토큰)로 보내고, 항목마다 odRotatePlan 기준으로 Apps Script가 다시 검사한다.
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SheetClient } from '../sheet.js';
import { OD_PICK_ITEMS, OD_ROTATE_POOL, OD_GOLDBOX_MAX, odPartnerHtml, odRotateCandidate, odText, odWatchInput } from '../online-deals-core.js';

/** 입력 글 → 항목별 [{title, price, url?, imageUrl?}]. 형식이 틀리면 이유와 함께 멈춘다 */
export function parseRotation(text) {
  let raw;
  try { raw = JSON.parse(String(text || '').trim()); } catch { throw new Error('입력이 JSON이 아니에요. {"protein":[{"title":"…","price":12900,"html":"…"}]} 형식으로 넣으세요.'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('입력은 항목별 목록이어야 해요.');
  const items = {}, notes = [];
  for (const [item, list] of Object.entries(raw)) {
    if (!Object.prototype.hasOwnProperty.call(OD_PICK_ITEMS, item)) { notes.push(`알 수 없는 항목 ${String(item).slice(0, 20)}`); continue; }
    if (!Array.isArray(list)) { notes.push(`${item}: 목록이 아님`); continue; }
    items[item] = list.slice(0, OD_ROTATE_POOL).map(e => {
      const o = e && typeof e === 'object' ? e : {};
      const out = { title: odText(o.title, 81), price: Number.isSafeInteger(o.price) ? o.price : null };
      if (o.html) {
        const h = odPartnerHtml(o.html);
        if (h.url) out.url = h.url;
        if (h.imageUrl) out.imageUrl = h.imageUrl;
        if (h.title && !out.title) out.title = h.title;
        if (!h.url) notes.push(`${item}: '${out.title.slice(0, 30)}' 링크를 읽지 못함`);
      }
      return out;
    }).filter(e => e.title);
    const ok = items[item].filter(e => odRotateCandidate(e.title, item)).length;
    if (!ok) notes.push(`${item}: 항목에 맞는 상품이 없음`);
  }
  if (!Object.keys(items).length) throw new Error('바꿀 항목이 없어요.');
  return { items, notes };
}

/** 가격만 기록할 후보 (11/13): {"protein":[{"title","price"}]} → 항목마다 검사한 목록. 비었거나 형식이 틀리면 {} */
export function parseWatch(text) {
  let raw = null;
  try { raw = JSON.parse(String(text || '').trim() || '{}'); } catch { return {}; }
  const out = {};
  for (const [item, list] of Object.entries(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {})) {
    if (!Object.prototype.hasOwnProperty.call(OD_PICK_ITEMS, item)) continue;
    const ok = odWatchInput(list, item);
    if (ok.length) out[item] = ok;
  }
  return out;
}
/** 오늘의 특가(쿠팡 골드박스 먹거리, 11/13): [{"title","price","html"}] → [{title, price, url, imageUrl}] */
export function parseDeals(text) {
  let raw = null;
  try { raw = JSON.parse(String(text || '').trim() || '[]'); } catch { return []; }
  return (Array.isArray(raw) ? raw : []).slice(0, OD_GOLDBOX_MAX * 2).map(e => {
    const o = e && typeof e === 'object' ? e : {}, h = odPartnerHtml(o.html || '');
    return { title: odText(o.title || h.title, 81), price: Number.isSafeInteger(o.price) ? o.price : null, url: h.url || '', imageUrl: h.imageUrl || '' };
  }).filter(e => e.title && e.url && e.price);
}

export async function runRotation({ api, text, watchText = '', dealsText = '', dry = false } = {}) {
  const { items, notes } = parseRotation(text);
  const watch = parseWatch(watchText), deals = parseDeals(dealsText);
  if (dry) return { items, notes, watch, deals, result: null };
  const r = await api.post('online_item_rotate', { items, watch, deals });
  return { items, notes, watch, deals, result: r.items || {}, watched: r.watched || 0, dealResult: r.deals || null };
}

function summary(out, dry) {
  const lines = [`### 항목별 인기순 교체${dry ? ' (시험 — 시트에 쓰지 않음)' : ''}`, ''];
  for (const [item, list] of Object.entries(out.items)) {
    const label = OD_PICK_ITEMS[item].label;
    const r = out.result && out.result[item];
    if (!r) { lines.push(`- ${label}: 받은 상품 ${list.length}개`); continue; }
    if (!r.applied) { lines.push(`- ${label}: 바꾸지 않음 (${r.reason})`); continue; }
    lines.push(`- ${label}: ${r.changed ? '교체' : '순위 같음 · 가격만 기록'} · 유지 ${r.kept}개` +
      (r.added.length ? ` · 새로 ${r.added.length}개(${r.added.join(' / ')})` : '') + (r.retired.length ? ` · 내림 ${r.retired.length}개(${r.retired.join(' / ')})` : ''));
    if (r.skipped && r.skipped.length) lines.push(`  - 건너뜀: ${r.skipped.map(s => `${s.title.slice(0, 30)}(${s.reason})`).join(' / ')}`);
  }
  const watchCount = Object.values(out.watch || {}).reduce((n, l) => n + l.length, 0);
  lines.push('', `- 가격 기록 후보: ${watchCount}개${out.result ? ` (시트에 ${out.watched}개 기록)` : ''}`);
  if ((out.deals || []).length || out.dealResult) lines.push(`- 오늘의 특가(골드박스): 받은 ${out.deals.length}개` + (out.dealResult ? ` · 올림 ${out.dealResult.added.length}개(${out.dealResult.added.join(' / ')})${out.dealResult.skipped.length ? ` · 건너뜀 ${out.dealResult.skipped.length}개` : ''}` : ''));
  if (out.notes.length) lines.push('', `참고: ${out.notes.join(' · ')}`);
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dry = process.env.ROTATE_MODE === 'dry';
  try {
    const api = dry ? null : new SheetClient(process.env.APPS_SCRIPT_URL, process.env.COLLECTOR_TOKEN);
    const out = await runRotation({ api, text: process.env.ITEMS_JSON, watchText: process.env.WATCH_JSON, dealsText: process.env.DEALS_JSON, dry });
    const text = summary(out, dry);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
    console.log(text);
  } catch (e) {
    console.error('인기순 교체 실패:', String(e && e.message || e).slice(0, 300));
    process.exit(1);
  }
}
