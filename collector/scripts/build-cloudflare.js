// Cloudflare Pages 빌드 (11/08 대표 결정: www.amongpick.com을 Cloudflare 무료 요금제로 운영).
// Cloudflare 프로젝트 설정 — 빌드 명령: node collector/scripts/build-cloudflare.js · 결과 폴더: web · 루트: 저장소 맨 위.
// GitHub Pages 워크플로(pages.yml)와 같은 순서로 검사 → 설정 주입 → 검색 주소 생성을 한다.
// 환경변수(모두 공개값, 비밀값 아님): SITE_URL(기본 https://www.amongpick.com/) · APPS_SCRIPT_URL · CONTACT_EMAIL · ADSENSE_PUBLISHER_ID
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { preparePages } from './prepare-pages.js';

export const SITE_URL = 'https://www.amongpick.com/';
// AMONG 애드센스 계정의 게시자 ID (공개값, 11/09 계정 화면에서 확인). Cloudflare 환경변수 ADSENSE_PUBLISHER_ID가 있으면 그 값이 우선.
// 대표 주소(www.amongpick.com)로 빌드할 때만 기본값을 쓰고, 다른 주소로 빌드하면 환경변수로만 넣는다.
export const ADSENSE_PUBLISHER_ID = 'pub-3507520612481684';
// collector와 web에 같은 내용이 있어야 하는 파일 (pages.yml의 '사본 확인'과 같은 목록)
export const COPIES = ['engine.js', 'product-images.js', 'notice-images.js', 'verified-news.js', 'app-coupons.js', 'online-deals-core.js'];

export function checkCopies(rootDir) {
  const stale = COPIES.filter((name) => readFileSync(resolve(rootDir, 'collector/src', name), 'utf8') !== readFileSync(resolve(rootDir, 'web', name), 'utf8'));
  if (stale.length) throw new Error(`web 사본이 오래됐어요: ${stale.join(', ')} (collector에서 npm run sync-web 후 커밋)`);
}

/** web/config.js에 공개 설정을 넣는다. 값이 없으면 저장소의 값을 그대로 둔다. 형식이 틀리면 멈춘다. */
export function injectConfig(text, env = {}) {
  const box = { window: {} };
  vm.runInNewContext(text, box);
  const cfg = { apiUrl: '', contactEmail: '', ...box.window.AMONG_CONFIG };
  const apiUrl = String(env.APPS_SCRIPT_URL || '').trim();
  const contactEmail = String(env.CONTACT_EMAIL || '').trim();
  if (apiUrl) cfg.apiUrl = apiUrl;
  if (contactEmail) cfg.contactEmail = contactEmail;
  if (cfg.apiUrl && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(cfg.apiUrl)) throw new Error('APPS_SCRIPT_URL 형식이 아니에요.');
  if (cfg.contactEmail && !/^[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}$/.test(cfg.contactEmail)) throw new Error('CONTACT_EMAIL 형식이 아니에요.');
  return { text: 'window.AMONG_CONFIG = ' + JSON.stringify(cfg) + ';\n', cfg };
}

export function buildSite(rootDir, env = {}) {
  const site = new URL(String(env.SITE_URL || SITE_URL).trim());
  if (site.protocol !== 'https:' || site.pathname !== '/' || site.search || site.hash || site.username || site.password) throw new Error('SITE_URL은 https://도메인/ 형식이어야 해요.');
  checkCopies(rootDir);
  const webDir = resolve(rootDir, 'web');
  const configPath = resolve(webDir, 'config.js');
  const { text, cfg } = injectConfig(readFileSync(configPath, 'utf8'), env);
  writeFileSync(configPath, text);
  const publisherId = String(env.ADSENSE_PUBLISHER_ID || '').trim() || (site.href === SITE_URL ? ADSENSE_PUBLISHER_ID : '');
  const urls = preparePages(webDir, site.href, { publisherId, contactEmail: env.CONTACT_EMAIL || '', pretty: true });
  return { site: site.href, urls, api: Boolean(cfg.apiUrl), contact: Boolean(cfg.contactEmail), publisher: Boolean(publisherId) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDir = fileURLToPath(new URL('../../', import.meta.url));
  const out = buildSite(rootDir, process.env);
  console.log(`대표 주소 ${out.site} · 공개 페이지 ${out.urls.length}개 · API ${out.api ? '있음' : '없음(예시 모드)'} · 문의 메일 ${out.contact ? '있음' : '미설정'} · AdSense 확인 메타 ${out.publisher ? '있음' : '미설정'}`);
}
