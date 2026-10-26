import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowed } from '../src/robots.js';
import { extractCoupons, buildUserContent, TOOL } from '../src/extract.js';

const ROBOTS = `
User-agent: *
Disallow: /mypage/
Disallow: /*.json$
Allow: /mypage/public/

User-agent: BadBot
Disallow: /
`;

test('robots.txt: 경로·와일드카드·Allow 우선', () => {
  assert.equal(isAllowed(ROBOTS, 'https://x.kr/promotion/list'), true);
  assert.equal(isAllowed(ROBOTS, 'https://x.kr/mypage/coupon'), false);
  assert.equal(isAllowed(ROBOTS, 'https://x.kr/mypage/public/a'), true);
  assert.equal(isAllowed(ROBOTS, 'https://x.kr/api/menu.json'), false);
  assert.equal(isAllowed(ROBOTS, 'https://x.kr/api/menu.json?x=1'), true);
  assert.equal(isAllowed(ROBOTS, 'https://x.kr/anything', 'BadBot/1.0'), false);
  assert.equal(isAllowed('', 'https://x.kr/a'), true);
  assert.equal(isAllowed('User-agent: *\nDisallow:', 'https://x.kr/a'), true);
});

test('Claude 호출: tool 강제, 이미지+텍스트 입력, 응답 파싱', async () => {
  let sent;
  const fakeFetch = async (url, init) => {
    sent = { url, headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      model: 'claude-test', stop_reason: 'tool_use', usage: { input_tokens: 1200, output_tokens: 150 },
      content: [{ type: 'tool_use', name: 'save_coupons', input: { page_kind: 'promotion_detail', coupons: [{ menu: '불고기버거 세트', discount_type: 'price', coupon_price: 5500 }] } }],
    }), { status: 200 });
  };
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  try {
    const page = { url: 'https://x.kr/p/1', text: '불고기버거 세트 5,500원', screenshots: [{ media_type: 'image/jpeg', data: 'AAAA' }] };
    const r = await extractCoupons(page, { brand: '맥도날드', category: '햄버거', now: new Date('2026-10-25T03:00:00Z'), model: 'claude-test', fetchImpl: fakeFetch });
    assert.equal(r.coupons.length, 1);
    assert.equal(r.usage.input_tokens, 1200);
    assert.equal(sent.headers['x-api-key'], 'sk-test');
    assert.deepEqual(sent.body.tool_choice, { type: 'tool', name: 'save_coupons' });
    assert.equal(sent.body.tools[0].name, TOOL.name);
    const content = sent.body.messages[0].content;
    assert.equal(content[0].type, 'image');
    assert.ok(content.at(-1).text.includes('오늘(KST): 2026-10-25'));
  } finally {
    process.env.ANTHROPIC_API_KEY = prev;
  }
});

test('Claude 호출: 429는 재시도, 400은 즉시 실패', async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  try {
    let n = 0;
    const flaky = async () => (++n === 1
      ? new Response('busy', { status: 429, headers: { 'retry-after': '0' } })
      : new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'save_coupons', input: { page_kind: 'other', coupons: [] } }], usage: {} }), { status: 200 }));
    const r = await extractCoupons({ text: 'x' }, { brand: 'A', category: '햄버거', fetchImpl: flaky });
    assert.equal(n, 2);
    assert.deepEqual(r.coupons, []);

    const bad = async () => new Response('{"error":"invalid"}', { status: 400 });
    await assert.rejects(extractCoupons({ text: 'x' }, { brand: 'A', category: '햄버거', fetchImpl: bad }), /400/);
  } finally {
    process.env.ANTHROPIC_API_KEY = prev;
  }
});

test('이미지는 최대 4장만 보낸다', () => {
  const shots = Array.from({ length: 6 }, () => ({ data: 'A' }));
  const c = buildUserContent({ text: 't', screenshots: shots }, { brand: 'A', category: '햄버거', today: '2026-10-25' });
  assert.equal(c.filter((b) => b.type === 'image').length, 4);
});

