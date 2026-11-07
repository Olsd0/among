// 관리 토큰을 보내는 지점을 하나로 제한한다. 배포 주소는 Pages 설정 주입과 같은 형식이다.
export async function request(action, body = {}) {
  const endpoint = window.AMONG_CONFIG?.apiUrl || '';
  if (new URLSearchParams(location.search).has('demo') || !endpoint) throw new Error('예시 모드에서는 변경할 수 없어요.');
  if (window.self !== window.top || !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint)) {
    throw new Error('관리 페이지 주소와 API 배포 설정을 확인해 주세요.');
  }
  const token = document.querySelector('#token').value.trim();
  if (!token) throw new Error('관리 토큰을 입력하세요.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, action, token }), signal: ctrl.signal,
    });
    if (!response.ok) throw new Error('관리 서버에 연결할 수 없어요.');
    const result = await response.json();
    if (!result.ok) throw new Error(result.error === 'unauthorized' ? '관리 토큰이 맞지 않아요.' : result.error || '요청 실패');
    return result;
  } finally { clearTimeout(timer); }
}
