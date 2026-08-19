# PR Search API 계약

> 상태: review | 버전: v0.2 | 갱신일: 2026-08-19

## 1. 목적

프론트엔드와 백엔드, 외부 연동, 이벤트 간 계약을 정의한다. 안정된 API는 요청/응답 JSON 예시를 포함하며, 구현 에이전트는 이 예시를 그대로 fixture와 테스트에 사용한다.

## 2. 공통 원칙

1. 조회 API와 write API를 분리한다.
2. write API는 멱등 키를 가진다.
3. 모든 오류는 기계 판독 가능한 `code`와 사용자 조치 힌트를 가진다.
4. 권한·정책으로 거부된 액션은 숨기지 않고 사유를 제공한다. 단, 접근 범위 밖 리소스는 404로 존재 여부를 감춘다 (ADR-008).
5. 경로·필드 네이밍은 `../10_requirements/glossary.md`를 따른다. 축약 금지(`sha` 아닌 `commit_sha`).
6. 모든 응답에 `correlation_id`를 포함한다.
7. 페이지네이션은 커서 전용이다. 오프셋 파라미터를 제공하지 않는다 (ADR-010).
8. 시각은 ISO-8601 UTC 문자열이다. 표시 시간대 변환은 클라이언트 책임이며, 집계 버킷만 예외로 요청 시간대를 받는다.

기본 경로: `/api/v1`

## 3. API 카탈로그

| API ID | Method | Path | 목적 | Authz | 관련 요구사항 |
| --- | --- | --- | --- | --- | --- |
| API-SRCH-001 | GET | `/resolve` | 입력 문자열의 식별자 해석 | 인증 + 접근 범위 | FR-SRCH-001, FR-SRCH-002, FR-SRCH-004 |
| API-SRCH-002 | GET | `/commits/{repository}/{commit_sha}` | 커밋 상세와 소속 PR | 인증 + 접근 범위 | FR-SRCH-002, FR-REL-002 |
| API-SRCH-003 | GET | `/pull-requests/{repository}/{pr_number}` | PR 상세와 커밋 집합 | 인증 + 접근 범위 | FR-SRCH-003, FR-REL-002 |
| API-SRCH-004 | GET | `/search` | 구조화 질의 목록 조회 + 패싯 | 인증 + 접근 범위 | FR-SRCH-005~009, FR-SRCH-011 |
| API-SRCH-005 | GET/POST/PATCH/DELETE | `/saved-searches[/{id}]` | 저장된 검색 관리 | 인증 | FR-SRCH-010 |
| API-SRCH-006 | POST | `/exports` | 검색 결과 내보내기 | 인증 + 접근 범위 | FR-SRCH-012 |
| API-SEQ-001 | GET | `/sequence-ranges` | 시퀀스 범위 조회 | 인증 + 접근 범위 | FR-SEQ-002 |
| API-SEQ-002 | POST | `/sequence-anchors/resolve` | 앵커 → 시퀀스 정규화 | 인증 + 접근 범위 | FR-SEQ-003 |
| API-SEQ-003 | GET | `/release-comparisons` | 두 릴리스 구간 비교 | 인증 + 접근 범위 | FR-SEQ-004 |
| API-SEQ-004 | GET/PUT | `/safe-markers` | 안전 구간 표식 조회·등록 | 인증 / `release_manager` | FR-SEQ-006 |
| API-SEQ-005 | GET/POST/DELETE | `/bisect-sessions` | 이분 탐색 상태 | 인증 | FR-SEQ-007 |
| API-REL-001 | GET | `/sequence-neighbors` | 선행·후행 조회 | 인증 + 접근 범위 | FR-REL-001 |
| API-REL-002 | GET | `/containments` | 포함 릴리스·소속 PR | 인증 + 접근 범위 | FR-REL-002 |
| API-REL-003 | GET | `/co-changes` | 동시 변경 상관 | 인증 + 접근 범위 | FR-REL-007 |
| API-REL-004 | GET | `/relation-graphs` | 관계 그래프 탐색 | 인증 + 접근 범위 | FR-REL-008 |
| API-STAT-001 | POST | `/analytics/groups` | 그룹 집계 | 인증 + 접근 범위 | FR-STAT-001, FR-STAT-006 |
| API-STAT-002 | POST | `/analytics/time-series` | 시계열 집계 | 인증 + 접근 범위 | FR-STAT-002 |
| API-STAT-003 | POST | `/analytics/percentiles` | 리드타임·리뷰 대기 백분위 | 인증 + 접근 범위 | FR-STAT-003, FR-STAT-004 |
| API-STAT-004 | POST | `/analytics/distributions` | 변경 규모 분포 | 인증 + 접근 범위 | FR-STAT-005 |
| API-AUTH-001 | GET | `/me` | 현재 사용자, 역할, 접근 범위 요약 | 인증 | FR-AUTH-001, FR-AUTH-002 |
| API-ING-001 | POST | `/webhooks/github` | GHE 웹훅 수신 | HMAC 서명 | FR-ING-001, FR-ING-002 |
| API-ADM-001 | GET/POST/PATCH/DELETE | `/admin/repositories[/{id}]` | 저장소 등록 관리 | `operator` | FR-ING-009 |
| API-ADM-002 | GET/POST/PATCH | `/admin/jobs[/{id}]` | 잡 실행·중단·진행률 | `operator` | FR-ADMIN-002, FR-ING-006, FR-ING-008 |
| API-ADM-003 | GET/POST | `/admin/dead-letters[/reprocess]` | 실패 대기열 조회·재처리 | `operator` | FR-ING-007 |
| API-ADM-004 | POST | `/admin/reindex` | 재색인 실행 | `operator` | FR-ING-008 |
| API-ADM-005 | GET | `/admin/audit-records` | 감사 기록 조회 | `security_officer` | FR-AUTH-004 |
| API-ADM-006 | GET | `/admin/pipeline-status` | 파이프라인 지표 | `operator` | FR-ADMIN-001 |
| API-ADM-007 | GET/POST | `/admin/sequence-integrity` | 정합성 점검·재채번 | `operator` | FR-ADMIN-003, FR-SEQ-005 |

