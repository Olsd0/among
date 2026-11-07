// 온라인 특가 공통 규칙·호출 규칙 (모의 데이터 검증 — 실제 공급처 연결 아님)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  OD_SUPPLIERS, OD_HOLD_LABELS, odNormalize, odRules, odEvaluate, odMerge, odPrune, odPublic, odClientItem,
  odShippingText, odLink, odIsAffiliateLink, odAfterFailure, odSupplierStates, odVisibleUntil,
} from '../src/online-deals-core.js';
import { createHttpClient, parseRetryAfter, RateLimitError, HttpError, safeError } from '../src/online/http.js';
import { ADAPTERS } from '../src/online/suppliers.js';
import { candidate, OD_T0, MIN, HOUR } from './online-fixtures.js';

const iso = t => new Date(t).toISOString();
const publish = { coupang: { mode: 'publish' }, linkprice: { mode: 'publish' } };
function rec(over = {}, recOver = {}) {
  const item = odNormalize(candidate(over), over.supplier || 'coupang');
  assert.ok(item, '정상 후보는 정리돼야 함');
  return { key: item.key, id: item.id, supplier: item.supplier, item, hidden: false, hiddenReason: '', hiddenAt: '',
    categoryOverride: '', overrideUntil: '', firstSeenAt: iso(OD_T0), lastReceivedAt: iso(OD_T0), ...recOver };
}
const evalOne = (r, ctx = {}) => odEvaluate([r], { rules: ctx.rules, suppliers: ctx.suppliers || publish, now: ctx.now ?? OD_T0 + MIN })[0];

test('표준 후보 정리: 식별값·관측 시각이 없으면 버리고, 같은 결과를 다시 넣어도 같다', () => {
  const a = odNormalize(candidate(), 'coupang');
  assert.match(a.id, /^od_[0-9a-z]{11}$/);
  assert.equal(a.key, 'coupang:MOCK-1001::');
  assert.deepEqual(odNormalize(a, 'coupang'), a, '두 번 정리해도 같음 (Apps Script가 다시 검사)');
  for (const bad of [{ supplierItemId: '' }, { supplierItemId: '<script>' }, { optionKey: 'a b' }, { observedAt: '' }, { observedAt: '2026-11-05' }]) {
    assert.equal(odNormalize(candidate(bad), 'coupang'), null, JSON.stringify(bad));
  }
  assert.equal(odNormalize(candidate(), 'unknown-supplier'), null);
  assert.equal(odNormalize(null, 'coupang'), null);
  // 회원 가격은 다른 혜택, 조건 문구 변경은 같은 기록
  assert.notEqual(odNormalize(candidate({ membership: '와우회원' }), 'coupang').key, a.key);
  assert.equal(odNormalize(candidate({ conditions: ['바뀐 문구'] }), 'coupang').key, a.key);
  // 제어문자·방향 바꾸기 문자는 제거
  assert.equal(odNormalize(candidate({ title: '생수\u202e\u0000 2L' }), 'coupang').title, '생수 2L');
});

test('가격 규칙: 실구매가(원화 정수)만 게시하고 단위가·할인액·적립금·최소주문금액·개인별 가격은 보류', () => {
  assert.equal(evalOne(rec()).status, 'published');
  const holds = over => evalOne(rec(over)).holds;
  for (const price of ['7900', 0, -1, 7.5, null, 20000000]) assert.ok(holds({ price }).includes('BAD_PRICE'), String(price));
  assert.ok(holds({ currency: 'USD' }).includes('BAD_CURRENCY'));
  assert.ok(holds({ currency: '' }).includes('BAD_CURRENCY'));
  for (const priceBasis of ['unit', 'discount', 'points', 'min_order', 'unknown', 'whatever']) assert.ok(holds({ priceBasis }).includes('PRICE_NOT_TOTAL'), priceBasis);
  assert.ok(holds({ optionPrice: 'varies' }).includes('OPTION_PRICE_UNCLEAR'));
  assert.ok(holds({ optionPrice: 'unknown' }).includes('OPTION_PRICE_UNCLEAR'));
  assert.deepEqual(holds({ optionPrice: 'varies', optionKey: 'OPT-2L-12' }), [], '옵션이 특정되면 게시');
  assert.ok(holds({ personalized: true }).includes('PERSONAL_PRICE'));
  assert.ok(holds({ personalized: null }).includes('PERSONAL_PRICE'), '개인별 여부를 모르면 보류');
});

test('조건은 자르지 않고, 빈·긴·불완전 조건은 보류', () => {
  const long = '가'.repeat(300);
  assert.deepEqual(rec({ conditions: [long] }).item.conditions, [long], '300자는 그대로');
  for (const over of [{ conditionsComplete: false }, { conditions: ['가'.repeat(301)] }, { conditions: ['조건', ''] }, { conditions: Array(9).fill('조건') }, { conditions: 'x' }]) {
    assert.ok(evalOne(rec(over)).holds.includes('CONDITION_UNCLEAR'), JSON.stringify(over).slice(0, 60));
  }
  assert.deepEqual(evalOne(rec({ conditions: [] })).holds, [], '조건 없음은 공급처가 완전하다고 확인했을 때만 게시');
});

test('배송비: 모르면 무료로 표시하지 않는다', () => {
  assert.equal(odShippingText(rec({ shipping: 'unknown' }).item), '배송비 확인 필요');
  assert.equal(odShippingText(rec({ shipping: 'nonsense' }).item), '배송비 확인 필요');
  assert.equal(odShippingText(rec({ shipping: 'free' }).item), '무료배송');
  assert.equal(odShippingText(rec({ shipping: 'paid', shippingFee: 3000 }).item), '배송비 3000원');
  assert.equal(odShippingText(rec({ shipping: 'paid' }).item), '배송비 별도');
  assert.equal(odShippingText(rec({ shipping: 'conditional', shippingThreshold: 19800 }).item), '19800원 이상 구매 시 무료배송');
  assert.match(odShippingText(rec({ shipping: 'conditional' }).item), /확인 필요/);
});

