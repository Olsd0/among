// 해당 공지에서 확인한 원본 이미지. 상품 사진과 별개로 관리한다.
// 목록 페이지에서 수집된 소식도 브랜드·제목·기간으로 정확한 공지에 연결한다.
const notices = [
  { brand: '도미노피자', words: ['목요일'], until: '2026-12-31',
    sources: ['https://web.dominos.co.kr/event/list?gubun=E0200', 'https://web.dominos.co.kr/event/viewHtml?gubun=E0200&seq=2449'],
    source: 'https://web.dominos.co.kr/event/viewHtml?gubun=E0200&seq=2449',
    image: 'https://cdn.dominos.co.kr/renewal2018/w/event/260519_thu_spcday/thu_spcd_02.jpg' },
  { brand: '배스킨라빈스', words: ['블록팩', '4개'], until: '2026-10-30',
    sources: ['https://www.baskinrobbins.co.kr/m/play/event/list.php', 'https://baskinrobbins.co.kr/play/event/view.php?category=ALL&seq=625'],
    source: 'https://baskinrobbins.co.kr/play/event/view.php?category=ALL&seq=625',
    image: 'https://baskinrobbins.co.kr/upload/ckeditor/bd5ca2857a36c535cb2ba13cafaf3542.png' },
  { brand: 'KFC', words: ['더블', '커넬'], until: '2026-11-01',
    sources: ['https://www.kfckorea.com/promotion/promotionList/A801', 'https://www.kfckorea.com/promotion/promotionList/detail/1130'],
    source: 'https://www.kfckorea.com/promotion/promotionList/detail/1130',
    image: 'https://www.kfckorea.com/nas/event/2026/10/22/TEJl47cerDLZ.png' },
  { brand: '파파존스', words: ['아메리칸', '콤보'], until: '2026-11-08',
    sources: ['https://www.pji.co.kr/event/ongoing/9629'],
    source: 'https://www.pji.co.kr/event/ongoing/9629',
    image: 'https://imgcdn4.pji.co.kr/pc/img/event/261014_americancombo.jpg' },
];
const urlKey = (value) => {
  try { const u = new URL(value); if (u.protocol !== 'https:') return ''; u.hash = ''; u.searchParams.sort(); return u.href; } catch { return ''; }
};
export function noticePhoto(news = {}, today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)) {
  const source = urlKey(news.source_url);
  return notices.find((n) => today <= n.until && (!news.end_date || news.end_date <= n.until)
    && n.brand === news.brand && n.sources.some((url) => urlKey(url) === source)
    && n.words.every((word) => String(news.title || '').includes(word))) || null;
}
export const noticeImage = (news, today) => noticePhoto(news, today)?.image || '';
