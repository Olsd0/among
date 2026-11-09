# 도메인 연결·광고 심사 준비

어몽의 공개 자료를 기준으로 정리한 배포 절차다. 외부의 ‘모두의 창업’ 프로젝트 자료와 운영자 실명·사업자 정보는 이 저장소에서 확인하지 못했다. 확인되지 않은 소속·성과·방문자 수·제휴 관계는 게시하지 않는다.

## amongpick.com 운영 (2026-11-08 대표 결정: Cloudflare 무료 요금제로 이전)

대표 주소는 `https://www.amongpick.com/`이다. GitHub Pages는 상거래·수익 목적 사이트의 무료 호스팅을 제한하므로 광고·제휴 수익을 계획한 어몽은 Cloudflare Pages(무료)로 옮긴다. 정적 파일·DNS·HTTPS 모두 무료라 추가 결제는 없다.

- **도메인**: 가비아에 등록(등록기관은 가비아 유지), 네임서버만 Cloudflare로 바꿔 DNS를 Cloudflare에서 관리한다. 루트 `amongpick.com`은 `www`로 301 이동한다.
- **배포**: Cloudflare Pages 프로젝트가 GitHub `Olsd0/among`의 `main`을 받아 빌드한다(미리보기 배포는 끔). 빌드 명령 `node --test collector/test/web-security.test.js && node collector/scripts/build-cloudflare.js`, 결과 폴더 `web`, Node 22. 저장소에 비밀값을 두지 않는다(Cloudflare GitHub 앱에 이 저장소 읽기만 허용).
- **공개 설정**: Cloudflare 프로젝트 환경변수(공개값)로 `SITE_URL`(기본 `https://www.amongpick.com/`), `CONTACT_EMAIL`, `ADSENSE_PUBLISHER_ID`를 넣는다. API 주소는 `web/config.js`의 값을 쓴다.
- **주소 형식**: Cloudflare Pages는 `guide.html`을 `/guide`로 308 이동시키므로 canonical·og:url·사이트맵은 확장자 없는 주소로 만든다(`prepare-pages.js`의 `pretty`). 화면 안 링크는 그대로 둔다.
- **보안 헤더** (`web/_headers`): 다른 사이트 안에 넣기 금지(frame-ancestors·X-Frame-Options), nosniff, HSTS 1년(미리 등록·하위 도메인 강제 없음), 관리 화면 검색 제외·저장 금지, `*.pages.dev` 기본 주소 검색 제외. 페이지별 CSP는 각 HTML의 meta 그대로.
- **Cloudflare 영역 설정**: 항상 HTTPS, 최소 TLS 1.2, 이메일 주소 난독화 끔(HTML·CSP를 바꾸지 않게), 자동 스크립트 삽입 기능(Rocket Loader·웹 분석 자동 삽입) 끔.
- **옛 주소**: 새 주소 확인 뒤 GitHub Pages는 `collector/scripts/build-moved-site.js` 결과를 배포한다. 옛 `olsd0.github.io/among/`의 모든 경로를 같은 경로·검색어·#의 새 주소로 보내고, 옛 서비스 워커와 캐시를 지운다. 이동 목적지는 새 도메인 안으로만 제한한다.
- **11/08 연결 결과 (실제 응답으로 확인)**: Cloudflare 계정(대표 메일)에 `amongpick.com` 무료 등록, 가비아 네임서버를 `brady.ns.cloudflare.com`·`mia.ns.cloudflare.com`으로 변경(소유자 인증은 대표). Pages 프로젝트 `among`(기본 주소 `among-8h2.pages.dev`, 검색 제외) — GitHub 앱은 `Olsd0/among` 하나에만 설치, 운영 브랜치 `main`만 배포(미리보기 배포 끔), 환경변수 `NODE_VERSION=22`·`SITE_URL`. 사용자 도메인 `www.amongpick.com`·`amongpick.com` 둘 다 Active·SSL, `amongpick.com/*` → `https://www.amongpick.com/${1}` 301(검색어 유지). 영역 설정: 항상 HTTPS·최소 TLS 1.2·TLS 1.3, 이메일 난독화 끔, **실사용자 측정(RUM·cloudflareinsights 비콘) 완전히 끔**(새 무료 영역은 기본으로 켜져 HTML에 추적 스크립트를 넣는다 — CSP가 막았지만 끔), 브라우저 캐시 TTL '기존 헤더 따름'(기본 4시간이 `sw.js`·설정 파일의 no-cache를 덮어씀), 봇 설정 동기화(robots.txt 앞에 덧붙이기) 끔. 없는 주소는 `web/404.html`이 404로(없으면 Pages가 홈을 200으로 돌려 중복 페이지가 됨).
- **새 주소에서 다시 할 일**: 쿠팡 파트너스 활동 매체에 `www.amongpick.com` 등록, 관리 화면 토큰은 새 주소에서 다시 입력. 구독·찜·최저 알림은 브라우저의 주소별 저장소라 새 주소에서 다시 선택해야 한다.

