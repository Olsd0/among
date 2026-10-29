# AMONG (어몽)

프랜차이즈 자사앱 쿠폰을 같은 기준(쿠폰가·할인율·단품/세트·주문 방법·대상·기간)으로 비교하고, 고른 혜택을 공식 앱으로 연결하는 모바일 웹 서비스.

```
공개 공식 페이지 ──(매일 00시 KST / 갱신 버튼)──▶ GitHub Actions
   │  robots.txt 확인 (AI 수집 거부 포함)
   ▼
Playwright 렌더링 (모바일 430px, 텍스트 + 스크린샷 최대 4장)
   ▼
Claude 추출 (tool use로 JSON 고정, "읽기"만)           collector/src/extract.js
   ▼
규칙 엔진: 적용가 계산 · 근거 대조 · 게시/보류/버림   collector/src/engine.js
   ▼
Apps Script 웹앱 → 구글시트 (coupons · news · sources · run_log · events · reports · nutrition)
   ▼
비교 화면 web/index.html  ·  지표 대시보드 web/admin.html  (GitHub Pages)
```

## 폴더

| 경로 | 내용 |
|---|---|
| `collector/src/engine.js` | 할인 판단 엔진. 계산·검증·정렬·필터는 전부 여기. 브라우저와 공용 (`web/engine.js`는 사본) |
| `collector/src/extract.js` | Claude Messages API 호출 (SDK 없이 `fetch`), `MOCK_CLAUDE=1` 테스트 모드 |
| `collector/src/fetch.js` · `robots.js` | 렌더링, 상세 페이지 따라가기, robots.txt |
| `collector/src/run.js` | 전체 실행 + 실행 기록 |
| `collector/src/check-sources.js` | 출처 점검 (Claude 호출 없이 접속·텍스트·스크린샷만) |
| `collector/src/engine.js` (v5) | `pickImage`·`normalizeNews`·`linkNews`·`pickHeadlines`·`matchesKind`·`benefitLabel` |
| `collector/src/nutrition.js` | 영양성분 가져오기 (식약처 공공데이터 → 우리 브랜드 → 1개 기준 환산 → 열량 검산 → 시트). AI 호출 없음 |
| `collector/sources.example.json` | 출처 초기값 (브랜드 자체 페이지 + 통신사 멤버십·네이버페이·SPC 브랜드) |
| `apps-script/Code.gs` | 시트 백엔드 (공개 API · 수집기 API · 지표) |
| `.github/workflows/collect.yml` | 00시 예약 + 수동/버튼 실행, `mode=check` 점검 |
| `.github/workflows/pages.yml` | `web/` GitHub Pages 배포 |
| `web/` | 비교 화면(`index.html` + `app.js`), 지표 대시보드(`admin.html` + `admin.js`), 안내 페이지(`about`·`privacy`·`terms` + `doc.css`·`doc.js`), PWA 파일 |
| `web/_headers` | 독립 도메인 + Cloudflare Pages/Netlify로 옮길 때 쓰는 보안 헤더 (GitHub Pages는 무시) |
| `SECURITY.md` · `.github/dependabot.yml` | 보안 신고 창구, 의존성·액션 업데이트 알림 |

## 로컬에서

```bash
cd collector
npm install                 # playwright 1.63.0 (첫 설치 후 package-lock.json 커밋)
npx playwright install chromium
npm test                    # 엔진·robots·추출·종단·Apps Script 테스트 (Claude 호출 없음)
npm run check-sources       # 실제 출처 접속 점검 → out/shots/ 스크린샷
ANTHROPIC_API_KEY=... node src/run.js   # 시트 없이 실행하면 out/coupons.json 에만 저장
npm run sync-web            # engine.js 수정 후 web/engine.js 갱신 (안 하면 테스트·배포가 막음)
```

화면 미리보기: `web/` 폴더를 아무 정적 서버로 열기 (예: `npx serve web`). `config.js`의 `apiUrl`이 비어 있으면 **예시 데이터 모드**(가상의 브랜드)로 열린다.

## 배포 (처음 1회, 약 30분)

