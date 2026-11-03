import { noticePhoto } from './notice-images.js?v=20261103-1';

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

// 핫딜에 행사 이미지가 없을 때 대신 쓰는 같은 브랜드의 공식 상품 사진 (2026-11-03 각 브랜드 공식 메뉴 페이지에서 확인).
// 브랜드마다 [메뉴 페이지, [[상품명, [공지 글에서 찾을 다른 이름], 사진 주소], ...]] — 첫 번째가 브랜드 대표 메뉴.
// 사진 파일은 받지 않고 공식 주소만 둔다. 화면에는 '관련 상품 이미지'·'대표 메뉴 이미지'로 표시해 행사 이미지와 구분한다.
const ph = (n) => `https://akamai.pizzahut.co.kr/2020pizzahut-prod/public/img/menu_2026/${n}_s.jpg`;
const kfc = (n) => `https://kfcapi.inicis.com/kfcs_api_img/KFCS/goods/${n}.png`;
const pji = (n) => `https://imgcdn4.pji.co.kr/pc/img/menu/detail/${n}.png`;
const mrp = (n) => `https://www.mrpizza.co.kr/data/file/menu/thumb-9fc4b1693dca29b02fae25560268e34c_${n}_283x210.png`;
const dom = (n) => `https://cdn.dominos.co.kr/admin/upload/goods/${n}.jpg`;
const sbx = (n) => `https://image.istarbucks.co.kr/upload/store/skuimg/${n}.jpg`;
const BRAND_MENUS = [
  ['피자헛', 'https://www.pizzahut.co.kr/menu/pizza', [
    ['수퍼슈프림', ['슈프림'], ph('RPPZ0008')],
    ['안창 스테이크 슈프림', ['안창'], ph('RPPZ2283')],
    ['콰트로 치즈 슈프림', ['콰트로'], ph('RPPZ2284')],
    ['한근/반근 치즈 콤비네이션', ['치즈 콤비네이션', '반근', '한근', '치즈페스타'], ph('RPPZ2244')],
    ['클래식 페페로니', ['페페로니'], ph('RPPZ1889')],
  ]],
  ['KFC', 'https://www.kfckorea.com/menu/chicken', [
    ['핫크리스피통다리 3조각', ['핫크리스피'], kfc('DL_2177538_20260731163110725')],
    ['징거', ['징거버거', '징거'], kfc('DL_1249525_20260803095034459'), 'https://www.kfckorea.com/menu/burger'],
    ['오리지널통다리 3조각', ['오리지널'], kfc('DL_2177550_20260731171750691')],
  ]],
  ['파파존스', 'https://www.pji.co.kr/menu/pizza', [
    ['수퍼 파파스', ['수퍼파파스'], pji('1000_10')],
    ['불닭 까르보 치킨', ['불닭'], pji('3241_10')],
    ['올미트', [], pji('1001_10')],
    ['페퍼로니', [], pji('1011_10')],
  ]],
  ['미스터피자', 'https://www.mrpizza.co.kr/bbs/board.php?bo_table=menu&sca=%ED%81%B4%EB%9E%98%EC%8B%9D%20%ED%94%BC%EC%9E%90', [
    ['포테이토', [], mrp('FIz3JYO6_ba7baef611c70e219a7f95de7a0aa6e7055054d3')],
    ['콤비네이션', [], mrp('OEovH5Uj_7dec9c8f5bfa7dcccffd28e4454931af7ae96b75')],
    ['불고기', [], mrp('obe0XUAn_48635ab4072ceef2f8cb0ac3a0372ec05b5d7f2d')],
    ['더블치즈', [], mrp('ucpZBe2L_d0d4da6d5f6d1fc82a5084ee2de4f99c5bb24ba8')],
  ]],
  ['배스킨라빈스', 'https://www.baskinrobbins.co.kr/menu/list.php?category=A', [
    ['엄마는 외계인', [], 'https://www.baskinrobbins.co.kr/upload/product/main/91c8668227bcf556c43a968b97e342e6.png'],
    ['민트 초콜릿 칩', ['민초'], 'https://www.baskinrobbins.co.kr/upload/product/main/fb92d70dee836652115c4f3b13175541.png'],
  ]],
  ['도미노피자', 'https://web.dominos.co.kr/goods/list?dsp_ctgr=C0101', [
    ['포테이토', [], dom('20260914_W6qO55B1')],
    ['슈퍼디럭스', [], dom('20260914_yd4LDxWV')],
    ['페퍼로니', [], dom('20200311_x8StB1t3')],
  ]],
  ['빽다방', 'https://paikdabang.com/menu/menu_coffee/', [
    // 공식 파일명이 'ICED-앗메리카노'로 되어 있다 (11/03 확인, 그대로 사용)
    ['아메리카노(ICED)', ['아메리카노'], 'https://paikdabang.com/wp-content/uploads/2018/05/ICED-%EC%95%97%EB%A9%94%EB%A6%AC%EC%B9%B4%EB%85%B8-450x588.png'],
    ['원조커피(ICED)', ['원조커피'], 'https://paikdabang.com/wp-content/uploads/2018/05/ICED-%EC%9B%90%EC%A1%B0%EC%BB%A4%ED%94%BC-450x588.png'],
  ]],
  ['파파이스', 'https://www.popeyes.co.kr/menu', [
    ['루이 통 버거 콤보', ['루이통버거', '루이 통 버거'], 'https://popeyes.co.kr/data/file/menu/3698713134_7Hhz9Nap_fb92769927520d367602d81aa27ea8df8af23458.png'],
  ]],
  ['메가MGC커피', 'https://www.mega-mgccoffee.com/menu/?menu_category1=1&menu_category2=1', [
    ['하우스밀크 라떼', ['하우스밀크라떼'], 'https://img.mega-mgccoffee.com/megahp/manager/upload/menu/20260902203101_1788348661533_weMnhAbV2Q.jpg'],
  ]],
  ['교촌치킨', 'https://www.kyochon.com/menu/chicken.asp', [
    ['허니윙콤비', ['허니'], 'https://www.kyochon.com/uploadFiles/TB_ITEM/list_Honey%20Wing%20Combo.png'],
    ['허니옥수수윙콤비', ['허니옥수수'], 'https://www.kyochon.com/uploadFiles/TB_ITEM/list_Honey%20Corn%20Wing%20Combo.png'],
    ['간장윙콤비', ['간장'], 'https://www.kyochon.com/uploadFiles/TB_ITEM/list_Soy-Sauce-Wing-Combo.png'],
    ['레드윙콤비', [], 'https://www.kyochon.com/uploadFiles/TB_ITEM/list_Red-Wing-Combo.png'],
  ]],
  ['던킨', 'https://www.dunkindonuts.co.kr/menu?cat=1', [
    ['페이머스 글레이즈드', ['글레이즈드'], 'https://www.dunkindonuts.co.kr/storage/product/mainimgfile/P3tLi275D0A00m8A7O2HSEuLeTVGMZy0aUfySsQA.png'],
  ]],
  ['뚜레쥬르', 'https://www.tlj.co.kr/product/list.asp?ref=2', [
    ['골든 버터 식빵', [], 'https://www.tlj.co.kr/data/product/2026-10-16_event(17).jpg'],
  ]],
  ['굽네치킨', 'https://www.goobne.co.kr/menu/menu_list_p', [
    ['고추 바사삭', ['고추바사삭'], 'https://cdn.goob-ne.com/goobne/img/menu/8d745f0d89254c04b8f6fe866f08ce62.png'],
    ['볼케이노', [], 'https://cdn.goob-ne.com/goobne/img/menu/d8b55851f62c4304bc434c9d34754868.png'],
    ['갈비천왕', [], 'https://cdn.goob-ne.com/goobne/img/menu/1f1158c41c1e4940b24539e08920d23d.png'],
  ]],
  ['버거킹', 'https://www.burgerking.co.kr/menu/main', [
    ['와퍼', [], 'https://mob-prd.burgerking.co.kr/images/menu/web/main/2025/01/06/c9811022-3678-4988-9fa4-1d3fc6a69bf5.png'],
  ]],
  ['이디야', 'https://www.ediya.com/contents/drink.html', [
    ['오트 커피', ['오트커피'], 'https://www.ediya.com/files/menu/IMG_1790124499317.png'],
  ]],
  // 11/03 오후: 아래 3곳은 GitHub 실행기(mode=images, only=menu=…)로 공식 메뉴 페이지의 상품명·사진을 대조해 등록
  ['푸라닭', 'https://www.puradakchicken.com/menu/product.asp', [
    ['고추마요 치킨', ['고추마요'], 'https://www.puradakchicken.com/upload/menu/[400-400]-%EA%B3%A0%EC%B6%94%EB%A7%88%EC%9A%94_%EB%BC%880.png'],
    ['씬 후라이드 쿼터레그 (4조각)', ['쿼터레그'], 'https://www.puradakchicken.com/upload/menu/[400-400]%EC%94%AC%ED%9B%84%EB%9D%BC%EC%9D%B4%EB%93%9C_%EC%BF%BC%ED%84%B0%EB%A0%88%EA%B7%B8.png'],
    ['마마치', [], 'https://www.puradakchicken.com/upload/menu/[400-400]_%EB%A7%88%EB%A7%88%EC%B9%98_%EB%BC%88.png'],
    ['홍고추마요', [], 'https://www.puradakchicken.com/upload/menu/[400_400]%ED%99%8D%EA%B3%A0%EC%B6%94%EB%A7%88%EC%9A%94_%EB%BC%88.png'],
  ]],
  ['커피빈', 'https://www.coffeebeankorea.com/menu/list.asp', [
    ['아이스 커피빈카노', ['커피빈카노', '아메리카노'], 'https://www.coffeebeankorea.com/data/menu/[%ED%99%88%ED%8E%98%EC%9D%B4%EC%A7%80]%EC%BB%A4%ED%94%BC%EB%B9%88%EC%B9%B4%EB%85%B83%EA%B8%B0_%EC%95%84%EC%9D%B4%EC%8A%A4%EC%95%84%EB%A9%94%EB%A6%AC%EC%B9%B4%EB%85%B8_1.jpg'],
    ['아이스 커피빈라떼', ['커피빈라떼', '라떼'], 'https://www.coffeebeankorea.com/data/menu/[%ED%99%88%ED%8E%98%EC%9D%B4%EC%A7%80]%EC%BB%A4%ED%94%BC%EB%B9%88%EC%B9%B4%EB%85%B83%EA%B8%B0_%EC%95%84%EC%9D%B4%EC%8A%A4%EB%9D%BC%EB%96%BC_1.jpg'],
  ]],
  ['설빙', 'https://sulbing.com/menu/', [
    ['인절미설빙', ['인절미'], 'https://sulbing.com/new/data/product/regular_01.png'],
    ['애플망고치즈설빙', ['애플망고', '망고'], 'https://sulbing.com/new/data/product/product_small_jzobvkm.png'],
    ['딥초코브라우니설빙', ['딥초코', '브라우니'], 'https://sulbing.com/new/data/product/product_small_afancmq.png'],
  ]],
  ['스타벅스', 'https://www.starbucks.co.kr/menu/drink_list.do', [
    ['콜드 브루', ['콜드브루'], sbx('2025/06/[9200000000038]_20250626095744182')],
    ['자바 칩 프라푸치노', ['프라푸치노'], sbx('2025/06/[168016]_20250626113600873')],
  ]],
];
/** 점검용: 등록된 브랜드 메뉴 사진 전체 [{brand, name, url, source}] */
export const brandMenuPhotos = () => BRAND_MENUS.flatMap(([brand, source, items]) => items.map(([name, , url, page]) => ({ brand, name, url: new URL(url).href, source: page || source })));
const menus = new Map(BRAND_MENUS.map(([brand, source, items]) => [key(brand), items.map(([name, aliases, url, page]) =>
  Object.freeze({ name, names: [name, ...aliases].map(key).filter((x) => x.length >= 2), url: new URL(url).href, source: new URL(page || source).href, checked: '2026-11-03' }))]));