test('링크: 공급처별 허용 HTTPS 호스트만, 계정·포트·토큰·개인 쿠폰 정보 금지, 승인 전 링크프라이스는 전부 보류', () => {
  assert.equal(odLink('https://link.coupang.com/a/abc?subId=among', 'coupang'), 'https://link.coupang.com/a/abc?subId=among');
  assert.equal(odLink('https://WWW.COUPANG.COM/vp/products/1', 'coupang'), 'https://WWW.COUPANG.COM/vp/products/1');
  // 파트너스 추적 코드가 있으면 AMONG의 ID(AF1327603)여야 한다
  assert.equal(OD_SUPPLIERS.coupang.partnerId, 'AF1327603');
  assert.equal(odLink('https://www.coupang.com/np/goldbox?lptag=AF1327603&subid=among', 'coupang'), 'https://www.coupang.com/np/goldbox?lptag=AF1327603&subid=among');
  for (const url of ['https://www.coupang.com/np/goldbox?lptag=AF0000001', 'https://www.coupang.com/np/goldbox?LPTAG=AF0000001', 'https://www.coupang.com/np/goldbox?%6Cptag=AF0000001', 'https://www.coupang.com/np/goldbox?lptag=']) {
    assert.equal(odLink(url, 'coupang'), '', url);
  }
  assert.equal(odIsAffiliateLink('https://link.coupang.com/a/abc'), true);
  assert.equal(odIsAffiliateLink('https://www.coupang.com/np/goldbox?lptag=AF1327603'), true);
  assert.equal(odIsAffiliateLink('https://www.coupang.com/np/goldbox'), false);
  for (const url of ['javascript:alert(1)', 'http://www.coupang.com/', 'https://coupang.com.attacker.test/', 'https://user:pass@www.coupang.com/',
    'https://www.coupang.com:8443/', 'https://www.coupang.com/?%74oken=secret', 'https://www.coupang.com/?coupon_code=abc',
    'https://www.coupang.com\\@attacker.test/', 'https://www.coupang.com/ x', 'https://www.coupang.com/?%E0%A4%A=1', '//www.coupang.com/']) {
    assert.equal(odLink(url, 'coupang'), '', url);
  }
  assert.ok(evalOne(rec({ url: 'https://attacker.test/a' })).holds.includes('BAD_LINK'));
  assert.deepEqual(OD_SUPPLIERS.linkprice.linkHosts, [], '링크프라이스 링크 주소는 승인 후 문서로 확인');
  const lp = evalOne(rec({ supplier: 'linkprice', url: 'https://click.linkprice.com/x' }));
  assert.ok(lp.holds.includes('BAD_LINK'));
});

test('분류·판매자·키워드 규칙: 경로 단계가 정확히 같아야 연결, 운영자 지정은 기한까지', () => {
  assert.equal(evalOne(rec()).category, 'food');
  assert.equal(evalOne(rec({ categoryPath: '생활용품 > 세제' })).category, 'household');
  const appliance = evalOne(rec({ categoryPath: '가전디지털 > 냉장고/냉동고 > 식품 보관' }));
  assert.equal(appliance.category, '', '부분 일치(식품 보관)로 식품이 되지 않음');
  assert.ok(appliance.holds.includes('CATEGORY_UNMAPPED'));
  assert.ok(evalOne(rec({ categoryPath: '생활용품 > 세제' })).holds.includes('CATEGORY_EXCLUDED'), '11/06 대표 결정: 먹거리만 게시');
  assert.deepEqual(OD_DEFAULT_RULES.includeCategories, ['food']);
  assert.deepEqual(odRules({ includeCategories: ['food', 'household'] }).includeCategories, ['food'], '관리 화면에서 생활용품을 켜도 먹거리만');
  const override = rec({ categoryPath: '가전디지털' }, { categoryOverride: 'food', overrideUntil: iso(OD_T0 + HOUR) });
  assert.equal(evalOne(override).status, 'published');
  assert.ok(evalOne(override, { now: OD_T0 + 2 * HOUR }).holds.includes('CATEGORY_UNMAPPED'), '기한이 지나면 규칙으로 돌아감');
  assert.ok(evalOne(rec({}, { categoryOverride: 'excluded' })).holds.includes('CATEGORY_EXCLUDED'));
  assert.ok(evalOne(rec(), { rules: { includeCategories: ['household'] } }).holds.includes('CATEGORY_EXCLUDED'));
  assert.ok(evalOne(rec(), { rules: { excludeSellers: ['테스트 판매자'] } }).holds.includes('SELLER_EXCLUDED'));
  assert.ok(evalOne(rec({ seller: '' })).holds.includes('SELLER_UNKNOWN'));
  assert.ok(evalOne(rec({ title: '테스트 전자담배 액상' })).holds.includes('KEYWORD_EXCLUDED'));
  assert.ok(evalOne(rec(), { rules: { excludeKeywords: ['생수'] } }).holds.includes('KEYWORD_EXCLUDED'));
  assert.ok(evalOne(rec(), { rules: { categoryKeywords: { food: ['식품 '], household: [] } } }).category === 'food', '앞뒤 공백 정리');
});

test('규칙 입력 정리: 허용 범위 밖 값은 기본값, 목록 길이 제한', () => {
  const r = odRules({ includeCategories: ['food', 'weapons'], excludeKeywords: ['a', 'a', '', 'x'.repeat(31), ...Array(120).fill(0).map((_, i) => 'k' + i)], maxItems: 999, maxAgeHours: 0 });
  assert.deepEqual(r.includeCategories, ['food']);
  assert.equal(r.excludeKeywords.length, 100);
  assert.equal(r.excludeKeywords[0], 'a');
  assert.equal(r.maxItems, 30);
  assert.equal(r.maxAgeHours, 6);
  assert.equal(odRules({ maxAgeHours: 48 }).maxAgeHours, 6, '재확인 기한은 24시간을 넘지 않음');
  assert.deepEqual(odRules('nope'), odRules());
  assert.deepEqual(odRules({ includeCategories: [] }).includeCategories, [], '분류를 모두 끄면 아무것도 게시하지 않음');
});

test('공급처 모드: 새 공급처는 관찰(비공개)로 시작, 끄기·관찰은 보류', () => {
  assert.equal(odSupplierStates().coupang.mode, 'observe');
  assert.equal(odSupplierStates({ coupang: { mode: 'hack' } }).coupang.mode, 'observe');
  assert.deepEqual(evalOne(rec(), { suppliers: {} }).holds, ['SUPPLIER_OBSERVE']);
  assert.deepEqual(evalOne(rec(), { suppliers: { coupang: { mode: 'off' } } }).holds, ['SUPPLIER_OFF']);
  assert.equal(evalOne(rec(), { suppliers: { coupang: { mode: 'publish' } } }).status, 'published');
});