### 1. 구글시트 + Apps Script
1. 새 구글시트 만들기 → **확장 프로그램 → Apps Script**
2. `Code.gs` 내용을 붙여넣기. 프로젝트 설정에서 "appsscript.json 매니페스트 파일 표시"를 켜고 `apps-script/appsscript.json` 내용으로 바꾸기
3. 편집기에서 `setup` 함수 실행 → 권한 승인 → 탭 5개와 출처 5개가 생기고, 스크립트 속성에 `COLLECTOR_TOKEN`·`ADMIN_TOKEN`이 자동 생성됨
4. **배포 → 새 배포 → 웹 앱**, 실행: 나, 액세스: 모든 사용자 → URL 복사
   - 코드를 고치면 **배포 관리 → 수정 → 새 버전**을 해야 반영된다

### 2. GitHub 저장소
공개 저장소를 권장 (Pages·Actions 무료 범위). 비밀값은 코드가 아니라 Secrets에만 둔다.

| 위치 | 이름 | 값 |
|---|---|---|
| Settings → Secrets → Actions | `ANTHROPIC_API_KEY` | Claude API 키 (있으면 Claude 우선) |
| Settings → Secrets → Actions | `GEMINI_API_KEY` | Google AI Studio 키 — 무료 한도 실험용. Claude 키가 없을 때 사용 (모델 기본 `gemini-3.5-flash-lite`, 변수 `GEMINI_MODEL`로 변경) |
| | `APPS_SCRIPT_URL` | 1-4의 웹앱 URL |
| | `COLLECTOR_TOKEN` | 스크립트 속성의 같은 값 |
| | `DATA_GO_KR_KEY` | 선택. 공공데이터포털 '전국통합식품영양성분정보(음식)표준데이터' 활용신청 후 받은 **일반 인증키(Decoding)**. 있으면 주 1회 영양성분 자동 갱신 |
| Settings → Variables → Actions | `APPS_SCRIPT_URL` | 같은 URL (화면 배포용, 공개돼도 되는 값) |
| | `NUTRITION_FIELD_MAP` | 선택. 영양성분 API 필드 이름이 바뀌었을 때만 (예: `{"name":"FOOD_NM_KR"}`) |
| | `CLAUDE_MODEL` | 선택. 비우면 `claude-haiku-5-5` |
| | `BOT_CONTACT_URL` | 선택. 수집기 User-Agent에 넣을 연락처(저장소 주소 등) |

Settings → Pages → Source: **GitHub Actions** → `pages` 워크플로 실행 → 화면 주소 확인.

### 3. 즉시 갱신 버튼 연결
GitHub → Settings → Developer settings → **Fine-grained token**: 이 저장소 1개, 권한 *Actions: Read and write*.
Apps Script 스크립트 속성에 `GITHUB_TOKEN`(토큰), `GITHUB_REPO`(`owner/repo`) 추가. 버튼은 10분 쿨다운, 실행 중에는 새 요청을 받지 않는다.

### 4. 첫 점검 → 첫 수집
1. Actions → collect → Run workflow → **mode = check** → 실행 결과 Artifacts의 스크린샷과 `check-sources.json` 확인
   - `robots.txt에서 … 거부`로 나온 출처는 수집할 수 없다 → sources 탭에서 `active`를 `FALSE`
   - 상세 링크가 0개면 `follow` 선택자를 실제 링크 형식에 맞게 수정 (sources 탭만 고치면 됨, 코드 수정 불필요)
2. mode = collect 실행 → coupons 탭 확인 → `node scripts/audit-sample.js out/coupons.json 20`으로 표본 대조표를 만들어 **추출 정확도** 측정

## v4 (2026-10-27) 반영 방법

1. 저장소에 반영(push) → `pages`가 화면을 자동 배포
2. Apps Script 편집기에 새 `Code.gs` 붙여넣기 → 프로젝트 설정에서 매니페스트(`appsscript.json`)도 교체(권한 `script.scriptapp` 추가됨) → **배포 관리 → 수정 → 새 버전**
   - 배포 후 첫 요청 때 자동으로: coupons에 `programs·program_note·how_to_use·stackable`, sources에 `program·follow_text` 열 추가, `nutrition` 탭 생성, 새 출처 7개 추가 (기존 열·행은 그대로)
3. 편집기에서 `installTriggers` 1회 실행 → 매일 00시대 정시 수집 (GitHub 예약 실행은 늦게 오면 스스로 건너뜀). `GITHUB_TOKEN`·`GITHUB_REPO` 스크립트 속성이 있어야 동작
4. (선택) `DATA_GO_KR_KEY` 등록 → Actions → collect → mode `nutrition` 1회 실행 → 주석에서 브랜드별 메뉴 수 확인
5. Actions → collect → mode `check`, only `tmembership-brand,kt-membership-food,uplus-membership,npay-cafe,baskin-event,paris-promo` → robots 판정·글자 확인. 막힌 출처는 sources 탭에서 `active=FALSE`