test('AI 수집 거부(ClaudeBot 등)도 따른다 · 같은 사이트 판정', async () => {
  const { robotsAllows, clearRobotsCache } = await import('../src/robots.js');
  const { sameSite } = await import('../src/fetch.js');
  clearRobotsCache();
  const txt = 'User-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n';
  const fake = async () => new Response(txt, { status: 200 });
  const r = await robotsAllows('https://brand.example.kr/event', { fetchImpl: fake });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /ClaudeBot/);
  clearRobotsCache();
  const ok = await robotsAllows('https://brand.example.kr/event', { fetchImpl: async () => new Response('', { status: 404 }) });
  assert.equal(ok.allowed, true);
  clearRobotsCache();
  const down = await robotsAllows('https://brand.example.kr/event', { fetchImpl: async () => new Response('', { status: 503 }) });
  assert.equal(down.allowed, false, '서버 오류면 보수적으로 불허');
  assert.equal(sameSite('https://event.burgerking.co.kr/a', 'https://www.burgerking.co.kr/'), true);
  assert.equal(sameSite('https://evil.co.kr/a', 'https://www.burgerking.co.kr/'), false);
  assert.equal(sameSite('https://m.mcdonalds.co.kr/x', 'https://www.mcdonalds.co.kr/'), true);
  assert.equal(sameSite('javascript:void(0)', 'https://www.mcdonalds.co.kr/'), false);
});

test('Gemini 추출: 요청 형식·JSON 응답·토큰 집계, 키에 따라 공급자 선택', async () => {
  const { pickProvider } = await import('../src/extract.js');
  assert.equal(pickProvider({ GEMINI_API_KEY: 'g' }).provider, 'gemini');
  assert.equal(pickProvider({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }).provider, 'claude');
  assert.equal(pickProvider({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a', LLM_PROVIDER: 'gemini' }).provider, 'gemini');
  assert.equal(pickProvider({ MOCK_CLAUDE: '1' }).provider, 'mock');

  let sent;
  const fake = async (url, init) => {
    sent = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '```json\n{"page_kind":"promotion_detail","coupons":[{"menu":"불고기버거 세트","discount_type":"price","coupon_price":5500}]}\n```' }] } }],
      usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 80, thoughtsTokenCount: 20 }, modelVersion: 'gemini-test',
    }), { status: 200 });
  };
  const page = { url: 'https://x.kr/p/1', text: '불고기버거 세트 5,500원', screenshots: [{ media_type: 'image/jpeg', data: 'AAAA' }] };
  const r = await extractCoupons(page, { provider: 'gemini', apiKey: 'g-test', model: 'gemini-test', brand: '맥도날드', category: '햄버거', now: new Date('2026-10-25T03:00:00Z'), fetchImpl: fake });
  assert.equal(r.coupons[0].coupon_price, 5500);
  assert.equal(r.usage.input_tokens, 900);
  assert.equal(r.usage.output_tokens, 100);
  assert.ok(sent.url.endsWith('/v1beta/models/gemini-test:generateContent'));
  assert.equal(sent.headers['x-goog-api-key'], 'g-test');
  assert.equal(sent.body.contents[0].parts[0].inlineData.mimeType, 'image/jpeg');
  assert.equal(sent.body.generationConfig.responseMimeType, 'application/json');
  assert.ok(sent.body.generationConfig.responseJsonSchema.properties.coupons);

  // 스키마 방식 거부(400) → 스키마를 프롬프트에 넣어 재시도
  let n = 0;
  const reject = async (url, init) => {
    n++;
    const b = JSON.parse(init.body);
    if (b.generationConfig.responseJsonSchema) return new Response('{"error":{"message":"Invalid JSON payload received. Unknown name \"responseJsonSchema\""}}', { status: 400 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"page_kind":"other","coupons":[]}' }] } }] }), { status: 200 });
  };
  const r2 = await extractCoupons({ text: 'x' }, { provider: 'gemini', apiKey: 'g', model: 'm', brand: 'A', category: '햄버거', fetchImpl: reject });
  assert.equal(n, 2);
  assert.deepEqual(r2.coupons, []);
});
