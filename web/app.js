// AMONG 화면 스크립트 (index.html에서 분리 — CSP로 인라인 스크립트를 막기 위해)
import {
  sortCoupons, matchesFilters, daysLeft, todayKST, usableBy, myPrograms, matchNutrition, sodiumPercent,
  PROGRAM_LABEL, isFresh, isOpenToEveryone, pickHeadlines, KINDS, benefitLabel, verificationStatus, moneyDigits, formatMoneyLabel,
} from './engine.js';
import { productImage, productPhoto } from './product-images.js';

// ---------- 설정 ----------
const CFG = window.AMONG_CONFIG || {};
const params = new URLSearchParams(location.search);
const API = CFG.apiUrl || '';
const DEMO = params.has('demo') || !API;
const POLL_MS = 15000;

const CATS = [
  { id: '햄버거', icon: '<path d="M4 11a8 6 0 0 1 16 0z"/><path d="M3.5 14.5h17"/><path d="M5 17.5h14a1 1 0 0 1-1 1.5H6a1 1 0 0 1-1-1.5z"/>' },
  { id: '카페', icon: '<path d="M5 8h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 3.5v2M12 3.5v2"/>' },
  { id: '치킨', icon: '<path d="M14.5 4.5a5 5 0 0 1 2.8 8.6c-1.6 1.6-3.8 1.9-5.5 1.2L8.5 17.6a1.8 1.8 0 1 1-2.1-2.1l3.3-3.3c-.7-1.7-.4-3.9 1.2-5.5a5 5 0 0 1 3.6-2.2z"/>' },
  { id: '피자', icon: '<path d="M12 21 3.5 6.5a14 14 0 0 1 17 0z"/><circle cx="10" cy="10" r="1"/><circle cx="14" cy="13" r="1"/>' },
  { id: '디저트', icon: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.6"/><path d="M8 7.5l.5 1M15.5 7l-.6 1M17 13l-1 .2M7 14.5l1-.3"/>' },
  { id: '전체', icon: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>' },
];
// 우리가 직접 그린 아이콘 (브랜드 상품 그림이 아님). 그라데이션은 body 맨 위 <defs>
const ART = {
  햄버거: '<svg viewBox="0 0 48 48" width="100%" height="100%"><path d="M8 22c0-8 7.2-13 16-13s16 5 16 13z" fill="url(#g-bun)"/><g fill="#fff7e3"><ellipse cx="17" cy="15" rx="1.3" ry=".8"/><ellipse cx="24" cy="12.5" rx="1.3" ry=".8"/><ellipse cx="30.5" cy="16" rx="1.3" ry=".8"/></g><path d="M7 23.5h34l-2.8 3.2-3-2-3 2-3-2-3 2-3-2-3 2-3-2-3 2-3-2z" fill="#5cc46b"/><rect x="8" y="27" width="32" height="6.5" rx="3.2" fill="#7a3d20"/><path d="M8.5 35.5h31a0 0 0 0 1 0 0 4.5 4.5 0 0 1-4.5 4.5H13a4.5 4.5 0 0 1-4.5-4.5z" fill="url(#g-bun)"/></svg>',
  카페: '<svg viewBox="0 0 48 48" width="100%" height="100%"><path d="M13.5 15h21l-2.4 25a3 3 0 0 1-3 2.7H19a3 3 0 0 1-3-2.7z" fill="url(#g-coffee)"/><rect x="11" y="11" width="26" height="5" rx="2.5" fill="#4a2a19"/><path d="M15.5 8.5h17l1.3 2.5H14.2z" fill="#6c3b22"/><rect x="15" y="23" width="18" height="8" rx="1.5" fill="#f4e1cb"/><path d="M21 27h6" stroke="#b07a52" stroke-width="1.6" stroke-linecap="round"/></svg>',
  치킨: '<svg viewBox="0 0 48 48" width="100%" height="100%"><path d="M29 30.5l6.5 6.5" stroke="#f6eadb" stroke-width="5" stroke-linecap="round"/><circle cx="37.8" cy="35.6" r="3.3" fill="#f6eadb"/><circle cx="34.6" cy="39.2" r="3.3" fill="#f6eadb"/><ellipse cx="21.5" cy="20.5" rx="13" ry="10.5" transform="rotate(-38 21.5 20.5)" fill="url(#g-chk)"/><path d="M14 17c2-3 5-5 8-5.5" stroke="#ffe7b0" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
  피자: '<svg viewBox="0 0 48 48" width="100%" height="100%"><path d="M24 43 7.5 12.5a31 31 0 0 1 33 0z" fill="url(#g-cheese)"/><path d="M7.5 12.5a31 31 0 0 1 33 0l-2.3 4.3a26.5 26.5 0 0 0-28.4 0z" fill="#c8752c"/><circle cx="19.5" cy="22" r="3.2" fill="#e2442f"/><circle cx="28.5" cy="26" r="2.8" fill="#e2442f"/><circle cx="23.5" cy="33" r="2.3" fill="#e2442f"/><path d="M30 19.5l2 1M16 29l1.6-1" stroke="#5aa64d" stroke-width="1.8" stroke-linecap="round"/></svg>',
  디저트: '<svg viewBox="0 0 48 48" width="100%" height="100%"><g mask="url(#m-donut)"><circle cx="24" cy="25" r="16" fill="#e7b170"/><path d="M24 11.5c8 0 14 6 14 13.5 0 1.5-1.6 2.2-2.6 1.2-1.3-1.2-2.6.6-4 0-1.5-.7-2.4 1.6-4.2 1-1.4-.5-2.2 1.3-3.6.8-1.6-.6-2.7 1.4-4.3.5-1.3-.7-2.6.6-3.8-.3-1.2-.8-2.6.3-3.6-.6-.8-.7-1.5-1-1.5-2.4 0-7.5 6-13.5 13.6-13.7z" fill="url(#g-donut)"/></g><g stroke-width="1.8" stroke-linecap="round"><path d="M17 17.5l1.6 1" stroke="#fff"/><path d="M30 16l-1.2 1.4" stroke="#ffe27a"/><path d="M33 22.5l-1.8.2" stroke="#7fd3ff"/><path d="M15.5 23.5l1.7-.5" stroke="#ffe27a"/><path d="M22 14.5l.6 1.6" stroke="#7fd3ff"/></g></svg>',
  free: '<svg viewBox="0 0 48 48" width="100%" height="100%"><rect x="9" y="21" width="30" height="19" rx="3" fill="url(#g-vio)"/><rect x="7" y="15" width="34" height="8" rx="3" fill="#8d79ff"/><rect x="21.8" y="15" width="4.4" height="25" fill="#ffd34d"/><path d="M24 15c-4-6.5-11-5.5-9.5-1.5 1.2 3 6.5 1.8 9.5 1.5zM24 15c4-6.5 11-5.5 9.5-1.5-1.2 3-6.5 1.8-9.5 1.5z" fill="#ffc21a"/></svg>',
  ending: '<svg viewBox="0 0 48 48" width="100%" height="100%"><path d="M12 10l-4 4M36 10l4 4" stroke="#ff8f99" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="26" r="15" fill="url(#g-red)"/><circle cx="24" cy="26" r="11" fill="#fff"/><path d="M24 19v7.5l5 3" stroke="#e0283b" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M17 41l-2 3M31 41l2 3" stroke="#e0283b" stroke-width="3" stroke-linecap="round"/></svg>',
  telecom: '<svg viewBox="0 0 48 48" width="100%" height="100%"><rect x="13" y="6" width="22" height="37" rx="5" fill="url(#g-blue)"/><rect x="16" y="11" width="16" height="25" rx="2" fill="#eaf2ff"/><g fill="#2d63d6"><rect x="18.5" y="27" width="2.6" height="5" rx="1"/><rect x="22.7" y="23.5" width="2.6" height="8.5" rx="1"/><rect x="26.9" y="19" width="2.6" height="13" rx="1"/></g><circle cx="24" cy="39.6" r="1.4" fill="#eaf2ff"/></svg>',
  pay: '<svg viewBox="0 0 48 48" width="100%" height="100%"><rect x="6" y="13" width="32" height="24" rx="4.5" fill="url(#g-grn)"/><path d="M6 19h32" stroke="#0f7e51" stroke-width="3"/><rect x="26" y="24" width="12" height="8" rx="3" fill="#0f7e51"/><circle cx="35" cy="34" r="8.5" fill="url(#g-gold)"/><path d="M31.8 31.2l1.4 5.6 1.8-4.2 1.8 4.2 1.4-5.6M31.2 33.4h7.6" stroke="#9a6700" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  new: '<svg viewBox="0 0 48 48" width="100%" height="100%"><path d="M24 5l5.4 11.2 12.3 1.7-9 8.6 2.2 12.2L24 33l-10.9 5.7 2.2-12.2-9-8.6 12.3-1.7z" fill="url(#g-gold)"/><path d="M24 12.5l3 6.3 6.9 1" stroke="#fff6cf" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="39" cy="38" r="3" fill="#ffb3d2"/><circle cx="9" cy="37" r="2.2" fill="#8dbbff"/></svg>',
};
const TINT = { 햄버거: '--t-bun', 카페: '--t-cafe', 치킨: '--t-chk', 피자: '--t-piz', 디저트: '--t-des', free: '--t-vio', ending: '--t-red', telecom: '--t-blue', pay: '--t-grn', new: '--t-gold' };
// 핫딜 카드 바탕 (사진이 없을 때): 카테고리 색 그라데이션 + 우리 아이콘 — 브랜드 배너처럼 보이지 않게
const HBG = {
  햄버거: 'linear-gradient(135deg, #ffb54d 0%, #f2702c 100%)', 카페: 'linear-gradient(135deg, #c18a5e 0%, #6f3f22 100%)',
  치킨: 'linear-gradient(135deg, #ffc451 0%, #e2711a 100%)', 피자: 'linear-gradient(135deg, #ff8063 0%, #d33a2b 100%)',
  디저트: 'linear-gradient(135deg, #ff9fc6 0%, #cf4a83 100%)', '': 'linear-gradient(135deg, #9a87ff 0%, #5b3df5 100%)',
};
const ICON = {
  store: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5 12v8h14v-8"/><path d="M10 20v-4h4v4"/></svg>',
  cal: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  heart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  share: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
  flag: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4h11l-1.5 4L16 12H5"/></svg>',
};
const TELECOMS = ['SKT', 'KT', 'LGU+'];
// 공식 링크가 멤버십·결제 서비스면 버튼 이름도 그쪽으로
const LINK_LABELS = [[/tworld\.co\.kr|sktmembership/, 'T멤버십'], [/membership\.kt\.com/, 'KT 멤버십'], [/lguplus\.com/, 'U+ 멤버십'], [/naver\.com/, '네이버페이'], [/happypointcard/, '해피포인트']];

// ---------- 저장소 (이 기기에만 · 실패해도 동작) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
};
const sid = (() => {
  let s = store.get('among_sid', null);
  if (!s) { s = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).replace(/-/g, '').slice(0, 20); store.set('among_sid', s); }
  return s;
})();

