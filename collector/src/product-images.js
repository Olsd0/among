// 공식 메뉴 페이지에서 상품과 사진을 직접 확인한 목록. 행사 배너·OG 이미지는 등록하지 않는다.
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
