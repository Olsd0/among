import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparePages, PUBLIC_PAGES } from '../scripts/prepare-pages.js';
import { compareDiscounts } from '../../web/guide-calculator.js';
import { activeSponsor } from '../../web/sponsor.js';

test('AdSense 소유권 확인은 실제 형식의 ID로만 생성하고 루트 도메인에서 ads.txt를 만든다', t => {
  const dir = mkdtempSync(join(tmpdir(), 'among-launch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const page of PUBLIC_PAGES) copyFileSync(new URL(`../../web/${page}`, import.meta.url), join(dir, page));
  // 테스트용 ID. 실제 사이트나 설정에 저장하지 않는다.
  const options = { publisherId: 'ca-pub-1234567890123456', contactEmail: 'hello@example.com' };
  preparePages(dir, 'https://among.example/', options);
  assert.equal(readFileSync(join(dir, 'ads.txt'), 'utf8'), 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
  for (const page of PUBLIC_PAGES) {
    const html = readFileSync(join(dir, page), 'utf8');
    assert.match(html, /name="google-adsense-account" content="ca-pub-1234567890123456"/);
    assert.doesNotMatch(html, /adsbygoogle|googlesyndication/);
  }
  assert.match(readFileSync(join(dir, 'partners.html'), 'utf8'), /mailto:hello@example.com/);
  const first = readFileSync(join(dir, 'partners.html'), 'utf8');
  preparePages(dir, 'https://among.example/', options);
  assert.equal(readFileSync(join(dir, 'partners.html'), 'utf8'), first);
  preparePages(dir, 'https://olsd0.github.io/among/', options);
  assert.equal(existsSync(join(dir, 'ads.txt')), false);
  preparePages(dir, 'https://among.example/');
  assert.doesNotMatch(readFileSync(join(dir, 'partners.html'), 'utf8'), /google-adsense-account|hello@example.com/);
  for (const publisherId of ['pub-1234567890123456', 'ca-pub-123', 'ca-pub-1234567890123456"><script>']) assert.throws(() => preparePages(dir, 'https://among.example/', { publisherId }));
  assert.throws(() => preparePages(dir, 'https://among.example/', { contactEmail: 'a@example.com\nBcc:attacker@example.com' }));
});

test('할인 비교는 한도·초과 할인·원 미만 버림을 적용하고 잘못된 입력을 거부한다', () => {
  assert.deepEqual(compareDiscounts({ amount: 15000, fixed: 3000, rate: 30, cap: 2000 }), { fixedPayment: 12000, ratePayment: 13000, difference: 1000 });
  assert.deepEqual(compareDiscounts({ amount: 101, fixed: 200, rate: 50, cap: 0 }), { fixedPayment: 0, ratePayment: 51, difference: 51 });
  for (const bad of [{amount:0}, {amount:1.5}, {fixed:-1}, {rate:101}, {rate:NaN}, {cap:Infinity}]) assert.equal(compareDiscounts({ amount: 10000, fixed: 0, rate: 10, cap: 0, ...bad }), null);
});

test('직접 광고는 계약 기간·명시적 활성화·HTTPS 목적지가 모두 유효할 때만 게시된다', () => {
  const sponsor = { enabled: true, advertiser: '테스트 광고주', title: '테스트 제목', description: '테스트 광고 문구', url: 'https://example.com/offer', startsAt: '2026-10-01T00:00:00+09:00', endsAt: '2026-11-01T00:00:00+09:00' };
  const now = Date.parse('2026-10-31T00:00:00+09:00');
  assert.ok(activeSponsor(sponsor, now));
  assert.equal(activeSponsor(sponsor, Date.parse(sponsor.endsAt)), null);
  assert.equal(activeSponsor(sponsor, Date.parse(sponsor.startsAt)-1), null);
  for (const change of [{enabled:false}, {advertiser:''}, {startsAt:'2026-10-01'}, {endsAt:'invalid'}, {url:'javascript:alert(1)'}, {url:'http://example.com'}, {url:'https://user:secret@example.com'}, {url:'https://example.com\\evil'}]) assert.equal(activeSponsor({...sponsor, ...change}, now), null);
});
