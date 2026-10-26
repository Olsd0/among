// 구글시트(Apps Script 웹앱) 클라이언트 — 수집기 → 시트
// Apps Script는 POST 응답을 302로 넘기므로 fetch의 redirect: 'follow'에 맡긴다.
export class SheetClient {
  constructor(url, token, { fetchImpl = fetch } = {}) {
    if (!url) throw new Error('APPS_SCRIPT_URL이 없습니다');
    this.url = url;
    this.token = token;
    this.fetch = fetchImpl;
  }

  async post(action, payload = {}) {
    const res = await this.fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: this.token, ...payload }),
      redirect: 'follow',
      signal: AbortSignal.timeout(120000),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`시트 응답이 JSON이 아님 (${res.status}): ${text.slice(0, 200)}`); }
    if (!json.ok) throw new Error(`시트 ${action} 실패: ${json.error || JSON.stringify(json)}`);
    return json;
  }

  // 공개 조회용 (토큰은 URL에 싣지 않는다 — 토큰이 필요한 요청은 post 사용)
  async get(action, params = {}) {
    const u = new URL(this.url);
    u.searchParams.set('action', action);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const res = await this.fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
    const json = JSON.parse(await res.text());
    if (!json.ok) throw new Error(`시트 ${action} 실패: ${json.error}`);
    return json;
  }
}