test('기간: 실제 행사 종료와 AMONG 재확인 기한을 따로 보고, 이른 쪽에서 내린다', () => {
  const r = rec({ endsAt: iso(OD_T0 + 2 * HOUR) });
  assert.equal(odVisibleUntil(r, odRules()), OD_T0 + 2 * HOUR, '행사 종료가 먼저');
  assert.equal(odVisibleUntil(rec(), odRules()), OD_T0 + 6 * HOUR, '종료를 모르면 마지막 확인 + 6시간');
  assert.equal(evalOne(r, { now: OD_T0 + 2 * HOUR }).status, 'ended');
  assert.equal(evalOne(rec(), { now: OD_T0 + 6 * HOUR }).status, 'stale');
  assert.equal(evalOne(rec(), { now: OD_T0 + 6 * HOUR - 1 }).status, 'published');
  assert.equal(evalOne(rec({ startsAt: iso(OD_T0 + HOUR) })).status, 'scheduled');
  assert.equal(evalOne(rec({ availability: 'sold_out' })).status, 'ended');
  assert.equal(evalOne(rec({ availability: 'ended' })).status, 'ended');
  assert.equal(evalOne(rec({}, { hidden: true })).status, 'hidden');
  assert.equal(evalOne(rec(), { rules: { maxAgeHours: 1 }, now: OD_T0 + HOUR }).status, 'stale');
});

test('중복·상한: 같은 상품은 가장 최근 확인 하나만, 상한을 넘으면 보류', () => {
  const older = rec({ supplierItemId: 'A1' }, { lastReceivedAt: iso(OD_T0 - HOUR) });
  const newer = rec({ supplierItemId: 'A2', title: '테스트  생수 (2L)' });
  const other = rec({ supplierItemId: 'B1', title: '다른 상품' });
  const ev = odEvaluate([older, newer, other], { suppliers: publish, now: OD_T0 + MIN });
  assert.deepEqual(ev.map(r => r.status), ['held', 'published', 'published']);
  assert.deepEqual(ev[0].holds, ['DUPLICATE']);
  const many = Array.from({ length: 5 }, (_, i) => rec({ supplierItemId: 'M' + i, title: '상품 ' + i }));
  const capped = odEvaluate(many, { rules: { maxItems: 3 }, suppliers: publish, now: OD_T0 + MIN });
  assert.equal(capped.filter(r => r.status === 'published').length, 3);
  assert.equal(capped.filter(r => r.holds.includes('OVER_LIMIT')).length, 2);
  for (const code of new Set(capped.concat(ev).flatMap(r => r.holds))) assert.ok(OD_HOLD_LABELS[code], code);
});

test('반영: 실패·빈 응답은 아무것도 지우지 않고, 응답에 없는 상품도 품절로 보지 않는다', () => {
  const base = [rec({ supplierItemId: 'KEEP-1' }), rec({ supplierItemId: 'KEEP-2', title: '두 번째' })];
  for (const run of [{ supplier: 'coupang', ok: false }, { supplier: 'coupang', ok: true, items: [] }, { supplier: 'coupang', ok: true, items: [{ junk: true }] }]) {
    const m = odMerge(base, { ...run, observedAt: iso(OD_T0 + HOUR) }, OD_T0 + HOUR);
    assert.equal(m.stats.skipped, true);
    assert.deepEqual(m.records, base);
  }
  const m = odMerge(base, { supplier: 'coupang', ok: true, observedAt: iso(OD_T0 + HOUR), items: [candidate({ supplierItemId: 'KEEP-1', price: 6900 }), candidate({ supplierItemId: 'NEW-1', title: '새 상품' }), candidate({ supplierItemId: 'NEW-1', title: '새 상품' })] }, OD_T0 + HOUR);
  assert.deepEqual(m.stats, { received: 2, inserted: 1, updated: 1, invalid: 0, duplicate: 1, skipped: false });
  const byId = Object.fromEntries(m.records.map(r => [r.item.supplierItemId, r]));
  assert.equal(byId['KEEP-1'].item.price, 6900);
  assert.equal(byId['KEEP-1'].firstSeenAt, iso(OD_T0), '처음 본 시각 유지');
  assert.equal(byId['KEEP-1'].lastReceivedAt, iso(OD_T0 + HOUR));
  assert.equal(byId['KEEP-2'].lastReceivedAt, iso(OD_T0), '이번 응답에 없던 상품은 그대로 (기한이 지나면 자동으로 내려감)');
  const future = odMerge([], { supplier: 'coupang', ok: true, observedAt: iso(OD_T0 + 5 * HOUR), items: [candidate()] }, OD_T0);
  assert.equal(future.records[0].lastReceivedAt, iso(OD_T0), '수신 시각은 서버 시각을 넘지 않음');
});

test('운영자 숨김은 다시 받아도 유지되고, 보관 정리에서도 남는다', () => {
  const hidden = rec({ supplierItemId: 'HIDE' }, { hidden: true, hiddenReason: '설명과 다름', hiddenAt: iso(OD_T0) });
  const m = odMerge([hidden], { supplier: 'coupang', ok: true, observedAt: iso(OD_T0 + HOUR), items: [candidate({ supplierItemId: 'HIDE', price: 100 })] }, OD_T0 + HOUR);
  assert.equal(m.records[0].hidden, true);
  assert.equal(m.records[0].hiddenReason, '설명과 다름');
  assert.equal(evalOne(m.records[0]).status, 'hidden');
  const old = rec({ supplierItemId: 'OLD' }, { lastReceivedAt: iso(OD_T0 - 8 * 24 * HOUR) });
  const pruned = odPrune([old, { ...hidden, lastReceivedAt: iso(OD_T0 - 90 * 24 * HOUR) }, rec()], OD_T0);
  assert.deepEqual(pruned.map(r => r.item.supplierItemId).sort(), ['HIDE', 'MOCK-1001']);
});

