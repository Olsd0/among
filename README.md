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
Apps Script 웹앱 → 구글시트 (coupons · sources · run_log · events · reports)
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
| `collector/sources.example.json` | 햄버거 4사 출처 초기값 |
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
| Settings → Secrets → Actions | `ANTHROPIC_API_KEY` | Claude API 키 |
| | `APPS_SCRIPT_URL` | 1-4의 웹앱 URL |
| | `COLLECTOR_TOKEN` | 스크립트 속성의 같은 값 |
| Settings → Variables → Actions | `APPS_SCRIPT_URL` | 같은 URL (화면 배포용, 공개돼도 되는 값) |
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
