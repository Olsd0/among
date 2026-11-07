import { request } from './admin-request.js?v=20261107-1';
// 온라인 특가 관리: 공급처 연결 상태·모드, 보류 사유, 숨김·분류 지정, 운영 규칙, 실행 기록.
// 운영자는 예외와 규칙만 다룬다. 상품을 직접 입력하는 기능은 두지 않는다.
import { OD_CATEGORIES, OD_HOLD_LABELS, OD_MODES, OD_RESULTS, OD_STATUSES, OD_PICK_CATEGORIES, OD_PICK_PUBLIC_CATEGORY, OD_PICK_DEFAULT_DAYS, OD_PICK_ITEMS, OD_PICK_ITEM_DAYS, OD_LEAD_SOURCES, odLeadName, odPartnerHtml, odPickImage, odGuessItem } from './online-deals-core.js?v=20261106-4';

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
// 올릴 곳: 위쪽 특가 목록(deal:항목) 또는 항목별 칸(item:생수 등). 항목별 상품은 가격만 24시간 뒤 빠지고 카드는 남는다.
// 11/06 21:08 대표 결정: 먹거리만. 올릴 곳은 먹거리 특가와 먹거리 항목 칸뿐이고, 전에 올린 생활용품·기타 카드는 '먹거리 아님 · 공개 안 함'으로 보인다.
const RETIRED_ITEMS = { tissue: '화장지', wipes: '물티슈', laundry: '세탁세제', dish: '주방세제' };
const isFood = p => (p.item ? !!OD_PICK_ITEMS[p.item] : p.category === OD_PICK_PUBLIC_CATEGORY);
const placeOptions = (blank = false) => `${blank ? '<option value="">올릴 곳 고르기</option>' : ''}<optgroup label="위쪽 특가 목록 (가격 확인 24시간 뒤 카드째 내려감)"><option value="deal:${OD_PICK_PUBLIC_CATEGORY}">특가 · ${OD_PICK_CATEGORIES[OD_PICK_PUBLIC_CATEGORY]}</option></optgroup>
  <optgroup label="항목별 상품 (24시간 뒤 가격만 빠지고 카드는 남음)">${Object.entries(OD_PICK_ITEMS).map(([k, v]) => `<option value="item:${k}">항목별 · ${v.label}</option>`).join('')}</optgroup>`;
const placeOf = p => (p.item ? `item:${p.item}` : `deal:${p.category}`);
const splitPlace = v => { const [kind, key] = String(v || '').split(':'); return kind === 'item' ? { category: OD_PICK_ITEMS[key]?.category || '', item: key } : { category: key || '', item: '' }; };
const placeLabel = p => (p.item ? `항목별 · ${OD_PICK_ITEMS[p.item]?.label || RETIRED_ITEMS[p.item] || p.item}` : `특가 · ${OD_PICK_CATEGORIES[p.category] || p.category}`);
const defaultDays = place => (String(place).startsWith('item:') ? OD_PICK_ITEM_DAYS : OD_PICK_DEFAULT_DAYS);
let data = null, busy = false, bulk = [];

