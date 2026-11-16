// 11/16 대표 지적: 스타벅스 핫딜이 그 이벤트 글이 아니라 이벤트 게시판으로만 열리고 설명이 부족함
import test from 'node:test';
import assert from 'node:assert/strict';
import { postLinkFor, mergeNews } from '../src/engine.js';
import { postRuleFor } from '../src/fetch.js';

const V = 'https://www.starbucks.co.kr/whats_new/campaign_view.do?pro_seq=';
const LIST = 'https://www.starbucks.co.kr/whats_new/campaign_list.do';
// 11/16 실제 목록 글자
const posts = [
  { href: V + '3627', text: '딜리버스 Special hour 할인 혜택 딜리버스 Special hour 할인 혜택 2026-11-09 ~ 2026-11-30' },
  { href: V + '3615', text: '딜리버스 만원 별 더블 적립 이벤트 2026-11-01 ~ 2026-11-30' },
  { href: V + '3610', text: '스타벅스 신한카드 청구할인 프로모션 2026-11-01 ~ 2026-11-30' },
  { href: V + '3609', text: '스타벅스 신한카드 11월 혜택 2026-11-01 ~ 2026-11-30' },
  { href: V + '3634', text: '스타벅스 카드 충전 이벤트 2026-11-16 ~ 2026-11-29' },
  { href: V + '3499', text: '중요2026 WINTER e-FREQUENCY 이벤트 안내 2026-10-22 ~ 2026-12-31' },
];

test('스타벅스 목록 주소에만 글 주소 규칙이 있다', () => {
  assert.equal(postRuleFor(LIST).attr, 'prod');
  assert.equal(postRuleFor(LIST + '?menu_cd=STB2812').attr, 'prod');
  assert.equal(postRuleFor('https://www.starbucks.co.kr/menu/drink_list.do'), null);
  assert.equal(postRuleFor('https://evil.example/whats_new/campaign_list.do'), null);
});

test('공지 제목에 맞는 행사 글 주소를 고른다', () => {
  assert.equal(postLinkFor({ title: '스타벅스 딜리버스 Special hour 할인', evidence: '딜리버스 Special hour 할인 혜택 2026-11-09' }, posts), V + '3627');
  assert.equal(postLinkFor({ title: '딜리버스 만원 이상 별 더블 적립', evidence: '딜리버스 만원 별 더블 적립 이벤트' }, posts), V + '3615');
  assert.equal(postLinkFor({ title: '스타벅스 카드 충전 이벤트', evidence: '' }, posts), V + '3634');
  assert.equal(postLinkFor({ title: '2026 윈터 e-프리퀀시', evidence: '2026 WINTER e-FREQUENCY 이벤트 안내' }, posts), V + '3499');
});

test('맞는 글이 없거나 헷갈리면 고르지 않는다 (틀린 글로 보내지 않음)', () => {
  assert.equal(postLinkFor({ title: '스타벅스 삼성카드 혜택', evidence: '' }, posts), '');
  assert.equal(postLinkFor({ title: '스타벅스 신한카드 혜택', evidence: '' }, posts), V + '3609');
  assert.equal(postLinkFor({ title: '아메리카노 1+1', evidence: '' }, posts), '');
  assert.equal(postLinkFor({ title: '딜리버스 할인', evidence: '' }, []), '');
  // 신한카드 글 둘 중 낱말이 더 맞는 쪽
  assert.equal(postLinkFor({ title: '스타벅스 신한카드 청구할인', evidence: '스타벅스 신한카드 청구할인 프로모션' }, posts), V + '3610');
});

test('목록·상세에서 따로 읽은 같은 공지: 원문은 행사 글, 설명은 자세한 쪽', () => {
  const base = { brand: '스타벅스', status: 'published', end_date: '2026-11-30', related_ids: [], programs: [], source_id: 'starbucks-event', official_link: LIST, confidence: 0.9 };
  const list = { ...base, title: '딜리버스 Special hour 할인', summary: '딜리버스 할인 행사.', discount_label: '3천원', source_url: LIST };
  const detail = { ...base, title: '딜리버스 Special hour 할인 혜택', summary: '11월 30일까지 평일 오후 2~5시에 딜리버스로 1만 5천원 이상 주문하면 3천원을 할인해요.', discount_label: '', source_url: V + '3627' };
  const [m] = mergeNews([list, detail]);
  assert.equal(m.source_url, V + '3627');
  assert.match(m.summary, /평일 오후/);
  assert.equal(m.discount_label, '3천원');
});
