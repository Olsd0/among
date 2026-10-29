// Independent, opt-in shopping view. Never merges into the franchise coupon data.
// Only operator-verified, short-lived product facts belong in online-deals.json.
// Product freshness display policy only, not a price guarantee or a data-use permission.
export const ONLINE_DEALS_MAX_AGE = 24 * 60 * 60 * 1000;
export const ONLINE_DEALS_DISCLOSURE = '이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
const COUPANG_HOSTS = new Set(['coupang.com', 'www.coupang.com', 'm.coupang.com', 'link.coupang.com']);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const text = (value, limit = 240) => typeof value === 'string' && value.trim().length <= limit ? value.trim() : '';

export function onlineDealUrl(value, source = false) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\]/.test(value)) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !COUPANG_HOSTS.has(url.hostname)) return '';
    if (source && url.hostname === 'link.coupang.com') return '';
    // Coupon redemption data and account/session parameters never belong in public links.
    for (const key of url.searchParams.keys()) {
      if (/^(token|access_token|authorization|password|session|sessionid|coupon_code|couponcode)$/i.test(key)) return '';
    }
    return value;
  } catch { return ''; }
}

function productImageUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\]/.test(value)) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (url.hostname !== 'thumbnail.coupangcdn.com' && url.hostname !== 'image.coupangcdn.com') return '';
    return value;
  } catch { return ''; }
}

function affiliateUrl(value) {
  if (!value) return false;
  const url = new URL(value);
  return url.hostname === 'link.coupang.com' || [...url.searchParams.keys()].some(key => key.toLowerCase() === 'lptag');
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  return Date.parse(value);
}

export function normalizeOnlineDeal(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const id = text(raw.id, 80), title = text(raw.title, 160), unit = text(raw.unit, 100);
  const url = onlineDealUrl(raw.url), sourceUrl = onlineDealUrl(raw.sourceUrl, true);
  const checked = timestamp(raw.checkedAt), expiry = timestamp(raw.expiresAt);
  // Conditions must remain complete; never shorten or silently drop a restriction.
  const conditions = Array.isArray(raw.conditions) && raw.conditions.length <= 8 ? raw.conditions.map(v => text(v, 300)) : [];
  if (!id || !title || !unit || !url || !sourceUrl || !conditions.length) return null;
  if (conditions.some(condition => !condition)) return null;
  if (!Number.isSafeInteger(raw.price) || raw.price <= 0) return null;
  if (!Number.isFinite(checked) || checked > now || now - checked >= ONLINE_DEALS_MAX_AGE) return null;
  if (!Number.isFinite(expiry) || expiry <= now || expiry <= checked) return null;
  // Every outgoing link counts, including the source, even if the flag was omitted.
  const affiliate = raw.affiliate === true || affiliateUrl(url) || affiliateUrl(sourceUrl);
  return { id, title, unit, url, sourceUrl, checkedAt: raw.checkedAt, expiresAt: raw.expiresAt,
    price: raw.price, conditions, affiliate, imageUrl: productImageUrl(raw.imageUrl),
    category: ['food', 'household'].includes(raw.category) ? raw.category : '',
    validUntil: Math.min(expiry, checked + ONLINE_DEALS_MAX_AGE) };
}

export function normalizeOnlineDeals(payload, now = Date.now()) {
  if (!payload || !Array.isArray(payload.items)) throw new Error('invalid_online_deals');
  const seen = new Set();
  return payload.items.slice(0, 100).map(row => normalizeOnlineDeal(row, now)).filter(row => {
    if (!row || seen.has(row.id)) return false;
    seen.add(row.id); return true;
  }).slice(0, 10);
}

function checkedTime(value) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