root.innerHTML = `<div class="od-admin-heading"><div><h2>온라인 특가</h2><p>쿠팡 파트너스 최종 승인 전에는 직접 고른 상품의 간편 링크를 카드로 올리고, 승인 뒤에는 공급처 상품을 자동으로 확인·게시합니다. 시각은 한국 시간입니다.</p></div><a href="./?view=onlineDeals" target="_blank" rel="noopener">공개 화면 ↗</a></div>
  <p id="odAdminMessage" class="od-admin-message" role="status">${DEMO ? '예시 모드에서는 온라인 특가 관리를 불러올 수 없어요.' : '상단 관리 토큰으로 불러오기를 눌러 주세요.'}</p>
  <div id="odAdminContent" hidden>
    <section class="od-picks-admin" aria-labelledby="odPicksAdminTitle"><h3 id="odPicksAdminTitle">직접 고른 쿠팡 특가</h3>
      <p class="muted">쿠팡 파트너스 '상품 링크'에서 만든 HTML을 붙여 넣으면 상품 사진과 가격이 바로 보이는 쿠폰 카드로 공개 화면에 올라가요('간편 링크'만 넣으면 사진 없이 올라감). 올릴 곳은 두 가지예요. <b>위쪽 특가 목록</b>은 가격을 넣으면 확인 후 24시간 뒤 카드째 내려가고, <b>항목별 상품</b>(생수·라면·즉석밥·냉동 간편식·화장지·물티슈·세탁세제·주방세제)은 24시간 뒤 가격만 빠지고 카드는 노출 종료일(기본 30일)까지 남아요. '다시 확인'하면 가격이 다시 24시간 보여요. 정보 출처 메모는 여기에만 남아요.</p>
      <div class="od-leads"><h4>자동으로 찾은 후보 <span id="odLeadCount" class="muted"></span></h4>
        <p class="muted">뽐뿌·루리웹 핫딜 게시판의 공개 RSS에서 쿠팡 상품 글만 1시간마다 찾아 여기에만 보여 줘요(공개 화면에는 안 올라감). 쿠팡 상품을 열어 가격·조건을 직접 확인한 뒤, 파트너스 '상품 링크'에서 같은 상품을 찾아 'HTML 복사'(사진 포함)한 것을 아래 칸에 붙여 넣으세요. 사진 없이 올릴 때는 상품 주소를 '간편 링크'로 바꿔 넣어도 돼요.</p>
        <div id="odLeads" class="od-items"></div></div>
      <div class="od-bulk"><h4>항목별 상품 여러 개 한 번에 올리기</h4>
        <p class="muted">파트너스 → 링크 생성 → 상품 링크에서 상품마다 '링크 생성' → 'HTML 복사'한 것을 아래 칸에 이어서 붙여 넣으세요(최대 30개). 상품명으로 항목을 짐작해 두니 확인만 하고, 방금 쿠팡에서 확인한 가격이 있으면 넣으세요.</p>
        <textarea id="odBulkHtml" rows="4" autocomplete="off" spellcheck="false" aria-label="파트너스 상품 링크 HTML 여러 개" placeholder="&lt;a href=&quot;https://link.coupang.com/a/…&quot;&gt;&lt;img …&gt;&lt;/a&gt;&#10;&lt;a href=&quot;https://link.coupang.com/a/…&quot;&gt;&lt;img …&gt;&lt;/a&gt;"></textarea>
        <div id="odBulkRows" class="od-bulk-rows"></div>
        <div class="od-pick-actions" id="odBulkActions" hidden><button type="button" class="primary" id="odBulkSave">모두 등록</button><button type="button" id="odBulkClear">비우기</button></div></div>
      <h4 class="od-single-title">한 개씩 올리기 · 수정</h4>
      <form id="odPickForm" class="od-pick-form" novalidate><input type="hidden" name="id"><input type="hidden" name="lead"><input type="hidden" name="image">
        <label class="wide">쿠팡 파트너스 상품 링크 HTML (사진 포함 · 추천)<textarea name="html" rows="3" autocomplete="off" spellcheck="false" placeholder="&lt;a href=&quot;https://link.coupang.com/a/…&quot;&gt;&lt;img src=&quot;https://…coupangcdn.com/image/affiliate/…&quot; alt=&quot;상품명&quot;&gt;&lt;/a&gt;"></textarea>
          <span class="muted od-hint">파트너스 → 링크 생성 → 상품 링크 → 상품 고르고 '링크 생성' → 'HTML 복사' 결과를 그대로 붙여 넣으면 링크·사진·상품명이 채워져요.</span></label>
        <div class="wide od-pick-photo" hidden><img alt="카드에 들어갈 사진 미리보기" width="60" height="120" referrerpolicy="no-referrer"><div><p>이 사진이 카드 왼쪽에 자르지 않고 그대로 들어가요.</p><button type="button" id="odPickPhotoRemove">사진 빼기</button></div></div>
        <label class="wide">상품명<input name="title" maxlength="80" autocomplete="off" placeholder="예: 삼다수 2L × 12병"></label>
        <label class="wide">쿠팡 파트너스 링크 (HTML을 붙이면 자동 · 간편 링크도 가능)<input name="url" inputmode="url" autocomplete="off" placeholder="https://link.coupang.com/a/…"></label>
        <label>올릴 곳<select name="place">${placeOptions()}</select></label>
        <label>지금 확인한 가격 (선택)<input name="price" inputmode="numeric" autocomplete="off" placeholder="예: 12900"></label>
        <label class="wide">한 줄 설명 (선택 · 공개)<input name="note" maxlength="60" autocomplete="off" placeholder="예: 와우회원 가격 · 로켓배송"></label>
        <label>노출 종료일<input name="ends" type="date"></label>
        <label>정보 출처 메모 (관리자만)<input name="memo" maxlength="200" autocomplete="off" placeholder="예: 에펨코리아 핫딜 11/5"></label>
        <label class="od-check wide"><input type="checkbox" name="recheck">가격을 방금 쿠팡에서 다시 확인했어요 (확인 시각을 지금으로)</label>
        <div class="wide od-pick-actions"><button type="submit" class="primary" id="odPickSubmit">카드 등록</button><button type="button" id="odPickCancel" hidden>수정 취소</button></div>
      </form>
      <details class="od-price-batch"><summary>가격 일괄 기록</summary>
        <p class="muted">쿠팡에서 방금 확인한 가격을 카드 번호와 함께 넣으면 가격·확인 시각을 한꺼번에 바꾸고 30일 최저 계산에 기록해요. 항목별 상품은 노출이 30일 뒤까지 늘어나요. 한 줄에 하나씩 <code>카드번호 가격</code> (예: <code>pk_0123456789abcdef 5690</code>) 또는 JSON. 매일 아침 자동 확인은 GitHub 워크플로(online-prices.yml)로 들어와요.</p>
        <textarea id="odPriceBatch" rows="4" autocomplete="off" spellcheck="false" aria-label="카드 번호와 확인한 가격" placeholder="pk_0123456789abcdef 5690"></textarea>
        <div class="od-pick-actions"><button type="button" id="odPriceBatchSave">가격 기록</button></div></details>
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
  $('#odRulesForm').innerHTML = `<fieldset><legend>게시할 분류</legend>${Object.entries(OD_CATEGORIES).map(([k, v]) => k === 'food' ? `<label class="od-check"><input type="checkbox" name="include" value="${k}"${r.includeCategories.includes(k) ? ' checked' : ''}>${esc(v)}</label>` : `<label class="od-check"><input type="checkbox" disabled>${esc(v)} (먹거리만 다루기로 해서 게시 안 함)</label>`).join('')}</fieldset>
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
// 카드 사진: 파트너스 HTML에서 읽은 쿠팡 배너 주소만 (odPickImage가 다시 검사). 미리보기로 확인하고 뺄 수 있다.
function setPhoto(url) {
  const f = $('#odPickForm'), box = $('.od-pick-photo');
  const safe = odPickImage(url || '');
  f.elements.image.value = safe;
  box.hidden = !safe;
  if (safe) box.querySelector('img').src = safe; else box.querySelector('img').removeAttribute('src');
}
/** 붙여 넣은 파트너스 HTML → 링크·사진·상품명. HTML은 화면에 넣지 않고 글자로만 읽는다 */
function applyPartnerHtml(text) {
  const f = $('#odPickForm');
  if (!/<\s*(a|img)\b/i.test(text)) return false;
  const r = odPartnerHtml(text);
  if (!r.url && !r.imageUrl) { message("붙여 넣은 HTML에서 쿠팡 파트너스 링크(link.coupang.com/a/…)를 찾지 못했어요. 파트너스 '상품 링크'의 'HTML 복사' 결과인지 확인하세요.", true); return true; }
  if (r.url) f.elements.url.value = r.url;
  setPhoto(r.imageUrl);
  // 비어 있거나 후보에서 자동으로 채운 상품명이면 쿠팡 공식 상품명(사진 설명)으로 바꾼다. 직접 고친 이름은 그대로 둔다.
  if (r.title && (!f.elements.title.value.trim() || f.elements.title.value === f.dataset.autoTitle)) { f.elements.title.value = r.title; f.dataset.autoTitle = r.title; }
  message(r.imageRejected ? '링크는 채웠어요. 사진 주소가 쿠팡 파트너스 사진이 아니라 사진은 넣지 않았어요.'
    : r.imageUrl ? '링크·사진·상품명을 채웠어요. 쿠팡에서 확인한 가격과 항목을 고르고 등록하세요.'
    : "링크를 채웠어요. 사진이 없는 HTML이에요 ('이미지+텍스트' HTML을 복사하면 사진도 들어가요).");
  return true;
}
function resetPickForm() {
  const f = $('#odPickForm');
  f.reset(); f.elements.id.value = ''; f.elements.lead.value = ''; delete f.dataset.autoTitle; setPhoto('');
  f.elements.ends.value = kstDay(Date.now() + defaultDays(f.elements.place.value) * 864e5);
  $('#odPickSubmit').textContent = '카드 등록'; $('#odPickCancel').hidden = true;
}
function pickRows() {
  const now = Date.now();
  $('#odPicks').innerHTML = (data.picks || []).map(p => {
    const state = p.hidden ? '숨김' : !isFood(p) ? '먹거리 아님 · 공개 안 함' : p.live ? '공개 중' : Date.parse(p.endsAt) > now && p.price != null ? '가격 다시 확인 필요' : '노출 끝남';
    const price = p.price == null ? '가격 없음' : p.price_fresh ? `${p.price}원 · ${kst(p.priceCheckedAt)} 확인`
      : p.item ? `${p.price}원 (확인 후 24시간 지나 공개 화면에서는 가격만 빠짐 · ${kst(p.priceCheckedAt)} 확인 — '수정·가격 갱신'으로 다시 보이기)`
      : `${p.price}원 (확인 후 24시간 지나 공개 화면에서 내려감 · ${kst(p.priceCheckedAt)} 확인 — '수정·가격 갱신'으로 다시 올리기)`;
    const confirm = pendingDelete === p.id;
    return `<article class="od-item${p.imageUrl ? ' has-thumb' : ''}" data-pick-id="${esc(p.id)}">${p.imageUrl ? `<img class="od-pick-thumb" src="${esc(p.imageUrl)}" alt="" width="40" height="80" loading="lazy" referrerpolicy="no-referrer">` : ''}<div class="od-item-top"><span class="pill ${p.live ? 'good' : p.hidden ? '' : 'warn'}">${state}</span><b>${esc(p.title)}</b>${p.imageUrl ? '' : '<span class="muted">사진 없음</span>'}</div>
      <p>${esc(placeLabel(p))} · ${esc(price)} · ${esc(kstDay(Date.parse(p.endsAt)))}까지${Date.parse(p.endsAt) <= now ? ' (끝남)' : ''}${p.note ? ` · ${esc(p.note)}` : ''}</p>
      ${p.price_stats ? `<p class="${p.at_low ? 'od-low-line' : 'muted'}">AMONG 확인 기록 ${p.price_stats.days}일 · 30일 최저 ${p.price_stats.low}원 · 최고 ${p.price_stats.high}원${p.price_stats.days < 3 ? ' (3일부터 공개 화면에 표시)' : ''}${p.at_low ? ' · 지금 30일 최저' : ''}</p>` : ''}
      ${p.memo ? `<p class="muted">출처 메모: ${esc(p.memo)}</p>` : ''}
      <p class="muted od-pick-id">카드 번호 ${esc(p.id)}</p>
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
    <div class="od-item-actions">${l.coupangUrl ? `<a href="${esc(l.coupangUrl)}" target="_blank" rel="noopener noreferrer">쿠팡 상품 열기 ↗</a><button type="button" data-lead-copy>상품 주소 복사</button><button type="button" data-lead-name>상품명 복사</button>`
      : `<span class="err-text">${l.affiliateOnly ? '게시글 링크가 다른 사람의 제휴 링크라 쿠팡에서 상품을 직접 찾아 주세요' : '쿠팡 상품 주소를 찾지 못했어요 — 게시글에서 확인'}</span>`}
      <a href="${esc(l.postUrl)}" target="_blank" rel="noopener noreferrer">게시글 보기 ↗</a>
      <button type="button" data-lead-use class="primary">이 후보로 카드 만들기</button><button type="button" data-lead-dismiss>지우기</button></div></article>`).join('')
    || '<p class="muted">새 후보가 없어요. 1시간마다 다시 찾아요.</p>';
}
let pendingDelete = '';
function render(j, note) {
  data = j;
  if (typeof note === 'function') note = note(j);
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
    } else if (t.matches('[data-lead-name]')) {
      navigator.clipboard?.writeText(odLeadName(l.title)).then(() => message("상품명을 복사했어요. 파트너스 '상품 링크' 검색에 붙여 넣어 같은 상품을 찾으세요."), () => message('복사하지 못했어요.', true));
    } else if (t.matches('[data-lead-use]')) {
      const f = $('#odPickForm');
      resetPickForm();
      f.elements.lead.value = l.key; f.elements.title.value = odLeadName(l.title).replace(/[\s/·|,-]+$/, ''); f.dataset.autoTitle = f.elements.title.value; f.elements.price.value = l.priceHint ?? ''; // 루리웹 '상품 / 가격 / 세일' 꼴의 남은 구분자는 뺀다
      f.elements.memo.value = `${OD_LEAD_SOURCES[l.source]?.name || l.source} 핫딜 ${kst(l.postedAt || l.foundAt)}`;
      $('#odPickSubmit').textContent = '카드 등록 (후보에서)';
      f.scrollIntoView({ block: 'start' }); f.elements.html.focus();
      message("상품명·가격을 채웠어요. 쿠팡에서 가격을 확인하고 파트너스 상품 링크 HTML(사진 포함)이나 간편 링크를 붙여 넣은 뒤 올릴 곳을 고르세요.");
    } else if (t.matches('[data-lead-dismiss]')) act({ op: 'lead_dismiss', key: l.key }, '후보를 지웠어요.');
    return;
  }
  const pick = t.closest('[data-pick-id]');
  if (pick) {
    const p = (data?.picks || []).find(x => x.id === pick.dataset.pickId);
    if (!p) return;
    if (t.matches('[data-pick-edit]')) {
      const f = $('#odPickForm');
      f.elements.id.value = p.id; f.elements.title.value = p.title; f.elements.url.value = p.url; f.elements.place.value = placeOf(p); f.elements.note.value = p.note || '';
      f.elements.price.value = p.price ?? ''; f.elements.memo.value = p.memo || ''; f.elements.ends.value = kstDay(Date.parse(p.endsAt)); f.elements.recheck.checked = false;
      f.elements.html.value = ''; delete f.dataset.autoTitle; setPhoto(p.imageUrl || '');
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
    id: f.elements.id.value || undefined, title: f.elements.title.value, url: f.elements.url.value.trim(), imageUrl: f.elements.image.value, ...splitPlace(f.elements.place.value), note: f.elements.note.value,
    price: f.elements.price.value.replace(/[,\s원]/g, ''), memo: f.elements.memo.value, recheck: f.elements.recheck.checked,
    endsAt: day ? new Date(`${day}T23:59:59+09:00`).toISOString() : '',
  } }, editing ? '수정했어요. 공개 화면에는 1분 안에 반영돼요.' : '카드를 올렸어요. 공개 화면에는 1분 안에 반영돼요.').then(() => {
    if (!$('#odAdminMessage').classList.contains('bad')) resetPickForm();
  });
});
$('#odPickCancel').addEventListener('click', resetPickForm);
// 새 카드에서 올릴 곳을 바꾸면 노출 종료일 기본값도 바꾼다 (특가 1일, 항목별 30일)
$('#odPickForm').elements.place.addEventListener('change', e => {
  const f = $('#odPickForm');
  if (!f.elements.id.value) f.elements.ends.value = kstDay(Date.now() + defaultDays(e.target.value) * 864e5);
});

