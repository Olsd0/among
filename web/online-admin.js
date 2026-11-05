// 온라인 특가 관리: 공급처 연결 상태·모드, 보류 사유, 숨김·분류 지정, 운영 규칙, 실행 기록.
// 운영자는 예외와 규칙만 다룬다. 상품을 직접 입력하는 기능은 두지 않는다.
import { OD_CATEGORIES, OD_HOLD_LABELS, OD_MODES, OD_RESULTS, OD_STATUSES } from './online-deals-core.js?v=20261105-2';

const root = document.querySelector('#onlineDealsManager');
const API = window.AMONG_CONFIG?.apiUrl || '';
const DEMO = new URLSearchParams(location.search).has('demo') || !API;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kst = iso => {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t + 9 * 3600e3);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
const lines = v => String(v || '').split('\n').map(s => s.trim()).filter(Boolean);
let data = null, busy = false;

root.innerHTML = `<div class="od-admin-heading"><div><h2>온라인 특가 자동화</h2><p>승인된 공급처의 상품을 자동으로 확인·게시합니다. 운영자는 공급처 모드, 보류된 예외, 규칙만 관리합니다. 시각은 한국 시간입니다.</p></div><a href="./?view=onlineDeals" target="_blank" rel="noopener">공개 화면 ↗</a></div>
  <p id="odAdminMessage" class="od-admin-message" role="status">${DEMO ? '예시 모드에서는 온라인 특가 관리를 불러올 수 없어요.' : '상단 관리 토큰으로 불러오기를 눌러 주세요.'}</p>
  <div id="odAdminContent" hidden>
    <div id="odSuppliers" class="od-suppliers"></div>
    <p id="odCounts" class="od-counts"></p>
    <div class="od-toolbar"><label>목록<select id="odFilter"><option value="held">보류</option><option value="published">게시 중</option><option value="scheduled">시작 전</option><option value="hidden">운영자 숨김</option><option value="old">종료·재확인 기한 지남</option><option value="all">전체</option></select></label>
      <button type="button" id="odReload">새로고침</button><button type="button" id="odRerun">지금 다시 확인</button></div>
    <div id="odItems" class="od-items"></div>
    <details class="od-rules"><summary>운영 규칙</summary><form id="odRulesForm"></form></details>
    <h3>최근 실행</h3><div class="scroll"><table id="odRuns"></table></div>
  </div>`;
const $ = s => root.querySelector(s);
const message = (s, bad = false) => { $('#odAdminMessage').textContent = s; $('#odAdminMessage').classList.toggle('bad', bad); };

async function request(action, body = {}) {
  if (DEMO) throw new Error('예시 모드에서는 바꿀 수 없어요.');
  const token = document.querySelector('#token').value.trim();
  if (!token) throw new Error('관리 토큰을 입력하세요.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, action, token }), signal: ctrl.signal });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error === 'unauthorized' ? '관리 토큰이 맞지 않아요.' : j.error || '요청 실패');
    return j;
  } finally { clearTimeout(timer); }
}

function connection(s) {
  if (s.lastResult === 'awaiting_access') return ['warn', '승인 대기 · 연결 안 됨'];
  if (s.lastResult === 'missing_secrets') return ['warn', '키 미등록 · 연결 안 됨'];
  if (s.lastResult === 'rate_limited' || s.lastResult === 'failed') return ['bad', OD_RESULTS[s.lastResult]];
  if (s.lastSuccessAt) return ['good', `연결됨 · 마지막 수신 ${kst(s.lastSuccessAt)}`];
  return ['warn', s.lastResult ? OD_RESULTS[s.lastResult] : '실행 기록 없음'];
}