// ---------- 상태 ----------
const prefs0 = store.get('among_prefs', {});
// v5 홈: 카테고리 탭 대신 아이콘. 예전 설정의 기본 탭(햄버거)·빠른 칩(통신사·곧 끝나는)은 아이콘으로 옮겨져 처음 한 번 초기화
const prefs = prefs0.v === 5 ? prefs0 : { ...prefs0, category: '전체', kind: '', quick: { ...(prefs0.quick || {}), programsOnly: false, endingSoon: false } };
const state = {
  category: CATS.some((c) => c.id === prefs.category) ? prefs.category : '전체',
  kind: KINDS.some((k) => k.id === prefs.kind) ? prefs.kind : '',
  sort: ['best', 'price', 'rate', 'deadline'].includes(prefs.sort) ? prefs.sort : 'best',
  filters: { itemType: '', channel: '', everyoneOnly: false, maxPrice: '', ...(prefs.filters || {}) },
  quick: { mine: false, programsOnly: false, fresh: false, endingSoon: false, saved: false, ...(prefs.quick || {}) },
  profile: store.get('among_profile', null),      // { telecom, pays: [], newMember }
  saved: new Set(store.get('among_saved', [])),
  q: '',
  coupons: [],
  news: [],
  meta: {},
  loading: true,
  checkingNetwork: false,
  loadFailed: false,
  open: new Set(),
  syncing: false,
  nutrition: null,          // { items, updated_at } — 처음 상세를 열 때 불러옴
  nutritionLoading: null,
};
// '새로 생긴 혜택' 기준 = 지난 방문 시각 (이 기기에만 저장, 30분 안에 다시 열면 같은 방문으로 봄)
const visit = (() => {
  const v = store.get('among_visit', null);
  const now = Date.now();
  if (!v) { store.set('among_visit', { prev: null, last: now }); return { since: null }; }
  if (now - v.last > 30 * 60e3) { store.set('among_visit', { prev: v.last, last: now }); return { since: new Date(v.last).toISOString() }; }
  store.set('among_visit', { ...v, last: now });
  return { since: v.prev ? new Date(v.prev).toISOString() : null };
})();
const savePrefs = () => store.set('among_prefs', { v: 5, category: state.category, kind: state.kind, sort: state.sort, filters: state.filters, quick: { ...state.quick, saved: false } });
const profileObj = () => (state.profile ? { programs: [state.profile.telecom, ...(state.profile.pays || [])].filter(Boolean), newMember: state.profile.newMember !== false } : null);

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const has = (v) => v !== null && v !== undefined && v !== '';
const won = (n) => (!has(n) || Number.isNaN(+n) ? '' : Number(n).toLocaleString('ko-KR'));
// 공식 링크는 https 주소만 (주소가 여러 개 붙어 있으면 첫 번째). 이상한 주소(javascript: 등)는 버림
const safeUrl = (u) => { try { const x = new URL(String(u || '').trim().split(/\s+/)[0]); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; } };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
// 브랜드 아이콘: 공식 사이트 아이콘(파비콘)을 그대로 불러와 표시만 한다 (저장·가공 안 함). 실패하면 카테고리 아이콘
const siteDomain = (u) => { const h = host(u).split('.'); return h.slice(/\.(co|or|go|ne)\.kr$/.test(host(u)) ? -3 : -2).join('.'); };
const brandSite = (c) => (LINK_LABELS.some(([re]) => re.test(c.source_url || '')) ? '' : safeUrl(c.source_url)) || safeUrl(c.official_link);
const logoUrl = (c) => { const d = siteDomain(brandSite(c)); return d && !LINK_LABELS.some(([re]) => re.test(d)) ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64` : ''; };
const logoAlt = (c) => { const u = brandSite(c); try { return u ? `${new URL(u).origin}/favicon.ico` : ''; } catch { return ''; } };
// 구글 아이콘 서비스는 아이콘이 없으면 16px 지구본을 준다 → 공식 사이트 favicon.ico로 한 번 더, 그래도 없으면 카테고리 아이콘
const logoFail = (img) => { const alt = img.dataset.alt; if (alt && img.src !== alt) { img.dataset.alt = ''; img.src = alt; } else img.remove(); };
const logoCheck = (img) => { if (img.naturalWidth <= 16 && img.src.includes('google.com/s2/')) logoFail(img); };
// 연도가 다른 날짜는 연도까지 보여줘 이미 지난 날짜처럼 오해하지 않게 한다.
const md = (iso) => (iso ? `${iso.slice(0, 4) !== todayKST().slice(0, 4) ? `${iso.slice(0, 4)}년 ` : ''}${+iso.slice(5, 7)}/${+iso.slice(8, 10)}` : '');
// 사진은 https 주소만 (수집기가 공식 행사 페이지에서 고른 것). 못 불러오면 사진 없는 모양으로
const safeImg = (u) => { try { const x = new URL(String(u || '').trim()); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; } };
const phFail = (img) => { const box = img.parentElement; if (box) { box.classList.remove('has-ph'); box.classList.add('noph'); } img.remove(); };
const phCheck = (img) => { if (img.naturalWidth && img.naturalWidth < 80) phFail(img); };
// load·error는 위로 전달되지 않으므로 캡처 단계에서 한 번에 받는다 (그려지기 전에 등록됨)
document.addEventListener('load', (e) => { const t = e.target; if (t.tagName !== 'IMG') return; if (t.classList.contains('ph')) phCheck(t); else if (t.classList.contains('logo')) logoCheck(t); }, true);
document.addEventListener('error', (e) => { const t = e.target; if (t.tagName !== 'IMG') return; if (t.classList.contains('ph')) phFail(t); else if (t.classList.contains('logo')) logoFail(t); }, true);

function fmtChecked(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const k = new Date(d.getTime() + 9 * 3600e3);
  const hm = `${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`;
  const day = k.toISOString().slice(0, 10);
  return day === todayKST() ? `오늘 ${hm}` : `${md(day)} ${hm}`;
}

// ---------- 예시 데이터 (가상의 브랜드) ----------
function demoData() {
  const t = todayKST();
  const plus = (n) => new Date(Date.parse(t + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 9 * 864e5).toISOString();
  const c = (o) => ({ discount_type: 'price', audience: '전체', app_only: true, start_date: plus(-3), conditions: '', programs: [], program_note: '', how_to_use: '', stackable: '', source_url: 'https://example.com/promotion', official_link: 'https://example.com/app', checked_at: now, first_seen: old, ...o });
  return {
    last_checked_at: now,
    coupons: [
      c({ id: 'd1', brand: 'A버거', category: '햄버거', menu: '불고기버거 세트', item_type: '세트', regular_price: 8000, coupon_price: 5500, discount_rate: 31, channels: ['매장', '픽업'], end_date: plus(3), conditions: '1인 1회 · 일부 매장 제외', stackable: 'no', how_to_use: 'A버거 앱 쿠폰함에서 받아 키오스크에서 바코드를 찍어요', first_seen: now }),
      c({ id: 'd2', brand: 'B버거', category: '햄버거', menu: '치즈버거 세트', item_type: '세트', regular_price: 8100, coupon_price: 5900, discount_rate: 27, channels: ['매장'], end_date: plus(5) }),
      c({ id: 'd3', brand: 'C버거', category: '햄버거', menu: '클래식버거', item_type: '단품', regular_price: 4900, coupon_price: 3200, discount_rate: 35, channels: ['픽업'], end_date: plus(0), app_only: false }),
      c({ id: 'd4', brand: 'D버거', category: '햄버거', menu: '싸이버거 단품', item_type: '단품', regular_price: 4900, coupon_price: 3500, discount_rate: 29, channels: ['매장', '픽업', '배달'], end_date: plus(9), audience: '신규회원', conditions: '첫 주문 1회' }),
      c({ id: 'd5', brand: 'B버거', category: '햄버거', menu: '전 메뉴', item_type: '기타', coupon_price: null, discount_type: 'percent', discount_value: 20, discount_rate: 20, channels: ['매장', '픽업'], audience: '멤버십', programs: ['SKT', 'KT'], program_note: 'VIP 20% · 일반 10%', app_only: false, end_date: plus(20), official_link: 'https://m.tworld.co.kr/membership/benefit/brand', how_to_use: '결제 전에 통신사 멤버십 바코드를 보여줘요', first_seen: now }),
      c({ id: 'd6', brand: 'E커피', category: '카페', menu: '아메리카노 (R)', item_type: '단품', regular_price: 3200, coupon_price: 1900, discount_rate: 41, channels: ['매장', '픽업'], end_date: plus(4), audience: '전체' }),
      c({ id: 'd7', brand: 'E커피', category: '카페', menu: '전 메뉴', item_type: '기타', coupon_price: null, discount_type: 'point_back', discount_value: 500, discount_rate: null, min_order: 2000, channels: ['매장'], programs: ['네이버페이'], app_only: false, end_date: plus(6), conditions: '현장결제(QR) 2천원 이상, 기간 중 1회' }),
      c({ id: 'd8', brand: 'F피자', category: '피자', menu: '모든 피자', item_type: '기타', coupon_price: null, discount_type: 'percent', discount_value: 50, discount_rate: 50, channels: ['픽업'], audience: '멤버십', programs: ['KT'], program_note: '방문포장 · 2만5천원 이상', app_only: false, end_date: plus(2), stackable: 'no', official_link: 'https://membership.kt.com/discount/partner/PartnerList.do', how_to_use: 'KT 멤버십 앱에서 쿠폰 받기 → F피자 앱 포장 주문 때 쿠폰번호 입력' }),
      c({ id: 'd9', brand: 'G베이커리', category: '디저트', menu: '전 제품', item_type: '기타', coupon_price: null, discount_type: 'percent', discount_value: 20, discount_rate: 20, channels: ['매장'], programs: ['해피포인트'], app_only: true, end_date: plus(1), conditions: '해피포인트 앱 바코드 스캔 시', first_seen: now }),
      c({ id: 'd10', brand: 'H치킨', category: '치킨', menu: '오리지널 치킨', item_type: '단품', discount_type: 'free_item', channels: ['픽업'], end_date: plus(2), conditions: '매주 수요일 1+1', first_seen: now }),
    ],
    news: [
      { id: 'n1', brand: 'F피자', category: '피자', title: 'F피자 화요일 포장 반값', summary: '매주 화요일 F피자 앱에서 포장 주문하면 모든 피자를 반값에 살 수 있어요. KT 멤버십 회원은 쿠폰을 받아 함께 쓸 수 있어요.', discount_label: '50%', start_date: plus(-2), end_date: plus(2), programs: [], image_url: '', related_ids: ['d8'], source_url: 'https://example.com/event', first_seen: now, checked_at: now },
      { id: 'n2', brand: 'E커피', category: '카페', title: 'E커피 아메리카노 1,900원 주간', summary: '이번 주 E커피 앱 주문 시 아메리카노(R)를 1,900원에 팔아요.', discount_label: '1,900원', start_date: plus(-1), end_date: plus(4), programs: [], image_url: '', related_ids: ['d6'], source_url: 'https://example.com/event2', first_seen: now, checked_at: now },
    ],
  };
}
const DEMO_NUTRITION = [
  { brand: 'A버거', name: '불고기버거', serving: '149g', kcal: 386, protein_g: 17.2, sugar_g: 9, sodium_mg: 715, source: '예시 값' },
  { brand: 'C버거', name: '클래식버거', serving: '180g', kcal: 452, protein_g: 21, sugar_g: 7.5, sodium_mg: 820, source: '예시 값' },
  { brand: 'E커피', name: '아메리카노', serving: '355ml', kcal: 10, protein_g: 0.6, sugar_g: 0, sodium_mg: 5, source: '예시 값' },
];

// ---------- 서버 통신 ----------
async function api(action) {
  const u = new URL(API); u.searchParams.set('action', action);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(u, { redirect: 'follow', signal: controller.signal });
    if (!res.ok) throw new Error('서버 연결 오류');
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || '응답 오류');
    return j;
  } finally { clearTimeout(timeout); }
}
async function apiPost(body) {
  const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' });
  return res.json();
}
// 이용 기록은 끌 수 있다: 개인정보처리방침 페이지의 '이용 기록 보내지 않기' 또는 브라우저의 추적 거부(GPC) 신호
const noTrack = () => store.get('among_notrack', false) === true || navigator.globalPrivacyControl === true;
function track(type, extra = {}) {
  if (DEMO || noTrack()) return;
  const body = JSON.stringify({ action: 'event', sid, type, ...extra });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(API, new Blob([body], { type: 'text/plain;charset=utf-8' }))) return;
  } catch { /* 다음 방법으로 */ }
  fetch(API, { method: 'POST', body, keepalive: true, mode: 'no-cors', headers: { 'content-type': 'text/plain;charset=utf-8' } }).catch(() => {});
}

async function loadCoupons() {
  if (DEMO) { applyData(demoData()); return true; }
  const cached = store.get('among_cache', null);
  if (cached && Array.isArray(cached.coupons) && (!cached.news || Array.isArray(cached.news)) && !state.coupons.length) {
    state.checkingNetwork = true;
    applyData(cached);
  }
  try {
    const data = await api('coupons');
    if (!Array.isArray(data.coupons) || (data.news && !Array.isArray(data.news))) throw new Error('잘못된 혜택 응답');
    store.set('among_cache', { coupons: data.coupons, news: data.news || [], last_checked_at: data.last_checked_at });
    state.checkingNetwork = false;
    state.loadFailed = false;
    applyData(data);
    return true;
  } catch (e) {
    state.checkingNetwork = false;
    state.loadFailed = true;
    state.loading = false; render();
    return false;
  }
}
function applyData(data) {
  state.coupons = (data.coupons || []).filter((c) => !c.end_date || c.end_date >= todayKST()).map((c) => ({ ...c, image_url: productImage(c), programs: c.programs || [] }));
  state.news = (data.news || []).filter((n) => !n.end_date || n.end_date >= todayKST()).map((n) => ({ ...n, image_url: productImage(n), discount_label: formatMoneyLabel(n.discount_label), programs: n.programs || [], related_ids: n.related_ids || [] }));
  state.meta = { last_checked_at: data.last_checked_at };
  state.loading = false;
  render();
}

// 영양성분: 상세를 처음 열 때 한 번만 불러오고, 이 기기에 하루 보관
async function loadNutrition() {
  if (state.nutrition) return state.nutrition;
  if (state.nutritionLoading) return state.nutritionLoading;
  state.nutritionLoading = (async () => {
    if (DEMO) return (state.nutrition = { items: DEMO_NUTRITION });
    const cached = store.get('among_nutrition', null);
    if (cached && Date.now() - cached.saved_at < 864e5) return (state.nutrition = cached);
    try {
      const j = await api('nutrition');
      state.nutrition = { items: j.items || [], updated_at: j.updated_at, saved_at: Date.now() };
      store.set('among_nutrition', state.nutrition);
    } catch { state.nutrition = cached || { items: [] }; }
    return state.nutrition;
  })();
  return state.nutritionLoading;
}

// ---------- 화면 조각 ----------
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.id, k.label]));
/** 아이콘 그리드: 위 줄 음식 종류, 아래 줄 혜택 종류. 숫자 = 그 아이콘을 눌렀을 때 보일 개수 */
function renderGrid() {
  const n = (over) => visibleWith(over).length;
  const tile = (key, val, label, art, on, count) => `<button class="gi" data-${key}="${esc(val)}" aria-pressed="${on}" style="--tint: var(${TINT[val]})"><span class="ic" aria-hidden="true">${art}</span>${esc(label)}<span class="n${count ? '' : ' z'}">${count}</span></button>`;
  const cats = CATS.filter((c) => c.id !== '전체').map((c) => tile('cat', c.id, c.id, ART[c.id], state.category === c.id, n({ category: c.id })));
  const kinds = KINDS.map((k) => tile('kind', k.id, k.label, ART[k.id], state.kind === k.id, n({ kind: k.id })));
  $('#grid').innerHTML = cats.join('') + '<hr>' + kinds.join('');
  const kl = state.kind ? KIND_LABEL[state.kind] : '';
  $('#listTitle').textContent = state.category === '전체' && !kl ? '전체 혜택' : `${[state.category === '전체' ? '' : state.category, kl].filter(Boolean).join(' · ')} 혜택`;
  $('#clearGrid').hidden = state.category === '전체' && !state.kind;
}

/** 오늘의 핫딜: 공식 소식 + 마감 임박·새로 시작한 큰 혜택 (엔진 pickHeadlines) */
function hotCard(h, i) {
  const img = safeImg(h.image_url);
  const why = h.reason || '';
  const whyCls = /마감|D-/.test(why) ? '' : why === 'NEW' ? ' n' : ' d';
  const title = h.kind === 'coupon' ? h.title.replace(h.brand, '').trim() || h.title : h.title;
  const lbl = h.label || '';
  const size = /[0-9]원/.test(lbl) ? 'font-size:18px' : lbl.length > 9 ? 'font-size:20px' : lbl.length > 6 ? 'font-size:24px' : '';
  return `<button class="hcard${img ? ' has-ph' : ' noph'}" style="--hbg:${HBG[h.category] || HBG['']}" data-hot="${esc(h.kind)}:${esc(h.id)}" aria-label="${esc(`${i + 1}번째 핫딜: ${h.brand} ${title} ${lbl}`)}">
    ${img ? `<img class="ph" src="${esc(img)}" alt="" loading="${i ? 'lazy' : 'eager'}" referrerpolicy="no-referrer">` : ''}
    <span class="art" aria-hidden="true">${ART[h.category] || ART.free}</span>
    <span class="top">${why ? `<span class="why${whyCls}">${esc(why)}</span>` : ''}<span class="kind">${h.kind === 'news' ? '공식 소식' : (h.programs || []).length ? esc((h.programs || []).map(progLabel).join('·')) : '누구나'}</span></span>
    ${lbl ? `<span class="lbl" style="${size}">${esc(lbl)}</span>` : ''}
    <span class="bt">${title.includes(h.brand) ? '' : `<span class="br">${esc(h.brand)}</span>`}<span class="tt">${esc(title)}</span></span>
  </button>`;
}
function renderHot() {
  // 오래됐거나 확인 시각을 알 수 없는 출처는 '오늘의' 핫딜로 추천하지 않는다.
  const fresh = (x) => verificationStatus(x.checked_at) === 'fresh';
  const hot = state.q ? [] : pickHeadlines(state.coupons.filter(fresh), state.news.filter(fresh), { today: todayKST(), profile: profileObj(), limit: 8 });
  state.hot = hot;
  $('#hot').hidden = !hot.length;
  if (!hot.length) return;
  $('#hotRail').innerHTML = hot.map(hotCard).join('');
  $('#hotDots').innerHTML = hot.length > 1 ? hot.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('') : '';
  $('#hotCount').textContent = hot.length > 1 ? `1 / ${hot.length}` : '';
}

function dueChip(c, today) {
  if (c.start_date && c.start_date > today) return `<span class="chip soon">${ICON.cal}${md(c.start_date)} 시작</span>`;
  const d = daysLeft(c.end_date, today);
  if (d === null) return '';
  if (d > 30) return `<span class="chip">${ICON.cal}~${md(c.end_date)}</span>`;   // 한참 남은 건 날짜만
  return `<span class="chip${d <= 7 ? ' due' : ''}">${ICON.cal}${d === 0 ? '오늘 종료' : `D-${d}`}</span>`;
}

const upTo = (c) => /^최대/.test(c.program_note || '');
const isOnePlusOne = (c) => /1\s*\+\s*1/.test(`${c.menu} ${c.conditions || ''}`);
/** 티켓 왼쪽(절취선 앞) 큰 글자 */
function stubParts(c) {
  const up = upTo(c);
  if (c.discount_type === 'point_back') return { tone: 'pt', big: has(c.discount_rate) ? String(c.discount_rate) : moneyDigits(+c.discount_value), unit: has(c.discount_rate) ? '%' : '원', sub: `${up ? '최대 ' : ''}적립` };
  if (c.discount_type === 'free_item') return { tone: 'gift', big: isOnePlusOne(c) ? '1+1' : '증정', sub: c.discount_rate ? `${c.discount_rate}% 효과` : isOnePlusOne(c) ? '하나 더' : '함께 드려요' };
  if (c.discount_type === 'amount' && c.discount_value) return { tone: 'sale', big: moneyDigits(+c.discount_value), unit: '원', sub: up ? '최대 할인' : '할인' };
  if (has(c.discount_rate)) return { tone: 'sale', big: String(c.discount_rate), unit: '%', sub: up ? '최대 할인' : '할인' };
  if (has(c.coupon_price)) return { tone: 'plain', big: moneyDigits(+c.coupon_price), unit: '원', sub: '특가' };
  return { tone: 'plain', big: '혜택', sub: '앱에서 확인' };
}
/** 티켓 오른쪽 가격 줄 */
function priceLine(c) {
  if (has(c.coupon_price) && c.discount_type !== 'free_item') return `${c.regular_price && c.discount_type !== 'point_back' ? `<s>${won(c.regular_price)}원</s>` : ''}<b>${won(c.coupon_price)}원</b>`;
  const up = upTo(c) ? '최대 ' : '';
  if (c.discount_type === 'percent' && c.discount_rate) return `<span class="what">주문 금액 ${up}${esc(c.discount_rate)}% 할인</span>`;
  if (c.discount_type === 'amount' && c.discount_value) return `<span class="what">${up}${moneyDigits(c.discount_value)}원 할인</span>`;
  if (c.discount_type === 'point_back' && c.discount_value) return `<span class="what">결제 후 ${up}${has(c.discount_rate) ? `${esc(c.discount_rate)}%` : `${moneyDigits(c.discount_value)}원`} 적립</span>`;
  if (c.discount_type === 'free_item') return `<span class="what">${isOnePlusOne(c) ? '하나 사면 하나 더' : '함께 증정'}</span>`;
  return '<span class="what">공식 앱에서 확인</span>';
}

const AUD = { 신규회원: '앱 신규가입 혜택', 멤버십: '멤버십 회원', 개인: '받은 사람만 (개인 쿠폰)' };
const progLabel = (p) => PROGRAM_LABEL[p] || p;

function badges(c) {
  const mine = profileObj() ? myPrograms(c, profileObj()) : [];
  const progs = c.programs || [];
  const out = [];
  if (mine.length) out.push(`<span class="badge b-mine">내 ${esc(mine.map((p) => (TELECOMS.includes(p) ? p : progLabel(p))).join('·'))} 혜택</span>`);
  else if (progs.length) out.push(`<span class="badge b-prog">${esc(progs.length > 2 ? '통신사 멤버십' : progs.map(progLabel).join(' · '))}</span>`);
  if (c.audience === '신규회원' || c.audience === '개인' || (c.audience === '멤버십' && !progs.length)) out.push(`<span class="badge b-aud">${esc(AUD[c.audience])}</span>`);
  if (c.app_only) out.push('<span class="badge b-app">앱 전용</span>');
  if (verificationStatus(c.checked_at) !== 'fresh') out.push('<span class="badge b-stale">출처 재확인 필요</span>');
  if (isFresh(c, todayKST(), visit.since)) out.push(`<span class="badge b-new">${visit.since ? '지난 방문 후 새로' : '새로 생김'}</span>`);
  return out.join('');
}

function ctaLabel(c) {
  const hit = LINK_LABELS.find(([re]) => re.test(safeUrl(c.official_link)));
  return hit ? `${hit[1]} 확인` : '공식 페이지';
}

/** 쓰는 법: 페이지에 적힌 방법이 있으면 그것, 없으면 조건으로 안내 문장을 만든다 */
function howTo(c) {
  const steps = [];
  if (c.how_to_use) steps.push(c.how_to_use);
  const progs = c.programs || [];
  const tel = progs.filter((p) => TELECOMS.includes(p));
  if (!c.how_to_use) {
    if (tel.length) steps.push(`${tel.map(progLabel).join(' 또는 ')} 앱에서 바코드·쿠폰을 준비해요`);
    if (progs.includes('해피포인트')) steps.push('계산할 때 해피포인트 앱 바코드를 보여줘요');
    ['네이버페이', '카카오페이', '토스페이'].filter((p) => progs.includes(p)).forEach((p) => steps.push(`${p}로 결제해요`));
    if (c.audience === '신규회원') steps.push(`${c.brand} 앱에서 신규 회원 혜택과 적용 조건을 확인해요`);
    else if (c.app_only && !progs.length) steps.push(`${c.brand} 앱의 행사 안내에서 적용 방법을 확인해요`);
  }
  const ch = c.channels || [];
  if (ch.length) steps.push(`${ch.join(' · ')} 주문에 쓸 수 있어요`);
  return steps;
}

function nutritionBlock(c) {
  if (!state.nutrition) return state.nutritionLoading ? '<section><h4>영양성분</h4><p class="src">불러오는 중…</p></section>' : '';
  const m = matchNutrition(c, state.nutrition.items);
  if (!m) return '';
  const it = m.item;
  const cell = (v, unit, label) => (has(v) ? `<div><b>${won(v)}<small style="font-size:11px">${unit}</small></b><span>${label}</span></div>` : '');
  const sp = sodiumPercent(it.sodium_mg);
  const basis = [
    m.set ? `세트 중 ${esc(it.name)} 기준 (음료·사이드 제외)` : `${esc(it.name)}${m.basis === 'exact' ? '' : ' 기준'}`,
    it.serving ? esc(String(it.serving).replace(' 기준', '')) : '',
  ].filter(Boolean).join(' · ');
  return `<section><h4>영양성분</h4>
    <div class="nut">${cell(it.kcal, 'kcal', '열량')}${cell(it.protein_g, 'g', '단백질')}${cell(it.sugar_g, 'g', '당류')}${cell(it.sodium_mg, 'mg', `나트륨${has(sp) ? ` ${sp}%` : ''}`)}</div>
    <p class="nut-basis">${basis} · ${esc(it.source || '식약처 공공데이터')}</p></section>`;
}

function detailHtml(c, today) {
  const progs = c.programs || [];
  const cond = [c.min_order ? `${won(c.min_order)}원 이상 주문` : '', c.max_discount ? `최대 ${moneyDigits(c.max_discount)}원 할인` : '', !progs.length ? c.program_note : '', c.conditions].filter(Boolean).join(' · ');
  const period = c.end_date
    ? `${c.start_date ? md(c.start_date) + ' ~ ' : ''}${md(c.end_date)}까지 (${daysLeft(c.end_date, today) === 0 ? '오늘 끝나요' : daysLeft(c.end_date, today) + '일 남음'})`
    : '종료일 정보 없음 · 공식 페이지에서 확인해요';
  const need = progs.length ? `${progs.map(progLabel).join(' 또는 ')}${c.program_note ? ` (${c.program_note})` : ''}`
    : c.audience === '전체' ? (c.app_only ? `${c.brand} 앱 회원 누구나` : '누구나') : AUD[c.audience];
  const src = safeUrl(c.source_url);
  const steps = howTo(c);
  const saved = state.saved.has(c.id);
  return `
    ${steps.length ? `<section><h4>이렇게 쓰세요</h4><ol class="howto">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></section>` : ''}
    <section><h4>꼭 확인할 조건</h4><dl>
      <dt>필요</dt><dd>${esc(need)}</dd>
      <dt>기간</dt><dd>${esc(period)}</dd>
      ${cond ? `<dt>조건</dt><dd>${esc(cond)}</dd>` : ''}
      ${c.stackable === 'no' ? '<dt>중복</dt><dd class="warn-line">다른 쿠폰·할인과 같이 못 써요</dd>' : c.stackable === 'yes' ? '<dt>중복</dt><dd>다른 할인과 같이 쓸 수 있어요</dd>' : ''}
    </dl></section>
    <div data-nut="${esc(c.id)}">${nutritionBlock(c)}</div>
    ${src ? `<section><p class="src">출처 <a href="${esc(src)}" target="_blank" rel="noopener">${esc(host(src))} 공식 페이지</a> · ${fmtChecked(c.checked_at) ? `${esc(fmtChecked(c.checked_at))} 확인` : '확인 시각 정보 없음'}${productPhoto(c) ? ` · <a href="${esc(productPhoto(c).source)}" target="_blank" rel="noopener">공식 상품 사진 출처</a>` : ''}</p></section>` : ''}
    <div class="acts">
      <button class="act-btn" data-save="${esc(c.id)}" aria-pressed="${saved}">${ICON.heart}${saved ? '찜함' : '찜'}</button>
      <button class="act-btn" data-share="${esc(c.id)}">${ICON.share}공유</button>
      <button class="act-btn" data-report="${esc(c.id)}">${ICON.flag}정보가 달라요</button>
    </div>`;
}

function card(c, today) {
  const open = state.open.has(c.id);
  const link = safeUrl(c.official_link) || safeUrl(c.source_url);
  const ch = (c.channels || []).length ? c.channels.join(' · ') : '';
  const b = badges(c);
  const st = stubParts(c);
  const img = productImage(c);
  // 표시할 글자와 단위를 분리해 HTML을 제거하는 정규식 없이 길이를 계산한다.
  const bigLen = st.big.length + (st.unit || '').length;
  return `
  <article class="card" data-id="${esc(c.id)}" id="card-${esc(c.id)}">
    <div class="tk"><div class="ticket">
      <div class="stub ${st.tone}${img ? ' has-ph' : ''}" aria-hidden="true">
        ${img ? `<img class="ph" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
        <span class="cat-art">${ART[c.category] || ''}</span>
        <div class="lbl-w"><div class="big${st.unit === '원' ? ' money' : ''}"${st.unit === '원' ? '' : bigLen > 6 ? ' style="font-size:19px"' : bigLen > 4 ? ' style="font-size:23px"' : ''}>${esc(st.big)}${st.unit ? `<small>${esc(st.unit)}</small>` : ''}</div><div class="sub">${esc(st.sub)}</div></div>
      </div>
      <div class="body" role="button" tabindex="0" aria-expanded="${open}" aria-controls="dt-${esc(c.id)}">
        <div class="who"><span class="bn">${esc(c.brand)}${ch ? `<span class="chn"> · ${esc(ch)}</span>` : ''}</span>${logoUrl(c) ? `<img class="logo" src="${esc(logoUrl(c))}" alt="" width="22" height="22" loading="lazy" referrerpolicy="no-referrer" data-alt="${esc(logoAlt(c))}">` : ''}</div>
        ${b ? `<div class="badges">${b}</div>` : ''}
        <h3 class="menu"><span class="sr">${esc(c.brand)} </span>${esc(c.menu)}</h3>
        <div class="price">${priceLine(c)}</div>
        <div class="foot">
          ${dueChip(c, today)}
          ${link ? `<a class="cta" href="${esc(link)}" target="_blank" rel="noopener" data-click="${esc(c.id)}">${esc(ctaLabel(c))}${ICON.chev}</a>` : ''}
        </div>
      </div>
    </div></div>
    <div class="detail" id="dt-${esc(c.id)}" ${open ? '' : 'hidden'}>${open ? detailHtml(c, today) : ''}</div>
  </article>`;
}

// ---------- 목록 ----------
// 통신사·곧 마감은 아이콘(아래 줄)으로 옮김
const QUICK = [
  { key: 'mine', label: '내가 쓸 수 있는' },
  { key: 'fresh', label: '새로 생긴' },   // 지난 방문 이후 (첫 방문이면 오늘)
  { key: 'saved', label: '찜' },
];
function baseFilters() {
  return { category: state.category, kind: state.kind, ...state.filters, q: state.q };
}
/** 지금 조건에서 카테고리·혜택 종류만 바꿔 보면 몇 개인지 (아이콘 숫자용) */
function visibleWith(over) {
  const ctx = { today: todayKST(), profile: profileObj() || {}, since: visit.since };
  return state.coupons.filter((c) => matchesFilters(c, { ...baseFilters(), ...quickFilters(), ...over }, ctx));
}
function quickFilters(q = state.quick) {
  return { mine: q.mine, fresh: q.fresh, ids: q.saved ? state.saved : null };
}
function visible(extra = quickFilters()) {
  const today = todayKST();
  const ctx = { today, profile: profileObj() || {}, since: visit.since };
  return state.coupons.filter((c) => matchesFilters(c, { ...baseFilters(), ...extra }, ctx));
}

function renderQuick() {
  // 각 칩 옆 숫자 = 그 칩만 켰을 때 지금 화면에서 보일 개수
  $('#quick').innerHTML = QUICK.map(({ key, label }) => {
    if (key === 'saved' && !state.saved.size) return '';
    const n = visible({ ...quickFilters({ mine: false, fresh: false, saved: false }), ...quickFilters({ [key]: true }) }).length;
    if (!n && !state.quick[key] && key !== 'mine') return '';
    return `<button class="chip-btn" data-quick="${key}" aria-pressed="${!!state.quick[key]}">${label} <span class="n">${n}</span></button>`;
  }).join('');
}

function renderMeBar() {
  const bar = $('#meBar');
  const p = state.profile;
  if (p) {
    const items = [p.telecom ? `${p.telecom} 멤버십` : '', ...(p.pays || [])].filter(Boolean);
    bar.innerHTML = `<span class="grow">${items.length ? `<b>${esc(items.join(' · '))}</b> 기준으로 내가 쓸 수 있는 혜택을 먼저 보여드려요` : '조건 없는 쿠폰을 먼저 보여드려요'}</span><button class="act" data-open-me>변경</button>`;
    bar.hidden = false;
  } else if (!store.get('among_me_dismissed', false)) {
    bar.innerHTML = '<span class="grow">통신사·자주 쓰는 페이를 알려주시면 <b>내가 쓸 수 있는 할인</b>만 골라드려요</span><button class="act" data-open-me>설정</button><button class="x" data-dismiss-me aria-label="닫기">✕</button>';
    bar.hidden = false;
  } else bar.hidden = true;
  $('#meBtn').innerHTML = $('#meBtn').innerHTML.replace(/<span class="dot"><\/span>/, '') + (p ? '<span class="dot"></span>' : '');
}

function renderFreshness() {
  let message = '';
  if (state.loadFailed) message = state.coupons.length || state.news.length
    ? '연결이 불안정해 마지막으로 받은 혜택을 보여드려요. 결제 전 공식 페이지에서 확인해 주세요.'
    : '혜택을 불러오지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.';
  else if (state.checkingNetwork) message = '저장된 혜택을 먼저 보여드려요. 최신 정보를 확인하고 있어요.';
  else if (!state.loading && verificationStatus(state.meta.last_checked_at) !== 'fresh') message = '최근 확인 시각이 오래됐거나 확인되지 않아요. 결제 전 공식 페이지를 확인해 주세요.';
  else if (!state.loading && [...state.coupons, ...state.news].some((x) => verificationStatus(x.checked_at) !== 'fresh')) message = '일부 혜택의 출처를 최근에 확인하지 못했어요. 재확인 표시와 공식 페이지를 살펴봐 주세요.';
  $('#errNote').textContent = message;
  $('#errNote').hidden = !message;
}

function render() {
  const today = todayKST();
  renderFreshness();
  renderMeBar();
  renderGrid();
  renderHot();
  $('#sortSel').value = state.sort;
  const f = state.filters;
  $('#filterBtn').dataset.on = String(!!(f.itemType || f.channel || f.everyoneOnly || f.maxPrice));

  const list = $('#list');
  list.setAttribute('aria-busy', String(state.loading));
  if (state.loading && !state.coupons.length) {
    list.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
    $('#summary').textContent = '';
    $('#quick').innerHTML = '';
    return;
  }
  renderQuick();
  const shown = sortCoupons(visible(), state.sort, today, profileObj());
  const brands = new Set(shown.map((c) => c.brand)).size;
  const usable = profileObj() ? shown.filter((c) => usableBy(c, profileObj())).length : shown.filter(isOpenToEveryone).length;
  $('#summary').textContent = shown.length
    ? `${shown.length}개 · 브랜드 ${brands}곳${profileObj() ? ` · 내가 쓸 수 있는 것 ${usable}개` : ''}`
    : '';

  if (!shown.length) {
    const inCat = state.coupons.some((c) => state.category === '전체' || c.category === state.category);
    const anyQuick = Object.values(state.quick).some(Boolean);
    list.innerHTML = state.loadFailed && !state.coupons.length
      ? '<div class="empty"><b>혜택을 불러오지 못했어요</b>연결을 확인한 뒤 다시 시도해 주세요.<br><button class="chip-btn" data-retry>다시 불러오기</button></div>'
      : inCat
      ? `<div class="empty"><b>조건에 맞는 혜택이 없어요</b>${anyQuick || state.kind ? '위 아이콘이나 빠른 필터를 꺼 보세요.' : '필터나 검색어를 바꿔 보세요.'}${anyQuick || state.kind ? '<br><button class="chip-btn" data-clear-quick>조건 모두 끄기</button>' : ''}</div>`
      : `<div class="empty"><b>${esc(state.category)} 혜택은 준비 중이에요</b>브랜드를 차례로 늘려가고 있어요.</div>`;
  } else {
    list.innerHTML = shown.map((c) => card(c, today)).join('');
  }
  $('#lastChecked').textContent = fmtChecked(state.meta.last_checked_at) ? `매일 공식 페이지 확인을 시도해요 · 마지막 수집 ${fmtChecked(state.meta.last_checked_at)}` : '';
}

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2800);
}