## 기존 준비 사항

- 홈: 비교 기준 설명, 키보드 바로가기, FAQ, 간결한 하단 안내, JS가 꺼진 경우 안내.
- 가이드: 동일 주문에서 정액·정률 할인을 비교하는 계산기. 입력값은 저장·전송하지 않는다.
- 광고·제휴: `partners.html`에서 제안 종류·광고 원칙·접수 항목을 안내한다.
- 직접 계약 광고: `web/config.js`의 `sponsorship`이 유효하고 계약 기간 안인 경우에만 목록 밖에 광고 한 건을 표시한다. 기본값은 `null`이다. 비어 있는 광고 자리나 가짜 광고를 표시하지 않는다.
- AdSense: 본인 게시자 ID가 있을 때 배포 과정에서 소유권 확인 메타를 생성한다. 루트 도메인에서는 `ads.txt`도 생성한다. 자동 광고 스크립트나 광고 쿠키는 아직 활성화하지 않는다.

## 심사 제출 전에 실제로 채울 정보

1. **운영 문의 이메일**: Cloudflare Pages 프로젝트 설정 → 환경변수에 `CONTACT_EMAIL`을 등록한다(옛 GitHub Pages용은 저장소 Variables). 소유하고 실제 수신 가능한 주소여야 한다. 사이트 소개·개인정보·광고 제휴 페이지에 표시되며, 배포 HTML에도 정적으로 기록한다. 현재 값이 없어 문의 접수는 아직 준비 상태다.
2. **운영자 표시**: 공개할 운영 주체·개인정보 보호책임자 정보와 실제 문의 처리 방식을 확인해 소개·개인정보 페이지에 반영한다. 현재 일반 명칭인 ‘AMONG 운영자’를 사용한다. 사업자번호·인증·지원사업 선정 사실은 확인 없이 기재하지 않는다.
3. **AdSense 계정**: 본인 계정의 공개 게시자 ID(`pub-` 또는 `ca-pub-` 뒤 16자리)를 Cloudflare Pages 환경변수 `ADSENSE_PUBLISHER_ID`에 등록한다. 비밀번호·API 키가 아니며 실제 계정 값만 사용한다. **11/09 적용**: 계정 화면에서 확인한 `pub-3507520612481684`를 `build-cloudflare.js`의 기본값으로 넣었다(대표 주소 빌드에만 적용, 환경변수가 있으면 환경변수 우선).
4. **도메인과 HTTPS**: 위 'amongpick.com 운영'대로 Cloudflare Pages에 `www.amongpick.com`·`amongpick.com`을 연결하고 인증서·301 이동·보안 헤더를 실제 응답으로 확인한다. canonical·사이트맵은 빌드가 대표 주소로 만든다.
5. **실제 공개 화면**: 공식 데이터가 로드되는지, 행사 기간과 최근 확인 시각이 유효한지, 출처·문의·정책 링크가 정상인지 확인한다. 로컬 예시 화면과 모의 API 테스트만으로 운영 데이터 최신성을 판단하지 않는다. 확인 시각을 현재 시각으로 바꿔 오래된 자료를 최신처럼 보이게 하지 않는다.

## (옛 방식) GitHub Pages에 새 도메인을 연결할 때 — 11/08부터 쓰지 않음

1. 사용할 도메인을 등록한 뒤 GitHub **계정 Settings → Pages → Add a domain**에서 소유권 확인을 시작한다. 등록기관 DNS에 GitHub가 표시하는 TXT 이름과 값을 그대로 넣고 **Verify**가 끝나면 TXT 레코드를 유지한다.
2. **Olsd0/among → Settings → Pages → Custom domain**에 실제 서비스 호스트를 저장한 다음 DNS를 연결한다. 서브도메인(예: www)은 해당 호스트의 CNAME을 `olsd0.github.io`로, 루트 도메인은 등록기관이 지원하는 ALIAS/ANAME 또는 GitHub 공식 문서의 A/AAAA 레코드로 연결한다. 필요한 호스트만 설정한다. 와일드카드 DNS는 사용하지 않는다.
3. DNS 확인과 인증서 발급 후 **Enforce HTTPS**를 켠다. Pages 워크플로를 다시 실행하고 http에서 https로 전환되는지, 새 주소에서 홈·온라인 특가·공식 링크·관리 화면을 열 수 있는지 확인한다. sitemap.xml과 canonical이 새 주소인지 확인한다.
4. 쿠팡 파트너스 활동 매체에 실제 도메인을 등록한다. 구독·찜·가격 알림은 브라우저의 출처별 저장소에 있어 새 도메인에서는 다시 선택해야 한다.
5. GitHub Pages에서는 각 HTML의 CSP와 referrer 정책이 동작한다. `_headers`는 Cloudflare Pages·Netlify용이다. HSTS·frame-ancestors를 직접 제어하려면 HTTP 응답 헤더를 지원하는 호스팅 또는 앞단 프록시에서 설정하고 실제 응답을 확인한다. 관리 화면은 최상위 창에서만 열리며 새로고침 후 관리 토큰을 다시 입력한다.

