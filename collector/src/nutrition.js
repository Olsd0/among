// 영양성분 가져오기 (AI 호출 없음)
// 식약처 '전국통합식품영양성분정보(음식)표준데이터' → 우리가 다루는 브랜드만 → 1회 제공량 기준 환산 → 시트 nutrition 탭
//   공공데이터포털: https://www.data.go.kr/data/15100070/standard.do  (이용허락 제한 없음, 업체명 포함)
// 사용: DATA_GO_KR_KEY=인증키 node src/nutrition.js
//       NUTRITION_FILE=내려받은.json|.csv node src/nutrition.js   (API 대신 파일)
// 원칙: 틀린 숫자를 보여주느니 안 보여준다 → 열량 검산(탄4·단4·지9)이 대부분 맞지 않으면 시트에 쓰지 않고 멈춘다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalBrand, BRANDS, menuKey, todayKST } from './engine.js';
import { SheetClient } from './sheet.js';

export const API_URL = 'https://api.data.go.kr/openapi/tn_pubr_public_nutri_food_info_api';
export const SOURCE_LABEL = '식약처 식품영양성분DB(공공데이터)';

// 같은 값을 가리키는 여러 이름 (API 영문 필드 · 내려받은 파일의 한글 머리글). NUTRITION_FIELD_MAP(JSON)으로 덮어쓸 수 있음
export const FIELD_ALIASES = {
  name: ['foodNm', '식품명'],
  maker: ['mfrNm', '업체명', '제조사명', 'imptNm', '수입업체명', 'distNm', '유통업체명'],
  base: ['nutConSrtrQua', '영양성분함량기준량'],
  size: ['foodSize', '식품중량'],
  serv: ['servSize', '1인(회)분량참고량', '1회섭취참고량'],
  kcal: ['enerc', '에너지(kcal)', '에너지'],
  protein: ['prot', '단백질(g)', '단백질'],
  fat: ['fatce', '지방(g)', '지방'],
  carb: ['chocdf', '탄수화물(g)', '탄수화물'],
  sugar: ['sugar', '당류(g)', '당류'],
  sodium: ['nat', '나트륨(mg)', '나트륨'],
  sat: ['fasat', '포화지방산(g)', '포화지방산'],
  date: ['crtrYmd', '데이터기준일자', 'crtYmd', '데이터생성일자'],
};

function fieldMap(env = process.env) {
  const map = { ...FIELD_ALIASES };
  if (env.NUTRITION_FIELD_MAP) {
    for (const [k, v] of Object.entries(JSON.parse(env.NUTRITION_FIELD_MAP))) map[k] = [].concat(v, map[k] || []);
  }
  return map;
}

function pick(obj, aliases) {
  for (const a of aliases) if (obj[a] !== undefined && obj[a] !== null && String(obj[a]).trim() !== '') return String(obj[a]).trim();
  return '';
}

