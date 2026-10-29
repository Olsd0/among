import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { noticePhoto, noticeImage } from '../src/notice-images.js';
import { productImage } from '../src/product-images.js';

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
