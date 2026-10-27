// Claude 추출 — AI는 페이지를 "읽고 옮기기"만 한다. 계산·검증은 engine.js (D5)
// SDK 없이 Messages API를 직접 호출한다 (의존성 최소화).
import { CHANNELS, AUDIENCES, ITEM_TYPES, DISCOUNT_TYPES, PROGRAMS, PROGRAM_LABEL, BRANDS, todayKST } from './engine.js';

export const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
const API_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
export const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_URL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';

/** 어느 AI를 쓸지: LLM_PROVIDER가 있으면 그대로, 없으면 Claude 키 → Gemini 키 순 */
export function pickProvider(env = process.env) {
  if (env.MOCK_CLAUDE === '1') return { provider: 'mock', model: 'mock' };
  const p = (env.LLM_PROVIDER || (env.ANTHROPIC_API_KEY ? 'claude' : env.GEMINI_API_KEY ? 'gemini' : 'claude')).toLowerCase();
  if (p === 'gemini') return { provider: 'gemini', model: env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL, apiKey: env.GEMINI_API_KEY };
  return { provider: 'claude', model: env.CLAUDE_MODEL || DEFAULT_MODEL, apiKey: env.ANTHROPIC_API_KEY };
}

const nullable = (type) => ({ type: [type, 'null'] });

export const TOOL = {
  name: 'save_coupons',
  description: '페이지에서 읽은 쿠폰·할인 행사를 저장한다. 페이지에 적힌 내용만 옮기고, 적혀 있지 않은 값은 null.',
  input_schema: {
    type: 'object',
    properties: {
      page_kind: { type: 'string', enum: ['promotion_list', 'promotion_detail', 'menu', 'notice', 'other'], description: '이 페이지의 성격' },
      coupons: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            brand: { type: 'string', description: '이 혜택의 브랜드 이름. 여러 브랜드가 함께 나오는 페이지(통신사 멤버십·결제 혜택)에서는 반드시 적음' },
            menu: { type: 'string', description: '쿠폰이 적용되는 메뉴명 (페이지 표기 그대로). 메뉴 구분이 없으면 "전 메뉴"' },
            item_type: { type: 'string', enum: ITEM_TYPES },
            regular_price: { ...nullable('integer'), description: '정상가(원). 페이지에 적혀 있을 때만' },
            coupon_price: { ...nullable('integer'), description: '쿠폰 적용 후 가격(원). 페이지에 적혀 있을 때만. 직접 계산하지 말 것' },
            discount_type: { type: 'string', enum: DISCOUNT_TYPES, description: 'price=“○○원에”, amount=“○○원 할인”, percent=“○○% 할인”(“1천원당 ○○원 할인”도 percent), free_item=1+1·증정, point_back=결제 후 포인트·캐시 적립' },
            discount_value: { ...nullable('number'), description: 'price면 쿠폰가, amount면 할인액, percent면 % 숫자(“1천원당 ○○원”이면 null), free_item이면 증정품 가격(적혀 있을 때만), point_back이면 적립액 또는 적립률' },
            discount_unit: { type: 'string', enum: ['won', 'percent', ''], description: 'point_back일 때만: 적립이 원이면 won, %면 percent. 그 외에는 빈 문자열' },
            max_discount: { ...nullable('integer'), description: '최대 할인 금액(원)' },
            min_order: { ...nullable('integer'), description: '최소 주문 금액(원)' },
            channels: { type: 'array', items: { type: 'string', enum: CHANNELS }, description: '사용 가능 채널. 적혀 있지 않으면 빈 배열' },
            audience: { type: 'string', enum: AUDIENCES, description: '누구나=전체, 첫 주문·신규가입=신규회원, 등급·멤버십=멤버십, 생일·지정 발급=개인' },
            app_only: { type: 'boolean', description: '앱에서만 쓸 수 있으면 true' },
            start_date: { ...nullable('string'), description: '시작일. YYYY-MM-DD, 연도가 없으면 MM-DD' },
            end_date: { ...nullable('string'), description: '종료일. YYYY-MM-DD, 연도가 없으면 MM-DD' },
            conditions: { type: 'string', description: '그 밖의 조건 (1인 1회, 일부 매장 제외, 요일 한정 등)' },
            programs: { type: 'array', items: { type: 'string', enum: PROGRAMS }, description: '이 혜택을 받으려면 필요한 통신사 멤버십·간편결제·포인트. 그중 하나만 있으면 되면 모두 적음. 필요 없으면 빈 배열' },
            program_note: { type: 'string', description: '등급별 차이·한도 (예: VIP 30% · GOLD/SILVER 20%, 월 1회). 없으면 빈 문자열' },
            how_to_use: { type: 'string', description: '받는 곳과 쓰는 방법을 한 문장으로 (예: KT 멤버십 앱에서 쿠폰 받기 → 도미노 앱 포장 주문 때 쿠폰번호 입력). 페이지에 없으면 빈 문자열' },
            stackable: { type: ['boolean', 'null'], description: '다른 할인과 중복 가능하면 true, 불가면 false, 적혀 있지 않으면 null' },
            evidence: { type: 'string', description: '이 쿠폰 정보가 적힌 원문 구절을 그대로 (100자 이내)' },
            evidence_source: { type: 'string', enum: ['text', 'image'], description: '근거를 페이지 텍스트에서 읽었으면 text, 이미지에서만 읽었으면 image' },
            confidence: { type: 'number', description: '0~1. 모든 값이 명확히 적혀 있으면 0.9 이상, 일부가 애매하면 0.7 이하' },
          },
          required: ['menu', 'discount_type', 'channels', 'audience', 'app_only', 'programs', 'evidence', 'evidence_source', 'confidence'],
        },
      },
      notes: { type: 'string', description: '추출하지 않은 이유나 애매했던 점 (짧게)' },
    },
    required: ['page_kind', 'coupons'],
  },
};

