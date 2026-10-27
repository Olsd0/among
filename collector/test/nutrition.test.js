// 영양성분 가져오기: 공공데이터 → 우리 브랜드만 → 1개 기준 환산 → 검산 → 시트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseQty, atwaterOk, toItem, buildNutrition, fetchAllRows, runNutrition, readFileRows } from '../src/nutrition.js';
import { matchNutrition } from '../src/engine.js';

const row = (o) => ({ nutConSrtrQua: '100g', ...o });
const BIGMAC = row({ foodNm: '빅맥', mfrNm: '한국맥도날드(유)', foodSize: '213g', enerc: '250', prot: '12', fatce: '12', chocdf: '24', sugar: '4', nat: '420', fasat: '4.5', crtrYmd: '2025-06-01' });
const OLD_BIGMAC = { ...BIGMAC, enerc: '260', crtrYmd: '2023-01-01' };
const WHOPPER = row({ foodNm: '와퍼', mfrNm: '비케이알(주)', foodSize: '277g', enerc: '222', prot: '10.1', fatce: '12.3', chocdf: '17.6', sugar: '3.9', nat: '331', crtrYmd: '2025-03-01' });
const KIMCHI = row({ foodNm: '배추김치', mfrNm: '', enerc: '18', prot: '1.5', fatce: '0.5', chocdf: '3' });
const OTHER = row({ foodNm: '불고기버거', mfrNm: '어느식품', enerc: '250', prot: '11', fatce: '11', chocdf: '27' });

test('수량 읽기 · 열량 검산', () => {
  assert.deepEqual(parseQty('213g'), { n: 213, unit: 'g' });
  assert.deepEqual(parseQty('355 ml'), { n: 355, unit: 'ml' });
  assert.deepEqual(parseQty('1인분(250g)'), { n: 250, unit: 'g' }, '괄호 안 중량을 우선');
  assert.equal(parseQty(''), null);
  assert.equal(atwaterOk({ kcal: 250, carb: 24, protein: 12, fat: 12 }), true);   // 96+48+108=252
  assert.equal(atwaterOk({ kcal: 250, carb: 12, protein: 24, fat: 1 }), false);   // 필드가 뒤바뀐 경우
  assert.equal(atwaterOk({ kcal: 250, carb: null, protein: 12, fat: 12 }), null);
});

test('우리 브랜드만, 100g 기준 → 1개(식품중량) 기준으로 환산', () => {
  const b = toItem(BIGMAC);
  assert.equal(b.brand, '맥도날드');
  assert.equal(b.name, '빅맥');
  assert.equal(b.serving, '213g');
  assert.equal(b.kcal, 533);           // 250 × 2.13
  assert.equal(b.sodium_mg, 895);      // 420 × 2.13
  assert.equal(b.sat_fat_g, 9.6);
  assert.equal(toItem(WHOPPER).brand, '버거킹', '업체명(비케이알)으로 브랜드 판단');
  assert.equal(toItem(KIMCHI), null);
  assert.equal(toItem(OTHER), null, '다른 업체의 같은 이름 메뉴는 버림');
});

test('같은 메뉴는 최신 기준일 하나만, 검산 실패한 행은 제외', () => {
  const bad = row({ foodNm: '맥너겟', mfrNm: '한국맥도날드', foodSize: '100g', enerc: '900', prot: '10', fatce: '5', chocdf: '10' });
  const r = buildNutrition([OLD_BIGMAC, BIGMAC, WHOPPER, KIMCHI, bad]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map((x) => x.name).sort(), ['빅맥', '와퍼']);
  assert.equal(r.items.find((x) => x.name === '빅맥').kcal, 533, '2025 자료 사용');
  assert.deepEqual(r.stats.byBrand, { 맥도날드: 2, 버거킹: 1 });
  assert.equal(Object.keys(r.items[0]).includes('_check'), false);
});

test('필드 이름이 안 맞으면(검산 대부분 실패) 시트에 쓰지 않고 멈춤', () => {
  const swapped = Array.from({ length: 6 }, (_, i) => row({ foodNm: `메뉴${i}`, mfrNm: '한국맥도날드', enerc: '250', prot: '30', fatce: '20', chocdf: '40' }));
  const r = buildNutrition(swapped);
  assert.equal(r.ok, false);
  assert.match(r.reason, /열량 검산/);
  assert.equal(buildNutrition([KIMCHI]).ok, false);
  // 필드 이름을 설정으로 고칠 수 있음
  const renamed = [{ FOOD: '빅맥', MAKER: '한국맥도날드', nutConSrtrQua: '100g', foodSize: '213g', enerc: '250', prot: '12', fatce: '12', chocdf: '24' }];
  const fixed = buildNutrition(renamed, { env: { NUTRITION_FIELD_MAP: JSON.stringify({ name: 'FOOD', maker: 'MAKER' }) } });
  assert.equal(fixed.items[0].name, '빅맥');
});