test('공개 필드: 보류 사유·숨김·공급처 내부 id 없음, 사진은 이용 범위 확인 전 비움', () => {
  const r = evalOne(rec({ pick: '골드박스' }));
  const pub = odPublic(r);
  assert.deepEqual(Object.keys(pub).sort(), ['affiliate', 'category', 'checkedAt', 'conditions', 'endsAt', 'id', 'imageUrl', 'membership', 'option', 'pick', 'price',
    'seller', 'shipping', 'shippingFee', 'shippingThreshold', 'store', 'supplier', 'title', 'url', 'visibleUntil']);
  assert.equal(pub.imageUrl, '', 'imagesAllowed=false');
  assert.equal(OD_SUPPLIERS.coupang.imagesAllowed, false);
  assert.ok(!JSON.stringify(pub).includes('MOCK-1001'));
  const reg = { coupang: { ...OD_SUPPLIERS.coupang, imagesAllowed: true } };
  assert.match(odPublic(r, reg).imageUrl, /^https:\/\/thumbnail\.coupangcdn\.com\//);
});

test('화면 재검사: 기한·링크·가격·조건이 맞지 않으면 버리고, 24시간을 넘는 게시 기한은 거절', () => {
  const pub = odPublic(evalOne(rec()));
  const now = OD_T0 + MIN;
  assert.equal(odClientItem(pub, now).price, 7900);
  assert.equal(odClientItem(pub, now).affiliate, true);
  for (const over of [{ visibleUntil: iso(now - 1) }, { visibleUntil: iso(OD_T0 + 25 * HOUR) }, { url: 'https://evil.test/' }, { price: '7900' }, { conditions: [''] },
    { checkedAt: iso(now + HOUR) }, { endsAt: iso(now - 1) }, { id: '../x' }, { supplier: 'other' }, { title: '' }]) {
    assert.equal(odClientItem({ ...pub, ...over }, now), null, JSON.stringify(over));
  }
  assert.equal(odClientItem({ ...pub, affiliate: false, url: 'https://www.coupang.com/vp/products/1?lptag=AF1327603' }, now).affiliate, true, '링크가 제휴면 제휴 표시');
  assert.equal(odClientItem({ ...pub, url: 'https://www.coupang.com/vp/products/1?lptag=AF0000001' }, now), null, '다른 파트너스 ID 링크는 표시하지 않음');
});

test('실패 뒤 일시 중지: 429는 Retry-After(15분~24시간), 일반 실패는 3회째부터 늘려 가며', () => {
  let s = odSupplierStates().coupang;
  s = odAfterFailure(s, { rateLimited: true, retryAfterMs: 60 * 1000, error: 'rate_limited' }, OD_T0);
  assert.equal(s.pauseUntil, iso(OD_T0 + 15 * MIN));
  s = odAfterFailure(odSupplierStates().coupang, { rateLimited: true, retryAfterMs: 3 * 24 * HOUR }, OD_T0);
  assert.equal(s.pauseUntil, iso(OD_T0 + 24 * HOUR));
  let f = odSupplierStates().coupang;
  f = odAfterFailure(f, { error: 'http_500' }, OD_T0);
  f = odAfterFailure(f, { error: 'http_500' }, OD_T0);
  assert.equal(f.pauseUntil, '');
  f = odAfterFailure(f, { error: 'http_500' }, OD_T0);
  assert.equal(f.pauseUntil, iso(OD_T0 + 15 * MIN));
  f = odAfterFailure(f, { error: 'http_500' }, OD_T0);
  assert.equal(f.pauseUntil, iso(OD_T0 + 30 * MIN));
  assert.equal(f.failures, 4);
});

// ---------- 호출 규칙 (가짜 fetch) ----------
function fakeNet(script) {
  const calls = [];
  const sleeps = [];
  let clock = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    if (step === 'hang') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    if (step instanceof Error) throw step;
    return new Response(step.body ?? '{"items":[]}', { status: step.status ?? 200, headers: step.headers || {} });
  };
  return { calls, sleeps, fetchImpl, sleep: async ms => { sleeps.push(ms); clock += ms; }, now: () => clock };
}
const client = (net, opts = {}) => createHttpClient({ allowedHosts: ['api.mock.test'], fetchImpl: net.fetchImpl, sleep: net.sleep, now: net.now, random: () => 0, minIntervalMs: 0, ...opts });

test('호출: 허용 목록 밖·HTTP·계정 포함 주소는 요청 전에 막고, 다른 주소로 넘어가지 않는다', async () => {
  const net = fakeNet([{ body: '{"a":1}' }]);
  const http = client(net);
  for (const url of ['https://evil.test/x', 'http://api.mock.test/x', 'https://u:p@api.mock.test/x', 'https://api.mock.test:444/x', 'not a url']) {
    await assert.rejects(http.request(url), url);
  }
  assert.equal(net.calls.length, 0);
  const res = await http.request('https://api.mock.test/deals?sig=SECRET');
  assert.deepEqual(res.json(), { a: 1 });
  assert.equal(net.calls[0].init.redirect, 'error');
});

test('호출: 429는 짧으면 기다렸다 다시, 길거나 반복되면 호출 제한 오류(공급처 일시 중지)', async () => {
  const short = fakeNet([{ status: 429, headers: { 'retry-after': '2' } }, { body: '{}' }]);
  await client(short).request('https://api.mock.test/a');
  assert.deepEqual(short.sleeps, [2000]);
  const long = fakeNet([{ status: 429, headers: { 'retry-after': '3600' } }]);
  const err = await client(long).request('https://api.mock.test/a').catch(e => e);
  assert.ok(err instanceof RateLimitError);
  assert.equal(err.retryAfterMs, 3600 * 1000);
  assert.equal(long.calls.length, 1, '긴 대기는 기다리지 않고 바로 중지');
  const none = fakeNet([{ status: 429 }]);
  assert.equal((await client(none).request('https://api.mock.test/a').catch(e => e)).retryAfterMs, 3600 * 1000, 'Retry-After가 없으면 1시간');
  assert.equal(parseRetryAfter('Wed, 05 Nov 2026 03:10:00 GMT', OD_T0), 10 * MIN);
  assert.equal(parseRetryAfter('soon'), null);
});