const num = (v) => {
  const m = String(v ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

/** "213g", "100 g", "355ml", "1인분(250g)" → { n: 213, unit: 'g' } */
export function parseQty(v) {
  const s = String(v ?? '').replace(/,/g, '');
  // '1인분(250g)'처럼 단위가 붙은 숫자를 먼저, 없으면 첫 숫자
  const m = s.match(/(\d+(?:\.\d+)?)\s*(g|ml|mL|㎖|그램)/) || s.match(/(\d+(?:\.\d+)?)()/);
  if (!m) return null;
  const unit = /ml|mL|㎖/.test(m[2] || '') ? 'ml' : 'g';
  return { n: parseFloat(m[1]), unit };
}

/** 열량 검산: 표시 열량과 탄·단·지로 계산한 열량이 ±30% 안이면 true, 계산 불가면 null */
export function atwaterOk(r) {
  if (![r.kcal, r.carb, r.protein, r.fat].every((x) => typeof x === 'number')) return null;
  if (r.kcal <= 0) return false;
  const est = 4 * r.carb + 4 * r.protein + 9 * r.fat;
  return est / r.kcal >= 0.7 && est / r.kcal <= 1.3;
}

// '맥도날드_빅맥', '[버거킹] 와퍼'처럼 구분자가 있는 브랜드 머리말만 뗀다 ('교촌오리지날'은 메뉴 이름 그대로)
const BRAND_PREFIX_SEP = new RegExp(`^\\s*([\\[(](${BRANDS.map(([, , re]) => re.source).join('|')})[\\])]|(${BRANDS.map(([, , re]) => re.source).join('|')})\\s*[_\\-:·])\\s*`, 'i');

/**
 * 원자료 1행 → 우리 형식 (우리 브랜드가 아니면 null)
 * 값은 '영양성분함량기준량'(보통 100g) 기준 → 식품중량(없으면 1회 참고량)으로 환산해 1개(1회) 기준으로 만든다.
 */
export function toItem(row, map = FIELD_ALIASES) {
  const maker = pick(row, map.maker);
  const rawName = pick(row, map.name);
  if (!rawName) return null;
  const noMaker = !maker || /^(-|해당\s*없음|없음|null)$/i.test(maker);
  const b = canonicalBrand(maker) || (noMaker ? canonicalBrand(rawName) : null);
  if (!b) return null;
  const name = rawName.replace(BRAND_PREFIX_SEP, '').replace(/\s+/g, ' ').trim() || rawName;

  const base = parseQty(pick(row, map.base)) || { n: 100, unit: 'g' };
  const size = parseQty(pick(row, map.size)) || parseQty(pick(row, map.serv));
  const factor = size && size.n > 0 && base.n > 0 ? size.n / base.n : 1;
  const serving = size ? `${+size.n.toFixed(1)}${size.unit}` : `${base.n}${base.unit} 기준`;
  const g1 = (v) => (v === null ? null : Math.round(v * factor * 10) / 10);
  const i0 = (v) => (v === null ? null : Math.round(v * factor));
  const v = Object.fromEntries(['kcal', 'protein', 'fat', 'carb', 'sugar', 'sodium', 'sat'].map((k) => [k, num(pick(row, map[k]))]));
  return {
    brand: b.brand, name, serving,
    kcal: i0(v.kcal), protein_g: g1(v.protein), fat_g: g1(v.fat), sat_fat_g: g1(v.sat), carb_g: g1(v.carb), sugar_g: g1(v.sugar), sodium_mg: i0(v.sodium),
    source: SOURCE_LABEL, _date: pick(row, map.date), _check: atwaterOk({ kcal: v.kcal, carb: v.carb, protein: v.protein, fat: v.fat }),
  };
}

/** 같은 브랜드·같은 메뉴는 하나만 (기준일이 최신인 것) */
export function dedupeItems(items) {
  const by = new Map();
  for (const it of items) {
    const k = `${it.brand}|${menuKey(it.name)}`;
    const cur = by.get(k);
    if (!cur || String(it._date) > String(cur._date)) by.set(k, it);
  }
  return [...by.values()];
}

/** 표준데이터 API 응답에서 행 배열 꺼내기 (items가 배열이거나 {item: [...]}) */
export function rowsOf(json) {
  const body = json?.response?.body ?? json?.body ?? {};
  const items = body.items?.item ?? body.items ?? [];
  return { rows: Array.isArray(items) ? items : [items].filter(Boolean), total: +body.totalCount || 0, code: String(json?.response?.header?.resultCode ?? '00') };
}

export async function fetchAllRows({ key, url = API_URL, perPage = 1000, maxPages = 300, fetchImpl = fetch, log = () => {} }) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const u = new URL(url);
    u.searchParams.set('serviceKey', key);
    u.searchParams.set('pageNo', String(page));
    u.searchParams.set('numOfRows', String(perPage));
    u.searchParams.set('type', 'json');
    const res = await fetchImpl(u, { signal: AbortSignal.timeout(60000) });
    const text = await res.text();
    if (!res.ok || text.trim().startsWith('<')) {
      const msg = (text.match(/<returnAuthMsg>([^<]+)|<resultMsg>([^<]+)/) || [])[1] || text.slice(0, 160);
      throw new Error(`공공데이터 API ${res.status}: ${msg}`);
    }
    const { rows, total, code } = rowsOf(JSON.parse(text));
    if (code === '03' || !rows.length) break;  // 03 = 데이터 없음
    if (code !== '00' && code !== '0') throw new Error(`공공데이터 API 결과코드 ${code}`);
    all.push(...rows);
    log(`  ${page}쪽 · 누적 ${all.length}${total ? ` / ${total}` : ''}`);
    if (rows.length < perPage || (total && all.length >= total)) break;
  }
  return all;
}

export function readFileRows(file) {
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (/\.json$/i.test(file)) {
    const j = JSON.parse(text);
    return Array.isArray(j) ? j : rowsOf(j).rows.length ? rowsOf(j).rows : (j.records || j.data || []);
  }
  // CSV (따옴표 안 쉼표 처리)
  const lines = [];
  let cur = [''], q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; } else if (ch === '"') q = false; else cur[cur.length - 1] += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') cur.push('');
    else if (ch === '\n') { lines.push(cur); cur = ['']; }
    else if (ch !== '\r') cur[cur.length - 1] += ch;
  }
  if (cur.length > 1 || cur[0]) lines.push(cur);
  const [head, ...rest] = lines;
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

