import { AC_APPS, AC_AUDIENCES, AC_BENEFITS, AC_FACTS, AC_LINK_LABELS, AC_STATES, acNormalize, acKST, acLifecycle, acNeedsReview, acValidate } from './app-coupons.js?v=20261029-8';
import { acEsc as esc } from './app-coupon-ui.js?v=20261029-8';

const root = document.querySelector('#appCouponManager');
const API = window.AMONG_CONFIG?.apiUrl || '';
const DEMO = new URLSearchParams(location.search).has('demo') || !API;
let rows = [], selected = null, busy = false, authed = false;
root.innerHTML = `<div class="ac-admin-heading"><div><h2>앱 전용 쿠폰 관리</h2><p>기존 관리 토큰으로 등록·공개·마감을 관리합니다. 날짜와 시간은 Asia/Seoul 기준입니다.</p></div><a href="./?view=appCoupons" target="_blank" rel="noopener">공개 화면 ↗</a></div>
  <p id="acAdminMessage" class="ac-admin-message" role="status">${DEMO ? '예시 모드에서는 실제 쿠폰을 등록할 수 없어요.' : '상단 관리 토큰으로 불러오기를 눌러 주세요.'}</p>
  <div id="acAdminContent" hidden><div class="ac-admin-toolbar"><label>목록 필터<select id="acAdminFilter"><option value="all">전체</option><option value="draft">초안</option><option value="published">공개</option><option value="review">재확인 필요</option><option value="redeem_only">발급 종료</option><option value="ended">사용 종료</option><option value="archived">보관</option></select></label><button type="button" id="acNew">쿠폰 등록</button><button type="button" id="acReload">목록 새로고침</button></div><p id="acAdminCount"></p><div id="acAdminList" class="ac-admin-list"></div><div id="acEditor"></div></div>`;
