// 11/10 대표 결정: "기간을 모르겠으면 공지 이미지나 기사 여러개 확인하고 팩트체크해서 명시해줘."
// 실제 API·실제 시트를 쓰지 않고 가짜 응답으로만 확인한다.
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePeriodText, judgePress, checkPeriods, needsPeriod, applyPeriod, sameEvent, isPressUrl, outletOf, pressQueries, parseRefs, PERIOD_SOURCE,
} from '../src/period-check.js';
import { officialReader, periodPrompt } from '../src/official-period.js';
import { pressFromEnv, articleFromHtml, NAVER_HUB_NEWS, NAVER_LEGACY_NEWS } from '../src/press-search.js';
import { loadAppsScript } from './gas-harness.js';

const NOW = new Date('2026-11-10T03:00:00Z'); // KST 11/10 12:00
// 11/09 00:13 실제 수집 그대로 — 공식 이벤트 목록 배너에 기간이 없어 '끝나는 날 공지 없음'으로 게시
const WHOPPER = {
  id: 'n_f8146754d68f', status: 'published', brand: '버거킹', category: '햄버거', title: '26년 11월 와퍼 3900원 프로모션',
  summary: '26년 11월을 맞아 와퍼를 3,900원에 판매하는 프로모션이 진행 중입니다.', discount_label: '3900원', start_date: null, end_date: null,
  evidence: '26년 11월 와퍼 3900원 프로모션', issues: ['끝나는 날 미공개 — 공식 이벤트 목록 기준'], source_id: 'bk-event',
  source_url: 'https://www.burgerking.co.kr/event/ongoing', image_url: 'https://mob-prd.burgerking.co.kr/images/event/app/list/2026/11/04/b9cc.png',
  first_seen: '2026-11-08T15:23:18Z', programs: [], related_ids: [],
};
const art = (url, published, text) => ({ url, published, text });
const SEGYE = art('https://www.segye.com/newsView/20261109517778', '2026-11-09T01:00:00Z', '7400원짜리가 3900원…버거킹, 9일부터 13일까지 와퍼 3,900원 판매');
const HANKYUNG = art('https://www.hankyung.com/article/2026110912345', '2026-11-09T02:30:00Z', '버거킹은 11월 9일부터 13일까지 대표 메뉴 와퍼를 3900원에 판매한다고 밝혔다');
const JULY = art('https://www.mk.co.kr/news/2026/07/1', '2026-07-14T01:00:00Z', '버거킹, 7월 14일부터 18일까지 와퍼 3900원');
const EOMISAE = art('https://eomisae.co.kr/ec/209942310', '2026-11-09T00:30:00Z', '버거킹 와퍼 3,900원 프로모션 (11. 9. ~ 11. 13.)');

test('기사에 흔한 기간 표기를 읽는다 (연도·달은 게시일 기준, 달만 있거나 끝만 있으면 읽지 않음)', () => {
  const cases = [
    ['버거킹은 11월 9일부터 13일까지 와퍼를 판다', '2026-11-09', ['2026-11-09', '2026-11-13']],
    ['11월 9일(일)부터 11월 13일(목)까지', '2026-11-09', ['2026-11-09', '2026-11-13']],
    ['오는 9일부터 13일까지 5일간', '2026-11-08', ['2026-11-09', '2026-11-13']],
    ['이달 9일부터 13일까지', '2026-11-09', ['2026-11-09', '2026-11-13']],
    ['11.9(일) ~ 11.13(목)', '2026-11-09', ['2026-11-09', '2026-11-13']],
    ['2026.11.09 ~ 2026.11.13', '2026-11-09', ['2026-11-09', '2026-11-13']],
    ['2026-11-03 ~ 2026-11-24', '2026-11-05', ['2026-11-03', '2026-11-24']],
    ['12월 30일부터 1월 3일까지', '2026-12-20', ['2026-12-30', '2027-01-03']],
    ['1일부터 5일까지', '2026-11-28', ['2026-12-01', '2026-12-05']],
  ];
  for (const [t, base, want] of cases) assert.deepEqual(parsePeriodText(t, base), { start: want[0], end: want[1] }, t);
  for (const t of ['26년 11월 와퍼 3900원 프로모션', '13일까지 판매', '11월 한정', '2026-11-04 ~ 소진 시 까지', '']) assert.equal(parsePeriodText(t, '2026-11-09'), null, t);
});