export function systemPrompt() {
  return [
    '당신은 프랜차이즈 공식 홈페이지의 쿠폰·할인 행사 정보를 표로 옮기는 추출기입니다.',
    '규칙:',
    '1. 페이지(텍스트와 이미지)에 실제로 적힌 것만 옮깁니다. 가격을 계산하거나 다른 곳의 가격으로 채우지 않습니다. 없는 값은 null.',
    '2. 할인·쿠폰·특가·1+1·증정 행사만 추출합니다. 메뉴판 가격, 신메뉴 소개, 가격 인상 공지, 단순 광고 문구는 쿠폰이 아닙니다.',
    '3. 브랜드 자체 앱·매장·자체 배달 혜택을 추출합니다. 통신사 멤버십(SKT T멤버십·KT·LG U+), 해피포인트, 네이버페이·카카오페이·토스페이 결제·적립 혜택도 추출하고 programs에 필요한 것을 적습니다. 배달의민족·쿠팡이츠·요기요 등 외부 배달앱 전용 행사와 특정 카드사 결제 할인은 제외합니다.',
    '4. 메뉴마다 가격이 다르면 메뉴별로 따로 적습니다. 하나의 행사에 메뉴가 여러 개면 여러 건이 됩니다.',
    '5. 기간이 지났어도 적혀 있으면 그대로 옮깁니다 (판단은 다음 단계에서 합니다).',
    '6. evidence에는 근거가 된 원문을 고치지 말고 그대로 넣습니다.',
    '7. 확신이 없으면 confidence를 낮추고 notes에 이유를 남깁니다. 지어내지 않습니다.',
    '8. 등급마다 할인이 다르면 모든 회원이 받는 가장 낮은 등급의 값을 discount_value에, 등급별 차이는 program_note에 적습니다.',
    '9. "1천원당 100원 할인"은 discount_type=percent, discount_value=null로 두고 evidence에 그 원문을 넣습니다 (환산은 다음 단계에서 합니다).',
    '10. 결제 후 포인트·캐시 적립은 discount_type=point_back, discount_value에 적립액 또는 적립률, discount_unit에 won 또는 percent.',
    '11. 받는 곳·쓰는 방법(앱 쿠폰함, 바코드 제시, 쿠폰번호 입력 등)이 적혀 있으면 how_to_use에 짧게 적습니다.',
  ].join('\n');
}

