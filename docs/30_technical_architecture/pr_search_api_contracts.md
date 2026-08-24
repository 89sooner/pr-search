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
| API-SEQ-006 | GET | `/sequence-spaces` | 접근 범위 안 시퀀스 공간 목록 (CR-029, DEV-152) | 인증 + 접근 범위 | FR-SEQ-001 |
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

**GitHub Operations Plane (CR-005 신규).** 아래 API는 `search-api`가 아니라 Operations 경로에 속하며, 인증은 세션 인증에 더해 사용자 위임 GitHub 신원(FR-GH-008)을 요구한다.

| API ID | Method | Path | 목적 | 인증/권한 | 관련 FR |
| --- | --- | --- | --- | --- | --- |
| API-GH-001 | GET | `/gh/capabilities` | capability manifest 조회·검색. 분류 상태와 호스트 지원 여부 포함 | 인증 | FR-GH-001, FR-GH-011, FR-GH-013 |
| API-GH-002 | POST | `/gh/executions` | 명령 실행 요청. 중복 방지 키 필수 | 인증 + 위임 신원 + 위험도 정책 | FR-GH-002, FR-GH-003, FR-GH-009 |
| API-GH-003 | GET | `/gh/contexts/{scope}` | 대상 컨텍스트 해석 (저장소·브랜치·PR·이슈 선택자) | 인증 + 접근 범위 | FR-GH-004 |
| API-GH-004 | GET/POST/PATCH | `/gh/recipes[/{id}]` | Recipe 정의 조회·저장·개정 | 인증 | FR-GH-005 |
| API-GH-005 | GET | `/gh/executions/{id}/stream` | 실행 진행 상황 스트리밍 (SSE) | 인증 + 실행 소유자 또는 `security_officer` | FR-GH-006 |
| API-GH-006 | GET/POST | `/gh/executions/{id}/artifacts` | 실행 아티팩트 목록·내려받기, 파일 입력 업로드 | 인증 + 실행 소유자 | FR-GH-007 |
| API-GH-007 | GET/POST/DELETE | `/gh/identity` | Operations App 연결 상태 조회, 인가 시작, 연결 해제 | 인증 | FR-GH-008 |
| API-GH-008 | GET/PUT | `/gh/policies` | 실행 정책 조회·변경 (capability 허용/차단, 위험도 재정의, 승인 필요, 엔드포인트·확장 목록) | `operator` | FR-GH-009, FR-GH-010, FR-GH-013 |
| API-GH-009 | POST | `/gh/api-requests` | `gh api` 요청 구성·실행 | 인증 + 위임 신원 + 엔드포인트 정책 | FR-GH-010 |
| API-GH-010 | GET | `/gh/executions` | 실행 이력 조회·필터. 본인 이력 기본, `security_officer`는 전체 | 인증 | FR-GH-012 |
| API-GH-011 | POST | `/gh/executions/{id}/cancel` | 실행 취소 | 인증 + 실행 소유자 또는 `operator` | FR-GH-006 |
| API-GH-012 | POST | `/gh/executions/{id}/approve` | 승인 대기 실행의 승인·거부 | `operator` 또는 정책이 지정한 승인자 | FR-GH-009 |

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

**URL은 호스트까지 맞아야 한다 (CR-017, DEV-064).** `GHE_BASE_URL`이 가리키는 호스트와 다른 URL은 경로가 `/owner/repo/pull/N` 모양이더라도 `text`로 떨어진다. 호스트를 보지 않으면 `https://other.example/acme/payments/pull/1`이 우리 저장소의 PR로 해석된다 — 접근 범위가 데이터를 막아 주더라도 **엉뚱한 저장소로 해석하는 것 자체가 오답**이다.

**릴리스 태그는 아직 판별하지 않는다 (CR-017, DEV-065).** 백엔드 아키텍처 4.5의 해석 7단계가 "태그 패턴"을 말하지만 **그 패턴이 무엇인지는 어디에도 정의되어 있지 않고**, `prs-releases`도 아직 비어 있다(WP-024). 패턴을 추측해 넣으면 `v1`·`build-2` 같은 문자열이 릴리스로 오분류되어 전문 검색으로 가야 할 질의가 0건이 된다. 태그처럼 보이는 문자열은 FR-SRCH-001 AC-4대로 `text`이며, 패턴은 릴리스를 색인하는 WP-024가 정의한다.

- 오류: `SHA_PREFIX_TOO_SHORT` (400), `SEARCH_TIMEOUT` (504), `PERMISSION_UNAVAILABLE` (503)
- Authz: 인증 필요. 접근 범위 밖 후보는 결과에서 제외한다 (FR-SRCH-001 AC-6)
- 페이지네이션: 없음. `limit`으로 상한만 둔다

### API-SRCH-002 커밋 상세

- 목적: 커밋 SHA로 소속 PR과 시퀀스 위치를 조회한다 (SHA → PR 역추적).
- 관련 요구사항: FR-SRCH-002, FR-REL-002
- 요청: `GET /api/v1/commits/acme%2Fpayments/a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5`

**커밋 문서가 실제로 갖는 것만 응답에 싣는다 (CR-017, DEV-060).** 커밋 문서는 SHA·역할·소속 PR 번호·대상 브랜치만 갖는다 — 매핑에는 `message`·`author`·`authored_at`·`parent_shas`·`patch_id`·`changed_paths`·`changed_files_count`·`additions`·`deletions` 자리가 있으나 **투영이 채우지 않는다.** `EVT-ING-002`가 커밋에 대해 SHA만 나르기 때문이다. 커밋 자체의 메타데이터는 미러 기반 보강(WP-020)이 채운다.

**채워지지 않은 필드는 키를 넣지 않는다.** CR-016 DEV-057이 `facets`에 세운 규칙과 같다 — 키가 없으면 "만들지 않았다", `null`이면 "만들었는데 비었다". `additions: 0`으로 채우면 *파일을 하나도 바꾸지 않은 커밋*과 구분되지 않는다.

응답 200 (머지 커밋):