test('같은 행사 확인: 브랜드 + 메뉴 낱말 + 혜택 숫자 (다른 가격·다른 브랜드는 아님)', () => {
  assert.equal(sameEvent(WHOPPER, SEGYE.text), true);
  assert.equal(sameEvent(WHOPPER, '버거킹 와퍼 4,900원 할인'), false);
  assert.equal(sameEvent(WHOPPER, '롯데리아 와퍼 3900원'), false);
  assert.equal(sameEvent(WHOPPER, '버거킹 치즈와퍼 세트 39000원'), false, '39000원은 3900원이 아님');
  assert.equal(sameEvent({ brand: '파파이스', title: '11월 11일 두배로 데이', discount_label: '1+1' }, '파파이스, 11일 두배로 데이 치킨 원플원'), true);
  assert.deepEqual(pressQueries(WHOPPER, NOW), ['버거킹 와퍼 3900원', '버거킹 와퍼 3900원 2026년 11월', '버거킹 3900원 행사 기간']);
});

test('근거로 쓰지 않는 곳: 커뮤니티·블로그·SNS·포털 재전송·브랜드 공식 사이트. 같은 언론사의 www·m 주소는 한 곳', () => {
  for (const u of ['https://eomisae.co.kr/ec/1', 'https://blog.naver.com/x/1', 'https://m.cafe.naver.com/x', 'https://www.ppomppu.co.kr/zboard', 'https://mlbpark.donga.com/mp/b.php',
    'https://n.news.naver.com/article/022/1', 'https://www.instagram.com/p/1', 'https://www.newswire.co.kr/newsRead.php']) assert.equal(isPressUrl(u), false, u);
  assert.equal(isPressUrl('https://www.donga.com/news/1'), true);
  assert.equal(isPressUrl('https://www.burgerking.co.kr/event/1', ['www.burgerking.co.kr']), false, '공식 사이트는 공식 단계에서');
  assert.equal(outletOf('https://m.segye.com/view/1'), outletOf('https://www.segye.com/newsView/1'));
  assert.equal(outletOf('https://news.kbs.co.kr/a'), 'kbs.co.kr');
});

test('기사 판단: 언론사 2곳이 같으면 채움 · 1곳뿐이면 비움 · 서로 다르면 비움 · 7월 기사·커뮤니티는 제외', () => {
  const ok = judgePress(WHOPPER, [SEGYE, HANKYUNG, JULY, EOMISAE], { now: NOW });
  assert.equal(ok.start, '2026-11-09');
  assert.equal(ok.end, '2026-11-13');
  assert.deepEqual(ok.refs.map((r) => r.outlet), ['segye.com', 'hankyung.com']);
  assert.match(judgePress(WHOPPER, [SEGYE, JULY, EOMISAE], { now: NOW }).fail, /2곳 이상 필요/);
  const other = art('https://www.chosun.com/1', '2026-11-09T03:00:00Z', '버거킹 와퍼 3900원 행사는 11월 9일부터 15일까지');
  assert.match(judgePress(WHOPPER, [SEGYE, HANKYUNG, other], { now: NOW }).fail, /기사마다 기간이 다름/);
  // 같은 언론사 기사 두 개는 한 곳
  assert.match(judgePress(WHOPPER, [SEGYE, { ...SEGYE, url: 'https://m.segye.com/view/20261109517778' }], { now: NOW }).fail, /2곳 이상 필요/);
  // 7월 행사 기사만 여러 곳이면 채우지 않음 (게시일이 행사 시작 14일 전보다 오래됨)
  const july2 = art('https://www.hankyung.com/a/7', '2026-07-14T02:00:00Z', JULY.text);
  assert.ok(judgePress(WHOPPER, [JULY, july2], { now: NOW }).fail);
});

test('대상: 공식(한 브랜드) 출처의 끝나는 날 없는 소식. 요일·매월 반복, 여러 브랜드 출처, 신뢰도 보류는 대상 아님', () => {
  assert.equal(needsPeriod(WHOPPER), true);
  assert.equal(needsPeriod({ ...WHOPPER, end_date: '2026-11-13' }), false);
  assert.equal(needsPeriod({ ...WHOPPER, title: '수요일은 파파이스 두배로 데이' }), false);
  assert.equal(needsPeriod({ ...WHOPPER, title: '매월 11일 치킨올데이' }), false);
  assert.equal(needsPeriod(WHOPPER, { fixedSource: (id) => id !== 'bk-event' }), false);
  assert.equal(needsPeriod({ ...WHOPPER, status: 'pending', issues: ['기간 없는 상시 행사'] }), true);
  assert.equal(needsPeriod({ ...WHOPPER, status: 'pending', issues: ['신뢰도 낮음'] }), false);
});

