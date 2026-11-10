// 11/10 대표 결정: "핫딜 공지 순서를 원래 기준보단 공지 최신순이랑 임박순으로 해줘. 상시는 뒤로."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickHeadlines, orderHeadlines, headlineGroup, noticeDay, compareHeadlines, HOT_SOON_DAYS } from '../src/engine.js';

const TODAY = '2026-11-10'; // 화요일
const n = (id, o = {}) => ({ id, status: 'published', brand: id, title: `${id} 30% 할인`, discount_label: '30%', programs: [], related_ids: [], first_seen: '2026-11-01T00:00:00Z', ...o });

test('그룹: 마감 임박(D-0~D-3) → 진행 중 → 시작 전 → 상시(끝나는 날 모름·요일 행사)', () => {
  assert.equal(HOT_SOON_DAYS, 3);
  assert.equal(headlineGroup({ end_date: '2026-11-10' }, TODAY), 0);
  assert.equal(headlineGroup({ end_date: '2026-11-13' }, TODAY), 0, 'D-3까지 임박');
  assert.equal(headlineGroup({ end_date: '2026-11-14' }, TODAY), 1, 'D-4부터 진행 중');
  assert.equal(headlineGroup({ start_date: '2026-11-12', end_date: '2026-11-12' }, TODAY), 2, '시작 전 하루 행사');
  assert.equal(headlineGroup({ end_date: null }, TODAY), 3);
  assert.equal(headlineGroup({ weekly: true, end_date: '2026-11-11' }, TODAY), 3, '요일 행사는 끝나는 날이 있어도 상시');
  const ids = pickHeadlines([], [
    n('always', { end_date: null, title: '와퍼 3900원 프로모션', discount_label: '3900원' }),
    n('later', { start_date: '2026-11-01', end_date: '2026-11-30' }),
    n('soon', { start_date: '2026-11-01', end_date: '2026-11-12' }),
    n('upcoming', { start_date: '2026-11-11', end_date: '2026-11-11', title: '11월 11일 두배로 데이', discount_label: '1+1' }),
    n('weekly', { title: '매주 화요일 1+1', discount_label: '1+1', end_date: null }),
  ], { today: TODAY, limit: 20 }).map((x) => x.id);
  assert.deepEqual(ids, ['soon', 'later', 'upcoming', 'weekly', 'always']);
});

test('마감 임박: 끝나는 날 빠른 순, 같으면 공지일(시작일·처음 본 날) 최근 순', () => {
  const ids = pickHeadlines([], [
    n('a', { start_date: '2026-11-01', end_date: '2026-11-12' }),
    n('b', { start_date: '2026-11-08', end_date: '2026-11-12' }),
    n('c', { start_date: '2026-11-05', end_date: '2026-11-10' }),
  ], { today: TODAY }).map((x) => x.id);
  assert.deepEqual(ids, ['c', 'b', 'a']);
});

test('진행 중: 공지일 최근 순, 같으면 끝나는 날 빠른 순. 시작일이 없으면 처음 본 날(KST)이 공지일', () => {
  assert.equal(noticeDay({ start_date: '2026-11-03' }, TODAY), '2026-11-03');
  assert.equal(noticeDay({ start_date: '2026-11-12', first_seen: '2026-11-09T16:00:00Z' }, TODAY), '2026-11-10', '시작 전이면 처음 본 날 (KST 날짜)');
  assert.equal(noticeDay({ first_seen: '2026-11-09T14:59:00Z' }, TODAY), '2026-11-09');
  const ids = pickHeadlines([], [
    n('old', { start_date: '2026-10-20', end_date: '2026-11-20' }),
    n('new-long', { start_date: '2026-11-08', end_date: '2026-12-20' }),
    n('new-short', { start_date: '2026-11-08', end_date: '2026-11-25' }),
    n('seen', { end_date: '2026-11-30', first_seen: '2026-11-09T01:00:00Z' }),
  ], { today: TODAY, limit: 20 }).map((x) => x.id);
  assert.deepEqual(ids, ['seen', 'new-short', 'new-long', 'old']);
});

