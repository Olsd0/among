// 브라우저 저장 정보와 오프라인 캐시의 사용자에게 보이는 동작 검증
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const readWeb = (name) => readFileSync(new URL(`../../web/${name}`, import.meta.url), 'utf8');

test('모든 배포 HTML에서 외부 글꼴·인라인 코드·프레임 허용이 다시 열리지 않는다', () => {
  for (const name of ['index', 'admin', 'about', 'terms', 'guide', 'privacy', 'partners']) {
    const html = readWeb(name + '.html');
    const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
    for (const rule of ["script-src 'self'", "style-src 'self'", "style-src-attr 'none'", "font-src 'self'", name === 'index' ? "frame-src 'self'" : "frame-src 'none'", "base-uri 'none'"]) {
      assert.ok(policy.split(';').map(s => s.trim()).includes(rule), name + ' ' + rule);
    }
    assert.doesNotMatch(html, /unsafe-inline|unsafe-eval|<style\b|\sstyle=|cdn\.jsdelivr\.net/i, name);
  }
});

test('쿠팡 식품 베스트 배너 페이지: 쿠팡 주소와 해시가 맞는 코드만 실행, AMONG 파트너스 ID, 검색 제외', async () => {
  const { createHash } = await import('node:crypto');
  const html = readWeb('coupang-widget.html');
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const directive = (name) => policy.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + ' '))?.split(/\s+/).slice(1) || [];
  assert.deepEqual(directive('default-src'), ["'none'"]);
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(inline.length, 1);
  const hash = (text) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
  assert.deepEqual(directive('script-src').sort(), ['https://ads-partners.coupang.com', 'https://partners.coupangcdn.com', hash(inline[0])].sort());
  assert.deepEqual(directive('frame-src'), ['https://ads-partners.coupang.com']);
  assert.equal(directive('style-src')[0], hash(html.match(/<style>([\s\S]*?)<\/style>/)[1]));
  assert.match(inline[0], /"trackingCode":"AF1327603"/, 'AMONG 파트너스 ID만');
  assert.deepEqual([...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]), ['https://ads-partners.coupang.com/g.js']);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval|\sstyle=/);
});

test('관리 요청은 공식 배포 주소와 최상위 창에서만 토큰을 본문으로 보내고 기록을 남기지 않는다', async () => {
  const calls = [];
  const top = {};
  const deployment = 'https://script.google.com/macros/s/test-id/exec';
  const window = { self: top, top, AMONG_CONFIG: { apiUrl: deployment } };
  const request = vm.runInNewContext(readWeb('admin-request.js').replace('export async function', 'async function') + '\nrequest', {
    window, location: { search: '' }, URLSearchParams, AbortController, setTimeout, clearTimeout,
    document: { querySelector: () => ({ value: 'test-only' }) },
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ ok: true }) }; },
  });
  for (const url of ['https://script.google.com.evil.example/macros/s/a/exec', deployment + '?next=other', 'https://script.google.com/macros/s/a/dev']) {
    window.AMONG_CONFIG.apiUrl = url;
    await assert.rejects(request('metrics'));
  }
  window.AMONG_CONFIG.apiUrl = deployment;
  window.self = {};
  await assert.rejects(request('metrics'));
  assert.equal(calls.length, 0);
  window.self = top;
  await request('metrics');
  const [{ url, options }] = calls;
  assert.equal(url, deployment);
  assert.deepEqual(JSON.parse(options.body), { action: 'metrics', token: 'test-only' });
  assert.equal(options.method, 'POST');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.referrerPolicy, 'no-referrer');
});

function docPage({ refuseWrites = false, initial = {} } = {}) {
  class Storage {
    getItem(k) { return Object.hasOwn(this, k) ? this[k] : null; }
    setItem(k, v) { if (refuseWrites) throw new Error('storage blocked'); this[k] = String(v); }
    removeItem(k) { delete this[k]; }
  }
  const localStorage = Object.assign(new Storage(), initial);
  const element = () => ({ checked: false, disabled: false, textContent: '', listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } });
  const elements = { trackSwitch: element(), trackNote: element(), clearLocal: element(), clearNote: element() };
  const deleted = [];
  const caches = { keys: async () => ['among-shell-v7', 'unrelated-app'], delete: async (name) => { deleted.push(name); } };
  const document = { documentElement: { dataset: {} }, querySelectorAll: () => [], getElementById: (id) => elements[id] || null };
  vm.runInNewContext(readWeb('doc.js'), { document, localStorage, navigator: {}, caches, window: { caches, AMONG_CONFIG: {} } });
  return { localStorage, elements, deleted };
}

