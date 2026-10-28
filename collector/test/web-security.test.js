// 브라우저 저장 정보와 오프라인 캐시의 사용자에게 보이는 동작 검증
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const readWeb = (name) => readFileSync(new URL(`../../web/${name}`, import.meta.url), 'utf8');

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