```json
{
  "repository": "acme/payments",
  "repository_id": 4021,
  "commit_sha": "a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5",
  "short_sha": "a3f9c21b4e8d",
  "role": "merge_commit",
  "base_branch": "main",
  "merge_seq": null,
  "seq_epoch": null,
  "sequence_space": null,
  "pull_requests": [
    {
      "pr_number": 1234,
      "title": "feat: 결제 재시도 로직",
      "author": "kim",
      "reviewers": ["lee", "park"],
      "approved_by": ["lee"],
      "state": "merged",
      "merged_at": "2026-08-19T05:02:11Z",
      "merge_commit_sha": "a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5",
      "url": "/pr/acme/payments/1234"
    }
  ],
  "link_summary": { "has_revert": false, "is_reverted": true, "has_cherry_pick": true },
  "enrichment_pending": false,
  "url": "/commit/acme/payments/a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5",
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

시퀀스 3종은 **키를 두고 `null`**이다 — 채번 경로(WP-021)가 아직 없다는 뜻이며, 커밋 메타데이터처럼 "만들지 않은" 것과 구분된다.

`pull_requests[]`의 **`merge_commit_sha`는 W-003의 `no_sequence` 안내가 요구한다** (CR-021, DEV-091). 원본 커밋 화면이 "이 커밋은 머지 커밋 X로 반영되었습니다"라고 말하고 그 X로 이동시키려면 이 키가 필요하다 — 값은 이미 PR 문서에 있으므로 없는 데이터를 만드는 것이 아니다. **미머지 PR이면 키를 넣지 않는다** (`null`로 채우지 않는다).

**WP-020은 이 키들을 채우지 않는다 (CR-023, DEV-112).** WP-020이 낸 것은 커밋 그래프 **접근 계층**(`CommitGraph` 인터페이스와 미러·API 두 구현)이고, 그 값을 읽어 커밋 문서에 쓰는 잡은 그때 카탈로그에 없었다.

**그 잡을 CR-024가 정의했다: `JOB-MIR-002` 커밋 메타데이터 보강, 소유 WP는 WP-067이다.** 그때 붙는 키는 `parent_shas`, `message`, `author`, `committer`, `authored_at`, `committed_at`, `patch_id`, `patch_id_unavailable`, `changed_paths`, `changed_paths_truncated`, `changed_files_count`, `additions`, `deletions`다. WP-024 이후: `release_tags`.

그중 **`patch_id`만 조건부다.** `MIRROR_ALLOW_BLOB_FETCH=true`인 저장소에서만 값이 오고, 그 외에는 키가 없는 대신 `patch_id_unavailable`이 `no_mirror` | `blob_fetch_disabled` | `compute_failed` 중 하나를 담는다 (FR-REL-005 AC-5, CR-024). `changed_paths`는 조건부가 아니다 — `git diff-tree --name-only`는 트리만 비교하므로 blob 없이 얻는다.

응답 200 (직접 푸시 커밋) — **아직 도달하지 않는 경로다 (CR-017, DEV-061).** 커밋 문서는 PR 이벤트에서만 만들어지고 `push` 이벤트는 ack 후 버려진다(DEV-016). 직접 푸시 커밋은 **문서 자체가 없어** 현재는 404다. push 이벤트 라우팅(WP-021)이 서면 이 모양으로 응답한다 — 그때 계약을 다시 고치지 않도록 지금 적어 둔다:

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

**`source_commits`는 객체 배열이되 지금은 `commit_sha`만 채운다 (CR-017, DEV-062).** PR 문서가 갖는 것은 `source_commit_shas`(문자열 배열)뿐이고, 커밋 문서를 조인해도 메시지·작성자가 없다(DEV-060). FR-SRCH-003 AC-3이 요구하는 `subject`·`author`·`authored_at`은 **키를 넣지 않는다** — 배열 모양을 지금부터 객체로 두는 이유는 WP-020이 커밋을 보강하면 키가 저절로 붙어 계약을 다시 고치지 않아도 되기 때문이다.

**`source_commits_total`은 절삭됐을 때 키를 넣지 않는다 (CR-017, DEV-063).** 절삭되지 않았으면 배열 길이가 곧 총계다. 250건에서 잘렸을 때의 진짜 총계는 **저장되어 있지 않으므로**(보강 payload가 나르지 않는다) 250을 총계로 내보내지 않는다 — `source_commits_truncated: true`가 "더 있다"를 말하고, 얼마나 더 있는지는 모른다고 두는 편이 틀린 수를 주는 것보다 낫다.

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
    { "commit_sha": "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d" },
    { "commit_sha": "2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e" }
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

**질의 문법 (CR-014).** 파서는 `@prs/query`가 갖고 서버와 클라이언트가 같은 코드를 쓴다 (ADR-001).

| 요소 | 형태 | 비고 |
| --- | --- | --- |
| 동등 | `key:value` | 같은 키 반복은 OR, 다른 키는 AND (AC-5) |
| 부정 | `-key:value` | 범위에도 붙는다 (AC-6) |
| 범위 | `key:a..b` | **`seq`·`merged`·`created` 세 키만** (DEV-037). 양끝이 모두 있어야 한다 |
| 인용 | `key:"두 낱말"` | `"`와 `\`는 `\`로 escape한다 |
| 전문 검색어 | 키 없는 남은 문자열 | 공백 하나로 이어 붙인다 |

`op` 값은 넷이다 — `eq`, `not_eq`, `range`, **`not_range`** (CR-014, DEV-035). AC-6의 `-`는 문법 수준에서 모든 키에 붙으므로, 범위에만 붙일 수 없게 하면 사용자가 이해할 수 없는 특례가 된다.

**값 검증은 SRS가 값을 열거한 키에만 한다 (DEV-036).** `is`는 AC-1이 `merged`/`open`/`closed`/`reverted`를 명시했으므로 그 밖의 값은 400으로 거절한다. `state`처럼 열거되지 않은 키의 값은 검증하지 않는다 — 없는 제약을 지어내지 않는다.

**`key`가 세 범위 키가 아니면 `..`는 리터럴이다.** `path:src/a..b`는 범위가 아니라 그 문자열을 찾는 조건이다.

**질의 키가 가 닿는 자리 (CR-016, DEV-052).** 파서는 키를 15종으로 알지만 그것이 어느 필드를 보는지는 별개다.

| 키 | 대상 | 비고 |
| --- | --- | --- |
| `repo` | `repository` | `owner/name` 그대로 |
| `org` | `org_id` | **레지스트리 해석** — 문서에 조직 이름이 없다. `repository.owner`로 `org_id`를 찾는다 |
| `author` | `author` | |
| `team` | `allowed_team_ids` | **레지스트리 해석** — `team.slug` → `team_id`. **지금은 결과를 내지 못한다** (문서의 팀 ID가 비어 있다) |
| `reviewer` | `reviewers` | |
| `label` | `labels` | 커밋 문서에는 없다 → 커밋은 매치되지 않는다 (정상) |
| `base` | `base_branch` | |
| `head` | `head_branch` | PR에만 있다 |
| `state` | `state` | GitHub이 준 값 그대로 |
| `merged` | `merged_at` 범위 | |
| `created` | `created_at` 범위 | |
| `seq` | `merge_seq` 범위 | |
| `release` | `release_tags` | |
| `path` | `changed_paths` | `path_hierarchy` 토크나이저라 `match`가 곧 접두 매칭이다 (AC-1의 "변경 경로 접두") |
| `is` | 파생 상태 | 아래 |

