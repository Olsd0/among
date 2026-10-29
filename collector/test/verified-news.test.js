import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifiedNews, withVerifiedNews } from '../src/verified-news.js';
import { noticePhoto } from '../src/notice-images.js';
import { pickHeadlines, verificationStatus } from '../src/engine.js';
const n = verifiedNews.find((x) => x.brand === '설빙');
const shake = verifiedNews.find((x) => x.brand === '쉐이크쉑');
const sulbingOnly = (items) => items.filter((x) => x.brand === '설빙');

test('설빙 적립 공지는 확인한 기간 안에서만 보완하고 확인 시각을 갱신하지 않는다', () => {
  assert.equal(sulbingOnly(withVerifiedNews([], '2026-10-27')).length, 0);
  assert.equal(sulbingOnly(withVerifiedNews([], '2026-10-28'))[0].id, n.id);
  assert.equal(withVerifiedNews([], '2026-11-01')[0].id, n.id);
  assert.equal(withVerifiedNews([n], '2026-11-02').length, 0);
  assert.equal(sulbingOnly(withVerifiedNews([], '2026-10-30'))[0].checked_at, n.checked_at);
  assert.equal(verificationStatus(n.checked_at, new Date(Date.parse(n.checked_at) + 49 * 3600e3)), 'stale');
  assert.equal(n.discount_label, '50% 적립');
  assert.match(n.summary, /9900원.*50%.*포인트.*30000원.*카드/);
  assert.equal(n.coupon_price, undefined, '적립으로 결제액을 낮춰 표시하지 않는다');
});
test('같은 기간에 자동 수집한 네이버페이 행사는 중복 등록하지 않고 상태를 존중한다', () => {
  for (const status of ['published', 'pending', 'rejected']) {
    const collected = { ...n, id: 'collected', source_url: 'https://sulbing.com/index.php', status };
    assert.deepEqual(sulbingOnly(withVerifiedNews([collected], '2026-10-29')), [collected]);
  }
  const other = { ...n, id: 'other', start_date: '2026-10-15', end_date: '2026-10-31' };
  assert.equal(sulbingOnly(withVerifiedNews([other], '2026-10-29')).length, 2);
});
test('쿠폰에 연결되지 않은 50% 적립 행사도 기간 한정 핫딜로 노출된다', () => {
  const h = pickHeadlines([], [n], { today: '2026-10-29' });
  assert.equal(h[0].id, n.id);
  assert.equal(h[0].label, '50% 적립');
  assert.ok(h[0].score >= 80);
  assert.equal(pickHeadlines([], [n], { today: '2026-11-02' }).length, 0);
});

test('쉑버거 공식 링크·기간을 유지하고 공유 매개변수가 다른 수집 항목과 중복되지 않는다', () => {
  assert.equal(verifiedNews.filter((x) => x.brand === '쉐이크쉑').length, 1);
  assert.equal(shake.discount_label, '1+1');
  const url = new URL(shake.source_url);
  assert.equal(url.hostname, 'napi.happypointcard.com');
  assert.equal(url.searchParams.get('eventseq'), '7697c69cceaf1837b60334bd16728343');
  assert.ok(!withVerifiedNews([], '2026-10-25').some((x) => x.id === shake.id));
  assert.ok(withVerifiedNews([], '2026-10-30').some((x) => x.id === shake.id));
  assert.ok(!withVerifiedNews([shake], '2026-10-31').some((x) => x.id === shake.id));
  url.searchParams.delete('share');
  for (const status of ['published', 'pending', 'rejected']) {
    const collected = { ...shake, id: 'collected-shake', source_url: url.href, status };
    assert.deepEqual(withVerifiedNews([collected], '2026-10-29').filter((x) => x.brand === '쉐이크쉑'), [collected]);
  }
  assert.equal(noticePhoto(shake, '2026-10-29'), null, '공통 공유 로고를 해당 행사 포스터로 쓰지 않는다');
});
test('설빙 포스터는 변경하지 않은 공식 원본이며 웹과 수집기의 보완 목록은 같다', () => {
  const photo = noticePhoto(n, '2026-10-29');
  const data = readFileSync(new URL('../../web/' + photo.image, import.meta.url));
  assert.equal(photo.image, `assets/notices/sulbing-npay-${createHash('sha256').update(data).digest('hex').slice(0, 12)}.jpg`);
  assert.ok(data.length < 150000);
  assert.equal(readFileSync(new URL('../src/verified-news.js', import.meta.url), 'utf8'), readFileSync(new URL('../../web/verified-news.js', import.meta.url), 'utf8'));
});