test('공공데이터 API: 여러 쪽 넘기기, 인증 오류(XML)는 알아보기 쉽게', async () => {
  const pages = [[BIGMAC, KIMCHI], [WHOPPER]];
  const seen = [];
  const fake = async (u) => {
    seen.push(String(u));
    const p = +new URL(u).searchParams.get('pageNo');
    return new Response(JSON.stringify({ response: { header: { resultCode: '00' }, body: { totalCount: 3, items: pages[p - 1] || [] } } }), { status: 200 });
  };
  const rows = await fetchAllRows({ key: 'k', perPage: 2, fetchImpl: fake });
  assert.equal(rows.length, 3);
  assert.equal(seen.length, 2);
  assert.match(seen[0], /serviceKey=k/);
  const xml = async () => new Response('<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>', { status: 200 });
  await assert.rejects(fetchAllRows({ key: 'x', fetchImpl: xml }), /SERVICE_KEY_IS_NOT_REGISTERED_ERROR/);
});

test('전체 실행: 키 없으면 건너뜀, 최근에 갱신했으면 건너뜀, 아니면 시트 교체', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'among-nut-'));
  const calls = [];
  const sheet = (updated) => ({
    get: async () => ({ ok: true, nutrition_updated_at: updated }),
    post: async (action, payload) => { calls.push({ action, n: payload.items.length }); return { ok: true, result: { count: payload.items.length } }; },
  });
  const api = async () => new Response(JSON.stringify({ response: { header: { resultCode: '00' }, body: { totalCount: 2, items: [BIGMAC, WHOPPER] } } }));
  const now = new Date('2026-10-27T03:00:00Z');
  assert.equal((await runNutrition({ env: { OUT_DIR: outDir }, quiet: true })).state, 'skipped');
  const recent = await runNutrition({ env: { OUT_DIR: outDir, DATA_GO_KR_KEY: 'k' }, now, sheet: sheet('2026-10-24T00:00:00Z'), fetchImpl: api, quiet: true });
  assert.equal(recent.state, 'skipped');
  assert.match(recent.reason, /3일 전/);
  const forced = await runNutrition({ env: { OUT_DIR: outDir, DATA_GO_KR_KEY: 'k', FORCE: '1' }, now, sheet: sheet('2026-10-24T00:00:00Z'), fetchImpl: api, quiet: true });
  assert.equal(forced.state, 'success');
  assert.deepEqual(calls, [{ action: 'nutrition_ingest', n: 2 }]);
});

test('내려받은 CSV 파일(한글 머리글)로도 가져오기 → 쿠폰 메뉴와 매칭', () => {
  const dir = mkdtempSync(join(tmpdir(), 'among-nut-'));
  const f = join(dir, 'food.csv');
  writeFileSync(f, '﻿식품명,업체명,영양성분함량기준량,식품중량,에너지(kcal),단백질(g),지방(g),탄수화물(g),당류(g),나트륨(mg)\n'
    + '"불고기버거",한국맥도날드(유),100g,149g,259,11.5,10.7,27.5,6,480\n'
    + '"아이스 드립 커피",한국맥도날드(유),100ml,400ml,1,0.1,0,0.2,0,2\n'
    + '김치찌개,,100g,,40,3,2,3,1,400\n');
  const rows = readFileRows(f);
  assert.equal(rows.length, 3);
  const r = buildNutrition(rows);
  assert.equal(r.items.length, 2);
  const m = matchNutrition({ brand: '맥도날드', menu: '불고기 버거', item_type: '단품' }, r.items);
  assert.equal(m.item.kcal, 386);  // 259 × 1.49
  assert.equal(m.item.serving, '149g');
  const coffee = matchNutrition({ brand: '맥도날드', menu: '아이스 드립 커피 M', item_type: '단품' }, r.items);
  assert.equal(coffee.basis, 'size');
  assert.equal(coffee.item.serving, '400ml');
});
