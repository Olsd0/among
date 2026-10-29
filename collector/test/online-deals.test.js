import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../web/online-deals.js', import.meta.url), 'utf8');
const { onlineDealUrl, normalizeOnlineDeal, normalizeOnlineDeals, onlineDealCard, ONLINE_DEALS_MAX_AGE } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const now = Date.parse('2026-10-29T12:00:00+09:00');
const item = (changes = {}) => ({ id: 'test-only', title: '테스트 식품', unit: '200g × 2개', price: 3000, conditions: ['와우회원 가격', '배송비 별도 확인'], checkedAt: '2026-10-29T11:00:00+09:00', expiresAt: '2026-10-29T23:59:59+09:00', url: 'https://www.coupang.com/vp/products/123', sourceUrl: 'https://www.coupang.com/vp/products/123', affiliate: false, ...changes });

test('links require exact HTTPS Coupang hosts and contain no credentials or personal coupon data', () => {
  assert.equal(onlineDealUrl('https://www.coupang.com/np/goldbox'), 'https://www.coupang.com/np/goldbox');
  const valid = 'https://link.coupang.com/a/example?subId=among';
  assert.equal(onlineDealUrl(valid), valid);
  assert.equal(onlineDealUrl(valid, true), '');
  for (const url of ['javascript:alert(1)', 'http://www.coupang.com/', 'https://coupang.com.attacker.test/', 'https://user:pass@www.coupang.com/', 'https://www.coupang.com:8443/', 'https://www.coupang.com/?%74oken=secret', 'https://www.coupang.com/?coupon_code=abc', 'https://www.coupang.com\\@attacker.test/']) assert.equal(onlineDealUrl(url), '', url);
});

test('publishing requires exact price, unit, conditions, source and recent timestamp', () => {
  const valid = normalizeOnlineDeal(item(), now);
  assert.equal(valid.price, 3000); assert.equal(valid.unit, '200g × 2개');
  for (const over of [{ price: '3000' }, { price: -1 }, { price: 0 }, { price: 3.1 }, { unit: '' }, { conditions: [] }, { sourceUrl: '' }, { checkedAt: '2026-10-29T13:00:00+09:00' }, { checkedAt: '2026-10-29' }, { expiresAt: '미확인' }]) assert.equal(normalizeOnlineDeal(item(over), now), null, JSON.stringify(over));
  assert.equal(normalizeOnlineDeal(item({ conditions: ['조건', ''] }), now), null);
  assert.equal(normalizeOnlineDeal(item({ conditions: ['조건'.repeat(200)] }), now), null);
});

test('prices expire at their stated expiry or after 24 hours, whichever comes first', () => {
  assert.equal(normalizeOnlineDeal(item({ expiresAt: '2026-10-29T12:00:00+09:00' }), now), null);
  assert.equal(normalizeOnlineDeal(item({ checkedAt: '2026-10-28T12:00:00+09:00' }), now), null);
  assert.equal(normalizeOnlineDeal(item({ expiresAt: '2026-11-01T00:00:00+09:00' }), now).validUntil, Date.parse(item().checkedAt) + ONLINE_DEALS_MAX_AGE);
  assert.equal(normalizeOnlineDeal(item({ checkedAt: '2026-10-28T12:00:01+09:00' }), now).price, 3000);
});

test('safe cards escape facts, do not invent discount rates, and disclose affiliate destinations', () => {
  const card = onlineDealCard(normalizeOnlineDeal(item({ title: '<script>bad</script>', conditions: ['<img onerror=bad()>'], imageUrl: 'https://attacker.test/pixel.png' }), now));
  assert.match(card, /3000원/); assert.doesNotMatch(card, /3,000|할인율|<script>|<img onerror|attacker/);
  assert.match(card, /&lt;script&gt;bad/); assert.doesNotMatch(card, /제휴광고|sponsored/);
  const affiliate = normalizeOnlineDeal(item({ url: 'https://link.coupang.com/a/example' }), now);
  assert.equal(affiliate.affiliate, true); assert.match(onlineDealCard(affiliate), /제휴광고/); assert.match(onlineDealCard(affiliate), /rel="sponsored noopener noreferrer"/);
  assert.equal(normalizeOnlineDeal(item({ url: 'https://www.coupang.com/vp/products/123?lptag=AF123' }), now).affiliate, true);
  const affiliateSource = normalizeOnlineDeal(item({ sourceUrl: 'https://www.coupang.com/vp/products/123?lpTag=AF123' }), now);
  assert.equal(affiliateSource.affiliate, true);
  assert.equal((onlineDealCard(affiliateSource).match(/rel="sponsored noopener noreferrer"/g) || []).length, 2);
});

test('list is bounded, deduplicated and rejects malformed feeds', () => {
  const rows = [item(), item(), ...Array.from({ length: 20 }, (_, i) => item({ id: `test-${i}` }))];
  assert.equal(normalizeOnlineDeals({ items: rows }, now).length, 10);
  assert.equal(normalizeOnlineDeals({ items: [item({ price: null })] }, now).length, 0);
  assert.throws(() => normalizeOnlineDeals({ error: true }, now));
});