test('시작 전은 시작일 순, 상시는 오늘 요일 행사 먼저 · 나머지는 공지일 최근 순', () => {
  const h = pickHeadlines([], [
    n('s2', { start_date: '2026-11-15', end_date: '2026-11-16' }),
    n('s1', { start_date: '2026-11-11', end_date: '2026-11-11', title: '11월 11일 데이', discount_label: '1+1' }),
    n('u-old', { end_date: null, title: '버거 2종 7,900원', discount_label: '7,900원', first_seen: '2026-11-01T00:00:00Z' }),
    n('u-new', { end_date: null, title: '와퍼 3900원 프로모션', discount_label: '3900원', first_seen: '2026-11-08T00:00:00Z' }),
    n('tue', { title: '매주 화요일 반값', discount_label: '반값', end_date: null, first_seen: '2026-10-01T00:00:00Z' }),
  ], { today: TODAY, limit: 20 });
  assert.deepEqual(h.map((x) => x.id), ['s1', 's2', 'tue', 'u-new', 'u-old']);
  assert.equal(h.find((x) => x.id === 'tue').reason, '오늘(화)만');
});

test('동점은 처음 본 시각 최근 순 → id 순으로 늘 같은 결과', () => {
  const base = { start_date: '2026-11-01', end_date: '2026-11-20' };
  const list = [n('b', { ...base, first_seen: '2026-11-02T00:00:00Z' }), n('a', { ...base, first_seen: '2026-11-02T00:00:00Z' }), n('c', { ...base, first_seen: '2026-11-03T00:00:00Z' })];
  assert.deepEqual(pickHeadlines([], list, { today: TODAY }).map((x) => x.id), ['c', 'a', 'b']);
  assert.deepEqual(pickHeadlines([], [...list].reverse(), { today: TODAY }).map((x) => x.id), ['c', 'a', 'b']);
});

test('그대로: 내 할인 수단으로 못 쓰는 것은 맨 뒤, 같은 브랜드 2장, 최대 8장, 할인 크기는 순서에 쓰지 않음', () => {
  const mine = n('mine', { start_date: '2026-11-01', end_date: '2026-11-30' });
  const skt = n('skt', { start_date: '2026-11-09', end_date: '2026-11-10', programs: ['SKT'] });
  assert.deepEqual(pickHeadlines([], [skt, mine], { today: TODAY, profile: { programs: ['KT'] } }).map((x) => x.id), ['mine', 'skt'], '오늘 끝나도 내가 못 쓰면 뒤로');
  const same = ['x1', 'x2', 'x3'].map((id, i) => n(id, { brand: '피자헛', end_date: `2026-11-1${i + 1}` }));
  assert.deepEqual(pickHeadlines([], same, { today: TODAY }).map((x) => x.id), ['x1', 'x2']);
  const many = Array.from({ length: 12 }, (_, i) => n(`m${i}`, { end_date: `2026-11-${String(20 + i).padStart(2, '0')}` }));
  assert.equal(pickHeadlines([], many, { today: TODAY }).length, 8);
  // 큰 할인이 늦게 끝나면 작은 할인 뒤
  const small = n('small', { title: '5% 할인', discount_label: '5%', end_date: '2026-11-11' });
  const huge = n('huge', { title: '70% 할인', discount_label: '70%', end_date: '2026-11-25' });
  assert.deepEqual(pickHeadlines([], [huge, small], { today: TODAY }).map((x) => x.id), ['small', 'huge']);
});

test('쿠폰 카드·앱 쿠폰 카드도 같은 기준 (orderHeadlines·compareHeadlines)', () => {
  const coupon = { id: 'c', status: 'published', brand: '던킨', category: '디저트', menu: '도넛 50%', discount_type: 'percent', discount_rate: 50, start_date: '2026-11-09', end_date: '2026-11-15', first_seen: '2026-11-09T00:00:00Z', programs: [] };
  const news = n('kfc', { brand: 'KFC', start_date: '2026-11-05', end_date: '2026-11-11' });
  const h = pickHeadlines([coupon], [news], { today: TODAY });
  assert.deepEqual(h.map((x) => x.id), ['kfc', 'c'], '11/11에 끝나는 공지가 11/15 쿠폰보다 먼저');
  const app = { id: 'app', kind: 'app_coupon', brand: '버거킹', usable: true, start_date: '2026-11-10', end_date: '2026-11-12', first_seen: '2026-11-10T00:00:00Z' };
  const monthly = { id: 'monthly', kind: 'app_coupon', brand: '맥도날드', usable: true, weekly: true, start_date: '2026-11-01', end_date: '2026-11-30' };
  assert.deepEqual(orderHeadlines([...h, monthly, app], { today: TODAY }).map((x) => x.id), ['kfc', 'app', 'c', 'monthly']);
  assert.ok(compareHeadlines(app, { ...app, id: 'z', usable: false }, TODAY) < 0);
});
