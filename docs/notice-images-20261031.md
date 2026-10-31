# 핫딜 공식 이미지 대조 (2026-10-31)

공식 행사 목록과 상세 페이지에서 제목·기간·이미지를 직접 대조했다. 아래 8개 공지의 썸네일 원본을 변형 없이 web/assets/notices에 보관한다. 파일명은 원본 SHA-256 앞 12자리이며, 원래 URL과 확인일은 collector/src/notice-images.js에 보존한다. 8개 파일 합계는 600KB 미만이다.

| 공지 | 출처 | 이미지 출처 | 연결 종료일 |
| --- | --- | --- | --- |
| 반올림피자 · 반올림피자 명일방주 콜라보 | [공식 공지](https://order.banolimpizza.com/event/detail/163814c2-cc1e-4051-b35c-91ba2906ea36) | [원본 썸네일](https://cdn.banolimpizza.com/event/b6cb07152f824c0a91c40039dbb11a29.png) | 2026-11-08 |
| 스타벅스 · 딜리버스 만원 별 더블 적립 | [공식 공지](https://www.starbucks.co.kr/whats_new/campaign_view.do?pro_seq=3572) | [원본 썸네일](https://image.istarbucks.co.kr/upload/promotion/WEB_THUM_20260930081508121.jpg) | 2026-10-31 |
| 스타벅스 · Stars Full of Heart | [공식 공지](https://www.starbucks.co.kr/whats_new/campaign_view.do?pro_seq=3595) | [원본 썸네일](https://image.istarbucks.co.kr/upload/promotion/WEB_THUM_20261026082554346.jpg) | 2026-11-20 |
| 굽네치킨 · 주말 굽네 인기메뉴 4천원 할인 | [공식 공지](https://www.goobne.co.kr/brd/event/view_p?seq=89954) | [원본 썸네일](https://www.goobne.co.kr/img/board/4706932e0442492792082e970ca64759.png) | 2026-11-01 |
| 피자헛 · 피자헛 10월 평일 반값 핫딜 | [공식 공지](https://www.pizzahut.co.kr/cs/event/extra/hellopizzahut) | [원본 썸네일](https://akamai.pizzahut.co.kr/2020pizzahut-prod/public/event/c164ec37-60e8-430e-b80b-1ffac3113327.png) | 2026-10-31 |
| 배스킨라빈스 · 파인트를 10년 전 가격으로 픽업 | [공식 공지](https://www.baskinrobbins.co.kr/play/event/view.php?seq=637&category=ALL) | [원본 썸네일](https://www.baskinrobbins.co.kr/upload/promotion/event/1acda682bf0122b84b87ad886b474d8e.png) | 2026-11-03 |
| 배스킨라빈스 · 젤라또 피케 파우치 사전예약 | [공식 공지](https://www.baskinrobbins.co.kr/play/event/view.php?seq=636&category=ALL) | [원본 썸네일](https://www.baskinrobbins.co.kr/upload/promotion/event/30b00b84406b9846c86f2a9975084c25.png) | 2026-11-03 |
| 스타벅스 · 2026 쓱데이 특별전 | [공식 공지](https://www.starbucks.co.kr/whats_new/campaign_view.do?pro_seq=3578) | [원본 썸네일](https://image.istarbucks.co.kr/upload/promotion/WEB_THUM_20261029140303913.jpg) | 2026-11-08 |

- 반올림은 같은 공식 행사로 연결되는 목록 URL을 추가했다. 굽네의 4천원/4,000원 표기만 같은 금액으로 인식하도록 했다. 관련 없는 제목·브랜드·출처·다음 행사 기간에는 연결하지 않는다.
- 공지 썸네일은 전체가 보이도록 표시하고, 상세에서 긴 원본 포스터를 불러온다. 확인하지 못한 행사에는 다른 포스터를 붙이지 않고 공식 브랜드 로고만 표시한다. 긴 글자 요약 대체 카드는 제거했다.
- 빽다방 500원 공지는 목록 등록 연도가 2025년이어서 현재 API의 2026년 행사에 사진을 연결하지 않았다. 파파이스의 약 1억 5천만 픽셀 원본은 목록 자동 로딩에 추가하지 않았다.
- 쿠폰 데이터·확인 시각을 수정하거나 수집 작업을 실행하지 않았다.
