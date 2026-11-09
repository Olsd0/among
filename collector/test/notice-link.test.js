// 공지 원문 버튼 이름: 행사 상세 / 혜택·이벤트 목록 / 홈페이지를 구분한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { noticeLinkTarget } from '../src/engine.js';

test('T멤버십 공통 목록은 T멤버십 혜택 목록, 행사 상세는 공식 원문', () => {
  assert.deepEqual(noticeLinkTarget('https://m.tworld.co.kr/v6/benefit'), { kind: 'list', label: 'T멤버십 혜택 목록' });
  assert.deepEqual(noticeLinkTarget('https://m.tworld.co.kr/membership/benefit/brand/'), { kind: 'list', label: 'T멤버십 혜택 목록' });
  assert.deepEqual(noticeLinkTarget('https://www.kfckorea.com/promotion/promotionList/detail/1129'), { kind: 'detail', label: '공식 원문' });
  assert.deepEqual(noticeLinkTarget('https://www.pji.co.kr/event/ongoing/9640'), { kind: 'detail', label: '공식 원문' });
  assert.equal(noticeLinkTarget('https://www.pizzahut.co.kr/cs/event').label, '공식 이벤트 목록');
  assert.equal(noticeLinkTarget('https://www.mrpizza.co.kr/bbs/board.php?bo_table=event').kind, 'list');
  assert.equal(noticeLinkTarget('https://www.mrpizza.co.kr/bbs/board.php?bo_table=event&wr_id=21').kind, 'detail', '게시글 번호가 있으면 상세');
  assert.equal(noticeLinkTarget('https://www.twosome.co.kr/').kind, 'home');
  assert.equal(noticeLinkTarget('').kind, 'detail');
  assert.equal(noticeLinkTarget('not a url').label, '공식 원문');
});

test('수집 출처의 목록 주소는 모두 목록·홈페이지로 분류된다 (새 출처를 더하면 분류표도 갱신)', () => {
  const gs = readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8');
  const urls = [...gs.matchAll(/"(?:url|official_link)": "(https:[^"]+)"/g)].map((m) => m[1]);
  assert.ok(urls.length > 20);
  const missing = urls.filter((u) => noticeLinkTarget(u).kind === 'detail');
  assert.deepEqual(missing, []);
});
