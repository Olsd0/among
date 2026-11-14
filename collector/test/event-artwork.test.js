import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEventArtwork, DEFAULT_ARTWORK_FEEDS } from '../src/event-artwork.js';
import { encodeArtworkUrl, decodeArtworkUrl } from '../src/artwork-meta.js';

const now = new Date('2026-11-14T03:00:00Z');
const base = { id: 'shack-1', brand: '쉐이크쉑', source_id: 'shack', status: 'published', title: '쉐이크쉑 쿠폰 행사', summary: '앱 쿠폰', start_date: '2026-11-01', end_date: '2026-11-30', image_url: '', checked_at: '2026-11-13' };
const feedUrl = 'https://www.smdnewsroom.co.kr/feed/';
const articleUrl = 'https://www.smdnewsroom.co.kr/shack-menu/';
const imageUrl = 'https://images.example.com/shack-menu.jpg';
const metadata = { kind: 'press_related', source: articleUrl, checkedAt: now.toISOString(), credit: '사진=쉐이크쉑 제공' };
const jpeg = Buffer.alloc(1500, 1); jpeg[0] = 255; jpeg[1] = 216; jpeg[2] = 255;
function article({ title = '쉐이크쉑 신메뉴 출시', published = '2026-11-04T09:00:00+09:00', credit = '사진=쉐이크쉑 제공', image = imageUrl, extra = '' } = {}) {
  return `<html><head><title>${title}</title><meta property="article:published_time" content="${published}"></head><body><article><h1>${title}</h1><figure><img src="${image}" alt="쉐이크쉑 신메뉴" width="800" height="600"><figcaption>${credit}</figcaption></figure><p>${extra}</p></article></body></html>`;
}
function fixture({ articleHtml = article(), feed = true, imageMime = 'image/jpeg', routes = {} } = {}) {
  const map = {
    [feedUrl]: { mime: 'application/rss+xml', text: `<rss><channel><item><title>쉐이크쉑 신메뉴 출시</title><link>${articleUrl}</link><pubDate>Wed, 04 Nov 2026 00:00:00 GMT</pubDate></item></channel></rss>` },
    [articleUrl]: { mime: 'text/html', text: articleHtml },
    [imageUrl]: { mime: imageMime, text: jpeg },
    ...routes,
  };
  const calls = [];
  return { calls, options: { now, feeds: feed ? [feedUrl] : [], robotsCheck: async () => ({ allowed: true }), lookup: async () => [{ address: '93.184.216.34' }], fetchImpl: async (url, opts) => {
    calls.push(url); assert.equal(opts.redirect, 'manual');
    const value = map[url]; if (!value) throw new Error('unmapped_request');
    return new Response(value.status ? null : value.text, { status: value.status || 200, headers: { 'content-type': value.mime || 'text/html', ...(value.headers || {}) } });
  } } };
}

test('metadata round-trips through a single Sheets image_url value and bounds malformed input', () => {
  const encoded = encodeArtworkUrl(imageUrl, metadata);
  assert.deepEqual(decodeArtworkUrl(encoded), { url: imageUrl, meta: metadata });
  assert.equal(new URL(encoded).pathname, '/shack-menu.jpg');
  assert.equal(encodeArtworkUrl('javascript:alert(1)', metadata), '');
  assert.equal(decodeArtworkUrl(imageUrl + '#among-artwork=%zz').meta, null);
  assert.equal(decodeArtworkUrl(imageUrl + '#among-artwork=' + 'x'.repeat(12001)).meta, null);
  assert.equal(decodeArtworkUrl(imageUrl + '#among-artwork=' + encodeURIComponent(JSON.stringify({ ...metadata, source: 'http://unsafe.example' }))).meta, null);
});

test('exact official poster and expired/rejected records never trigger retrieval', async () => {
  const f = fixture();
  const input = [{ ...base, image_url: 'https://brand.example/event-poster.jpg' }, { ...base, status: 'rejected' }, { ...base, status: 'hidden' }, { ...base, status: 'gone' }, { ...base, end_date: '2026-11-13' }];
  const result = await resolveEventArtwork(input, f.options);
  assert.deepEqual(result.news, input); assert.equal(f.calls.length, 0);
});

test('keyless RSS acquires a recent brand photo and preserves factual timestamps', async () => {
  const f = fixture();
  const result = await resolveEventArtwork([base], { ...f.options, press: { connected: false } });
  assert.equal(result.summary.filled, 1); assert.equal(result.summary.feedsRead, 1);
  const row = result.news[0]; const decoded = decodeArtworkUrl(row.image_url);
  assert.equal(decoded.url, imageUrl); assert.equal(decoded.meta.source, articleUrl);
  assert.equal(row.image_kind, 'press_related'); assert.equal(row.checked_at, base.checked_at);
  assert.equal(row.start_date, base.start_date); assert.equal(row.end_date, base.end_date);
  assert.equal(base.image_url, ''); assert.equal(result.summary.searchConnected, false);
});

test('CDATA feed titles are usable and stale feed entries do not consume article slots', async () => {
  const f = fixture({ routes: { [feedUrl]: { mime: 'text/xml', text: `<rss><channel>
    <item><title><![CDATA[쉐이크쉑 구형 행사]]></title><link>https://news.example.com/old</link><pubDate>2025-11-01</pubDate></item>
    <item><title><![CDATA[쉐이크쉑 신메뉴]]></title><link>${articleUrl}</link><pubDate>2026-11-04</pubDate></item>
    </channel></rss>` } } });
  const result = await resolveEventArtwork([base], { ...f.options, maxArticles: 1 });
  assert.equal(result.summary.filled, 1);
  assert.ok(!f.calls.some(u => u.endsWith('/old')));
});

