# Stage 2 사용 안내 — 두 Claude 세션에 나누어 전달

이번 묶음은 Search UI를 만드는 지시서가 아니다. 1단계에서 분리한 Search 프런트엔드가 사용할 인증·읽기 전용 서버 연결을 구현하는 지시서다.

## 파일 구성

| 파일 | 용도 |
|---|---|
| `00_SHARED_INTEGRATION_CONTRACT.md` | 양쪽이 동일하게 구현할 PSI-1.0 제안 계약 |
| `01_PR_SEARCH_API_AUTH_CLAUDE_PROMPT.md` | pr-search 수신부·매핑·grant·제한된 조회 구현 |
| `02_PIPE_AUTH_BFF_CLAUDE_PROMPT.md` | PIPE 인증 요청·grant cache·BFF·오류 연결 구현 |
| `03_SECURITY_AND_CONTRACT_ACCEPTANCE.md` | 공통 수용 테스트와 실제 검증 기록 형식 |
| `04_START_HERE_AND_HANDOFF.md` | 전달 순서와 시작 문구 |
| `05_SOURCE_EVIDENCE.md` | 현재 확인한 코드·사용자 자료·외부 보안 기준의 구분 |
| `examples/illustrative-wire-examples.json` | 유효한 JSON 형태의 합성 예시. 서명된 실제 credential이 아님 |
| `manifest.json` | 이 묶음의 파일 checksum. 구현 완료를 의미하지 않음 |

## 1. pr-search Claude에 전달

첨부할 파일: 00, 01, 03, 05. 전체 ZIP를 첨부해도 된다.

다음 문구를 붙여 넣는다.

```text
이번 작업은 PIPE Search 연동의 2단계 서버 작업이다.

01_PR_SEARCH_API_AUTH_CLAUDE_PROMPT.md를 작업 지시서로,
00_SHARED_INTEGRATION_CONTRACT.md를 양쪽 공통 계약으로 사용하라.
03_SECURITY_AND_CONTRACT_ACCEPTANCE.md의 수용 테스트를 함께 적용하라.

pr-search 현재 코드를 확인해 exact 데이터 API 계약을 동결한 뒤,
PIPE 전용 private 인증 수신·identity binding·검색 전용 opaque grant와
기존 조회 서비스의 안전한 연결을 구현하라.

일반 Search 화면/기존 로그인 쿠키/기존 API의 인증 경계는 유지한다.
PIPE JWT나 임의 사용자 헤더를 일반 API에서 받아들이지 않는다.
raw prs_session을 PIPE에 발급하는 방식으로 만들지 않는다.

PIPE 담당 Claude는 pr-search를 볼 수 없으므로 실제 OpenAPI,
operation map, 오류·응답 예시, version/checksum, 검증 결과와
배포 입력을 PIPE_INTEGRATION_HANDOFF.md와 함께 제공하라.

실제 회사 키·인증서·직원 매핑이 없어도 합성 fixture로 개발하되
운영 연결 완료라고 하지 않는다. commit/push/PR/배포는 하지 않는다.
```

이 세션이 먼저 데이터 API 계약을 실제 코드로 확정한다. 작성된 계약/인수인계 없이 다음 세션이 path나 DTO를 추정하게 하지 않는다.

## 2. PIPE Claude에 전달

첨부할 파일: 00, 02, 03과 pr-search 세션의 실제 최종 handoff 전체.

가능하면 1단계 `API_AND_ADAPTER_CONTRACT.md`와 실제 구현된 Search 모듈도 함께 참조하게 한다. 1단계 결과가 없다면 화면을 새로 만들게 하지 않는다.