[GitHub 도메인 소유권 확인](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages) · [DNS 설정 및 레코드](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) · [HTTPS 설정](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)

## AdSense 연결 및 심사

본인 계정에서 최종 사이트 주소를 추가하고 지원되는 **메타 태그 방식의 사이트 소유권 확인**을 선택한다. 준비된 빌드가 공개 페이지에 `google-adsense-account` 메타를 넣는다. 루트 도메인일 때 생성되는 `ads.txt`의 게시자 ID가 본인 계정과 일치하는지 확인한다. GitHub 프로젝트 하위 경로(`/among/`)의 `ads.txt`는 도메인 루트 파일을 대신할 수 없으므로 생성하지 않는다.

공개 사이트에서 소유권 확인을 완료한 뒤 AdSense의 사이트 검토를 요청한다. 검토 요청 결과는 해당 AdSense 계정의 사이트 상태에서 확인한다. 자체 안내와 도구가 있고 기능이 정상이어도 콘텐츠 가치·정책 준수·사이트 심사 통과를 보장할 수 없다.

- Google 공식 안내: https://support.google.com/adsense/answer/7584263?hl=ko (사이트 연결)
- Google 공식 안내: https://support.google.com/adsense/answer/12171612?hl=ko (사이트 준비)
- Google 공식 안내: https://support.google.com/adsense/answer/7532444?hl=ko (ads.txt)

승인 후 실제 Google 광고 코드를 추가할 때는 개인정보처리방침의 사전 공지 기간, 적용 대상 지역의 동의 요구사항과 Google CMP 요건, CSP의 광고 출처 허용, 광고 배치와 모바일 속도를 함께 검증한다. 인증용 메타를 등록하는 것만으로 광고가 노출되거나 수익이 생기지 않는다. 도메인 변경 이후 AdSense 사이트 상태도 다시 확인한다.

## 직접 광고를 계약한 경우

다음 필드를 실제 계약 내용으로 `web/config.js`의 `sponsorship`에 넣는다. 검토할 테스트 데이터는 공개 설정에 넣지 않는다.

| 필드 | 값 |
| --- | --- |
| `enabled` | 계약과 소재 확인 후 `true` |
| `advertiser` | 광고주 이름 (60자 이내) |
| `title` | 사실을 확인한 제목 (100자 이내) |
| `description` | 조건을 포함한 설명 (240자 이내) |
| `url` | 인증정보 없는 광고주 HTTPS 주소 |
| `startsAt`, `endsAt` | 시간대를 명시한 ISO 8601 시작·종료 시각 |

‘광고 · 광고주 이름’과 외부 이동 안내가 표시되며 링크에는 `sponsored noopener noreferrer`가 붙는다. 계약 기간 전·후나 잘못된 설정은 표시하지 않는다. 열린 탭도 종료 시 숨긴다. 외부 광고 스크립트·추적 픽셀·클릭 기록 수집은 하지 않는다. 단가·노출 보장·환불 조건은 실제 트래픽을 확인한 뒤 별도 협의한다. 쿠팡 제휴는 `docs/online-deals-trial.md`(온라인 특가 자동화) 절차를 따른다.

## 검증

`cd collector && npm test`로 기존 엔진·백엔드·브라우저 테스트와 새 출시 준비 검사를 실행한다. `launch-readiness.test.js`는 인증 메타·ads.txt의 생성/제거, 잘못된 ID 차단, 계산 경계값, 광고 기간·링크 검사를 한다. `launch-browser.test.js`는 320/390/1280px 화면, 계산 결과, 문의 링크, 광고의 문구 이스케이프·외부 요청 없음·기간 종료를 확인한다.

온보딩 환경의 Playwright Chromium 다운로드는 도메인 정책에서 차단되어 있다. 이번 검증은 설치된 Chromium 154를 Playwright의 `executablePath`로 지정한 로컬 검증용 런타임 설정으로 수행한다. 저장소의 기본 테스트 명령과 CI의 고정 Playwright 버전은 유지한다. 고정 Chromium 환경 검증은 네트워크 허용 적용 후 `npx playwright install chromium && npm test`로 별도 확인한다.

최종 검증(2026-10-31): 시스템 Chromium 154로 전체 테스트 167개 통과, 실패·건너뜀 0개. 공개 페이지 6개의 로컬 링크·자산 검사 및 `git diff --check` 통과. 테스트에서는 예시 데이터·모의 API를 사용했으며 실제 운영 API의 데이터 최신성, 공개 배포, 도메인 연결, AdSense 신청은 아직 검증/진행하지 않았다. 작업공간 변경 상태로 제공한다.
