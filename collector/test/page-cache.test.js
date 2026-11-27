// 11/16 수집 최적화: 그대로인 페이지는 AI에게 다시 읽히지 않는다 (최대 3일)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PageCache, pageKey, listKey } from '../src/page-cache.js';

const page = { text: '와퍼 3,900원 11/30까지', images: [{ src: 'https://a.test/1.jpg' }] };
const ext = { coupons: [{ menu: '와퍼' }], news: [], page_kind: 'list', notes: '', usage: { input_tokens: 900, output_tokens: 80 }, truncated: false };
const day = (n) => new Date(Date.UTC(2026, 10, 16 + n));

test('글자나 이미지 주소, 브랜드, 모델이 바뀌면 지문이 달라진다', () => {
  const k = pageKey(page, { model: 'm', brand: 'A' });
  assert.equal(k, pageKey({ ...page }, { model: 'm', brand: 'A' }));
  assert.notEqual(k, pageKey({ ...page, text: '와퍼 4,900원 11/30까지' }, { model: 'm', brand: 'A' }));
  assert.notEqual(k, pageKey({ ...page, images: [{ src: 'https://a.test/2.jpg' }] }, { model: 'm', brand: 'A' }));
  assert.notEqual(k, pageKey(page, { model: 'm2', brand: 'A' }));
  assert.notEqual(k, pageKey(page, { model: 'm', brand: 'B' }));
});

test('같은 페이지는 3일 동안 다시 쓰고, 그 뒤에는 다시 읽는다 (파일로 이어짐)', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'pc-')), 'sub', 'pages.json');
  const a = new PageCache(file);
  const k = pageKey(page, { model: 'm' });
  assert.equal(a.get('https://a.test/e', k, day(0)), null);
  a.set('https://a.test/e', k, ext, day(0));
  a.save(day(0));
  assert.doesNotMatch(readFileSync(file, 'utf8'), /input_tokens/);

  const b = new PageCache(file);
  const hit = b.get('https://a.test/e', k, day(2));
  assert.deepEqual(hit.coupons, ext.coupons);
  assert.deepEqual(hit.usage, { input_tokens: 0, output_tokens: 0 });
  hit.coupons[0].menu = '바뀜';
  assert.equal(b.get('https://a.test/e', k, day(2)).coupons[0].menu, '와퍼', '돌려준 결과를 고쳐도 기록은 그대로');
  assert.equal(b.get('https://a.test/e', 'other', day(1)), null, '내용이 바뀌면 다시 읽음');
  b.set('https://a.test/e', k, hit, day(2));  // 다시 쓴 결과로는 읽은 날을 늘리지 않는다
  assert.equal(b.get('https://a.test/e', k, day(3)), null, '3일 뒤에는 다시 읽음');
  assert.equal(b.hits, 2);
});

test('잘린 응답은 기록하지 않고, 깨진 파일은 빈 기록으로 시작한다', () => {
  const c = new PageCache('');
  c.set('u', 'k', { ...ext, truncated: true }, day(0));
  assert.equal(c.get('u', 'k', day(0)), null);
  assert.deepEqual(new PageCache(join(tmpdir(), 'no-such-file-xyz.json')).entries, {});
});

test('목록 지문 (11/27 바로 확인): 회전 배너 순서는 같게, 글자·새 글·출처 설정이 바뀌면 다르게', () => {
  const src = { id: 'bk', url: 'https://a.test/list', brand: '버거킹', selector: 'main' };
  const list = { text: '이벤트 목록\n와퍼 3,900원', images: [{ src: 'https://a.test/1.jpg' }, { src: 'https://a.test/2.jpg' }], links: ['https://a.test/e/1'], posts: [{ href: 'https://a.test/e/1' }] };
  const k = listKey(list, src);
  assert.equal(k, listKey({ ...list, images: [...list.images].reverse() }, src), '사진 순서만 바뀐 회전 배너는 같다');
  assert.notEqual(k, listKey({ ...list, text: list.text + '\n치즈와퍼 1+1' }, src));
  assert.notEqual(k, listKey({ ...list, links: [...list.links, 'https://a.test/e/2'] }, src));
  assert.notEqual(k, listKey({ ...list, posts: [{ href: 'https://a.test/e/2' }] }, src));
  assert.notEqual(k, listKey(list, { ...src, selector: '#event' }), '출처 설정을 고치면 다시 수집');
  assert.ok(!('screenshots' in list));
});

test('목록 지문 기억: 24시간 안의 성공 수집과 같을 때만 건너뛰고, 파일로 이어진다', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'pc-')), 'pages.json');
  const a = new PageCache(file);
  const h = (n) => new Date(Date.UTC(2026, 10, 27, n));
  assert.equal(a.listUnchanged('bk', 'k1', h(1)), false, '기억이 없으면 수집');
  a.rememberList('bk', 'k1', h(0));
  a.save(h(0));
  const b = new PageCache(file);
  assert.equal(b.listUnchanged('bk', 'k1', h(5)), true);
  assert.equal(b.listUnchanged('bk', 'k2', h(5)), false, '목록이 바뀌면 수집');
  assert.equal(b.listUnchanged('bk', '', h(5)), false);
  assert.equal(b.listUnchanged('bk', 'k1', new Date(h(0) - 3600000)), false, '시각이 거꾸로면 수집');
  assert.equal(b.listUnchanged('bk', 'k1', h(25)), false, '하루가 지나면 수집');
  b.save(new Date(Date.UTC(2026, 10, 30, 1)));
  assert.deepEqual(new PageCache(file).lists, {}, '3일 지난 기억은 지운다');
});
