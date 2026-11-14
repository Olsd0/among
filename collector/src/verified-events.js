// Official event details reviewed on 2026-11-14. This is a reviewed supplement,
// not a daily verification: checked_at must never be replaced by the render time.
// Both collector and browser use this module; keep it free of Node-only APIs.
const CHECKED_AT = '2026-11-14T05:43:27.719Z';

export const verifiedEvents = [
  {
    id: 'hans_npay_20261112', brand: 'HANS', category: '디저트',
    start_date: '2026-11-12', end_date: '2026-11-18', programs: ['네이버페이'],
    source_url: 'https://pay.naver.com/benefit/payment/detail/24278798653708',
    checked_at: CHECKED_AT,
    evidence: '2026년 11월 12일부터 18일까지, 포인트·머니로 1만원 이상 결제하면 50% 적립. 기간 중 참여 횟수 제한 없이 1인 합계 5만원 한도.',
    coupon: {
      menu: 'Npay 포인트·머니 결제 50% 적립', item_type: '기타',
      discount_type: 'point_back', discount_unit: 'percent', discount_value: 50,
      discount_rate: 50, min_order: 10000, max_discount: 50000,
      channels: ['매장'],
      conditions: 'Npay 포인트·머니로 10000원 이상 결제 시 50% 포인트 적립. 행사 기간 중 횟수 제한 없이 1인 합계 50000P까지 적립됩니다. 결제 즉시 가격이 할인되는 행사가 아닙니다.',
      program_note: '기간 전체 1인 50000P 한도',
      how_to_use: '참여 매장에서 Npay 포인트·머니로 결제하고 공식 행사 조건을 확인하세요.',
    },
    news: {
      image_url: './event-images/hans-ganache-official.webp',
      image_kind: 'official_related',
      image_source_url: 'http://www.hanscake.co.kr/front/taste/cake/cake_view.php?category=C&no=13&page=1',
      image_fit: 'contain',
      image_checked_at: '2026-11-14',
      title: 'HANS 네이버페이 50% 포인트 적립', discount_label: '50% 적립',
      summary: '11월 12~18일, Npay 포인트·머니로 10000원 이상 결제하면 50% 포인트 적립. 기간 내 횟수 제한 없이 1인 합계 50000P 한도입니다. 즉시 가격할인과 구분해 주세요.',
    },
  },
  {
    id: 'gapyeong_npay_20261106', brand: '가평휴게소', category: '기타',
    start_date: '2026-11-06', end_date: '2026-12-06', programs: ['네이버페이'],
    source_url: 'https://pay.naver.com/benefit/payment/detail/24278798653677',
    checked_at: CHECKED_AT,
    evidence: '2026년 11월 6일~12월 6일, 가평휴게소 Npay 포인트·머니 1만원 이상 결제에 50% 적립. 기간 중 1인 5만원 한도. 일부 브랜드와 편의점 담배 제외.',
    coupon: {
      menu: 'Npay 포인트·머니 결제 50% 적립', item_type: '기타',
      discount_type: 'point_back', discount_unit: 'percent', discount_value: 50,
      discount_rate: 50, min_order: 10000, max_discount: 50000,
      channels: ['매장'],
      conditions: '가평휴게소 참여 매장에서 Npay 포인트·머니로 10000원 이상 결제 시 50% 포인트 적립. 행사 기간 중 1인 합계 50000P 한도이며, 일부 브랜드 매장과 편의점 담배 결제는 제외됩니다.',
      program_note: '기간 전체 1인 50000P 한도 · 일부 매장 제외',
      how_to_use: '가평휴게소에서 행사 참여 매장을 확인하고 Npay 포인트·머니로 결제하세요.',
    },
    news: {
      image_url: './event-images/gapyeong-rest-area-official.webp',
      image_kind: 'official_related',
      image_source_url: 'http://www.schighway.co.kr/homepage/highway/rest_info.do',
      image_checked_at: '2026-11-14',
      title: '가평휴게소 네이버페이 50% 적립', discount_label: '50% 적립',
      summary: '11월 6일~12월 6일, Npay 포인트·머니로 10000원 이상 결제하면 50% 포인트 적립. 기간 중 1인 합계 50000P 한도이며 일부 브랜드 매장·편의점 담배는 제외됩니다.',
    },
  },
  {
    id: 'dunkin_npay_dubai_20261109', brand: '던킨', category: '디저트',
    alias_ids: ['c_31c221ddd656'], alias_first_seen_from: '2026-11-09',
    start_date: '2026-11-09', end_date: '2026-11-30', programs: ['네이버페이'],
    source_url: 'https://www.dunkindonuts.co.kr/index.php/event/view?id=5464',
    checked_at: CHECKED_AT,
    menu_aliases: ['두바이시리즈 도넛 4종', '두바이st 시리즈 도넛 4종'],
    evidence: '11월 9~30일 두바이st 4종을 Npay 포인트·머니·카드 QR로 구매하면 50% 할인. 기간 중 구매 횟수와 1회 수량 제한 없음. 분할결제 제외.',
    coupon: {
      menu: '두바이st 시리즈 도넛 4종', item_type: '단품',
      discount_type: 'percent', discount_value: 50, discount_rate: 50,
      channels: ['매장'],
      conditions: '두바이 스타일 초콜릿 도넛·두바이st 쫀득 먼치킨·라즈베리 피스타치오·피스타치오 크림 카스텔라 대상. Npay 포인트·머니·카드 QR 현장결제 시 50% 할인, 횟수·수량 제한 없음. 삼성페이·제로페이·라인페이·분할결제 제외. 매장별 취급 상품과 행사 참여 여부가 다릅니다. 결제금액의 해피포인트 0.1% 적립 가능(굿즈 제외).',
      program_note: '지정 도넛 4종 · Npay QR 결제',
      how_to_use: 'Npay 앱의 결제 > QR을 선택해 참여 매장에서 대상 도넛을 결제하세요.',
    },
    news: {
      title: '던킨 두바이st 4종 네이버페이 50% 할인', discount_label: '50% 할인',
      summary: '11월 9~30일, 지정 두바이st 도넛 4종을 Npay 포인트·머니·카드 QR로 결제하면 50% 할인됩니다. 구매 횟수·개수 제한은 없으며 분할결제 및 일부 결제방식은 제외됩니다.',
      image_url: 'https://www.dunkindonuts.co.kr/storage/editor/ZKO41rckExIQHctvcT0omxZnMfi0WrDhVQUpB5Kt.png',
    },
  },
  {
    id: 'dunkin_npay_dday_20261114', brand: '던킨', category: '디저트',
    alias_ids: ['c_eccb75649d41'], alias_first_seen_from: '2026-11-14',
    start_date: null, end_date: '2026-11-14', programs: ['네이버페이'],
    source_url: 'https://pay.naver.com/benefit/payment/list?firstCategory=DOMESTIC_INSTORE&secondCategory=FNB',
    checked_at: CHECKED_AT,
    evidence: '2026년 11월 14일 Npay 공식 현장결제 목록에서 던킨 QR 1.2만원 결제 시 4800원 할인, 오늘 종료를 확인.',
    coupon: {
      menu: '전 메뉴', item_type: '기타', discount_type: 'amount', discount_value: 4800,
      min_order: 12000, channels: ['매장'],
      conditions: 'Npay QR로 12000원 결제 시 4800원 할인. 11월 14일 종료이며 참여 매장·한도·중복 적용은 공식 행사 상세를 확인하세요.',
      program_note: '11월 14일 종료 · Npay QR 결제',
      how_to_use: 'Npay QR로 결제하고 결제 전 공식 행사 상세 조건을 확인하세요.',
    },
    news: {
      image_url: "./event-images/dunkin-npay-dday-20261114.webp",
      image_fit: 'contain',
      image_kind: "official_poster",
      image_source_url: "https://www.dunkindonuts.co.kr/event/view?id=5470",
      image_checked_at: "2026-11-14",
      title: '던킨 네이버페이 QR 4800원 할인', discount_label: '4800원 할인',
      summary: '11월 14일 종료. 던킨에서 Npay QR로 12000원 결제 시 4800원 할인됩니다. 참여 매장·한도·중복 적용은 공식 행사 상세를 확인하세요.',
    },
  },
  {
    id: 'sulbing_npay_20261115', brand: '설빙', category: '디저트',
    alias_ids: ['c_bb9ba7a3fbed'], alias_first_seen_from: '2026-11-12',
    start_date: '2026-11-12', end_date: '2026-11-15', programs: ['네이버페이'],
    source_url: 'https://pay.naver.com/benefit/payment/list?firstCategory=DOMESTIC_INSTORE&secondCategory=FNB',
    checked_at: CHECKED_AT,
    evidence: '2026년 11월 14일 Npay 공식 현장결제 목록에서 설빙 포인트·머니 9900원 이상 결제 시 50% 적립, D-1을 확인. 설빙 공식 홈페이지에 연결된 공식 Instagram 포스터에서 11/12~15, 기간 내 1인 최대 30000P를 추가 확인.',
    coupon: {
      menu: '전 메뉴', item_type: '기타', discount_type: 'point_back',
      discount_unit: 'percent', discount_value: 50, discount_rate: 50,
      min_order: 9900, max_discount: 30000, channels: ['매장'],
      conditions: 'Npay 포인트·머니로 9900원 이상 결제 시 50% 포인트 적립. 11월 12~15일, 기간 내 1인 최대 30000P 적립. 즉시 가격할인이 아니며 참여 매장·중복 적용은 공식 행사 상세를 확인하세요.',
      program_note: '기간 내 1인 최대 30000P',
      how_to_use: 'Npay 포인트·머니로 결제하고 공식 행사 상세에서 적립 조건을 확인하세요.',
    },
    news: {
      image_url: './event-images/sulbing-npay-202611-poster.webp',
      image_kind: 'official_poster',
      image_fit: 'contain',
      image_source_url: 'https://www.instagram.com/p/Dfgh7PznQ9z/',
      image_checked_at: '2026-11-14',
      title: '설빙 네이버페이 50% 포인트 적립', discount_label: '50% 적립',
      summary: '11월 12~15일 Npay 포인트·머니로 9900원 이상 결제 시 50% 포인트 적립. 기간 내 1인 최대 30000P. 즉시 가격할인이 아니며 참여 매장·중복 적용은 공식 상세를 확인하세요.',
    },
  },
  {
    id: 'shakeshack_npay_20261115', brand: '쉐이크쉑', category: '햄버거',
    alias_ids: ['c_c77cd99672b1'], alias_first_seen_from: '2026-11-12',
    start_date: null, end_date: '2026-11-15', programs: ['네이버페이'],
    source_url: 'https://pay.naver.com/benefit/payment/list?firstCategory=DOMESTIC_INSTORE&secondCategory=FNB',
    checked_at: CHECKED_AT,
    evidence: '2026년 11월 14일 Npay 공식 현장결제 목록에서 쉐이크쉑 Npay QR 결제 시 30% 할인, D-1을 확인.',
    coupon: {
      menu: '전 메뉴', item_type: '기타', discount_type: 'percent', discount_value: 30,
      discount_rate: 30, channels: ['매장'],
      conditions: '쉐이크쉑 Npay QR 결제 시 30% 할인. 11월 15일 종료. 참여 매장·대상 상품·한도·중복 적용은 공식 행사 상세를 확인하세요.',
      program_note: '11월 15일 종료 · Npay QR 결제',
      how_to_use: 'Npay QR로 결제하고 결제 전 공식 행사 상세 조건을 확인하세요.',
    },
    news: {
      image_url: './event-images/shakeshack-burgers-official.webp',
      image_kind: 'official_related',
      image_source_url: 'https://www.sangmidang.co.kr/brand/eat_detail?idx=38',
      image_checked_at: '2026-11-14',
      title: '쉐이크쉑 네이버페이 QR 30% 할인', discount_label: '30% 할인',
      summary: '11월 15일까지 쉐이크쉑에서 Npay QR로 결제 시 30% 할인. 참여 매장·대상 상품·한도·중복 적용은 공식 행사 상세를 확인하세요.',
    },
  },
  {
    id: 'pascucci_npay_20261115', brand: '파스쿠찌', category: '카페',
    alias_ids: ['c_2efc69e53209'], alias_first_seen_from: '2026-11-11',
    start_date: '2026-11-11', end_date: '2026-11-15', programs: ['네이버페이'],
    source_url: 'https://pay.naver.com/benefit/payment/list?firstCategory=DOMESTIC_INSTORE&secondCategory=FNB',
    checked_at: CHECKED_AT,
    evidence: '2026년 11월 14일 Npay 공식 현장결제 목록에서 파스쿠찌 포인트·머니·카드 QR 1만원 이상 결제 시 40% 할인, D-1을 확인. 삼립 제공 11/2 보도자료에서 11/11~15 신제품 출시 기념 Npay 40% 프로모션과 해당 공식 캠페인 포스터를 대조.',
    coupon: {
      menu: '전 메뉴', item_type: '기타', discount_type: 'percent', discount_value: 40,
      discount_rate: 40, min_order: 10000, channels: ['매장'],
      conditions: 'Npay 포인트·머니·카드 QR로 10000원 이상 결제 시 40% 할인. 11월 15일 종료. 참여 매장·한도·중복 적용은 공식 행사 상세를 확인하세요.',
      program_note: '11월 15일 종료 · Npay 포인트·머니·카드 QR',
      how_to_use: 'Npay 포인트·머니·카드 QR로 결제하고 공식 행사 상세 조건을 확인하세요.',
    },
    news: {
      image_url: './event-images/pascucci-christmas-campaign-202611.webp',
      image_kind: 'official_campaign',
      image_fit: 'contain',
      image_source_url: 'https://www.hankyung.com/article/202611029284P',
      image_checked_at: '2026-11-14',
      title: '파스쿠찌 네이버페이 QR 40% 할인', discount_label: '40% 할인',
      summary: '11월 15일까지 Npay 포인트·머니·카드 QR로 10000원 이상 결제 시 40% 할인. 참여 매장·한도·중복 적용은 공식 행사 상세를 확인하세요.',
    },
  },
  {
    id: 'dunkin_combo_gift_20260701', brand: '던킨', category: '디저트',
    start_date: '2026-07-01', end_date: '2026-12-31', programs: ['해피포인트'],
    source_url: 'https://www.dunkindonuts.co.kr/index.php/event/view?id=5407',
    checked_at: CHECKED_AT,
    evidence: '7월 1일~12월 31일 해피오더에서 던킨콤보 바로 픽업 주문 시 글레이즈드 증정. 예약 주문 제외. 아이디당 하루 한 번, 발급 당일 유효 쿠폰을 주문당 한 장 사용.',
    coupon: {
      menu: '던킨콤보 픽업 주문 시 글레이즈드 증정', item_type: '세트',
      discount_type: 'free_item', discount_value: null, discount_rate: null,
      channels: ['픽업'], app_only: true, stackable: 'no',
      conditions: '해피오더 던킨콤보 바로 픽업 주문 대상이며 예약 주문은 제외됩니다. ID당 하루 1회, 발급 당일 유효한 쿠폰을 결제 1건당 1장 사용할 수 있습니다. 타 행사·쿠폰·제휴할인 중복 불가, 해피포인트 적립 불가. 참여 매장과 재고를 확인하세요.',
      program_note: '해피오더 바로 픽업 · 예약 주문 제외',
      how_to_use: '해피오더에서 행사 쿠폰을 확인한 뒤 던킨콤보 바로 픽업 주문에 적용하세요.',
    },
    news: {
      title: '던킨콤보 바로 픽업 시 글레이즈드 증정', discount_label: '도넛 증정',
      image_url: './event-images/dunkin-combo-gift-2026.webp',
      detail_image_url: './event-images/dunkin-combo-gift-2026-detail.webp',
      image_kind: 'official_poster',
      image_source_url: 'https://www.dunkindonuts.co.kr/index.php/event/view?id=5407',
      image_checked_at: '2026-11-14',
      summary: '12월 31일까지 해피오더 던킨콤보 바로 픽업 주문 시 글레이즈드를 증정합니다. 예약 주문 제외, ID당 하루 1회·주문당 쿠폰 1장. 쿠폰은 발급 당일만 유효하며 참여 매장·재고를 확인하세요.',
    },
  },
  {
    id: 'baskin_blockpack_20261111', brand: '배스킨라빈스', category: '디저트',
    start_date: '2026-11-11', end_date: '2026-11-15', programs: [],
    source_url: 'https://www.baskinrobbins.co.kr/play/event/view.php?category=ALL&seq=642',
    checked_at: CHECKED_AT,
    evidence: '11월 11~15일 블록팩 4개 12000원 행사. 1인 최대 2세트, 다른 쿠폰·행사·제휴할인 중복 불가. 결제금액의 해피포인트 0.1% 적립. 행사 참여 매장 확인 필요.',
    coupon: {
      menu: '블록팩 4개', item_type: '세트',
      discount_type: 'price', discount_value: 12000, coupon_price: 12000,
      discount_rate: null, channels: ['매장'], stackable: 'no',
      conditions: '블록팩 4개 12000원, 1인 최대 2세트 구매 가능. 타 쿠폰·타 행사·제휴할인과 중복되지 않습니다. 결제금액의 해피포인트 0.1% 적립 가능. 행사 참여 매장을 확인하세요.',
      program_note: '1인 최대 2세트',
      how_to_use: '행사 참여 매장에서 블록팩 4개 묶음 행사 적용 여부를 확인하세요.',
    },
    news: {
      title: '배스킨라빈스 블록팩 4개 12000원', discount_label: '12000원',
      summary: '11월 11~15일 블록팩 4개를 12000원에 판매합니다. 1인 최대 2세트이며 다른 쿠폰·행사·제휴할인과 중복되지 않습니다. 참여 매장을 확인하세요.',
      image_url: 'https://www.baskinrobbins.co.kr/upload/ckeditor/7e847e1332a68e7fbe86cb94a48a3231.png',
    },
  },
];