// ---------- 즉시 갱신 (매일 00시 자동 + 버튼) ----------
function setSync(on, text) {
  state.syncing = on;
  $('#refreshBtn').classList.toggle('spin', on);
  $('#syncNote').hidden = !on;
  if (text) $('#syncNote').textContent = text;
}

async function pollUntilDone(sinceIso) {
  const before = new Set(state.coupons.map((c) => c.id));
  const started = Date.now();
  while (Date.now() - started < 30 * 60e3) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    let st;
    try { st = await api('status'); } catch { continue; }
    if (st.state === 'running') setSync(true, '공식 페이지를 확인하고 있어요… 보통 3~5분 걸려요.');
    if (st.state === 'idle' && (!sinceIso || (st.last_finished_at && st.last_finished_at > sinceIso))) {
      const loaded = await loadCoupons();
      setSync(false);
      if (!loaded) { toast('갱신한 혜택을 가져오지 못했어요. 다시 시도해 주세요.'); return; }
      const added = state.coupons.filter((c) => !before.has(c.id)).length;
      toast(st.last_state === 'failed' ? '일부 출처를 확인하지 못했어요. 나중에 다시 시도해 주세요.' : added ? `갱신 완료 · 새 혜택 ${added}개` : '갱신 완료 · 바뀐 혜택이 없어요');
      return;
    }
  }
  setSync(false);
}

