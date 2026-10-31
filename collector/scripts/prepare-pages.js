// Pages의 실제 배포 주소를 검색 메타데이터의 단일 기준으로 사용한다.
// 별도 도메인 환경변수나 매일 실행하는 작업은 필요 없다.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC_PAGES = ['index.html', 'guide.html', 'about.html', 'partners.html', 'privacy.html', 'terms.html'];

export function preparePages(directory, baseUrl, { publisherId = '', contactEmail = '' } = {}) {
  publisherId = publisherId.trim();
  contactEmail = contactEmail.trim();
  if (publisherId && !/^ca-pub-\d{16}$/.test(publisherId)) throw new Error('ADSENSE_PUBLISHER_ID는 ca-pub-와 16자리 숫자여야 합니다.');
  if (contactEmail && !/^[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}$/.test(contactEmail)) throw new Error('CONTACT_EMAIL 형식이 아닙니다.');
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('유효한 HTTPS 배포 주소가 필요합니다.');
  base.pathname = base.pathname.replace(/\/+$/, '') + '/';
  const pages = PUBLIC_PAGES;
  const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const urls = [];
  for (const page of pages) {
    const url = new URL(page === 'index.html' ? './' : page, base).href;
    urls.push(url);
    const path = resolve(directory, page);
    let html = readFileSync(path, 'utf8').replace(/\n?<!-- deploy-meta -->[\s\S]*?<!-- \/deploy-meta -->\n?/g, '\n');
    html = html.replace(/<meta property="og:image"[^>]*>\n?/g, '');
    // 본인 ID가 있을 때만 소유권 확인 메타를 만든다. 광고 스크립트는 삽입하지 않는다.
    html = html.replace(/\n?<!-- adsense-verification -->[\s\S]*?<!-- \/adsense-verification -->\n?/g, '\n');
    if (publisherId) html = html.replace('</head>', `<!-- adsense-verification -->\n<meta name="google-adsense-account" content="${publisherId}">\n<!-- /adsense-verification -->\n</head>`);
    // 검색 로봇과 JS를 끈 방문자도 실제 문의처를 읽을 수 있도록 배포 시 생성한다.
    html = html.replace(/(<span\b[^>]*\bdata-contact\b[^>]*>)[\s\S]*?<\/span>/g, (match, opening) => {
      const fallback = opening.match(/data-contact-fallback="([^"]*)"/)?.[1] || '문의 메일 준비 중';
      return opening + (contactEmail ? `<a href="mailto:${escape(contactEmail)}">${escape(contactEmail)}</a>` : fallback) + '</span>';
    });
    const metadata = `<!-- deploy-meta -->\n<link rel="canonical" href="${escape(url)}">\n<meta property="og:url" content="${escape(url)}">\n<meta property="og:type" content="website">\n<meta property="og:locale" content="ko_KR">\n<meta property="og:image" content="${escape(new URL('icon-512.png', base).href)}">\n<!-- /deploy-meta -->\n`;
    writeFileSync(path, html.replace('</head>', metadata + '</head>'));
  }
  writeFileSync(resolve(directory, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map((url) => `  <url><loc>${escape(url)}</loc></url>`).join('\n') + '\n</urlset>\n');
  writeFileSync(resolve(directory, 'robots.txt'), `User-agent: *\nAllow: ${base.pathname}\nDisallow: ${base.pathname}admin.html\nDisallow: ${base.pathname}admin.js\n\nSitemap: ${new URL('sitemap.xml', base).href}\n`);
  // ads.txt는 사이트 루트에서만 유효하다. 프로젝트 하위 경로에서는 메타로 소유권을 확인한다.
  if (publisherId && base.pathname === '/') writeFileSync(resolve(directory, 'ads.txt'), `google.com, ${publisherId.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n`);
  else rmSync(resolve(directory, 'ads.txt'), { force: true });
  return urls;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = fileURLToPath(new URL('../../web/', import.meta.url));
  preparePages(directory, process.env.PAGES_BASE_URL || 'https://olsd0.github.io/among/', { publisherId: process.env.ADSENSE_PUBLISHER_ID || '', contactEmail: process.env.CONTACT_EMAIL || '' });
  console.log(`공개 페이지 ${PUBLIC_PAGES.length}개: canonical · sitemap · robots · 광고 소유권 설정 생성 완료`);
}