const kstDay = (date = new Date()) => {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) throw new TypeError('A valid date is required');
  return new Date(value.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
};
const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
const brandKey = (s) => /^(hans|한스|한스케익|한스케이크)$/i.test(key(s)) ? 'hans' : key(s);

// Only detail URLs identify an event. A shared event list or campaign landing
// page must never be used to transfer dates from a different promotion.
function detailKey(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/^\/m\//, '/').replace(/^\/index\.php\//, '/');
    if (host === 'pay.naver.com' && /^\/benefit\/payment\/detail\/\d+$/.test(path)) return `${host}${path}`;
    if (host === 'dunkindonuts.co.kr' && path === '/event/view' && /^\d+$/.test(u.searchParams.get('id') || '')) return `${host}${path}?id=${u.searchParams.get('id')}`;
    if (host === 'baskinrobbins.co.kr' && path === '/play/event/view.php' && /^\d+$/.test(u.searchParams.get('seq') || '')) return `${host}${path}?seq=${u.searchParams.get('seq')}`;
  } catch { /* non-URL evidence is not an event identity */ }
  return '';
}
const detailKeys = (x) => new Set([x.source_url, x.official_link].flatMap((s) => String(s || '').split(/\s+/)).map(detailKey).filter(Boolean));
const dateConflict = (a, b) => ['start_date', 'end_date'].some((field) => a[field] && b[field] && a[field] !== b[field]);
const exactEvent = (a, b) => {
  if (!a || !b) return false;
  if (a.event_id && b.event_id && a.event_id === b.event_id) return true;
  if (a.id && a.id === b.id) return true;
  if (brandKey(a.brand) !== brandKey(b.brand) || dateConflict(a, b)) return false;
  const keys = detailKeys(a);
  return [...detailKeys(b)].some((k) => keys.has(k));
};