// ---------- 여러 개 한 번에 (항목별 상품) ----------
function parseBulk(text) {
  const blocks = String(text || '').slice(0, 60000).match(/<a\b[\s\S]*?<\/a>/gi) || [];
  const out = [];
  for (const b of blocks) {
    const r = odPartnerHtml(b);
    if (r.url && !out.some(x => x.url === r.url)) out.push(r);
  }
  return { found: out, blocks: blocks.length };
}
function bulkRows() {
  $('#odBulkActions').hidden = !bulk.length;
  $('#odBulkRows').innerHTML = bulk.map((r, i) => `<div class="od-bulk-row" data-bulk="${i}">
    ${r.imageUrl ? `<img src="${esc(r.imageUrl)}" alt="" width="40" height="80" referrerpolicy="no-referrer">` : '<span class="od-bulk-nophoto">사진 없음</span>'}
    <div class="od-bulk-fields"><label>상품명<input data-bulk-title maxlength="80" value="${esc(r.title)}"></label>
      <label>올릴 곳<select data-bulk-place>${placeOptions(true)}</select></label>
      <label>확인한 가격 (선택)<input data-bulk-price inputmode="numeric" placeholder="예: 12900" value="${esc(r.price || '')}"></label>
      <button type="button" data-bulk-remove>빼기</button></div></div>`).join('');
  [...root.querySelectorAll('[data-bulk-place]')].forEach((sel, i) => { sel.value = bulk[i].place; });
}
$('#odBulkHtml').addEventListener('input', e => {
  const { found, blocks } = parseBulk(e.target.value);
  // 이미 고친 상품명·올릴 곳·가격은 같은 링크면 그대로 둔다
  bulk = found.slice(0, 30).map(r => bulk.find(b => b.url === r.url) || { ...r, place: odGuessItem(r.title) ? `item:${odGuessItem(r.title)}` : '', price: '' });
  bulkRows();
  if (!blocks) return;
  message(found.length > 30 ? '한 번에 30개까지만 올릴 수 있어요. 앞의 30개만 읽었어요.'
    : found.length < blocks ? `HTML ${blocks}개 중 ${found.length}개를 읽었어요. 나머지는 쿠팡 파트너스 링크가 아니거나 같은 링크예요.`
    : `${found.length}개를 읽었어요. 상품명·올릴 곳·가격을 확인하고 '모두 등록'을 누르세요.`, found.length < blocks);
});
$('#odBulkRows').addEventListener('input', e => {
  const row = e.target.closest('[data-bulk]');
  if (!row) return;
  const r = bulk[Number(row.dataset.bulk)];
  if (e.target.matches('[data-bulk-title]')) r.title = e.target.value;
  else if (e.target.matches('[data-bulk-price]')) r.price = e.target.value;
});
$('#odBulkRows').addEventListener('change', e => {
  const row = e.target.closest('[data-bulk]');
  if (row && e.target.matches('[data-bulk-place]')) bulk[Number(row.dataset.bulk)].place = e.target.value;
});
$('#odBulkRows').addEventListener('click', e => {
  const row = e.target.closest('[data-bulk]');
  if (row && e.target.matches('[data-bulk-remove]')) { bulk.splice(Number(row.dataset.bulk), 1); bulkRows(); }
});
$('#odBulkClear').addEventListener('click', () => { bulk = []; $('#odBulkHtml').value = ''; bulkRows(); message('비웠어요.'); });
$('#odBulkSave').addEventListener('click', () => {
  const missing = bulk.findIndex(r => !r.place);
  if (missing >= 0) { message(`${missing + 1}번 상품의 올릴 곳을 골라 주세요.`, true); root.querySelectorAll('[data-bulk-place]')[missing]?.focus(); return; }
  const n = bulk.length;
  act({ op: 'pick_save_many', picks: bulk.map(r => ({ title: r.title, url: r.url, imageUrl: r.imageUrl, ...splitPlace(r.place), price: String(r.price || '').replace(/[,\s원]/g, ''), endsAt: '' })) },
    `${n}개를 올렸어요. 공개 화면에는 1분 안에 반영돼요.`).then(() => {
    if (!$('#odAdminMessage').classList.contains('bad')) { bulk = []; $('#odBulkHtml').value = ''; bulkRows(); }
  });
});
$('#odPickForm').elements.html.addEventListener('input', e => applyPartnerHtml(e.target.value));
// 링크 칸에 HTML을 통째로 붙여 넣어도 같은 방식으로 읽는다
$('#odPickForm').elements.url.addEventListener('input', e => {
  const v = e.target.value;
  if (!v.includes('<')) return;
  $('#odPickForm').elements.html.value = v; e.target.value = '';
  applyPartnerHtml(v);
});
$('#odPickPhotoRemove').addEventListener('click', () => { setPhoto(''); message('사진을 뺐어요. 카드에는 글자 칸이 들어가요.'); });
// 가격 일괄 기록: '카드번호 가격' 줄 또는 JSON [{id, price}] → pick_prices (서버가 같은 기준으로 다시 검사)
function parsePriceBatch(text) {
  const t = String(text || '').trim();
  if (t.startsWith('[')) { try { return JSON.parse(t); } catch { return null; } }
  const out = [];
  for (const line of t.split('\n').map(x => x.trim()).filter(Boolean)) {
    const m = /^(pk_[0-9a-z]{8,24})\s+([\d,]+)\s*원?$/.exec(line);
    if (!m) return null;
    out.push({ id: m[1], price: Number(m[2].replace(/,/g, '')) });
  }
  return out;
}
$('#odPriceBatchSave').addEventListener('click', () => {
  const prices = parsePriceBatch($('#odPriceBatch').value);
  if (!prices || !prices.length) { message("형식을 확인하세요. 한 줄에 '카드번호 가격' (예: pk_0123456789abcdef 5690)", true); return; }
  act({ op: 'pick_prices', prices }, j => {
    const r = j.price_result || { recorded: 0, missing: [] };
    return `${r.recorded}개 가격을 기록했어요.${r.missing.length ? ` 못 찾은 카드 ${r.missing.length}개(지웠거나 숨긴 카드).` : ''} 공개 화면에는 1분 안에 반영돼요.`;
  }).then(() => { if (!$('#odAdminMessage').classList.contains('bad')) $('#odPriceBatch').value = ''; });
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
