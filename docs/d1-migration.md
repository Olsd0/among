# AMONG 운영 DB 이전 설계안 (Google 시트 → Cloudflare D1)

작성 2026-11-17 · 상태: **대표 승인 대기** (승인 전에는 2단계 코드를 배포하지 않는다)

## 1. 결정된 것

- 플랫폼: Cloudflare Pages Functions + D1 (대표 결정 11/17). 새 서비스 가입 없음, 무료 요금제로 시작.
- 방식: 단계별 전환. 쓰기(수집기·관리자)는 **같은 날 한 번에** D1 기준으로 넘긴다. 시트와 D1을 따로 수정하는 기간을 두지 않는다.
- 전환 뒤 시트: 사람이 읽는 검수용 내보내기. 운영 기준은 D1.
- 다음 기능: 찜·관심 브랜드, 새 쿠폰 알림 (이번 이전 범위 밖. 테이블만 대비).

## 2. 지금 상태 (실측)

| 항목 | 값 (11/17 09:40, 대표 PC에서 3회씩) |
|---|---|
| 쿠폰·공지 조회 (Apps Script) | 1.9 ~ 3.4초 · 84KB · 쿠폰 91건, 공지 29건 |
| 온라인 특가 조회 (Apps Script) | 1.6 ~ 3.5초 · 29KB · 상품 46건 |
| 앱 쿠폰·영양성분 조회 | 1.7 ~ 2.8초 (현재 0건) |
| 새 API 왕복 (D1 미연결 응답) | 0.08초 |

데이터 양은 작다(수백 행). 이전의 이유는 용량이 아니라 **응답 속도, 수정 이력, 찜·알림의 바탕**이다.

1단계는 배포됨(11/17): `/api/public`이 시트 쪽 공개 응답을 받아 D1에 저장해 내려 준다. D1 바인딩(`DB`)이 연결되면 켜진다. 연결 전·실패 시 화면은 Apps Script를 쓴다.

## 3. 지금 규칙 중 그대로 가져갈 것

시트 쪽 백엔드에 이미 있는 규칙이다. D1에서도 같은 동작을 시험으로 고정한다.

- 같은 행사는 같은 id (`couponId`·`newsId` + `stabilizeIds`) → 재수집해도 중복이 쌓이지 않는다.
- **수집 실패와 행사 종료 구분**: 정상 수집한 출처(`sources_ok`)에서 안 보일 때만 `gone`. 실패한 출처의 기존 행사는 그대로 둔다.
- 종료일이 지나면 `expired`. 숨긴(`hidden`) 항목은 재수집해도 되살리지 않는다.
- 공개 응답에는 공개 열만(`PUBLIC_FIELDS`·`NEWS_PUBLIC`). 근거·신뢰도·내부 메모는 싣지 않는다.
- 이미지 파일은 저장하지 않고 주소와 출처만 저장한다.

## 4. 새로 넣을 것

1. **수집 값과 관리자 값 분리**: 수집기는 `collected_*`만 쓴다. 관리자가 고친 값은 `overrides` 표에 열 단위로 저장하고 화면에는 관리자 값이 우선한다. 수집기가 빈 값을 가져와도 관리자가 넣은 이미지·설명은 남는다.
2. **수정 이력**: 관리자 수정·숨김·되살림을 `audit_log`에 남긴다(누가·언제·이전 값·새 값). 되돌리기 가능.
3. **마지막 수집 시각과 마지막 정상 확인 시각 구분**: `checked_at`(시도) · `confirmed_at`(원문에서 실제로 본 시각).
4. **브랜드 표**: 지금은 글자(이름)로만 연결돼 있다. `brands`를 두고 쿠폰·공지·관심 브랜드가 같은 id를 본다. 여러 브랜드가 참여하는 결제·포인트 행사는 `news_brands`로 잇는다.

## 5. 테이블

모든 쿼리는 준비된 문장 + 바인딩만 쓴다. 시각은 ISO(UTC), 날짜는 `YYYY-MM-DD`(KST 기준).

| 표 | 주요 열 | 바탕이 되는 시트 탭 |
|---|---|---|
| `brands` | id, name, category, official_url, logo_key | (신규 · engine의 브랜드 목록) |
| `sources` | id, active, brand_id, url, selector…, program, last_ok_at, last_error | sources |
| `coupons` | id, status, brand_id, menu, item_type, 가격·혜택 열, discount_type, audience, channels, programs, start_date, end_date, conditions, source_id, source_url, official_link, image_url, hash, first_seen_at, checked_at, confirmed_at, updated_at, last_run_id | coupons |
| `news` | id, status, brand_id, title, summary, discount_label, 기간, programs, image_url, related_ids, source 열, period_source, period_refs, period_checked_at, hash, 시각 열 | news |
| `news_brands` | news_id, brand_id | (신규) |
| `overrides` | kind(coupon/news), item_id, field, value, note, updated_at | (신규 · 지금은 시트를 직접 고침) |
| `audit_log` | id, at, actor, kind, item_id, action, before, after | (신규) |
| `runs` | run_id, trigger, state, 시작·종료, 출처 성공·실패, 건수, 토큰, errors | run_log |
| `app_coupons` | 현재 열 그대로 + revision | app_coupons |
| `online_picks` · `online_price_log` · `online_watch_log` · `online_items` · `online_runs` · `online_leads` | 현재 열 그대로 | 같은 이름 탭 |
| `nutrition` | 현재 열 그대로 | nutrition |
| `events` · `reports` | 현재 열 그대로 (개인정보 없음, 보관 기간 유지) | events · reports |
| `kv` | key, value | 스크립트 속성 중 상태값(수집 상태·쿨다운). **토큰은 넣지 않는다** |

