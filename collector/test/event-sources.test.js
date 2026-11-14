import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairEventSources, NPAY_FNB_URL } from '../src/event-sources.js';

const source = (o = {}) => ({
  id: 'npay-cafe', active: 'TRUE', url: 'https://campaign2.naver.com/npay/cafe/',
  official_link: 'https://campaign2.naver.com/npay/cafe/', program: '네이버페이', max_follow: 0, follow: '',
  wait_ms: 2000, max_shots: 4, ...o,
});

test('이전 카페 캠페인과 일반 결제 목록을 음식·카페 목록 및 상세 확인으로 바꾼다', () => {
  for (const url of ['https://campaign2.naver.com/npay/cafe/', 'https://pay.naver.com/benefit/payment/list', NPAY_FNB_URL]) {
    const original = source({ url });
    const before = structuredClone(original);
    const [result] = repairEventSources([original]);
    assert.equal(result.url, NPAY_FNB_URL);
    assert.equal(result.official_link, NPAY_FNB_URL);
    assert.equal(result.follow, "a[href*='/benefit/payment/detail/']");
    assert.equal(result.max_follow, 8);
    assert.equal(result.program, original.program);
    assert.equal(result.wait_ms, original.wait_ms);
    assert.equal(result.max_shots, original.max_shots);
    assert.deepEqual(original, before);
  }
});

test('명시적으로 비활성화한 출처는 재활성화하거나 설정을 바꾸지 않는다', () => {
  for (const active of [false, 0, 'FALSE', 'false', '0', 'N', 'no', 'off', '중지', ' FALSE ']) {
    const original = source({ active });
    assert.equal(repairEventSources([original])[0], original);
  }
});

test('알 수 없는 주소·다른 출처·네이버처럼 보이는 외부 호스트를 보정하지 않는다', () => {
  const examples = [
    source({ id: 'other' }), source({ url: 'https://example.com/events' }),
    source({ url: 'https://pay.naver.com.evil.test/benefit/payment/list' }),
    source({ url: 'https://pay.naver.com/benefit/payment/detail/123' }),
    source({ url: 'http://pay.naver.com/benefit/payment/list' }),
    source({ url: 'https://user:secret@pay.naver.com/benefit/payment/list' }),
  ];
  assert.deepEqual(repairEventSources(examples), examples);
});

test('상세 확인은 8개 이내로 제한하고 기존 프로그램·사용자 필터를 보존한다', () => {
  for (const [input, expected] of [[0, 8], ['', 8], [undefined, 8], [-1, 8], [3, 3], ['4', 4], [99, 8], [2.5, 2]]) {
    const [result] = repairEventSources([source({ max_follow: input, program: '네이버페이,해피포인트', follow_text: '던킨|설빙' })]);
    assert.equal(result.max_follow, expected);
    assert.equal(result.program, '네이버페이,해피포인트');
    assert.equal(result.follow_text, '던킨|설빙');
  }
  const input = repairEventSources([source()]);
  assert.deepEqual(repairEventSources(input), input, '반복 보정 결과가 같다');
});
