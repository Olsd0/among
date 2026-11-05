// 메인 메뉴 / 사이드메뉴 나누기 (11/05 대표 요청). 메뉴 이름은 11/05 실제 공개 목록에서 가져온 예시다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSideMenu, matchesFilters, MENU_TYPES } from '../src/engine.js';

const side = (category, menu) => isSideMenu({ category, menu });

test('햄버거·치킨·피자 브랜드의 사이드·음료·소스·디저트는 사이드메뉴', () => {
  for (const [cat, menu] of [
    ['햄버거', '아이스 드립 커피 M'], ['햄버거', '스프라이트 제로 M'], ['햄버거', '맥너겟 4조각'], ['햄버거', '애플 파이'],
    ['햄버거', '치킨 모짜렐라 스낵랩'], ['햄버거', '버터 비스켓'], ['햄버거', '닭껍질튀김x2 + 스파이시마요'], ['햄버거', '감자튀김 (M)'],
    ['피자', '치즈 폭탄 파스타'], ['피자', '더블 디핑소스'], ['피자', '코카-콜라 1.25L'], ['피자', '버팔로 윙'], ['치킨', '치즈볼'], ['치킨', '콜라 1.25L'],
  ]) assert.equal(side(cat, menu), true, `${cat} ${menu}`);
});

test('주메뉴·묶음 할인·주메뉴가 든 세트, 카페·디저트 브랜드는 메인 메뉴', () => {
  for (const [cat, menu] of [
    ['햄버거', '불고기 버거'], ['햄버거', '징거'], ['햄버거', '핫크리스피통다리 외 7종'], ['햄버거', '전 메뉴'], ['햄버거', '불고기버거 세트'],
    ['피자', '불닭 까르보 치킨'], ['피자', 'VIP PICK 세트'], ['피자', '프리미엄 피자 + 프리미엄 피자 (M 사이즈 + M 사이즈)'],
    ['피자', '크러스트 4종 중 택1 (체다 치즈롤, 스파이시 갈릭 치즈롤, 치즈롤, 골드링) 피자 + 코카-콜라 500ml 주문 시 더블 초코칩 브라우니'],
    ['피자', '모든 피자'], ['치킨', '황금올리브치킨 닭다리 4조각'], ['치킨', '허니윙콤비 + 은하수 푸른밤 6도'], ['치킨', '치킨텐더'],
    ['카페', '아메리카노 (R)'], ['카페', '가상 케이크 세트'], ['디저트', '싱글레귤러'], ['디저트', '애플 파이'], ['햄버거', ''],
  ]) assert.equal(side(cat, menu), false, `${cat} ${menu}`);
});

test('목록 필터: menu가 없으면 모두, main·side는 나눠서', () => {
  const coupons = [{ category: '햄버거', menu: '불고기 버거' }, { category: '햄버거', menu: '맥너겟 4조각' }, { category: '카페', menu: '라떼' }];
  const pick = (menu) => coupons.filter((c) => matchesFilters(c, { menu }, { today: '2026-11-05' })).map((c) => c.menu);
  assert.deepEqual(pick(undefined), ['불고기 버거', '맥너겟 4조각', '라떼']);
  assert.deepEqual(pick('main'), ['불고기 버거', '라떼']);
  assert.deepEqual(pick('side'), ['맥너겟 4조각']);
  assert.deepEqual(MENU_TYPES.map((m) => m.label), ['메인 메뉴', '사이드메뉴']);
});
