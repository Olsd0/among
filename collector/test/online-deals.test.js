// 온라인 특가 화면 모듈 (web/online-deals.js) — 서버 응답 재검사와 카드 문구
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOnlineDeals, onlineDealCard, shortcutLinks, shortcutSearchUrl, OD_SHORTCUTS, foodBestFrame } from '../../web/online-deals.js';
import { odLink } from '../../web/online-deals-core.js?v=20261105-2';

const now = Date.parse('2026-11-05T12:00:00+09:00');
const iso = t => new Date(t).toISOString();
const item = (changes = {}) => ({
  id: 'od_test0000001', supplier: 'coupang', store: '쿠팡', title: '테스트 식품', option: '200g × 2개', seller: '테스트 판매자',
  price: 3000, membership: '', conditions: ['테스트 조건'], shipping: 'unknown', shippingFee: null, shippingThreshold: null,
  category: 'food', url: 'https://link.coupang.com/a/test', imageUrl: '', affiliate: true, pick: '',
  checkedAt: iso(now - 3600e3), endsAt: '', visibleUntil: iso(now + 5 * 3600e3), ...changes,
});

test('응답 재검사: 형식·기한·링크가 맞지 않으면 빼고, 중복을 없애고, 잘못된 응답은 오류', () => {
  assert.equal(normalizeOnlineDeals({ items: [item()] }, now).length, 1);
  const bad = [{ price: '3000' }, { price: 0 }, { url: 'https://evil.test/' }, { url: 'http://www.coupang.com/' }, { visibleUntil: iso(now) },
    { visibleUntil: iso(now + 30 * 3600e3) }, { checkedAt: '2026-11-05' }, { conditions: [''] }, { conditions: ['x'.repeat(301)] }, { id: 'x' }, { supplier: 'mystery' }, { endsAt: iso(now - 1) }];
  for (const over of bad) assert.equal(normalizeOnlineDeals({ items: [item(over)] }, now).length, 0, JSON.stringify(over));
  const many = [item(), item(), ...Array.from({ length: 80 }, (_, i) => item({ id: `od_test${String(i).padStart(7, '0')}` }))];
  assert.equal(normalizeOnlineDeals({ items: many }, now).length, 60);
  assert.throws(() => normalizeOnlineDeals({ error: true }, now));
  assert.throws(() => normalizeOnlineDeals(null, now));
});

test('카드: 사실만 표시 (확인 당시 가격·배송비·조건·판매자), 최저가·할인율·쉼표 없음, 이스케이프', () => {
  const [it] = normalizeOnlineDeals({ items: [item({ title: '<script>bad</script>', conditions: ['<img onerror=bad()>'], membership: '와우회원', pick: '골드박스', endsAt: iso(now + 3600e3) })] }, now);
  const card = onlineDealCard(it);
  assert.match(card, /<b>3000원<\/b><span class="what">확인 당시 가격<\/span>/);
  assert.match(card, /class="ticket od-ticket"/, '메인 쿠폰과 같은 티켓 모양');
  assert.match(card, /배송비 확인 필요/);
  assert.doesNotMatch(card, /무료배송|최저가|할인율|3,000|<script>|<img onerror/);
  assert.match(card, /&lt;script&gt;bad/);
  assert.match(card, /<li>와우회원 가격<\/li>/);
  assert.match(card, /판매자 테스트 판매자/);
  assert.match(card, /골드박스/);
  assert.match(card, /종료/);
  assert.match(card, /제휴광고/);
  assert.match(card, /rel="sponsored noopener noreferrer"/);
  assert.match(card, /쿠팡에서 가격 확인/);
  assert.doesNotMatch(card, /<img/, '사진 이용 범위 확인 전에는 사진 없음');
  const [free] = normalizeOnlineDeals({ items: [item({ shipping: 'free', affiliate: false, url: 'https://www.coupang.com/vp/products/1' })] }, now);
  assert.match(onlineDealCard(free), /무료배송/);
  assert.doesNotMatch(onlineDealCard(free), /제휴광고|sponsored/);
  const [conditional] = normalizeOnlineDeals({ items: [item({ shipping: 'conditional', shippingThreshold: 19800 })] }, now);
  assert.match(onlineDealCard(conditional), /19800원 이상 구매 시 무료배송/);
});

test('항목별 바로가기: 쿠팡 검색 결과 일반 링크가 기본, AMONG 파트너스 링크만 덮어쓸 수 있다', () => {
  const flat = groups => groups.flatMap(g => g.items);
  const plain = flat(shortcutLinks());
  assert.deepEqual(OD_SHORTCUTS.map(g => g.group), ['먹거리'], '11/06 대표 결정: 먹거리만');
  assert.deepEqual(plain.map(i => i.label), ['생수', '라면', '즉석밥', '냉동 간편식', '레토르트', '닭가슴살', '단백질', '통조림']);
  for (const i of plain) {
    assert.equal(i.url, shortcutSearchUrl(i.label));
    assert.equal(odLink(i.url, 'coupang'), i.url, '허용 링크 형식');
    assert.equal(i.affiliate, false);
  }
  assert.equal(shortcutSearchUrl('냉동 간편식'), 'https://www.coupang.com/np/search?q=%EB%83%89%EB%8F%99%20%EA%B0%84%ED%8E%B8%EC%8B%9D');
  const own = flat(shortcutLinks({ water: 'https://link.coupang.com/a/among-water', ramen: 'https://www.coupang.com/np/search?q=x&lptag=AF0000001', rice: 'https://evil.test/a', retort: 42 }));
  assert.deepEqual(own.slice(0, 5).map(i => [i.key, i.affiliate, i.url]), [
    ['water', true, 'https://link.coupang.com/a/among-water'],
    ['ramen', false, shortcutSearchUrl('라면')],
    ['rice', false, shortcutSearchUrl('즉석밥')],
    ['frozen', false, shortcutSearchUrl('냉동 간편식')],
    ['retort', false, shortcutSearchUrl('레토르트')],
  ]);
  assert.equal(flat(shortcutLinks(null)).length, 8);
});

test('쿠팡 식품 베스트: 한국 날짜로 시작일부터, 정해진 같은 사이트 페이지만', () => {
  const cfg = { page: 'coupang-widget.html', from: '2026-11-16' };
  assert.equal(foodBestFrame(cfg, Date.parse('2026-11-15T23:59:00+09:00')), '');
  assert.equal(foodBestFrame(cfg, Date.parse('2026-11-16T00:00:00+09:00')), 'coupang-widget.html');
  assert.equal(foodBestFrame({ ...cfg, page: 'https://evil.example/x.html' }, Date.parse('2026-12-01T00:00:00+09:00')), '');
  assert.equal(foodBestFrame({ page: 'coupang-widget.html' }, Date.now()), '', '시작일 없으면 보이지 않음');
  assert.equal(foodBestFrame(null), '');
});