test('기기 정보 삭제 후에도 이용 기록 거부를 유지하고 다른 서비스 캐시는 삭제하지 않는다', async () => {
  const { localStorage, elements, deleted } = docPage({ initial: { among_notrack: 'true', among_sid: '"abcd1234"', among_saved: '[1]', other_app: 'value' } });
  assert.equal(elements.trackSwitch.checked, false);
  elements.clearLocal.listeners.click();
  elements.clearLocal.listeners.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(localStorage.getItem('among_notrack'), 'true');
  assert.equal(localStorage.getItem('among_sid'), null);
  assert.equal(localStorage.getItem('among_saved'), null);
  assert.equal(localStorage.getItem('other_app'), 'value');
  assert.equal(elements.trackSwitch.checked, false);
  assert.deepEqual(deleted, ['among-shell-v7']);
  assert.match(elements.clearNote.textContent, /설정은 유지/);
});

test('이용 기록 선택을 저장할 수 없으면 스위치도 이전 상태로 되돌린다', () => {
  const { elements } = docPage({ refuseWrites: true });
  assert.equal(elements.trackSwitch.checked, true);
  elements.trackSwitch.checked = false;
  elements.trackSwitch.listeners.change();
  assert.equal(elements.trackSwitch.checked, true);
  assert.match(elements.trackNote.textContent, /저장할 수 없어요/);
});

function worker() {
  const handlers = {}, stores = new Map();
  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return { put: async (k, v) => store.set(String(k), v), match: async (k) => store.get(String(k)), addAll: async () => {} };
  };
  const caches = { keys: async () => [...stores.keys()], delete: async (name) => stores.delete(name), open: async (name) => cacheFor(name) };
  let network = async () => new Response('ok');
  const self = { registration: { scope: 'https://example.test/among/' }, clients: { claim: async () => {} }, skipWaiting: async () => {}, addEventListener: (name, fn) => { handlers[name] = fn; } };
  vm.runInNewContext(readWeb('sw.js'), { self, caches, URL, Response, fetch: (...args) => network(...args) });
  return {
    stores,
    setNetwork: (fn) => { network = fn; },
    activate: async () => { let p; handlers.activate({ waitUntil: (v) => { p = v; } }); await p; },
    request: async (path, mode = 'no-cors') => {
      let p;
      handlers.fetch({ request: { url: `https://example.test/among/${path}`, method: 'GET', mode }, respondWith: (v) => { p = v; } });
      return p ? await p : undefined;
    },
  };
}

test('서비스 워커는 다른 앱 캐시와 정상 사본을 보존하고, 오프라인 JS에 HTML을 반환하지 않는다', async () => {
  const w = worker();
  w.stores.set('among-shell-v7', new Map());
  w.stores.set('unrelated-app', new Map());
  await w.activate();
  assert.equal(w.stores.has('among-shell-v7'), false);
  assert.equal(w.stores.has('unrelated-app'), true);
  w.setNetwork(async () => new Response('old script', { status: 200 }));
  assert.equal(await (await w.request('app.js?one')).text(), 'old script');
  w.setNetwork(async () => new Response('not found', { status: 404 }));
  assert.equal((await w.request('app.js?two')).status, 404);
  w.setNetwork(async () => { throw new Error('offline'); });
  assert.equal(await (await w.request('app.js?three')).text(), 'old script');
  assert.equal((await w.request('doc.js')).type, 'error');
  assert.equal(await w.request('admin.html', 'navigate'), undefined, '관리 화면은 서비스 워커에 저장하지 않음');
});


test('처음 받는 배포 스크립트는 HTTP 캐시를 재검증하고 오프라인에서 다른 버전과 섞지 않는다', async () => {
  const w = worker();
  w.setNetwork(async (_request, options) => {
    assert.equal(options.cache, 'no-cache');
    return new Response('new module');
  });
  assert.equal(await (await w.request('app.js?v=current')).text(), 'new module');
  w.setNetwork(async () => { throw new Error('offline'); });
  assert.equal(await (await w.request('app.js?v=current')).text(), 'new module');
  assert.equal((await w.request('app.js?v=older')).type, 'error', '다른 버전 사본으로 대체하지 않음');
  assert.equal((await w.request('engine.js?v=current')).type, 'error', '없는 모듈에 HTML을 반환하지 않음');
});

test('버전 모듈은 재요청하지 않고 HTML·설정은 최신본을 확인하며, 사진·로고 파일은 사이트에 두지 않는다', async () => {
  const w = worker();
  let calls = 0;
  w.setNetwork(async () => new Response(`response-${++calls}`));
  for (const path of ['app.js?v=release-1']) {
    const first = await (await w.request(path)).text();
    assert.equal(await (await w.request(path)).text(), first);
  }
  assert.equal(calls, 1);
  await w.request('app.js?v=release-2');
  assert.equal(calls, 2, '새 배포 버전은 네트워크에서 받는다');
  for (const path of ['index.html', 'config.js', 'config.js?v=current', 'guide.html']) {
    const first = await (await w.request(path)).text();
    assert.notEqual(await (await w.request(path)).text(), first);
  }
  // 사진·로고 파일은 사이트에 두지 않는다 (공식 주소를 그대로 불러옴)
  for (const path of ['assets/brands/gongcha-012345abcdef.png', 'assets/notices/baskin-pint-418e18ce7b74.png', 'assets/brands/arbitrary.png']) assert.equal(await w.request(path), undefined);
});