**`is`는 파생 상태다 (CR-016, DEV-053).** `state`가 GitHub이 준 값을 그대로 보는 반면 `is`는 이 시스템이 계산한 것까지 본다.

| 값 | 조건 |
| --- | --- |
| `is:merged` / `is:open` / `is:closed` | `state`와 같다 |
| `is:reverted` | `link_summary.is_reverted` — GitHub에는 없는, 관계 파생이 만든 상태 |

겹치는 셋을 지우지 않은 것은 사용자가 `is:` 하나로 상태를 물을 수 있어야 하기 때문이다.

**대상 인덱스는 `prs-pull-requests`와 `prs-commits` 둘이다 (CR-016, DEV-054).** W-001-RESULTS의 유형 열이 PR/커밋을 함께 보여 준다.

- 한쪽에만 있는 필드로 **필터**하면 그 인덱스는 매치되지 않는다. 이것이 옳다 — 커밋에 라벨이 없는 것은 사실이다.
- 한쪽에만 있는 필드로 **정렬**하면 Elasticsearch가 HTTP 200에 `_shards.failed`를 붙인 **부분 실패**를 준다. 한 인덱스가 통째로 빠진 결과가 정상처럼 돌아온다. 그래서 **모든 정렬 키에 `unmapped_type`을 붙이고 `_shards.failed`를 검사한다.** 0이 아니면 부분 결과를 내지 않는다.

**`relaxation_hints`는 `msearch` 한 번이다 (CR-016, DEV-055).** 필터마다 질의를 따로 던지면 NFR-001의 예산을 필터 수만큼 쓴다. 후보는 **상한 8개**이며, 넘으면 `relaxation_hints_truncated: true`로 잘랐다는 사실을 남긴다. 0건일 때만 계산하므로 정상 경로의 지연에 영향이 없다.

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

**`facets`와 `facets_omitted`는 함께 나타나거나 함께 빠진다** (CR-019 DEV-076 / CR-016 DEV-057). 세 경우가 서로 다른 뜻이다.

| 응답 | 뜻 | 화면 |
| --- | --- | --- |
| 두 키 모두 **없음** | 패싯을 **세지 않았다** (WP-032 전까지의 상태) | 레일에 "아직 분포를 세지 않습니다" |
| `facets_omitted: false` + `facets` | 세었고 생략하지 않았다 | 분포 표시 |
| `facets_omitted: true`, `facets` 없음 | 세려 했으나 **예산을 넘겨 생략했다** (FR-SRCH-009 AC-4) | 레일에 "이번 조회에서는 생략했습니다" + 재시도 |

셋을 같은 문구로 뭉뚱그리지 않는다 — 사용자가 할 수 있는 일이 각각 다르다. 빈 분포를 조용히 그리는 것은 어느 경우에도 금지다 (C-012 사용 규칙).

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
- **문법·값 오류는 파서가 낸다** (CR-014, DEV-038). `@prs/query`가 오류 코드와 문자 오프셋을 함께 돌려주고 API는 그대로 실어 보낸다. `QUERY_TOO_SHORT`(전문 검색어 1자)도 파서가 판정한다 — 무엇이 전문 검색어인지 아는 곳이 파서뿐이다
- 페이지네이션: `size` 기본 25, 최대 200 (초과 시 200으로 절삭). `cursor`로 다음 페이지
- 정렬: `merge_seq` | `merged_at` | `created_at` | `updated_at` | `changed_files_count` | `additions` | `lead_time_seconds` | `relevance`. 기본 `merge_seq` desc
- **모든 정렬은 문서 ID를 마지막 키로 갖는다** (FR-SRCH-007 AC-4). 동점이 있어도 두 번 조회한 순서가 같다. 그 값은 `_id`가 아니라 **`doc_id` 필드**다 (CR-016, DEV-059) — Elasticsearch 8은 `_id` 정렬을 금지한다. `upsert`가 `_id`와 같은 값을 그 필드에 함께 넣는다
- **`relevance`는 전문 검색이 서기 전까지 문서 ID 순이다** (CR-016, DEV-056). 접근 범위 필터는 `filter` 절이라 점수를 만들지 않으므로 모든 문서의 점수가 같다. 키를 거절하지는 않는다 — AC-1이 지원 키로 열거했다. 실제 점수는 WP-032가 붙인다
- **`facets`와 `next_cursor`는 WP-032 전까지 이렇게 나간다** (CR-016, DEV-057). `next_cursor`는 **항상 `null`**로 실린다(키가 있고 값이 없다 = 다음 페이지가 없다). `facets`는 **키 자체가 없다** — 빈 객체는 "패싯을 셌는데 아무것도 없다"로 읽히기 때문이다

### API-SEQ-001 시퀀스 범위 조회

- 목적: 반개구간 `(from_seq, to_seq]`의 PR·커밋과 요약 통계를 반환한다.
- 관련 요구사항: FR-SEQ-002

요청: `GET /api/v1/sequence-ranges?repository=acme/payments&base_branch=main&from_seq=1280&to_seq=1342&seq_epoch=3&q=path:src/payment&size=50`

- `seq_epoch`는 **선택**이며 인용이 딛고 선 에폭이다 (CR-027). 넣으면 서버가 현재 에폭과 대조하고, 다르면 구간을 실행하지 않은 채 `epoch_stale: true`로 답한다 — ADR-007의 "조용히 옮기지 않고 무효화한다"가 여기서 성립한다. 생략하면 현재 에폭으로 조회한다.
- `q`는 구간을 좁히며 **목록과 요약 양쪽에 같이 적용된다** (CR-027, DEV-136). 둘이 다른 집합을 말하면 화면이 고장난 것으로 읽힌다.

응답 200:

