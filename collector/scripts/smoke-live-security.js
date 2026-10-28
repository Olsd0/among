// 운영 API 점검: 실제 행을 추가하지 않는 잘못된 요청만 전송한다.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const box = { window: {} };
vm.runInNewContext(readFileSync(new URL('../../web/config.js', import.meta.url), 'utf8'), box);
// Pages 배포가 저장소 변수로 주소를 덮어쓸 수 있으므로 같은 우선순위를 따른다.
const endpoint = process.env.AMONG_API_URL?.trim() || box.window.AMONG_CONFIG?.apiUrl;
if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint || '')) throw new Error('공개 API 주소를 확인하세요.');

async function request(url, options = {}) {
  const res = await fetch(url, { ...options, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`API 응답 오류: ${res.status}`);
  return res.json();
}
const post = (body) => request(endpoint, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
const expectError = (result, expected) => {
  if (result.ok !== false || result.error !== expected) throw new Error(`예상한 차단 응답 ${expected}와 다릅니다: ${JSON.stringify(result)}`);
  console.log(`차단 확인: ${expected}`);
};

// 이전 백엔드도 잘못된 type은 저장하지 않으므로, 첫 요청에서 v6 크기 제한을 확인할 수 있다.
expectError(await post({ action: 'event', type: '__invalid__', sid: 'short', padding: 'x'.repeat(5000) }), 'too large');
// 앞의 v6 확인이 성공한 후에만 브라우저 id 검사도 확인한다.
expectError(await post({ action: 'event', type: 'visit', sid: 'short' }), 'bad sid');
expectError(await post({ action: 'sources' }), 'unauthorized');
const url = new URL(endpoint); url.searchParams.set('action', 'coupons');
const data = await request(url);
if (!data.ok || !Array.isArray(data.coupons)) throw new Error('쿠폰 공개 API 응답을 확인하세요.');
console.log(`공개 쿠폰 API 정상: ${data.coupons.length}개`);