async function refresh() {
  if (state.syncing) { toast('이미 확인하고 있어요. 조금만 기다려 주세요.'); return; }
  if (DEMO) { toast('예시 모드에서는 실제 갱신이 일어나지 않아요.'); return; }
  setSync(true, '최신 혜택 확인을 요청했어요…');
  const reqAt = new Date().toISOString();
  try {
    const r = await apiPost({ action: 'refresh' });
    if (!r.ok) throw new Error(r.error);
    if (r.accepted) { setSync(true, '최신 혜택을 확인하고 있어요. 보통 3~5분 걸려요.'); pollUntilDone(reqAt); return; }
    if (r.reason === 'cooldown') { setSync(false); toast(`방금 확인했어요. ${Math.ceil(r.retry_after_s / 60)}분 뒤에 다시 할 수 있어요.`); return; }
    if (r.reason === 'daily_limit') { setSync(false); toast('오늘은 바로 확인을 다 썼어요. 매일 00시에 자동으로 새로 확인해요.'); return; }
    setSync(true, '이미 확인하고 있어요. 끝나면 자동으로 바뀌어요.'); pollUntilDone(null);
  } catch (e) {
    setSync(false); toast('지금은 갱신할 수 없어요. 잠시 후 다시 시도해 주세요.');
  }
}