export function onlineDealCard(item) {
  const rel = item.affiliate ? 'sponsored noopener noreferrer' : 'noopener noreferrer';
  return `<article class="od-card" data-online-deal="${esc(item.id)}">
    ${item.imageUrl ? `<div class="od-image"><img src="${esc(item.imageUrl)}" alt="" width="96" height="96" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>` : ''}
    <div class="od-product"><div class="od-card-label"><span>쿠팡${item.category === 'food' ? ' · 식품' : item.category === 'household' ? ' · 생활용품' : ''}</span>${item.affiliate ? '<span class="od-ad-label">제휴광고</span>' : ''}</div>
    <h3>${esc(item.title)}</h3><p class="od-unit">${esc(item.unit)}</p><p class="od-price"><span>확인 당시</span> ${item.price}원</p>
    <ul class="od-conditions">${item.conditions.map(condition => `<li>${esc(condition)}</li>`).join('')}</ul>
    <p class="od-checked">${esc(checkedTime(item.checkedAt))} 확인 · 한국 시간</p>
    <div class="od-product-links"><a class="od-product-cta" href="${esc(item.url)}" target="_blank" rel="${rel}">쿠팡에서 가격 확인 <span aria-hidden="true">↗</span><span class="od-sr-only"> (새 탭)</span></a><a class="od-source" href="${esc(item.sourceUrl)}" target="_blank" rel="${rel}">확인 출처<span class="od-sr-only"> (새 탭)</span></a></div></div>
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

export function createOnlineDealsUI(root, options = {}) {
  loadStyles();
  const fallbackUrl = onlineDealUrl(options.goldboxUrl || 'https://www.coupang.com/np/goldbox', true);
  const fallbackAffiliate = affiliateUrl(fallbackUrl);
  const dataUrl = new URL(options.dataUrl || './online-deals.json', location.href);
  let payload = { items: [] }, active = false, loaded = false, loading = false, failed = false;
  let request = null, expiryTimer = 0, controller = null, destroyed = false;
  root.classList.add('od-view');
  root.setAttribute('aria-labelledby', 'onlineDealsTitle');
  root.innerHTML = `<div class="od-heading"><p class="od-eyebrow">필요한 장보기도, 한곳에서</p><h2 id="onlineDealsTitle">온라인 특가</h2><p>식품·생활용품 혜택을 가볍게 둘러보세요.</p></div>
    <p class="od-disclosure" hidden>${ONLINE_DEALS_DISCLOSURE}</p>
    ${fallbackUrl ? `<article class="od-official-entry"><div class="od-entry-top"><span class="od-entry-label">쿠팡 공식 특가${fallbackAffiliate ? ' · 제휴광고' : ''}</span><span class="od-membership">와우회원 전용</span></div><h3>오늘의 골드박스</h3><p>지금 진행 중인 특가 상품과<br>회원 혜택을 쿠팡에서 확인하세요.</p><a href="${esc(fallbackUrl)}" target="_blank" rel="${fallbackAffiliate ? 'sponsored noopener noreferrer' : 'noopener noreferrer'}">쿠팡에서 특가 보기 <span aria-hidden="true">↗</span><span class="od-sr-only"> (새 탭)</span></a></article>` : ''}
    <div class="od-list-heading"><h3>확인한 상품</h3><p class="od-count"></p></div><p class="od-status" role="status" aria-live="polite"></p>
    <div class="od-products-list"></div><p class="od-price-note" hidden>표시 가격은 확인 당시 기준이에요. 옵션·와우회원·쿠폰·배송비에 따라 최종 결제 금액이 달라질 수 있어요.</p>
    <p class="od-footnote">주문과 결제는 쿠팡에서 진행돼요.</p>`;
  const list = root.querySelector('.od-products-list');
  const status = root.querySelector('.od-status');

  function render() {
    clearTimeout(expiryTimer);
    if (destroyed) return;
    let items = [];
    try { items = normalizeOnlineDeals(payload); } catch { /* Failed validation is an empty list, never coupon failure. */ }
    root.setAttribute('aria-busy', String(loading));
    root.querySelector('.od-disclosure').hidden = !fallbackAffiliate && !items.some(item => item.affiliate);
    root.querySelector('.od-count').textContent = items.length ? `${items.length}개` : '';
    root.querySelector('.od-price-note').hidden = !items.length;
    list.innerHTML = items.map(onlineDealCard).join('');
    if (loading) status.textContent = '상품 정보를 확인하고 있어요…';
    else if (failed) status.innerHTML = '<span>상품 정보를 불러오지 못했어요.</span><button type="button" data-od-retry>다시 불러오기</button>';
    else if (!items.length) status.innerHTML = '<strong>확인한 상품을 준비하고 있어요.</strong><span>가격과 조건을 확인한 상품부터 안내할게요.</span>';
    else status.textContent = '';
    status.hidden = !status.textContent;
    if (active && items.length) {
      const next = Math.min(...items.map(item => item.validUntil));
      expiryTimer = setTimeout(render, Math.max(1, next - Date.now() + 20));
    }
  }

  async function refresh() {
    if (destroyed) return;
    if (request) return request;
    loading = true; failed = false; render();
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 8000);
    request = Promise.resolve().then(async () => {
      try {
        if (dataUrl.origin !== location.origin) throw new Error('same_origin_only');
        const response = await fetch(dataUrl.href, { signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
        if (!response.ok) throw new Error('online_deals_unavailable');
        const candidate = await response.json();
        normalizeOnlineDeals(candidate);
        payload = candidate; loaded = true;
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