혜택 종류와 조건은 지금도 `discount_type`(price·percent·amount·bogo·free_item·point_back…) · `audience` · `min_order` · `max_discount` · `programs` · `conditions`로 나뉘어 있어 그대로 옮긴다.

찜·알림 대비(이번에는 표만 설계, 구현은 다음 범위): `devices`(무작위 기기 id) · `favorite_brands` · `saved_items` · `push_subscriptions`. 로그인 없이 기기 단위로 시작한다. 여러 기기에서 같은 목록을 쓰려면 로그인이 필요하다(그때 Supabase 인증 또는 직접 구현을 다시 정한다).

인덱스: `coupons(status, end_date)`, `coupons(brand_id, status)`, `news(status, end_date)`, `news(brand_id, status)`, `coupons(first_seen_at)`(새 쿠폰 알림), 로그 표의 날짜.

## 6. API

같은 사이트 주소(`/api/...`)에서 제공한다. 화면이 기대하는 응답 모양은 지금과 같게 유지한다.

| 구분 | 경로 | 인증 |
|---|---|---|
| 조회 | `GET /api/public?action=coupons\|app_coupons\|nutrition\|online_deals\|status` | 없음 |
| 방문자 쓰기 | `POST /api/public` (refresh·event·report) | 없음 + 횟수 제한(지금 규칙 그대로) |
| 수집기 | `POST /api/collector` (run_start·sources·ingest·run_finish·news_periods·online_*) | `COLLECTOR_TOKEN` |
| 관리자 | `POST /api/admin` (앱 쿠폰·온라인 특가 관리·지표·수정·숨김) | `ADMIN_TOKEN` |

- 토큰은 Cloudflare Pages의 **암호화된 환경변수(Secrets)** 와 GitHub Secrets에만 둔다. 대표가 직접 입력한다. 코드·로그·브라우저 저장소에 넣지 않는다.
- 조회는 저장된 응답 한 칸만 읽는다(요청당 1행) → 무료 읽기 한도(하루 500만 행)에 여유. 쓰기는 바뀐 행만(하루 10만 행 한도).
- '바로 확인'(GitHub Actions 실행 요청)은 GitHub 토큰이 필요하다. 지금 Apps Script에 있는 것과 같은 권한의 토큰을 대표가 Cloudflare Secrets에 직접 등록한다.

## 7. 전환 절차

1. **(완료)** 조회 사본 API 배포. → 대표: D1 만들고 `DB` 바인딩.
2. 연결 확인: 시트 응답과 D1 응답이 글자까지 같은지, 응답 시간 실측.
3. 새 표 생성 + 시트 전체를 D1로 가져오기(가져오기는 여러 번 해도 같은 결과). 건수·노출 목록·종료 행사·브랜드별 목록·이미지·링크를 시트 응답과 비교하는 검사 스크립트를 통과해야 다음으로 간다.
4. 수집기·관리자용 API를 D1에 구현하고, 기존 Apps Script 시험(수집 반영·gone·expired·hidden·온라인 특가 규칙)을 같은 입력·같은 기대값으로 D1에서 통과시킨다.
5. **전환일(하루)**: 시트 원본 사본 보관 → 마지막 가져오기 → 수집기 주소·관리자 화면 주소를 D1로 → 수집 한 번 실행 → 화면 확인. 문제면 주소만 되돌린다(Apps Script와 시트는 그대로 남겨 둔다).
6. 전환 뒤 2주: Apps Script는 읽기 전용으로 유지. D1 → 시트 내보내기를 하루 한 번(검수용).
7. Apps Script 쓰기 경로 끄기.

## 8. 완료 기준

- 다음 날 00시 자동 수집이 D1에 반영되고 화면에 보인다.
- 관리자가 고친 이미지·설명이 재수집 뒤에도 남는다.
- 종료일이 지난 행사가 내려가고, 수집에 실패한 출처의 행사는 남는다.
- 같은 수집을 두 번 돌려도 건수가 늘지 않는다.
- D1 시점 복구(무료 7일)로 실제로 한 번 되돌려 본다.
- 하루 읽기·쓰기 사용량이 무료 한도의 20% 아래다(넘으면 보고).

## 9. 대표가 하실 일

| 언제 | 할 일 |
|---|---|
| 지금 | D1 데이터베이스 `among` 만들기 → Pages 프로젝트 `among`에 변수 이름 `DB`로 바인딩 → 재배포 |
| 4단계 전 | Cloudflare Pages Secrets에 `COLLECTOR_TOKEN`·`ADMIN_TOKEN`(새 값) 직접 입력, GitHub Secrets에 새 주소와 같은 수집기 토큰 입력 |
| 전환일 | 관리자 화면에서 새 관리 토큰으로 로그인 확인 |

## 10. 비용

무료 요금제 기준(11/17): Functions 요청 하루 10만, D1 읽기 하루 500만 행, 쓰기 하루 10만 행, DB 하나 500MB. 한도를 넘으면 그날 쿼리가 실패하므로(화면은 저장된 목록을 계속 보여 줌) 사용량이 20%를 넘는 날이 생기면 유료(월 US$5~) 전환 여부를 대표에게 묻는다. 임의로 유료 전환하지 않는다.