async function checkStatusOnLoad() {
  if (DEMO) return;
  try {
    const st = await api('status');
    if (st.last_checked_at && !state.meta.last_checked_at) { state.meta.last_checked_at = st.last_checked_at; render(); }
    if (st.state !== 'idle') { setSync(true, '최신 혜택을 확인하고 있어요. 끝나면 자동으로 바뀌어요.'); pollUntilDone(null); }
  } catch { /* 상태 확인 실패는 무시 */ }
}

// ---------- 이벤트 ----------
$('#grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat],[data-kind]'); if (!b) return;
  if (b.dataset.cat) state.category = state.category === b.dataset.cat ? '전체' : b.dataset.cat;
  else state.kind = state.kind === b.dataset.kind ? '' : b.dataset.kind;
  state.open.clear(); savePrefs(); render();
  track('filter', { value: b.dataset.cat ? `cat:${state.category}` : `kind:${state.kind || 'off'}` });
});
$('#clearGrid').addEventListener('click', () => { state.category = '전체'; state.kind = ''; savePrefs(); render(); });
// 핫딜 카드: 소식이면 소식 상세, 쿠폰이면 그 쿠폰으로 이동
$('#hotRail').addEventListener('click', (e) => {
  const b = e.target.closest('[data-hot]'); if (!b) return;
  const [kind, id] = b.dataset.hot.split(/:(.+)/);
  track('detail', { value: `hot:${kind}`, coupon_id: kind === 'coupon' ? id : '' });
  if (kind === 'news') openNews(id); else jumpTo(id);
});
$('#hotRail').addEventListener('scroll', () => {
  const rail = $('#hotRail'); const first = rail.firstElementChild; if (!first) return;
  const i = Math.round(rail.scrollLeft / (first.offsetWidth + 10));
  $('#hotDots').querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === i));
  if (state.hot && state.hot.length > 1) $('#hotCount').textContent = `${Math.min(i + 1, state.hot.length)} / ${state.hot.length}`;
}, { passive: true });
addEventListener('scroll', () => $('header.top').classList.toggle('scrolled', scrollY > 4), { passive: true });

