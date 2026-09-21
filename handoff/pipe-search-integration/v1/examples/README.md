# examples — PIPE 연동 wire 예시

> 분류: 인수인계 자료. **합성 fixture 데이터**(`acme/payments`, `alice-psi` 등)이며 회사 PR 본문·소스·계정이 아닙니다. 토큰·grant ID·상관 ID·시각은 고정된 가짜 값으로 바꿨습니다(`psig1_EXAMPLE-only-…`는 실제 grant가 아닙니다).

## 파일 형식

파일 이름은 `<operation>.<HTTP 상태>[.<사례>].json`입니다.

```json
{
  "operation": "read.search",
  "title": "사람이 읽는 사례 이름",
  "captured": true,
  "note": "합성 예시의 근거 (captured가 false일 때)",
  "request": { "method": "GET", "path": "/internal/integrations/pipe/v1/…", "headers": {}, "body": {} },
  "response": { "status": 200, "headers": {}, "body": {} }
}
```

- `operation`은 `operation-map.json`의 `id`입니다.
- `captured: true`는 pr-search 통합 하네스(127.0.0.1의 실제 mTLS·PostgreSQL·Redis·Elasticsearch)에서 받은 실제 응답을 값만 가린 것입니다. 통합 시험 `apps/search-api/integration/integrations/pipe/openapi.test.ts`가 같은 요청을 다시 보내 **상태·봉투 모양(키 구성)·오류 코드**가 이 파일과 같은지 대조합니다.
- `captured: false`는 실제 응답을 바탕으로 만든 합성 예시입니다(하네스에서 재현하기 어려운 부분 결과). 스키마 적합성만 시험합니다.
- 모든 예시의 `response.body`는 `pipe-integration-v1.openapi.yaml`의 해당 operation·상태 응답 스키마에 맞는지 계약 시험 `apps/search-api/src/integrations/pipe/contract.test.ts`가 검증합니다.

## 사례 목록

| 사례 | 파일 |
|---|---|
| 정상 발급·문맥·회수 | `auth.exchange.200`, `context.200`, `auth.revoke.200`, `auth.revoke_context.200` |
| 조회 10종의 정상 응답 | `read.*.200` (source 성공 본문에는 `correlation_id` 키가 없다) |
| 미매핑 | `auth.exchange.403.identity-binding-required` |
| 권한 없음(범위 밖 단건) | `read.pull_request.404.not-found` — 없는 것과 같은 404, 원본 봉투 |
| 접근 범위 장애 | `read.repositories.503.permission-unavailable`(연동 봉투, `retryable: true`)와 `read.search.503.permission-unavailable`(원본 봉투, `retryable` 없음) — **같은 코드가 두 모양으로 온다** |
| grant 만료 | `read.search.401.grant-expired` — `retryable: true`, 새 assertion으로 한 번 재발급 |
| 회수 | `read.search.401.grant-revoked`, `read.search.403.context-revoked` — 자동 재발급 금지 |
| 연동 계층 입력 거절 | `read.search.400.invalid-request` (중복 query key) |
| 채번 전 M 번호 | `read.merge_numbers.resolve.409.no-sequence` — 원본 봉투 |
| source 부분 결과 | `read.source.tree.200.truncated`, `read.source.history.200.pull-requests-unavailable` (합성) |

## 읽는 법

- 오류 본문에 `retryable` 키가 있으면 연동 고유 실패이고, 없으면 원본 조회의 실패입니다. 코드는 `error.code`로 판정합니다.
- 연동 고유 실패의 `message`는 코드별 고정 문구(영어)이고, 원본 조회의 `message`는 원본 문구(대부분 한국어, source와 질의 파서는 영어)입니다. 화면 문구로 그대로 쓰지 않습니다.
