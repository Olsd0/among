import { benefitLabel, normPrograms, noticeImageFor, todayKST, verificationStatus } from './engine.js?v=20261114-1';

// 쿠폰으로만 추출된 기간 한정 결제·증정 행사도 같은 원문으로 공지를 만든다.
// 가격·혜택·확인 시각은 쿠폰 그대로이고, 상품 이미지는 공지에 옮기지 않는다.
const PAYMENTS = new Set(['네이버페이', '카카오페이', '토스페이']);
const PRIZE = /추첨|응모|당첨|경품|초청|예매권|관람권|팔로우|댓글|인증샷|리그램|해시태그/;
const DAY = 864e5;
const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const validDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

// 추적용 쿼리만 없앤다. 이벤트 id를 나타내는 나머지 쿼리는 보존한다.
function urlKey(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password) return '';
    u.hash = '';
    u.hostname = u.hostname.replace(/^www\./, '');
    for (const key of [...u.searchParams.keys()]) if (/^utm_/i.test(key) || key === 'share') u.searchParams.delete(key);
    u.searchParams.sort();
    return u.href;
  } catch { return ''; }
}

const urls = (item) => clean(item.source_url).split(' ').map(urlKey).filter(Boolean);
function detailUrl(value) {
  const u = new URL(value); // urlKey에서 검증된 주소만 들어온다.
  // 목록 자체의 공통 URL은 이벤트 식별자가 아니다.
  if (/\/(?:list|ongoing|events?)\/?$/i.test(u.pathname) || /(?:^|[_/-])list(?:\.|\/|$)/i.test(u.pathname)) return false;
  if (/\/(?:detail|view|event|promotion|ongoing)\/[^/]+\/?$/i.test(u.pathname)) return true;
  return [...u.searchParams].some(([key, val]) => /^(?:id|idx|seq|eventseq|event_seq|pro_seq|seritemidx)$/i.test(key) && val);
}

const compact = (value) => clean(value).normalize('NFKC').toLowerCase().replace(/[\s,·]/g, '');
function offerKey(item) {
  const label = clean(item.discount_label || (item.discount_type ? benefitLabel(item) : ''));
  if (!label) return '';
  let menu = compact(item.menu || item.title);
  for (const part of [item.brand, label, '네이버페이', 'npay', '카카오페이', '토스페이']) {
    const word = compact(part);
    if (word) menu = menu.split(word).join('');
  }
  // 목록 URL에서는 실제 메뉴와 혜택이 모두 같아야만 같은 공지로 볼 수 있다.
  return menu ? `${menu}|${compact(label)}` : '';
}

function sameEvent(a, b) {
  if (a.id === b.id || (a.related_ids || []).some((id) => (b.related_ids || []).includes(id))) return true;
  if (a.brand !== b.brand || (a.end_date || '') !== (b.end_date || '')) return false;
  if (a.start_date && b.start_date && a.start_date !== b.start_date) return false;
  const keys = urls(a);
  const shared = urls(b).filter((key) => keys.includes(key));
  if (!shared.length) return false;
  if (shared.some(detailUrl)) return true;
  const offer = offerKey(a);
  return !!offer && offer === offerKey(b);
}

function fromCoupon(c, today, now) {
  if (!c || c.status !== 'published' || !/^[\w-]{1,100}$/.test(c.id || '') || !clean(c.brand) || !clean(c.menu)) return null;
  if (c.audience === '개인' || verificationStatus(c.checked_at, now) !== 'fresh') return null;
  if (!validDay(c.end_date) || c.end_date < today) return null;
  if (c.start_date && (!validDay(c.start_date) || c.start_date > today || c.start_date > c.end_date)) return null;
  // 상시성 혜택은 쿠폰에 남긴다. 기존 소식 검증과 같은 75일 기준.
  if (c.start_date && (Date.parse(c.end_date) - Date.parse(c.start_date)) / DAY > 75) return null;
  const source = clean(c.source_url).split(' ').find((url) => urlKey(url));
  if (!source) return null;
  const programs = normPrograms(c.programs);
  const text = [c.menu, c.conditions, c.program_note, c.how_to_use, c.evidence].map(clean).join(' ');
  if (programs.includes('카드') || PRIZE.test(text)) return null;
  const payment = programs.find((p) => PAYMENTS.has(p));
  if (!payment && c.discount_type !== 'free_item') return null;
  // 종료일만 공개된 결제 행사도 시작일을 만들지 않고 공지한다.
  // 날짜 없는 일반 증정 행사를 기간 한정으로 확대하지 않는다.
  if (!c.start_date && !payment) return null;
  const label = benefitLabel(c);
  const name = clean(c.menu).includes(clean(c.brand)) ? clean(c.menu) : `${clean(c.brand)} ${clean(c.menu)}`;
  const paymentName = payment && !/네이버\s*페이|N\s*pay|카카오\s*페이|토스\s*페이/i.test(name) ? `${payment} ` : '';
  const title = `${paymentName}${name}${name.includes(label) ? '' : ` · ${label}`}`;
  const details = [...new Set([c.conditions, c.program_note, c.how_to_use].map(clean).filter(Boolean))];
  const n = {
    id: `n_coupon_${c.id}`, brand: c.brand, category: c.category || '', title,
    summary: details.join(' · '), discount_label: label,
    start_date: c.start_date || null, end_date: c.end_date, programs,
    source_id: c.source_id || '', source_url: source, official_link: source,
    status: 'published', checked_at: c.checked_at, first_seen: c.first_seen || c.checked_at,
    confidence: c.confidence, evidence: c.evidence || '', related_ids: [c.id], image_url: '', notice_only: true,
  };
  // 확인 목록에서 이 행사로 대조된 이미지만. c.image_url은 상품 사진이므로 사용하지 않는다.
  n.image_url = noticeImageFor(n, '', today);
  return n;
}

/**
 * 기존 공지와 쿠폰은 바꾸지 않고, 빠진 결제·증정 공지만 추가한다.
 * 이미 숨김·보류·거절된 공지는 되살리지 않는다. 같은 행사면 게시된 공지에 쿠폰 연결만 더한다.
 * 호출자는 기존 공지의 검증·만료 필터를 계속 적용해야 한다.
 */
export function withCouponEventNews(news = [], coupons = [], { today = todayKST(), now = Date.now() } = {}) {
  const output = news.map((n) => ({ ...n, related_ids: [...(n.related_ids || [])] }));
  for (const c of [...coupons].sort((a, b) => String(a?.id || '').localeCompare(String(b?.id || '')))) {
    const n = fromCoupon(c, today, now);
    if (!n) continue;
    const matches = output.filter((o) => sameEvent(o, n));
    if (matches.some((o) => o.status && o.status !== 'published')) continue;
    if (matches.length) {
      const existing = matches[0];
      existing.related_ids = [...new Set([...existing.related_ids, c.id])].slice(0, 6);
    } else output.push(n);
  }
  return output;
}
