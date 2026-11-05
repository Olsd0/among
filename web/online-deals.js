// 온라인 특가 화면 (선택해서 열 때만 불러옴). 프랜차이즈 쿠폰 데이터와 섞지 않는다.
// 상품은 승인된 공급처에서 자동으로 확인해 검증을 통과한 것만 Apps Script가 내려 준다.
// 서버 응답도 그대로 믿지 않고 같은 규칙(online-deals-core.js)으로 다시 검사한다.
import { OD_CATEGORIES, OD_SUPPLIERS, odClientItem, odShippingText, odLink, odIsAffiliateLink } from './online-deals-core.js?v=20261105-2';

const GOLDBOX = 'https://www.coupang.com/np/goldbox';
const API_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 응답 → 화면에 보일 상품 (검사 통과·중복 제거·최대 60개) */
export function normalizeOnlineDeals(payload, now = Date.now()) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) throw new Error('invalid_online_deals');
  const seen = new Set();
  return payload.items.slice(0, 100).map(row => odClientItem(row, now)).filter(item => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id); return true;
  }).slice(0, 60);
}

const kst = value => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));

export function onlineDealCard(item) {
  const sp = OD_SUPPLIERS[item.supplier];
  const rel = item.affiliate ? 'sponsored noopener noreferrer' : 'noopener noreferrer';
  const conditions = (item.membership ? [`${item.membership} 가격`] : []).concat(item.conditions);
  const label = [item.store || sp.name, OD_CATEGORIES[item.category]].filter(Boolean).join(' · ');
  return `<article class="od-card" data-online-deal="${esc(item.id)}">
    ${item.imageUrl ? `<div class="od-image"><img src="${esc(item.imageUrl)}" alt="" width="96" height="96" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>` : ''}
    <div class="od-product"><div class="od-card-label"><span>${esc(label)}</span><span class="od-tags">${item.pick ? `<span class="od-pick">${esc(item.pick)}</span>` : ''}${item.affiliate ? '<span class="od-ad-label">제휴광고</span>' : ''}</span></div>
    <h3>${esc(item.title)}</h3>${item.option || item.seller ? `<p class="od-unit">${esc([item.option, item.seller && `판매자 ${item.seller}`].filter(Boolean).join(' · '))}</p>` : ''}
    <p class="od-price"><span>확인 당시</span> ${item.price}원</p>
    <p class="od-shipping${item.shipping === 'unknown' ? ' unknown' : ''}">${esc(odShippingText(item))}</p>
    ${conditions.length ? `<ul class="od-conditions">${conditions.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    <p class="od-checked">${esc(kst(item.checkedAt))} 확인${item.endsAt ? ` · 행사 종료 ${esc(kst(item.endsAt))}` : ''} · 한국 시간</p>
    <div class="od-product-links"><a class="od-product-cta" href="${esc(item.url)}" target="_blank" rel="${rel}">${esc(sp.cta)} <span aria-hidden="true">↗</span><span class="od-sr-only"> (새 탭)</span></a></div></div>
  </article>`;
}

function loadStyles() {
  if (document.querySelector('link[data-online-deals-style]')) return;
  const href = new URL('./online-deals.css', import.meta.url);
  href.search = new URL(import.meta.url).search;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = href.href; link.dataset.onlineDealsStyle = '';
  document.head.append(link);
}

/** 데이터 주소: Apps Script 웹앱(정확한 형식만) 또는 같은 출처의 JSON(예시 모드·시험) */
function source(options) {
  if (options.apiUrl) {
    if (!API_RE.test(options.apiUrl)) return null;
    const u = new URL(options.apiUrl); u.searchParams.set('action', 'online_deals');
    return { href: u.href, redirect: 'follow' };   // Apps Script는 googleusercontent.com으로 넘겨 응답한다
  }
  const u = new URL(options.dataUrl || './online-deals.json', location.href);
  return u.origin === location.origin ? { href: u.href, redirect: 'error' } : null;
}

export function createOnlineDealsUI(root, options = {}) {
  loadStyles();
  const src = source(options);
  // 골드박스 바로가기: 파트너스 '간편 링크'로 만든 AMONG 제휴 링크(config.onlineDeals.goldboxUrl)가 있으면 그 링크, 없으면 일반 링크.
  // 다른 파트너스 ID가 붙은 링크는 odLink가 거절한다.
  const goldbox = odLink(options.goldboxUrl || '', 'coupang') || GOLDBOX;
  const goldboxAffiliate = odIsAffiliateLink(goldbox);
  let payload = { items: [] }, active = false, loaded = false, loading = false, failed = false;
  let request = null, expiryTimer = 0, controller = null, destroyed = false;
  root.classList.add('od-view');
  root.setAttribute('aria-labelledby', 'onlineDealsTitle');
  root.innerHTML = `<div class="od-heading"><p class="od-eyebrow">필요한 장보기도, 한곳에서</p><h2 id="onlineDealsTitle">온라인 특가</h2><p>식품·생활용품 혜택을 가볍게 둘러보세요.</p></div>
    <div class="od-disclosure" hidden></div>
    <div class="od-list-heading"><h3>확인한 상품</h3><p class="od-count"></p></div><div class="od-status" role="status" aria-live="polite"></div>
    <div class="od-products-list"></div><p class="od-price-note" hidden>표시 가격은 확인 당시 기준이에요. 옵션·회원 여부·쿠폰·배송비에 따라 최종 결제 금액이 달라질 수 있어요. 구매 전 판매처에서 꼭 확인해 주세요.</p>
    <article class="od-official-entry"><div class="od-entry-top"><span class="od-entry-label">쿠팡 공식 특가 바로가기</span><span class="od-membership">와우회원 전용</span>${goldboxAffiliate ? '<span class="od-ad-label">제휴광고</span>' : ''}</div><h3>오늘의 골드박스</h3><p>지금 진행 중인 특가 상품과<br>회원 혜택을 쿠팡에서 확인하세요.</p><a href="${esc(goldbox)}" target="_blank" rel="${goldboxAffiliate ? 'sponsored noopener noreferrer' : 'noopener noreferrer'}">쿠팡에서 특가 보기 <span aria-hidden="true">↗</span><span class="od-sr-only"> (새 탭)</span></a></article>
    <p class="od-footnote">주문과 결제는 각 판매처에서 진행돼요. AMONG은 가격을 보장하지 않아요.</p>`;
  const list = root.querySelector('.od-products-list');
  const status = root.querySelector('.od-status');

  function render() {
    clearTimeout(expiryTimer);
    if (destroyed) return;
    let items = [];
    try { items = normalizeOnlineDeals(payload); } catch { /* 형식이 맞지 않으면 빈 목록 (쿠폰 화면에는 영향 없음) */ }
    root.setAttribute('aria-busy', String(loading));
    // 제휴 링크가 있는 공급처의 고지 문구를 목록보다 먼저 보여 준다 (화면이 가진 목록 기준, 서버 문구를 그대로 쓰지 않음).
    const notes = [...new Set([...(goldboxAffiliate ? [OD_SUPPLIERS.coupang.disclosure] : []), ...items.filter(i => i.affiliate).map(i => OD_SUPPLIERS[i.supplier].disclosure)])];
    const disclosure = root.querySelector('.od-disclosure');
    disclosure.hidden = !notes.length;
    disclosure.innerHTML = notes.map(n => `<p>${esc(n)}</p>`).join('');
    root.querySelector('.od-count').textContent = items.length ? `${items.length}개` : '';
    root.querySelector('.od-price-note').hidden = !items.length;
    list.innerHTML = items.map(onlineDealCard).join('');
    if (loading) status.innerHTML = '<span>상품 정보를 확인하고 있어요…</span>';
    else if (failed) status.innerHTML = '<strong>상품 정보를 불러오지 못했어요.</strong><span>쿠폰 화면은 그대로 쓸 수 있어요.</span><button type="button" data-od-retry>다시 불러오기</button>';
    else if (!items.length && payload.state === 'live') status.innerHTML = '<strong>지금 기준을 통과한 상품이 없어요.</strong><span>가격과 조건은 몇 시간마다 다시 확인해요.</span>';
    else if (!items.length && payload.state === 'delayed') status.innerHTML = '<strong>상품 정보를 다시 확인하고 있어요.</strong><span>확인한 지 오래된 가격은 보여 드리지 않아요. 확인이 끝나면 다시 표시돼요.</span>';
    else if (!items.length) status.innerHTML = '<strong>아직 자동으로 확인한 상품이 없어요.</strong><span>제휴 공급처 연결을 준비하고 있어요. 가격·조건을 확인한 상품만 보여 드릴게요.</span>';
    else status.innerHTML = '';
    status.hidden = !status.innerHTML;
    if (active && items.length) {
      const next = Math.min(...items.map(item => item.visibleUntil));
      expiryTimer = setTimeout(render, Math.max(1000, Math.min(next - Date.now() + 20, 2 ** 31 - 1)));
    }
  }

  async function refresh() {
    if (destroyed) return;
    if (request) return request;
    loading = true; failed = false; render();
    controller = new AbortController();
    // Apps Script는 처음 깨어날 때 수 초가 걸려 쿠폰 조회와 같은 20초를 기다린다.
    const timeout = setTimeout(() => controller?.abort(), 20000);
    request = Promise.resolve().then(async () => {
      try {
        if (!src) throw new Error('bad_source');
        const response = await fetch(src.href, { signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: src.redirect });
        if (!response.ok) throw new Error('online_deals_unavailable');
        const candidate = await response.json();
        if (candidate.ok === false) throw new Error('online_deals_unavailable');
        normalizeOnlineDeals(candidate);
        payload = { items: candidate.items, state: ['live', 'delayed'].includes(candidate.state) ? candidate.state : 'preparing' }; loaded = true;
      } catch {
        payload = { items: [] }; failed = true;
      } finally {
        clearTimeout(timeout); controller = null; request = null; loading = false; render();
      }
    });
    return request;
  }
  function onClick(event) { if (event.target.closest('[data-od-retry]')) void refresh(); }
  function onImageError(event) {
    if (event.target.matches?.('.od-image img')) event.target.closest('.od-image')?.remove();
  }
  function onVisibility() { if (active && !document.hidden) render(); }
  root.addEventListener('click', onClick);
  root.addEventListener('error', onImageError, true);
  document.addEventListener('visibilitychange', onVisibility);
  return {
    show() { active = true; root.hidden = false; render(); if (!loaded && !request) return refresh(); return request || Promise.resolve(); },
    hide() { active = false; root.hidden = true; clearTimeout(expiryTimer); },
    refresh,
    destroy() { destroyed = true; active = false; clearTimeout(expiryTimer); controller?.abort(); root.removeEventListener('click', onClick); root.removeEventListener('error', onImageError, true); document.removeEventListener('visibilitychange', onVisibility); },
  };
}
