// 온라인 특가 화면 (선택해서 열 때만 불러옴). 프랜차이즈 쿠폰 데이터와 섞지 않는다.
// 상품은 승인된 공급처에서 자동으로 확인해 검증을 통과한 것만 Apps Script가 내려 준다.
// 서버 응답도 그대로 믿지 않고 같은 규칙(online-deals-core.js)으로 다시 검사한다.
import { OD_CATEGORIES, OD_SUPPLIERS, OD_PICK_CATEGORIES, odClientItem, odClientPick, odShippingText, odLink, odIsAffiliateLink, OD_PICK_ITEMS } from './online-deals-core.js?v=20261106-3';

const GOLDBOX = 'https://www.coupang.com/np/goldbox';
// 항목별 바로가기 (11/05 대표 요청: 자취에 필요한 물품을 항목별로). 쿠팡 검색 결과 페이지로 보낸다 — AMONG이 고른 상품·가격이 아니다.
// config.onlineDeals.shortcutLinks[key]에 파트너스 '간편 링크'로 바꾼 링크가 있으면 그 링크, 없으면 일반 검색 링크.
export const OD_SHORTCUTS = [
  { group: '먹거리', items: [['water', '생수'], ['ramen', '라면'], ['rice', '즉석밥'], ['frozen', '냉동 간편식']] },
  { group: '생활용품', items: [['tissue', '화장지'], ['wipes', '물티슈'], ['laundry', '세탁세제'], ['dish', '주방세제']] },
];
export const shortcutSearchUrl = label => `https://www.coupang.com/np/search?q=${encodeURIComponent(label)}`;
export function shortcutLinks(overrides = {}) {
  return OD_SHORTCUTS.map(g => ({ group: g.group, items: g.items.map(([key, label]) => {
    const own = overrides && typeof overrides === 'object' ? odLink(overrides[key] || '', 'coupang') : '';
    const url = own || shortcutSearchUrl(label);
    return { key, label, url, affiliate: odIsAffiliateLink(url) };
  }) }));
}
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

/** 직접 고른 쿠팡 특가 (최종 승인 전 대표가 관리 화면에서 올린 간편 링크) — 검사 통과·중복 제거·최대 60개 */
export function normalizePicks(payload, now = Date.now()) {
  if (!payload || !Array.isArray(payload.picks)) return [];
  const seen = new Set();
  return payload.picks.slice(0, 150).map(row => odClientPick(row, now)).filter(p => {
    if (!p || seen.has(p.id)) return false;
    seen.add(p.id); return true;
  }).slice(0, 120);
}

// ---------- 30일 최저 알림 (11/06 대표 결정: 먼저 사이트 안 알림, 이 기기에만 저장 — 가입·서버 저장·개인정보 수집 없음) ----------
const WATCH_KEY = 'among_price_watch', SEEN_KEY = 'among_price_watch_seen';
const PK = /^pk_[0-9a-z]{8,24}$/;
const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
/** 알림을 켠 카드 [{id, t(상품명), at}] (최대 100개) */
export function readWatch() {
  const v = lsGet(WATCH_KEY, []);
  return Array.isArray(v) ? v.filter(w => w && typeof w.id === 'string' && PK.test(w.id)).slice(0, 100) : [];
}
export function toggleWatch(p) {
  const list = readWatch(), on = !list.some(w => w.id === p.id);
  const next = on ? [{ id: p.id, t: String(p.title || '').slice(0, 80), at: new Date().toISOString() }, ...list].slice(0, 100) : list.filter(w => w.id !== p.id);
  return lsSet(WATCH_KEY, next) ? on : null;
}
/** 이미 알려 드린 최저(카드별 가격)는 다시 알리지 않는다 */
export function markWatchSeen(picks) {
  const seen = lsGet(SEEN_KEY, {});
  const next = seen && typeof seen === 'object' && !Array.isArray(seen) ? seen : {};
  picks.forEach(p => { next[p.id] = p.price; });
  const keep = Object.fromEntries(Object.entries(next).filter(([k]) => PK.test(k)).slice(-200));
  lsSet(SEEN_KEY, keep);
  try { navigator.clearAppBadge?.(); } catch { /* 지원 안 함 */ }
}
/** 앱을 열 때: 알림을 켠 카드 중 지금 AMONG 확인 30일 최저이고 아직 알려 드리지 않은 것 */
export async function checkPriceWatch(options = {}) {
  const watch = readWatch();
  if (!watch.length) return [];
  const src = source(options);
  if (!src) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(src.href, { signal: ctrl.signal, credentials: 'omit', cache: 'no-store', redirect: src.redirect });
    if (!res.ok) return [];
    const j = await res.json();
    const ids = new Set(watch.map(w => w.id));
    const seen = lsGet(SEEN_KEY, {}) || {};
    return normalizePicks(j).filter(p => ids.has(p.id) && p.atLow && seen[p.id] !== p.price);
  } catch { return []; } finally { clearTimeout(timer); }
}

