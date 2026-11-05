// 온라인 특가 공급처 어댑터.
// 공식 문서·제휴 승인으로 호출 주소·응답 필드·호출 한도·이미지 이용 범위를 확인한 공급처만 fetch를 구현한다.
// 확인 전에는 fetch: null 로 두며 실행기는 이 공급처를 '승인 대기 (연결 안 됨)'로 기록하고 호출하지 않는다.
// 주소나 필드 이름을 추측해서 채우지 않는다. 커뮤니티 게시판 수집·로그인 영역·비공개 API는 쓰지 않는다.
//
// 어댑터가 구현할 것 (승인 후):
//   apiHosts: ['…']                     공식 문서의 API 호스트 (허용 목록 — http.js가 그 밖은 막음)
//   requiredSecrets: ['…']              GitHub Secrets 이름 (값은 env로만 받고 로그·응답에 남기지 않음)
//   minIntervalMinutes                  같은 공급처 최소 호출 간격
//   http: { minIntervalMs, timeoutMs }  공식 호출 한도에 맞춘 요청 간격
//   async fetch({ http, env, rules, now }) → { items: [표준 후보…] }
//     표준 후보 필드는 collector/src/online-deals-core.js odNormalize 참고. 문서로 확인한 값만 채우고,
//     확인할 수 없는 값은 비워 둔다 (예: 배송비를 모르면 shipping: 'unknown' — 무료로 넣지 않음).

export const ADAPTERS = {
  coupang: {
    status: 'awaiting_access',
    requiredSecrets: ['COUPANG_PARTNERS_ACCESS_KEY', 'COUPANG_PARTNERS_SECRET_KEY'],
    minIntervalMinutes: 30,
    apiHosts: [],
    // 11/05 대표가 쿠팡 파트너스 가입 (파트너스 ID AF1327603 — online-deals-core.js의 partnerId). API는 최종 승인 뒤에만 쓸 수 있다.
    needs: [
      '완료: 쿠팡 파트너스 가입 (11/05, AF1327603)',
      '활동 매체 등록: 파트너스 내 정보 → 활동하는 모든 페이지 추가하기 — AMONG 첫 화면과 온라인 특가 화면 주소',
      '최종 승인 (공식 가이드 기준 누적 판매 15만원 이상이면 자동 심사, 승인 전에도 실적은 집계) — 승인 전에는 API·정산 불가',
      'Open API 키 발급 후 GitHub Secrets에 COUPANG_PARTNERS_ACCESS_KEY · COUPANG_PARTNERS_SECRET_KEY 등록',
      '상품·골드박스 API의 호출 주소·응답 필드·호출 한도와 사진·캐시 이용 범위를 공식 문서로 확인',
    ],
    fetch: null,
  },
  linkprice: {
    status: 'awaiting_access',
    requiredSecrets: ['LINKPRICE_API_KEY'],
    minIntervalMinutes: 30,
    apiHosts: [],
    needs: [
      '링크프라이스 제휴사 가입과 사이트 등록 — 대표 승인 필요',
      '핫딜·리얼핫딜 API 이용 신청과 광고주별 제휴 승인',
      '승인 후 받은 API 문서로 호출 주소·필드·한도·제휴 링크 주소·사진 이용 범위 확인',
    ],
    fetch: null,
  },
};
