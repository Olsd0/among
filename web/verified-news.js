// 자동 수집에서 빠진 소식 중 공식 원문을 직접 확인한 기간 한정 공지.
// 확인: 설빙 공식 피드의 원본 포스터.
// 앱 안에서만 상세를 확인할 수 있는 쿠폰은 수동 공지에 추가하지 않는다.
// 이미지 원본은 그대로 보관한다. 확인 시각·종료일을 임의로 연장하지 않는다.
export const verifiedNews = [
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