test('호출: 5xx·네트워크 오류는 제한적으로 재시도, 4xx는 바로 실패, 시간 초과·큰 응답은 중단', async () => {
  const flaky = fakeNet([{ status: 503 }, { status: 502 }, { body: '{"ok":1}' }]);
  assert.deepEqual((await client(flaky).request('https://api.mock.test/a')).json(), { ok: 1 });
  assert.equal(flaky.calls.length, 3);
  const down = fakeNet([{ status: 500 }]);
  const e500 = await client(down).request('https://api.mock.test/a').catch(e => e);
  assert.ok(e500 instanceof HttpError); assert.equal(down.calls.length, 3, '최대 2회 재시도');
  const forbidden = fakeNet([{ status: 403 }]);
  assert.equal((await client(forbidden).request('https://api.mock.test/a').catch(e => e)).status, 403);
  assert.equal(forbidden.calls.length, 1);
  const hang = fakeNet(['hang']);
  const t = await client(hang, { timeoutMs: 20, maxRetries: 0 }).request('https://api.mock.test/a').catch(e => e);
  assert.equal(t.message, 'timeout');
  const big = fakeNet([{ body: 'x'.repeat(5000) }]);
  assert.equal((await client(big, { maxBytes: 1000 }).request('https://api.mock.test/a').catch(e => e)).message, 'response_too_large');
  const bad = fakeNet([{ body: '<html>' }]);
  const res = await client(bad).request('https://api.mock.test/a');
  assert.throws(() => res.json(), /bad_json/);
});

test('호출: 요청 간격을 지키고, 오류 문구에 키·주소 쿼리를 남기지 않는다', async () => {
  const net = fakeNet([{ body: '{}' }]);
  const http = client(net, { minIntervalMs: 1500 });
  await http.request('https://api.mock.test/a');
  await http.request('https://api.mock.test/b');
  assert.deepEqual(net.sleeps, [1500]);
  assert.equal(safeError(new Error('GET https://api.mock.test/a?key=SECRET failed')), 'adapter_error');
  assert.equal(safeError(new HttpError(401)), 'http_401');
  assert.equal(safeError(new RateLimitError(1)), 'rate_limited');
});