```json
{
  "sequence_space": "acme/payments@main",
  "seq_epoch": 3,
  "sequence_state": "ok",
  "epoch_stale": false,
  "range": { "from_seq": 1280, "to_seq": 1342, "boundary": "(from, to]" },
  "summary": {
    "pull_request_count": 62,
    "commit_count": 62,
    "distinct_author_count": 18,
    "changed_files_total": 412,
    "additions_total": 8940,
    "deletions_total": 3120,
    "files_truncated_pull_request_count": 0,
    "top_changed_paths": [
      { "path": "src/payment/timeout.ts", "count": 24 },
      { "path": "src/session/store.ts", "count": 11 }
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
  "items_missing_in_index": 0,
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

#### 필드 근거 (CR-027)

| 필드 | 출처 | 왜 이렇게 정했나 |
| --- | --- | --- |
| `items`의 멤버십과 순서, `summary.pull_request_count`·`commit_count` | PostgreSQL `merge_sequence` | 서수의 정본이며 `git log --first-parent`와 대조 가능한 유일한 출처다 (DEV-130). Elasticsearch `range(merge_seq)`로 읽으면 색인 반영이 실패한 만큼 **오류 없이 항목이 빠진다** |
| `summary.commit_count` | 구간의 **first-parent 커밋 수** (= `merge_sequence` 행 수) | PR의 원본 커밋까지 세지 않는다 (DEV-139). DoD가 `git log --first-parent A..B`와 대조하라고 하므로 그 명령이 세는 것과 같은 것을 센다 |
| `items_missing_in_index` | 정본에는 있으나 색인에 없는 항목 수 | 그런 항목을 조용히 빼지 않는다 (DEV-130). `0`이면 정본과 색인이 일치한다는 뜻이고, 양수면 결과가 덜 채워졌다는 뜻이다 |
| `summary.top_changed_paths[].path` | `prs-pull-requests.changed_paths.raw` | **파일 경로**다 (DEV-134). 디렉터리 롤업 깊이를 정한 문서가 없어 발명하지 않는다. `repository_id` 라우팅으로 단일 샤드에서 끝나므로 `terms` 집계가 근사가 아니라 정확하다 |
| `summary.files_truncated_pull_request_count` | `prs-pull-requests.files_truncated` | 변경 파일 목록이 절삭된 PR 수다 (DEV-135). 절삭이 있으면 `changed_files_total`·`additions_total`·`deletions_total`은 **하한**이며, 이 수가 그 사실을 말한다 |
| `epoch_stale` | 요청 `seq_epoch` vs 현재 `seq_epoch` | `true`면 `summary`와 `items` 키를 **넣지 않는다** (DEV-138과 같은 원칙: 계산하지 않은 것은 키를 비우는 것이 아니라 없앤다). 서버가 다른 에폭으로 자동 재조회하지 않는 것이 ADR-007의 요구다 |
| `next_cursor` | 항상 `null` | 커서 페이지네이션은 WP-032다 (DEV-138). 키를 빼면 화면이 마지막 페이지를 오해하므로 `null`로 둔다 |
| `reverted_pull_request_count` | **아직 없다** | 되돌림 관계 파생(WP-030)이 서기 전에는 `link_summary.is_reverted`가 투영이 넣은 `false`뿐이라 세면 언제나 `0`이 나오고, 그 `0`은 "되돌림이 없다"와 구분되지 않는다 (DEV-133). **키를 넣지 않는다** — 계산하지 않은 것을 계산한 척하지 않는다. WP-030 이후 더한다 |

`RANGE_TOO_LARGE`의 `estimated_count`는 이름과 달리 **정확한 값**이다 (DEV-140). 정본이 PostgreSQL이므로 `count(*)`가 PK 범위 스캔 한 번이고, 추정할 이유가 없다. 필드 이름은 하위 호환을 위해 그대로 둔다.

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

#### 앵커 유형과 판정 순서 (CR-027)

`kind`는 다섯이다. 표현을 보고 **모호하지 않은 쪽부터** 가른다 — 순서를 뒤집으면 `1234`가 PR 번호인지 서수인지에 따라 답이 달라진다.

| 순서 | `kind` | 표현 | 시퀀스로 바꾸는 방법 | 근거 |
| --- | --- | --- | --- | --- |
| 1 | `sequence` | `seq:1342` 또는 `@1342` | 그 값 자체. 구간에 실재하는지 확인한다 | FR-SEQ-003 |
| 2 | `pull_request` | `#1234` | `merge_sequence.pull_request_number` 조회. 미머지면 `ANCHOR_NOT_MERGED` | AC-3 |
| 3 | `commit` | 7~40자 16진 SHA | `merge_sequence.commit_sha` 조회(접두는 후보 1건일 때만). 체인 밖이면 `ANCHOR_NOT_ON_BRANCH` + `suggested_anchor` | AC-2, ADR-012 |
| 4 | `time` | ISO 8601 시각 | `committed_at <= T`인 최대 서수. 그런 커밋이 없으면 `ANCHOR_UNRESOLVABLE` | AC-4 |
| 5 | `release` | 그 밖의 문자열(태그명) | PostgreSQL `release` 표에서 `(repository, tag_name)` 조회 (CR-028, DEV-142). 수집 전이면 `ANCHOR_UNRESOLVABLE` + `detail.reason: "release_not_indexed"`, 태그는 있으나 체인 밖이면 `ANCHOR_NOT_ON_BRANCH`, 다른 브랜치 체인이면 `SEQUENCE_SPACE_MISMATCH` | AC-1 |

**릴리스 태그 앵커는 WP-024가 세웠다.** 이월 당시의 사유 중 "미러는 `fetch --no-tags`라 태그를 갱신하지 않는다"는 **실측으로 반증됐다** (CR-028, DEV-143) — `--mirror` 클론의 refspec `+refs/*:refs/*`는 그 플래그와 무관하게 태그를 옮긴다. 실제 공백은 릴리스를 저장하는 경로 자체의 부재였고, WP-024가 미러의 refs/tags 스냅숏을 PostgreSQL `release` 표로 동기화해 그 공백을 메웠다. 앵커 해석은 그 표를 본다 — `prs-releases`가 아니다 (DEV-142).

`boundary`는 표현이 아니라 **`position`이 정한다**: `from`은 `exclusive`, `to`는 `inclusive`. 반개구간 `(from, to]`가 `git log A..B`와 같은 의미이기 위한 조건이며, 앵커 유형과 무관하다.

`SEQUENCE_SPACE_MISMATCH`는 앵커가 요청의 `(repository, base_branch)`와 **다른 공간에 속할 때** 낸다 — 예를 들어 `#1234`의 `base_ref`가 요청의 `base_branch`와 다를 때다. 같은 브랜치 위에 있으나 first-parent 체인 밖인 커밋은 이것이 아니라 `ANCHOR_NOT_ON_BRANCH`다.

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

### API-SEQ-006 시퀀스 공간 목록 (CR-029, DEV-152)

