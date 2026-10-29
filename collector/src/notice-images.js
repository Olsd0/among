// 2026-10-29 공식 목록·상세에서 대조한 해당 공지 이미지.
// image는 목록용 공식 썸네일, detailImage는 큰 공지 원본(있는 경우). 긴 포스터는 상세를 열 때만 받는다.
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
  {"brand": "피자헛", "words": ["주말", "1+1"], "until": "2026-10-31", "sources": ["https://www.pizzahut.co.kr/cs/event/extra/hellopizzahut"], "source": "https://www.pizzahut.co.kr/cs/event/extra/hellopizzahut", "image": "https://akamai.pizzahut.co.kr/2020pizzahut-prod/public/event/c164ec37-60e8-430e-b80b-1ffac3113327.png", "detailImage": "https://akamai.pizzahut.co.kr/event/hellopizzahut_2610_event_weekend_down_pc_3_1.png"},
  {"brand": "피자헛", "words": ["클리커"], "until": "2026-12-31", "sources": ["https://www.pizzahut.co.kr/cs/event/829"], "source": "https://www.pizzahut.co.kr/cs/event/829", "image": "https://akamai.pizzahut.co.kr/2020pizzahut-prod/public/event/9725e387-0139-4887-ad09-cb44e8e7f99f.png", "detailImage": "https://akamai.pizzahut.co.kr/event/clicker_2610_event_pc.png"},
  {"brand": "피자헛", "words": ["SKT", "VIP"], "until": "2026-10-31", "sources": ["https://www.pizzahut.co.kr/cs/event", "https://www.pizzahut.co.kr/cs/event/818"], "source": "https://www.pizzahut.co.kr/cs/event/818", "image": "https://akamai.pizzahut.co.kr/2020pizzahut-prod/public/event/4c2054f6-d968-4a85-bab9-a3aab9bc7f96.png"},
  {"brand": "피자헛", "words": ["LG", "유플투쁠"], "until": "2026-10-31", "sources": ["https://www.pizzahut.co.kr/cs/event", "https://www.pizzahut.co.kr/cs/event/815"], "source": "https://www.pizzahut.co.kr/cs/event/815", "image": "https://akamai.pizzahut.co.kr/2020pizzahut-prod/public/event/cf56d06f-91b3-42de-a97c-49b897160a74.png"},
  {"brand": "배스킨라빈스", "words": ["카카오페이", "싱글레귤러", "50%"], "until": "2026-10-31", "sources": ["https://www.baskinrobbins.co.kr/m/play/event/view.php?seq=620&category=ALL", "https://www.baskinrobbins.co.kr/m/play/event/list.php", "https://baskinrobbins.co.kr/play/event/view.php?category=C&seq=620"], "source": "https://baskinrobbins.co.kr/play/event/view.php?category=C&seq=620", "image": "https://baskinrobbins.co.kr/upload/ckeditor/89c9d784d456b884278512efa147fc56.png"},
  {"brand": "반올림피자", "words": ["명일방주"], "until": "2026-11-08", "sources": ["https://order.banolimpizza.com/event/detail/163814c2-cc1e-4051-b35c-91ba2906ea36?eventStatus=ongoing", "https://order.banolimpizza.com/event/detail/163814c2-cc1e-4051-b35c-91ba2906ea36"], "source": "https://order.banolimpizza.com/event/detail/163814c2-cc1e-4051-b35c-91ba2906ea36", "image": "https://cdn.banolimpizza.com/event/62e8ed88eecc48eaac2d971aa5f6740f.png", "detailImage": "https://cdn.banolimpizza.com/event/5fc80c5e10204080979d1782a56f8f5e.jpg"},
  {"brand": "KFC", "words": ["닭껍질"], "until": "2026-11-09", "sources": ["https://www.kfckorea.com/promotion/promotionList/A801", "https://www.kfckorea.com/promotion/promotionList/detail/1129"], "source": "https://www.kfckorea.com/promotion/promotionList/detail/1129", "image": "https://www.kfckorea.com/nas/event/2026/10/01/9kYQOAZt0BFp.png"},
  {"brand": "굽네치킨", "words": ["주말", "4000"], "until": "2026-11-01", "sources": ["https://www.goobne.co.kr/brd/event/list_p", "https://www.goobne.co.kr/brd/event/view_p?seq=89954"], "source": "https://www.goobne.co.kr/brd/event/view_p?seq=89954", "image": "https://www.goobne.co.kr/img/board/4706932e0442492792082e970ca64759.png", "detailImage": "https://cdn.goob-ne.com/goobne/resources/assets/images/event/2026/1014_10-goobtime/event.jpg"},
  {"brand": "푸라닭", "words": ["쿼터레그"], "until": "2026-11-25", "sources": ["https://www.puradakchicken.com/mobile/news/event.asp?mode=view&page=1&pageSize=10&seritemidx=&artistidx=&serboardsort=&search=0&searchStr=&idx=45863"], "source": "https://www.puradakchicken.com/mobile/news/event.asp?mode=view&page=1&pageSize=10&seritemidx=&artistidx=&serboardsort=&search=0&searchStr=&idx=45863", "image": "https://www.puradakchicken.com/upload/editordata/상세페이지1.jpg"},
  {"brand": "교촌치킨", "words": ["허니", "7종"], "until": "2026-10-31", "sources": ["https://m.kyochon.com/event/event_list", "https://m.kyochon.com/event/event_view?event_seq=636&event_kind=1"], "source": "https://m.kyochon.com/event/event_view?event_seq=636&event_kind=1", "image": "https://www.kyochon.com/ADM_uploadFiles/TB_EVENT/list_banner_Discount%20on%204%20Honey_event(0).jpg"},
  {"brand": "교촌치킨", "words": ["허니", "윙콤비"], "until": "2026-11-30", "sources": ["https://m.kyochon.com/event/event_list", "https://m.kyochon.com/event/event_view?event_seq=637&event_kind=1"], "source": "https://m.kyochon.com/event/event_view?event_seq=637&event_kind=1", "image": "https://www.kyochon.com/ADM_uploadFiles/TB_EVENT/event(0).png"},
  {"brand": "파리바게뜨", "words": ["카스테라", "말차"], "until": "2026-10-30", "sources": ["https://www.paris.co.kr/promotion/", "https://www.paris.co.kr/promotion/buy-honey-castella-get-matcha-castella-oct-2026/"], "source": "https://www.paris.co.kr/promotion/buy-honey-castella-get-matcha-castella-oct-2026/", "image": "https://d2afncas1tel3t.cloudfront.net/wp-content/uploads/2026/10/10월_선물류_증정_말차_프로모션_썸네일-600x600.jpg", "detailImage": "https://d2afncas1tel3t.cloudfront.net/wp-content/uploads/2026/10/10월_선물류_증정_말차_프로모션_상세1차_01.jpg"},
  {"brand": "파파이스", "words": ["레그", "1+1"], "until": "2026-12-31", "sources": ["https://www.popeyes.co.kr/event", "https://www.popeyes.co.kr/event/65"], "source": "https://www.popeyes.co.kr/event/65", "image": "", "detailImage": "https://popeyes.co.kr/data/file/event/3698713134_aLxwZ6uI_0bc16a1807225a11466549b96b8f2a733debad3f.jpg"},
  {"brand": "미스터피자", "words": ["미피", "수요일"], "until": "2027-12-31", "sources": ["https://www.mrpizza.co.kr/bbs/board.php?bo_table=event", "https://www.mrpizza.co.kr/bbs/board.php?bo_table=event&wr_id=21"], "source": "https://www.mrpizza.co.kr/bbs/board.php?bo_table=event&wr_id=21", "image": "https://www.mrpizza.co.kr/data/file/event/thumb-9fc4b1693dca29b02fae25560268e34c_7YWdOIsc_5afa7fa74fbe5b23a41864600e9e3570a1be7e5a_307x410.jpg", "detailImage": "https://www.mrpizza.co.kr/data/editor/2609/e729d68eda70ddde879b352e76e472f5_1788509639_6494.jpg"},
  {"brand": "스타벅스", "words": ["2026", "winter", "frequency"], "until": "2026-12-31", "sources": ["https://www.starbucks.co.kr/whats_new/campaign_list.do", "https://www.starbucks.co.kr/whats_new/campaign_view.do?pro_seq=3499&menu_cd="], "source": "https://www.starbucks.co.kr/whats_new/campaign_view.do?pro_seq=3499&menu_cd=", "image": "https://image.istarbucks.co.kr/upload/promotion/WEB_THUM_20261014134821897.png", "detailImage": "https://image.istarbucks.co.kr/img/event/2026/wn_2026eFreqWinter_eventInfo_260929_01.jpg"},
  {"brand": "네이버페이", "words": ["카페", "적립"], "until": "2026-11-01", "sources": ["https://campaign2.naver.com/npay/cafe/"], "source": "https://campaign2.naver.com/npay/cafe/", "image": "https://campaign-cdn.pstatic.net/0/campaign2/2024/09/offline_cafe/og.png"},
  {"brand": "설빙", "words": ["네이버페이", "50%", "적립"], "until": "2026-11-01", "sources": ["https://www.instagram.com/p/De8DZxPDXBr/"], "source": "https://www.instagram.com/p/De8DZxPDXBr/", "image": "assets/notices/sulbing-npay-12fd562649e9.jpg"},
];
// 파파이스의 원본은 약 9MB이므로 목록 자동 로딩에서 제외하고 상세에서만 연다.
// 공백·쉼표·영문 대소문자만 정규화한다. 브랜드·공식 URL·행사 기간은 그대로 대조한다.
const titleKey = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s,]/g, '');
const urlKey = (value) => {
  try { const u = new URL(value); if (u.protocol !== 'https:') return ''; u.hash = ''; u.searchParams.sort(); return u.href; } catch { return ''; }
};
export function noticePhoto(news = {}, today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)) {
  const source = urlKey(news.source_url);
  return notices.find((n) => today <= n.until && (!news.end_date || news.end_date <= n.until)
    && n.brand === news.brand && n.sources.some((url) => urlKey(url) === source)
    && n.words.every((word) => titleKey(news.title).includes(titleKey(word)))) || null;
}
export const noticeImage = (news, today) => noticePhoto(news, today)?.image || '';
