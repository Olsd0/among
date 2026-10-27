// v4: 자동 마이그레이션 · 통신사 혜택 필드 · 영양성분 API · 00시 정시 수집
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAppsScript } from './gas-harness.js';
import { normalizeAndValidate } from '../src/engine.js';
import { couponId, contentHash } from '../src/ids.js';

const CODE = new URL('../../apps-script/Code.gs', import.meta.url).pathname;
const T0 = Date.parse('2026-10-27T03:00:00Z'); // KST 10/27 12:00
const DAY = 24 * 3600 * 1000;

const OLD_COUPON_HEADERS = ['id', 'status', 'brand', 'category', 'menu', 'item_type', 'regular_price', 'coupon_price', 'discount_rate',
  'discount_type', 'discount_value', 'max_discount', 'min_order', 'channels', 'audience', 'app_only',
  'start_date', 'end_date', 'conditions', 'confidence', 'issues', 'evidence', 'source_id', 'source_url',
  'official_link', 'first_seen', 'checked_at', 'updated_at', 'hash', 'last_run_id'];
const OLD_SOURCE_HEADERS = ['id', 'active', 'brand', 'category', 'url', 'selector', 'exclude', 'follow', 'detail_selector',
  'max_follow', 'max_shots', 'wait_ms', 'official_link', 'notes', 'last_ok_at', 'last_error'];

/** 운영 중인 v3 시트를 흉내: 예전 머리글 + 실제 행, SCHEMA_VERSION 없음 */
function bootV3() {
  const gas = loadAppsScript(CODE, { now: T0 });
  const ss = gas.ctx.SpreadsheetApp.getActiveSpreadsheet();
  const mk = (name, rows) => { const sh = ss.insertSheet(name); sh.data = rows.map((r) => [...r]); return sh; };
  const row = Object.fromEntries(OLD_COUPON_HEADERS.map((h) => [h, '']));
  Object.assign(row, { id: 'c_old1', status: 'published', brand: '맥도날드', category: '햄버거', menu: '불고기 버거', coupon_price: '2500', channels: '매장,픽업', app_only: 'FALSE', end_date: '2026-11-10', source_id: 'mcd-promo' });
  mk('coupons', [OLD_COUPON_HEADERS, OLD_COUPON_HEADERS.map((h) => row[h])]);
  mk('sources', [OLD_SOURCE_HEADERS, ['mcd-promo', 'TRUE', '맥도날드', '햄버거', 'https://www.mcdonalds.co.kr/kor/promotion/list', '', '', '', '', '5', '3', '1500', '', '', '', '']]);
  mk('run_log', [['run_id', 'trigger', 'state']]);
  mk('events', [['ts', 'sid', 'type', 'coupon_id', 'brand', 'value']]);
  mk('reports', [['ts', 'sid', 'coupon_id', 'brand', 'menu', 'reason', 'memo', 'status']]);
  gas.props.set('COLLECTOR_TOKEN', 'tok');
  gas.props.set('ADMIN_TOKEN', 'adm');
  return gas;
}

test('자동 마이그레이션: 새 열은 끝에, 기존 데이터 그대로, nutrition 탭·새 출처 추가, 한 번만', () => {
  const gas = bootV3();
  const before = gas.sheet('coupons').objects()[0];
  const pub = gas.get({ action: 'coupons' });
  assert.equal(pub.ok, true);
  assert.equal(pub.count, 1);
  assert.deepEqual(pub.coupons[0].programs, [], '예전 행은 프로그램 없음');
  const h = gas.sheet('coupons').data[0];
  assert.deepEqual(h.slice(0, OLD_COUPON_HEADERS.length), OLD_COUPON_HEADERS, '기존 열 순서 유지');
  assert.deepEqual(h.slice(OLD_COUPON_HEADERS.length), ['programs', 'program_note', 'how_to_use', 'stackable']);
  const after = gas.sheet('coupons').objects()[0];
  for (const k of OLD_COUPON_HEADERS) assert.equal(after[k], before[k], k);
  assert.deepEqual(gas.sheet('sources').data[0].slice(-2), ['program', 'follow_text']);
  const ids = gas.sheet('sources').objects().map((o) => o.id);
  assert.ok(ids.includes('tmembership-brand') && ids.includes('kt-membership-food') && ids.includes('paris-promo'));
  assert.equal(ids.filter((i) => i === 'mcd-promo').length, 1, '기존 출처는 다시 넣지 않음');
  const kt = gas.sheet('sources').objects().find((o) => o.id === 'kt-membership-food');
  assert.equal(kt.program, 'KT');
  assert.ok(kt.follow_text.includes('도미노'));
  assert.ok(gas.sheet('nutrition'));
  assert.equal(gas.props.get('SCHEMA_VERSION'), '4');
  // 사용자가 출처를 지워도 다음 요청에서 되살리지 않음
  const src = gas.sheet('sources');
  src.data = src.data.filter((r) => r[0] !== 'npay-cafe');
  gas.get({ action: 'status' });
  assert.ok(!gas.sheet('sources').objects().some((o) => o.id === 'npay-cafe'));
});