/** Conservative comparison for duplicate suppression, never a broad brand match. */
export function sameEvent(a, b) {
  if (exactEvent(a, b)) return true;
  if (!a || !b || brandKey(a.brand) !== brandKey(b.brand) || dateConflict(a, b)) return false;
  if (!a.start_date || !a.end_date || a.start_date !== b.start_date || a.end_date !== b.end_date) return false;
  const sameName = key(a.menu || a.title) && key(a.menu || a.title) === key(b.menu || b.title);
  return !!sameName && key([...(a.programs || [])].sort().join(',')) === key([...(b.programs || [])].sort().join(','));
}

function matchesEvent(record, event, template) {
  // A stable collector ID can recur in another month. Once an ID is known as
  // an alias, neither a copied event_id nor an old URL may bypass its generation.
  if ((event.alias_ids || []).includes(record.id)) return matchesAlias(record, event, template);
  if (sameEvent(record, template)) return true;
  // A known specific menu collected from a list can suppress a duplicate, but
  // does not authorize rewriting its dates/conditions. Avoid historical cycles.
  if (!event.menu_aliases || brandKey(record.brand) !== brandKey(event.brand) || dateConflict(record, event)) return false;
  if (!event.menu_aliases.some((name) => key(name) === key(record.menu))) return false;
  if (record.discount_type !== template.discount_type || Number(record.discount_value) !== Number(template.discount_value)) return false;
  if (!event.programs.every((p) => (record.programs || []).includes(p))) return false;
  const seen = Date.parse(record.first_seen || '');
  return Number.isFinite(seen) && kstDay(seen) >= event.start_date && kstDay(seen) <= event.end_date;
}
function matchesAlias(record, event, template) {
  if (!(event.alias_ids || []).includes(record.id) || brandKey(record.brand) !== brandKey(event.brand) || dateConflict(record, event)) return false;
  const seen = Date.parse(record.first_seen || '');
  if (!Number.isFinite(seen)) return false;
  const day = kstDay(seen);
  if (day < (event.alias_first_seen_from || event.start_date) || day > event.end_date) return false;
  if (record.discount_type !== template.discount_type || Number(record.discount_value) !== Number(template.discount_value)) return false;
  if (!event.programs.every((p) => (record.programs || []).includes(p))) return false;
  return [template.menu, ...(event.menu_aliases || [])].some((menu) => key(menu) === key(record.menu));
}
function confirmedMatch(record, event, template) {
  return (event.alias_ids || []).includes(record.id)
    ? matchesAlias(record, event, template)
    : exactEvent(record, template);
}
const held = (x) => !!(x.hidden || x.is_hidden || x.manual_hidden || (x.status && x.status !== 'published') || (x.manual_status && x.manual_status !== 'published'));