test('기간 반영: 보류 사유가 기간뿐이면 게시 · 끝났으면 버림 · 신뢰도 보류는 그대로 · id는 그대로', () => {
  const p = { start: '2026-11-09', end: '2026-11-13', source: PERIOD_SOURCE.image };
  const pub = applyPeriod({ ...WHOPPER, status: 'pending', issues: ['기간 없는 상시 행사'] }, p, { now: NOW });
  assert.equal(pub.status, 'published');
  assert.equal(pub.id, WHOPPER.id);
  assert.deepEqual([pub.start_date, pub.end_date, pub.period_source], ['2026-11-09', '2026-11-13', '공식 공지 이미지']);
  assert.ok(pub.issues.includes('기간 확인: 공식 공지 이미지') && !pub.issues.includes('기간 없는 상시 행사'));
  assert.equal(applyPeriod(WHOPPER, { ...p, end: '2026-11-09' }, { now: NOW }).status, 'rejected');
  assert.equal(applyPeriod({ ...WHOPPER, status: 'pending', issues: ['신뢰도 낮음', '기간 없는 상시 행사'] }, p, { now: NOW }).status, 'pending');
});

test('순서: 공식 상세 글자 → 공식 공지 이미지 → 기사. 공식에서 찾으면 기사를 보지 않는다', async () => {
  let searched = 0;
  const press = { connected: true, name: '가짜', search: async () => { searched++; return [SEGYE, HANKYUNG]; } };
  const r = await checkPeriods([WHOPPER], { now: NOW, official: async () => ({ start: '2026-11-09', end: '2026-11-13', source: PERIOD_SOURCE.image }), press });
  assert.equal(searched, 0);
  assert.equal(r.news[0].period_source, '공식 공지 이미지');
  assert.equal(r.summary.filled.length, 1);
  // 공식에 기간이 없으면 기사
  const r2 = await checkPeriods([WHOPPER], { now: NOW, official: async () => null, press });
  assert.equal(r2.news[0].period_source, '언론 보도');
  assert.deepEqual(parseRefs(r2.news[0].period_refs).map((x) => x.outlet), ['segye.com', 'hankyung.com']);
  assert.equal(r2.news[0].end_date, '2026-11-13');
  // 공식이 준 날짜가 이 행사와 맞지 않으면(10월에 끝남) 쓰지 않고 다음 단계로
  const r3 = await checkPeriods([WHOPPER], { now: NOW, official: async () => ({ start: '2026-10-01', end: '2026-10-05', source: PERIOD_SOURCE.image }), press });
  assert.equal(r3.news[0].period_source, '언론 보도');
});

test('기사 검색 키가 없으면 연결 안 됨으로 남기고, 화면은 그대로 끝나는 날 공지 없음', async () => {
  const press = pressFromEnv({});
  assert.equal(press.connected, false);
  const r = await checkPeriods([WHOPPER], { now: NOW, official: async () => null, press });
  assert.equal(r.summary.press, '연결 안 됨 (네이버 뉴스 검색 키 없음)');
  assert.equal(r.news[0].end_date, null);
  assert.equal(r.news[0].status, 'published');
  assert.ok(r.news[0].period_checked_at);
  assert.match(r.news[0].issues.at(-1), /^기간 확인 실패: .*기사 확인 연결 안 됨/);
});

