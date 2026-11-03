import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { productImage, productPhoto } from '../src/product-images.js';
import { couponImage, couponPhoto } from '../src/product-images.js';
import { formatMoneyLabel, benefitLabel, pickHeadlines } from '../src/engine.js';

test('금액 라벨: 천·만·쉼표를 전체 숫자로 바꾸고 할인율과 1+1은 유지한다', () => {
  for (const [input, output] of [
    ['3천원', '3000원'], ['15천원', '15000원'], ['1.5만원', '15000원'],
    ['1만5천원', '15000원'], ['1만 5천 500원', '15500원'], ['최대 15,000원 할인', '최대 15000원 할인'],
    ['1천원당 100원 할인', '1000원당 100원 할인'], ['20%', '20%'], ['1+1', '1+1'],
  ]) assert.equal(formatMoneyLabel(input), output);
  assert.equal(benefitLabel({ discount_type: 'amount', discount_value: 15000, discount_rate: 30 }), '15000원 할인');
});

test('상품 사진: 같은 브랜드의 정확한 상품만, 크기·수량·세트를 바꿔 연결하지 않는다', () => {
  const item = { brand: '맥도날드', menu: '불고기 버거' };
  assert.ok(productImage(item));
  assert.equal(productImage(item), productImage({ ...item, menu: '불고기버거' }));
  for (const menu of ['더블 불고기 버거', '불고기버거 세트', '불고기버거 2개', '전 메뉴', '해피스낵']) {
    assert.equal(productImage({ ...item, menu }), '', menu);
  }
  assert.equal(productImage({ ...item, item_type: '세트' }), '');
  assert.equal(productImage({ ...item, brand: '롯데리아' }), '');
  const m = productImage({ ...item, menu: '아이스 드립 커피 M' });
  const l = productImage({ ...item, menu: '아이스 드립 커피 L' });
  assert.ok(m && l && m !== l);
  assert.equal(productImage({ ...item, menu: '아이스 드립 커피' }), '');
  assert.equal(productImage({ ...item, menu: '맥너겟 6조각' }), '');
  assert.equal(productImage({ ...item, menu: '맥너겟® 4조각' }), productImage({ ...item, menu: '맥너겟 4조각' }));
  assert.equal(new URL(productPhoto(item).source).hostname, 'www.mcdonalds.co.kr');
});

test('소식은 연관 쿠폰의 상품 사진을 빌려 쓰지 않는다', () => {
  const c = { id: 'burger', brand: '맥도날드', menu: '불고기버거', image_url: productImage({ brand: '맥도날드', menu: '불고기버거' }) };
  const n = { id: 'news', brand: c.brand, title: '전 메뉴 할인', discount_label: '15천원', end_date: '2026-11-01', related_ids: [c.id], image_url: '' };
  const [h] = pickHeadlines([c], [n], { today: '2026-10-28' });
  assert.equal(h.image_url, '', '연결 쿠폰의 상품 사진을 공지 이미지로 저장하지 않는다 (화면에서 \'관련 상품 이미지\'로 따로 표시)');
  assert.equal(h.label, '15000원');
  // 수집기가 그 공지의 공식 페이지에서 고른 공지 이미지는 유지한다
  const [own] = pickHeadlines([c], [{ ...n, image_url: 'https://example.test/event.jpg' }], { today: '2026-10-28' });
  assert.equal(own.image_url, 'https://example.test/event.jpg');
});

test('웹 상품 사진 목록이 수집기 원본과 같다', () => {
  assert.equal(readFileSync(new URL('../../web/product-images.js', import.meta.url), 'utf8'), readFileSync(new URL('../src/product-images.js', import.meta.url), 'utf8'));
});

