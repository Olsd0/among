// 쿠팡 특가 후보 찾기 (핫딜 게시판 RSS → 관리 화면 전용 후보). 가짜 RSS·가짜 네트워크로만 검증한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRss, isCoupangDeal, postId, findCoupangUrl, findLeads, runLeads, LEAD_FEEDS, LEAD_HOSTS, leadUserAgent } from '../src/online/leads.js';
import { decodeBody, createHttpClient } from '../src/online/http.js';
import { odLeadInput, odLeadName, odLeadPrice, OD_LEAD_SOURCES } from '../src/online-deals-core.js';
import { OD_T0 } from './online-fixtures.js';

const RULIWEB = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>루리웹 유저 핫딜</title>
<item><title><![CDATA[[쿠팡]새우깡 90g 10개 (9,370원/무료)]]></title><link>https://bbs.ruliweb.com/market/board/1020/read/108726</link><description><![CDATA[]]></description><pubDate>Wed, 05 Nov 2026 04:10:00 +0900</pubDate></item>
<item><title>[지마켓] 테스트 이어폰 (19,900원)</title><link>https://bbs.ruliweb.com/market/board/1020/read/108727</link><description></description><pubDate>Wed, 05 Nov 2026 04:20:00 +0900</pubDate></item>
<item><title>[쿠팡] 테스트 &amp; 휴지 30롤 (15,900원/무료)</title><link>https://bbs.ruliweb.com/market/board/1020/read/108728</link><description>&lt;a href="https://link.coupang.com/a/someoneElse"&gt;링크&lt;/a&gt;</description><pubDate>Wed, 05 Nov 2026 04:30:00 +0900</pubDate></item>
</channel></rss>`;
const PPOMPPU = `<?xml version="1.0" encoding="euc-kr"?><rss version="2.0"><channel><title>뽐뿌</title>
<item><title>[쿠팡] 테스트 햇반 210g 24개 (21,900원/무료)</title><link>https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&amp;no=600001</link><description>링크: https://www.coupang.com/vp/products/1234567?itemId=11&amp;vendorItemId=22&amp;sourceType=srp&amp;q=x 입니다...</description><pubDate>Wed, 05 Nov 2026 05:00:00 +0900</pubDate></item>
<item><title>[네이버] 테스트 커피 (9,900원)</title><link>https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu&amp;no=600002</link><description>https://smartstore.naver.com/x</description><pubDate>Wed, 05 Nov 2026 05:10:00 +0900</pubDate></item>
</channel></rss>`;
const POST_108726 = '<html><body><div class="source_url">원본출처 : <a href="https://www.coupang.com/vp/products/987654?itemId=5&amp;vendorItemId=6&amp;traceid=abc">링크</a></div></body></html>';

test('RSS 읽기: CDATA·HTML 엔티티, 쿠팡 글만, 게시글 번호', () => {
  const items = parseRss(RULIWEB);
  assert.equal(items.length, 3);
  assert.equal(items[0].title, '[쿠팡]새우깡 90g 10개 (9,370원/무료)');
  assert.equal(items[2].title, '[쿠팡] 테스트 & 휴지 30롤 (15,900원/무료)');
  assert.deepEqual(items.map(isCoupangDeal), [true, false, true]);
  assert.equal(isCoupangDeal({ title: '[네이버] 상품', description: '<a href="https://www.coupang.com/vp/products/1">' }), true);
  assert.equal(isCoupangDeal({ title: '쿠팡 플레이 이용권 이야기', description: '' }), false, '판매처 표시가 아니면 제외');
  assert.equal(postId('ruliweb', items[0].link), '108726');
  assert.equal(postId('ppomppu', parseRss(PPOMPPU)[0].link), '600001');
  assert.equal(postId('ppomppu', 'https://www.ppomppu.co.kr/zboard/view.php?id=ppomppu'), null);
});

test('쿠팡 상품 주소: 상품·옵션 번호만 남기고 추적 값은 버림, 남의 제휴 링크는 쓰지 않음', () => {
  assert.deepEqual(findCoupangUrl('https://www.coupang.com/vp/products/1234567?itemId=11&amp;vendorItemId=22&amp;sourceType=srp'), { url: 'https://www.coupang.com/vp/products/1234567?itemId=11&vendorItemId=22', affiliateOnly: false });
  assert.deepEqual(findCoupangUrl('m: https://m.coupang.com/vp/products/77?src=1'), { url: 'https://www.coupang.com/vp/products/77', affiliateOnly: false });
  assert.deepEqual(findCoupangUrl('<a href="https://link.coupang.com/a/someoneElse">'), { url: '', affiliateOnly: true });
  assert.deepEqual(findCoupangUrl('없음'), { url: '', affiliateOnly: false });
});

test('후보 정리 규칙: 허용 게시판 주소·쿠팡 상품 주소만, 제목 속 가격·상품명 제안', () => {
  const base = { key: 'ruliweb:1', source: 'ruliweb', title: '[쿠팡] 테스트', postUrl: 'https://bbs.ruliweb.com/market/board/1020/read/1' };
  assert.ok(odLeadInput(base, OD_T0));
  for (const over of [{ source: 'fmkorea' }, { key: 'ppomppu:1' }, { key: 'ruliweb:abc' }, { postUrl: 'https://www.fmkorea.com/1' }, { postUrl: 'http://bbs.ruliweb.com/x' }, { title: 'a' }]) {
    assert.equal(odLeadInput({ ...base, ...over }, OD_T0), null, JSON.stringify(over));
  }
  assert.equal(odLeadInput({ ...base, coupangUrl: 'https://link.coupang.com/a/x' }, OD_T0).coupangUrl, '', '단축 링크는 저장하지 않음');
  assert.equal(odLeadInput({ ...base, coupangUrl: 'https://www.coupang.com/vp/products/1?itemId=2&evil=1' }, OD_T0).coupangUrl, '');
  assert.deepEqual(Object.keys(OD_LEAD_SOURCES), ['ppomppu', 'ruliweb'], '에펨코리아(robots 차단)·클리앙(수집기 차단)은 없음');
  assert.equal(odLeadPrice('[쿠팡]새우깡 90g 10개 (9,370원/무료)'), 9370);
  assert.equal(odLeadPrice('[쿠팡] 삼다수 (7,900/무료)'), 7900);
  assert.equal(odLeadPrice('[쿠팡] 케이스'), null);
  assert.equal(odLeadName('[쿠팡]새우깡 90g 10개 (9,370원/무료)'), '새우깡 90g 10개');
  assert.equal(odLeadName('쿠팡) 햇반 210g 36개 32,900원 무배'), '햇반 210g 36개');
});

test('EUC-KR 응답도 글자가 깨지지 않는다', () => {
  const euckr = Buffer.from([0xc4, 0xed, 0xc6, 0xce]); // '쿠팡'
  assert.equal(decodeBody(euckr, 'text/xml; charset=EUC-KR'), '쿠팡');
  assert.equal(decodeBody(Buffer.concat([Buffer.from('<?xml version="1.0" encoding="euc-kr"?>'), euckr]), ''), '<?xml version="1.0" encoding="euc-kr"?>쿠팡');
  assert.equal(decodeBody(Buffer.from('쿠팡'), ''), '쿠팡');
});

function fakeNet(pages) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, ua: init.headers?.['user-agent'] });
    const body = pages[url];
    if (body === undefined) return new Response('not found', { status: 404 });
    if (body instanceof Error) throw body;
    return new Response(body, { status: 200, headers: { 'content-type': 'text/xml; charset=utf-8' } });
  };
  const http = createHttpClient({ allowedHosts: LEAD_HOSTS, fetchImpl, sleep: async () => {}, minIntervalMs: 0, maxRetries: 0 });
  return { calls, http };
}
const allow = async () => ({ allowed: true, reason: 'ok' });

test('후보 찾기: 쿠팡 글만, 이미 본 글은 다시 열지 않고, 상품 주소가 없으면 게시글 한 번만 연다', async () => {
  const pages = { [LEAD_FEEDS[0].url]: PPOMPPU, [LEAD_FEEDS[1].url]: RULIWEB, 'https://bbs.ruliweb.com/market/board/1020/read/108726': POST_108726 };
  const net = fakeNet(pages);
  const out = await findLeads({ http: net.http, robots: allow, known: [], now: OD_T0 });
  assert.deepEqual(out.leads.map(l => [l.key, l.coupangUrl, l.priceHint, l.freeShipping, l.affiliateOnly]), [
    ['ppomppu:600001', 'https://www.coupang.com/vp/products/1234567?itemId=11&vendorItemId=22', 21900, true, false],
    ['ruliweb:108726', 'https://www.coupang.com/vp/products/987654?itemId=5&vendorItemId=6', 9370, true, false],
    ['ruliweb:108728', '', 15900, true, true],
  ]);
  assert.deepEqual(out.stats.map(s => [s.source, s.items, s.coupang, s.added, s.error]), [['ppomppu', 2, 1, 1, ''], ['ruliweb', 3, 2, 2, '']]);
  assert.ok(net.calls.every(c => c.ua === leadUserAgent()), 'AMONGbot 이름으로 요청');
  assert.equal(net.calls.filter(c => c.url.includes('/read/')).length, 2, '상품 주소가 없는 쿠팡 글만 게시글을 연다');
  assert.ok(!net.calls.some(c => c.url.includes('108727')), '쿠팡이 아닌 글은 열지 않음');
  const again = fakeNet(pages);
  const second = await findLeads({ http: again.http, robots: allow, known: out.leads.map(l => l.key), now: OD_T0 });
  assert.equal(second.leads.length, 0);
  assert.equal(again.calls.length, 2, '이미 본 글은 다시 열지 않음 (RSS 두 번만)');
  const capped = fakeNet(pages);
  assert.equal((await findLeads({ http: capped.http, robots: allow, now: OD_T0, maxPosts: 0 })).leads[1].coupangUrl, '', '게시글 열기 한도');
});

test('후보 찾기: robots.txt가 막으면 읽지 않고, 한 게시판이 실패해도 다른 게시판은 계속', async () => {
  const net = fakeNet({ [LEAD_FEEDS[1].url]: RULIWEB, 'https://bbs.ruliweb.com/market/board/1020/read/108726': POST_108726 });
  const robots = async url => (url.includes('ppomppu') ? { allowed: false, reason: 'robots.txt에서 차단된 경로' } : { allowed: true, reason: 'ok' });
  const out = await findLeads({ http: net.http, robots, now: OD_T0 });
  assert.match(out.stats[0].error, /robots/);
  assert.ok(!net.calls.some(c => c.url.includes('ppomppu')), '막힌 게시판은 요청하지 않음');
  assert.equal(out.stats[1].added, 2);
  const down = fakeNet({ [LEAD_FEEDS[1].url]: RULIWEB });
  const res = await findLeads({ http: down.http, robots: allow, now: OD_T0 });
  assert.equal(res.stats[0].error, 'http_404');
  assert.equal(res.stats[1].added, 2, '게시글 열기 실패는 주소 없이 후보로');
});

test('실행: 알고 있는 후보를 먼저 받고, 새 후보만 저장 요청 (시험 모드는 시트에 안 씀)', async () => {
  const pages = { [LEAD_FEEDS[0].url]: PPOMPPU, [LEAD_FEEDS[1].url]: RULIWEB, 'https://bbs.ruliweb.com/market/board/1020/read/108726': POST_108726 };
  const sent = [];
  const api = { async post(action, payload) { sent.push({ action, payload }); return action === 'online_leads_known' ? { ok: true, keys: ['ppomppu:600001'] } : { ok: true, added: payload.leads.length }; } };
  const httpFactory = opts => createHttpClient({ ...opts, fetchImpl: async url => new Response(pages[url] ?? 'x', { status: pages[url] ? 200 : 404 }), sleep: async () => {} });
  const out = await runLeads({ api, httpFactory, robots: allow, now: () => OD_T0 });
  assert.deepEqual(sent.map(s => s.action), ['online_leads_known', 'online_leads_ingest']);
  assert.deepEqual(sent[1].payload.leads.map(l => l.key), ['ruliweb:108726', 'ruliweb:108728']);
  assert.equal(out.saved.added, 2);
  const dry = [];
  await runLeads({ api: { post: async a => { dry.push(a); return {}; } }, dry: true, httpFactory, robots: allow, now: () => OD_T0 });
  assert.deepEqual(dry, []);
});

test('워크플로: 1시간마다, 읽기 권한만, 겹침 방지, 외부 액션 고정, 외부 패키지 설치 없음', async () => {
  const { readFileSync } = await import('node:fs');
  const yml = readFileSync(new URL('../../.github/workflows/online-leads.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(yml, /cron: '41 \* \* \* \*'/);
  assert.match(yml, /permissions:\n  contents: read/);
  assert.match(yml, /concurrency:\n  group: online-leads/);
  for (const uses of yml.match(/uses: \S+/g)) assert.match(uses, /@[0-9a-f]{40}$/, uses);
  assert.doesNotMatch(yml, /npm (ci|install)|playwright|echo[^\n]*secrets\./);
  assert.match(yml, /node src\/online\/leads\.js/);
});
