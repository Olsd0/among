import { noticePhoto } from './notice-images.js?v=20261031-3';

// 공식 메뉴 페이지에서 상품과 사진을 직접 확인한 목록.
// 추가할 때 브랜드, 상품명, 크기/수량, 사진, 출처를 함께 확인하고 npm run sync-web을 실행한다.
const mcdSource = 'https://www.mcdonalds.co.kr/kor/menu/happy-snack?ca=15';
const mcdImage = (path) => `https://www.mcdonalds.co.kr/upload/${path}`;
const pbImage = (path) => `https://d2afncas1tel3t.cloudfront.net/wp-content/uploads/${path}`;
const pbSource = (slug) => `https://www.paris.co.kr/product/${slug}/`;
const entries = [
  ['맥도날드', ['애플 파이'], mcdImage('2026/09/Corp_PC_View_772x530_26_해피스낵4Q_애플파이.png'), mcdSource],
  ['맥도날드', ['치킨 모짜렐라 스낵랩'], mcdImage('2026/09/Corp_PC_View_772x530_26_해피스낵4Q_치킨모짜스낵랩.png'), mcdSource],
  ['맥도날드', ['불고기 버거'], mcdImage('2026/08/Corp_PC_View_불고기버거_772x530_26해피스낵2Q_ver2_1.png'), mcdSource],
  ['맥도날드', ['아이스 드립 커피 M', '아이스 드립 커피 Medium'], mcdImage('2026/05/Corp_PC_View_772x530_26_해피스낵Q2_아이스드립_M.png'), mcdSource],
  ['맥도날드', ['아이스 드립 커피 L', '아이스 드립 커피 Large'], mcdImage('2026/05/Corp_PC_View_772x530_26_해피스낵Q2_아이스드립L.png'), mcdSource],
  ['맥도날드', ['맥너겟 4조각'], mcdImage('2026/09/Corp_PC_View_772x530_26_해피스낵4Q_맥너겟.png'), mcdSource],
  ['맥도날드', ['스프라이트 제로 M', '스프라이트 제로 Medium'], mcdImage('2026/09/Corp_PC_View_772x530_26_해피스낵4Q_스프라이트_제로.png'), mcdSource],
  ['파리바게뜨', ['실키롤케익'], pbImage('2026/08/실키롤케익_리뉴얼.png'), pbSource('new-에쉬레-버터로-풍미를-더한-실키롤케익')],
  ['파리바게뜨', ['명가명품 우리벌꿀 카스테라'], pbImage('2025/02/명가명품-우리벌꿀-카스테라-썸넬1.jpg'), pbSource('new-명가명품-우리벌꿀-카스테라')],
];

// 공백·상표 기호·괄호만 정리한다. 크기, 수량, 세트 등의 상품 차이는 지우지 않는다.
const key = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s®™()]/g, '');
const photos = new Map();
for (const [brand, names, image, source] of entries) {
  const photo = Object.freeze({ url: new URL(image).href, source: new URL(source).href, name: names[0], checked: '2026-10-28' });
  for (const name of names) photos.set(`${key(brand)}:${key(name)}`, photo);
}

/** 입력 image_url은 신뢰하지 않는다. 같은 브랜드·정확한 상품만 연결하며 세트에 단품 사진을 쓰지 않는다. */
export function productPhoto(item = {}) {
  if (item.item_type === '세트') return null;
  return photos.get(`${key(item.brand)}:${key(item.menu)}`) || null;
}

export function productImage(item = {}) { return productPhoto(item)?.url || ''; }

// 제휴·복수 메뉴 쿠폰은 같은 행사의 공식 포스터를 사용할 수 있다.
// 목록 페이지에서 다른 행사의 이미지를 빌리지 않도록 상세 URL과 메뉴를 함께 대조한다.
const campaigns = [
  ['반올림피자', /^(제휴메뉴|.*명일방주.*)$/, '반올림피자 명일방주 콜라보', 'https://order.banolimpizza.com/event/detail/163814c2-cc1e-4051-b35c-91ba2906ea36'],
  ['배스킨라빈스', /^젤라또피케파우치$/, '젤라또 피케 파우치 사전예약', 'https://www.baskinrobbins.co.kr/play/event/view.php?seq=636&category=ALL'],
  ['배스킨라빈스', /^파인트$/, '파인트를 10년 전 가격으로 픽업', 'https://www.baskinrobbins.co.kr/play/event/view.php?seq=637&category=ALL'],
  ['피자헛', /클리커/, '피자헛 클리커', 'https://www.pizzahut.co.kr/cs/event/829'],
  ['파파존스', /^파파아메리칸콤보$/, '파파 아메리칸 콤보', 'https://www.pji.co.kr/event/ongoing/9629'],
  ['KFC', /^닭껍질튀김/, '닭껍질튀김', 'https://www.kfckorea.com/promotion/promotionList/detail/1129'],
];
const sourceKey = (value) => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    url.hash = ''; url.searchParams.delete('eventStatus'); url.searchParams.sort();
    if (url.hostname === 'www.baskinrobbins.co.kr') url.pathname = url.pathname.replace(/^\/m\//, '/');
    return url.href;
  } catch { return ''; }
};