test('제휴 메뉴는 동일한 공식 행사 포스터를 쓰며 다른 행사·브랜드·기간에는 연결하지 않는다', () => {
  const item = { brand: '반올림피자', menu: '제휴 메뉴', item_type: '세트', end_date: '2026-11-08',
    source_url: 'https://order.banolimpizza.com/event/detail/163814c2-cc1e-4051-b35c-91ba2906ea36?eventStatus=ongoing' };
  const photo = couponPhoto(item, '2026-10-31');
  assert.equal(photo.kind, 'campaign');
  assert.equal(photo.url, 'https://cdn.banolimpizza.com/event/b6cb07152f824c0a91c40039dbb11a29.png');
  assert.match(photo.detailUrl, /5fc80c5e10204080979d1782a56f8f5e/);
  assert.equal(productImage(item), '', '행사 포스터를 정확한 단품 사진으로 저장하지 않는다');
  for (const change of [{ brand: '미스터피자' }, { menu: '다른 제휴 세트' }, { end_date: '2027-11-08' },
    { source_url: 'https://order.banolimpizza.com/event/list?eventStatus=ongoing' },
    { source_url: item.source_url.replace('order.banolimpizza.com', 'example.test') }]) {
    assert.equal(couponImage({ ...item, ...change }, '2026-10-31'), '');
  }
  assert.equal(couponImage(item, '2026-11-09'), '');
  const [hot] = pickHeadlines([{ ...item, id: 'collab', category: '피자', audience: '전체', discount_type: 'free_item', first_seen: '2026-10-31T03:00:00Z' }], [], { today: '2026-10-31' });
  assert.equal(hot.image_url, photo.url);
});

test('전 메뉴·복수 메뉴 할인은 같은 브랜드의 공식 대표 사진을 구분해 표시한다', () => {
  const item = { brand: '쉐이크쉑', menu: '전 메뉴', item_type: '기타', image_url: 'https://example.test/unverified.jpg' };
  const photo = couponPhoto(item);
  assert.equal(photo.kind, 'representative');
  assert.equal(photo.label, '대표 메뉴 이미지');
  assert.match(photo.name, /버거 모음/);
  assert.match(photo.source, /sangmidang.co.kr\/brand\/eat_detail\?idx=38/);
  for (const menu of ['전 메뉴 30%', '전체 메뉴', '여러 햄버거', '버거 3종', '쉑버거, 스모크쉑']) {
    assert.equal(couponImage({ ...item, menu }), photo.url, menu);
  }
  for (const menu of ['쉑버거 더블', '쉑버거 세트', '콜라', '구매금액 10,000원']) {
    assert.equal(couponImage({ ...item, menu }), '', menu);
  }
  assert.equal(couponImage({ ...item, brand: '알 수 없는 브랜드' }), '');
  assert.equal(couponPhoto({ brand: '맥도날드', menu: '불고기 버거' }).kind, 'product');
  for (const brand of ['쉐이크쉑', '반올림피자', '공차', '폴바셋', '맥도날드', '파리바게뜨']) {
    const representative = couponPhoto({ brand, menu: '전 메뉴' });
    assert.equal(representative.kind, 'representative', brand);
    assert.match(representative.source, /^https:\/\//);
    assert.match(representative.url, /^https:\/\//, '사진 파일을 저장하지 않고 공식 주소를 쓴다');
  }
});

test('핫딜 대신 사진: 연결 쿠폰의 상품 사진 → 글에 나온 공식 메뉴 → 브랜드 대표 메뉴, 다른 브랜드 사진은 쓰지 않는다', async () => {
  const { brandPhoto, brandMenuPhotos } = await import('../src/product-images.js');
  for (const p of brandMenuPhotos()) {
    assert.match(p.url, /^https:\/\//, p.name);
    assert.match(p.source, /^https:\/\//, p.name);
  }
  const burger = { brand: '맥도날드', menu: '불고기 버거', item_type: '단품' };
  assert.equal(brandPhoto('맥도날드', '해피 스낵 행사', [burger]).label, '관련 상품 이미지');
  assert.equal(brandPhoto('맥도날드', '해피 스낵 행사', [burger]).url, productImage(burger));
  const corn = brandPhoto('교촌치킨', '허니옥수수윙콤비 출시 기념 할인');
  assert.equal(corn.name, '허니옥수수윙콤비', '더 긴 이름이 맞는 메뉴를 고른다');
  assert.equal(corn.label, '관련 상품 이미지');
  const rep = brandPhoto('피자헛', '주말 1+1 핫딜');
  assert.equal(rep.label, '대표 메뉴 이미지');
  assert.equal(rep.name, '수퍼슈프림');
  assert.equal(brandPhoto('쉐이크쉑', 'T day 30%').label, '대표 메뉴 이미지');
  assert.equal(brandPhoto('네이버페이', '카페 적립'), null, '음식 브랜드가 아니면 사진 없음 → 로고');
  assert.equal(brandPhoto('모르는 브랜드', '수퍼슈프림'), null, '다른 브랜드의 메뉴 사진을 빌리지 않는다');
});