알아둘 점
- **id 안정화**: 수집기가 저장 전에 지금 게시 중인 쿠폰과 비교해, 브랜드·할인 종류·할인 크기·대상이 같고 메뉴가 비슷하면 예전 id를 이어 쓴다 (AI가 날마다 표기를 조금씩 바꿔 '사라짐/새로 생김'이 반복되던 문제. 10/27 아침 실행 기준 34건 중 15건이 이 경우). 끄려면 변수 `STABILIZE_IDS=0`
- 특정 카드사 결제 할인·외부 배달앱 전용 행사·우리 목록 밖 결제수단(페이코인·삼성페이 등) 할인은 엔진이 버린다. "T멤버십 할인과 중복 불가"처럼 제외 문맥에 나온 통신사 이름, "해피포인트 0.1% 적립"처럼 적립 안내에만 나온 이름은 필요 조건으로 보지 않는다
- AI가 기간을 비우거나 날짜가 아닌 글자를 넣으면 엔진이 근거 문구의 "(8/19~8/21)", "(~12/31)"에서 기간을 읽는다 (주석에 '기간은 근거 문구에서 읽음'). 지난 행사는 버린다
- 통신사 등급별 할인은 가장 낮은 등급 값(등급별 가격이면 가장 낮은 등급 %), '최대 N%' 홍보 문구와 실제 등급 값이 따로 잡히면 낮은 값 하나만 남긴다
- `check`·`dry` 모드는 `only`에 시트에 아직 없는 출처 id를 넣으면 `sources.example.json`에서 가져와 시험한다 (시트에 넣기 전 확인용)

## v5 (2026-10-28) — 홈 개편 · 소식(핫딜) · 쿠폰 사진

- **홈**: 오늘의 핫딜(가로로 넘기는 카드) → 아이콘(위: 음식 종류, 아래: 1+1·곧 마감·통신사·페이·신규가입) → 쿠폰 티켓 목록. 소식 상세는 `?n=소식id`
- **소식(핫딜)**: 따로 뉴스를 모으지 않는다. 쿠폰을 가져오는 공식 이벤트·공지 페이지(브랜드 이벤트, T world 혜택, 네이버페이 캠페인, SPC 브랜드 페이지)를 **같은 수집 때 함께** 읽어 `news` 탭을 갱신한다. 쿠폰과 같은 검증(근거 문구·기간·카드·배달앱)을 거친 것만 게시. 제목·요약은 사실만 우리 문장으로, 원문 링크를 함께 둔다
- **핫딜 선정** `pickHeadlines()`: 공식 소식 + 남은 기간 3일 이하 큰 혜택(30% 이상·1+1) + 오늘·어제 처음 잡힌 큰 혜택. 같은 브랜드 2장까지, 내 할인 수단으로 못 쓰는 것은 뒤로
- **사진**: 공식 메뉴에서 직접 확인한 상품 사진만 `collector/src/product-images.js`에 출처와 함께 등록한다. 브랜드·메뉴·크기·수량이 정확히 일치해야 하며, 단품 사진을 세트에 사용하지 않는다. 행사 배너·OG 대표 이미지·주변 문구·연결 쿠폰으로 사진을 추측하지 않는다. 화면도 같은 목록으로 기존 API/기기 저장본의 이미지 주소를 다시 걸러낸다. 미확인 상품은 사진 없이 표시. 파일을 복제하지 않고 원래 URL을 지연 로딩한다.
- **금액 표기**: 혜택 라벨은 `3000원`, `15000원`처럼 축약이나 쉼표 없이 작은 글자로 표시한다. 할인율·1+1 표시는 유지한다.
- **robots 거부**: 출처 첫 페이지가 robots.txt(일반·AI 수집 거부)로 막히면 그 출처의 쿠폰·소식을 내린다 (주석에 `⊘`. `active`를 그대로 두면 매일 다시 확인해 거부가 풀리면 자동으로 다시 수집. `FALSE`로 끄면 예전 쿠폰이 내려가지 않으니 주의)
- 반영: push → Apps Script에 새 `Code.gs` → 배포 관리 → 새 버전. 첫 요청에서 `news` 탭·coupons `image_url` 열·새 출처(`tworld-benefit`) 자동 추가
- 숨기기: 소식이 틀리면 news 탭 해당 행 `status`를 `hidden` (자동 수집이 되살리지 않음)