- 목적: W-004·W-005의 시퀀스 공간 선택기(C-027)를 채운다 — 사용자의 접근 범위 안에 있는 등록 저장소와 그 시퀀스 대상 브랜치, 브랜치별 현재 에폭·상태를 준다.
- 관련 요구사항: FR-SEQ-001 (시퀀스 공간의 정의), W-004-SPACE
- 신설 사유: 저장소 목록이 관리자 게이트(`/admin/repositories`)에만 있어 일반 사용자가 셀렉터를 채울 수 없었다 (DEV-152). 접근 범위 강제 필터를 지나므로 범위 밖 저장소의 존재는 드러나지 않는다 (ADR-008·THR-004와 같은 원칙).

응답:

```json
GET /api/v1/sequence-spaces
{
  "spaces": [
    {
      "repository": "acme/payments",
      "repository_id": 2101,
      "base_branch": "main",
      "sequence_space": "acme/payments@main",
      "seq_epoch": 3,
      "sequence_state": "ok"
    }
  ],
  "correlation_id": "..."
}
```

- `sequence_state`는 `ok | stale | reassigning | unknown` — C-027의 `state` prop과 같은 집합이다 (WP-022가 정의).
- 채번된 적 없는 브랜치(공간 행 부재)는 `sequence_state: "unknown"` + `seq_epoch: null`로 싣는다 — 목록에서 숨기면 사용자가 등록 부재로 오인한다 (숨기지 않는다 원칙).
- 정렬은 `repository`, `base_branch` 오름차순. 페이지네이션 없음 — 등록 저장소는 운영상 수백 규모다 (FR-ING-009의 등록 모델).

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

#### 판정과 실패의 근거 (CR-028)

- **포함 판정의 정본은 PostgreSQL `release` 표다** (DEV-142). 같은 시퀀스 공간에서 `target.merge_seq <= release.merge_seq`인 릴리스가 포함 릴리스다 (FR-REL-002 AC-5). `prs-releases`는 투영이며 이 API는 그것을 읽지 않는다 — 색인 반영 실패가 포함 목록을 조용히 줄이면 안 된다.
- **릴리스 미수집은 오류가 아니라 상태다** (DEV-146). FR-REL-002 예외 처리가 "빈 배열과 사유 코드를 **함께** 반환한다"고 정하므로, 이 API는 릴리스가 하나도 수집되지 않은 저장소에 **200** + `releases: []` + `reason: "release_not_indexed"`를 낸다. 6장의 `RELEASE_NOT_INDEXED`(404)는 릴리스 **자체**를 대상으로 지목하는 조회(API-SEQ-003의 릴리스 앵커 등)에서 그 릴리스가 없을 때의 코드다 — 대상이 다르다.
- 대상이 미머지 PR이거나 체인 밖 커밋이면 서수가 없어 판정할 수 없다 — `merge_seq: null` + `releases: []`에 사유를 싣는다. 미배포(`unreleased: true`)와는 다른 상태다: 미배포는 "판정했고 없는 것", 이쪽은 "판정할 기준이 없는 것"이다.
- `pending_pull_request_count`는 정본 `merge_sequence`에서 센다 — 마지막 릴리스 서수보다 큰 `pull_request_number IS NOT NULL` 행 수다 (AC-4).

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

### API-AUTH-001 현재 사용자

- 목적: 세션의 주인이 누구이고, 무엇을 볼 수 있는지 한 번에 알려 준다.
- 관련 요구사항: FR-AUTH-001, FR-AUTH-002
- 관련 화면: 없음 (셸이 역할 기반 내비게이션 필터링에 쓴다 — WP-015)

요청: `GET /api/v1/me`

응답 200:

```json
{
  "user_id": "8f2b1c40-5d7a-4a11-9f3e-6c0d2b8a7e51",
  "login": "kim",
  "email": "kim@acme.example",
  "roles": ["developer", "operator"],
  "access_scope": {
    "scope_kind": "explicit",
    "repository_count": 128,
    "org_count": 1,
    "team_count": 6,
    "refreshed_at": "2026-08-21T09:14:02.000Z"
  },
  "session": {
    "issued_at": "2026-08-21T08:55:00.000Z",
    "idle_expires_at": "2026-08-21T17:14:02.000Z",
    "absolute_expires_at": "2026-08-21T20:55:00.000Z"
  },
  "correlation_id": "01J9Z..."
}
```

- 오류: 401 `UNAUTHENTICATED` (세션 없음·만료), 503 `PERMISSION_UNAVAILABLE` (접근 범위 조회 실패)
- Authz: 인증만 필요하다. 역할 검사는 없다 — 자기 자신을 보는 것이므로
- **`access_scope`는 요약이다. 저장소 ID 목록을 싣지 않는다 (CR-015, DEV-040).** 접근 범위가 500개를 넘는 사용자에서 응답이 수십 KB가 되고, 그 목록은 조직의 저장소 인벤토리 그 자체다. 화면은 건수만 필요하다
- `scope_kind`가 `org_team`이면 `repository_count`는 `null`이다 — 그 모드는 저장소를 세지 않고 조직·팀 조건으로 치환하기 때문이다 (FR-AUTH-002 AC-6)
- `roles`는 IdP 그룹 매핑(`manager`, `qa`)과 DB 지정(`operator`, `release_manager`, `security_officer`)의 합집합에 `developer`를 더한 것이다 (CR-015, DEV-049)
- **접근 범위 조회에 실패하면 부분 응답을 내지 않는다.** `access_scope`를 비우고 200을 주면 화면이 "볼 수 있는 저장소가 없다"로 읽는다. 503이어야 FLOW-000 5단계의 `permission_unavailable` 상태가 성립한다 (FR-AUTH-002 AC-3)

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

### API-ADM-001 저장소 등록 관리

- 목적: 수집 대상 저장소를 등록·변경·해제한다.
- 관련 요구사항: FR-ING-009
- 관련 화면: A-002 (WP-040)

요청 (목록): `GET /api/v1/admin/repositories?status=active&limit=50&offset=0`

응답 200:

```json
{
  "items": [
    {
      "repository_id": 4021,
      "owner": "acme",
      "name": "payments",
      "org_id": 77,
      "visibility": "internal",
      "sequence_branches": ["main", "release/2026.08"],
      "mirror_enabled": true,
      "status": "active",
      "registered_at": "2026-08-20T11:02:41.000Z"
    }
  ],
  "total": 1
}
```

요청 (등록): `POST /api/v1/admin/repositories`

```json
{
  "owner": "acme",
  "name": "payments",
  "sequence_branches": ["main"],
  "mirror_enabled": true,
  "backfill": true
}
```