export function buildUserContent(page, { brand, category, today, program = '' }) {
  const content = [];
  for (const s of (page.screenshots || []).slice(0, 4)) {
    content.push({ type: 'image', source: { type: 'base64', media_type: s.media_type || 'image/jpeg', data: s.data } });
  }
  content.push({
    type: 'text',
    text: [
      brand ? `브랜드: ${brand} (${category})`
        : `이 페이지는 여러 브랜드의 혜택이 함께 있는 페이지입니다. 다음 브랜드의 혜택만 추출하고 각 항목의 brand에 브랜드 이름을 적으세요: ${BRANDS.map((b) => b[0]).join(', ')}`,
      program ? `이 페이지의 혜택은 모두 ${PROGRAM_LABEL[program] || program}이(가) 있어야 받을 수 있습니다 → programs에 '${program}'을 넣으세요.` : '',
      `오늘(KST): ${today}`,
      `페이지: ${page.finalUrl || page.url}`,
      `제목: ${page.title || ''}`,
      page.screenshots?.length ? `위 이미지는 이 페이지를 위에서부터 자른 화면 ${page.screenshots.length}장입니다.` : '',
      '---- 페이지 텍스트 ----',
      page.text || '(텍스트 없음)',
      '----',
      '이 페이지의 쿠폰·할인 행사를 save_coupons로 저장하세요. 없으면 coupons를 빈 배열로.',
    ].filter(Boolean).join('\n'),
  });
  return content;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Messages API 호출 (429·5xx·529는 재시도) */
export async function callClaude(body, { apiKey = process.env.ANTHROPIC_API_KEY, retries = 4, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 없습니다 (테스트는 MOCK_CLAUDE=1)');
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const res = await fetchImpl(`${API_URL}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    lastErr = new Error(`Claude API ${res.status}: ${text.slice(0, 300)}`);
    if (![408, 429, 500, 502, 503, 504, 529].includes(res.status)) throw lastErr;
    const ra = res.headers.get('retry-after');
    const wait = (ra !== null && !Number.isNaN(+ra) ? +ra : 2 ** i * 2) * 1000;
    await sleep(Math.min(wait, 60000));
  }
  throw lastErr;
}

/**
 * 페이지 1개 → 쿠폰 후보 목록
 * @returns {Promise<{ coupons: object[], page_kind: string, notes: string, usage: { input_tokens, output_tokens }, model: string }>}
 */
export async function extractCoupons(page, { brand, category, program = '', now = new Date(), model = DEFAULT_MODEL, apiKey, mock = process.env.MOCK_CLAUDE === '1', fetchImpl, provider = 'claude' } = {}) {
  if (mock || provider === 'mock') return mockExtract(page);
  if (provider === 'gemini') return extractWithGemini(page, { brand, category, program, now, model, apiKey, fetchImpl });
  const today = todayKST(now);
  const body = {
    model,
    max_tokens: 4096,
    temperature: 0,
    system: systemPrompt(),
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content: buildUserContent(page, { brand, category, today, program }) }],
  };
  const res = await callClaude(body, { fetchImpl, apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
  const block = (res.content || []).find((b) => b.type === 'tool_use' && b.name === TOOL.name);
  if (!block) throw new Error(`Claude 응답에 ${TOOL.name} 호출이 없음 (stop_reason=${res.stop_reason})`);
  const input = block.input || {};
  return {
    coupons: Array.isArray(input.coupons) ? input.coupons : [],
    page_kind: input.page_kind || 'other',
    notes: input.notes || '',
    usage: { input_tokens: res.usage?.input_tokens || 0, output_tokens: res.usage?.output_tokens || 0 },
    model: res.model || model,
    truncated: res.stop_reason === 'max_tokens',
  };
}

// ---------- Gemini (무료 한도 실험용, 나중에 Claude로 전환) ----------
// 같은 프롬프트·같은 출력 형식(save_coupons의 input)을 JSON으로 받는다. 계산·검증은 똑같이 engine.js
export async function callGemini(model, body, { apiKey = process.env.GEMINI_API_KEY, retries = 4, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY가 없습니다');
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const res = await fetchImpl(`${GEMINI_URL}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    lastErr = Object.assign(new Error(`Gemini API ${res.status}: ${text.slice(0, 300)}`), { status: res.status, body: text });
    // 하루 무료 한도 소진: 기다려도 소용없으니 바로 멈춘다 (수집기가 남은 출처를 건너뜀)
    if (res.status === 429 && /PerDay|per day|daily/i.test(text)) throw Object.assign(lastErr, { code: 'AI_QUOTA', message: `Gemini 하루 무료 한도 소진: ${text.slice(0, 200)}` });
    if (![408, 429, 500, 502, 503, 504].includes(res.status)) throw lastErr;
    const m = text.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
    const wait = (m ? +m[1] + 1 : 2 ** i * 3) * 1000;
    await sleep(Math.min(wait, 40000));
  }
  throw lastErr;
}

export function buildGeminiBody(page, { brand, category, today, program = '', withSchema = true }) {
  const parts = [];
  for (const c of buildUserContent(page, { brand, category, today, program })) {
    if (c.type === 'image') parts.push({ inlineData: { mimeType: c.source.media_type, data: c.source.data } });
    else parts.push({ text: c.text.replace('save_coupons로 저장하세요', 'JSON으로 답하세요') });
  }
  if (!withSchema) parts.push({ text: `답은 다음 JSON 스키마를 따르는 JSON 객체 하나만:\n${JSON.stringify(TOOL.input_schema)}` });
  const generationConfig = { temperature: 0, maxOutputTokens: 16384, responseMimeType: 'application/json' };
  if (withSchema) generationConfig.responseJsonSchema = TOOL.input_schema;
  return {
    systemInstruction: { parts: [{ text: systemPrompt() }] },
    contents: [{ role: 'user', parts }],
    generationConfig,
  };
}

export function parseJsonLoose(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* 앞뒤 잡문 제거 후 재시도 */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error(`Gemini 응답이 JSON이 아님: ${t.slice(0, 120)}`);
}

async function extractWithGemini(page, { brand, category, program, now, model, apiKey, fetchImpl }) {
  const today = todayKST(now);
  const opts = { fetchImpl, apiKey: apiKey || process.env.GEMINI_API_KEY };
  let res;
  try {
    res = await callGemini(model, buildGeminiBody(page, { brand, category, today, program }), opts);
  } catch (e) {
    // 스키마 지정 방식을 모델이 거부하면 스키마를 프롬프트에 넣어 한 번 더
    if (e.status !== 400 || !/schema|Unknown name|Invalid JSON payload/i.test(e.body || '')) throw e;
    res = await callGemini(model, buildGeminiBody(page, { brand, category, today, program, withSchema: false }), opts);
  }
  const cand = (res.candidates || [])[0];
  if (!cand) throw new Error(`Gemini 응답에 후보가 없음 (${JSON.stringify(res.promptFeedback || {}).slice(0, 200)})`);
  const text = (cand.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  const input = parseJsonLoose(text);
  const u = res.usageMetadata || {};
  return {
    coupons: Array.isArray(input.coupons) ? input.coupons : [],
    page_kind: input.page_kind || 'other',
    notes: input.notes || '',
    usage: { input_tokens: u.promptTokenCount || 0, output_tokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) },
    model: res.modelVersion || model,
    truncated: cand.finishReason === 'MAX_TOKENS',
  };
}

// ---------- 테스트용 모의 추출 (MOCK_CLAUDE=1) ----------
// 형식: "메뉴 | 정상가 8,000원 | 쿠폰가 5,500원 | 매장·픽업 | 전체 | ~2026-10-31"
//       "메뉴 | 정상가 6,900원 | 20% 할인 | 배달 | 신규 | 2026-10-20~2026-11-10 | 앱 전용"
export function mockExtract(page) {
  const coupons = [];
  for (const line of String(page.text || '').split('\n')) {
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length < 5 || !/정상가/.test(parts[1])) continue;
    const [menu0, reg, disc, ch, aud, period = '', extra = ''] = parts;
    const bm = menu0.match(/^\[(.+?)\]\s*(.+)$/);  // "[파리바게뜨] 전 제품" — 여러 브랜드 페이지 시험용
    const menu = bm ? bm[2] : menu0;
    const c = { menu, regular_price: +reg.replace(/\D/g, '') || null, channels: ch.split(/[·,]/), audience: aud, app_only: /앱\s*전용/.test(extra), programs: [], evidence: line.slice(0, 100), evidence_source: 'text', confidence: 0.95 };
    if (bm) c.brand = bm[1];
    if (/쿠폰가/.test(disc)) Object.assign(c, { discount_type: 'price', coupon_price: +disc.replace(/\D/g, '') });
    else if (/적립/.test(disc)) Object.assign(c, { discount_type: 'point_back', discount_value: +disc.replace(/[^\d.]/g, ''), discount_unit: /%/.test(disc) ? 'percent' : 'won' });
    else if (/%/.test(disc)) Object.assign(c, { discount_type: 'percent', discount_value: +disc.replace(/[^\d.]/g, '') });
    else if (/할인/.test(disc)) Object.assign(c, { discount_type: 'amount', discount_value: +disc.replace(/\D/g, '') });
    const [s, e] = period.includes('~') ? period.split('~').map((x) => x.trim()) : [null, period];
    Object.assign(c, { start_date: s || null, end_date: e || null, item_type: /세트/.test(menu) ? '세트' : '단품' });
    coupons.push(c);
  }
  return Promise.resolve({ coupons, page_kind: coupons.length ? 'promotion_list' : 'other', notes: 'mock', usage: { input_tokens: 0, output_tokens: 0 }, model: 'mock' });
}