const kst = value => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
// 카드 아래 칩용 짧은 시각: 오늘 15:20 / 어제 09:05 / 내일 15:20 / 11/8 15:20 (한국 시간)
export function when(value, now = Date.now()) {
  const t = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 9 * 3600e3), n = new Date(now + 9 * 3600e3);
  const days = Math.round((Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / 864e5);
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${days === 0 ? '오늘' : days === 1 ? '어제' : days === -1 ? '내일' : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`} ${hm}`;
}
const NEW_TAB = '<span class="od-sr-only"> (새 탭)</span><span aria-hidden="true" class="od-arrow">↗</span>';
const BELL = '<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

// 쿠폰 티켓 왼쪽 칸 (메인 쿠폰 카드와 같은 .ticket/.stub). 사진이 있으면 사진을 비율 그대로(자르거나 덮지 않음),
// 사진을 못 불러오면 글자 칸으로 바뀐다(onImageError).
function stubHtml(imageUrl, word, sub) {
  const text = `<span class="lbl-w"><span class="big">${esc(word)}</span><span class="sub">${esc(sub)}</span></span>`;
  if (!imageUrl) return `<span class="stub plain">${text}</span>`;
  return `<span class="stub od-photo"><img class="od-ph" src="${esc(imageUrl)}" alt="" width="120" height="240" loading="lazy" decoding="async" referrerpolicy="no-referrer">${text}</span>`;
}

/** 자동 확인 상품 (쿠팡 API 등, 승인 후) — 조건이 많아 카드 전체가 아닌 버튼으로 이동 */
export function onlineDealCard(item, now = Date.now()) {
  const sp = OD_SUPPLIERS[item.supplier];
  const rel = item.affiliate ? 'sponsored noopener noreferrer' : 'noopener noreferrer';
  const conditions = (item.membership ? [`${item.membership} 가격`] : []).concat(item.conditions);
  const label = [item.store || sp.name, OD_CATEGORIES[item.category]].filter(Boolean).join(' · ');
  return `<article class="card od-card" data-online-deal="${esc(item.id)}"><div class="tk"><div class="ticket od-ticket">
    ${stubHtml(item.imageUrl, sp.name, OD_CATEGORIES[item.category] || '')}
    <div class="body"><div class="who"><span class="bn">${esc(label)}</span><span class="od-tags">${item.pick ? `<span class="od-pick">${esc(item.pick)}</span>` : ''}${item.affiliate ? '<span class="od-ad-label">제휴광고</span>' : ''}</span></div>
    <h3 class="menu">${esc(item.title)}</h3>${item.option || item.seller ? `<p class="od-unit">${esc([item.option, item.seller && `판매자 ${item.seller}`].filter(Boolean).join(' · '))}</p>` : ''}
    <div class="price"><b>${item.price}원</b><span class="what">확인 당시 가격</span></div>
    <p class="od-shipping${item.shipping === 'unknown' ? ' unknown' : ''}">${esc(odShippingText(item))}</p>
    ${conditions.length ? `<ul class="od-conditions">${conditions.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    <div class="foot"><span class="chip">${esc(when(item.checkedAt, now))} 확인${item.endsAt ? ` · ${esc(when(item.endsAt, now))} 종료` : ''}</span>
      <a class="cta od-product-cta" href="${esc(item.url)}" target="_blank" rel="${rel}">${esc(sp.cta)}${NEW_TAB}</a></div></div>
  </div></div></article>`;
}

/**
 * 직접 고른 쿠팡 특가 — 카드 전체가 AMONG 간편 링크. 사진(파트너스 배너)과 확인한 가격을 바로 보이게.
 * 30일 최저(AMONG 확인 기록 3일 이상)는 작은 줄로, 지금 가격이 그 최저면 '30일 최저' 표시. 알림 버튼은 링크 밖(카드 왼쪽 아래)에 둔다.
 */
export function pickCard(p, now = Date.now(), watched = false) {
  const label = p.item ? OD_PICK_ITEMS[p.item].label : OD_PICK_CATEGORIES[p.category];
  const price = p.price ? `<b>${p.price}원</b>${p.atLow ? '<span class="od-low-badge">30일 최저</span>' : '<span class="what">확인 당시 가격</span>'}` : '<span class="what">가격은 쿠팡에서 확인</span>';
  // 항목별 상품은 가격 확인이 지나도 남아 있으므로 '언제까지' 대신 확인 시각만
  const meta = [p.price ? `${when(p.priceCheckedAt, now)} 확인` : p.item ? '' : `${when(p.visibleUntil, now)}까지`,
    p.low30 ? `AMONG 확인 30일 최저 ${p.low30}원 (${p.lowDays}일 기록)` : ''].filter(Boolean).join(' · ');
  return `<li class="card od-pick-li"><a class="tk od-pick-card" data-od-pick="${esc(p.id)}" href="${esc(p.url)}" target="_blank" rel="sponsored noopener noreferrer"><span class="ticket od-ticket">
    ${stubHtml(p.imageUrl, '쿠팡', label)}
    <span class="body"><span class="who"><span class="bn">쿠팡 · ${esc(label)}</span><span class="od-ad-label">제휴광고</span></span>
    <span class="menu">${esc(p.title)}</span>
    <span class="price">${price}</span>
    ${meta ? `<span class="od-meta">${esc(meta)}</span>` : ''}
    ${p.note ? `<span class="conds"><span>${esc(p.note)}</span></span>` : ''}
    <span class="foot"><span class="cta">쿠팡에서 보기${NEW_TAB}</span></span></span>
  </span></a><button type="button" class="od-watch" data-od-watch="${esc(p.id)}" aria-pressed="${watched}">${BELL}<span class="od-watch-text">${watched ? '알림 중' : '최저 알림'}</span><span class="od-sr-only"> ${esc(p.title)}</span></button></li>`;
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
  const shortcuts = shortcutLinks(options.shortcutLinks);
  const shortcutAffiliate = shortcuts.some(g => g.items.some(i => i.affiliate));
  const rel = affiliate => (affiliate ? 'sponsored noopener noreferrer' : 'noopener noreferrer');
  let payload = { items: [], picks: [] }, active = false, loaded = false, loading = false, failed = false, cat = 'all', item = '', watching = new Set();
  let request = null, expiryTimer = 0, controller = null, destroyed = false;
  root.classList.add('od-view');
  root.setAttribute('aria-labelledby', 'onlineDealsTitle');
  root.innerHTML = `<div class="od-heading"><p class="od-eyebrow">필요한 장보기도, 한곳에서</p><h2 id="onlineDealsTitle">온라인 특가</h2><p>식품·생활용품 특가를 쿠폰처럼 사진과 가격으로 둘러보세요.</p></div>
    <div class="od-disclosure" hidden></div>
    <section class="od-watch-section" aria-labelledby="odWatchTitle" hidden><div class="od-list-heading"><h3 id="odWatchTitle">내 최저 알림</h3><p class="od-watch-count"></p></div>
      <p class="od-watch-help">알림을 켠 상품이 AMONG이 확인한 최근 30일 가격 중 가장 낮아지면, AMONG을 열 때 맨 위에 알려 드려요. 알림은 이 기기에만 저장돼요.</p>
      <ul class="od-picks-list od-watch-list" role="list"></ul><p class="od-watch-gone" hidden></p></section>
    <p class="od-sr-only od-watch-live" role="status" aria-live="polite"></p>
    <section class="od-picks" aria-labelledby="odPicksTitle"><div class="od-list-heading"><h3 id="odPicksTitle">AMONG이 고른 쿠팡 특가</h3><p class="od-pick-count"></p></div>
      <div class="od-cats" role="group" aria-label="항목" hidden></div>
      <div class="od-status" role="status" aria-live="polite"></div><ul class="od-picks-list" role="list"></ul>
      <p class="od-pick-note" hidden>가격은 AMONG이 확인한 시각 기준이며, 확인 후 24시간이 지나면 카드가 내려가요. 최종 가격·옵션·배송비는 쿠팡에서 확인하세요.</p></section>
    <section class="od-auto" hidden><div class="od-list-heading"><h3>자동으로 확인한 상품</h3><p class="od-count"></p></div>
    <div class="od-products-list"></div><p class="od-price-note">표시 가격은 확인 당시 기준이에요. 옵션·회원 여부·쿠폰·배송비에 따라 최종 결제 금액이 달라질 수 있어요. 구매 전 판매처에서 꼭 확인해 주세요.</p></section>
    <section class="od-shortcuts" aria-labelledby="odShortcutsTitle"></section>
    <div class="od-official-entry card"><a class="tk" href="${esc(goldbox)}" target="_blank" rel="${rel(goldboxAffiliate)}"><span class="ticket od-ticket">
      <span class="stub gift"><span class="lbl-w"><span class="big">특가</span><span class="sub">매일 바뀌어요</span></span></span>
      <span class="body"><span class="who"><span class="bn">쿠팡 공식 특가</span>${goldboxAffiliate ? '<span class="od-ad-label">제휴광고</span>' : ''}</span>
      <span class="menu">오늘의 골드박스</span><span class="conds"><span>지금 진행 중인 특가 상품</span><span class="od-membership">와우회원 전용</span></span>
      <span class="foot"><span class="cta">쿠팡에서 특가 보기${NEW_TAB}</span></span></span></span></a></div>
    <p class="od-footnote">주문과 결제는 각 판매처에서 진행돼요. AMONG은 가격을 보장하지 않아요.</p>`;
  const list = root.querySelector('.od-products-list');
  const pickList = root.querySelector('.od-picks > .od-picks-list');
  const status = root.querySelector('.od-status');

  // 항목별: 고른 상품이 하나라도 있으면 항목 탭 + 그 항목의 상품 카드 + '쿠팡에서 더 보기', 없으면 검색 바로가기 칩만
  // 내 최저 알림: 알림을 켠 카드 중 지금 공개된 것 (30일 최저인 것 먼저). 보이는 최저는 '알려 드림'으로 표시해 앱 배너에 다시 뜨지 않게
  function renderWatch(all, now) {
    const box = root.querySelector('.od-watch-section');
    const list = readWatch();
    box.hidden = !list.length || loading || failed;
    if (box.hidden) { root.querySelector('.od-watch-list').innerHTML = ''; return; }
    const live = all.filter(p => watching.has(p.id)).sort((a, b) => Number(b.atLow) - Number(a.atLow));
    const gone = list.length - live.length;
    root.querySelector('.od-watch-count').textContent = `${list.length}개`;
    root.querySelector('.od-watch-list').innerHTML = live.map(p => pickCard(p, now, true)).join('');
    const goneEl = root.querySelector('.od-watch-gone');
    goneEl.hidden = !gone;
    goneEl.textContent = gone ? `지금 공개되지 않은 상품 ${gone}개는 다시 올라오면 여기에 보여 드려요.` : '';
    if (active) { const low = live.filter(p => p.atLow); if (low.length) markWatchSeen(low); }
  }

  function renderItems(itemPicks, now) {
    const box = root.querySelector('.od-shortcuts');
    const affiliate = shortcutAffiliate || itemPicks.length > 0;
    const head = `<div class="od-shortcuts-head"><h3 id="odShortcutsTitle">항목별로 둘러보기</h3>${affiliate ? '<span class="od-ad-label">제휴광고</span>' : ''}</div>`;
    const flat = shortcuts.flatMap(g => g.items);
    if (!itemPicks.length) {
      box.innerHTML = `${head}<p>누르면 쿠팡의 해당 항목 검색 결과로 이동해요.</p>
        ${shortcuts.map(g => `<div class="od-sc-group"><h4>${esc(g.group)}</h4><div class="od-sc-row">${g.items.map(i => `<a class="od-sc" data-od-shortcut="${esc(i.key)}" href="${esc(i.url)}" target="_blank" rel="${rel(i.affiliate)}">${esc(i.label)}<span class="od-sr-only"> 쿠팡에서 보기 (새 탭)</span><span aria-hidden="true" class="od-arrow">↗</span></a>`).join('')}</div></div>`).join('')}`;
      return;
    }
    const counts = {};
    itemPicks.forEach(p => { counts[p.item] = (counts[p.item] || 0) + 1; });
    if (!flat.some(i => i.key === item)) item = (flat.find(i => counts[i.key]) || flat[0]).key;
    const sel = flat.find(i => i.key === item);
    const mine = itemPicks.filter(p => p.item === item);
    box.innerHTML = `${head}<p>AMONG이 쿠팡에서 고른 자취 필수품이에요. 가격은 확인 후 24시간만 보여 드려요.</p>
      <div class="od-cats od-item-tabs" role="group" aria-label="항목">${flat.map(i => `<button type="button" class="chip-btn" data-od-item="${esc(i.key)}" aria-pressed="${i.key === item}">${esc(i.label)}${counts[i.key] ? ` <span class="n">${counts[i.key]}</span>` : ''}</button>`).join('')}</div>
      ${mine.length ? `<ul class="od-picks-list od-item-list" role="list">${mine.map(p => pickCard(p, now, watching.has(p.id))).join('')}</ul>` : `<p class="od-item-empty">${esc(sel.label)}은(는) 아직 고른 상품이 없어요.</p>`}
      <a class="od-sc od-item-more" data-od-shortcut="${esc(sel.key)}" href="${esc(sel.url)}" target="_blank" rel="${rel(sel.affiliate)}">쿠팡에서 ${esc(sel.label)} 더 보기<span class="od-sr-only"> (새 탭)</span><span aria-hidden="true" class="od-arrow">↗</span></a>`;
  }

  function render() {
    clearTimeout(expiryTimer);
    if (destroyed) return;
    let items = [];
    try { items = normalizeOnlineDeals(payload); } catch { /* 형식이 맞지 않으면 빈 목록 (쿠폰 화면에는 영향 없음) */ }
    const all = normalizePicks(payload);
    watching = new Set(readWatch().map(w => w.id));
    const picks = all.filter(p => !p.item), itemPicks = all.filter(p => p.item);
    root.setAttribute('aria-busy', String(loading));
    // 제휴 링크가 있는 공급처의 고지 문구를 목록보다 먼저 보여 준다 (화면이 가진 목록 기준, 서버 문구를 그대로 쓰지 않음).
    const notes = [...new Set([...(goldboxAffiliate || shortcutAffiliate || all.length ? [OD_SUPPLIERS.coupang.disclosure] : []), ...items.filter(i => i.affiliate).map(i => OD_SUPPLIERS[i.supplier].disclosure)])];
    const disclosure = root.querySelector('.od-disclosure');
    disclosure.hidden = !notes.length;
    disclosure.innerHTML = notes.map(n => `<p>${esc(n)}</p>`).join('');
    root.querySelector('.od-count').textContent = items.length ? `${items.length}개` : '';
    root.querySelector('.od-auto').hidden = !items.length;
    list.innerHTML = items.map(item => onlineDealCard(item)).join('');
    root.querySelector('.od-pick-count').textContent = picks.length ? `${picks.length}개` : '';
    // 직접 고른 카드가 없고 자동 확인 상품만 있으면 빈 제목을 숨긴다
    root.querySelector('.od-picks .od-list-heading').hidden = !picks.length && items.length > 0;
    root.querySelector('.od-pick-note').hidden = !picks.some(p => p.price);
    // 항목별 보기 (먹거리·생활용품·기타): 두 항목 이상 올라와 있을 때만 칩을 보여 준다
    const counts = {};
    picks.forEach(p => { counts[p.category] = (counts[p.category] || 0) + 1; });
    const present = Object.keys(OD_PICK_CATEGORIES).filter(k => counts[k]);
    if (!counts[cat]) cat = 'all';
    const cats = root.querySelector('.od-cats');
    cats.hidden = present.length < 2;
    cats.innerHTML = present.length < 2 ? '' : [['all', '전체', picks.length], ...present.map(k => [k, OD_PICK_CATEGORIES[k], counts[k]])]
      .map(([k, label, n]) => `<button type="button" class="chip-btn" data-od-cat="${k}" aria-pressed="${k === cat}">${esc(label)} <span class="n">${n}</span></button>`).join('');
    const now = Date.now();
    pickList.innerHTML = picks.filter(p => cat === 'all' || p.category === cat).map(p => pickCard(p, now, watching.has(p.id))).join('');
    renderWatch(all, now);
    renderItems(itemPicks, now);
    const none = !items.length && !picks.length;
    if (loading) status.innerHTML = '<span>상품 정보를 확인하고 있어요…</span>';
    else if (failed) status.innerHTML = '<strong>상품 정보를 불러오지 못했어요.</strong><span>쿠폰 화면은 그대로 쓸 수 있어요.</span><button type="button" data-od-retry>다시 불러오기</button>';
    else if (none && payload.state === 'live') status.innerHTML = '<strong>지금 기준을 통과한 상품이 없어요.</strong><span>가격과 조건은 몇 시간마다 다시 확인해요.</span>';
    else if (none && payload.state === 'delayed') status.innerHTML = '<strong>상품 정보를 다시 확인하고 있어요.</strong><span>확인한 지 오래된 가격은 보여 드리지 않아요. 확인이 끝나면 다시 표시돼요.</span>';
    else if (none && itemPicks.length) status.innerHTML = '<strong>오늘 올라온 특가는 아직 없어요.</strong><span>아래 항목별 상품을 둘러보세요.</span>';
    else if (none) status.innerHTML = '<strong>아직 올라온 특가가 없어요.</strong><span>아래 항목별 바로가기와 골드박스로 쿠팡 상품을 먼저 둘러보세요.</span>';
    else status.innerHTML = '';
    status.hidden = !status.innerHTML;
    if (active && (items.length || all.length)) {
      const next = Math.min(...items.map(i => i.visibleUntil), ...all.map(p => p.visibleUntil), ...all.filter(p => p.priceUntil).map(p => p.priceUntil));
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
        payload = { items: candidate.items, picks: Array.isArray(candidate.picks) ? candidate.picks : [], state: ['live', 'delayed'].includes(candidate.state) ? candidate.state : 'preparing' }; loaded = true;
      } catch {
        payload = { items: [], picks: [] }; failed = true;
      } finally {
        clearTimeout(timeout); controller = null; request = null; loading = false; render();
      }
    });
    return request;
  }
  function onClick(event) {
    if (event.target.closest('[data-od-retry]')) { void refresh(); return; }
    const c = event.target.closest('[data-od-cat]');
    if (c) { cat = c.dataset.odCat; render(); root.querySelector(`[data-od-cat="${cat}"]`)?.focus(); return; }
    const w = event.target.closest('[data-od-watch]');
    if (w) {
      const p = normalizePicks(payload).find(x => x.id === w.dataset.odWatch);
      if (!p) return;
      const on = toggleWatch(p);
      if (on === null) { w.title = '이 기기에 저장하지 못했어요. 브라우저 저장 설정을 확인해 주세요.'; return; }
      const id = CSS.escape(p.id), inWatch = !!w.closest('.od-watch-list');
      render();
      // 누른 목록의 같은 버튼으로 초점을 돌려준다 (알림 목록에서 끈 카드는 사라지므로 본 목록의 버튼으로)
      (inWatch && root.querySelector(`.od-watch-list [data-od-watch="${id}"]`) || root.querySelector(`.od-picks-list:not(.od-watch-list) [data-od-watch="${id}"]`))?.focus();
      const live = root.querySelector('.od-watch-live');
      if (live) live.textContent = on ? `${p.title} 최저 알림을 켰어요.` : `${p.title} 최저 알림을 껐어요.`;
      return;
    }
    const it = event.target.closest('[data-od-item]');
    if (it) { item = it.dataset.odItem; render(); root.querySelector(`[data-od-item="${item}"]`)?.focus(); }
  }
  // 사진을 못 불러오면 사진만 빼고 글자 칸(쿠팡 · 항목)으로 바꾼다
  function onImageError(event) {
    const img = event.target;
    if (!img.matches?.('.od-ph')) return;
    const stub = img.closest('.stub');
    img.remove();
    if (stub) { stub.classList.remove('od-photo'); stub.classList.add('plain'); }
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