function templates(event) {
  const common = {
    event_id: event.id, brand: event.brand, category: event.category,
    start_date: event.start_date, end_date: event.end_date,
    programs: [...event.programs], source_id: `verified-${event.id}`,
    source_url: event.source_url, official_link: event.source_url,
    status: 'published', checked_at: event.checked_at, first_seen: event.checked_at,
    verified_detail_checked_at: event.checked_at, verified_detail_source_url: event.source_url,
    confidence: 1, evidence: event.evidence, issues: [],
    period_source: '공식 원문', period_refs: `${event.programs.includes('네이버페이') ? 'Npay' : event.brand}|${event.source_url}|${kstDay(event.checked_at)}`,
  };
  return {
    coupon: { ...common, id: `c_verified_${event.id}`, regular_price: null,
      coupon_price: null, discount_rate: null, discount_value: null,
      max_discount: null, min_order: null, discount_unit: '',
      channels: [], audience: '전체', app_only: false, stackable: '',
      image_url: '', ...event.coupon },
    news: { ...common, id: `n_verified_${event.id}`, notice_only: true, image_url: '', related_ids: [], ...event.news },
  };
}

function enrichExact(existing, template) {
  // Preserve the collector/admin identity, moderation and actual check time.
  // Only a proven detail-page identity can supply missing verified metadata.
  const out = { ...existing };
  for (const field of ['event_id', 'start_date', 'end_date', 'conditions', 'how_to_use', 'program_note', 'discount_unit', 'period_source', 'period_refs', 'verified_detail_checked_at', 'verified_detail_source_url', 'notice_only']) {
    if (!out[field] && template[field] !== undefined) out[field] = template[field];
  }
  if (template.image_url && (!out.image_url || out.image_url === template.image_url)) {
    for (const field of ['image_url', 'detail_image_url', 'image_kind', 'image_fit', 'image_source_url', 'image_checked_at']) {
      if (!out[field] && template[field] !== undefined) out[field] = template[field];
    }
  }
  if (!out.checked_at) out.checked_at = template.checked_at;
  return out;
}

