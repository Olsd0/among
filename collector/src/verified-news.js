// 자동 수집에서 빠진 소식 중 공식 원문을 직접 확인한 기간 한정 공지.
// 쉐이크쉑: 사용자가 제공한 공식 공유 페이지의 og:title에서 날짜·쉑버거·선착순·1+1 확인.
// 앱 전용 상세·행사 이미지는 웹에 노출되지 않으므로 추정하지 않는다.
// 확인: 설빙 공식 피드의 원본 포스터, 해피포인트 공식 공유 페이지의 행사 제목(기간·선착순 1+1).
// 해피포인트는 상세가 앱 전용이며 공통 OG 로고는 해당 행사 이미지로 사용하지 않는다.
// 이미지 원본은 그대로 보관한다. 확인 시각·종료일을 임의로 연장하지 않는다.
export const verifiedNews = [
  {
    id: 'n_shakeshack_happypoint_20261026',
    brand: '쉐이크쉑', category: '햄버거',
    title: '쉐이크쉑 해피포인트 쉑버거 선착순 1+1',
    summary: '10월 26~30일 해피포인트 앱의 쉑버거 선착순 1+1 행사예요. 쿠폰 발급·소진 여부, 사용 기간과 제외 매장은 해피포인트 앱의 해당 공지에서 확인해 주세요.',
    discount_label: '1+1', start_date: '2026-10-26', end_date: '2026-10-30',
    programs: ['해피포인트'], source_id: 'happypoint-shakeshack-20261026',
    source_url: 'https://napi.happypointcard.com/page/event/event-view.spc?eventseq=7697c69cceaf1837b60334bd16728343&share=Y',
    official_link: 'https://napi.happypointcard.com/page/event/event-view.spc?eventseq=7697c69cceaf1837b60334bd16728343&share=Y',
    status: 'published', checked_at: '2026-10-29T02:06:30.785Z', first_seen: '2026-10-26T00:00:00.000Z',
    related_ids: [], confidence: 1
  },
  {
    "id": "n_sulbing_npay_20261028",
    "brand": "설빙",
    "category": "디저트",
    "title": "설빙 네이버페이 50% 포인트 적립",
    "summary": "10월 28일~11월 1일, 매장에서 네이버페이 포인트·머니로 9900원 이상 결제하면 결제금액의 50%를 포인트로 적립해요. 행사 기간 1인 합산 최대 30000원이며 Npay 카드·머니카드 결제는 제외돼요. 참여 매장과 자세한 조건은 공식 공지를 확인해 주세요.",
    "discount_label": "50% 적립",
    "start_date": "2026-10-28",
    "end_date": "2026-11-01",
    "programs": [
      "네이버페이"
    ],
    "source_id": "sulbing-official-npay",
    "source_url": "https://www.instagram.com/p/De8DZxPDXBr/",
    "official_link": "https://sulbing.com/index.php",
    "status": "published",
    "checked_at": "2026-10-29T01:50:36.658Z",
    "first_seen": "2026-10-28T00:00:00.000Z",
    "related_ids": [],
    "confidence": 1
  }
];

function sameEventUrl(a, b) {
  try {
    const key = (value) => { const u = new URL(value); u.hash = ''; u.searchParams.delete('share'); u.searchParams.sort(); return u.href; };
    return key(a) === key(b);
  } catch { return false; }
}

export function withVerifiedNews(news = [], today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)) {
  const additions = verifiedNews.filter((n) => n.start_date <= today && today <= n.end_date);
  const output = [...news];
  for (const n of additions) {
    const same = (o) => o.id === n.id || (o.brand === n.brand && o.start_date === n.start_date && o.end_date === n.end_date
      && (sameEventUrl(o.source_url, n.source_url) || ((n.programs || []).some((p) => (o.programs || []).includes(p)) && o.title === n.title)));
    const index = output.findIndex(same);
    if (index < 0) output.push({ ...n, programs: [...n.programs], related_ids: [] });
    // 같은 공식 공지를 자동 수집했다면 수집 결과의 상태와 최신 확인 시각을 존중한다.
  }
  return output.filter((n) => !n.end_date || today <= n.end_date);
}
