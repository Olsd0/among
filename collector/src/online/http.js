// 온라인 특가 공급처 호출 규칙: 허용한 HTTPS 주소만, 요청 간격·시간 제한·응답 크기 제한,
// 일시 오류만 짧게 재시도, 429는 Retry-After를 따르고 길면 공급처를 일시 중지한다.
// 오류 문구에는 주소의 쿼리·헤더(키·서명)를 넣지 않는다.

export class RateLimitError extends Error {
  constructor(retryAfterMs) { super('rate_limited'); this.name = 'RateLimitError'; this.retryAfterMs = retryAfterMs; }
}
export class HttpError extends Error {
  constructor(status) { super(`http_${status}`); this.name = 'HttpError'; this.status = status; }
}

/** Retry-After: 초 또는 HTTP 날짜 → 밀리초 (해석할 수 없으면 null) */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

/** 로그에 남겨도 되는 오류 문구 (키·서명·쿼리 없음) */
export function safeError(err) {
  if (!err) return 'unknown_error';
  if (err instanceof RateLimitError || err instanceof HttpError) return err.message;
  const m = String(err.message || err);
  return /^(timeout|network_error|host_not_allowed|response_too_large|bad_json|not_https)$/.test(m) ? m : 'adapter_error';
}

/** 응답 글자 해석: Content-Type의 charset → 문서 앞부분의 encoding/charset 선언 → UTF-8 (국내 게시판은 EUC-KR이 많다) */
export function decodeBody(buf, contentType = '') {
  const head = buf.subarray(0, 2048).toString('latin1');
  const label = (/charset\s*=\s*["']?([\w-]+)/i.exec(contentType || '') || /<\?xml[^>]*encoding\s*=\s*["']([\w-]+)/i.exec(head)
    || /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head) || [])[1] || 'utf-8';
  try { return new TextDecoder(label.toLowerCase()).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

async function readCapped(res, maxBytes) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('response_too_large');
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('response_too_large');
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { try { await reader.cancel(); } catch { /* 무시 */ } throw new Error('response_too_large'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(c => Buffer.from(c)));
}

export function createHttpClient({
  allowedHosts = [], fetchImpl = globalThis.fetch, timeoutMs = 10000, maxBytes = 2_000_000,
  maxRetries = 2, maxRetryWaitMs = 30000, minIntervalMs = 1000,
  sleep = ms => new Promise(r => setTimeout(r, ms)), now = () => Date.now(), random = Math.random,
} = {}) {
  let last = -Infinity;
  let calls = 0;
  const backoff = attempt => Math.min(8000, 500 * 2 ** attempt) + Math.floor(random() * 250);

  async function request(url, init = {}) {
    let u;
    try { u = new URL(url); } catch { throw new Error('host_not_allowed'); }
    if (u.protocol !== 'https:') throw new Error('not_https');
    if (u.username || u.password || u.port || !allowedHosts.includes(u.hostname)) throw new Error('host_not_allowed');
    for (let attempt = 0; ; attempt++) {
      const wait = last + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      last = now();
      calls++;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        let res;
        try {
          // 다른 주소로 넘어가는 응답은 따라가지 않는다 (허용 목록 밖으로 키가 새지 않게).
          res = await fetchImpl(u.href, { ...init, redirect: 'error', signal: ctrl.signal });
        } catch (e) {
          if (attempt < maxRetries) { await sleep(backoff(attempt)); continue; }
          throw new Error(ctrl.signal.aborted || e?.name === 'AbortError' ? 'timeout' : 'network_error');
        }
        if (res.status === 429) {
          const ra = parseRetryAfter(res.headers.get('retry-after'), now());
          if (ra !== null && ra <= maxRetryWaitMs && attempt < maxRetries) { await sleep(ra); continue; }
          throw new RateLimitError(ra ?? 60 * 60 * 1000);
        }
        if (res.status >= 500 && attempt < maxRetries) { await sleep(backoff(attempt)); continue; }
        if (!res.ok) throw new HttpError(res.status);
        let text;
        try { text = decodeBody(await readCapped(res, maxBytes), res.headers.get('content-type')); } catch (e) {
          if (e.message === 'response_too_large') throw e;
          throw new Error(ctrl.signal.aborted ? 'timeout' : 'network_error');
        }
        return {
          status: res.status, text,
          json() { try { return JSON.parse(text); } catch { throw new Error('bad_json'); } },
        };
      } finally { clearTimeout(timer); }
    }
  }
  return { request, get calls() { return calls; } };
}