## v6 (2026-10-28) — 광고 심사 전 보안 · 개인정보 정비

- **공개 API 남용 방지 (Apps Script)**: 공개 POST(refresh·event·report)는 4KB 이하·브라우저 id 형식 검사·빈도 제한(이용 기록 브라우저당 10분 120건/전체 1시간 3000건, 제보 브라우저당 1시간 5건/전체 60건). 넘치면 이용 기록은 조용히 버리고 제보는 `too_many`
- **바로 갱신 하루 상한**: `REFRESH_DAILY_MAX`(기본 6). 00시 정시 수집과는 별개. 실패 원인은 화면에 안 보이고 지표(`security.last_refresh_error`)에서만
- **시트 보호**: 공개 입력은 수식으로 해석되지 않게(`= + - @` 시작이면 앞에 `'`), 제어문자 제거, 제보 메모의 전화번호·메일 주소는 지우고 저장. 공개 기록은 잠금 안에서 한 줄씩. 탭 행이 모자라면 500행씩 자동 확장
- **보관 기간**: 이용 기록 180일·제보 365일 지나면 `run_finish` 때 자동 삭제 (`purgeOld_`, 개인정보처리방침과 같은 값)
- **오류 문구**: 토큰 없는 요청에는 `server_error`만 (내부 탭 이름·GitHub 응답 숨김)
- **화면 CSP**: 스크립트를 `app.js`·`admin.js`로 분리, 인라인 처리기 제거 → `script-src 'self'`. 데이터는 `script.google.com`에서만, 사진은 https만, 공식 링크도 https만. 관리 화면은 외부 글꼴 없이
- **개인정보**: 개인정보처리방침에 `이용 기록 보내기` 스위치·`이 기기 정보 지우기`. 브라우저의 추적 거부(GPC) 신호를 존중
- **안내 페이지**: 서비스 소개(`about.html`)·개인정보처리방침(`privacy.html`, 광고 쿠키 안내 포함)·이용약관(`terms.html`), 홈 하단 링크
- **문의 메일**: `web/config.js`의 `contactEmail` 또는 저장소 변수 `CONTACT_EMAIL` (비우면 '준비 중' 안내)
- **워크플로**: 외부 액션 커밋 해시 고정, `persist-credentials: false`, `npm ci`(잠금 파일 `collector/package-lock.json`), 실행 결과는 JSON만 3일(화면 사진은 올리지 않음). Dependabot 주 1회
- **광고를 붙일 때**: `index.html` CSP에 광고 주소 추가(`script-src`·`frame-src`·`connect-src`·`img-src`), 핫딜·정렬은 광고와 무관하게 유지, 광고 영역은 '광고' 표시로 목록과 분리, 개인정보처리방침 7번 갱신 + 시행 7일 전 공지, 독립 도메인 루트에 `ads.txt`

## 운영

### 개인정보·운영 점검 (2026-10-28)

- 저장소의 Apps Script 변경은 GitHub Pages와 별도로 배포해야 한다. 배포 상태를 확인하기 전에는 공개 API의 크기·빈도 제한, 제보 입력 보호, 보관 기간 자동 정리가 실제로 작동한다고 가정하지 않는다.
- 보관 기간 정리는 `run_finish`에 연결되므로 수집 작업이 중단되면 실행이 늦어질 수 있다. 날짜를 해석할 수 없는 기록도 자동 삭제 대상에서 제외되므로 운영자가 확인한다. 이용 기록 180일·제보 365일 기준은 자동 정리의 실행 여부를 관리자가 점검해야 한다.
- 이용 기록을 끈 상태에서 기기 정보를 지워도 거부 설정은 유지된다. 거부 설정까지 지우려면 브라우저의 사이트 데이터 삭제 기능을 이용한다.
- `tests` 워크플로는 push/PR에서 잠금 파일로 의존성과 브라우저를 설치해 전체 테스트를 실행한다. 공개 수집이나 시트 쓰기는 하지 않는다.
- **운영 API 보안 점검** 워크플로는 수동으로 실행한다. 실제 제보나 기록을 추가하지 않는 잘못된 요청으로 크기·브라우저 ID·토큰 차단과 쿠폰 조회를 확인한다. Pages와 마찬가지로 저장소 변수 `APPS_SCRIPT_URL`을 우선 사용한다.