/** 쿠폰 하나로 이동해 펼치기 (핫딜·소식·공유 링크에서) */
function jumpTo(id) {
  const c = state.coupons.find((x) => x.id === id);
  if (!c) { toast('이 혜택은 이미 끝났거나 바뀌었어요.'); return; }
  state.category = c.category || '전체';
  state.kind = '';
  state.q = ''; $('#q').value = '';
  Object.keys(state.quick).forEach((k) => { state.quick[k] = false; });
  state.open.add(id);
  render();
  loadNutrition().then(() => { const box = document.querySelector(`[data-nut="${CSS.escape(id)}"]`); if (box) box.innerHTML = nutritionBlock(c); });
  const el = document.getElementById(`card-${id}`);
  if (el) { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2400); }
}

// 소식 상세 (공식 이벤트·공지를 사실만 짧게 정리 + 원문 링크)
const newsSheet = $('#newsSheet');
function openNews(id) {
  const n = state.news.find((x) => x.id === id);
  if (!n) { toast('이 소식은 이미 끝났거나 바뀌었어요.'); return; }
  const today = todayKST();
  const rel = (n.related_ids || []).map((rid) => state.coupons.find((c) => c.id === rid)).filter(Boolean);
  const img = productImage(n);
  const d = daysLeft(n.end_date, today);
  const period = n.end_date ? `${n.start_date ? `${md(n.start_date)} ~ ` : ''}${md(n.end_date)}까지${d === 0 ? ' (오늘 끝나요)' : d !== null ? ` (${d}일 남음)` : ''}` : n.start_date ? `${md(n.start_date)}부터` : '끝나는 날 공지 없음';
  const need = (n.programs || []).length ? `${n.programs.map(progLabel).join(' 또는 ')} 필요` : '';
  const src = safeUrl(n.source_url);
  $('#newsBody').innerHTML = `
    <div class="news-hero${img ? ' has-ph' : ''}" style="--hbg:${HBG[n.category] || HBG['']}">
      ${img ? `<img class="ph" src="${esc(img)}" alt="" referrerpolicy="no-referrer">` : ''}
      <span class="art" aria-hidden="true">${ART[n.category] || ART.free}</span>
      ${n.discount_label ? `<span class="lbl${/[0-9]원/.test(n.discount_label) ? ' money' : ''}">${esc(n.discount_label)}</span>` : ''}
      <button class="x-close" type="button" data-close aria-label="닫기">✕</button>
    </div>
    <p class="news-meta">${esc(n.brand)} · ${esc(period)}${need ? ` · ${esc(need)}` : ''}</p>
    <h2 class="news-title" id="newsTitle">${esc(n.title)}</h2>
    ${n.summary ? `<p class="news-sum">${esc(n.summary)}</p>` : ''}
    ${rel.length ? `<div class="detail"><h4>이 소식의 쿠폰</h4></div><div class="news-rel">${rel.map((c) => `<button class="rel" type="button" data-rel="${esc(c.id)}"><b>${esc(benefitLabel(c))}</b><span>${esc(c.menu)}</span>${ICON.chev}</button>`).join('')}</div>` : ''}
    <div class="btns">${src ? `<a class="btn primary" href="${esc(src)}" target="_blank" rel="noopener" data-news-src="${esc(n.id)}">공식 공지 보기</a>` : ''}<button class="btn ghost" type="button" data-news-share="${esc(n.id)}">공유</button></div>
    <p class="news-note">AMONG이 ${esc(host(src) || '공식 페이지')}의 행사 내용을 사실만 짧게 정리했어요. 정확한 조건은 공식 공지에서 확인하세요.${img ? ' 사진은 공식 페이지의 이미지예요.' : ''}</p>`;
  if (!newsSheet.open) newsSheet.showModal();
  history.replaceState(null, '', `${location.pathname}?n=${encodeURIComponent(id)}`);
}
// 소식 시트는 저장할 값이 없어서 닫을 때 주소만 정리 (close 이벤트가 오지 않는 웹뷰도 있으므로 닫는 버튼에서도 처리)
function closeNews() { if (newsSheet.open) newsSheet.close(); history.replaceState(null, '', location.pathname); }
newsSheet.addEventListener('click', async (e) => {
  if (e.target === newsSheet || e.target.closest('[data-close]')) { closeNews(); return; }
  const r = e.target.closest('[data-rel]');
  if (r) { closeNews(); jumpTo(r.dataset.rel); return; }
  const sh = e.target.closest('[data-news-share]');
  if (sh) {
    const n = state.news.find((x) => x.id === sh.dataset.newsShare); if (!n) return;
    const url = `${location.origin}${location.pathname}?n=${encodeURIComponent(n.id)}`;
    track('share', { value: `news:${n.id}`, brand: n.brand });
    try {
      if (navigator.share) { await navigator.share({ title: 'AMONG 어몽', text: `${n.title}${n.end_date ? ` (~${md(n.end_date)})` : ''}`, url }); return; }
      await navigator.clipboard.writeText(`${n.title}\n${url}`); toast('링크를 복사했어요.');
    } catch { /* 공유 취소 */ }
    return;
  }
  const out = e.target.closest('[data-news-src]');
  if (out) { const n = state.news.find((x) => x.id === out.dataset.newsSrc); track('click', { value: `news:${out.dataset.newsSrc}`, brand: n?.brand }); }
});
$('#sortSel').addEventListener('change', (e) => { state.sort = e.target.value; savePrefs(); render(); });
$('#quick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-quick]'); if (!b) return;
  const k = b.dataset.quick;
  if (k === 'mine' && !state.profile && !state.quick.mine) { openMe(true); return; }
  state.quick[k] = !state.quick[k]; savePrefs(); render();
  track('filter', { value: `quick:${k}:${state.quick[k] ? 'on' : 'off'}` });
});

