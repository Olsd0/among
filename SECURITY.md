# 보안 정책

AMONG(어몽)의 보안 문제를 발견하셨다면 **공개 이슈가 아니라** 아래 방법으로 알려 주세요.

- **GitHub 비공개 취약점 신고**: [Security → Report a vulnerability](https://github.com/Olsd0/among/security/advisories/new)
- 받은 뒤 3일 안에 답하고, 확인되면 고친 뒤 신고자와 함께 공개 여부를 정합니다.

## 범위

| 대상 | 위치 |
|---|---|
| 공개 사이트 | https://olsd0.github.io/among/ (`web/`) |
| 데이터 API (Google Apps Script 웹앱) | `apps-script/Code.gs` |
| 수집기·워크플로 | `collector/`, `.github/workflows/` |

브랜드 공식 사이트·통신사·결제 서비스 자체의 문제는 각 회사에 알려 주세요. 다른 이용자의 데이터에 접근하거나 서비스를 방해하는 시험(대량 요청 등)은 하지 말아 주세요.

## 설계 원칙 (요약)

- 비밀값(API 키·토큰)은 GitHub Secrets와 Apps Script 스크립트 속성에만 있고, 코드·화면·요청 주소·로그에 두지 않습니다.
- 공개 API로는 혜택 데이터를 바꿀 수 없습니다. 바꾸는 요청은 모두 토큰이 필요합니다. 이용 기록·제보의 크기·빈도 제한과 시트 수식 보호는 최신 Apps Script 코드를 별도로 배포해야 실제로 적용됩니다. 빈도 제한은 CacheService 기반의 보조 보호책이며 캐시 축출과 임의 브라우저 ID 변경을 막지 못합니다.
- 화면은 콘텐츠 보안 정책(CSP)으로 이 사이트의 스크립트만 실행하고, 외부 데이터는 모두 글자로만 넣습니다(https 링크·사진 주소만 허용).
- 워크플로의 `GITHUB_TOKEN`은 읽기 권한만, 외부 액션은 커밋 해시로 고정, 의존성은 잠금 파일(`package-lock.json`)의 무결성 해시로 설치합니다.