- **브랜드 추가**: sources 탭에 행 추가 (id·brand·category·url, 필요하면 follow)
- **오류 제보**: reports 탭 확인 → 맞으면 coupons 탭 해당 행의 `status`를 `hidden` (자동 수집이 되살리지 않음)
- **지표**: `admin.html` → ADMIN_TOKEN 입력. "보고서용 요약 복사"는 실측값만 복사 (예시 모드에서는 막힘)
- **비용**: 실행마다 토큰 수가 run_log에 남는다. 단가는 Anthropic 가격표 기준으로 계산
- **주의**: 공개 저장소에 60일간 커밋이 없으면 GitHub가 예약 실행을 멈춘다. 예약 실행은 수 분~수십 분 늦을 수 있다
- **결제**: 창업활동자금 카드는 국내 원화 결제만 승인 → API 결제 경로는 별도 확인 (팀 내부 인수인계 문서 참고)

## 지키는 원칙

- 공개 공식 페이지만, robots.txt(일반 + AI 수집 거부) 준수, 하루 1회 + 버튼(10분 쿨다운·하루 6회), 페이지 간 1.5초 간격
- 앱 내부 API·로그인 영역·자동 조작은 하지 않는다. 상품·공지 이미지는 공식 출처와 일치하는 경우에만 표시한다.
- AI는 읽기만. 숫자가 페이지에 실제로 있는지 엔진이 대조하고, 애매하면 게시하지 않는다(보류)
- 이용 기록은 브라우저별 무작위 id만 (이름·연락처 없음, 180일 보관, 끌 수 있음). 비밀값은 GitHub Secrets·스크립트 속성에만


## 브랜드 탐색 UI (2026-10-29)

- 전체 혜택 / 브랜드별 / 구독 브랜드 탐색. 브랜드별 화면의 작은 버튼으로 즉시 구독·취소. `among_following`은 로컬 저장만 하며 서버로 전송하거나 푸시 알림을 발송하지 않는다. 저장 실패 시 구독 상태를 바꾸지 않는다.
- 공지 사진은 `collector/src/notice-images.js`에 확인한 공지 URL·이미지·제목 단서·유효기간을 등록한다. 상품 사진은 기존 상품 목록으로 구분한다. 공지 이미지 위에 제목을 덮지 않고 별도 영역에 표시하며 상세에서 전체 원본을 열 수 있다.
- 기존 앱 아이콘 옆에 영문 AMONG 워드마크만 표시. 모바일 한 열, 넓은 화면 두 열. 숫자 금액은 18px 전체 숫자를 유지한다.
- 참고: 29CM 공식 홈의 브랜드·카테고리 탐색, 네이버페이 공식 서비스 목록의 혜택 분류. 화면 구성과 스타일은 AMONG에 맞게 구현했다.

## 공지 카드·브랜드 로고 (2026-10-29)

- 핫딜 공지 카드 아래의 중복 할인 숫자를 제거했다. 공지 이미지와 제목은 그대로이며 상품 혜택 카드의 금액 표시는 유지한다.
- `web/brand-logos.js`에 22개 브랜드의 공식 홈페이지에서 확인한 로고·아이콘과 확인 출처를 기록했다. 브랜드 이름으로 연결하므로 통신사 제휴 출처 및 쿠폰 없이 공지만 있는 브랜드에서도 사용할 수 있다.
- 등록되지 않은 브랜드의 기존 아이콘 경로는 유지하고, 이미지 로딩 실패 시 브랜드 첫 글자로 대체한다. 외부 이미지는 지연 로딩하며 별도로 저장하지 않는다.

## 운영 단순화 · 공개 페이지 (2026-10-29)