test('통신사 혜택 저장·공개: programs 배열, 설명, 사용법, 중복 여부', () => {
  const gas = bootV3();
  const now = new Date(T0);
  const c = normalizeAndValidate({
    menu: '모든 피자', discount_type: 'percent', discount_value: 50, channels: ['픽업'], audience: '멤버십', end_date: '2026-10-31',
    evidence: 'KT 달.달.혜택 방문포장 50%', evidence_source: 'image', confidence: 0.9, program_note: 'VVIP 초이스 별도',
    how_to_use: 'KT 멤버십 앱에서 쿠폰 받기 → 도미노 앱 포장 주문 때 쿠폰번호 입력', conditions: '다른 쿠폰·할인과 중복 불가',
  }, { now, brand: '도미노피자', category: '피자', sourceId: 'kt-membership-food', sourceUrl: 'https://membership.kt.com/x' });
  c.id = couponId(c); c.hash = contentHash(c);
  const r = gas.post({ action: 'ingest', token: 'tok', run_id: 'r1', coupons: [c], sources_ok: ['kt-membership-food'] });
  assert.equal(r.result.inserted, 1);
  const pub = gas.get({ action: 'coupons' }).coupons.find((x) => x.brand === '도미노피자');
  assert.deepEqual(pub.programs, ['KT']);
  assert.equal(pub.program_note, 'VVIP 초이스 별도');
  assert.match(pub.how_to_use, /쿠폰번호/);
  assert.equal(pub.stackable, 'no');
  assert.equal(gas.sheet('coupons').objects().find((o) => o.brand === '도미노피자').programs, 'KT');
});

test('영양성분: 수집기가 표 전체를 교체, 공개 API는 숫자로, 빈 목록은 거절', () => {
  const gas = bootV3();
  const items = [
    { brand: '맥도날드', name: '불고기버거', serving: '1개(149g)', kcal: 386, protein_g: 17.2, fat_g: 16, sat_fat_g: 5.1, carb_g: 41, sugar_g: 9, sodium_mg: 715, source: '식약처 식품영양성분DB' },
    { brand: '버거킹', name: '와퍼', serving: '1개(277g)', kcal: 616, protein_g: 28, sugar_g: 11, sodium_mg: 916, source: '식약처 식품영양성분DB' },
  ];
  assert.equal(gas.post({ action: 'nutrition_ingest', token: 'bad', items }).error, 'unauthorized');
  const r = gas.post({ action: 'nutrition_ingest', token: 'tok', items });
  assert.deepEqual(r.result, { count: 2, brands: { 맥도날드: 1, 버거킹: 1 } });
  const n = gas.get({ action: 'nutrition' });
  assert.equal(n.count, 2);
  assert.equal(n.items[0].kcal, 386);
  assert.equal(n.items[1].fat_g, null, '빈 값은 null');
  assert.ok(n.updated_at);
  assert.match(gas.post({ action: 'nutrition_ingest', token: 'tok', items: [] }).error, /비어 있음/);
  assert.equal(gas.get({ action: 'nutrition' }).count, 2, '빈 목록으로 지워지지 않음');
  assert.ok(gas.get({ action: 'status' }).nutrition_updated_at);
});

test('00시 정시 수집: 트리거 1개만 설치, 오늘 이미 성공했으면 건너뜀, 아니면 GitHub 호출', () => {
  const gas = bootV3();
  gas.ctx.installTriggers();
  gas.ctx.installTriggers();
  assert.equal(gas.triggers.length, 1);
  assert.deepEqual({ fn: gas.triggers[0].fn, hour: gas.triggers[0].hour, tz: gas.triggers[0].tz }, { fn: 'scheduledCollect', hour: 0, tz: 'Asia/Seoul' });

  assert.match(gas.ctx.scheduledCollect(), /GITHUB_TOKEN/, '토큰 없으면 호출하지 않고 이유 반환');
  gas.props.set('GITHUB_TOKEN', 'ghp'); gas.props.set('GITHUB_REPO', 'Olsd0/among');
  gas.props.set('LAST_SUCCESS_AT', new Date(T0 - DAY).toISOString());
  assert.equal(gas.ctx.scheduledCollect(), 'dispatched');
  assert.deepEqual(JSON.parse(gas.fetches.at(-1).opts.payload).inputs, { trigger: 'schedule' });
  assert.equal(gas.get({ action: 'status' }).state, 'queued');
  assert.equal(gas.ctx.scheduledCollect(), 'skip: 실행 중');
  gas.post({ action: 'run_finish', token: 'tok', report: { run_id: 'r', state: 'success', finished_at: new Date(T0).toISOString(), summary: {}, sources: [] } });
  assert.equal(gas.ctx.scheduledCollect(), 'skip: 오늘 이미 수집함');
  assert.equal(gas.fetches.length, 1);
});