$('#list').addEventListener('click', async (e) => {
  if (e.target.closest('[data-retry]')) { state.loading = true; state.loadFailed = false; render(); loadCoupons(); return; }
  const cta = e.target.closest('[data-click]');
  if (cta) { const c = state.coupons.find((x) => x.id === cta.dataset.click); track('click', { coupon_id: c?.id, brand: c?.brand }); return; }
  const rep = e.target.closest('[data-report]');
  if (rep) { openReport(rep.dataset.report); return; }
  const sv = e.target.closest('[data-save]');
  if (sv) { toggleSave(sv.dataset.save, sv); return; }
  const sh = e.target.closest('[data-share]');
  if (sh) { shareCoupon(sh.dataset.share); return; }
  if (e.target.closest('[data-clear-quick]')) { Object.keys(state.quick).forEach((k) => { state.quick[k] = false; }); state.kind = ''; savePrefs(); render(); return; }
  const main = e.target.closest('.body');
  if (main) toggleCard(main);
});
$('#list').addEventListener('keydown', (e) => {
  const main = e.target.closest('.body');
  if (main && !e.target.closest('a, button, input, select, textarea') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleCard(main); }
});
function toggleCard(main) {
  const id = main.closest('.card').dataset.id;
  const dt = document.getElementById('dt-' + id);
  const open = dt.hidden;
  const c = state.coupons.find((x) => x.id === id);
  if (open) {
    state.open.add(id);
    dt.innerHTML = detailHtml(c, todayKST());
    track('detail', { coupon_id: id, brand: c?.brand });
    if (!state.nutrition) loadNutrition().then(() => {
      for (const box of document.querySelectorAll('[data-nut]')) {
        const cc = state.coupons.find((x) => x.id === box.dataset.nut);
        if (cc) box.innerHTML = nutritionBlock(cc);
      }
    });
  } else state.open.delete(id);
  dt.hidden = !open;
  main.setAttribute('aria-expanded', String(open));
}

function toggleSave(id, btn) {
  if (state.saved.has(id)) state.saved.delete(id); else state.saved.add(id);
  store.set('among_saved', [...state.saved]);
  const on = state.saved.has(id);
  btn.setAttribute('aria-pressed', String(on));
  btn.innerHTML = `${ICON.heart}${on ? '찜함' : '찜'}`;
  toast(on ? '찜했어요. 위의 ‘찜’에서 모아볼 수 있어요.' : '찜을 뺐어요.');
  renderQuick();
}

