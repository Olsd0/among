// Synthetic records are confined to tests. Production seeds are private research drafts.
import { acNormalize } from '../src/app-coupons.js';
export const AC_NOW = Date.parse('2026-10-29T03:00:00Z');
export function appCoupon(over = {}) {
  return acNormalize({
    id: '', status: 'published', issuer_app: '버거킹', brand: '버거킹', product_name: '검증용 버거', item_type: '단품',
    benefit_type: 'price', final_price: 4000, regular_price: 8000, discount_rate: 50,
    audience_type: 'tier', tiers: ['테스트 KING', '테스트 CROWN'], audience_evidence: '테스트용 공식 대상 문구',
    issue_period_state: 'verified', issue_start: '2026-10-28', issue_end: '2026-10-30', use_period_state: 'verified', use_start: '2026-10-28', use_end: '2026-11-02',
    source_url: 'https://www.burgerking.co.kr/notice/test', source_note: '테스트로 확인한 조건', official_link: 'https://www.burgerking.co.kr/notice/test', link_type: 'event',
    checked_at: '2026-10-29T02:00:00Z', link_checked_at: '2026-10-29T02:00:00Z', rights_state: 'facts_only', rights_note: '검증용 이용 범위 근거', hotdeal_enabled: true,
    facts: { composition: { state: 'verified', value: '단품 1개' }, issue_requirements: { state: 'verified', value: '앱 로그인 후 쿠폰 다운로드' }, channels: { state: 'verified', value: '매장 · 킹오더' }, stacking: { state: 'na', value: '테스트 해당 없음' }, excluded_stores: { state: 'verified', value: '제외 매장 테스트 목록\n' + '가상 매장명 '.repeat(100) } },
    ...over,
  });
}
