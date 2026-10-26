// Claude 추출 — AI는 페이지를 "읽고 옮기기"만 한다. 계산·검증은 engine.js (D5)
// SDK 없이 Messages API를 직접 호출한다 (의존성 최소화).
import { CHANNELS, AUDIENCES, ITEM_TYPES, DISCOUNT_TYPES, todayKST } from './engine.js';

export const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
const API_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';

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
            menu: { type: 'string', description: '쿠폰이 적용되는 메뉴명 (페이지 표기 그대로)' },
            item_type: { type: 'string', enum: ITEM_TYPES },
            regular_price: { ...nullable('integer'), description: '정상가(원). 페이지에 적혀 있을 때만' },
            coupon_price: { ...nullable('integer'), description: '쿠폰 적용 후 가격(원). 페이지에 적혀 있을 때만. 직접 계산하지 말 것' },
            discount_type: { type: 'string', enum: DISCOUNT_TYPES, description: 'price=“○○원에”, amount=“○○원 할인”, percent=“○○% 할인”, free_item=1+1·증정' },
            discount_value: { ...nullable('number'), description: 'price면 쿠폰가, amount면 할인액, percent면 % 숫자, free_item이면 증정품 가격(적혀 있을 때만)' },
            max_discount: { ...nullable('integer'), description: '최대 할인 금액(원)' },
            min_order: { ...nullable('integer'), description: '최소 주문 금액(원)' },
            channels: { type: 'array', items: { type: 'string', enum: CHANNELS }, description: '사용 가능 채널. 적혀 있지 않으면 빈 배열' },
            audience: { type: 'string', enum: AUDIENCES, description: '누구나=전체, 첫 주문·신규가입=신규회원, 등급·멤버십=멤버십, 생일·지정 발급=개인' },
            app_only: { type: 'boolean', description: '앱에서만 쓸 수 있으면 true' },
            start_date: { ...nullable('string'), description: '시작일. YYYY-MM-DD, 연도가 없으면 MM-DD' },
            end_date: { ...nullable('string'), description: '종료일. YYYY-MM-DD, 연도가 없으면 MM-DD' },
            conditions: { type: 'string', description: '그 밖의 조건 (1인 1회, 일부 매장 제외, 요일 한정 등)' },
            evidence: { type: 'string', description: '이 쿠폰 정보가 적힌 원문 구절을 그대로 (100자 이내)' },
            evidence_source: { type: 'string', enum: ['text', 'image'], description: '근거를 페이지 텍스트에서 읽었으면 text, 이미지에서만 읽었으면 image' },
            confidence: { type: 'number', description: '0~1. 모든 값이 명확히 적혀 있으면 0.9 이상, 일부가 애매하면 0.7 이하' },
          },
          required: ['menu', 'discount_type', 'channels', 'audience', 'app_only', 'evidence', 'evidence_source', 'confidence'],
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
    '3. 배달의민족·쿠팡이츠·요기요 등 외부 배달앱 전용 행사와 제휴카드·통신사 할인은 제외합니다. 브랜드 자체 앱·매장·자체 배달은 포함합니다.',
    '4. 메뉴마다 가격이 다르면 메뉴별로 따로 적습니다. 하나의 행사에 메뉴가 여러 개면 여러 건이 됩니다.',
    '5. 기간이 지났어도 적혀 있으면 그대로 옮깁니다 (판단은 다음 단계에서 합니다).',
    '6. evidence에는 근거가 된 원문을 고치지 말고 그대로 넣습니다.',
    '7. 확신이 없으면 confidence를 낮추고 notes에 이유를 남깁니다. 지어내지 않습니다.',
  ].join('\n');
}

export function buildUserContent(page, { brand, category, today }) {
  const content = [];
  for (const s of (page.screenshots || []).slice(0, 4)) {
    content.push({ type: 'image', source: { type: 'base64', media_type: s.media_type || 'image/jpeg', data: s.data } });
  }
  content.push({
    type: 'text',
    text: [
      `브랜드: ${brand} (${category})`,
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
export async function extractCoupons(page, { brand, category, now = new Date(), model = DEFAULT_MODEL, apiKey, mock = process.env.MOCK_CLAUDE === '1', fetchImpl } = {}) {
  if (mock) return mockExtract(page);
  const today = todayKST(now);
  const body = {
    model,
    max_tokens: 4096,
    temperature: 0,
    system: systemPrompt(),
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content: buildUserContent(page, { brand, category, today }) }],
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

// ---------- 테스트용 모의 추출 (MOCK_CLAUDE=1) ----------
// 형식: "메뉴 | 정상가 8,000원 | 쿠폰가 5,500원 | 매장·픽업 | 전체 | ~2026-10-31"
//       "메뉴 | 정상가 6,900원 | 20% 할인 | 배달 | 신규 | 2026-10-20~2026-11-10 | 앱 전용"
export function mockExtract(page) {
  const coupons = [];
  for (const line of String(page.text || '').split('\n')) {
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length < 5 || !/정상가/.test(parts[1])) continue;
    const [menu, reg, disc, ch, aud, period = '', extra = ''] = parts;
    const c = { menu, regular_price: +reg.replace(/\D/g, ''), channels: ch.split(/[·,]/), audience: aud, app_only: /앱\s*전용/.test(extra), evidence: line.slice(0, 100), evidence_source: 'text', confidence: 0.95 };
    if (/쿠폰가/.test(disc)) Object.assign(c, { discount_type: 'price', coupon_price: +disc.replace(/\D/g, '') });
    else if (/%/.test(disc)) Object.assign(c, { discount_type: 'percent', discount_value: +disc.replace(/[^\d.]/g, '') });
    else if (/할인/.test(disc)) Object.assign(c, { discount_type: 'amount', discount_value: +disc.replace(/\D/g, '') });
    const [s, e] = period.includes('~') ? period.split('~').map((x) => x.trim()) : [null, period];
    Object.assign(c, { start_date: s || null, end_date: e || null, item_type: /세트/.test(menu) ? '세트' : '단품' });
    coupons.push(c);
  }
  return Promise.resolve({ coupons, page_kind: coupons.length ? 'promotion_list' : 'other', notes: 'mock', usage: { input_tokens: 0, output_tokens: 0 }, model: 'mock' });
}
