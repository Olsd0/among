import { AC_APPS, AC_FACTS, AC_LINK_LABELS, AC_STATES, acPublic, acLifecycle, acNeedsReview, acBenefit, acAudience, acKST, acOfficialUrl } from './app-coupons.js?v=20261029-8';
export const acEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const esc = acEsc;
const field = (label, value) => `<div class="ac-field"><dt>${esc(label)}</dt><dd>${esc(value || '미확인')}</dd></div>`;
const factText = f => !f || f.state === 'unknown' ? '미확인' : f.state === 'na' ? '해당 없음' + (f.value ? ' · ' + f.value : '') : f.value;
const link = c => acOfficialUrl(c.official_link, c.issuer_app) && AC_LINK_LABELS[c.link_type] ? `<a class="ac-primary" href="${esc(c.official_link)}" target="_blank" rel="noopener noreferrer">${AC_LINK_LABELS[c.link_type]} <span aria-hidden="true">↗</span></a>` : '';
function period(c, prefix) {
  if (c[prefix + '_period_state'] === 'na') return '해당 없음 · ' + c[prefix + '_period_note'];
  return `${acKST(c[prefix + '_start'])} ~ ${acKST(c[prefix + '_end'])} (한국 시간)`;
}
export function acCard(c) {
  const status = acLifecycle(c);
  return `<article class="ac-card" data-app-coupon="${esc(c.id)}">
    <div class="ac-card-top"><span class="ac-brand">${esc(c.brand)}</span><span class="ac-app">${esc(c.issuer_app)} 앱</span></div>
    <h3>${esc(c.product_name)}</h3><p class="ac-benefit">${esc(acBenefit(c))}</p>
    <p class="ac-audience">${esc(acAudience(c))}</p>
    <p class="ac-deadline">사용 ${esc(acKST(c.use_end, true))}까지${Date.now() < Date.parse(c.use_start) ? ` · ${esc(acKST(c.use_start, true))} 시작` : ''}</p>
    ${status !== 'issuing' ? `<p class="ac-status">${AC_STATES[status]}</p>` : ''}
    ${acNeedsReview(c) ? '<p class="ac-review">재확인 필요 · 공식 안내를 확인해 주세요</p>' : ''}
    <div class="ac-actions">${link(c)}<button type="button" data-ac-detail="${esc(c.id)}">조건 상세</button></div>
  </article>`;
}
function detail(c) {
  const longFacts = ['excluded_stores', 'other'];
  const money = n => n === null ? '미확인' : Number(n).toLocaleString('ko-KR') + '원';
  return `<div class="ac-detail-head"><p class="ac-eyebrow">${esc(c.issuer_app)} 앱 · ${esc(c.brand)}</p><button type="button" data-ac-close aria-label="쿠폰 상세 닫기">✕</button></div>
    <h2 id="acDetailTitle">${esc(c.product_name)}</h2><p class="ac-benefit">${esc(acBenefit(c))}</p>
    <p class="ac-audience">${esc(acAudience(c))}</p><p class="ac-status">${AC_STATES[acLifecycle(c)]}</p>
    ${acNeedsReview(c) ? '<p class="ac-review">마지막 확인 후 시간이 지났어요. 현재 발급 여부는 공식 안내에서 확인해 주세요.</p>' : ''}
    <dl class="ac-details">
    ${field('발급 앱 / 사용 브랜드', c.issuer_app + ' / ' + c.brand)}${field('상품 유형', c.item_type)}
    ${field('혜택 설명', c.benefit_note || acBenefit(c))}${field('최종 구매 가격', money(c.final_price))}
    ${field('기준 가격', money(c.regular_price))}
    ${c.benefit_type !== 'point_back' && c.benefit_type !== 'point_exchange' ? field('즉시 할인액 / 할인율', [c.discount_amount === null ? '할인액 미확인' : (c.is_max ? '최대 ' : '') + money(c.discount_amount), c.discount_rate === null ? '할인율 미확인' : (c.is_max ? '최대 ' : '') + c.discount_rate + '%'].join(' / ')) : ''}
    ${field('이용 대상', acAudience(c))}${field('이용 대상 확인 근거', c.audience_evidence)}
    ${field('발급 기간', period(c, 'issue'))}${field('사용 기간', period(c, 'use'))}
    ${Object.entries(AC_FACTS).filter(([k]) => !longFacts.includes(k)).map(([k, label]) => field(label, factText(c.facts[k]))).join('')}
    </dl>
    ${longFacts.map(k => `<details class="ac-long"><summary>${AC_FACTS[k]}</summary><p>${esc(factText(c.facts[k]))}</p></details>`).join('')}
    ${c.app_path ? `<div class="ac-route"><b>앱에서 찾는 방법</b><p>${esc(c.app_path)}</p></div>` : ''}
    <div class="ac-actions">${link(c)}</div>
    <div class="ac-source"><a href="${esc(c.source_url)}" target="_blank" rel="noopener noreferrer">정보 확인에 사용한 공식 출처 ↗</a><p>${esc(c.source_note)}</p>
    <p>조건 마지막 확인: ${esc(acKST(c.checked_at))} (한국 시간)</p><p>링크 접속 확인: ${esc(acKST(c.link_checked_at))} (발급 가능 여부와 별도)</p></div>`;
}
export function createAppCouponUI(root, dialog) {
  let coupons = [], app = '', scope = 'issuing', query = '', openId = '', loading = true, failed = false;
  root.innerHTML = `<div class="ac-intro"><p class="ac-eyebrow">공식 앱 혜택 모아보기</p><h2>앱 전용 쿠폰</h2><p>조건을 살펴보고, 공식 앱에서 직접 받아 사용하세요.</p></div>
    <div class="ac-filters" role="group" aria-label="발급 앱 선택">${['', ...AC_APPS].map(x => `<button type="button" data-ac-app="${esc(x)}" aria-pressed="${!x}">${esc(x || '전체 앱')}</button>`).join('')}</div>
    <div class="ac-controls"><label class="ac-search">사용 브랜드·상품<input id="acSearch" type="search" placeholder="브랜드나 상품 검색"></label><label>쿠폰 상태<select id="acScope"><option value="issuing">새로 발급 가능</option><option value="redeem_only">발급 종료 · 받은 쿠폰</option><option value="all">진행 중 전체</option></select></label></div>
    <p id="acCount" class="ac-count" role="status"></p><div id="acList" class="ac-list"></div>
    <p class="ac-footnote">발급 앱과 사용 브랜드를 함께 안내해요. 실제 발급·사용은 공식 서비스에서 진행하세요. 모든 시간은 한국 시간 기준입니다.</p>`;
  function redraw() {
    const active = coupons.filter(c => acPublic(c));
    const visible = active.filter(c => (!app || c.issuer_app === app) && (!query || `${c.brand} ${c.product_name}`.toLowerCase().includes(query.toLowerCase())) && (scope === 'all' || acLifecycle(c) === scope || (scope === 'redeem_only' && acLifecycle(c) === 'redeem_scheduled')))
      .sort((a, b) => Number(a.recurring) - Number(b.recurring) || (a.use_end || '').localeCompare(b.use_end || ''));
    root.querySelectorAll('[data-ac-app]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.acApp === app)));
    root.querySelector('#acCount').textContent = loading ? '쿠폰을 불러오고 있어요…' : `${visible.length}개${app ? ' · ' + app : ''}`;
    const markup = visible.length ? visible.map(acCard).join('') : `<div class="ac-empty"><span aria-hidden="true">◇</span><h3>${loading ? '공식 혜택을 불러오는 중이에요' : failed ? '쿠폰을 불러오지 못했어요' : '확인된 쿠폰을 준비하고 있어요'}</h3><p>${failed ? '네트워크 연결을 확인하고 다시 불러와 주세요.' : scope === 'redeem_only' ? '발급은 끝났지만 사용할 수 있는 쿠폰이 여기에 표시돼요.' : '대상과 혜택, 기간이 확인된 쿠폰부터 안내해 드릴게요.'}</p></div>`;
    const list = root.querySelector('#acList');
    if (list.innerHTML !== markup) list.innerHTML = markup;
    if (dialog.open && openId) {
      const c = active.find(x => x.id === openId);
      if (!c) { dialog.close(); openId = ''; }
      else {
        const expanded = [...dialog.querySelectorAll('details')].map(d => d.open);
        const html = detail(c);
        if (dialog.querySelector('.ac-dialog-body').innerHTML !== html) {
          dialog.querySelector('.ac-dialog-body').innerHTML = html;
          dialog.querySelectorAll('details').forEach((d, i) => { d.open = expanded[i]; });
        }
      }
    }
  }
  function open(id) {
    const c = coupons.find(c => c.id === id && acPublic(c));
    if (!c) return false;
    openId = id;
    dialog.querySelector('.ac-dialog-body').innerHTML = detail(c);
    if (!dialog.open) dialog.showModal();
    return true;
  }
  root.addEventListener('click', e => {
    const filter = e.target.closest('[data-ac-app]');
    if (filter) { app = filter.dataset.acApp; redraw(); }
    const button = e.target.closest('[data-ac-detail]');
    if (button) open(button.dataset.acDetail);
  });
  root.querySelector('#acScope').addEventListener('change', e => { scope = e.target.value; redraw(); });
  root.querySelector('#acSearch').addEventListener('input', e => { query = e.target.value.trim(); redraw(); });
  dialog.addEventListener('click', e => { if (e.target === dialog || e.target.closest('[data-ac-close]')) dialog.close(); });
  dialog.addEventListener('close', () => { openId = ''; });
  return { open, redraw, update(rows, opts = {}) { coupons = rows || []; loading = !!opts.loading; failed = !!opts.failed; redraw(); } };
}