```text
이번 작업은 PIPE Search 연동의 2단계 서버 작업이다.

02_PIPE_AUTH_BFF_CLAUDE_PROMPT.md를 작업 지시서로 사용하라.
공통 PSI-1.0 계약과 첨부한 pr-search 실제 구현 handoff/OpenAPI/
operation map/manifest를 확인하고 서로 일치하는지 먼저 검증하라.

PIPE의 기존 JWT 인증과 request.user를 재사용하고, 서버에서만
별도 사용자 assertion을 서명해 pr-search의 검색 grant를 발급받아라.
브라우저에는 PIPE JWT만 남기고 Integration 자격은 노출하지 않는다.

검색 BFF, 사용자·로그인 문맥별 grant cache, mTLS client,
만료/회수/로그아웃/동시 요청/오류 mapping을 구현하라.
Stage 1 Search adapter가 있으면 연결만 하고 UI/App Shell을 다시
디자인하지 않는다. 검색 DB나 repository 권한 엔진도 만들지 않는다.

upstream 인증 오류가 PIPE 전체 /login redirect를 실행하지 않도록
검증하라. 회수된 grant를 만료로 취급해 자동 재발급하지 마라.

local contract 테스트, 실제 mTLS, 실제 GHE 권한 검증의 결과를
구분해서 보고하라. commit/push/PR/운영 배포는 하지 않는다.
```

## 3. 병행 가능한 부분과 기다려야 하는 부분

PIPE는 실제 패키지/JWT/logout 조사, server-only signer, per-context cache, typed BFF skeleton과 공통 contract mock 테스트를 먼저 할 수 있다. pr-search의 최종 OpenAPI/operation map이 필요한 부분은 route query와 DTO parity의 실 연결이다.

두 세션이 서로 다른 인증 프로토콜로 구현하지 않도록 첫 서버 계약 동결본의 version/checksum을 넘긴다. 코드 구현 순서는 기능 단위로 나눌 수 있지만 서명 claim·grant field·오류 code·자동 재발급 범위는 공동 계약이다.

## 4. 실제 환경에 필요한 사람의 입력

운영 준비 항목이며 지금 임의 값을 만들어 등록하지 않는다.

| 입력 | 반드시 확인할 점 |
|---|---|
| PIPE 사용자의 불변 ID와 JWT 만료/로그인 문맥 | 실제 검증기에서 추출 가능한지 |
| corporate subject ↔ pr-search canonical user | 공식 directory 또는 관리자 검증 근거 |
| 실제 GHE user ID/host | 문자열 치환이 아닌 계정 일치 증거 |
| 내부 Integration host와 TLS 종료 지점 | 브라우저/public proxy가 접근하지 못하는지 |
| 서비스 mTLS 인증서/CA와 서명키 | 환경 분리, private key 보관, 키 회수 절차 |
| 통합 허용 저장소 | 서버에서 기존 사용자 권한과 교집합 적용 |
| 기능 flag와 사내 검증 계정 | 실제 운영 사용자 전체 활성화 금지 |

## 5. 이 작업에서 이전 제안을 구체화한 부분

이전 설명의 BFF + Integration Gateway 책임 분리는 유지한다. 다만 원본 cookie session을 PIPE에 넘기면 그 credential이 더 넓은 원본 API에서 쓰일 여지가 있으므로, 이번 지시서는 일반 세션과 호환되지 않는 검색 전용 opaque grant를 기본으로 한다.

또한 user_id 하나의 캐시가 아니라 user + login context + client + environment + certificate로 분리한다. 만료와 회수를 구분하고, logout 때 cache만 삭제했다가 같은 JWT로 즉시 재연결되는 경우를 막는다. GET 전부 허용 대신 Search가 쓰는 operation만 허용한다.

이는 현재 저장소에 이미 구현돼 있다는 설명이 아니라 이번에 추가할 설계 선택이다. 승인된 사내 OAuth/IdP 위임 기반을 재사용하는 대안이 실제로 존재하면 ADR로 비교할 수 있지만, 단일 시스템만 조용히 다른 protocol을 구현하지 않는다.

## 6. 완료 보고의 네 단계

```text
1. 코드·마이그레이션·계약 구현
2. mock/로컬 DB·Redis contract 및 보안 테스트
3. 실제 TLS 종료 경로와 mTLS 서버 간 검증
4. 실제 사용자/GHE 권한/회수/기존 화면 end-to-end 검증
```

1 또는 2가 완료됐다고 3과 4도 완료됐다고 쓰지 않는다. 이번 지시서 묶음 자체는 위 실행 테스트를 수행한 결과물이 아니다.