- `owner`·`name`이 진실의 출처다. `repository_id`·`org_id`·`visibility`는 **GHE에 물어서 채운다** — 클라이언트가 보낸 값을 믿지 않는다 (CR-013, DEV-033)
- `sequence_branches`는 최대 10개다. 초과 시 400 `BRANCH_LIMIT_EXCEEDED` (AC-2)
- `backfill: true`면 `job` 행을 `type: 'backfill'`, `state: 'queued'`로 넣는다. 실행은 `batch` 워커를 세우는 WP-019부터다 (CR-013, DEV-031)

응답 201: 등록된 저장소 객체. 이미 있으면 200과 갱신된 객체.

요청 (변경): `PATCH /api/v1/admin/repositories/{repository_id}` — `sequence_branches`, `mirror_enabled`만 바꾼다. 소유자·이름·가시성은 GHE가 소유한 값이라 여기서 바꾸지 않는다.

요청 (해제): `DELETE /api/v1/admin/repositories/{repository_id}`

응답 200:

```json
{ "repository_id": 4021, "status": "archived", "documents_marked": 1284 }
```

- **문서를 지우지 않는다.** `status = 'archived'`로 바꾸고 이미 색인된 PR·커밋 문서에 `repository_archived: true`를 표시한다 (AC-3). `documents_marked`는 그렇게 표시된 문서 수다
- 해제 이후의 웹훅 이벤트는 원본만 보관하고 투영하지 않는다 (AC-4, FR-ING-005 예외 처리)

- 오류: 400 `BRANCH_LIMIT_EXCEEDED`, 400 `INVALID_PARAMETER`, 401 `UNAUTHENTICATED`, **403 `FORBIDDEN_ROLE`** (등록 대상에 접근 권한이 없음 — 응답 `detail.required_permissions`에 필요한 권한을 담는다), 404 `NOT_FOUND`
- 등록·변경·해제는 모두 감사 기록 대상이다 (AC-5). 기록되는 주체는 요청에 쓰인 관리 토큰의 이름이다 (CR-013, DEV-030)

### API-ADM-002 잡 실행·중단·진행률

- 목적: 백필을 비롯한 배치 잡을 실행·중단하고 진행률을 읽는다.
- 관련 요구사항: FR-ADMIN-002, FR-ING-006
- Authz: `operator`

**실행 지시는 이벤트가 아니라 `job` 행이다 (CR-022, DEV-101).** API가 행을 만들고 배치 워커가 그것을 원자적으로 claim한다. 이벤트로 나르지 않는 이유는 동시 실행 상한(AC-6)을 어차피 DB에서 강제해야 하기 때문이다 — 둘을 함께 쓰면 진실이 둘이 되어 상한이 새어 나간다.

#### `GET /api/v1/admin/jobs`

- 질의: `type` (optional), `state` (optional), `limit` (기본 20, 최대 100)