function enrichAlias(existing, template) {
  // These IDs were checked against the official current list/details, with
  // brand + menu + payment program + benefit gates above. The review timestamp
  // is a fixed observation, never today's clock or the API's generated time.
  // A later real source check owns its facts. Supplement only missing fields,
  // recording the original supplement's date separately from that newer check.
  if (Date.parse(existing.checked_at || '') > Date.parse(template.checked_at)) return enrichExact(existing, template);
  return { ...existing, ...template, id: existing.id,
    ...(existing.status ? { status: existing.status } : {}),
    first_seen: existing.first_seen || template.first_seen,
  };
}

// Exact stale list rows whose dates are legible on the official posters.
// Preserve explicit newer dates and a new collector generation.
export function withReviewedNoticePeriods(news = []) {
  const fixes = [
    { brand: '파파이스', id: 'n_c94c469d4626', first_seen: '2026-10-28T02:35:17.344Z', title: '수요일 치킨 1+1 및 콜라 100원', summary: '11월 11일', start: '2026-11-11', end: '2026-11-11', url: 'https://popeyes.co.kr/event/69' },
    { brand: '파파이스', id: 'n_5115cf53eee2', first_seen: '2026-11-03T08:41:44.039Z', title: '버거 2종 7,900원 특가', summary: '루이 치킨휠레', start: '2026-10-23', end: '2026-11-08', url: 'https://popeyes.co.kr/event/67' },
    { brand: '빽다방', id: 'n_8d748f7d6591', first_seen: '2026-10-28T20:19:12.194Z', title: '말차 전 메뉴 2,026원 프로모션', summary: '2026년 말의해', start: '2026-01-02', end: '2026-01-08', url: 'https://paikdabang.com/post_news/2026_promotion/', sources: ['https://paikdabang.com/news/?cate=event'] },
  ];
  return news.map((n) => {
    if (n.id === 'n_fd4864185ad9' && n.brand === '파파존스' && n.first_seen === '2026-11-08T15:23:18.358Z'
      && n.start_date === '2026-11-09' && n.end_date === '2026-11-18' && n.source_url === 'https://www.pji.co.kr/event/ongoing') {
      return { ...n, start_date: '2026-11-18', summary: '11월 18일 하루, 온라인 주문 시 라지 사이즈 이상 모든 피자 30% 할인. 참여 매장과 제외 조건은 공식 상세에서 확인하세요.',
        period_source: '공식 공지 이미지', period_refs: 'https://www.pji.co.kr/event/ongoing/9638', verified_detail_checked_at: CHECKED_AT };
    }
    const fix = fixes.find((f) => n.id === f.id && n.brand === f.brand && n.first_seen === f.first_seen
      && n.title === f.title && String(n.summary || '').includes(f.summary)
      && [...(f.sources || ['https://popeyes.co.kr/event', 'https://www.popeyes.co.kr/event']), f.url].includes(n.source_url)
      && !n.start_date && !n.end_date);
    return fix ? { ...n, start_date: fix.start, end_date: fix.end, period_source: '공식 공지 이미지',
      period_refs: fix.url, verified_detail_source_url: fix.url, verified_detail_checked_at: CHECKED_AT } : n;
  });
}