// 공식 브랜드/메뉴 페이지에서 확인한 대표 사진. 특정 상품의 사진과 구분해 표시한다.
const representatives = new Map([
  [
    "쉐이크쉑",
    {
      "url": "assets/products/shack-square-1de5f7d5cbb5.webp",
      "source": "https://www.sangmidang.co.kr/brand/eat_detail?idx=38",
      "originalImage": "https://www.sangmidang.co.kr/files/brand/eng/2024/06/aef71c88-32b1-44a3-b0f5-55351f3d31a5.webp",
      "name": "쉐이크쉑 버거 모음",
      "checked": "2026-10-31"
    }
  ],
  [
    "반올림피자",
    {
      "url": "assets/products/banolim-poten-459e68f53070.png",
      "source": "https://order.banolimpizza.com/",
      "originalImage": "https://cdn.banolimpizza.com/menu/c2ad1ae4c9eb4983890c6ed01941cc7d.png",
      "name": "포텐 피자",
      "checked": "2026-10-31"
    }
  ],
  [
    "폴바셋",
    {
      "url": "assets/products/paul-latte-d031fa25fdda.jpg",
      "source": "https://www.baristapaulbassett.co.kr/menu/List.pb",
      "originalImage": "https://www.baristapaulbassett.co.kr/upload/product/A/thumbnail_1_201903211053056601.jpg",
      "name": "카페라떼",
      "checked": "2026-10-31"
    }
  ],
  [
    "공차",
    {
      "url": "assets/products/gongcha-milktea-ec7c3750c021.png",
      "source": "https://www.gong-cha.co.kr/brand/menu/product_detail?category=001001&no=1088",
      "originalImage": "https://www.gong-cha.co.kr/upload/product/f0c489ef0aede692199824a303286f34.png",
      "name": "브라운슈가 시그니처 우롱 밀크티 + 펄",
      "checked": "2026-10-31"
    }
  ]
].map(([brand, photo]) => [key(brand), Object.freeze(photo)]));
for (const [brand, menu] of [['맥도날드', '불고기 버거'], ['파리바게뜨', '실키롤케익']]) {
  representatives.set(key(brand), productPhoto({ brand, menu }));
}

const broadMenu = (menu) => /^(?:전|전체|모든)(?:메뉴|상품|제품|피자|버거)/.test(menu)
  || /^(?:피자|치킨|버거|햄버거|커피|음료|디저트|다수메뉴|여러메뉴)$/.test(menu)
  || /\d+종|다수|여러|(?<!\d),(?!\d)|·/.test(menu);

/** 쿠폰 표시용: 정확한 상품 → 같은 행사 포스터 → 전 메뉴/복수 메뉴의 브랜드 대표 사진. */
export function couponPhoto(item = {}, today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)) {
  const exact = productPhoto(item);
  if (exact) return { ...exact, kind: 'product', label: '', detailUrl: exact.url };
  const menu = key(item.menu);
  const sources = String(item.source_url || '').split(/\s+/).map(sourceKey).filter(Boolean);
  for (const [brand, menus, title, source] of campaigns) {
    if (key(item.brand) !== key(brand) || !menus.test(menu) || !sources.includes(sourceKey(source))) continue;
    const photo = noticePhoto({ brand, title, source_url: source, end_date: item.end_date }, today);
    if (photo?.image) return { url: photo.image, detailUrl: photo.detailImage || photo.image, source: photo.source,
      name: title, kind: 'campaign', label: '공식 행사 이미지', checked: photo.verifiedAt };
  }
  const photo = item.item_type !== '세트' && broadMenu(menu) ? representatives.get(key(item.brand)) : null;
  return photo ? { ...photo, detailUrl: photo.url, kind: 'representative', label: '대표 메뉴 이미지' } : null;
}
export const couponImage = (item, today) => couponPhoto(item, today)?.url || '';
