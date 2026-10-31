import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { noticePhoto, noticeImage } from '../src/notice-images.js';
import { productImage } from '../src/product-images.js';
import { createHash } from 'node:crypto';

const notice = { brand: 'KFC', title: '더블 커넬위크', source_url: 'https://www.kfckorea.com/promotion/promotionList/A801', end_date: '2026-11-01' };
test('공지는 확인한 해당 행사 원본 사진과 상세 출처로 연결한다', () => {
  const photo = noticePhoto(notice, '2026-10-29');
  assert.equal(photo.image, 'https://www.kfckorea.com/nas/event/2026/10/22/TEJl47cerDLZ.png');
  assert.equal(photo.source, 'https://www.kfckorea.com/promotion/promotionList/detail/1130');
  assert.equal(productImage(notice), '');
});
test('다른 제목·브랜드·출처·기간의 공지에 등록된 이미지를 빌려 쓰지 않는다', () => {
  for (const change of [{ title: '일반 매장 공지' }, { brand: '맥도날드' }, { source_url: 'https://example.test/event' }, { end_date: '2026-12-01' }]) {
    assert.equal(noticeImage({ ...notice, ...change }, '2026-10-29'), '');
  }
  assert.equal(noticeImage(notice, '2026-11-02'), '');
  assert.equal(noticeImage({ ...notice, source_url: 'http://www.kfckorea.com/promotion/promotionList/A801' }, '2026-10-29'), '');
});
test('공지 URL의 쿼리 순서·해시가 달라도 같은 공식 공지면 인식한다', () => {
  const d = { brand: '도미노피자', title: '목요일 한 판 사면 한 판 더', source_url: 'https://web.dominos.co.kr/event/viewHtml?seq=2449&gubun=E0200#content' };
  assert.ok(noticeImage(d, '2026-10-29').includes('thu_spcd_02.jpg'));
});
test('웹 공지 이미지 목록은 수집기 원본과 같다', () => {
  assert.equal(readFileSync(new URL('../src/notice-images.js', import.meta.url), 'utf8'), readFileSync(new URL('../../web/notice-images.js', import.meta.url), 'utf8'));
});

test('새 공지는 목록 썸네일과 상세 원본을 구분하고 유사한 다른 행사는 제외한다', () => {
  const n = { brand: '피자헛', title: '피자헛 주말 1 + 1 핫딜', source_url: 'https://www.pizzahut.co.kr/cs/event/extra/hellopizzahut', end_date: '2026-10-31' };
  const photo = noticePhoto(n, '2026-10-29');
  assert.equal(photo.image, 'https://akamai.pizzahut.co.kr/2020pizzahut-prod/public/event/c164ec37-60e8-430e-b80b-1ffac3113327.png');
  assert.equal(photo.detailImage, 'https://akamai.pizzahut.co.kr/event/hellopizzahut_2610_event_weekend_down_pc_3_1.png');
  assert.equal(noticeImage({ ...n, title: '피자헛 평일 반값 핫딜' }, '2026-10-29'), '');
  assert.equal(noticeImage({ ...n, end_date: '2026-11-30' }, '2026-10-29'), '');
  assert.equal(noticeImage(n, '2026-11-01'), '');
});
test('공식 목록에서 연결한 썸네일은 제목·브랜드가 맞는 행사에만 쓴다', () => {
  for (const [brand, title, source_url, end_date] of [
    ['배스킨라빈스', '카카오페이 싱글레귤러 50% 할인', 'https://www.baskinrobbins.co.kr/m/play/event/view.php?seq=620&category=ALL', '2026-10-31'],
    ['반올림피자', '반올림 명일방주 콜라보', 'https://order.banolimpizza.com/event/detail/163814c2-cc1e-4051-b35c-91ba2906ea36?eventStatus=ongoing', '2026-11-08'],
    ['푸라닭', '푸라닭 전용앱 쿼터레그 증정', 'https://www.puradakchicken.com/mobile/news/event.asp?mode=view&page=1&pageSize=10&seritemidx=&artistidx=&serboardsort=&search=0&searchStr=&idx=45863', '2026-11-25'],
    ['굽네치킨', '매주 주말 인기 메뉴 4,000원 할인', 'https://www.goobne.co.kr/brd/event/list_p', '2026-10-31'],
    ['네이버페이', '네이버페이 카페 현장결제 포인트 적립', 'https://campaign2.naver.com/npay/cafe/', '2026-11-01'],
  ]) {
    const n = { brand, title, source_url, end_date };
    assert.ok(noticeImage(n, '2026-10-29'), title);
    assert.equal(noticeImage({ ...n, title: '새 행사 출시' }, '2026-10-29'), '');
  }
});

test('10월 31일 대조한 공식 행사 8건의 썸네일은 원본 해시·출처·기간을 보존한다', () => {
  const cases = [
    ['배스킨라빈스', '젤라또 피케 파우치 사전예약', 'https://www.baskinrobbins.co.kr/m/play/event/list.php', '2026-11-03'],
    ['배스킨라빈스', '파인트를 10년 전 가격으로 픽업', 'https://www.baskinrobbins.co.kr/m/play/event/list.php', '2026-11-03'],
    ['스타벅스', '딜리버스 만원 별 더블 적립', 'https://www.starbucks.co.kr/whats_new/campaign_list.do', '2026-10-31'],
    ['스타벅스', 'Stars Full of Heart', 'https://www.starbucks.co.kr/whats_new/campaign_list.do', '2026-11-20'],
    ['스타벅스', '2026 쓱데이 특별전', 'https://www.starbucks.co.kr/whats_new/campaign_list.do', '2026-11-08'],
    ['피자헛', '피자헛 10월 평일 반값 핫딜', 'https://www.pizzahut.co.kr/cs/event/extra/hellopizzahut', '2026-10-31'],
    ['반올림피자', '반올림피자 명일방주 콜라보', 'https://order.banolimpizza.com/event/list?eventStatus=ongoing', '2026-11-08'],
    ['굽네치킨', '주말 굽네 인기메뉴 4천원 할인', 'https://www.goobne.co.kr/brd/event/list_p', '2026-11-01'],
  ];
  let total = 0;
  for (const [brand, title, source_url, end_date] of cases) {
    const n = { brand, title, source_url, end_date };
    const photo = noticePhoto(n, '2026-10-31');
    assert.ok(photo, title);
    assert.match(photo.image, /^assets\/notices\/[a-z0-9-]+-[a-f0-9]{12}\.(jpg|png)$/);
    assert.match(photo.originalImage, /^https:\/\//);
    assert.equal(photo.verifiedAt, '2026-10-31');
    const bytes = readFileSync(new URL(`../../web/${photo.image}`, import.meta.url));
    total += bytes.length;
    assert.ok(photo.image.includes(createHash('sha256').update(bytes).digest('hex').slice(0, 12)));
    assert.equal(noticeImage({ ...n, title: '관련 없는 새 공지' }, '2026-10-31'), '');
    assert.equal(noticeImage({ ...n, source_url: 'https://example.test/event' }, '2026-10-31'), '');
    assert.equal(noticeImage({ ...n, end_date: '2027-12-31' }, '2026-10-31'), '');
    assert.equal(noticeImage(n, '2027-01-01'), '');
  }
  assert.ok(total < 600000, '공식 썸네일 8장의 원본 합계는 600KB 미만');
});
