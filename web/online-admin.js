// 온라인 특가 관리: 공급처 연결 상태·모드, 보류 사유, 숨김·분류 지정, 운영 규칙, 실행 기록.
// 운영자는 예외와 규칙만 다룬다. 상품을 직접 입력하는 기능은 두지 않는다.
import { OD_CATEGORIES, OD_HOLD_LABELS, OD_MODES, OD_RESULTS, OD_STATUSES, OD_PICK_CATEGORIES, OD_PICK_DEFAULT_DAYS, OD_LEAD_SOURCES, odLeadName } from './online-deals-core.js?v=20261105-4';

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

root.innerHTML = `<div class="od-admin-heading"><div><h2>온라인 특가</h2><p>쿠팡 파트너스 최종 승인 전에는 직접 고른 상품의 간편 링크를 카드로 올리고, 승인 뒤에는 공급처 상품을 자동으로 확인·게시합니다. 시각은 한국 시간입니다.</p></div><a href="./?view=onlineDeals" target="_blank" rel="noopener">공개 화면 ↗</a></div>
  <p id="odAdminMessage" class="od-admin-message" role="status">${DEMO ? '예시 모드에서는 온라인 특가 관리를 불러올 수 없어요.' : '상단 관리 토큰으로 불러오기를 눌러 주세요.'}</p>
  <div id="odAdminContent" hidden>
    <section class="od-picks-admin" aria-labelledby="odPicksAdminTitle"><h3 id="odPicksAdminTitle">직접 고른 쿠팡 특가</h3>
      <p class="muted">게시판 등에서 찾은 상품을 쿠팡 파트너스 '간편 링크'로 만들어 붙여 넣으면 공개 화면에 쿠폰 모양 카드로 올라가요. 공개 화면에는 상품명·항목·한 줄 설명·확인한 가격만 보이고(가격을 넣은 카드는 확인 후 24시간 뒤 자동으로 내려감, '다시 확인'하면 다시 24시간), 정보 출처 메모는 여기에만 남아요. 최종 승인 뒤에는 쿠팡 API 자동 확인으로 바꿉니다.</p>
      <div class="od-leads"><h4>자동으로 찾은 후보 <span id="odLeadCount" class="muted"></span></h4>
        <p class="muted">뽐뿌·루리웹 핫딜 게시판의 공개 RSS에서 쿠팡 상품 글만 1시간마다 찾아 여기에만 보여 줘요(공개 화면에는 안 올라감). 쿠팡 상품을 열어 가격·조건을 직접 확인한 뒤, 상품 주소를 파트너스 '간편 링크'로 바꿔 아래 칸에 붙여 넣으세요.</p>
        <div id="odLeads" class="od-items"></div></div>
      <form id="odPickForm" class="od-pick-form" novalidate><input type="hidden" name="id"><input type="hidden" name="lead">
        <label class="wide">상품명<input name="title" maxlength="80" autocomplete="off" placeholder="예: 삼다수 2L × 12병"></label>
        <label class="wide">쿠팡 파트너스 간편 링크<input name="url" inputmode="url" autocomplete="off" placeholder="https://link.coupang.com/a/…"></label>
        <label>항목<select name="category">${Object.entries(OD_PICK_CATEGORIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label>지금 확인한 가격 (선택)<input name="price" inputmode="numeric" autocomplete="off" placeholder="예: 12900"></label>
        <label class="wide">한 줄 설명 (선택 · 공개)<input name="note" maxlength="60" autocomplete="off" placeholder="예: 와우회원 가격 · 로켓배송"></label>
        <label>노출 종료일<input name="ends" type="date"></label>
        <label>정보 출처 메모 (관리자만)<input name="memo" maxlength="200" autocomplete="off" placeholder="예: 에펨코리아 핫딜 11/5"></label>
        <label class="od-check wide"><input type="checkbox" name="recheck">가격을 방금 쿠팡에서 다시 확인했어요 (확인 시각을 지금으로)</label>
        <div class="wide od-pick-actions"><button type="submit" class="primary" id="odPickSubmit">카드 등록</button><button type="button" id="odPickCancel" hidden>수정 취소</button></div>
      </form>
      <div id="odPicks" class="od-items"></div></section>
    <h3>자동 확인 (쿠팡 API · 승인 후)</h3>
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

const kstDay = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
function resetPickForm() {
  const f = $('#odPickForm');
  f.reset(); f.elements.id.value = ''; f.elements.lead.value = '';
  f.elements.ends.value = kstDay(Date.now() + OD_PICK_DEFAULT_DAYS * 864e5);
  $('#odPickSubmit').textContent = '카드 등록'; $('#odPickCancel').hidden = true;
}
function pickRows() {
  const now = Date.now();
  $('#odPicks').innerHTML = (data.picks || []).map(p => {
    const state = p.hidden ? '숨김' : p.live ? '공개 중' : Date.parse(p.endsAt) > now && p.price != null ? '가격 다시 확인 필요' : '노출 끝남';
    const price = p.price == null ? '가격 없음' : p.price_fresh ? `${p.price}원 · ${kst(p.priceCheckedAt)} 확인` : `${p.price}원 (확인 후 24시간 지나 공개 화면에서 내려감 · ${kst(p.priceCheckedAt)} 확인 — '수정·가격 갱신'으로 다시 올리기)`;
    const confirm = pendingDelete === p.id;
    return `<article class="od-item" data-pick-id="${esc(p.id)}"><div class="od-item-top"><span class="pill ${p.live ? 'good' : p.hidden ? '' : 'warn'}">${state}</span><b>${esc(p.title)}</b></div>
      <p>${esc(OD_PICK_CATEGORIES[p.category] || p.category)} · ${esc(price)} · ${esc(kstDay(Date.parse(p.endsAt)))}까지${Date.parse(p.endsAt) <= now ? ' (끝남)' : ''}${p.note ? ` · ${esc(p.note)}` : ''}</p>
      ${p.memo ? `<p class="muted">출처 메모: ${esc(p.memo)}</p>` : ''}
      <div class="od-item-actions"><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer sponsored">링크 확인 ↗</a>
        <button type="button" data-pick-edit>수정·가격 갱신</button><button type="button" data-pick-hide>${p.hidden ? '다시 보이기' : '숨기기'}</button>
        <button type="button" data-pick-delete class="${confirm ? 'danger' : ''}">${confirm ? '정말 삭제' : '삭제'}</button></div></article>`;
  }).join('') || '<p class="muted">아직 올린 카드가 없어요.</p>';
}
function leadRows() {
  const leads = data.leads || [];
  $('#odLeadCount').textContent = leads.length ? `${leads.length}개` : '';
  $('#odLeads').innerHTML = leads.map(l => `<article class="od-item od-lead" data-lead-key="${esc(l.key)}">
    <div class="od-item-top"><span class="pill">${esc(OD_LEAD_SOURCES[l.source]?.name || l.source)}</span><b>${esc(l.title)}</b></div>
    <p class="muted">${esc(kst(l.postedAt || l.foundAt))} 글${l.priceHint ? ` · 제목 속 가격 ${l.priceHint}원` : ''}${l.freeShipping ? ' · 무료배송 표시' : ''} — 게시글 정보라 쿠팡에서 다시 확인하세요</p>
    <div class="od-item-actions">${l.coupangUrl ? `<a href="${esc(l.coupangUrl)}" target="_blank" rel="noopener noreferrer">쿠팡 상품 열기 ↗</a><button type="button" data-lead-copy>상품 주소 복사</button>`
      : `<span class="err-text">${l.affiliateOnly ? '게시글 링크가 다른 사람의 제휴 링크라 쿠팡에서 상품을 직접 찾아 주세요' : '쿠팡 상품 주소를 찾지 못했어요 — 게시글에서 확인'}</span>`}
      <a href="${esc(l.postUrl)}" target="_blank" rel="noopener noreferrer">게시글 보기 ↗</a>
      <button type="button" data-lead-use class="primary">이 후보로 카드 만들기</button><button type="button" data-lead-dismiss>지우기</button></div></article>`).join('')
    || '<p class="muted">새 후보가 없어요. 1시간마다 다시 찾아요.</p>';
}
let pendingDelete = '';
function render(j, note) {
  data = j;
  $('#odAdminContent').hidden = false;
  pendingDelete = '';
  if (!$('#odPickForm').elements.id.value) resetPickForm();
  leadRows(); pickRows(); suppliers(); items(); rules(); runs();
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
  const leadEl = t.closest('[data-lead-key]');
  if (leadEl) {
    const l = (data?.leads || []).find(x => x.key === leadEl.dataset.leadKey);
    if (!l) return;
    if (t.matches('[data-lead-copy]')) {
      navigator.clipboard?.writeText(l.coupangUrl).then(() => message('쿠팡 상품 주소를 복사했어요. 파트너스 간편 링크 만들기에 붙여 넣으세요.'), () => message('복사하지 못했어요. 주소를 직접 열어 주세요.', true));
    } else if (t.matches('[data-lead-use]')) {
      const f = $('#odPickForm');
      resetPickForm();
      f.elements.lead.value = l.key; f.elements.title.value = odLeadName(l.title); f.elements.price.value = l.priceHint ?? '';
      f.elements.memo.value = `${OD_LEAD_SOURCES[l.source]?.name || l.source} 핫딜 ${kst(l.postedAt || l.foundAt)}`;
      $('#odPickSubmit').textContent = '카드 등록 (후보에서)';
      f.scrollIntoView({ block: 'start' }); f.elements.url.focus();
      message('상품명·가격을 채웠어요. 쿠팡에서 가격을 확인하고 간편 링크를 붙여 넣은 뒤 항목을 고르세요.');
    } else if (t.matches('[data-lead-dismiss]')) act({ op: 'lead_dismiss', key: l.key }, '후보를 지웠어요.');
    return;
  }
  const pick = t.closest('[data-pick-id]');
  if (pick) {
    const p = (data?.picks || []).find(x => x.id === pick.dataset.pickId);
    if (!p) return;
    if (t.matches('[data-pick-edit]')) {
      const f = $('#odPickForm');
      f.elements.id.value = p.id; f.elements.title.value = p.title; f.elements.url.value = p.url; f.elements.category.value = p.category; f.elements.note.value = p.note || '';
      f.elements.price.value = p.price ?? ''; f.elements.memo.value = p.memo || ''; f.elements.ends.value = kstDay(Date.parse(p.endsAt)); f.elements.recheck.checked = false;
      $('#odPickSubmit').textContent = '수정 저장'; $('#odPickCancel').hidden = false;
      f.scrollIntoView({ block: 'start' }); f.elements.title.focus();
    } else if (t.matches('[data-pick-hide]')) act({ op: 'pick_hide', id: p.id, hidden: !p.hidden }, p.hidden ? '다시 보이게 했어요.' : '숨겼어요.');
    else if (t.matches('[data-pick-delete]')) {
      // 브라우저 확인 창 대신 같은 버튼을 한 번 더 누르게 한다
      if (pendingDelete !== p.id) { pendingDelete = p.id; pickRows(); return; }
      act({ op: 'pick_delete', id: p.id }, '삭제했어요.');
    }
    return;
  }
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
$('#odPickForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  const day = f.elements.ends.value;
  const editing = !!f.elements.id.value;
  act({ op: 'pick_save', lead_key: f.elements.lead.value || undefined, pick: {
    id: f.elements.id.value || undefined, title: f.elements.title.value, url: f.elements.url.value.trim(), category: f.elements.category.value, note: f.elements.note.value,
    price: f.elements.price.value.replace(/[,\s원]/g, ''), memo: f.elements.memo.value, recheck: f.elements.recheck.checked,
    endsAt: day ? new Date(`${day}T23:59:59+09:00`).toISOString() : '',
  } }, editing ? '수정했어요. 공개 화면에는 1분 안에 반영돼요.' : '카드를 올렸어요. 공개 화면에는 1분 안에 반영돼요.').then(() => {
    if (!$('#odAdminMessage').classList.contains('bad')) resetPickForm();
  });
});
$('#odPickCancel').addEventListener('click', resetPickForm);
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