## 4. API 상세 규격

### API-SRCH-001 식별자 해석

- 목적: 입력 문자열 하나를 커밋·PR·릴리스·자유 텍스트 중 하나로 판별한다. 이 제품의 1순위 진입점이다.
- 관련 요구사항: FR-SRCH-001, FR-SRCH-002, FR-SRCH-004
- 요청: `GET /api/v1/resolve?q=a3f9c21&repository=acme/payments`
  - `q` (required): 해석할 문자열
  - `repository` (optional): 저장소 힌트. 있으면 후보를 좁힌다
  - `limit` (optional, 기본 10, 최대 50)

응답 200 (단일 후보):

```json
{
  "input": "a3f9c21",
  "detected_kind": "commit",
  "candidates": [
    {
      "kind": "commit",
      "repository": "acme/payments",
      "repository_id": 4021,
      "commit_sha": "a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5",
      "short_sha": "a3f9c21b4e8d",
      "display_name": "feat: 결제 재시도 로직 (#1234)",
      "role": "merge_commit",
      "merge_seq": 1342,
      "seq_epoch": 3,
      "sequence_space": "acme/payments@main",
      "pull_request_numbers": [1234],
      "committed_at": "2026-08-19T05:02:11Z",
      "url": "/commit/acme/payments/a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5"
    }
  ],
  "truncated": false,
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

응답 200 (후보 없음):

```json
{
  "input": "zzzzzzz",
  "detected_kind": "text",
  "candidates": [],
  "truncated": false,
  "reason_code": "not_found",
  "hint": "이 문자열과 일치하는 커밋·PR·릴리스가 없습니다. 저장소가 수집 대상인지 확인하세요.",
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

- 오류: `SHA_PREFIX_TOO_SHORT` (400), `SEARCH_TIMEOUT` (504), `PERMISSION_UNAVAILABLE` (503)
- Authz: 인증 필요. 접근 범위 밖 후보는 결과에서 제외한다 (FR-SRCH-001 AC-6)
- 페이지네이션: 없음. `limit`으로 상한만 둔다

### API-SRCH-002 커밋 상세

- 목적: 커밋 SHA로 소속 PR과 시퀀스 위치를 조회한다 (SHA → PR 역추적).
- 관련 요구사항: FR-SRCH-002, FR-REL-002
- 요청: `GET /api/v1/commits/acme%2Fpayments/a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5`

응답 200:

```json
{
  "repository": "acme/payments",
  "repository_id": 4021,
  "commit_sha": "a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5",
  "parent_shas": ["b81f3e0a9c2d4e5f60718293a4b5c6d7e8f90a1b"],
  "message": "feat: 결제 재시도 로직 (#1234)\n\nRefs: PAY-880",
  "author": "kim",
  "committer": "kim",
  "authored_at": "2026-08-19T04:51:02Z",
  "committed_at": "2026-08-19T05:02:11Z",
  "role": "merge_commit",
  "base_branch": "main",
  "merge_seq": 1342,
  "seq_epoch": 3,
  "sequence_space": "acme/payments@main",
  "pull_requests": [
    {
      "pr_number": 1234,
      "title": "feat: 결제 재시도 로직",
      "author": "kim",
      "reviewers": ["lee", "park"],
      "approved_by": ["lee"],
      "state": "merged",
      "merged_at": "2026-08-19T05:02:11Z",
      "url": "/pr/acme/payments/1234"
    }
  ],
  "changed_paths": [
    { "path": "src/payment/retry.ts", "additions": 80, "deletions": 12 },
    { "path": "src/payment/index.ts", "additions": 40, "deletions": 3 }
  ],
  "changed_files_count": 2,
  "additions": 120,
  "deletions": 15,
  "link_summary": { "has_revert": false, "is_reverted": true, "has_cherry_pick": true },
  "release_tags": ["build-20260819-02", "build-20260820-01"],
  "patch_id": "7f3c1a2b9d8e0f4a5b6c7d8e9f0a1b2c3d4e5f60",
  "patch_id_unavailable": false,
  "enrichment_pending": false,
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

응답 200 (직접 푸시 커밋):

```json
{
  "repository": "acme/payments",
  "commit_sha": "c72d1e0f3a4b5c6d7e8f90a1b2c3d4e5f6071829",
  "role": "direct_push",
  "merge_seq": 1339,
  "seq_epoch": 3,
  "sequence_space": "acme/payments@main",
  "pull_requests": [],
  "reason_code": "no_pull_request",
  "hint": "이 커밋은 PR을 거치지 않고 대상 브랜치에 직접 반영되었습니다.",
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

- 오류: `NOT_FOUND` (404, 접근 범위 밖 포함), `PERMISSION_UNAVAILABLE` (503)
- Authz: 접근 범위 강제 필터

### API-SRCH-003 PR 상세

- 목적: PR의 머지 커밋과 원본 커밋 집합, 시퀀스 위치를 조회한다.
- 관련 요구사항: FR-SRCH-003, FR-REL-002

요청: `GET /api/v1/pull-requests/acme%2Fpayments/1234`

응답 200:

```json
{
  "repository": "acme/payments",
  "repository_id": 4021,
  "pr_number": 1234,
  "title": "feat: 결제 재시도 로직",
  "body": "결제 실패 시 지수 백오프로 3회 재시도합니다.\n\nRefs: PAY-880",
  "state": "merged",
  "draft": false,
  "author": "kim",
  "reviewers": ["lee", "park"],
  "approved_by": ["lee"],
  "labels": ["payment", "backend"],
  "base_branch": "main",
  "head_branch": "feature/payment-retry",
  "merge_commit_sha": "a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5",
  "source_commits": [
    {
      "commit_sha": "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
      "subject": "wip: 재시도 스켈레톤",
      "author": "kim",
      "authored_at": "2026-08-18T02:10:00Z"
    },
    {
      "commit_sha": "2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e",
      "subject": "test: 재시도 케이스 추가",
      "author": "kim",
      "authored_at": "2026-08-18T07:41:00Z"
    }
  ],
  "source_commits_total": 2,
  "source_commits_truncated": false,
  "merge_seq": 1342,
  "seq_epoch": 3,
  "sequence_space": "acme/payments@main",
  "created_at": "2026-08-18T02:00:00Z",
  "first_review_at": "2026-08-18T09:15:00Z",
  "merged_at": "2026-08-19T05:02:11Z",
  "lead_time_seconds": 97331,
  "first_review_wait_seconds": 26100,
  "changed_files_count": 2,
  "additions": 120,
  "deletions": 15,
  "files_truncated": false,
  "link_summary": {
    "has_revert": false, "is_reverted": true,
    "has_cherry_pick": true, "has_stack": false, "reference_count": 1
  },
  "release_tags": ["build-20260819-02", "build-20260820-01"],
  "unreleased": false,
  "enrichment_pending": false,
  "links_pending": false,
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

응답 200 (보강 미완료):

```json
{
  "repository": "acme/payments",
  "pr_number": 1240,
  "title": "fix: 세션 만료 처리",
  "state": "merged",
  "merge_commit_sha": "d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708",
  "source_commits": [],
  "source_commits_total": 0,
  "merge_seq": 1343,
  "enrichment_pending": true,
  "hint": "원본 커밋과 변경 파일 정보를 수집 중입니다.",
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

- 오류: `NOT_FOUND` (404), `PERMISSION_UNAVAILABLE` (503)

### API-SRCH-004 검색

- 목적: 구조화 질의로 PR·커밋 목록과 패싯을 조회한다.
- 관련 요구사항: FR-SRCH-005, FR-SRCH-006, FR-SRCH-007, FR-SRCH-008, FR-SRCH-009, FR-SRCH-011

요청: `GET /api/v1/search?q=repo:acme/payments+seq:1280..1342+-author:bot&sort=merge_seq&order=desc&size=25&facets=true`

지원 질의 키 (FR-SRCH-005 AC-1): `repo`, `org`, `author`, `team`, `reviewer`, `label`, `base`, `head`, `state`, `merged`, `created`, `seq`, `release`, `path`, `is`

응답 200:

```json
{
  "query": "repo:acme/payments seq:1280..1342 -author:bot",
  "parsed": {
    "filters": [
      { "key": "repo", "op": "eq", "values": ["acme/payments"] },
      { "key": "seq", "op": "range", "from": 1280, "to": 1342 },
      { "key": "author", "op": "not_eq", "values": ["bot"] }
    ],
    "text": null
  },
  "total": { "value": 62, "relation": "eq" },
  "sort": { "field": "merge_seq", "order": "desc" },
  "items": [
    {
      "kind": "pull_request",
      "repository": "acme/payments",
      "pr_number": 1234,
      "title": "feat: 결제 재시도 로직",
      "author": "kim",
      "state": "merged",
      "merge_seq": 1342,
      "seq_epoch": 3,
      "sequence_space": "acme/payments@main",
      "merged_at": "2026-08-19T05:02:11Z",
      "changed_files_count": 2,
      "additions": 120,
      "deletions": 15,
      "labels": ["payment", "backend"],
      "link_summary": { "is_reverted": true, "has_cherry_pick": true },
      "highlight": { "title": ["feat: <em>결제</em> 재시도 로직"] },
      "url": "/pr/acme/payments/1234"
    }
  ],
  "facets": {
    "author":      [{ "value": "kim", "count": 18 }, { "value": "lee", "count": 11 }],
    "team":        [{ "value": "payments-core", "count": 41 }],
    "label":       [{ "value": "backend", "count": 33 }],
    "base_branch": [{ "value": "main", "count": 62 }],
    "state":       [{ "value": "merged", "count": 62 }],
    "repository":  [{ "value": "acme/payments", "count": 62 }]
  },
  "facets_omitted": false,
  "next_cursor": "eyJzIjpbMTMxOCwiYWNtZS9wYXltZW50czoxMjEwIl0sImYiOiJhOWYzIn0",
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

응답 400 (질의 문법 오류):

```json
{
  "error": {
    "code": "QUERY_SYNTAX_ERROR",
    "message": "지원하지 않는 검색 키입니다: 'assignee'",
    "detail": {
      "token": "assignee:kim",
      "offset_start": 24,
      "offset_end": 36,
      "supported_keys": ["repo","org","author","team","reviewer","label","base",
                         "head","state","merged","created","seq","release","path","is"]
    }
  },
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

응답 200 (결과 0건 + 필터 완화 제안, FR-SRCH-006 AC-3):

```json
{
  "query": "repo:acme/payments author:nobody state:merged",
  "total": { "value": 0, "relation": "eq" },
  "items": [],
  "relaxation_hints": [
    { "remove": "author:nobody", "would_yield": 62 }
  ],
  "next_cursor": null,
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

- 오류: `QUERY_SYNTAX_ERROR` (400), `SHA_PREFIX_TOO_SHORT` (400), `CURSOR_INVALID` (400), `CURSOR_QUERY_MISMATCH` (400), `QUERY_TOO_SHORT` (400), `SEARCH_TIMEOUT` (504), `PERMISSION_UNAVAILABLE` (503)
- 페이지네이션: `size` 기본 25, 최대 200 (초과 시 200으로 절삭). `cursor`로 다음 페이지
- 정렬: `merge_seq` | `merged_at` | `created_at` | `updated_at` | `changed_files_count` | `additions` | `lead_time_seconds` | `relevance`. 기본 `merge_seq` desc

### API-SEQ-001 시퀀스 범위 조회

- 목적: 반개구간 `(from_seq, to_seq]`의 PR·커밋과 요약 통계를 반환한다.
- 관련 요구사항: FR-SEQ-002

요청: `GET /api/v1/sequence-ranges?repository=acme/payments&base_branch=main&from_seq=1280&to_seq=1342&q=path:src/payment&size=50`

응답 200:

```json
{
  "sequence_space": "acme/payments@main",
  "seq_epoch": 3,
  "sequence_state": "ok",
  "range": { "from_seq": 1280, "to_seq": 1342, "boundary": "(from, to]" },
  "summary": {
    "pull_request_count": 62,
    "commit_count": 62,
    "distinct_author_count": 18,
    "changed_files_total": 412,
    "additions_total": 8940,
    "deletions_total": 3120,
    "reverted_pull_request_count": 2,
    "top_changed_paths": [
      { "path": "src/payment", "count": 24 },
      { "path": "src/session", "count": 11 }
    ]
  },
  "items": [
    {
      "merge_seq": 1281,
      "kind": "pull_request",
      "pr_number": 1198,
      "title": "fix: 타임아웃 처리",
      "author": "lee",
      "merged_at": "2026-08-12T21:04:00Z",
      "commit_sha": "9f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c",
      "changed_files_count": 3,
      "additions": 12,
      "deletions": 4,
      "url": "/pr/acme/payments/1198"
    }
  ],
  "next_cursor": null,
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

응답 400 (구간 과대):

```json
{
  "error": {
    "code": "RANGE_TOO_LARGE",
    "message": "구간에 포함된 항목이 상한(50000)을 넘습니다. 현재 추정 82,140건.",
    "detail": { "estimated_count": 82140, "limit": 50000 }
  },
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

- 오류: `RANGE_INVERTED` (400), `RANGE_TOO_LARGE` (400), `SEQUENCE_SPACE_MISMATCH` (400), `NOT_FOUND` (404)
- 비고: `sequence_state`가 `reassigning` 또는 `stale`이면 마지막 확정 값으로 응답하고 상태를 함께 반환한다

### API-SEQ-002 앵커 정규화

- 목적: 릴리스 태그·SHA·PR 번호·시각·시퀀스 값을 단일 시퀀스 값으로 변환한다.
- 관련 요구사항: FR-SEQ-003

요청:

```json
POST /api/v1/sequence-anchors/resolve
{
  "repository": "acme/payments",
  "base_branch": "main",
  "anchors": [
    { "position": "from", "expression": "build-20260812-03" },
    { "position": "to",   "expression": "#1234" }
  ]
}
```

응답 200:

```json
{
  "sequence_space": "acme/payments@main",
  "seq_epoch": 3,
  "resolved": [
    {
      "position": "from",
      "expression": "build-20260812-03",
      "kind": "release",
      "merge_seq": 1280,
      "commit_sha": "5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7081",
      "boundary": "exclusive",
      "occurred_at": "2026-08-12T20:00:00Z"
    },
    {
      "position": "to",
      "expression": "#1234",
      "kind": "pull_request",
      "merge_seq": 1342,
      "commit_sha": "a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5",
      "boundary": "inclusive",
      "occurred_at": "2026-08-19T05:02:11Z"
    }
  ],
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

응답 400 (브랜치 밖 앵커):

```json
{
  "error": {
    "code": "ANCHOR_NOT_ON_BRANCH",
    "message": "이 커밋은 acme/payments@main의 first-parent 체인에 없습니다.",
    "detail": {
      "expression": "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
      "suggested_anchor": {
        "kind": "commit",
        "commit_sha": "a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5",
        "reason": "이 커밋을 대상 브랜치에 반영한 머지 커밋"
      }
    }
  },
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

- 오류: `ANCHOR_NOT_ON_BRANCH` (400), `ANCHOR_NOT_MERGED` (400), `ANCHOR_UNRESOLVABLE` (400), `SEQUENCE_SPACE_MISMATCH` (400)

### API-SEQ-003 릴리스 구간 비교

- 목적: 두 릴리스 사이 반영분과 요약 통계를 반환한다.
- 관련 요구사항: FR-SEQ-004

요청: `GET /api/v1/release-comparisons?repository=acme/payments&base_branch=main&from=build-20260812-03&to=build-20260814-01`

응답 200:

```json
{
  "sequence_space": "acme/payments@main",
  "seq_epoch": 3,
  "normalized_direction": "from=build-20260812-03(seq 1280) → to=build-20260814-01(seq 1318)",
  "range": { "from_seq": 1280, "to_seq": 1318, "boundary": "(from, to]" },
  "summary": {
    "pull_request_count": 38,
    "changed_files_total": 241,
    "additions_total": 5120,
    "deletions_total": 1840,
    "distinct_author_count": 12,
    "reverted_pull_request_count": 1
  },
  "items": [],
  "next_cursor": "eyJzIjpbMTI5MF0sImYiOiJiN2MyIn0",
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

- `to=unreleased`를 지정하면 마지막 릴리스 이후 브랜치 head까지를 조회한다 (AC-5)
- 오류: `SEQUENCE_SPACE_MISMATCH` (400), `RELEASE_NOT_INDEXED` (404)

### API-REL-001 선행·후행 조회

- 목적: 시퀀스 기준 인접 PR을 앞뒤 N건 반환한다.
- 관련 요구사항: FR-REL-001

요청: `GET /api/v1/sequence-neighbors?repository=acme/payments&pr_number=1234&count=10`

응답 200:

```json
{
  "sequence_space": "acme/payments@main",
  "seq_epoch": 3,
  "anchor": { "merge_seq": 1342, "pr_number": 1234 },
  "items": [
    { "merge_seq": 1339, "kind": "commit", "commit_sha": "c72d1e0f3a4b5c6d7e8f90a1b2c3d4e5f6071829",
      "title": "hotfix: 로그 레벨", "author": "ops-bot", "pr_number": null,
      "merged_at": "2026-08-19T01:10:00Z", "is_anchor": false },
    { "merge_seq": 1341, "kind": "pull_request", "pr_number": 1233,
      "title": "fix: 세션 만료", "author": "lee",
      "merged_at": "2026-08-19T04:20:00Z", "is_anchor": false },
    { "merge_seq": 1342, "kind": "pull_request", "pr_number": 1234,
      "title": "feat: 결제 재시도 로직", "author": "kim",
      "merged_at": "2026-08-19T05:02:11Z", "is_anchor": true },
    { "merge_seq": 1343, "kind": "pull_request", "pr_number": 1240,
      "title": "fix: 세션 만료 처리", "author": "park",
      "merged_at": "2026-08-19T06:11:00Z", "is_anchor": false }
  ],
  "boundary": { "at_start": false, "at_end": false },
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

응답 409 (미머지 PR):

```json
{
  "error": {
    "code": "NO_SEQUENCE",
    "message": "이 PR은 아직 머지되지 않아 머지 시퀀스가 없습니다.",
    "detail": { "pr_number": 1250, "state": "open" }
  },
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

- `count` 기본 10, 최대 50 (AC-1)

### API-REL-002 포함 관계 조회

- 목적: 커밋·PR을 포함하는 릴리스 목록과 소속 PR을 반환한다.
- 관련 요구사항: FR-REL-002

요청: `GET /api/v1/containments?repository=acme/payments&kind=pull_request&id=1234`

응답 200:

```json
{
  "target": { "kind": "pull_request", "repository": "acme/payments", "id": "1234" },
  "merge_commit_sha": "a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5",
  "merge_seq": 1342,
  "releases": [
    { "tag_name": "build-20260819-02", "released_at": "2026-08-19T09:00:00Z",
      "base_branch": "main", "merge_seq": 1350, "source": "git_tag" },
    { "tag_name": "build-20260820-01", "released_at": "2026-08-20T00:30:00Z",
      "base_branch": "main", "merge_seq": 1358, "source": "git_tag" }
  ],
  "unreleased": false,
  "pending_pull_request_count": 0,
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

응답 200 (미배포):

```json
{
  "target": { "kind": "pull_request", "repository": "acme/payments", "id": "1360" },
  "merge_seq": 1372,
  "releases": [],
  "unreleased": true,
  "pending_pull_request_count": 14,
  "hint": "마지막 릴리스 이후 14건이 대기 중입니다.",
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

### API-REL-004 관계 그래프 탐색

- 목적: 기준 개체에서 지정 깊이까지 연결된 노드·간선을 반환한다.
- 관련 요구사항: FR-REL-008

요청: `GET /api/v1/relation-graphs?kind=pull_request&repository=acme/payments&id=1234&depth=2&link_types=reverts,cherry_picks,references`

응답 200:

```json
{
  "root": { "node_id": "pr:4021:1234", "kind": "pull_request" },
  "depth": 2,
  "nodes": [
    { "node_id": "pr:4021:1234", "kind": "pull_request", "repository": "acme/payments",
      "label": "#1234 feat: 결제 재시도 로직", "merge_seq": 1342, "url": "/pr/acme/payments/1234" },
    { "node_id": "pr:4021:1350", "kind": "pull_request", "repository": "acme/payments",
      "label": "#1350 Revert \"feat: 결제 재시도 로직\"", "merge_seq": 1361, "url": "/pr/acme/payments/1350" },
    { "node_id": "commit:4021:b81f3e0a", "kind": "commit", "repository": "acme/payments",
      "label": "b81f3e0a (release/2.4)", "url": "/commit/acme/payments/b81f3e0a9c2d4e5f60718293a4b5c6d7e8f90a1b" }
  ],
  "edges": [
    { "from": "pr:4021:1350", "to": "pr:4021:1234", "link_type": "reverts",
      "confidence": "exact", "evidence": "This reverts commit a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5" },
    { "from": "commit:4021:b81f3e0a", "to": "pr:4021:1234", "link_type": "cherry_picks",
      "confidence": "derived", "evidence": "patch_id 7f3c1a2b9d8e0f4a5b6c7d8e9f0a1b2c3d4e5f60 일치" }
  ],
  "truncated": false,
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

- `depth` 기본 2, 최대 3. 노드 상한 300 (AC-1, AC-2)
- 2초 초과 시 부분 그래프 + `truncated: true` 반환

### API-STAT-001 그룹 집계

- 목적: 현재 질의 조건 위에서 그룹별 지표를 반환한다.
- 관련 요구사항: FR-STAT-001, FR-STAT-006

요청:

```json
POST /api/v1/analytics/groups
{
  "query": "org:acme merged:2026-07-01..2026-08-01",
  "group_by": "team",
  "metrics": ["count", "changed_files_sum", "additions_sum", "lead_time_median"],
  "size": 100
}
```

응답 200:

```json
{
  "query": "org:acme merged:2026-07-01..2026-08-01",
  "group_by": "team",
  "total": { "value": 1842, "relation": "eq" },
  "groups": [
    { "key": "payments-core", "count": 412, "changed_files_sum": 2841,
      "additions_sum": 51240, "lead_time_median": 61200,
      "drill_down_query": "org:acme merged:2026-07-01..2026-08-01 team:payments-core" },
    { "key": "session", "count": 288, "changed_files_sum": 1522,
      "additions_sum": 29110, "lead_time_median": 44100,
      "drill_down_query": "org:acme merged:2026-07-01..2026-08-01 team:session" }
  ],
  "truncated": false,
  "approximate": false,
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

- `group_by`: `repository` | `org` | `team` | `author` | `label` | `base_branch` | `state`
- `size` 최대 500. 초과 시 상위 500 + `truncated: true` (AC-3)
- 대상 100만 건 초과 시 `approximate: true` (FR-STAT-006 AC-3)
- 오류: `AGGREGATION_TIMEOUT` (504)

### API-STAT-002 시계열 집계

요청:

```json
POST /api/v1/analytics/time-series
{
  "query": "org:acme",
  "from": "2026-07-01T00:00:00Z",
  "to": "2026-08-01T00:00:00Z",
  "interval": "day",
  "timezone": "Asia/Seoul",
  "group_by": "team",
  "metric": "count"
}
```

응답 200:

```json
{
  "interval": "day",
  "timezone": "Asia/Seoul",
  "applied_range": { "from": "2026-07-01T00:00:00Z", "to": "2026-08-01T00:00:00Z" },
  "buckets": ["2026-07-01", "2026-07-02", "2026-07-03"],
  "series": [
    { "key": "payments-core", "values": [14, 9, 0] },
    { "key": "session",       "values": [6, 11, 3] }
  ],
  "truncated": false,
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

- `interval`: `hour` | `day` | `week` | `month`. 버킷 400개 초과 시 `TOO_MANY_BUCKETS` (400)
- 데이터 없는 버킷도 0으로 채워 반환한다 (AC-4)
- `group_by` 지정 시 계열 최대 20개 (AC-5)

### API-STAT-003 백분위 집계

요청:

```json
POST /api/v1/analytics/percentiles
{
  "query": "org:acme merged:2026-07-01..2026-08-01",
  "field": "lead_time_seconds",
  "percentiles": [50, 75, 90, 95, 99],
  "group_by": "team"
}
```

응답 200:

```json
{
  "field": "lead_time_seconds",
  "unit": "seconds",
  "overall": { "p50": 61200, "p75": 122400, "p90": 259200, "p95": 432000, "p99": 864000 },
  "groups": [
    { "key": "payments-core", "p50": 54000, "p75": 108000, "p90": 216000, "p95": 388800, "p99": 777600,
      "sample_size": 412, "low_sample": false }
  ],
  "excluded_count": 0,
  "excluded_reasons": {},
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

- `field`: `lead_time_seconds` | `first_review_wait_seconds`
- 표본 20건 미만이면 `low_sample: true`와 원값 목록 (`raw_values`)을 반환한다
- `first_review_wait_seconds`는 리뷰 없는 PR을 제외하고 `excluded_count`에 집계한다 (FR-STAT-004 AC-1)

### API-ING-001 웹훅 수신

- 목적: GHE 웹훅을 검증·저장하고 파이프라인에 투입한다.
- 관련 요구사항: FR-ING-001, FR-ING-002

요청: `POST /api/v1/webhooks/github`

헤더: `X-GitHub-Event`, `X-GitHub-Delivery`, `X-Hub-Signature-256`, `Content-Type: application/json`

응답 202:

```json
{ "accepted": true, "delivery_id": "72d1e0f3-a4b5-4c6d-8e7f-90a1b2c3d4e5", "duplicate": false }
```

응답 202 (중복):

```json
{ "accepted": true, "delivery_id": "72d1e0f3-a4b5-4c6d-8e7f-90a1b2c3d4e5", "duplicate": true }
```

- 오류: 401 (서명 불일치, 본문 없음), 413 (25MB 초과), 500 (durable 저장 실패 — GHE 재전송 유도)
- 지원 이벤트: `pull_request`, `pull_request_review`, `push`, `create`, `delete`, `release`, `member`, `team`, `repository`. 그 외는 저장만 하고 처리 대상에서 제외 (AC-5)

### API-ADM-007 시퀀스 정합성 점검과 재채번

요청 (점검): `GET /api/v1/admin/sequence-integrity?repository=acme/payments&base_branch=main&mode=sample`

응답 200:

```json
{
  "sequence_space": "acme/payments@main",
  "seq_epoch": 3,
  "mode": "sample",
  "checked_count": 1000,
  "consistent": false,
  "first_mismatch": {
    "merge_seq": 1290,
    "stored_commit_sha": "aaaa1111bbbb2222cccc3333dddd4444eeee5555",
    "actual_commit_sha": "ffff6666eeee7777dddd8888cccc9999bbbb0000"
  },
  "impact_estimate": {
    "affected_commit_count": 52,
    "invalidated_safe_marker_count": 1,
    "affected_saved_search_count": 4
  },
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

요청 (재채번):

```json
POST /api/v1/admin/sequence-integrity
{
  "repository": "acme/payments",
  "base_branch": "main",
  "action": "reassign",
  "confirmation": "acme/payments"
}
```

응답 202:

```json
{ "job_id": 8812, "type": "sequence_reassign", "state": "queued", "new_epoch_expected": 4 }
```

- `confirmation`이 저장소 이름과 정확히 일치해야 한다. 불일치 시 400 `CONFIRMATION_MISMATCH` (FLOW-008)
- 재채번은 비가역이다. 실행은 감사 기록 대상이다

## 5. DTO 표준

- ID는 안정 정규 ID를 사용한다. PR은 `{repository}#{pr_number}`, 커밋은 `{repository}@{commit_sha}`, 노드는 `{kind}:{repository_id}:{id}`.
- 시각은 ISO-8601 UTC 문자열(`2026-08-19T05:02:11Z`)이다.
- 기간은 초 단위 정수이며 필드명에 `_seconds` 접미사를 붙인다.
- enum은 문서화된 값만 허용한다. 알 수 없는 값을 받으면 400이다.
- optional(필드 부재)과 nullable(값이 `null`)을 구분한다. `merge_commit_sha`는 미머지 PR에서 `null`이지 부재가 아니다.
- 배열 필드는 빈 배열을 반환한다. `null`을 반환하지 않는다.
- SHA는 항상 소문자 40자 전체로 반환한다. 축약은 클라이언트가 한다.
- 시퀀스 값은 항상 `seq_epoch`, `sequence_space`와 함께 반환한다. 셋 중 하나만 반환하지 않는다.

## 6. 오류 모델

모든 오류는 다음 형태다.

```json
{
  "error": { "code": "STRING_CODE", "message": "사용자에게 보일 한국어 설명", "detail": { } },
  "correlation_id": "uuid"
}
```

| Error Code | HTTP | 의미 | 사용자 조치 |
| --- | --- | --- | --- |
| `QUERY_SYNTAX_ERROR` | 400 | 질의 파싱 실패 | 오류 구간 수정 |
| `SHA_PREFIX_TOO_SHORT` | 400 | hex 접두 7자 미만 | 더 긴 SHA 입력 |
| `QUERY_TOO_SHORT` | 400 | 검색어 1자 | 2자 이상 입력 |
| `CURSOR_INVALID` | 400 | 커서 훼손·만료 | 첫 페이지부터 재조회 |
| `CURSOR_QUERY_MISMATCH` | 400 | 질의 변경 후 이전 커서 사용 | 첫 페이지부터 재조회 |
| `RANGE_INVERTED` | 400 | from > to | 앵커 교환 |
| `RANGE_TOO_LARGE` | 400 | 구간 5만 건 초과 | 구간 축소 |
| `SEQUENCE_SPACE_MISMATCH` | 400 | 앵커가 서로 다른 시퀀스 공간 | 브랜치 통일 |
| `ANCHOR_NOT_ON_BRANCH` | 400 | 앵커가 first-parent 체인 밖 | 제안된 머지 커밋 사용 |
| `ANCHOR_NOT_MERGED` | 400 | 미머지 PR 앵커 | 다른 앵커 사용 |
| `ANCHOR_UNRESOLVABLE` | 400 | 어떤 유형으로도 해석 불가 | 지원 형식 확인 |
| `TOO_MANY_BUCKETS` | 400 | 시계열 버킷 400개 초과 | 간격 확대 |
| `EXPORT_LIMIT_EXCEEDED` | 400 | 내보내기 10만 건 초과 | 조건 축소 |
| `CONFIRMATION_MISMATCH` | 400 | 2단계 확인 문자열 불일치 | 저장소 이름 정확 입력 |
| `BRANCH_LIMIT_EXCEEDED` | 400 | 시퀀스 대상 브랜치 10개 초과 | 브랜치 축소 |
| `UNAUTHENTICATED` | 401 | 세션 없음·만료 | 재인증 |
| `FORBIDDEN_ROLE` | 403 | 역할 부족 | 필요 역할 요청 |
| `NOT_FOUND` | 404 | 대상 없음 또는 접근 범위 밖 | 검색으로 복귀 |
| `RELEASE_NOT_INDEXED` | 404 | 릴리스 미수집 저장소 | 저장소 등록 확인 |
| `NO_SEQUENCE` | 409 | 미머지 PR에 시퀀스 요청 | 머지 후 재시도 |
| `BISECT_CONTRADICTION` | 409 | good/bad 표시 모순 | 탐색 초기화 |
| `JOB_CONFLICT` | 409 | 동일 대상 잡 실행 중 | 기존 잡 확인 |
| `SAVED_SEARCH_LIMIT` | 409 | 저장 100건 초과 | 기존 항목 삭제 |
| `PAYLOAD_TOO_LARGE` | 413 | 웹훅 25MB 초과 | (GHE 측) |
| `PERMISSION_UNAVAILABLE` | 503 | 접근 범위 조회 실패 | 잠시 후 재시도 |
| `SEARCH_TIMEOUT` | 504 | 검색 3초 초과 | 조건 추가 |
| `AGGREGATION_TIMEOUT` | 504 | 집계 5초 초과 | 기간 축소 |
| `GRAPH_TIMEOUT` | 200 (부분) | 그래프 2초 초과 | 깊이 축소 (부분 결과 반환) |
| `INTERNAL_ERROR` | 500 | 예상치 못한 오류 | 상관 ID로 문의 |

## 7. 내부 이벤트 계약

이 제품에는 클라이언트로 가는 실시간 푸시 채널이 없다 (시스템 아키텍처 10장). 아래는 서비스 내부 이벤트 버스 계약이다.

| Event ID | Event Name | Producer | Consumer | Payload | Ordering/Dedupe |
| --- | --- | --- | --- | --- | --- |
| EVT-ING-001 | `ingestion.event_received` | ingest-gateway | enrich 워커 | `{ delivery_id, event_type, action, repository_id, correlation_id }` | 파티션 키 `repository_id`. 멱등 키 `delivery_id` |
| EVT-ING-002 | `ingestion.enriched` | enrich 워커 | project 워커 | `{ delivery_id, repository_id, entity_kind, entity_id, enrichment_pending }` | 위와 동일 |
| EVT-ING-003 | `ingestion.projected` | project 워커 | link 워커 | `{ repository_id, entity_kind, entity_id, document_version }` | 위와 동일 |
| EVT-ING-004 | `ingestion.failed` | 모든 워커 | ops 모듈 | `{ delivery_id, stage, error, retry_count }` | 멱등 키 `(delivery_id, stage)` |
| EVT-SEQ-001 | `sequence.assigned` | sequence 워커 | project 워커 | `{ repository_id, base_branch, seq_epoch, from_seq, to_seq }` | 시퀀스 공간별 직렬 |
| EVT-SEQ-002 | `sequence.reassigned` | sequence 워커 | project 워커, 알림 | `{ repository_id, base_branch, old_epoch, new_epoch, from_seq }` | 시퀀스 공간별 직렬 |
| EVT-AUTH-001 | `permission.invalidated` | ingest-gateway | authz 모듈 | `{ user_ids[], repository_id, reason }` | 멱등 (집합 연산) |
| EVT-JOB-001 | `job.progress` | 모든 배치 워커 | ops 모듈 | `{ job_id, type, target, state, progress }` | 최신 값 우선 |

이벤트 이름은 `<도메인>.<행위>` 규칙을 따른다 (glossary 3장).

## 8. 계약 안정성

| API | 상태 | 변경 정책 |
| --- | --- | --- |
| API-SRCH-001~004, API-SEQ-001~003, API-REL-001~002 | stable | 하위 호환만. 필드 제거·의미 변경은 `/api/v2` |
| API-STAT-001~004, API-SEQ-004~005, API-REL-003~004 | stable | 위와 동일 |
| API-ADM-* | internal | 운영 콘솔 전용. 프런트엔드와 동시 배포 전제로 변경 가능 |
| API-ING-001 | external | GHE 계약. 변경 시 웹훅 재등록 필요 |

버전 정책: 경로 접두 `/api/v1`. 하위 호환 변경(필드 추가, 새 enum 값에 대한 관대한 처리)은 버전을 올리지 않는다. 필드 제거·타입 변경·의미 변경은 `/api/v2`를 신설하고 최소 1개 릴리스 동안 병행 운영한다.