function suppliers() {
  $('#odSuppliers').innerHTML = data.suppliers.map(s => {
    const [tone, label] = connection(s);
    const paused = s.pauseUntil && Date.parse(s.pauseUntil) > Date.now();
    return `<div class="od-supplier"><div class="od-supplier-top"><b>${esc(s.name)}</b><span class="pill ${tone}">${esc(label)}</span></div>
      <label>모드<select data-od-mode="${esc(s.id)}">${Object.entries(OD_MODES).map(([k, v]) => `<option value="${k}"${k === s.mode ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      <button type="button" data-od-mode-save="${esc(s.id)}">모드 저장</button>
      <p class="muted">마지막 실행 ${esc(kst(s.lastRunAt))} · 받은 상품 ${s.lastReceived}개${s.failures ? ` · 연속 실패 ${s.failures}회` : ''}${s.images_allowed ? '' : ' · 사진 표시 안 함 (이용 범위 확인 전)'}${s.link_hosts_ready ? '' : ' · 링크 주소 확인 전 (모든 상품 보류)'}</p>
      ${s.lastError ? `<p class="err-text">${esc(s.lastError)}</p>` : ''}
      ${paused ? `<p>일시 중지: ${esc(kst(s.pauseUntil))}까지 <button type="button" data-od-resume="${esc(s.id)}">중지 해제</button></p>` : ''}</div>`;
  }).join('');
  const c = data.counts;
  $('#odCounts').textContent = Object.keys(OD_STATUSES).map(k => `${OD_STATUSES[k]} ${c[k] || 0}`).join(' · ');
}

function items() {
  const f = $('#odFilter').value;
  const shown = data.items.filter(i => f === 'all' || (f === 'old' ? ['ended', 'stale'].includes(i.status) : i.status === f));
  $('#odItems').innerHTML = shown.map(i => `<article class="od-item" data-od-id="${esc(i.id)}">
    <div class="od-item-top"><span class="pill ${i.status === 'published' ? 'good' : i.status === 'held' ? 'warn' : ''}">${esc(OD_STATUSES[i.status] || i.status)}</span><b>${esc(i.title || '(상품명 없음)')}</b></div>
    <p>${esc([i.option, i.store, i.seller && `판매자 ${i.seller}`].filter(Boolean).join(' · '))} · ${i.price ? `${i.price}원` : '가격 없음'} · ${esc(i.shipping)}${i.membership ? ` · ${esc(i.membership)}` : ''}</p>
    ${i.holds.length ? `<ul class="od-holds">${i.holds.map(h => `<li>${esc(OD_HOLD_LABELS[h] || h)}</li>`).join('')}</ul>` : ''}
    <p class="muted">분류 ${esc(OD_CATEGORIES[i.category] || (i.category === 'excluded' ? '게시 안 함' : '미지정'))}${i.category_path ? ` (공급처: ${esc(i.category_path)})` : ''} · 확인 ${esc(kst(i.last_received_at))} · 재확인 기한 ${esc(kst(i.visible_until))}${i.ends_at ? ` · 행사 종료 ${esc(kst(i.ends_at))}` : ''}</p>
    ${i.conditions.length ? `<details><summary>조건 ${i.conditions.length}개</summary><ul>${i.conditions.map(c => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}
    <div class="od-item-actions">
      ${i.hidden ? `<span class="muted">숨김 사유: ${esc(i.hidden_reason || '—')}</span><button type="button" data-od-unhide>숨김 해제</button>`
        : `<input data-od-reason maxlength="100" placeholder="숨김 사유 (선택)" aria-label="숨김 사유"><button type="button" data-od-hide>숨기기</button>`}
      <select data-od-cat aria-label="분류 지정"><option value="">분류 규칙대로</option>${Object.entries(OD_CATEGORIES).map(([k, v]) => `<option value="${k}"${i.category_override === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}<option value="excluded"${i.category_override === 'excluded' ? ' selected' : ''}>게시 안 함</option></select>
      <input type="date" data-od-until aria-label="분류 지정 기한" value="${i.override_until ? esc(new Date(Date.parse(i.override_until) + 9 * 3600e3).toISOString().slice(0, 10)) : ''}">
      <button type="button" data-od-cat-save>분류 저장</button>
      ${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer sponsored">상품 확인 ↗</a>` : ''}
    </div></article>`).join('') || '<p class="muted">해당하는 상품이 없어요.</p>';
}

function rules() {
  const r = data.rules;
  $('#odRulesForm').innerHTML = `<fieldset><legend>게시할 분류</legend>${Object.entries(OD_CATEGORIES).map(([k, v]) => `<label class="od-check"><input type="checkbox" name="include" value="${k}"${r.includeCategories.includes(k) ? ' checked' : ''}>${esc(v)}</label>`).join('')}</fieldset>
    <div class="od-rule-grid">
    <label>식품으로 연결할 공급처 분류 (한 줄에 하나, 경로의 한 단계와 정확히 같아야 함)<textarea name="food" rows="4">${esc(r.categoryKeywords.food.join('\n'))}</textarea></label>
    <label>생활용품으로 연결할 공급처 분류<textarea name="household" rows="4">${esc(r.categoryKeywords.household.join('\n'))}</textarea></label>
    <label>제외 키워드 (상품명·옵션에 들어 있으면 보류)<textarea name="excludeKeywords" rows="4">${esc(r.excludeKeywords.join('\n'))}</textarea></label>
    <label>제외 판매자 (이름이 정확히 같으면 보류)<textarea name="excludeSellers" rows="4">${esc(r.excludeSellers.join('\n'))}</textarea></label>
    <label>최대 게시 수<input name="maxItems" type="number" min="1" max="60" value="${r.maxItems}"></label>
    <label>재확인 기한 (마지막 확인 뒤 몇 시간까지 보여 줄지, 최대 24)<input name="maxAgeHours" type="number" min="1" max="24" value="${r.maxAgeHours}"></label>
    </div><button type="submit" class="primary">규칙 저장</button>`;
}

function runs() {
  $('#odRuns').innerHTML = '<thead><tr><th>시작</th><th>주체</th><th>공급처 결과</th><th class="n">받은 상품</th><th class="n">게시</th><th class="n">보류</th><th>오류</th></tr></thead><tbody>'
    + (data.runs.map(r => `<tr><td>${esc(kst(r.started_at || r.finished_at))}</td><td>${esc(r.trigger)}</td><td>${esc(String(r.results || '').split(' ').map(x => { const [id, res] = x.split(':'); return `${id} ${OD_RESULTS[res] || res || ''}`; }).join(', '))}</td><td class="n">${esc(r.received)}</td><td class="n">${esc(r.published)}</td><td class="n">${esc(r.held)}</td><td class="err-text">${esc(r.errors)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">실행 기록이 없어요.</td></tr>') + '</tbody>';
}

function render(j, note) {
  data = j;
  $('#odAdminContent').hidden = false;
  suppliers(); items(); rules(); runs();
  message(note || `불러왔어요. ${data.lock ? `실행 중 (${kst(data.lock.until)}까지 잠금)` : ''}`);
}

async function act(body, done) {
  if (busy) return;
  busy = true;
  root.setAttribute('aria-busy', 'true');
  try { render(await request(body ? 'online_admin_set' : 'online_admin', body || {}), done); }
  catch (e) { message(e.message, true); if (!body) { data = null; $('#odAdminContent').hidden = true; } }
  finally { busy = false; root.setAttribute('aria-busy', 'false'); }
}
const load = () => { if (!DEMO) act(null); };

root.addEventListener('click', e => {
  const t = e.target;
  const item = t.closest('[data-od-id]');
  if (t.matches('[data-od-mode-save]')) {
    const id = t.dataset.odModeSave;
    const mode = root.querySelector(`[data-od-mode="${CSS.escape(id)}"]`).value;
    act({ op: 'supplier_mode', supplier: id, mode }, `${OD_MODES[mode]} 모드로 저장했어요.`);
  } else if (t.matches('[data-od-resume]')) act({ op: 'supplier_resume', supplier: t.dataset.odResume }, '일시 중지를 풀었어요. 다음 실행부터 다시 확인해요.');
  else if (t.matches('[data-od-hide]') && item) act({ op: 'hide', id: item.dataset.odId, reason: item.querySelector('[data-od-reason]').value }, '숨겼어요. 다시 받아도 숨김이 유지돼요.');
  else if (t.matches('[data-od-unhide]') && item) act({ op: 'unhide', id: item.dataset.odId }, '숨김을 풀었어요.');
  else if (t.matches('[data-od-cat-save]') && item) {
    const day = item.querySelector('[data-od-until]').value;
    act({ op: 'category', id: item.dataset.odId, category: item.querySelector('[data-od-cat]').value, until: day ? new Date(`${day}T23:59:59+09:00`).toISOString() : '' }, '분류를 저장했어요.');
  }
});
$('#odRulesForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(e.target);
  act({ op: 'rules', rules: {
    includeCategories: f.getAll('include'), categoryKeywords: { food: lines(f.get('food')), household: lines(f.get('household')) },
    excludeKeywords: lines(f.get('excludeKeywords')), excludeSellers: lines(f.get('excludeSellers')),
    maxItems: Number(f.get('maxItems')), maxAgeHours: Number(f.get('maxAgeHours')),
  } }, '규칙을 저장했어요. 다음 조회부터 바로 반영돼요.');
});
$('#odFilter').addEventListener('change', () => data && items());
$('#odReload').addEventListener('click', load);
$('#odRerun').addEventListener('click', () => act({ op: 'rerun' }, '다시 확인을 요청했어요. 1~3분 뒤 새로고침해 주세요.'));
document.querySelector('#authForm').addEventListener('submit', load);
document.querySelector('#token').addEventListener('input', () => { data = null; $('#odAdminContent').hidden = true; });