/**
 * Merge reviewed events into a collector/API snapshot without mutating it.
 * Date may be a Date, timestamp, or a YYYY-MM-DD KST day; end dates are inclusive.
 * Any matching hidden/pending/rejected entry blocks automatic additions in both
 * sections. Existing moderation, IDs, check times and unrelated rows survive.
 */
export function withVerifiedEvents(data = {}, date = new Date()) {
  const today = kstDay(date);
  let coupons = (data.coupons || []).map((c) => c.id === 'c_f39852815df3' && c.brand === '빽다방'
    && c.first_seen === '2026-10-26T21:06:40.587Z' && c.menu === '말차 전 메뉴' && c.discount_type === 'price'
    && Number(c.discount_value) === 2026 && c.source_url === 'https://paikdabang.com/news/?cate=event'
    && !c.start_date && !c.end_date ? { ...c, start_date: '2026-01-02', end_date: '2026-01-08',
      period_source: '공식 공지 이미지', period_refs: 'https://paikdabang.com/post_news/2026_promotion/',
      verified_detail_checked_at: CHECKED_AT } : c);
  let news = withReviewedNoticePeriods(data.news || []);
  for (const event of verifiedEvents) {
    const { coupon, news: notice } = templates(event);
    const cm = (x) => matchesEvent(x, event, coupon);
    const nm = (x) => matchesEvent(x, event, notice);
    const foundCoupons = coupons.filter(cm), foundNews = news.filter(nm);
    const blocked = [...foundCoupons, ...foundNews].some(held);
    const active = (event.start_date || kstDay(event.checked_at)) <= today && today <= event.end_date;
    if (!active) {
      // Expire our own/detail-identified additions; never give an undated,
      // unrelated list entry an invented lifetime based on a broad menu match.
      coupons = coupons.filter((x) => held(x) || !confirmedMatch(x, event, coupon));
      news = news.filter((x) => held(x) || !exactEvent(x, notice));
      continue;
    }
    if (blocked) continue;
    coupons = coupons.map((x) => matchesAlias(x, event, coupon) ? enrichAlias(x, coupon) : confirmedMatch(x, event, coupon) ? enrichExact(x, coupon) : x);
    news = news.map((x) => exactEvent(x, notice) ? enrichExact(x, notice) : x);
    if (!foundCoupons.length) coupons.push(coupon);
    if (!foundNews.length) {
      notice.related_ids = coupons.filter(cm).filter((x) => !held(x)).map((x) => x.id).filter(Boolean);
      news.push(notice);
    }
  }
  return { ...data, coupons, news };
}
