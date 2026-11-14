// 기존 시트의 네이버페이 출처도 음식·카페 행사 목록과 상세를 읽도록 보정한다.
// 사용자가 중지한 출처와 다른 주소로 직접 바꾼 출처는 그대로 둔다.
export const NPAY_FNB_URL = 'https://pay.naver.com/benefit/payment/list?firstCategory=DOMESTIC_INSTORE&secondCategory=FNB';
const NPAY_DETAIL_LINKS = "a[href*='/benefit/payment/detail/']";

function knownNpayList(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    return (u.hostname === 'campaign2.naver.com' && /^\/npay\/cafe\/?$/.test(u.pathname))
      || (u.hostname === 'pay.naver.com' && /^\/benefit\/payment\/list\/?$/.test(u.pathname));
  } catch { return false; }
}

/** robots·렌더링·상세 URL 검사는 기존 collectSource 경로를 그대로 거친다. */
export function repairEventSources(sources = []) {
  return sources.map((source) => {
    if (!source || source.id !== 'npay-cafe' || /^(false|0|n|no|off|중지)$/i.test(String(source.active ?? 'true').trim())
      || !knownNpayList(source.url)) return source;
    const requested = Number(source.max_follow);
    const maxFollow = Number.isFinite(requested) && requested > 0 ? Math.min(8, Math.max(1, Math.floor(requested))) : 8;
    return {
      ...source,
      url: NPAY_FNB_URL,
      official_link: !source.official_link || knownNpayList(source.official_link) ? NPAY_FNB_URL : source.official_link,
      follow: NPAY_DETAIL_LINKS,
      max_follow: maxFollow,
    };
  });
}