async function shareCoupon(id) {
  const c = state.coupons.find((x) => x.id === id); if (!c) return;
  const url = `${location.origin}${location.pathname}?c=${encodeURIComponent(id)}`;
  const what = has(c.coupon_price) ? `${won(c.coupon_price)}원` : c.discount_rate ? `${c.discount_rate}% 할인` : c.discount_value ? `${moneyDigits(c.discount_value)}원 ${c.discount_type === 'point_back' ? '적립' : '할인'}` : '혜택';
  const text = `${c.brand} ${c.menu} ${what}${c.end_date ? ` (~${md(c.end_date)})` : ''}`;
  track('share', { coupon_id: id, brand: c.brand });
  try {
    if (navigator.share) { await navigator.share({ title: 'AMONG 어몽', text, url }); return; }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('링크를 복사했어요.');
  } catch { /* 공유 취소 */ }
}

$('#searchBtn').addEventListener('click', () => {
  const row = $('#searchRow'); const on = !row.classList.contains('on');
  row.classList.toggle('on', on); $('#searchBtn').setAttribute('aria-expanded', String(on));
  if (on) $('#q').focus(); else { $('#q').value = ''; state.q = ''; render(); }
});
$('#q').addEventListener('input', (e) => { state.q = e.target.value.trim(); render(); });
$('#refreshBtn').addEventListener('click', refresh);

// 시트 저장은 form의 submit에서 처리한다. dialog의 'close' 이벤트에 기대지 않는다:
// 앱 속 브라우저(웹뷰) 중에는 close 이벤트를 보내지 않아 설정이 저장되지 않는 곳이 있었다 (10/27 확인)
function onSheetSubmit(sheet, fn) {
  const form = sheet.querySelector('form');
  form.addEventListener('submit', (e) => {
    const v = (e.submitter && e.submitter.value) || form.querySelector('button:not([type="button"])')?.value || 'ok';
    e.preventDefault();
    sheet.close(v);
    fn(v);
  });
}

// 내 할인 수단 시트
const meSheet = $('#meSheet');
let meDraft = null;
let meTurnOnMine = false;
// 수단별로 지금 모은 혜택 수 (0이면 고른 사람이 '왜 없지?' 하지 않게 이유를 알려 줌)
const programCount = (v) => state.coupons.filter((c) => (c.programs || []).includes(v)).length;
function paintMe() {
  const loaded = state.coupons.length > 0;
  meSheet.querySelectorAll('[data-me] [data-v]').forEach((b) => {
    const v = b.dataset.v;
    const on = b.closest('[data-me]').dataset.me === 'telecom' ? v === (meDraft.telecom || '') : meDraft.pays.includes(v);
    b.setAttribute('aria-pressed', String(on));
    if (!b.dataset.label) b.dataset.label = b.textContent;
    b.innerHTML = esc(b.dataset.label) + (v && loaded ? ` <span class="n">${programCount(v)}</span>` : '');
  });
  $('#meNew').checked = meDraft.newMember !== false;
  const empty = loaded ? [meDraft.telecom, ...meDraft.pays].filter((v) => v && !programCount(v)) : [];
  const note = $('#meNote');
  note.hidden = !empty.length;
  note.textContent = empty.length ? `${empty.map((v) => (v === 'LGU+' ? 'LG U+' : v)).join('·')} 혜택은 아직 모으지 못했어요. 공식 페이지를 읽을 수 있게 되면 자동으로 보여드려요. 그동안은 조건 없는 쿠폰이 먼저 보여요.` : '';
}
function openMe(turnOnMine = false) {
  meTurnOnMine = turnOnMine;
  meDraft = { telecom: '', pays: [], newMember: true, ...(state.profile || {}) };
  meDraft.pays = [...(meDraft.pays || [])];
  paintMe(); meSheet.showModal();
}
$('#meBtn').addEventListener('click', () => openMe(false));
$('#meBar').addEventListener('click', (e) => {
  if (e.target.closest('[data-open-me]')) openMe(!state.profile);
  if (e.target.closest('[data-dismiss-me]')) { store.set('among_me_dismissed', true); render(); }
});
meSheet.addEventListener('click', (e) => {
  const b = e.target.closest('[data-v]');
  if (b) {
    const g = b.closest('[data-me]').dataset.me;
    if (g === 'telecom') meDraft.telecom = b.dataset.v;
    else meDraft.pays = meDraft.pays.includes(b.dataset.v) ? meDraft.pays.filter((x) => x !== b.dataset.v) : [...meDraft.pays, b.dataset.v];
    paintMe();
  }
  if (e.target === meSheet) meSheet.close('cancel');
});
$('#meNew').addEventListener('change', (e) => { meDraft.newMember = e.target.checked; });
$('#meReset').addEventListener('click', () => {
  state.profile = null; store.set('among_profile', null); state.quick.mine = false; savePrefs();
  meSheet.close('cancel'); render(); toast('설정을 지웠어요.');
});
onSheetSubmit(meSheet, (v) => {
  if (v !== 'ok' || !meDraft) return;
  state.profile = meDraft; store.set('among_profile', meDraft);
  if (meTurnOnMine || !state.quick.mine) state.quick.mine = true;
  state.sort = 'best'; savePrefs(); render();
  // 어떤 수단을 고르는지만 익명으로 (서비스에 어떤 출처를 늘릴지 판단용)
  track('filter', { value: `profile:${[meDraft.telecom || '없음', ...meDraft.pays].join(',')}` });
  toast('내가 쓸 수 있는 혜택을 먼저 보여드려요.');
});

// 필터 시트
const fSheet = $('#filterSheet');
let draft = null;
function paintFilter() {
  fSheet.querySelectorAll('.seg').forEach((seg) => seg.querySelectorAll('[data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(draft[seg.dataset.key] || '')))));
  $('#everyoneOnly').checked = !!draft.everyoneOnly;
}
$('#filterBtn').addEventListener('click', () => { draft = { ...state.filters }; paintFilter(); fSheet.showModal(); });
fSheet.addEventListener('click', (e) => {
  const b = e.target.closest('[data-v]');
  if (b) { draft[b.closest('.seg').dataset.key] = b.dataset.v; paintFilter(); }
  if (e.target === fSheet) fSheet.close('cancel');
});
$('#everyoneOnly').addEventListener('change', (e) => { draft.everyoneOnly = e.target.checked; });
$('#filterReset').addEventListener('click', () => { draft = { itemType: '', channel: '', everyoneOnly: false, maxPrice: '' }; paintFilter(); });
onSheetSubmit(fSheet, (v) => {
  if (v === 'ok' && draft) { state.filters = draft; savePrefs(); render(); track('filter', { value: JSON.stringify(draft) }); }
});

// 제보 시트
const rSheet = $('#reportSheet');
let reportId = null;
function openReport(id) {
  const c = state.coupons.find((x) => x.id === id); if (!c) return;
  reportId = id;
  $('#reportForm').reset();
  $('#reportTarget').textContent = `${c.brand} · ${c.menu}${has(c.coupon_price) ? ` · ${won(c.coupon_price)}원` : ''}`;
  rSheet.showModal();
}
$('#reportCancel').addEventListener('click', () => rSheet.close('cancel'));
rSheet.addEventListener('click', (e) => { if (e.target === rSheet) rSheet.close('cancel'); });
onSheetSubmit(rSheet, async (v) => {
  if (v !== 'send' || !reportId) return;
  const c = state.coupons.find((x) => x.id === reportId);
  const fd = new FormData($('#reportForm'));
  if (DEMO) { toast('예시 모드라 제보가 전송되지 않았어요.'); return; }
  try {
    const r = await apiPost({ action: 'report', sid, coupon_id: reportId, brand: c?.brand, menu: c?.menu, reason: fd.get('reason'), memo: fd.get('memo') });
    if (r && r.ok) toast('알려주셔서 고마워요. 확인 후 고칠게요.');
    else if (r && r.error === 'too_many') toast('제보가 많아 잠시 쉬어 가요. 한 시간쯤 뒤에 다시 보내 주세요.');
    else throw new Error((r && r.error) || 'report');
  } catch { toast('제보를 보내지 못했어요. 잠시 후 다시 시도해 주세요.'); }
});

// 테마 (시스템 → 라이트 → 다크)
const THEMES = ['system', 'light', 'dark'];
function applyTheme(t) { if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t; }
let theme = store.get('among_theme', 'system'); applyTheme(theme);
$('#themeBtn').addEventListener('click', () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % 3]; applyTheme(theme); store.set('among_theme', theme);
  toast({ system: '기기 설정을 따라요', light: '밝은 화면', dark: '어두운 화면' }[theme]);
});

// 공유 링크로 들어오면: ?c=쿠폰id → 그 쿠폰을 펼쳐서, ?n=소식id → 소식 상세
function openFromLink() {
  const n = params.get('n');
  if (n) { openNews(n); return; }
  const id = params.get('c');
  if (id) jumpTo(id);
}

// ---------- 시작 ----------
$('#demoNote').hidden = !DEMO;
render();
loadCoupons().then(() => { openFromLink(); checkStatusOnLoad(); });
track('visit', { value: document.referrer ? host(document.referrer) : '' });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
