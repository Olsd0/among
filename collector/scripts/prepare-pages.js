// 배포 주소를 검색 메타데이터(canonical·og:url·사이트맵·robots)의 단일 기준으로 사용한다.
// GitHub Pages: Pages가 알려 주는 주소. Cloudflare Pages(www.amongpick.com, 11/08): build-cloudflare.js가 SITE_URL로 부른다.
// pretty: Cloudflare Pages는 guide.html을 /guide로 308 이동시키므로 대표 주소도 확장자 없는 주소로 쓴다.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC_PAGES = ['index.html', 'guide.html', 'about.html', 'partners.html', 'privacy.html', 'terms.html'];

export function pageUrl(page, base, pretty = false) {
  if (page === 'index.html') return new URL('./', base).href;
  return new URL(pretty ? page.replace(/\.html$/, '') : page, base).href;
}

export function preparePages(directory, baseUrl, { publisherId = '', contactEmail = '', pretty = false } = {}) {
  publisherId = publisherId.trim().replace(/^pub-/, 'ca-pub-');
  contactEmail = contactEmail.trim();
  if (publisherId && !/^ca-pub-\d{16}$/.test(publisherId)) throw new Error('ADSENSE_PUBLISHER_ID는 pub- 또는 ca-pub- 뒤에 16자리 숫자가 필요합니다.');
  if (contactEmail && !/^[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}$/.test(contactEmail)) throw new Error('CONTACT_EMAIL 형식이 아닙니다.');
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('유효한 HTTPS 배포 주소가 필요합니다.');
  base.pathname = base.pathname.replace(/\/+$/, '') + '/';
  const pages = PUBLIC_PAGES;
  const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const urls = [];
  for (const page of pages) {
    const url = pageUrl(page, base, pretty);
    urls.push(url);
    const path = resolve(directory, page);
    let html = readFileSync(path, 'utf8').replace(/\n?<!-- deploy-meta -->[\s\S]*?<!-- \/deploy-meta -->\n?/g, '\n');
    // 공유 미리보기(카카오톡·메신저): 1200×630 share.png (11/12 — 전에는 정사각 아이콘이 떴다)
    html = html.replace(/<meta property="og:image(?::width|:height)?"[^>]*>\n?/g, '').replace(/<meta name="twitter:card"[^>]*>\n?/g, '');
    // 본인 ID가 있을 때만 소유권 확인 메타를 만든다. 광고 스크립트는 삽입하지 않는다.
    html = html.replace(/\n?<!-- adsense-verification -->[\s\S]*?<!-- \/adsense-verification -->\n?/g, '\n');
    if (publisherId) html = html.replace('</head>', `<!-- adsense-verification -->\n<meta name="google-adsense-account" content="${publisherId}">\n<!-- /adsense-verification -->\n</head>`);
    // 검색 로봇과 JS를 끈 방문자도 실제 문의처를 읽을 수 있도록 배포 시 생성한다.
    html = html.replace(/(<span\b[^>]*\bdata-contact\b[^>]*>)[\s\S]*?<\/span>/g, (match, opening) => {
      const fallback = opening.match(/data-contact-fallback="([^"]*)"/)?.[1] || '문의 메일 준비 중';
      return opening + (contactEmail ? `<a href="mailto:${escape(contactEmail)}">${escape(contactEmail)}</a>` : fallback) + '</span>';
    });
    const metadata = `<!-- deploy-meta -->\n<link rel="canonical" href="${escape(url)}">\n<meta property="og:url" content="${escape(url)}">\n<meta property="og:type" content="website">\n<meta property="og:locale" content="ko_KR">\n<meta property="og:image" content="${escape(new URL('share.png', base).href)}">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta name="twitter:card" content="summary_large_image">\n<!-- /deploy-meta -->\n`;
    writeFileSync(path, html.replace('</head>', metadata + '</head>'));
  }
  writeFileSync(resolve(directory, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map((url) => `  <url><loc>${escape(url)}</loc></url>`).join('\n') + '\n</urlset>\n');
  // 관리 화면은 admin.html·admin(확장자 없는 주소)·admin.js 등 모두 'admin'으로 시작한다.
  writeFileSync(resolve(directory, 'robots.txt'), `User-agent: *\nAllow: ${base.pathname}\nDisallow: ${base.pathname}admin\n\nSitemap: ${new URL('sitemap.xml', base).href}\n`);
  // ads.txt는 사이트 루트에서만 유효하다. 프로젝트 하위 경로에서는 메타로 소유권을 확인한다.
  if (publisherId && base.pathname === '/') writeFileSync(resolve(directory, 'ads.txt'), `google.com, ${publisherId.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n`);
  else rmSync(resolve(directory, 'ads.txt'), { force: true });
  return urls;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = fileURLToPath(new URL('../../web/', import.meta.url));
  const urls = preparePages(directory, process.env.PAGES_BASE_URL || 'https://olsd0.github.io/among/', { publisherId: process.env.ADSENSE_PUBLISHER_ID || '', contactEmail: process.env.CONTACT_EMAIL || '', pretty: process.env.PRETTY_URLS === '1' });
  const hasPublisher = Boolean(process.env.ADSENSE_PUBLISHER_ID?.trim());
  const root = new URL(urls[0]);
  console.log(`배포 주소 ${root.href} · 공개 페이지 ${urls.length}개 · 사이트맵 및 robots.txt 생성`);
  console.log(`AdSense 확인 메타 ${hasPublisher ? '있음' : '미설정'} · ads.txt ${hasPublisher && root.pathname === '/' ? '생성' : '생성 안 함'} · 공개 문의 메일 ${process.env.CONTACT_EMAIL?.trim() ? '있음' : '미설정'}`);
}
