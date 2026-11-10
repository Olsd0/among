// 기간 팩트체크 1·2단계 — 공식 원문 글자 → 공식 공지 이미지 (11/10 대표 결정)
// 소식을 읽은 화면이 상세 화면이면 그 화면을 다시(사진 더 많이), 목록이면 그 공지의 배너를 눌러 상세 화면을 연다.
// 글자에 기간이 있으면 '공식 원문', 없으면 AI가 배너·상세 화면 사진에서 '그 행사의 기간 글자'만 그대로 옮기고 → 우리 규칙으로 날짜를 읽는다(AI가 날짜를 계산하지 않음).
import { callGemini, callClaude, parseJsonLoose } from './extract.js';
import { parsePeriodText, sameEvent, benefitNumbers, eventWords, PERIOD_SOURCE } from './period-check.js';
import { todayKST } from './engine.js';

const firstSeenDay = (n, now) => (n.first_seen && Number.isFinite(Date.parse(n.first_seen)) ? todayKST(new Date(n.first_seen)) : todayKST(now));

const QUOTE_SCHEMA = { type: 'object', properties: { found: { type: 'boolean' }, quote: { type: 'string' } }, required: ['found', 'quote'] };

export function periodPrompt(n) {
  return [
    `${n.brand}의 공식 이벤트 공지 화면(배너·상세)입니다.`,
    `이 중 '${n.title}'${n.discount_label ? ` (${n.discount_label})` : ''} 행사의 진행 기간이 이미지에 글자로 적혀 있으면, 그 기간 글자를 보이는 그대로 quote에 옮기고 found=true로 답하세요.`,
    '예: "2026.11.09(일) ~ 11.13(목)", "11월 9일부터 11월 13일까지".',
    '기간이 적혀 있지 않으면 found=false, quote="".',
    '다른 행사의 날짜, 쿠폰 사용기한, 공지 게시일, 앱 업데이트 날짜는 넣지 마세요. 날짜를 추측하거나 계산하지 마세요.',
    'JSON 객체 하나로만 답하세요: {"found": true|false, "quote": "..."}',
  ].join('\n');
}

/** 화면 사진들 → AI가 옮긴 기간 글자 (provider: gemini | claude). 실패하면 '' */
export async function askPeriodQuote(images, n, { provider = 'gemini', model, apiKey, fetchImpl = fetch } = {}) {
  const imgs = images.filter(Boolean).slice(0, 5);
  if (!imgs.length) return '';
  if (provider === 'gemini') {
    const body = {
      contents: [{ role: 'user', parts: [...imgs.map((s) => ({ inlineData: { mimeType: s.media_type || 'image/jpeg', data: s.data } })), { text: periodPrompt(n) }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 512, responseMimeType: 'application/json', responseJsonSchema: QUOTE_SCHEMA },
    };
    const res = await callGemini(model, body, { apiKey, fetchImpl, retries: 2 });
    const text = ((res.candidates || [])[0]?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
    const j = parseJsonLoose(text);
    return j && j.found ? String(j.quote || '').slice(0, 200) : '';
  }
  if (provider === 'claude') {
    const res = await callClaude({
      model, max_tokens: 300, temperature: 0,
      messages: [{ role: 'user', content: [...imgs.map((s) => ({ type: 'image', source: { type: 'base64', media_type: s.media_type || 'image/jpeg', data: s.data } })), { type: 'text', text: periodPrompt(n) }] }],
    }, { apiKey, fetchImpl, retries: 2 });
    const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    const j = parseJsonLoose(text);
    return j && j.found ? String(j.quote || '').slice(0, 200) : '';
  }
  return '';
}

/**
 * 공식 단계 읽기 함수 만들기 (run.js에서 사용)
 * deps: { capture(listUrl, imageUrl), render(url), sources: Map(id → 출처), llm: {provider, model, apiKey}, now, log }
 * @returns {(n) => Promise<{start, end, source, quote}|null>}
 */
export function officialReader({ capture, render, sources = new Map(), llm = {}, now = new Date(), log = () => {}, ask = askPeriodQuote }) {
  return async (n) => {
    const src = sources.get(n.source_id);
    if (!src || !src.url) return null;
    const base = firstSeenDay(n, now);
    let cap = null;
    const isDetail = n.source_url && n.source_url.split('#')[0] !== String(src.url).split('#')[0];
    if (isDetail && render) {
      const p = await render(n.source_url);
      cap = p ? { banner: null, moved: true, text: p.text, screenshots: p.screenshots || [], detailUrl: p.finalUrl || n.source_url } : null;
    } else if (capture) {
      // 배너 이미지 주소로 찾고, 이미지가 없으면 제목 낱말·혜택 숫자가 모두 들어 있는 카드로 찾는다
      const words = [...eventWords(n), ...benefitNumbers(n.discount_label).filter((x) => x !== '1+1').map((x) => x.replace('%', ''))];
      if (n.image_url || words.length >= 2) cap = await capture(src.url, n.image_url || '', words);
    }
    if (!cap) { log(`  기간 확인: ${n.brand} '${n.title}' — 공지 화면을 찾지 못함`); return null; }
    // 1) 상세 화면 글자 (한 행사짜리 화면이고, 그 행사의 혜택 숫자가 있을 때만)
    if (cap.moved && cap.text) {
      const nums = benefitNumbers(n.discount_label);
      const relevant = sameEvent(n, cap.text) || (nums.length && nums.every((x) => cap.text.replace(/,/g, '').includes(x.replace('%', ''))));
      const p = relevant ? parsePeriodText(cap.text, base) : null;
      if (p) return { ...p, source: PERIOD_SOURCE.text, quote: '' };
    }
    // 2) 공지 이미지 — AI는 기간 글자만 옮기고, 날짜는 우리 규칙으로 읽는다
    if (!llm.provider || llm.provider === 'mock') return null;
    const quote = await ask([cap.banner, ...(cap.screenshots || [])], n, { provider: llm.provider, model: llm.model, apiKey: llm.apiKey });
    const p = quote ? parsePeriodText(quote, base) : null;
    if (quote && !p) log(`  기간 확인: ${n.brand} '${n.title}' — 이미지 글자 '${quote}'에서 시작·종료일을 못 읽음`);
    return p ? { ...p, source: PERIOD_SOURCE.image, quote } : null;
  };
}