test('공급처: 승인 전에는 호출 코드·주소가 없다 (추측 금지), 비밀값 이름만 안내', () => {
  for (const [id, ad] of Object.entries(ADAPTERS)) {
    assert.equal(ad.fetch, null, id);
    assert.equal(ad.status, 'awaiting_access');
    assert.deepEqual(ad.apiHosts, []);
    assert.ok(ad.requiredSecrets.length && ad.requiredSecrets.every(k => /^[A-Z_]+$/.test(k)));
    assert.ok(OD_SUPPLIERS[id]);
  }
  const src = readFileSync(new URL('../src/online/suppliers.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /https?:\/\//, '호출 주소를 적어 두지 않음');
  assert.match(OD_SUPPLIERS.coupang.disclosure, /쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다/);
});

test('문구: 최저가·할인율을 만들어 내지 않는다', () => {
  for (const file of ['../src/online-deals-core.js', '../../web/online-deals.js', '../../apps-script/online-deals-backend.gs']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /최저가|역대가|할인율|최대 할인/, file);
  }
});

test('같은 규칙 파일: 화면 사본과 Apps Script 생성 구역이 원본과 같다 (npm run sync-web)', () => {
  const src = readFileSync(new URL('../src/online-deals-core.js', import.meta.url), 'utf8');
  assert.equal(readFileSync(new URL('../../web/online-deals-core.js', import.meta.url), 'utf8'), src);
  const gs = readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8');
  assert.ok(gs.includes(src.replace(/^export /gm, '')), 'Code.gs 생성 구역에 최신 규칙');
  assert.ok(gs.includes(readFileSync(new URL('../../apps-script/online-deals-backend.gs', import.meta.url), 'utf8')));
  assert.doesNotMatch(src, /\bnew URL\(|URLSearchParams|^import /m, 'Apps Script에서도 돌아가야 함');
});

test('워크플로: 읽기 권한만, 겹침 방지, 외부 액션 고정, 비밀값은 실행 단계에만', () => {
  const yml = readFileSync(new URL('../../.github/workflows/online-deals.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(yml, /permissions:\n  contents: read/);
  assert.match(yml, /concurrency:\n  group: online-deals\n  cancel-in-progress: false/);
  for (const uses of yml.match(/uses: \S+/g)) assert.match(uses, /@[0-9a-f]{40}$/, uses);
  assert.doesNotMatch(yml, /echo[^\n]*secrets\.|npm (ci|install)|playwright/, '비밀값 출력·불필요한 설치 없음');
  assert.equal((yml.match(/secrets\./g) || []).length, 5);
  assert.match(yml, /node src\/online\/run\.js/);
});

test('가격 확인 워크플로: 수동 실행만, 입력은 환경변수로만(셸에 끼워 넣지 않음), 수집기 토큰만, 읽기 권한', () => {
  const yml = readFileSync(new URL('../../.github/workflows/online-prices.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.doesNotMatch(yml, /schedule:|cron:/, '정해진 시간에 혼자 돌지 않음 (확인한 가격이 있을 때만)');
  assert.match(yml, /permissions:\n  contents: read/);
  assert.match(yml, /concurrency:\n  group: online-prices\n  cancel-in-progress: false/);
  for (const uses of yml.match(/uses: \S+/g)) assert.match(uses, /@[0-9a-f]{40}$/, uses);
  assert.doesNotMatch(yml, /ADMIN_TOKEN|echo[^\n]*secrets\.|npm (ci|install)|playwright/);
  assert.deepEqual(yml.match(/secrets\.\w+/g), ['secrets.APPS_SCRIPT_URL', 'secrets.COLLECTOR_TOKEN']);
  const runLines = yml.split('\n').filter(l => /^\s+run: \S/.test(l));
  assert.deepEqual(runLines.map(l => l.trim()), ['run: node src/online/prices.js']);
  assert.ok(runLines.every(l => !l.includes('${{')), '입력값을 셸 명령에 직접 넣지 않음');
  assert.match(yml, /PRICES_JSON: \$\{\{ inputs\.prices \}\}/);
});

// ---------- 직접 고른 쿠팡 특가 (최종 승인 전) ----------
import { odPickInput, odPickPublic, odClientPick, odPickImage, odPartnerHtml, odGuessItem, odPriceStats, odPriceObservations, OD_PICK_CATEGORIES, OD_PICK_ITEMS, OD_DEFAULT_RULES } from '../src/online-deals-core.js';
const pickRaw = (over = {}) => ({ title: '테스트 생수 2L × 12병', url: 'https://link.coupang.com/a/abcDEF123', category: 'food', note: '와우회원 가격', price: '7900', memo: '에펨코리아 핫딜', ...over });

test('직접 고른 카드 입력: AMONG 간편 링크만, 항목·가격·노출 기간 검사, 가격 확인 시각은 서버 시각', () => {
  const { errors, pick } = odPickInput(pickRaw(), OD_T0);
  assert.deepEqual(errors, []);
  assert.equal(pick.price, 7900);
  assert.equal(pick.priceCheckedAt, iso(OD_T0));
  assert.equal(pick.endsAt, iso(OD_T0 + 24 * HOUR), '기본 하루 (가격 확인 24시간과 같음)');
  assert.deepEqual(Object.keys(OD_PICK_CATEGORIES), ['food', 'household', 'etc']);
  for (const [over, msg] of [
    [{ title: 'a' }, '상품명'], [{ url: 'https://www.coupang.com/vp/products/1' }, '간편 링크'], [{ url: 'https://link.coupang.com/a/x?lptag=AF0000001' }, '간편 링크'],
    [{ url: 'https://evil.test/a/x' }, '간편 링크'], [{ url: 'javascript:alert(1)' }, '간편 링크'], [{ category: 'weapons' }, '항목'],
    [{ price: '12,900' }, '가격'], [{ price: 50 }, '가격'], [{ price: '1e5' }, '가격'], [{ note: '가'.repeat(61) }, '설명'],
    [{ endsAt: iso(OD_T0 - 1) }, '노출'], [{ endsAt: iso(OD_T0 + 31 * 24 * HOUR) }, '노출'],
  ]) {
    const r = odPickInput(pickRaw(over), OD_T0);
    assert.equal(r.pick, null, JSON.stringify(over));
    assert.ok(r.errors.some(e => e.includes(msg)), `${JSON.stringify(over)} → ${r.errors}`);
  }
  assert.equal(odPickInput(pickRaw({ price: '' }), OD_T0).pick.price, null, '가격은 선택');
  // 같은 가격으로 다른 칸만 고치면 처음 확인 시각 유지, 가격을 바꾸거나 '다시 확인'이면 지금
  const later = OD_T0 + 2 * HOUR;
  assert.equal(odPickInput(pickRaw({ note: '바뀐 설명' }), later, pick).pick.priceCheckedAt, iso(OD_T0));
  assert.equal(odPickInput(pickRaw({ price: 6900 }), later, pick).pick.priceCheckedAt, iso(later));
  assert.equal(odPickInput(pickRaw({ recheck: true }), later, pick).pick.priceCheckedAt, iso(later));
  assert.equal(odPickInput(pickRaw(), later, { ...pick, hidden: true }).pick.hidden, true, '숨김 유지');
});

test('직접 고른 카드 공개: 메모·숨김 없음, 가격 카드는 확인 후 24시간만, 노출 종료 뒤에는 빠짐', () => {
  const pick = { ...odPickInput(pickRaw(), OD_T0).pick, id: 'pk_0123456789abcdef' };
  const pub = odPickPublic(pick, OD_T0 + HOUR);
  assert.deepEqual(Object.keys(pub).sort(), ['atLow', 'category', 'id', 'imageUrl', 'item', 'low30', 'lowDays', 'note', 'price', 'priceCheckedAt', 'priceUntil', 'title', 'url', 'visibleUntil']);
  assert.ok(!JSON.stringify(pub).includes('에펨코리아'), '출처 메모는 공개하지 않음');
  assert.equal(pub.price, 7900);
  assert.equal(odPickPublic(pick, OD_T0 + 24 * HOUR - 1).price, 7900);
  const long = { ...pick, endsAt: iso(OD_T0 + 5 * 24 * HOUR) };
  assert.equal(odPickPublic(long, OD_T0 + 24 * HOUR), null, '가격 확인 24시간이 지나면 카드가 내려감');
  assert.equal(odPickPublic(long, OD_T0 + HOUR).visibleUntil, iso(OD_T0 + 24 * HOUR));
  const noPrice = { ...long, price: null, priceCheckedAt: '' };
  assert.equal(odPickPublic(noPrice, OD_T0 + 2 * 24 * HOUR).price, null, '가격 없는 카드는 남음');
  assert.equal(odPickPublic(noPrice, OD_T0 + 2 * 24 * HOUR).visibleUntil, iso(OD_T0 + 5 * 24 * HOUR));
  assert.equal(odPickPublic({ ...pick, hidden: true }, OD_T0), null);
  assert.equal(odPickPublic(pick, OD_T0 + 3 * 24 * HOUR), null);
  // 화면 재검사
  const now = OD_T0 + HOUR;
  assert.equal(odClientPick(pub, now).price, 7900);
  assert.equal(odClientPick({ ...pub, priceUntil: iso(OD_T0 + 30 * HOUR) }, now), null, '24시간보다 긴 가격 기한은 믿지 않음 (카드째 뺌)');
  assert.equal(odClientPick({ ...pub, priceUntil: iso(now - 1) }, now), null);
  assert.equal(odClientPick({ ...pub, price: null, priceCheckedAt: '', priceUntil: '' }, now).price, null, '가격 없는 카드는 그대로');
  for (const over of [{ url: 'https://www.coupang.com/vp/products/1' }, { url: 'https://link.coupang.com/a/x?lptag=AF0000001' }, { id: 'x' }, { category: 'x' },
    { visibleUntil: iso(now - 1) }, { visibleUntil: iso(now + 40 * 24 * HOUR) }, { title: '' }]) {
    assert.equal(odClientPick({ ...pub, ...over }, now), null, JSON.stringify(over));
  }
});

// 11/05 17:38 대표 요청: 카드에 상품 사진과 가격이 바로 보이게. 사진은 쿠팡 파트너스 '상품 링크' HTML이 주는 배너만.
// 아래 HTML은 파트너스 상품 링크 HTML의 형식을 흉내 낸 테스트 값이며 실제 상품·링크가 아니다.
const PARTNER_HTML = '<a href="https://link.coupang.com/a/testHtml01" target="_blank" referrerpolicy="unsafe-url"><img src="https://img5c.coupangcdn.com/image/affiliate/banner/0123456789abcdef0123456789abcdef@2x.jpg" alt="테스트 새우깡, 90g, 10개 &amp; 증정" width="120" height="240"></a>';
test('파트너스 HTML 붙여넣기: 간편 링크·배너 사진·상품명만 읽고, 다른 사진·다른 주소는 받지 않음', () => {
  assert.deepEqual(odPartnerHtml(PARTNER_HTML), { url: 'https://link.coupang.com/a/testHtml01', imageUrl: 'https://img5c.coupangcdn.com/image/affiliate/banner/0123456789abcdef0123456789abcdef@2x.jpg', title: '테스트 새우깡, 90g, 10개 & 증정', imageRejected: false });
  assert.deepEqual(odPartnerHtml("<A HREF='https://link.coupang.com/a/x2'><IMG SRC='https://img1a.coupangcdn.com/image/affiliate/banner/a.jpg' ALT='작은따옴표'></A>"),
    { url: 'https://link.coupang.com/a/x2', imageUrl: 'https://img1a.coupangcdn.com/image/affiliate/banner/a.jpg', title: '작은따옴표', imageRejected: false });
  const page = odPartnerHtml('<a href="https://link.coupang.com/a/x3"><img src="https://thumbnail6.coupangcdn.com/thumbnails/remote/230x230ex/image/retail/a.jpg" alt="x"></a>');
  assert.equal(page.imageUrl, '', '상품 페이지 사진은 받지 않음'); assert.equal(page.imageRejected, true);
  assert.equal(odPartnerHtml('<iframe src="https://coupa.ng/abc" width="120" height="240"></iframe>').url, '', '위젯(iframe)은 쓰지 않음');
  assert.equal(odPartnerHtml('<a href="https://www.coupang.com/vp/products/1"><img src="x"></a>').url, '', '간편 링크가 아닌 주소');
  assert.equal(odPartnerHtml('<a href="javascript:alert(1)">').url, '');
  for (const bad of ['http://img5c.coupangcdn.com/image/affiliate/banner/a.jpg', 'https://img5c.coupangcdn.com.evil.test/image/affiliate/a.jpg', 'https://evil.test/image/affiliate/a.jpg',
    'https://img5c.coupangcdn.com/image/affiliate/../retail/a.jpg', 'https://img5c.coupangcdn.com/image/affiliate/a.jpg?x=1', 'https://img5c.coupangcdn.com/image/affiliate/a".jpg', 'https://img5c.coupangcdn.com//image/affiliate/a.jpg']) {
    assert.equal(odPickImage(bad), '', bad);
  }
});

test('직접 고른 카드 사진: 저장·공개·화면 재검사 모두 같은 기준, 잘못된 사진은 오류(입력) 또는 빼기(공개)', () => {
  const img = odPartnerHtml(PARTNER_HTML).imageUrl;
  const saved = odPickInput(pickRaw({ imageUrl: img }), OD_T0).pick;
  assert.equal(saved.imageUrl, img);
  assert.match(odPickInput(pickRaw({ imageUrl: 'https://evil.test/a.jpg' }), OD_T0).errors.join(' '), /쿠팡 파트너스/);
  assert.equal(odPickInput(pickRaw(), OD_T0).pick.imageUrl, '', '사진 없이도 올릴 수 있음');
  const pub = odPickPublic({ ...saved, id: 'pk_0123456789abcdef' }, OD_T0 + HOUR);
  assert.equal(pub.imageUrl, img);
  assert.equal(odPickPublic({ ...saved, id: 'pk_0123456789abcdef', imageUrl: 'https://evil.test/a.jpg' }, OD_T0 + HOUR).imageUrl, '', '시트를 직접 고쳐도 공개되지 않음');
  assert.equal(odClientPick(pub, OD_T0 + HOUR).imageUrl, img);
  const tampered = odClientPick({ ...pub, imageUrl: 'https://evil.test/a.jpg' }, OD_T0 + HOUR);
  assert.equal(tampered.imageUrl, '', '응답이 바뀌어도 화면은 사진만 빼고 카드는 유지');
  assert.equal(tampered.price, 7900);
});

test('항목별 상품 규칙: 항목이 분류를 정하고, 화면 재검사에서도 가격만 빼며, 항목과 분류가 어긋나면 버림', () => {
  const saved = odPickInput(pickRaw({ item: 'protein', category: 'household' }), OD_T0).pick;
  assert.deepEqual([saved.item, saved.category], ['protein', 'food']);
  assert.equal(Date.parse(saved.endsAt), OD_T0 + 30 * 24 * HOUR);
  assert.match(odPickInput(pickRaw({ item: 'toString' }), OD_T0).errors.join(' '), /항목별 칸/, '객체 기본 속성 이름은 항목이 아님');
  const pub = odPickPublic({ ...saved, id: 'pk_0123456789abcdef' }, OD_T0 + HOUR);
  assert.equal(pub.item, 'protein'); assert.equal(pub.price, 7900);
  const later = OD_T0 + 25 * HOUR;
  const stale = odClientPick(pub, later);
  assert.equal(stale.price, null, '화면에 남아 있던 응답도 24시간 지나면 가격만 뺌');
  assert.equal(stale.visibleUntil, Date.parse(pub.visibleUntil));
  assert.equal(odClientPick({ ...pub, item: 'protein', category: 'household' }, OD_T0 + HOUR), null, '항목과 분류가 어긋나면 버림');
  assert.equal(odClientPick({ ...pub, item: 'beer' }, OD_T0 + HOUR), null);
  assert.equal(odClientPick({ ...pub, item: '' }, later), null, '특가 카드는 그대로 카드째 뺌');
  // 11/06 21:08 대표 결정: 먹거리만 ("마스크 이런 거 말고 … 단백질 파우더, 자취 음식, 레토르트 등 먹거리 관련으로")
  assert.deepEqual(Object.entries(OD_PICK_ITEMS).map(([k, v]) => [k, v.label]), [['water', '생수'], ['ramen', '라면'], ['rice', '즉석밥'], ['frozen', '냉동 간편식'],
    ['retort', '레토르트'], ['chicken', '닭가슴살'], ['protein', '단백질'], ['canned', '통조림']]);
  assert.ok(Object.values(OD_PICK_ITEMS).every(v => v.category === 'food'));
  assert.match(odPickInput(pickRaw({ item: 'tissue' }), OD_T0).errors.join(' '), /항목별 칸/, '생활용품 칸은 없어짐');
  for (const category of ['household', 'etc']) assert.match(odPickInput(pickRaw({ category }), OD_T0).errors.join(' '), /먹거리만/, category);
  const oldTissue = { ...saved, id: 'pk_00000000000000aa', item: 'tissue', category: 'household' };
  assert.equal(odPickPublic(oldTissue, OD_T0 + HOUR), null, '전에 올린 생활용품 칸 카드는 공개하지 않음 (시트에는 남음)');
  assert.equal(odPickPublic({ ...oldTissue, item: '', category: 'etc' }, OD_T0 + HOUR), null, '기타 특가도');
  assert.equal(odClientPick({ ...pub, item: '', category: 'household' }, OD_T0 + HOUR), null, '화면에서도 먹거리만');
  assert.deepEqual(OD_DEFAULT_RULES.includeCategories, ['food']);
  const g = n => odGuessItem(n);
  assert.deepEqual(['제주 삼다수 2L, 12개', '농심 신라면 120g, 5개', '햇반 210g, 24개', '비비고 왕교자 1.05kg', '오뚜기 3분 카레 약간매운맛 200g, 24개', '하림 닭가슴살 블랙페퍼 100g, 10개',
    '마이프로틴 임팩트 웨이 프로틴 1kg', '동원 라이트 스탠다드 참치 135g, 10개', '농심 새우깡 90g'].map(g),
    ['water', 'ramen', 'rice', 'frozen', 'retort', 'chicken', 'protein', 'canned', '']);
  assert.deepEqual(['깨끗한나라 3겹 화장지 30m 30롤', '베베숲 물티슈 캡형 100매', '퍼실 액체 세탁세제 2.7L', '플리터스 겨울 방한 마스크 자외선차단 남녀공용', '탄소열선 전기요'].map(g),
    ['', '', '', '', ''], '먹거리가 아니면 짐작하지 않음');
  // 11/06 실제로 올린 상품명 (파트너스 상품 링크): 첫 버전에서 못 맞춘 이름들
  assert.deepEqual(['오뚜기 흰밥, 210g, 12개', '탐사 샘물, 2L, 12개', '곰곰 김치볶음밥 (냉동), 300g, 6개', '오뚜기 스낵면 108g, 40개', '곰곰 우리쌀 밥, 200g, 24개', '양반 쇠고기죽, 287.5g, 6개'].map(g),
    ['rice', 'water', 'frozen', 'ramen', 'rice', 'retort']);
});


// 11/06 10:19 대표 요청: 최근 30일 최저를 쿠폰에 표시 (AMONG이 확인한 가격 기록만으로)
test('30일 최저: 기록 3일 이상일 때만, 지금 가격이 기간 최저이고 더 비싼 날이 있었으면 표시, 화면 재검사도 같은 기준', () => {
  const day = 24 * HOUR;
  const at = d => new Date(OD_T0 + d * day).toISOString();
  const rec = (d, price) => ({ price, at: at(d) });
  const now = OD_T0 + 10 * day + HOUR;
  assert.equal(odPriceStats([], now), null);
  assert.deepEqual(odPriceStats([rec(10, 5900), rec(10, 5800), rec(9, 6000), rec(-25, 4000), rec(11, 1000), { price: '5000', at: at(9) }, { price: 5000, at: 'x' }], now),
    { low: 5800, high: 6000, days: 2, since: at(9) }, '30일 지난 기록·미래 기록·잘못된 값은 뺌, 같은 날은 하루로');
  const saved = odPickInput(pickRaw({ item: 'water', price: '5690' }), OD_T0 + 10 * day).pick;
  const pick = { ...saved, id: 'pk_0123456789abcdef' };
  const two = odPriceStats([rec(9, 6000), rec(10, 5690)], now);
  let pub = odPickPublic(pick, now, two);
  assert.deepEqual([pub.low30, pub.lowDays, pub.atLow], [null, 0, false], '확인한 날이 2일이면 아직 표시하지 않음');
  const three = odPriceStats([rec(8, 6200), rec(9, 6000), rec(10, 5690)], now);
  pub = odPickPublic(pick, now, three);
  assert.deepEqual([pub.low30, pub.lowDays, pub.atLow], [5690, 3, true]);
  assert.equal(odPickPublic(pick, now, odPriceStats([rec(8, 5690), rec(9, 5690), rec(10, 5690)], now)).atLow, false, '가격이 한 번도 안 바뀌었으면 최저 표시 없음');
  assert.equal(odPickPublic({ ...pick, price: 6000 }, now, odPriceStats([rec(8, 5690), rec(9, 6100), rec(10, 6000)], now)).atLow, false, '지금이 최저가 아니면 표시 없음');
  const stale = odPickPublic(pick, OD_T0 + 12 * day, three);
  assert.equal(stale.price, null); assert.equal(stale.atLow, false, '가격이 빠진 카드(24시간 지남)는 최저 표시 없음'); assert.equal(stale.low30, 5690, '기록 최저는 그대로 보여 줌');
  const client = odClientPick(pub, now);
  assert.deepEqual([client.low30, client.lowDays, client.atLow], [5690, 3, true]);
  assert.equal(odClientPick({ ...pub, low30: 5000, atLow: true, price: 5690 }, now).atLow, false, '응답이 바뀌어 가격이 최저보다 높으면 최저 표시 안 함');
  assert.deepEqual([odClientPick({ ...pub, lowDays: 2 }, now).low30, odClientPick({ ...pub, lowDays: 2 }, now).atLow], [null, false], '기록 일수가 모자라면 빼고');
  assert.equal(odClientPick({ ...pub, low30: '5690' }, now).low30, null);
});

test('가격 일괄 기록 입력: 카드 번호·정수 가격만, 같은 카드는 한 번, 최대 200개', () => {
  assert.deepEqual(odPriceObservations([{ id: 'pk_0123456789abcdef', price: 5690 }, { id: 'pk_0123456789abcdef', price: 1 }, { id: 'pk_ffffffffffffffff', price: '5690' },
    { id: 'x', price: 5690 }, { id: 'pk_aaaaaaaaaaaaaaaa', price: 99 }, { id: 'pk_bbbbbbbbbbbbbbbb', price: 12900.5 }, null, { id: 'pk_cccccccccccccccc', price: 12900 }]),
  [{ id: 'pk_0123456789abcdef', price: 5690 }, { id: 'pk_cccccccccccccccc', price: 12900 }]);
  assert.deepEqual(odPriceObservations('x'), []);
  assert.equal(odPriceObservations(Array.from({ length: 300 }, (_, i) => ({ id: `pk_${String(i).padStart(16, '0')}`, price: 1000 }))).length, 200);
});