/**
 * 핫딜·공지에 공식 행사 이미지가 없을 때 같은 브랜드의 관련 상품 사진.
 * 1) 연결된 쿠폰의 정확한 상품 사진·같은 행사 포스터 → 2) 글(제목·요약·메뉴)에 이름이 나온 공식 메뉴 사진 → 3) 브랜드 대표 메뉴
 * 다른 브랜드 사진이나 예시 사진은 쓰지 않는다. 없으면 null (화면은 브랜드 로고).
 */
export function brandPhoto(brand = '', text = '', related = [], today) {
  for (const c of related) {
    const p = couponPhoto(c, today);
    if (p && p.kind === 'product') return { ...p, label: '관련 상품 이미지' };
    if (p && p.kind === 'campaign') return p;
  }
  const t = key(text);
  const list = menus.get(key(brand)) || [];
  let best = null, bestLen = 0;
  for (const m of list) for (const n of m.names) if (n.length > bestLen && t.includes(n)) { best = m; bestLen = n.length; }
  if (!best) for (const [k, p] of photos) if (k.startsWith(`${key(brand)}:`) && t.includes(k.slice(key(brand).length + 1))) { best = p; break; }
  if (best) return { url: best.url, source: best.source, name: best.name, kind: 'related', label: '관련 상품 이미지', detailUrl: best.url };
  const rep = representatives.get(key(brand)) || list[0];
  return rep ? { url: rep.url, source: rep.source, name: rep.name, kind: 'representative', label: '대표 메뉴 이미지', detailUrl: rep.url } : null;
}