test('known article is reused only for the same active campaign, with original image check date', async () => {
  const f = fixture();
  const known = { ...base, image_url: encodeArtworkUrl(imageUrl, { ...metadata, checkedAt: '2026-11-10T00:00:00.000Z' }) };
  const result = await resolveEventArtwork([base], { ...f.options, knownNews: [known] });
  assert.equal(result.summary.reused, 1); assert.equal(f.calls.length, 0);
  assert.equal(decodeArtworkUrl(result.news[0].image_url).meta.checkedAt, '2026-11-10T00:00:00.000Z');
  const mismatch = await resolveEventArtwork([base], { ...f.options, feeds: [], knownNews: [{ ...known, end_date: '2026-12-31' }] });
  assert.equal(mismatch.summary.reused, 0); assert.equal(mismatch.news[0].image_url, '');
});

test('known generic official-related image can be upgraded; failures retain it', async () => {
  const related = { ...base, image_url: 'https://brand.example/product.jpg', image_kind: 'official_related' };
  const f = fixture();
  assert.equal((await resolveEventArtwork([related], f.options)).news[0].image_kind, 'press_related');
  const fail = fixture({ imageMime: 'text/html' });
  assert.equal((await resolveEventArtwork([related], fail.options)).news[0].image_url, related.image_url);
});

for (const [name, changed] of [
  ['old publication', { published: '2025-11-04' }],
  ['different brand', { title: '다른 브랜드 신메뉴 출시' }],
  ['generated illustration', { extra: 'AI 생성 이미지' }],
  ['conflicting discount campaign', { title: '쉐이크쉑 50% 할인 행사', extra: '11월 30일까지' }],
]) test(`rejects ${name}`, async () => {
  const f = fixture({ articleHtml: article(changed) });
  const result = await resolveEventArtwork([base], f.options);
  assert.equal(result.summary.filled, 0); assert.equal(result.news[0].image_url, '');
  assert.ok(!f.calls.includes(imageUrl));
});

test('independent reporting needs a brand-supplied photo credit', async () => {
  const url = 'https://news.example.com/story';
  const f = fixture({ feed: false, routes: { [url]: { mime: 'text/html', text: article({ credit: '사진=뉴스 기자' }) } } });
  const press = { connected: true, search: async () => [{ url, text: '쉐이크쉑 신메뉴 출시' }] };
  assert.equal((await resolveEventArtwork([base], { ...f.options, press })).summary.filled, 0);
});

test('rejects private or blocked redirect targets before sending a request', async () => {
  for (const target of ['https://127.0.0.1/private', 'https://m.blog.naver.com/nv_npay/123', 'https://blog.naver.com/nv_npay/123', 'https://m.blog.naver.com./nv_npay/123']) {
    const f = fixture({ routes: { [articleUrl]: { status: 302, headers: { location: target } } } });
    const result = await resolveEventArtwork([base], f.options);
    assert.equal(result.summary.filled, 0); assert.ok(!f.calls.includes(target));
  }
});

test('checks robots before requesting each redirect destination', async () => {
  const target = articleUrl + 'robots-disallowed';
  const f = fixture({ routes: { [articleUrl]: { status: 302, headers: { location: target } } } });
  const checked = [];
  const result = await resolveEventArtwork([base], { ...f.options, robotsCheck: async url => { checked.push(url); return { allowed: url !== target }; } });
  assert.equal(result.summary.filled, 0); assert.ok(checked.includes(target)); assert.ok(!f.calls.includes(target));
});

test('follows public redirects and records the final article and image URLs', async () => {
  const finalArticle = articleUrl + 'canonical'; const finalImage = imageUrl + '?original=1';
  const f = fixture({ routes: {
    [articleUrl]: { status: 301, headers: { location: finalArticle } },
    [finalArticle]: { mime: 'text/html', text: article() },
    [imageUrl]: { status: 302, headers: { location: finalImage } },
    [finalImage]: { mime: 'image/jpeg', text: jpeg },
  } });
  const result = await resolveEventArtwork([base], f.options);
  assert.equal(result.summary.filled, 1);
  assert.equal(decodeArtworkUrl(result.news[0].image_url).url, finalImage);
  assert.equal(result.news[0].image_source_url, finalArticle);
});

test('rejects wrong MIME, fake image bytes, oversized response, and robots denial', async () => {
  const variations = [
    fixture({ imageMime: 'image/svg+xml' }),
    fixture({ routes: { [imageUrl]: { mime: 'image/jpeg', text: '<html>not a photograph</html>' } } }),
    fixture({ routes: { [articleUrl]: { mime: 'text/html', text: article(), headers: { 'content-length': String(3 * 1024 * 1024) } } } }),
  ];
  for (const f of variations) assert.equal((await resolveEventArtwork([base], f.options)).summary.filled, 0);
  const f = fixture();
  assert.equal((await resolveEventArtwork([base], { ...f.options, robotsCheck: async () => ({ allowed: false }) })).summary.filled, 0);
  assert.equal(f.calls.length, 0);
});

test('enforces request, item, and total time budgets without failing the collector', async () => {
  const f = fixture();
  const rows = Array.from({ length: 12 }, (_, i) => ({ ...base, id: `id-${i}` }));
  const result = await resolveEventArtwork(rows, { ...f.options, maxItems: 2, maxRequests: 1 });
  assert.equal(result.summary.checked, 2); assert.equal(f.calls.length, 1);
  const none = await resolveEventArtwork([base], { ...f.options, budgetMs: 0 });
  assert.equal(none.summary.requests, 0); assert.equal(none.news[0].image_url, '');
  assert.equal(DEFAULT_ARTWORK_FEEDS.length, 3);
});
