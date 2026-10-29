// 공식 홈페이지에서 확인한 로고 원본을 정적 파일로 함께 배포한다 (2026-10-29).
// 매일 갱신하지 않는다. 브랜드가 로고를 바꿀 때만 원본·출처를 확인하고 파일 해시를 바꾼다.
// 이미지가 없거나 실패하면 첫 글자를 표시한다. 공지·상품 이미지는 각 전용 목록을 사용한다.
const logos = new Map([
  ["공차", {"source": "https://www.gong-cha.co.kr/", "original": "https://www.gong-cha.co.kr/favicon/android-icon-192x192.png", "image": "assets/brands/gongcha-52a85e1f4f61.png"}],
  ["교촌치킨", {"source": "https://www.kyochon.com/main/", "original": "https://www.kyochon.com/images/favicon.png", "image": "assets/brands/kyochon-caa8685ef545.png"}],
  ["굽네치킨", {"source": "https://www.goobne.co.kr/main", "original": "https://www.goobne.co.kr/resources/images/favicon.png", "image": "assets/brands/goobne-5ae161034f68.png"}],
  ["네이버페이", {"source": "https://home.pay.naver.com/payservices", "original": "https://financial.pstatic.net/static/public/favicon-1.0.0.ico", "image": "assets/brands/naverpay-ad44ab7d3e5e.ico"}],
  ["던킨", {"source": "https://www.dunkindonuts.co.kr/", "original": "https://www.dunkindonuts.co.kr/images/favicon_180x180.png", "image": "assets/brands/dunkin-e42c7f3a0102.png"}],
  ["도미노피자", {"source": "https://web.dominos.co.kr/gate", "original": "https://cdn.dominos.co.kr/renewal2018/w/img/favicon.ico", "image": "assets/brands/domino-052ad1a45966.ico"}],
  ["뚜레쥬르", {"source": "https://www.tlj.co.kr/index.asp", "original": "https://www.tlj.co.kr/favicon.ico?v=4", "image": "assets/brands/tlj-a247a30c2751.ico"}],
  ["롯데리아", {"source": "https://www.lotteeatz.com/", "original": "https://img.lotteeatz.com/assets/images/main/brandlogo_lotteria.png", "image": "assets/brands/lotteria-064343505b3b.png"}],
  ["메가MGC커피", {"source": "https://www.mega-mgccoffee.com/", "original": "https://www.mega-mgccoffee.com/favicon.ico?ver=202609170830", "image": "assets/brands/mega-629afe669be3.ico"}],
  ["미스터피자", {"source": "https://www.mrpizza.co.kr/", "original": "https://www.mrpizza.co.kr/sh_img/hd/top_menu/favicon.ico", "image": "assets/brands/mrpizza-44aabd0cf84b.ico"}],
  ["반올림피자", {"source": "https://order.banolimpizza.com/event/list?eventStatus=all", "original": "https://order.banolimpizza.com/icon.svg?icon.0dg2qmliekn-t.svg", "image": "assets/brands/banolim-18aea360b9fc.svg"}],
  ["배스킨라빈스", {"source": "https://www.baskinrobbins.co.kr/", "original": "https://www.baskinrobbins.co.kr/assets/images/common/h_logo.png", "image": "assets/brands/baskinrobbins-85e486d635c7.png"}],
  ["빽다방", {"source": "https://paikdabang.com/", "original": "https://paikdabang.com/wp-content/uploads/2026/08/cropped-favicon-192x192.png", "image": "assets/brands/paik-dacf2f011745.png"}],
  ["스타벅스", {"source": "https://www.starbucks.co.kr/index.do", "original": "https://image.istarbucks.co.kr/common/img/common/favicon.ico?v=200828", "image": "assets/brands/starbucks-014210540eac.ico"}],
  ["파리바게뜨", {"source": "https://www.paris.co.kr/", "original": "https://d2afncas1tel3t.cloudfront.net/wp-content/uploads/2019/09/cropped-PB_favicon-192x192.png", "image": "assets/brands/parisbaguette-bee044b924b7.png"}],
  ["파파이스", {"source": "https://www.popeyes.co.kr/", "original": "https://popeyes.co.kr/theme/basic/images/favicon.png", "image": "assets/brands/popeyes-14bbabbf7b9f.png"}],
  ["파파존스", {"source": "https://www.pji.co.kr/", "original": "https://imgcdn4.pji.co.kr/pc/img/20220228_newFavicon.ico", "image": "assets/brands/papajohns-66d63d75cf83.ico"}],
  ["폴바셋", {"source": "https://www.baristapaulbassett.co.kr/Index.pb", "original": "https://www.baristapaulbassett.co.kr/images/common/favicon_196.png", "image": "assets/brands/paulbassett-b47d263bdef6.png"}],
  ["푸라닭", {"source": "https://www.puradakchicken.com/main/", "original": "https://www.puradakchicken.com/favicon.ico", "image": "assets/brands/puradak-7f2648c3ea0e.ico"}],
  ["피자헛", {"source": "https://www.pizzahut.co.kr/", "original": "https://www.pizzahut.co.kr/assets/web/img/common/favicon.ico", "image": "assets/brands/pizzahut-7caa6cf2dafd.ico"}],
  ["BBQ", {"source": "https://bbq.co.kr/", "original": "https://bbq.co.kr/images/symbols/logo-red.svg", "image": "assets/brands/bbq-4b8fd7b0c321.svg"}],
  ["KFC", {"source": "https://www.kfckorea.com/", "original": "https://www.kfckorea.com/assets/favicon.ico?d230bc62da40125151da1a5391159397", "image": "assets/brands/kfc-d7287e4c3af9.ico"}],
]);
export const officialBrandLogo = (brand) => logos.get(brand) || null;
