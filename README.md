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
| `web/` | 비교 화면, 지표 대시보드, PWA 파일 |

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
- **사진**: 쿠폰을 읽은 **바로 그 공식 페이지**의 이미지일 때만 (메뉴 이름·근거 문구 옆 이미지, 또는 행사 1개짜리 상세 페이지의 공유용 대표 이미지). 주소만 저장하고 파일은 받지도 저장하지도 않는다. 맞는 사진이 없으면 사진 없이(할인 크기 표시). 예시·무료 사진으로 채우지 않는다. 로고·아이콘·띠 배너·http 이미지는 제외
- **robots 거부**: 출처 첫 페이지가 robots.txt(일반·AI 수집 거부)로 막히면 그 출처의 쿠폰·소식을 내린다 (주석에 `⊘`, sources 탭에서 `active=FALSE` 권장)
- 반영: push → Apps Script에 새 `Code.gs` → 배포 관리 → 새 버전. 첫 요청에서 `news` 탭·coupons `image_url` 열·새 출처(`tworld-benefit`) 자동 추가
- 숨기기: 소식이 틀리면 news 탭 해당 행 `status`를 `hidden` (자동 수집이 되살리지 않음)

## 운영

- **브랜드 추가**: sources 탭에 행 추가 (id·brand·category·url, 필요하면 follow)
- **오류 제보**: reports 탭 확인 → 맞으면 coupons 탭 해당 행의 `status`를 `hidden` (자동 수집이 되살리지 않음)
- **지표**: `admin.html` → ADMIN_TOKEN 입력. "보고서용 요약 복사"는 실측값만 복사 (예시 모드에서는 막힘)
- **비용**: 실행마다 토큰 수가 run_log에 남는다. 단가는 Anthropic 가격표 기준으로 계산
- **주의**: 공개 저장소에 60일간 커밋이 없으면 GitHub가 예약 실행을 멈춘다. 예약 실행은 수 분~수십 분 늦을 수 있다
- **결제**: 창업활동자금 카드는 국내 원화 결제만 승인 → API 결제 경로는 별도 확인 (팀 내부 인수인계 문서 참고)

## 지키는 원칙

- 공개 공식 페이지만, robots.txt(일반 + AI 수집 거부) 준수, 하루 1회 + 버튼(10분 쿨다운), 페이지 간 1.5초 간격
- 앱 내부 API·로그인 영역·자동 조작은 하지 않는다. 브랜드 로고·이미지는 쓰지 않는다 (텍스트 표기)
- AI는 읽기만. 숫자가 페이지에 실제로 있는지 엔진이 대조하고, 애매하면 게시하지 않는다(보류)
- 이용 기록은 브라우저별 무작위 id만 (개인정보 없음)