```json
{
  "items": [
    {
      "job_id": 88,
      "type": "backfill",
      "target": "acme/payments",
      "state": "running",
      "progress": { "done": 1200, "total": 4310, "unit": "pull_request" },
      "requested_by": "alice",
      "started_at": "2026-08-22T09:00:00Z",
      "finished_at": null,
      "error": null
    }
  ],
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

**`cursor`는 내보내지 않는다.** 재개 지점은 워커의 내부 상태이고, 운영자가 그것을 읽을 이유가 없다 — 읽을 수 있으면 고치고 싶어지고, 고치면 재개가 무엇을 이어받는지 아무도 보장하지 못한다.

**한도 대기는 `state`가 아니라 `progress`에 나타난다 (CR-022, DEV-104).** API 한도가 소진되면 잡은 `running`을 유지한 채 `progress.waiting_until`에 회복 시각(RFC3339)을 싣는다. `paused`는 **운영자가 멈춘 것만** 뜻한다 — 둘을 한 상태로 섞으면 자동 재개가 운영자의 중단까지 되살린다.

#### `POST /api/v1/admin/jobs`

```json
{ "type": "backfill", "target": "acme/payments" }
```

- 응답 201: `{ "job_id": 88, "state": "queued", "correlation_id": "..." }`
- 오류: **`JOB_CONFLICT`** (409) — 같은 `(type, target)`에 활성 잡이 이미 있다. 부분 유니크 인덱스가 DB에서 강제하므로 경합에서도 둘이 뜨지 않는다
- 오류: `NOT_FOUND` (404) — 등록되지 않은 저장소. **잡을 만들어 두지 않는다**: 만들면 워커가 잡을 때마다 실패하고 운영자는 원인이 미등록임을 알 수 없다
- 오류: `INVALID_PARAMETER` (400) — 알 수 없는 `type`

**상한을 초과해도 `POST`는 거절하지 않는다.** 큐에 넣고 `queued`로 둔다 — 상한은 *동시에 도는 수*의 제약이지 *요청받을 수 있는 수*의 제약이 아니다(AC-6). 넷째 요청을 400으로 막으면 운영자가 앞의 셋이 끝날 때까지 지켜보다 다시 눌러야 한다.

#### `PATCH /api/v1/admin/jobs/{job_id}`

```json
{ "action": "cancel" }
```

- `action`: `cancel` | `pause` | `resume` — **이 셋만 받는다** (CR-022, DEV-103). 진행률·커서·상태를 직접 쓰는 필드는 두지 않는다
- 응답 200: 갱신된 잡 1건
- 오류: `INVALID_PARAMETER` (400) — 현재 상태에서 불가능한 전이(예: `completed`를 `resume`). **현재 상태를 `detail`에 함께 싣는다** — 운영자가 왜 안 되는지 알아야 다음 행동을 고른다
- 오류: `NOT_FOUND` (404)

전이 규칙: `queued`·`running` → `pause`/`cancel`, `paused` → `resume`/`cancel`. 종료 상태(`completed`·`failed`·`cancelled`)는 어느 것도 받지 않는다 — 끝난 잡을 되살리는 것은 **새 잡**이지 전이가 아니다.

### API-ADM-006 파이프라인 상태

- 목적: 수집 파이프라인의 건강 상태를 한 번에 조회한다.
- 관련 요구사항: FR-ADMIN-001
- 관련 화면: A-001

요청: `GET /api/v1/admin/pipeline-status`

응답 200:

```json
{
  "generated_at": "2026-08-20T11:31:07.000Z",
  "intake_per_minute": 42,
  "queue_depth": { "prs:ingest": 12, "prs:enriched": 3, "prs:projected": 0 },
  "ingestion_lag_seconds": { "p50": 1.8, "p95": 6.4 },
  "stage_latency_seconds": { "enrich": "unavailable", "project": "unavailable" },
  "dead_letter": { "pending": 2, "reprocessing": 0, "held": 1, "resolved": 40 },
  "enrichment_pending": 7,
  "slowest_repositories": [
    { "repository_id": 4021, "repository": "acme/payments", "lag_p95_seconds": 9.2, "sample_count": 118 }
  ],
  "slowest_repositories_out_of_scope": 3,
  "unavailable": ["stage_latency_seconds"]
}
```

- **데이터 신선도는 요청 시점이다** (AC-2의 30초 이내를 만족한다). 캐시하지 않고 PostgreSQL·Redis·Elasticsearch에 그때 물어본다
- `ingestion_lag_seconds`는 `raw_event.processed_at − received_at`의 백분위다. 최근 1시간 표본을 쓴다
- `slowest_repositories`는 같은 표본을 저장소로 묶은 상위 10개다 (AC-3). **요청자의 접근 범위 안 저장소만 식별해서 싣는다 (CR-024, DEV-051).** 상위 10개를 먼저 고른 뒤 범위 밖 항목을 걷어 내며, 걷어 낸 개수를 `slowest_repositories_out_of_scope`에 담는다 — 순서를 뒤집어 "범위 안에서 상위 10개"를 고르면 조회자는 자기가 못 보는 더 느린 저장소가 있다는 사실 자체를 알 수 없게 된다
- `slowest_repositories_out_of_scope`는 **건수만** 담는다. 저장소 ID·이름·지연 값 어느 것도 담지 않는다. 이 값이 있어야 조회자가 "느린 저장소가 없다"와 "내가 볼 수 없다"를 구분한다. 목록이 비고 이 값이 0이 아니면 A-001은 그 사실을 화면에 적는다
- **나머지 집계 수치는 접근 범위를 거치지 않는다 (CR-024, DEV-051).** `intake_per_minute`·`queue_depth`·`ingestion_lag_seconds`·`dead_letter`·`enrichment_pending`은 조직 전체 값이며, FR-AUTH-002 AC-5의 명시적 예외로 SRS에 기록되어 있다. 저장소를 지목하지 않으므로 THR-003이 막으려는 저장소별 활동량 추론이 성립하지 않는다. 아키텍처 테스트의 허용 목록은 **이 두 갈래를 구분해서** 유지한다 — 새로 들어오는 전역 집계가 저장소 식별자를 담으면 통과시키지 않는다
- **`stage_latency_seconds`는 조건부다 (CR-013, DEV-029).** 단계별 지연은 워커 프로세스의 히스토그램에만 있고 `search-api`가 읽을 수 없다. 지표 저장소(사내 Prometheus 호환)가 `METRICS_QUERY_URL`로 설정되어 있으면 질의해서 채우고, 없으면 `"unavailable"`로 둔다 — FR-ADMIN-001 예외 처리가 정한 "해당 항목만 미확인" 형태다. **워커 복제본 하나를 긁어 클러스터 전체인 양 내놓지 않는다**
- `unavailable` 배열은 이번 응답에서 값을 채우지 못한 항목 이름을 담는다. 조회에 실패한 항목도 여기 들어가고 나머지는 정상 반환된다
- 시퀀스 공간 상태 요약은 WP-021 이후에 더한다

### API-ADM-003 실패 대기열 조회와 재처리

- 목적: 격리된 실패 이벤트를 보고 다시 파이프라인에 투입한다.
- 관련 요구사항: FR-ING-007
- 관련 화면: A-001 (`A-001-DLQ`)

요청 (조회): `GET /api/v1/admin/dead-letters?state=pending&stage=project&repository_id=4021&limit=50&offset=0`

- `state` (optional): `pending` | `reprocessing` | `held` | `resolved`. 생략하면 `resolved`를 뺀 전부
- `stage` (optional): `enrich` | `project` | `sequence` | `link`
- `repository_id` (optional): 저장소 한정
- `limit` (optional, 기본 50, 최대 200), `offset` (optional, 기본 0)

응답 200:

```json
{
  "items": [
    {
      "dead_letter_id": "812",
      "delivery_id": "72d1e0f3-a4b5-4c6d-8e7f-90a1b2c3d4e5",
      "stage": "project",
      "repository_id": 4021,
      "error": "mapping_rejected: unknown field [patch]",
      "retry_count": 5,
      "reprocess_count": 1,
      "state": "pending",
      "created_at": "2026-08-20T11:02:41.000Z",
      "updated_at": "2026-08-20T11:31:07.000Z"
    }
  ],
  "total": 1,
  "counts_by_state": { "pending": 1, "reprocessing": 0, "held": 0, "resolved": 12 }
}
```

요청 (재처리):

```json
POST /api/v1/admin/dead-letters/reprocess
{
  "dead_letter_ids": ["812", "813"],
  "confirmation": null
}
```

- 개별은 `dead_letter_ids`에 한 건, 일괄은 여러 건을 넣는다. 필터로 한 번에 고르려면 `filter: { state, stage, repository_id }`를 대신 보낸다
- 1회 상한은 500건이다. 초과하면 400 `RANGE_TOO_LARGE`
- **대상이 100건을 넘으면 `confirmation`에 대상 건수를 문자열로 정확히 넣어야 한다** (QA-A001-05). 불일치·누락은 400 `CONFIRMATION_MISMATCH`
- `state: 'held'`는 자동 선택 대상이 아니다. `dead_letter_ids`로 명시할 때만 재처리한다 (FR-ING-007 예외 처리)

응답 202:

```json
{
  "requested": 2,
  "reinjected": 2,
  "skipped": [],
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

- `skipped`에는 원본이 남아 있지 않은 항목이 `{ dead_letter_id, reason: "raw_event_missing" }`로 들어간다. 원본 보존 기간(3년)을 넘겼거나 파티션이 드롭된 경우다
- 재투입 지점은 실패 단계와 무관하게 항상 `prs:ingest`다. 중간 이벤트는 보존되지 않으며 멱등 규칙(FR-ING-002)이 중복 문서를 막는다
- 재처리한 행은 `state: 'reprocessing'`이 된다. 다시 실패하면 `reprocess_count`가 오르고 3회에 닿으면 `held`, 끝까지 성공하면 투영이 `resolved`로 닫는다

**인증 (CR-012, DEV-025).** 이 API의 최종 권한은 `operator` 역할이며 그 판정은 WP-012의 OIDC 세션이 세운다. WP-012 이전(REL-001)에는 조직에 사용자 신원 자체가 없으므로, 그 사이의 임시 통제로 공유 토큰(`ADMIN_API_TOKEN`, `Authorization: Bearer`)을 요구한다. **토큰이 설정되지 않으면 이 경로들을 아예 등록하지 않는다** — 인증 수단 없이 열린 변경 API를 두는 것보다 없는 편이 낫다. 토큰 불일치는 401 `UNAUTHENTICATED`다. WP-012가 역할 판정을 세우면 이 통제는 대체된다. **인계 방법 (CR-015, DEV-048): OIDC가 구성되면 `/admin/*`의 통제는 세션 + `operator` 역할이고, 이름 붙은 토큰 경로는 OIDC가 구성되지 않은 경우에만 등록된다.** 둘은 배타다 — 두 구성이 함께 주어지면 기동에서 거부한다. 실제 세션 옆에 역할 검사를 우회하는 토큰 문이 열린 채로 배포되는 것이 이 통제가 막으려던 바로 그 상황이기 때문이다.

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
| `INVALID_PARAMETER` | 400 | 요청 파라미터·본문이 형식에 맞지 않음 | 요청 형식 확인 |
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
| `GH_CAPABILITY_UNKNOWN` | 404 | manifest에 없는 capability | 레지스트리 상태 확인 |
| `GH_CONSTRAINT_VIOLATION` | 400 | argument·flag 제약 위반 | 충돌·의존 관계 수정 |
| `GH_IDENTITY_REQUIRED` | 401 | Operations App 미연결·토큰 만료 | GitHub 계정 연결 |
| `GH_PERMISSION_DENIED` | 403 | 사용자 GitHub 권한 부족 | 필요 권한 요청 |
| `GH_POLICY_BLOCKED` | 403 | 실행 정책이 차단한 capability | 관리자에게 문의 |
| `GH_ENDPOINT_BLOCKED` | 403 | `gh api` 엔드포인트 정책 차단 | 허용된 엔드포인트 사용 |
| `GH_EXTENSION_BLOCKED` | 403 | 허용 목록에 없는 확장 | 관리자 승인 요청 |
| `GH_HOST_UNSUPPORTED` | 409 | 대상 GHE 버전이 미지원 | 지원되는 기능 사용 |
| `GH_REGISTRY_STALE` | 409 | 실행기 gh 버전과 manifest 불일치 | 관리자 조치 대기 |
| `GH_CONFIRMATION_REQUIRED` | 409 | 위험도에 따른 확인 미수행 | 확인 후 재요청 |
| `GH_APPROVAL_REQUIRED` | 409 | 승인자 승인 대기 | 승인 후 자동 진행 |
| `GH_TARGET_CHANGED` | 409 | 실행 직전 대상 상태가 변경됨 | 새로 고침 후 재확인 |
| `GH_DUPLICATE_REQUEST` | 409 | 동일 중복 방지 키의 재요청 | 기존 실행 확인 |
| `GH_RESOURCE_LOCKED` | 409 | 같은 대상에 상충 작업 진행 중 | 완료 후 재시도 |
| `GH_EXECUTION_TIMEOUT` | 504 | 실행 시간 상한 초과 | 범위를 줄여 재시도 |
| `GH_WORKSPACE_UNAVAILABLE` | 503 | 임시 작업 공간 확보 실패 | 잠시 후 재시도 |

## 7. 내부 이벤트 계약

이 제품에는 클라이언트로 가는 실시간 푸시 채널이 없다 (시스템 아키텍처 10장). 아래는 서비스 내부 이벤트 버스 계약이다.

| Event ID | Event Name | Producer | Consumer | Payload | Ordering/Dedupe |
| --- | --- | --- | --- | --- | --- |
| EVT-ING-001 | `ingestion.event_received` | ingest-gateway | enrich 워커 | `{ delivery_id, event_type, action, repository_id, correlation_id }` | 파티션 키 `repository_id`. 멱등 키 `delivery_id` |
| EVT-ING-002 | `ingestion.enriched` | enrich 워커 | project 워커 | self-contained bounded (CR-010) — `{ delivery_id, repository_id, entity_kind, pr_number, pull_request, source_commit_shas[], changed_files[], reviews[], source_commits_truncated, files_truncated, enrichment_pending, enrichment_errors[], correlation_id }`. 타입은 `@prs/domain`의 `IngestionEnriched` | 위와 동일 |
| EVT-ING-003 | `ingestion.projected` | project 워커 | link 워커 | `{ repository_id, entity_kind, entity_id, document_version }` | 위와 동일 |
| EVT-ING-004 | `ingestion.failed` | 모든 워커 | ops 모듈 | `{ delivery_id, stage, error, retry_count }` | 멱등 키 `(delivery_id, stage)` |
| EVT-SEQ-001 | `sequence.assigned` | sequence 워커 | project 워커 | `{ repository_id, base_branch, seq_epoch, from_seq, to_seq }` | 시퀀스 공간별 직렬 |
| EVT-SEQ-002 | `sequence.reassigned` | sequence 워커 | project 워커, 알림 | `{ repository_id, base_branch, old_epoch, new_epoch, from_seq }` | 시퀀스 공간별 직렬 |
| EVT-AUTH-001 | `permission.invalidated` | ingest-gateway | authz 모듈 | `{ user_ids[], team_id, repository_id, reason }` (CR-015, DEV-041 — 비동기 문서 4장과 일치시켰다. `team` 웹훅은 팀 전원에 영향을 주는데 게이트웨이가 수신 경로 안에서 팀을 구성원으로 펼치면 GHE 동기 호출이 들어가 NFR-002의 수신 p95 300ms가 무너진다. 셋 다 선택이며 하나 이상이 있어야 한다) | 멱등 (집합 연산) |
| EVT-JOB-001 | `job.progress` | 모든 배치 워커 | ops 모듈 | `{ job_id, type, target, state, progress }` | 최신 값 우선 |

이벤트 이름은 `<도메인>.<행위>` 규칙을 따른다 (glossary 3장).

## 8. 계약 안정성

| API | 상태 | 변경 정책 |
| --- | --- | --- |
| API-SRCH-001~004, API-SEQ-001~003, API-SEQ-006, API-REL-001~002 | stable | 하위 호환만. 필드 제거·의미 변경은 `/api/v2` |
| API-STAT-001~004, API-SEQ-004~005, API-REL-003~004 | stable | 위와 동일 |
| API-ADM-* | internal | 운영 콘솔 전용. 프런트엔드와 동시 배포 전제로 변경 가능 |
| API-ING-001 | external | GHE 계약. 변경 시 웹훅 재등록 필요 |

버전 정책: 경로 접두 `/api/v1`. 하위 호환 변경(필드 추가, 새 enum 값에 대한 관대한 처리)은 버전을 올리지 않는다. 필드 제거·타입 변경·의미 변경은 `/api/v2`를 신설하고 최소 1개 릴리스 동안 병행 운영한다.