const $ = s => root.querySelector(s);
const message = (s, bad = false) => { $('#acAdminMessage').textContent = s; $('#acAdminMessage').classList.toggle('bad', bad); };
async function request(action, body = {}) {
  if (DEMO) throw new Error('예시 모드에서는 변경할 수 없어요.');
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
function list() {
  const filter = $('#acAdminFilter').value;
  const shown = rows.filter(c => filter === 'all' || (filter === 'review' ? acNeedsReview(c) : ['draft', 'published', 'archived'].includes(filter) ? c.status === filter : acLifecycle(c) === filter));
  $('#acAdminCount').textContent = `${shown.length}개 · 초안 ${rows.filter(c => c.status === 'draft').length}개 · 재확인 ${rows.filter(c => acNeedsReview(c)).length}개`;
  $('#acAdminList').innerHTML = shown.map(c => `<button type="button" data-ac-edit="${esc(c.id)}"><span><b>${esc(c.brand)} · ${esc(c.product_name || '상품 미입력')}</b><small>${esc(c.issuer_app)} 앱 · ${AC_STATES[acLifecycle(c)]}${acNeedsReview(c) ? ' · 재확인 필요' : ''}</small></span><span>수정 →</span></button>`).join('') || '<p class="muted">해당 쿠폰이 없어요.</p>';
}
async function load() {
  if (busy || DEMO) return;
  busy = true;
  try {
    const j = await request('app_coupon_list');
    rows = j.coupons.map(acNormalize); authed = true;
    $('#acAdminContent').hidden = false; list();
    message('불러왔어요. 새로고침은 쿠폰의 마지막 확인 시점을 바꾸지 않습니다.');
  } catch (e) { authed = false; rows = []; selected = null; $('#acAdminContent').hidden = true; $('#acEditor').innerHTML = ''; message(e.message, true); }
  finally { busy = false; }
}
const options = (obj, v) => Object.entries(obj).map(([key, label]) => `<option value="${esc(key)}"${key === v ? ' selected' : ''}>${esc(label)}</option>`).join('');
function input(c, key, label, type = 'text', hint = '') {
  let value = c[key] ?? '';
  if (type === 'datetime-local') value = value ? acKST(value).replace(' ', 'T') : '';
  return `<label>${esc(label)}<input name="${key}" type="${type}" value="${esc(value)}"${type === 'number' ? ' min="0" step="any"' : ''}${type === 'text' ? ' maxlength="12000"' : ''}>${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
}
const area = (c, key, label, hint = '') => `<label class="ac-wide">${esc(label)}<textarea name="${key}" rows="3" maxlength="12000">${esc(c[key] || '')}</textarea>${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
const select = (c, key, label, obj) => `<label>${esc(label)}<select name="${key}">${options(obj, c[key])}</select></label>`;
const check = (c, key, label) => `<label class="ac-check"><input type="checkbox" name="${key}"${c[key] ? ' checked' : ''}>${esc(label)}</label>`;
function editor(c) {
  selected = acNormalize(c);
  const errors = acValidate(selected);
  $('#acEditor').innerHTML = `<form id="acEditorForm"><h3>${c.id ? '쿠폰 수정' : '새 쿠폰 등록'}</h3>
    <p class="muted">${c.id ? `ID ${esc(c.id)} · 수정 버전 ${c.revision} · 조건 확인 ${esc(acKST(c.checked_at))}` : '미확인 항목은 비워 두고 초안으로 저장할 수 있어요.'}</p>
    ${errors.length ? `<details class="ac-long"><summary>공개 전 필요한 확인 ${errors.length}개</summary><p>${esc(errors.join('\n'))}</p>${c.missing_info ? `<p>${esc(c.missing_info)}</p>` : ''}</details>` : ''}
    <fieldset><legend>앱·상품·혜택</legend><div class="ac-form-grid">
    ${select(c, 'issuer_app', '발급 앱', { '': '선택', ...Object.fromEntries(AC_APPS.map(x => [x, x])) })}${input(c, 'brand', '실제 사용 브랜드')}
    ${input(c, 'product_name', '상품명')}${input(c, 'item_type', '단품·세트·구성 유형')}
    ${select(c, 'benefit_type', '혜택 방식', AC_BENEFITS)}${input(c, 'final_price', '최종 구매 가격 (원)', 'number')}
    ${input(c, 'regular_price', '확인된 기준 가격 (원)', 'number')}${input(c, 'discount_amount', '할인액 / 환급액 (원)', 'number')}
    ${input(c, 'discount_rate', '공식 안내의 할인율 / 환급률 (%)', 'number', '기준 가격 없이 임의 계산하지 마세요.')}${input(c, 'points_cost', '교환에 필요한 포인트 (P)', 'number')}
    ${check(c, 'is_max', '최대 할인·환급')}${area(c, 'benefit_note', '혜택 설명·금액 근거')}
    </div></fieldset>
    <fieldset><legend>쿠폰별 이용 대상</legend><div class="ac-form-grid">
    ${select(c, 'audience_type', '대상 유형', AC_AUDIENCES)}${input({ tiers: c.tiers.join(', ') }, 'tiers', '확인된 등급 (쉼표로 구분)', 'text', '버거킹 등급 범위를 추정하지 마세요.')}
    ${area(c, 'audience_detail', '이용 대상의 구체적 조건')}${area(c, 'audience_evidence', '이 쿠폰의 대상 확인 근거', '내 계정에서 보인다는 사실만으로 전체 회원으로 등록하지 마세요.')}
    </div></fieldset>
    <fieldset><legend>발급·사용 기간 (한국 시간)</legend><div class="ac-form-grid">
    ${select(c, 'issue_period_state', '발급 기간 확인 상태', { unknown: '미확인', verified: '기간 확인', na: '해당 없음 (근거 필요)' })}${input(c, 'issue_period_note', '발급 기간 해당 없음의 근거')}
    ${input(c, 'issue_start', '발급 시작', 'datetime-local')}${input(c, 'issue_end', '발급 마감 (입력한 분의 끝까지)', 'datetime-local')}
    ${select(c, 'use_period_state', '사용 기간 확인 상태', { unknown: '미확인', verified: '기간 확인' })}<p class="muted">상대 기간 쿠폰도 공개 시에는 이 쿠폰의 실제 사용 종료일을 확인해 입력하세요.</p>
    ${input(c, 'use_start', '사용 시작', 'datetime-local')}${input(c, 'use_end', '사용 종료 (입력한 분의 끝까지)', 'datetime-local')}
    ${check(c, 'issue_closed', '예정일 전 발급 마감')}${check(c, 'use_closed', '예정일 전 사용 종료')}
    </div></fieldset>
    <details class="ac-admin-section"><summary>상품 구성·발급 조건·이용 제한 (전체 항목)</summary><div class="ac-form-grid">
    ${Object.entries(AC_FACTS).map(([k, label]) => `<label class="ac-fact-input">${esc(label)}<select name="fact_${k}_state">${options({ unknown: '미확인', verified: '확인됨', na: '해당 없음' }, c.facts[k].state)}</select><textarea name="fact_${k}_value" rows="3" maxlength="12000">${esc(c.facts[k].value)}</textarea></label>`).join('')}
    </div></details>
    <fieldset><legend>공식 출처·이용 링크</legend><div class="ac-form-grid">
    ${input(c, 'source_url', '정보를 확인한 공식 출처 URL', 'url')}${area(c, 'source_note', '출처에서 확인한 내용', '핵심 사실을 직접 정리하고 배너·사용 코드는 복제하지 마세요.')}
    ${input(c, 'official_link', '이용자가 이동할 공식 URL', 'url', '공식 행사 상세 → 작동을 확인한 앱 화면 → 설치 안내와 앱 내 경로 순으로 선택하세요.')}${select(c, 'link_type', '버튼 목적지', AC_LINK_LABELS)}
    ${area(c, 'app_path', '실제로 확인한 앱 내 이동 경로', '개별 링크가 없으면 공식 설치 안내 + 앱 내 경로를 입력하세요.')}
    ${check({}, 'confirm_link', '지금 이 링크의 목적지가 정상임을 직접 확인함')}
    <p class="muted">링크 접속 확인 ${esc(acKST(c.link_checked_at))} · 링크가 열리는 것만으로 쿠폰 발급 가능을 확정하지 않습니다.</p>
    ${select(c, 'rights_state', '출처 자료 이용 범위', { unknown: '미확인 · 초안만', facts_only: '확인 완료 · 사실 정보 직접 정리', permission: '별도 이용 허락 확인' })}
    ${area(c, 'rights_note', '확인한 이용 조건·근거 또는 허락 범위')}
    </div></fieldset>
    <details class="ac-admin-section"><summary>핫딜·중복 확인·운영 메모</summary><div class="ac-form-grid">
    ${check(c, 'hotdeal_enabled', '같은 기록을 핫딜에도 연결')}${check(c, 'recurring', '반복 행사 (후순위)')}
    <p class="ac-wide muted">해피포인트 핫딜은 1+1 또는 즉시 할인 50% 이상만 노출됩니다. 다른 앱은 1+1 또는 30% 이상, 최근 48시간 내 확인된 발급 중 쿠폰을 추천합니다. 목록에는 이 할인 기준을 적용하지 않습니다.</p>
    ${input({ legacy_refs: c.legacy_refs.join(', ') }, 'legacy_refs', '기존 수집 기록 연결 ID', 'text', 'coupon:ID 또는 news:ID, 쉼표로 구분. 연결한 기존 사본은 중복 노출하지 않습니다.')}
    ${area(c, 'duplicate_note', '중복 후보와 다른 쿠폰인 이유')}${area(c, 'missing_info', '추가 확인이 필요한 정보 (관리자 전용)')}${area(c, 'admin_notes', '운영 메모 (관리자 전용)')}
    <button type="button" id="acCheckDuplicates">중복 후보 확인</button><p id="acDuplicateResult" role="status"></p>
    </div></details>
    <fieldset><legend>실제 확인 기록</legend><div class="ac-form-grid">
    ${check({}, 'confirm_checked', '쿠폰의 대상·혜택·기간·조건을 실제로 확인했음')}
    ${input({}, 'verified_time', '실제 확인 일시 (비우면 지금)', 'datetime-local', '체크하지 않으면 기존 확인 시점을 유지합니다. 조건 수정 후 공개하려면 재확인해야 합니다.')}
    </div></fieldset>
    <div class="ac-save-actions"><button type="submit" name="save_status" value="draft">초안 저장</button><button type="submit" name="save_status" value="published" class="primary">검증 후 공개</button><button type="submit" name="save_status" value="archived">보관</button></div>
    ${c.id ? '<div class="ac-admin-toolbar"><button type="button" data-ac-close-phase="issue">발급 조기 마감</button><button type="button" data-ac-close-phase="use">사용 종료 처리</button></div>' : ''}
    <p id="acSaveMessage" role="status"></p></form>`;
}
function formCoupon() {
  const fd = new FormData($('#acEditorForm'));
  const c = { ...selected, facts: {} };
  for (const [k, v] of fd) if (!k.startsWith('fact_') && !['confirm_checked', 'confirm_link', 'verified_time'].includes(k)) c[k] = v;
  ['is_max', 'hotdeal_enabled', 'recurring', 'issue_closed', 'use_closed'].forEach(k => { c[k] = fd.has(k); });
  Object.keys(AC_FACTS).forEach(k => { c.facts[k] = { state: fd.get(`fact_${k}_state`), value: fd.get(`fact_${k}_value`) }; });
  return { c: acNormalize(c), fd };
}
function updateSaved(c) {
  const index = rows.findIndex(x => x.id === c.id);
  if (index < 0) rows.unshift(c); else rows[index] = c;
  list(); editor(c);
}
async function operation(fn) {
  if (busy || !authed) return;
  busy = true;
  root.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try { await fn(); }
  catch (e) { message(e.message, true); if ($('#acSaveMessage')) $('#acSaveMessage').textContent = e.message; }
  finally { busy = false; root.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
}
root.addEventListener('submit', e => {
  if (e.target.id !== 'acEditorForm') return;
  e.preventDefault();
  const status = e.submitter?.value || 'draft';
  operation(async () => {
    const { c, fd } = formCoupon(); c.status = status;
    const result = await request('app_coupon_save', { coupon: c, expected_revision: selected.revision, confirm_checked: fd.has('confirm_checked'), checked_at: fd.get('verified_time'), confirm_link: fd.has('confirm_link') });
    updateSaved(acNormalize(result.coupon));
    const text = status === 'draft' ? '초안으로 저장했어요. 공개 목록에는 표시되지 않습니다.' : status === 'archived' ? '보관했어요. 공개 목록과 핫딜에서 제외됩니다.' : '공개했어요. 앱쿠폰 목록과 핫딜은 같은 기록을 사용합니다.';
    message(text); $('#acSaveMessage').textContent = text;
  });
});
root.addEventListener('click', e => {
  const edit = e.target.closest('[data-ac-edit]');
  if (edit) { editor(rows.find(c => c.id === edit.dataset.acEdit)); $('#acEditor').scrollIntoView({ block: 'start' }); }
  const close = e.target.closest('[data-ac-close-phase]');
  if (close) operation(async () => {
    const j = await request('app_coupon_close', { id: selected.id, expected_revision: selected.revision, phase: close.dataset.acClosePhase });
    updateSaved(acNormalize(j.coupon)); message(AC_STATES[j.lifecycle] + ' 처리했어요. 확인 시점은 바뀌지 않았습니다.');
  });
  if (e.target.id === 'acCheckDuplicates') operation(async () => {
    const { c } = formCoupon(); const j = await request('app_coupon_duplicates', { coupon: c });
    $('#acDuplicateResult').textContent = j.duplicates.length ? j.duplicates.map(x => `${x.id} · ${x.product_name} · ${x.audience}`).join('\n') : '현재 저장된 앱쿠폰 중 중복 후보가 없어요.';
  });
});
$('#acNew').addEventListener('click', () => editor(acNormalize({ audience_type: 'unknown', benefit_type: 'unknown', issue_period_state: 'unknown', use_period_state: 'unknown', rights_state: 'unknown', link_type: 'event' })));
$('#acReload').addEventListener('click', load);
$('#acAdminFilter').addEventListener('change', list);
document.querySelector('#authForm').addEventListener('submit', load);
document.querySelector('#token').addEventListener('input', () => { authed = false; $('#acAdminContent').hidden = true; });
if (!DEMO && document.querySelector('#token').value) load();
