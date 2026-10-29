// Pages의 실제 배포 주소를 검색 메타데이터의 단일 기준으로 사용한다.
// 별도 도메인 환경변수나 매일 실행하는 작업은 필요 없다.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function preparePages(directory, baseUrl) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('유효한 HTTPS 배포 주소가 필요합니다.');
  base.pathname = base.pathname.replace(/\/+$/, '') + '/';
  const pages = ['index.html', 'guide.html', 'about.html', 'privacy.html', 'terms.html'];
  const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const urls = [];
  for (const page of pages) {
    const url = new URL(page === 'index.html' ? './' : page, base).href;
    urls.push(url);
    const path = resolve(directory, page);
    let html = readFileSync(path, 'utf8').replace(/\n?<!-- deploy-meta -->[\s\S]*?<!-- \/deploy-meta -->\n?/g, '\n');
    html = html.replace(/<meta property="og:image"[^>]*>\n?/g, '');
    const metadata = `<!-- deploy-meta -->\n<link rel="canonical" href="${escape(url)}">\n<meta property="og:url" content="${escape(url)}">\n<meta property="og:type" content="website">\n<meta property="og:locale" content="ko_KR">\n<meta property="og:image" content="${escape(new URL('icon-512.png', base).href)}">\n<!-- /deploy-meta -->\n`;
    writeFileSync(path, html.replace('</head>', metadata + '</head>'));
  }
  writeFileSync(resolve(directory, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map((url) => `  <url><loc>${escape(url)}</loc></url>`).join('\n') + '\n</urlset>\n');
  writeFileSync(resolve(directory, 'robots.txt'), `User-agent: *\nAllow: ${base.pathname}\nDisallow: ${base.pathname}admin.html\nDisallow: ${base.pathname}admin.js\n\nSitemap: ${new URL('sitemap.xml', base).href}\n`);
  return urls;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = fileURLToPath(new URL('../../web/', import.meta.url));
  preparePages(directory, process.env.PAGES_BASE_URL || 'https://olsd0.github.io/among/');
  console.log('공개 페이지 5개: canonical · sitemap · robots 생성 완료');
}