test('저장된 기간은 다시 찾지 않고 반영, 기사 근거는 공식 공지에서 다르게 확인되면 공식으로', async () => {
  let calls = 0;
  const official = async () => { calls++; return { start: '2026-11-09', end: '2026-11-14', source: PERIOD_SOURCE.image }; };
  const knownImage = new Map([[WHOPPER.id, { id: WHOPPER.id, start_date: '2026-11-09', end_date: '2026-11-13', period_source: '공식 공지 이미지', period_refs: '', period_checked_at: '2026-11-09T15:00:00Z' }]]);
  const a = await checkPeriods([WHOPPER], { now: NOW, known: knownImage, official });
  assert.equal(calls, 0);
  assert.equal(a.summary.reused, 1);
  assert.equal(a.news[0].end_date, '2026-11-13');
  const knownPress = new Map([[WHOPPER.id, { ...knownImage.get(WHOPPER.id), period_source: '언론 보도', period_refs: 'segye.com|https://www.segye.com/a|2026-11-09', period_checked_at: '2026-11-09T01:00:00Z' }]]);
  const b = await checkPeriods([WHOPPER], { now: NOW, known: knownPress, official });
  assert.equal(calls, 1);
  assert.equal(b.news[0].period_source, '공식 공지 이미지');
  assert.equal(b.news[0].end_date, '2026-11-14', '공식과 기사가 다르면 공식');
  // 못 찾았던 것은 다시 찾되, 처음 보는 것 → 오래전에 못 찾은 것 순으로 10개까지
  const knownFail = new Map([[WHOPPER.id, { id: WHOPPER.id, period_source: '', period_checked_at: '2026-11-10T01:00:00Z' }]]);
  const c = await checkPeriods([WHOPPER], { now: NOW, known: knownFail, official });
  assert.equal(calls, 2);
  assert.equal(c.summary.checked, 1);
  const many = Array.from({ length: 11 }, (_, i) => ({ ...WHOPPER, id: `n${i}` }));
  const order = [];
  const failedEarlier = new Map([['n0', { id: 'n0', period_source: '', period_checked_at: '2026-11-10T01:00:00Z' }]]);
  await checkPeriods(many, { now: NOW, known: failedEarlier, official: async (n) => { order.push(n.id); return null; } });
  assert.equal(order.length, 10);
  assert.ok(!order.includes('n0'), '처음 보는 10개가 먼저, 오늘 못 찾은 것은 다음 차례');
});

test('공식 단계: 상세 화면 글자에 기간 → 공식 원문 / 글자에 없으면 AI가 옮긴 이미지 글자 → 공식 공지 이미지 / 날짜를 못 읽으면 없음', async () => {
  const sources = new Map([['bk-event', { id: 'bk-event', brand: '버거킹', url: 'https://www.burgerking.co.kr/event/ongoing' }]]);
  const llm = { provider: 'gemini', model: 'm', apiKey: 'k' };
  const textCap = async () => ({ banner: null, moved: true, text: '와퍼 3,900원 프로모션\n기간: 2026.11.09(일) ~ 11.13(목)', screenshots: [] });
  assert.deepEqual(await officialReader({ capture: textCap, sources, llm, now: NOW })(WHOPPER), { start: '2026-11-09', end: '2026-11-13', source: '공식 원문', quote: '' });
  let asked = null;
  const imgCap = async (listUrl, imageUrl) => { assert.equal(imageUrl, WHOPPER.image_url); return { banner: { media_type: 'image/jpeg', data: 'AA' }, moved: true, text: '이벤트 상세', screenshots: [{ media_type: 'image/jpeg', data: 'BB' }] }; };
  const ask = async (images, n) => { asked = images.length; return '11.9(일) ~ 11.13(목)'; };
  assert.deepEqual(await officialReader({ capture: imgCap, sources, llm, now: NOW, ask })(WHOPPER), { start: '2026-11-09', end: '2026-11-13', source: '공식 공지 이미지', quote: '11.9(일) ~ 11.13(목)' });
  assert.equal(asked, 2, '배너 + 상세 화면');
  assert.equal(await officialReader({ capture: imgCap, sources, llm, now: NOW, ask: async () => '11월 한정' })(WHOPPER), null);
  // 소식을 읽은 화면이 상세 화면이면 그 화면을 다시 읽는다
  let rendered = '';
  const kfc = { ...WHOPPER, brand: 'KFC', source_id: 'kfc', source_url: 'https://www.kfckorea.com/promotion/detail/949', title: 'KFC 치킨 1+1', discount_label: '1+1' };
  await officialReader({ render: async (u) => { rendered = u; return { text: 'KFC 치킨 1+1 기간 11.10 ~ 11.12', screenshots: [] }; }, sources: new Map([['kfc', { brand: 'KFC', url: 'https://www.kfckorea.com/promotion/promotionList' }]]), llm, now: NOW })(kfc);
  assert.equal(rendered, kfc.source_url);
  assert.match(periodPrompt(WHOPPER), /추측하거나 계산하지 마세요/);
});

