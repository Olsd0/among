import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the actual browser helpers without starting the app or making any
// network requests. Keep the safety boundary in app.js rather than duplicating it.
const app = readFileSync(new URL('../../web/app.js', import.meta.url), 'utf8');
const safeImgCode = app.slice(app.indexOf('const safeImg ='), app.indexOf('const phFail ='));
const visualCode = app.slice(app.indexOf('function noticeVisual('), app.indexOf('function couponVisual('));
const location = { href: 'https://www.amongpick.com/index.html?n=example', origin: 'https://www.amongpick.com' };
const safeImg = runInNewContext(`${safeImgCode}\nsafeImg`, { URL, location });
function noticeVisual(verified = null) {
  return runInNewContext(`${visualCode}\nnoticeVisual`, {
    safeImg, noticePhoto: () => verified,
    relatedCoupons: () => [], brandPhoto: () => ({ url: 'https://brand.example/menu.jpg' }),
    asVisual: (p) => ({ src: p.url, official: false }),
  });
}

test('official event files resolve to the current origin with a narrow local path allowlist', () => {
  for (const ext of ['webp', 'jpg', 'png']) {
    assert.equal(safeImg(`./event-images/npay-dunkin-20261114.${ext}`), `https://www.amongpick.com/event-images/npay-dunkin-20261114.${ext}`);
  }
  assert.equal(safeImg('https://brand.example/event/poster.png'), 'https://brand.example/event/poster.png');
  const local = runInNewContext(`${safeImgCode}\nsafeImg`, {
    URL, location: { href: 'http://127.0.0.1:8080/index.html', origin: 'http://127.0.0.1:8080' },
  });
  assert.equal(local('./event-images/official-capture.webp'), 'http://127.0.0.1:8080/event-images/official-capture.webp');
  assert.equal(local(local('./event-images/official-capture.webp')), local('./event-images/official-capture.webp'), 'state.news and noticeVisual may safely validate the same image twice');
  for (const value of [
    'http://127.0.0.1:8081/event-images/a.webp', 'http://elsewhere.example/event-images/a.webp',
    'http://127.0.0.1:8080/assets/a.webp', 'http://127.0.0.1:8080/event-images/../event-images/a.webp',
    'http://127.0.0.1:8080/event-images/a.webp?x=1', 'http://127.0.0.1:8080/event-images/a.webp#x',
    'http://127.0.0.1:8080/event-images/%61.webp', 'http://127.0.0.1:8080/event-images/a.svg',
  ]) assert.equal(local(value), '', value);
  assert.equal(safeImg(safeImg('./event-images/official-capture.webp')), safeImg('./event-images/official-capture.webp'));
});

test('image validation rejects traversal, unapproved local files, and unsafe URL protocols', () => {
  for (const value of [
    './event-images/../secret.png', './event-images/%2e%2e/secret.png', './event-images/a/../../secret.png',
    './event-images/a%2f..%2fsecret.png', './event-images/a\\..\\secret.png',
    '/event-images/a.webp', 'event-images/a.webp', '../event-images/a.webp', './assets/a.webp',
    './event-images/a.svg', './event-images/a.webp?x=1', './event-images/a.webp#x',
    '//evil.example/a.webp', 'http://evil.example/a.webp', 'javascript:alert(1)', 'data:image/png;base64,AA==',
    'file:///event-images/a.webp', '', null,
  ]) assert.equal(safeImg(value), '', String(value));
});

test('official page captures use the card and detail files and are identified as captures', () => {
  const visual = noticeVisual();
  const item = {
    brand: '던킨', notice_only: true, image_kind: 'official_capture',
    image_url: './event-images/npay-dunkin-card.webp', detail_image_url: './event-images/npay-dunkin-detail.webp',
  };
  const card = visual(item);
  const detail = visual(item, true);
  assert.equal(card.src, 'https://www.amongpick.com/event-images/npay-dunkin-card.webp');
  assert.equal(detail.src, 'https://www.amongpick.com/event-images/npay-dunkin-detail.webp');
  for (const image of [card, detail]) {
    assert.equal(image.label, '공식 페이지 캡처');
    assert.equal(image.alt, '던킨 공식 페이지 캡처');
    assert.equal(image.capture, true);
    assert.equal(image.official, true);
    assert.equal(image.fallback, null, 'notice-only events never fall back to a representative menu photo');
  }
  assert.equal(visual({ ...item, detail_image_url: '' }, true).src, card.src);
  assert.equal(visual({ ...item, image_url: '', detail_image_url: '' }), null);
});

test('official posters retain their labels and verified registry detail images retain precedence', () => {
  const item = { brand: '던킨', notice_only: true, image_url: './event-images/dunkin-poster.webp', image_kind: 'official_poster' };
  const poster = noticeVisual()(item, true);
  assert.equal(poster.label, '공식 공지 이미지');
  assert.equal(poster.capture, false);
  const registry = noticeVisual({ image: 'https://brand.example/card.jpg', detailImage: 'https://brand.example/poster.png' });
  const detail = registry({ ...item, image_kind: 'official_capture', detail_image_url: './event-images/dunkin-detail.webp' }, true);
  assert.equal(detail.src, 'https://brand.example/poster.png');
  assert.equal(detail.label, '공식 공지 이미지');
  assert.equal(detail.capture, false);
});

test('official related product and place images are distinguished from event posters', () => {
  const item = {
    brand: 'HANS', notice_only: true, image_kind: 'official_related',
    image_url: './event-images/hans-cake.webp', detail_image_url: './event-images/hans-cake-detail.webp',
  };
  for (const detail of [false, true]) {
    const image = noticeVisual()(item, detail);
    assert.equal(image.label, '공식 관련 이미지');
    assert.equal(image.alt, 'HANS 공식 관련 이미지');
    assert.equal(image.related, true);
    assert.equal(image.capture, false);
    assert.equal(image.official, true);
  }
  const registry = noticeVisual({ image: 'https://brand.example/card.jpg', detailImage: 'https://brand.example/poster.png' });
  const detail = registry(item, true);
  assert.equal(detail.src, 'https://brand.example/poster.png');
  assert.equal(detail.label, '공식 공지 이미지');
  assert.equal(detail.related, false);
  const card = registry({ ...item, image_url: 'https://brand.example/card.jpg' });
  assert.equal(card.label, '공식 공지 이미지');
  assert.equal(card.related, false, 'a registry poster selected by the engine does not inherit the replaced related-image label');
});
