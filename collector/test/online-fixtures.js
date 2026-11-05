// 온라인 특가 모의 검증용 데이터. 실제 공급처 응답이 아니며 테스트에서만 쓴다.
// 상품명·가격·링크는 모두 가짜이고, 공급처 응답 필드를 흉내 내지 않는다 (표준 후보 형식 그대로).
export const OD_T0 = Date.parse('2026-11-05T03:00:00Z'); // 한국 시간 11/5 12:00
export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;

export function candidate(over = {}) {
  return {
    supplierItemId: 'MOCK-1001', optionKey: '', title: '테스트 생수 2L', option: '2L × 12개', store: '쿠팡', seller: '테스트 판매자',
    price: 7900, currency: 'KRW', priceBasis: 'item_total', optionPrice: 'single', membership: '', personalized: false,
    shipping: 'unknown', shippingFee: null, shippingThreshold: null,
    conditions: ['테스트 조건: 1인 1회 구매'], conditionsComplete: true,
    categoryPath: '식품 > 생수/음료', url: 'https://link.coupang.com/a/mock1001',
    imageUrl: 'https://thumbnail.coupangcdn.com/thumbnails/mock/1001.jpg',
    affiliate: true, pick: '', availability: 'available', startsAt: '', endsAt: '',
    observedAt: new Date(OD_T0).toISOString(),
    ...over,
  };
}

/** 여러 종류의 후보: 게시 가능 2개 + 보류돼야 하는 것들 */
export function mixedBatch(observedAt = new Date(OD_T0).toISOString()) {
  const c = over => candidate({ observedAt, ...over });
  return [
    c({ supplierItemId: 'OK-WATER' }),
    c({ supplierItemId: 'OK-TISSUE', title: '테스트 화장지 30롤', option: '30m × 30롤', categoryPath: '생활용품 > 화장지/물티슈', price: 15900, shipping: 'free', url: 'https://link.coupang.com/a/mocktissue' }),
    c({ supplierItemId: 'UNIT-PRICE', title: '테스트 쌀', priceBasis: 'unit', price: 390 }),
    c({ supplierItemId: 'NO-SELLER', title: '테스트 라면', seller: '' }),
    c({ supplierItemId: 'BAD-LINK', title: '테스트 커피', url: 'https://attacker.test/a/1' }),
    c({ supplierItemId: 'APPLIANCE', title: '테스트 냉동고', categoryPath: '가전디지털 > 냉장고/냉동고' }),
    c({ supplierItemId: 'COND', title: '테스트 우유', conditionsComplete: false }),
  ];
}