test('네이버 뉴스 검색: HUB 키 → HUB 주소·헤더, 예전 개발자센터 키 → 예전 주소. 요약의 <b> 태그 제거', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), headers: opts.headers });
    return { ok: true, json: async () => ({ items: [{ title: '<b>버거킹</b> 와퍼 3900원', originallink: 'https://www.segye.com/a', link: 'https://n.news.naver.com/x', description: '9일부터 13일까지', pubDate: 'Mon, 09 Nov 2026 10:00:00 +0900' }] }) };
  };
  const hub = pressFromEnv({ NAVER_API_KEY_ID: 'id', NAVER_API_KEY: 'key' }, { fetchImpl, gapMs: 0 });
  assert.equal(hub.connected, true);
  const items = await hub.search('버거킹 와퍼 3900원');
  assert.ok(calls[0].url.startsWith(`${NAVER_HUB_NEWS}?query=`));
  assert.deepEqual(calls[0].headers, { 'X-NCP-APIGW-API-KEY-ID': 'id', 'X-NCP-APIGW-API-KEY': 'key' });
  assert.deepEqual(items, [{ url: 'https://www.segye.com/a', published: '2026-11-09T01:00:00.000Z', text: '버거킹 와퍼 3900원 9일부터 13일까지' }]);
  const legacy = pressFromEnv({ NAVER_CLIENT_ID: 'a', NAVER_CLIENT_SECRET: 'b' }, { fetchImpl, gapMs: 0 });
  await legacy.search('q');
  assert.ok(calls[1].url.startsWith(NAVER_LEGACY_NEWS));
  assert.equal(pressFromEnv({ NAVER_API_KEY_ID: 'id', NAVER_API_KEY: 'key', PERIOD_PRESS: 'off' }).connected, false);
  const a = articleFromHtml('<html><head><meta property="article:published_time" content="2026-11-09T10:00:00+09:00"><script>var x="11월 1일부터 2일까지"</script></head><body><p>버거킹은 9일부터 13일까지</p></body></html>');
  assert.equal(a.published, '2026-11-09T01:00:00.000Z');
  assert.doesNotMatch(a.text, /11월 1일/, '스크립트 글자는 읽지 않음');
});

test('Apps Script: news 기간 열 추가(SCHEMA 12)·공개 필드·다음 수집에서 기간 없이 들어와도 기간 유지·수집기용 기간 기록', () => {
  const CODE = fileURLToPath(new URL('../../apps-script/Code.gs', import.meta.url));
  const gas = loadAppsScript(CODE, { now: Date.parse('2026-11-10T03:00:00Z') });
  gas.ctx.setup();
  gas.props.set('COLLECTOR_TOKEN', 'tok');
  const row = { ...WHOPPER, hash: 'h1', issues: [] };
  const filled = { ...row, start_date: '2026-11-09', end_date: '2026-11-13', period_source: '언론 보도', period_refs: 'segye.com|https://www.segye.com/a|2026-11-09\nhankyung.com|https://www.hankyung.com/a|2026-11-09', period_checked_at: '2026-11-10T02:00:00Z', hash: 'h2' };
  gas.post({ action: 'ingest', token: 'tok', run_id: 'r1', coupons: [], news: [filled], sources_ok: ['bk-event'] });
  assert.equal(gas.props.get('SCHEMA_VERSION'), '14');
  for (const h of ['period_source', 'period_refs', 'period_checked_at']) assert.ok(gas.sheet('news').data[0].includes(h), h);
  // 다음 수집에서 기간 확인을 건너뛰어 끝나는 날 없이 들어와도 지우지 않는다
  gas.post({ action: 'ingest', token: 'tok', run_id: 'r2', coupons: [], news: [row], sources_ok: ['bk-event'] });
  const saved = gas.sheet('news').objects()[0];
  assert.deepEqual([saved.start_date, saved.end_date, saved.period_source], ['2026-11-09', '2026-11-13', '언론 보도']);
  const pub = gas.get({ action: 'coupons' }).news[0];
  assert.equal(pub.period_source, '언론 보도');
  assert.match(pub.period_refs, /segye\.com\|https:\/\/www\.segye\.com\/a/);
  assert.ok(!('period_checked_at' in pub), '확인 시각은 공개하지 않음');
  const known = gas.post({ action: 'news_periods', token: 'tok' });
  assert.equal(known.ok, true);
  assert.deepEqual(known.periods.map((p) => [p.id, p.end_date, p.period_source]), [[WHOPPER.id, '2026-11-13', '언론 보도']]);
  assert.equal(gas.post({ action: 'news_periods', token: 'wrong' }).ok, false, '수집기 토큰 필요');
});
