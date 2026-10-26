// robots.txt 확인 — 공개 페이지라도 사이트가 수집을 막은 경로는 가져가지 않는다 (D7)
export const BOT_NAME = 'AMONGbot';
export const AI_AGENTS = ['ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai'];

/** robots.txt 텍스트 → [{ agents: [...], rules: [{ allow, path }] }] */
export function parseRobots(txt) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const rawLine of String(txt || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      if (!cur) continue;
      lastWasAgent = false;
      if (key === 'disallow' && val === '') continue; // "Disallow:" = 전부 허용
      cur.rules.push({ allow: key === 'allow', path: val });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function patternToRegex(p) {
  const anchored = p.endsWith('$');
  const body = (anchored ? p.slice(0, -1) : p).replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

/** 가장 긴 규칙이 이기고, 길이가 같으면 Allow가 이긴다 (Google 방식) */
export function isAllowed(txt, url, ua = BOT_NAME) {
  const groups = parseRobots(txt);
  const u = new URL(url);
  const path = u.pathname + u.search;
  const name = ua.toLowerCase();
  let group = groups.find((g) => g.agents.some((a) => a !== '*' && name.includes(a)));
  if (!group) group = groups.find((g) => g.agents.includes('*'));
  if (!group) return true;
  let best = null;
  for (const r of group.rules) {
    if (!patternToRegex(r.path).test(path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

const cache = new Map();

/**
 * URL 수집 허용 여부. robots.txt가 없으면(4xx) 허용, 서버 오류·연결 실패면 보수적으로 불허.
 * @returns {Promise<{ allowed: boolean, reason: string }>}
 */
export async function robotsAllows(url, { ua = BOT_NAME, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const origin = new URL(url).origin;
  if (!cache.has(origin)) {
    cache.set(origin, (async () => {
      try {
        const res = await fetchImpl(origin + '/robots.txt', { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
        if (res.status >= 500) return { error: `robots.txt ${res.status}` };
        if (res.status >= 400) return { txt: '' };
        return { txt: await res.text() };
      } catch (e) {
        return { error: `robots.txt 확인 실패: ${e.message}` };
      }
    })());
  }
  const r = await cache.get(origin);
  if (r.error) return { allowed: false, reason: r.error };
  if (!isAllowed(r.txt, url, ua)) return { allowed: false, reason: 'robots.txt에서 차단된 경로' };
  // 수집한 내용을 Claude가 읽으므로, 사이트가 AI 수집을 거부했다면 그 뜻도 따른다
  const ai = AI_AGENTS.find((a) => !isAllowed(r.txt, url, a));
  if (ai) return { allowed: false, reason: `robots.txt에서 AI 수집 거부 (${ai})` };
  return { allowed: true, reason: 'ok' };
}

export function clearRobotsCache() { cache.clear(); }
