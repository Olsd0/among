// Canonical app-coupon rules. sync-web.js also embeds this module in Apps Script.
// No network, account sessions, device scraping, or inferred eligibility.
export const AC_APPS = ['버거킹', '맥도날드', '해피포인트'];
export const AC_AUDIENCES = { unknown: '미확인', all_members: '전체 회원', tier: '멤버십 등급', new_member: '신규 회원', personalized: '맞춤 혜택', points_member: '포인트 교환 대상', other: '별도 대상' };
export const AC_BENEFITS = { unknown: '미확인', price: '구매 가격', amount: '즉시 할인액', percent: '즉시 할인율', bogo: '1+1', point_back: '포인트 환급', point_exchange: '포인트 교환' };
export const AC_LINK_LABELS = { event: '공식 행사 보기', app: '공식 앱에서 확인', install: '앱 설치 안내' };
export const AC_FACTS = {
  composition: '상품 구성·수량', issue_requirements: '발급 조건', use_hours: '사용 가능 시간',
  channels: '사용 경로·매장', excluded_stores: '제외 매장', min_purchase: '최소 구매액',
  max_discount: '최대 할인액', payment: '결제수단', points: '포인트 차감·환급 조건',
  per_person: '1인 사용 횟수', per_order: '주문당 사용 수', stacking: '중복 할인', early_end: '선착순·조기 종료 조건', other: '기타 유의사항',
};
export const AC_STATES = { issuing: '발급 가능', redeem_only: '발급 종료 · 받은 쿠폰 사용 가능', redeem_scheduled: '발급 종료 · 받은 쿠폰 사용 예정', upcoming: '발급 예정', ended: '사용 종료', draft: '초안', archived: '보관' };
export const AC_TEXT = ['issuer_app', 'brand', 'product_name', 'item_type', 'benefit_type', 'benefit_note', 'audience_type', 'audience_detail', 'audience_evidence', 'issue_period_state', 'issue_period_note', 'use_period_state', 'source_url', 'source_note', 'official_link', 'link_type', 'app_path', 'rights_state', 'rights_note', 'admin_notes', 'missing_info', 'duplicate_note'];
export const AC_NUMBERS = ['final_price', 'regular_price', 'discount_amount', 'discount_rate', 'points_cost'];
export function acText(v, max = 12000) {
  const s = v == null ? '' : String(v).trim();
  if (s.length > max) throw new Error('입력이 너무 길어요. 내용을 나누어 주세요.');
  return s;
}
export function acTimestamp(value, end = false) {
  if (!value) return '';
  let s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += end ? 'T23:59:59.999+09:00' : 'T00:00:00+09:00';
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s += end ? ':59.999+09:00' : ':00+09:00';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(s) || !Number.isFinite(Date.parse(s))) throw new Error('날짜·시간 형식을 확인해 주세요.');
  return new Date(s).toISOString();
}
export function acNormalize(input = {}) {
  const c = {};
  AC_TEXT.forEach(k => { c[k] = acText(input[k]); });
  c.id = acText(input.id, 60);
  if (c.id && !/^[a-zA-Z0-9_-]+$/.test(c.id)) throw new Error('잘못된 쿠폰 ID');
  c.status = ['draft', 'published', 'archived'].includes(input.status) ? input.status : 'draft';
  c.revision = Number.isSafeInteger(Number(input.revision)) ? Number(input.revision) : 0;
  c.tiers = (Array.isArray(input.tiers) ? input.tiers : String(input.tiers || '').split(',')).map(v => acText(v, 80)).filter(Boolean);
  AC_NUMBERS.forEach(k => {
    c[k] = input[k] === '' || input[k] == null ? null : Number(input[k]);
    if (c[k] !== null && (!Number.isFinite(c[k]) || c[k] < 0 || c[k] > 1e8)) throw new Error('금액·비율은 0 이상의 숫자로 입력하세요.');
  });
  if (c.discount_rate !== null && c.discount_rate > 100) throw new Error('할인율은 100% 이하여야 해요.');
  ['issue_start', 'issue_end', 'use_start', 'use_end', 'checked_at', 'link_checked_at', 'updated_at', 'researched_at'].forEach(k => { c[k] = acTimestamp(input[k], /_end$/.test(k)); });
  ['is_max', 'hotdeal_enabled', 'recurring', 'issue_closed', 'use_closed', 'review_required'].forEach(k => { c[k] = input[k] === true; });
  c.facts = {};
  Object.keys(AC_FACTS).forEach(k => {
    const f = input.facts && input.facts[k] || {};
    c.facts[k] = { state: ['verified', 'na'].includes(f.state) ? f.state : 'unknown', value: acText(f.value) };
  });
  c.legacy_refs = (Array.isArray(input.legacy_refs) ? input.legacy_refs : String(input.legacy_refs || '').split(',')).map(v => acText(v, 80)).filter(v => /^(coupon|news):[\w-]+$/.test(v));
  return c;
}
export function acOfficialUrl(value, app) {
  const s = String(value || '');
  // HTTPS public links only. Preserve public event IDs, never personal codes or sessions.
  const m = /^https:\/\/([a-z0-9.-]+)(\/[^\s\\<>]*)?$/i.exec(s);
  if (!m || /[\u0000-\u0020]/.test(s) || /%(?:0[0-9a-f]|1[0-9a-f])/i.test(s)) return false;
  const hosts = { '버거킹': ['burgerking.co.kr'], '맥도날드': ['mcdonalds.co.kr'], '해피포인트': ['happypointcard.com', 'happymarket.co.kr', 'shakeshack.kr', 'baskinrobbins.co.kr', 'paris.co.kr', 'dunkindonuts.co.kr'] }[app] || [];
  const host = m[1].toLowerCase();
  if (!hosts.some(h => host === h || host.endsWith('.' + h)) && !['apps.apple.com', 'play.google.com'].includes(host)) return false;
  let decoded;
  try { decoded = decodeURIComponent(s); } catch { return false; }
  return !/(?:[?&#/])(?:access_?token|id_?token|token|session\w*|auth\w*|password|member\w*|user\w*|barcode|coupon_?code|redeem_?code|email|phone|code)=/i.test(decoded) && !/#/.test(s);
}
export function acValidate(c, now = Date.now()) {
  const errors = [];
  if (!AC_APPS.includes(c.issuer_app)) errors.push('발급 앱');
  if (!c.brand || !c.product_name || !c.item_type) errors.push('사용 브랜드·상품명·단품/세트 구분');
  if (!c.facts?.composition || c.facts.composition.state !== 'verified' || !c.facts.composition.value) errors.push('상품 구성·수량');
  const benefitOK = { price: c.final_price !== null, amount: c.discount_amount > 0, percent: c.discount_rate > 0, bogo: true, point_back: !!c.benefit_note && (c.discount_rate > 0 || c.discount_amount > 0), point_exchange: c.points_cost > 0 };
  if (!benefitOK[c.benefit_type]) errors.push('혜택 방식·금액');
  if (c.final_price !== null && c.regular_price !== null && c.final_price > c.regular_price) errors.push('기준 가격보다 높은 구매 가격');
  if (!AC_AUDIENCES[c.audience_type] || c.audience_type === 'unknown' || !c.audience_evidence) errors.push('쿠폰별 이용 대상·확인 근거');
  if (c.audience_type === 'tier' && !c.tiers.length) errors.push('확인된 정확한 멤버십 등급');
  if (['other', 'personalized', 'points_member'].includes(c.audience_type) && !c.audience_detail) errors.push('이용 대상의 구체적 조건');
  if (c.issuer_app === '해피포인트' && c.audience_type !== 'all_members') errors.push('해피포인트 전체 회원 대상 확인');
  if (c.issue_period_state === 'na') { if (!c.issue_period_note) errors.push('발급 기간 해당 없음의 근거'); }
  else if (c.issue_period_state !== 'verified' || !c.issue_start || !c.issue_end) errors.push('발급 시작·마감 시점');
  if (c.use_period_state !== 'verified' || !c.use_start || !c.use_end) errors.push('사용 시작·종료 시점');
  for (const p of ['issue', 'use']) if (c[p + '_start'] && c[p + '_end'] && c[p + '_start'] > c[p + '_end']) errors.push(p === 'issue' ? '발급 기간 순서' : '사용 기간 순서');
  if (c.issue_end && c.use_end && c.issue_end > c.use_end) errors.push('사용 종료 이후 발급 마감');
  if (!c.facts?.issue_requirements || c.facts.issue_requirements.state === 'unknown' || (c.facts.issue_requirements.state === 'verified' && !c.facts.issue_requirements.value)) errors.push('발급 조건');
  Object.keys(AC_FACTS).forEach(k => { const f = c.facts?.[k]; if (f?.state === 'verified' && !f.value) errors.push(AC_FACTS[k] + ' 확인 내용'); });
  if (!acOfficialUrl(c.source_url, c.issuer_app) || !c.source_note) errors.push('공식 출처·확인 내용');
  if (!acOfficialUrl(c.official_link, c.issuer_app) || !AC_LINK_LABELS[c.link_type]) errors.push('공식 이용 링크·목적지 종류');
  if (!c.link_checked_at || Date.parse(c.link_checked_at) > now) errors.push('공식 링크 목적지 확인 시점');
  if (c.link_type === 'install' && !c.app_path) errors.push('실제로 확인한 앱 내 이동 경로');
  if (!c.checked_at || Date.parse(c.checked_at) > now) errors.push('실제 조건 확인 시점');
  if (!['facts_only', 'permission'].includes(c.rights_state) || !c.rights_note) errors.push('출처 자료 이용 범위 확인');
  if (c.review_required) errors.push('변경된 조건 재확인');
  return errors;
}
export function acLifecycle(c, now = Date.now()) {
  if (c.status !== 'published') return c.status === 'archived' ? 'archived' : 'draft';
  if (c.use_closed || (c.use_end && now > Date.parse(c.use_end))) return 'ended';
  if (c.issue_closed || (c.issue_end && now > Date.parse(c.issue_end))) return c.use_start && now < Date.parse(c.use_start) ? 'redeem_scheduled' : 'redeem_only';
  if (c.issue_start && now < Date.parse(c.issue_start)) return 'upcoming';
  return 'issuing';
}
export function acNeedsReview(c, now = Date.now()) {
  return c.review_required || !c.checked_at || now - Date.parse(c.checked_at) > 48 * 3600e3 || acValidate(c, now).length > 0;
}
export function acPublic(c, now = Date.now()) {
  if (c.status !== 'published' || acValidate(c, now).length || acLifecycle(c, now) === 'ended') return null;
  const out = { ...c, facts: { ...c.facts }, lifecycle: acLifecycle(c, now), needs_review: acNeedsReview(c, now) };
  ['admin_notes', 'missing_info', 'duplicate_note', 'researched_at'].forEach(k => { delete out[k]; });
  return out;
}
export function acAudience(c) {
  return c.audience_type === 'tier' ? c.tiers.join(' · ') + ' 등급' : [AC_AUDIENCES[c.audience_type] || '미확인', c.audience_detail].filter(Boolean).join(' · ');
}
export function acBenefit(c) {
  const won = n => Number(n).toLocaleString('ko-KR') + '원';
  const max = c.is_max ? '최대 ' : '';
  switch (c.benefit_type) {
    case 'price': return c.final_price === null ? '가격 미확인' : won(c.final_price);
    case 'amount': return max + won(c.discount_amount) + ' 할인';
    case 'percent': return max + c.discount_rate + '% 즉시 할인';
    case 'bogo': return '1+1';
    case 'point_back': return max + (c.discount_rate !== null ? c.discount_rate + '% ' : c.discount_amount !== null ? won(c.discount_amount) + ' 상당 ' : '') + '포인트 환급';
    case 'point_exchange': return Number(c.points_cost).toLocaleString('ko-KR') + 'P 교환';
    default: return '혜택 미확인';
  }
}
export function acHotEligible(c, now = Date.now()) {
  if (!c.hotdeal_enabled || !acPublic(c, now) || acNeedsReview(c, now) || acLifecycle(c, now) !== 'issuing') return false;
  // Happy Point policy applies only to hot deals, never the app-coupon list.
  const rate = ['price', 'amount', 'percent'].includes(c.benefit_type) ? c.discount_rate || 0 : 0;
  return c.benefit_type === 'bogo' || rate >= (c.issuer_app === '해피포인트' ? 50 : 30);
}
export function acDuplicates(c, rows) {
  const key = s => String(s || '').replace(/\s+/g, '').toLowerCase();
  return rows.filter(x => x.id !== c.id && x.status !== 'archived' && x.issuer_app === c.issuer_app && x.brand === c.brand &&
    ((c.link_type === 'event' && c.official_link && x.official_link === c.official_link) ||
      (key(c.product_name) && key(x.product_name) === key(c.product_name) && (!c.use_end || !x.use_start || c.use_end >= x.use_start) && (!x.use_end || !c.use_start || x.use_end >= c.use_start))));
}
export function acKST(v, short = false) {
  if (!v || !Number.isFinite(Date.parse(v))) return '미확인';
  const s = new Date(Date.parse(v) + 9 * 3600e3).toISOString();
  return (short ? s.slice(5, 10) : s.slice(0, 10)) + ' ' + s.slice(11, 16);
}
