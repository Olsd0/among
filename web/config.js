// 화면 설정. GitHub Pages 배포 워크플로가 저장소 변수(APPS_SCRIPT_URL · CONTACT_EMAIL)가 있으면 그 값으로 바꿔 넣는다.
// apiUrl: Apps Script 웹앱 주소 (비워 두면 예시 데이터 모드. 주소 뒤에 ?demo=1 을 붙여도 예시 모드).
//         바꾸면 index.html·admin.html의 보안 정책(CSP connect-src)도 함께 확인할 것.
// contactEmail: 서비스 소개·개인정보처리방침·이용약관에 보이는 문의 메일 (비우면 '준비 중' 안내).
window.AMONG_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbyF_tCoI5S-k1zZOvTbH9YNB7gaW7poFks4meja13ggJX8T29RUEZbONotyzaoiUoXQ/exec',
  contactEmail: 'hello@amongpick.com', // 11/09 대표가 Cloudflare 이메일 라우팅으로 만든 주소 (받은 메일은 대표 Gmail로 전달)
  // 직접 계약한 광고만 입력. 필드와 게재 절차는 docs/launch-readiness.md 참고.
  sponsorship: null,
  // 시험 운영. false로 바꾸면 온라인 특가 탭을 숨기고 기존 앱 쿠폰 메뉴를 복원한다.
  // 상품은 Apps Script(apiUrl ?action=online_deals)가 검증을 통과한 것만 내려 준다. dataUrl은 예시 모드용 빈 목록.
  // 공급처 키·제휴 비밀값은 여기에 넣지 않는다 (GitHub Secrets에만).
  // goldboxUrl: 쿠팡 파트너스(AF1327603) '간편 링크'로 골드박스 주소(https://www.coupang.com/np/goldbox)를 바꾼 링크 (11/05 대표 생성).
  //             제휴 링크가 있으면 화면 맨 위에 파트너스 고지 문구가 보인다. 비우면 일반 링크(고지 없음).
  // shortcutLinks: '자취 필수품, 항목별로' 바로가기의 제휴 링크. 키는 water·ramen·rice·frozen·retort·chicken·protein·canned (11/06 먹거리만).
  //             값이 없으면 쿠팡 일반 검색 링크(수수료 없음). 다른 파트너스 ID가 붙은 링크는 화면이 거절한다.
  // foodBest: 쿠팡 파트너스 다이나믹 배너(카테고리 베스트 · 식품, 배너 ID 1048515)를 온라인 특가 맨 위에. 쿠팡 코드는 coupang-widget.html 안에만 있다.
  //           from(한국 날짜)부터 보인다 — 개인정보처리방침 11/09 공고(시행 11/16)의 '시행 7일 전 공지' 기준.
  onlineDeals: { enabled: true, dataUrl: './online-deals.json', goldboxUrl: 'https://link.coupang.com/a/ip9MqvCNie', shortcutLinks: {}, foodBest: { page: 'coupang-widget.html', from: '2026-11-16' } },
};
