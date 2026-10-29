import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { productImage, productPhoto } from '../src/product-images.js';
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
  const [h] = pickHeadlines([c], [{ id: 'news', brand: c.brand, title: '전 메뉴 할인', discount_label: '15천원', end_date: '2026-11-01', related_ids: [c.id], image_url: 'https://example.test/event.jpg' }], { today: '2026-10-28' });
  assert.equal(h.image_url, '');
  assert.equal(h.label, '15000원');
});

test('웹 상품 사진 목록이 수집기 원본과 같다', () => {
  assert.equal(readFileSync(new URL('../../web/product-images.js', import.meta.url), 'utf8'), readFileSync(new URL('../src/product-images.js', import.meta.url), 'utf8'));
});
