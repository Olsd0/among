// 화면 설정. GitHub Pages 배포 워크플로가 저장소 변수(APPS_SCRIPT_URL · CONTACT_EMAIL)가 있으면 그 값으로 바꿔 넣는다.
// apiUrl: Apps Script 웹앱 주소 (비워 두면 예시 데이터 모드. 주소 뒤에 ?demo=1 을 붙여도 예시 모드).
//         바꾸면 index.html·admin.html의 보안 정책(CSP connect-src)도 함께 확인할 것.
// contactEmail: 서비스 소개·개인정보처리방침·이용약관에 보이는 문의 메일 (비우면 '준비 중' 안내).
window.AMONG_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbyF_tCoI5S-k1zZOvTbH9YNB7gaW7poFks4meja13ggJX8T29RUEZbONotyzaoiUoXQ/exec',
  contactEmail: '',
  // 직접 계약한 광고만 입력. 필드와 게재 절차는 docs/launch-readiness.md 참고.
  sponsorship: null,
  // 시험 운영. false로 바꾸면 온라인 특가 탭을 숨기고 기존 앱 쿠폰 메뉴를 복원한다.
  // 상품 데이터는 같은 출처의 공개 JSON만 사용한다. 파트너스 비밀키는 여기에 넣지 않는다.
  onlineDeals: { enabled: true, dataUrl: './online-deals.json' },
};
