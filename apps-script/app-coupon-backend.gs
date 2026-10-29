// Embedded into Code.gs by collector/scripts/sync-web.js. Do not paste as a second GAS file.
function readAppCoupons_() {
  return readTable_('app_coupons').rows.map(function(r) {
    try { return acNormalize(JSON.parse(r.payload)); } catch (err) { console.error('Invalid app coupon row: ' + r.id); return null; }
  }).filter(Boolean);
}
function appCouponRow_(c) {
  const payload = JSON.stringify(c);
  if (payload.length > 45000) throw new Error('쿠폰 내용은 45,000자 이내로 저장하세요. 긴 조건을 삭제하지 말고 공식 출처를 함께 정리해 주세요.');
  const r = { payload: payload };
  SHEETS.app_coupons.filter(function(k) { return k !== 'payload'; }).forEach(function(k) { const s = String(c[k] == null ? '' : c[k]); r[k] = /^[=+@-]/.test(s) ? "'" + s : s; });
  return r;
}
function getAppCoupons_() {
  const rows = readAppCoupons_();
  return { ok: true, app_coupons: rows.map(function(c) { return acPublic(c); }).filter(Boolean),
    // References keep old collected copies out of both surfaces after the managed record ends.
    app_coupon_refs: [].concat.apply([], rows.filter(function(c) { return c.status !== 'draft'; }).map(function(c) { return c.legacy_refs; })) };
}
function withAppCoupons_(out) {
  const app = getAppCoupons_();
  out.coupons = out.coupons.filter(function(c) { return app.app_coupon_refs.indexOf('coupon:' + c.id) < 0; });
  out.news = out.news.filter(function(c) { return app.app_coupon_refs.indexOf('news:' + c.id) < 0; });
  out.count = out.coupons.length;
  out.app_coupons = app.app_coupons;
  out.app_coupon_refs = app.app_coupon_refs;
  return out;
}
function adminAppCoupons_() {
  return { ok: true, coupons: readAppCoupons_().map(function(c) {
    return Object.assign({}, c, { lifecycle: acLifecycle(c), needs_review: acNeedsReview(c), publish_errors: acValidate(c) });
  }), now: nowIso_(), timezone: TZ };
}
function appCouponContent_(c) {
  const copy = Object.assign({}, c);
  ['id', 'revision', 'status', 'checked_at', 'updated_at', 'link_checked_at', 'researched_at', 'review_required', 'hotdeal_enabled', 'recurring', 'issue_closed', 'use_closed', 'admin_notes', 'missing_info', 'duplicate_note', 'legacy_refs'].forEach(function(k) { delete copy[k]; });
  return JSON.stringify(copy);
}
function saveAppCoupon_(body) {
  const rows = readAppCoupons_();
  let c = acNormalize(body.coupon || {});
  const previous = rows.find(function(x) { return x.id === c.id; });
  if (previous && ((previous.issue_closed && !c.issue_closed) || (previous.use_closed && !c.use_closed)) && body.confirm_checked !== true) throw new Error('마감을 취소하려면 실제 조건을 다시 확인해 주세요.');
  if (c.id && !previous) throw new Error('존재하지 않는 쿠폰입니다. 목록을 다시 불러오세요.');
  if (previous && Number(body.expected_revision) !== previous.revision) throw new Error('다른 곳에서 수정됐어요. 목록을 다시 불러온 뒤 수정하세요.');
  if (!c.id) c.id = 'ac_' + Utilities.getUuid().replace(/-/g, '').slice(0, 26);
  const changed = !previous || appCouponContent_(c) !== appCouponContent_(previous);
  c.checked_at = previous ? previous.checked_at : '';
  c.link_checked_at = previous ? previous.link_checked_at : '';
  c.researched_at = previous ? previous.researched_at : '';
  c.review_required = changed || !!(previous && previous.review_required);
  if (previous && (previous.official_link !== c.official_link || previous.link_type !== c.link_type || previous.app_path !== c.app_path)) c.link_checked_at = '';
  if (body.confirm_link === true) c.link_checked_at = nowIso_();
  if (body.confirm_checked === true) {
    c.checked_at = body.checked_at ? acTimestamp(body.checked_at) : nowIso_();
    if (Date.parse(c.checked_at) > Date.now()) throw new Error('미래 시각을 확인 시점으로 기록할 수 없어요.');
    c.review_required = false;
  }
  const duplicates = acDuplicates(c, rows).map(function(x) { return { id: x.id, product_name: x.product_name, audience: acAudience(x) }; });
  if (c.status === 'published') {
    const errors = acValidate(c);
    if (errors.length) return { ok: false, error: '공개 전 확인 필요: ' + errors.join(' / '), publish_errors: errors };
    if (duplicates.length && !c.duplicate_note) return { ok: false, error: '중복 후보를 먼저 확인하고 다른 쿠폰인 이유를 입력하세요.', duplicates: duplicates };
  }
  c.updated_at = nowIso_();
  c.revision = (previous ? previous.revision : 0) + 1;
  const row = appCouponRow_(c);
  if (previous) {
    const table = readTable_('app_coupons');
    writeTable_(sheet_('app_coupons'), table.headers, table.rows.map(function(r) { return r.id === c.id ? row : r; }));
  } else appendRow_('app_coupons', row);
  CacheService.getScriptCache().remove(CACHE_KEY);
  return { ok: true, coupon: c, duplicates: duplicates, publish_errors: acValidate(c), lifecycle: acLifecycle(c) };
}
function closeAppCoupon_(body) {
  const c = readAppCoupons_().find(function(x) { return x.id === body.id; });
  if (!c) throw new Error('쿠폰을 찾을 수 없어요.');
  if (Number(body.expected_revision) !== c.revision) throw new Error('다른 곳에서 수정됐어요. 목록을 다시 불러오세요.');
  if (!['issue', 'use'].includes(body.phase)) throw new Error('발급 또는 사용 마감 중에서 선택하세요.');
  c[body.phase + '_closed'] = true;
  // Closure is operational, never a new verification of the offer's conditions.
  c.revision += 1;
  c.updated_at = nowIso_();
  const table = readTable_('app_coupons');
  writeTable_(sheet_('app_coupons'), table.headers, table.rows.map(function(r) { return r.id === c.id ? appCouponRow_(c) : r; }));
  CacheService.getScriptCache().remove(CACHE_KEY);
  return { ok: true, coupon: c, lifecycle: acLifecycle(c) };
}
function seedAppCouponDrafts_() {
  const have = readAppCoupons_().map(function(c) { return c.id; });
  const drafts = [
    { id: 'ac_research_bk_tiers', issuer_app: '버거킹', brand: '버거킹', product_name: '등급별 앱 쿠폰 · 개별 쿠폰 확인 대기', audience_type: 'tier',
      source_url: 'https://www.burgerking.co.kr/notice/90', official_link: 'https://www.burgerking.co.kr/notice/90', link_type: 'event',
      source_note: '2025년 앱 개편 공지 검색 결과에서 등급별·맞춤 쿠폰 안내를 확인. 현재 개별 쿠폰 상세는 공개 웹에서 확인하지 못함.',
      missing_info: '현재 쿠폰 상품·구성·가격, 정확한 이용 가능 등급 범위, 발급/사용 기간, 시간·매장·킹오더·배달 조건, 발급 경로, 자료 이용 범위. 이 기록은 개별 쿠폰을 확보하기 위한 조사 초안.' },
    { id: 'ac_research_mcd_rewards', issuer_app: '맥도날드', brand: '맥도날드', product_name: '리워드 교환 쿠폰 · 개별 쿠폰 확인 대기', benefit_type: 'point_exchange', audience_type: 'points_member',
      source_url: 'https://m.mcdonalds.co.kr/gmal/kor/more/tnc/tnc_202512.html', official_link: 'https://m.mcdonalds.co.kr/gmal/kor/more/tnc/tnc_202512.html', link_type: 'event',
      source_note: '공식 앱 약관에서 포인트 교환 쿠폰과 일반 쿠폰의 구분을 확인. 약관은 개별 발급 화면이 아니므로 공개용 이용 링크로 사용하지 않음.',
      missing_info: '현재 교환 상품·차감 포인트·구성, 해당 쿠폰 대상과 발급/사용 기간, 공식 이용 링크와 앱 내 경로, 자료 이용 범위. 일반 앱 쿠폰의 전체 회원 대상 여부도 개별 확인 필요.' },
    { id: 'ac_research_hp_shack_202610', issuer_app: '해피포인트', brand: '쉐이크쉑', product_name: '10월 쉑버거 선착순 1+1 · 상세 확인 대기', benefit_type: 'bogo',
      source_url: 'https://napi.happypointcard.com/page/event/event-view.spc?eventseq=7697c69cceaf1837b60334bd16728343&share=Y',
      official_link: 'https://napi.happypointcard.com/page/event/event-view.spc?eventseq=7697c69cceaf1837b60334bd16728343&share=Y', link_type: 'event',
      source_note: '사용자가 제공한 공식 공유 페이지의 제목 메타데이터에 10/26–10/30, 쉑버거 선착순 1+1이 표시됨. 본문은 앱 안내 화면만 보여 세부 조건을 확인하지 못함. 이 날짜를 발급·사용 기간으로 추정하지 않음.',
      missing_info: '전체 회원 대상 근거, 수량·상품 구성, 발급 기간과 사용 기간 각각, 선착순 수량·발급 시각·횟수, 사용 경로·제외 매장, 중복 할인, 공식 자료 이용 범위.' },
  ];
  drafts.forEach(function(input) {
    if (have.indexOf(input.id) >= 0) return;
    const c = acNormalize(Object.assign({ status: 'draft', revision: 1, researched_at: '2026-10-29T00:00:00Z', review_required: true,
      rights_state: 'unknown', rights_note: '공식 공개 페이지·약관을 살펴보았으나 자료 게시 허용 범위를 확정하지 못해 초안으로 보관. 배너·앱 화면·개별 코드는 복제하지 않음.' }, input));
    // checked_at intentionally empty: deployment and partial research are not coupon verification.
    appendRow_('app_coupons', appCouponRow_(c));
  });
}
