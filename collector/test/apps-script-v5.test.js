// v5: 소식(news) 탭 · 쿠폰 사진 주소 · 공개 API에 소식 포함
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAppsScript } from './gas-harness.js';

const CODE = new URL('../../apps-script/Code.gs', import.meta.url).pathname;
const T0 = Date.parse('2026-10-28T03:00:00Z'); // KST 10/28 12:00

/** 운영 중인 v4 시트: v4 머리글, SCHEMA_VERSION=4, news 탭 없음 */
function bootV4() {
  const gas = loadAppsScript(CODE, { now: T0 });
  gas.ctx.setup();
  // v4 머리글로 되돌림 (image_url 없음), news 탭 제거
  const c = gas.sheet('coupons');
  c.data = [c.data[0].filter((h) => h !== 'image_url')];
  gas.sheets.delete('news');
  gas.props.set('SCHEMA_VERSION', '4');
  gas.props.set('COLLECTOR_TOKEN', 'tok');
  return gas;
}

const coupon = (o = {}) => ({
  id: 'c_1', status: 'published', brand: '도미노피자', category: '피자', menu: '모든 피자', item_type: '기타', discount_type: 'percent',
  discount_value: 40, discount_rate: 40, channels: ['픽업'], audience: '전체', app_only: false, end_date: '2026-11-30',
  source_id: 'dominos-event', source_url: 'https://d.kr/event', programs: [], hash: 'h1', image_url: 'https://d.kr/img/pizza.jpg', ...o,
});
const news = (o = {}) => ({
  id: 'n_1', status: 'published', brand: '도미노피자', category: '피자', title: '도미노피자 화요일 포장 40%', summary: '매주 화요일 모든 피자 포장 40% 할인',
  discount_label: '40%', start_date: '2026-10-28', end_date: '2026-11-30', programs: [], image_url: 'https://d.kr/img/pizza.jpg', related_ids: ['c_1'],
  evidence: '모든 피자 포장 40% 할인', issues: [], confidence: 0.9, source_id: 'dominos-event', source_url: 'https://d.kr/event', hash: 'nh1', ...o,
});

test('v4 시트 → v5: 쿠폰 사진 열은 끝에, news 탭 생성, 소식과 사진이 공개 API에 나옴', () => {
  const gas = bootV4();
  const r = gas.post({ action: 'ingest', token: 'tok', run_id: 'r1', coupons: [coupon()], news: [news()], sources_ok: ['dominos-event'] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(gas.props.get('SCHEMA_VERSION'), '6');
  assert.equal(gas.sheet('coupons').data[0].at(-1), 'image_url');
  assert.ok(gas.sheet('news'));
  assert.deepEqual(r.result.news, { inserted: 1, updated: 0, unchanged: 0, gone: 0, expired: 0 });
  const pub = gas.get({ action: 'coupons' });
  assert.equal(pub.coupons[0].image_url, 'https://d.kr/img/pizza.jpg');
  assert.equal(pub.news.length, 1);
  assert.deepEqual(pub.news[0].related_ids, ['c_1']);
  assert.deepEqual(pub.news[0].programs, []);
  assert.equal(pub.news[0].title, '도미노피자 화요일 포장 40%');
  assert.ok(!('evidence' in pub.news[0]), '근거 원문·내부 필드는 공개하지 않음');
});

test('소식 반영 규칙: 같은 id는 수정, 성공한 출처에서 안 보이면 사라짐, 실패한 출처는 그대로, 기간 지나면 만료, 숨김은 유지', () => {
  const gas = bootV4();
  gas.post({ action: 'ingest', token: 'tok', run_id: 'r1', coupons: [coupon()], news: [news(), news({ id: 'n_2', source_id: 'kfc-promo', brand: 'KFC', hash: 'k' }), news({ id: 'n_3', hash: 'x', end_date: '2026-10-28' })], sources_ok: ['dominos-event', 'kfc-promo'] });
  // 다음 실행: n_1 제목 수정, n_2 출처(kfc)는 실패, n_3은 안 보임
  const r = gas.post({ action: 'ingest', token: 'tok', run_id: 'r2', coupons: [coupon()], news: [news({ title: '새 제목', hash: 'nh2' })], sources_ok: ['dominos-event'] });
  assert.equal(r.result.news.updated, 1);
  assert.equal(r.result.news.gone, 1);
  const rows = Object.fromEntries(gas.sheet('news').objects().map((o) => [o.id, o]));
  assert.equal(rows.n_1.title, '새 제목');
  assert.equal(rows.n_2.status, 'published', '실패한 출처의 소식은 건드리지 않음');
  assert.equal(rows.n_3.status, 'gone');
  // 대표가 숨긴 소식은 다시 수집돼도 숨김 유지
  const sh = gas.sheet('news');
  const ci = sh.data[0].indexOf('status');
  sh.data.find((row) => row[0] === 'n_1')[ci] = 'hidden';
  gas.post({ action: 'ingest', token: 'tok', run_id: 'r3', coupons: [coupon()], news: [news({ title: '또 다른 제목', hash: 'nh3' })], sources_ok: ['dominos-event'] });
  assert.equal(gas.sheet('news').objects().find((o) => o.id === 'n_1').status, 'hidden');
  assert.equal(gas.get({ action: 'coupons' }).news.length, 1, '숨긴 소식은 공개하지 않음 (KFC 소식만)');
  // 예전 수집기(news 없음)는 소식 탭을 건드리지 않음
  const before = JSON.stringify(gas.sheet('news').data);
  const old = gas.post({ action: 'ingest', token: 'tok', run_id: 'r4', coupons: [coupon()], sources_ok: ['dominos-event', 'kfc-promo'] });
  assert.equal(old.result.news, undefined);
  assert.equal(JSON.stringify(gas.sheet('news').data), before);
});

test('지난 소식은 공개 API에서 빠지고 다음 반영 때 만료', () => {
  const gas = bootV4();
  gas.post({ action: 'ingest', token: 'tok', run_id: 'r1', coupons: [coupon()], news: [news({ end_date: '2026-10-27' })], sources_ok: [] });
  assert.equal(gas.get({ action: 'coupons' }).news.length, 0);
  assert.equal(gas.sheet('news').objects()[0].status, 'expired');
});
