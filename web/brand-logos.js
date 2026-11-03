// 공식 홈페이지에서 확인한 로고 (2026-10-29). 파일로 저장하지 않고 공식 주소를 그대로 불러온다 (2026-11-03).
// 매일 갱신하지 않는다. 브랜드가 로고를 바꿔 주소가 사라지면 출처를 다시 확인해 주소만 바꾼다.
// 이미지가 없거나 실패하면 첫 글자를 표시한다. 공지·상품 이미지는 각 전용 목록을 사용한다.
const logos = new Map([
  ["공차", {"source": "https://www.gong-cha.co.kr/", "image": "https://www.gong-cha.co.kr/favicon/android-icon-192x192.png"}],
  ["교촌치킨", {"source": "https://www.kyochon.com/main/", "image": "https://www.kyochon.com/images/favicon.png"}],
  ["굽네치킨", {"source": "https://www.goobne.co.kr/main", "image": "https://www.goobne.co.kr/resources/images/favicon.png"}],
  ["네이버페이", {"source": "https://home.pay.naver.com/payservices", "image": "https://financial.pstatic.net/static/public/favicon-1.0.0.ico"}],
  ["던킨", {"source": "https://www.dunkindonuts.co.kr/", "image": "https://www.dunkindonuts.co.kr/images/favicon_180x180.png"}],
  ["도미노피자", {"source": "https://web.dominos.co.kr/gate", "image": "https://cdn.dominos.co.kr/renewal2018/w/img/favicon.ico"}],
  ["뚜레쥬르", {"source": "https://www.tlj.co.kr/index.asp", "image": "https://www.tlj.co.kr/favicon.ico?v=4"}],
  ["롯데리아", {"source": "https://www.lotteeatz.com/", "image": "https://img.lotteeatz.com/assets/images/main/brandlogo_lotteria.png"}],
  ["메가MGC커피", {"source": "https://www.mega-mgccoffee.com/", "image": "https://www.mega-mgccoffee.com/favicon.ico?ver=202609170830"}],
  ["미스터피자", {"source": "https://www.mrpizza.co.kr/", "image": "https://www.mrpizza.co.kr/sh_img/hd/top_menu/favicon.ico"}],
  ["반올림피자", {"source": "https://order.banolimpizza.com/event/list?eventStatus=all", "image": "https://order.banolimpizza.com/icon.svg?icon.0dg2qmliekn-t.svg"}],
  ["배스킨라빈스", {"source": "https://www.baskinrobbins.co.kr/", "image": "https://www.baskinrobbins.co.kr/assets/images/common/h_logo.png"}],
  ["빽다방", {"source": "https://paikdabang.com/", "image": "https://paikdabang.com/wp-content/uploads/2026/08/cropped-favicon-192x192.png"}],
  ["스타벅스", {"source": "https://www.starbucks.co.kr/index.do", "image": "https://image.istarbucks.co.kr/common/img/common/favicon.ico?v=200828"}],
  ["파리바게뜨", {"source": "https://www.paris.co.kr/", "image": "https://d2afncas1tel3t.cloudfront.net/wp-content/uploads/2019/09/cropped-PB_favicon-192x192.png"}],
  ["파파이스", {"source": "https://www.popeyes.co.kr/", "image": "https://popeyes.co.kr/theme/basic/images/favicon.png"}],
  ["파파존스", {"source": "https://www.pji.co.kr/", "image": "https://imgcdn4.pji.co.kr/pc/img/20220228_newFavicon.ico"}],
  ["폴바셋", {"source": "https://www.baristapaulbassett.co.kr/Index.pb", "image": "https://www.baristapaulbassett.co.kr/images/common/favicon_196.png"}],
  ["푸라닭", {"source": "https://www.puradakchicken.com/main/", "image": "https://www.puradakchicken.com/favicon.ico"}],
  ["피자헛", {"source": "https://www.pizzahut.co.kr/", "image": "https://www.pizzahut.co.kr/assets/web/img/common/favicon.ico"}],
  ["BBQ", {"source": "https://bbq.co.kr/", "image": "https://bbq.co.kr/images/symbols/logo-red.svg"}],
  ["KFC", {"source": "https://www.kfckorea.com/", "image": "https://www.kfckorea.com/assets/favicon.ico?d230bc62da40125151da1a5391159397"}],
]);
export const officialBrandLogo = (brand) => logos.get(brand) || null;