- 공식 로고 22개는 `web/assets/brands/`의 원본 정적 파일을 사용한다. 파일명은 내용 해시이며 원본 URL·확인 출처는 `web/brand-logos.js`에 보존한다. 일일 수집이나 AI 작업에 로고 갱신은 없다. 로고가 바뀔 때만 확인 후 수동 교체한다. 미등록 브랜드의 기존 대체 아이콘은 유지한다.
- 로고와 버전 지정 모듈은 서비스 워커 캐시에서 재사용한다. 로고는 실제로 본 것만 저장한다. HTML·설정·안내 페이지는 네트워크 우선이며 혜택 API는 서비스 워커에 저장하지 않는다.
- 같은 내용의 핫딜·브랜드 패널·목록은 DOM을 보존한다. 중복 혜택 요청은 하나로 합치고, 숨겨진 탭에서는 진행 중 수집 상태 폴링을 쉬며, 갱신 POST는 20초에 종료한다. 동작 줄이기 설정에서는 전환·스피너·부드러운 스크롤을 사용하지 않는다.
- `guide.html`은 쿠폰가/정액/정률/1+1/적립/사용 조건을 설명하는 자체 작성 안내다. 예제는 실제 행사가 아님을 명시한다. 자바스크립트 없이도 읽을 수 있다.
- 배포 때 `actions/configure-pages`의 `base_url`을 받아 `collector/scripts/prepare-pages.js`가 공개 페이지 5개의 canonical·공유 이미지 절대 주소·sitemap.xml·robots.txt를 생성한다. 별도 도메인 환경변수나 주기 실행은 없다. 로컬 기본값은 현재 GitHub Pages 주소다.
- 사용자 도메인은 GitHub Pages 설정에서 소유권/DNS/HTTPS를 연결한 후 Pages를 다시 배포하면 검색 주소에 반영된다. `robots.txt`는 도메인 루트에 있을 때 적용되므로 현재 프로젝트 하위 주소에서는 관리자 페이지 자체의 `noindex`도 유지한다.
- 광고 심사는 아직 제출하지 않았다. 실제 도메인과 본인의 AdSense 게시자 ID를 확인한 뒤 인증 메타 태그 또는 ads.txt를 연결하고 검토를 요청한다. 허위 ID·광고 스크립트·광고 추적은 추가하지 않았다. 광고를 실제로 시작할 때는 기존 개인정보처리방침의 사전 안내와 광고 구분, 필요한 동의를 적용한다. 기술 점검이나 가이드 추가가 Google의 승인을 보장하지는 않는다.

### 2026-10-29 공지 이미지·결제 적립 행사

- 공식 공지 이미지 연결을 확대했다. 목록은 공식 썸네일을 우선 사용하고 상세에서만 긴 원본 포스터를 불러온다. 해당 행사 사진이 확인되지 않으면 빈 상태를 유지한다. 파파이스 9MB 원본은 상세에서만 불러와 목록의 불필요한 대용량 다운로드를 막는다.
- `verified-news.js`는 자동 수집에서 누락된 기간 한정 공지를 수동 확인해 보완한다. 확인 시각은 실제 확인한 때로 고정하고, 기존 48시간 최신성 기준과 종료일 숨김을 적용한다. 다음 기간으로 자동 복사하지 않는다. 자동 수집에 같은 브랜드·기간·결제 프로그램의 행사가 있으면 중복 추가하지 않는다.
- 설빙 공식 홈페이지(`https://sulbing.com/index.php`)가 임베드한 `https://lightwidget.com/widgets/5c0b63b1dd1d5204bcf0cf1ea0387291.html`에서 `https://www.instagram.com/p/De8DZxPDXBr/`와 공식 포스터를 확인했다. 기간 2026-10-28~11-01, 포인트·머니 9900원 이상 결제, 50% 포인트 적립, 기간 합산 1인 최대 30000원, 카드·머니카드 제외. 이미지의 할인 표현과 달리 서비스 문구는 포인트 적립으로 명시한다.
- 설빙 포스터는 공식 피드 CDN의 원본 JPEG(수정 없음)를 `web/assets/notices/`에 해시 파일명으로 보관한다. 만료되는 CDN URL을 매일 갱신하지 않는다.

- 해피포인트 공식 공유 주소의 `og:title`에서 10/26~10/30 쉑버거 선착순 1+1을 확인해 추가했다. 상세 조건은 앱에서 확인하도록 안내하며 확인되지 않은 사용 횟수·가격·제외 매장을 추정하지 않는다. 공통 OG 로고를 행사 포스터로 쓰지 않는다.
- 해피포인트 공지·쿠폰은 1+1 또는 50% 이상 할인만 핫딜 후보로 사용한다. 적립·일반 증정은 이 기준을 충족하지 않는다. 다른 브랜드의 정기 행사와 작은 혜택 공지는 큰 기간 한정 혜택 뒤로 보낸다. 기존 쿠폰 목록에는 영향을 주지 않는다.