/**
 * 원자료 행들 → 시트에 넣을 목록 + 점검 결과
 * @returns {{ items, stats: { scanned, matched, checked, passed, byBrand }, ok, reason }}
 */
export function buildNutrition(rows, { env = process.env } = {}) {
  const map = fieldMap(env);
  const raw = rows.map((r) => toItem(r, map)).filter(Boolean);
  const items = dedupeItems(raw);
  const checked = items.filter((x) => x._check !== null);
  const passed = checked.filter((x) => x._check).length;
  const byBrand = {};
  items.forEach((x) => { byBrand[x.brand] = (byBrand[x.brand] || 0) + 1; });
  const stats = { scanned: rows.length, matched: items.length, checked: checked.length, passed, byBrand };
  let ok = true, reason = '';
  if (!items.length) { ok = false; reason = rows.length ? `우리 브랜드 메뉴를 찾지 못함 (원자료 ${rows.length}행, 첫 행 필드: ${Object.keys(rows[0] || {}).slice(0, 25).join(',')})` : '원자료가 비어 있음'; }
  else if (checked.length >= 5 && passed / checked.length < 0.7) { ok = false; reason = `열량 검산 통과 ${passed}/${checked.length} — 필드 이름이 맞지 않는 것 같음 (첫 행 필드: ${Object.keys(rows[0] || {}).slice(0, 25).join(',')})`; }
  // 검산에 실패한 개별 행은 버린다 (단위·입력 오류)
  const clean = items.filter((x) => x._check !== false).map(({ _date, _check, ...x }) => x);
  return { items: clean, stats, ok, reason };
}

export async function runNutrition({ env = process.env, now = new Date(), fetchImpl = fetch, sheet, quiet = false } = {}) {
  const log = (...a) => { if (!quiet) console.log(...a); };
  const outDir = resolve(env.OUT_DIR || 'out');
  mkdirSync(outDir, { recursive: true });
  const client = sheet || (env.APPS_SCRIPT_URL ? new SheetClient(env.APPS_SCRIPT_URL, env.COLLECTOR_TOKEN, { fetchImpl }) : null);
  const result = { state: 'skipped', reason: '', stats: null };

  if (!env.DATA_GO_KR_KEY && !env.NUTRITION_FILE) { result.reason = '공공데이터 인증키(DATA_GO_KR_KEY)가 없어 건너뜀'; return result; }
  // 주 1회면 충분 (메뉴 영양정보는 자주 바뀌지 않음). 수동 실행(FORCE=1)은 항상
  if (client && env.FORCE !== '1') {
    const st = await client.get('status').catch(() => null);
    const last = st?.nutrition_updated_at;
    const days = last ? (Date.parse(todayKST(now)) - Date.parse(todayKST(new Date(last)))) / 864e5 : Infinity;
    if (days < +(env.NUTRITION_MIN_DAYS || 6)) { result.reason = `최근 갱신 ${todayKST(new Date(last))} (${days}일 전)`; return result; }
  }

  const rows = env.NUTRITION_FILE ? readFileRows(env.NUTRITION_FILE) : await fetchAllRows({ key: env.DATA_GO_KR_KEY, url: env.NUTRITION_API_URL || API_URL, fetchImpl, log });
  const built = buildNutrition(rows, { env });
  result.stats = built.stats;
  writeFileSync(join(outDir, 'nutrition.json'), JSON.stringify(built, null, 2));
  if (!built.ok) { result.state = 'failed'; result.reason = built.reason; return result; }
  if (client && env.DRY_RUN !== '1') result.ingest = (await client.post('nutrition_ingest', { items: built.items })).result;
  result.state = 'success';
  return result;
}

// CLI
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const r = await runNutrition().catch((e) => ({ state: 'failed', reason: e.message }));
  const brands = r.stats ? Object.entries(r.stats.byBrand).map(([b, n]) => `${b} ${n}`).join(' · ') : '';
  const line = `${r.state} · ${r.reason || ''} ${r.stats ? `원자료 ${r.stats.scanned}행 → 우리 브랜드 ${r.stats.matched}개 (검산 ${r.stats.passed}/${r.stats.checked}) ${brands}` : ''}`.trim();
  console.log(line);
  if (process.env.GITHUB_ACTIONS) console.log(`::${r.state === 'failed' ? 'warning' : 'notice'} title=영양성분::${line.replace(/%/g, '%25').slice(0, 900)}`);
  process.exit(0);  // 영양성분 실패가 쿠폰 수집을 막지 않게 항상 0
}
