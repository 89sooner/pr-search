# PR Search API 계약

> 상태: review | 버전: v0.15 | 갱신일: 2026-08-29

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
| API-SRCH-005 | GET/POST/PATCH/DELETE | `/saved-searches[/{id}]`, `/saved-searches/{id}/run`, `/saved-searches/share-targets` | 저장된 검색 관리 — 목록(커서)·생성·수정·삭제·실행 준비·공유 대상 (CR-049, DEV-333) | 인증 | FR-SRCH-010 |
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
| API-REL-005 | GET | `/releases` | 저장소 릴리스 목록 (CR-030, DEV-155) | 인증 + 접근 범위 | FR-SEQ-004, FR-REL-002 |
| API-REL-006 | GET | `/relations` | 저장된 관계 간선 조회 (정방향·역방향) (CR-042, DEV-248) | 인증 + 접근 범위 | FR-REL-003, FR-REL-004, FR-REL-005, FR-REL-006 |
| API-STAT-001 | POST | `/analytics/groups` | 그룹 집계 | 인증 + 접근 범위 | FR-STAT-001, FR-STAT-006 |
| API-STAT-002 | POST | `/analytics/time-series` | 시계열 집계 | 인증 + 접근 범위 | FR-STAT-002 |
| API-STAT-003 | POST | `/analytics/percentiles` | 리드타임·리뷰 대기 백분위 | 인증 + 접근 범위 | FR-STAT-003, FR-STAT-004 |
| API-STAT-004 | POST | `/analytics/distributions` | 변경 규모 분포 | 인증 + 접근 범위 | FR-STAT-005 |
| API-AUTH-001 | GET | `/me` | 현재 사용자, 역할, 접근 범위 요약 | 인증 | FR-AUTH-001, FR-AUTH-002 |
| API-ING-001 | POST | `/webhooks/github` | GHE 웹훅 수신 | HMAC 서명 | FR-ING-001, FR-ING-002 |
| API-ING-002 | GET | `/repositories` | 저장소 수집 진단 조회 — W-009. **`/admin` 아래가 아니다** (CR-050, DEV-350) | 인증 + 접근 범위 | FR-ING-006, FR-ING-009, FR-ING-011, FR-SEQ-001, FR-SEQ-005 |
| API-ING-003 | POST | `/repository-registration-requests` | 등록 검토 요청 기록. 등록하지 않고 실재 여부도 확인하지 않는다 (CR-050, DEV-351) | 인증 | FR-ING-009 |
| API-ADM-001 | GET/POST/PATCH/DELETE | `/admin/repositories[/{id}]` | 저장소 등록 관리 | `operator` | FR-ING-009 |
| API-ADM-002 | GET/POST/PATCH | `/admin/jobs[/{id}]` | 잡 실행·중단·진행률 | `operator` | FR-ADMIN-002, FR-ING-006, FR-ING-008 |
| API-ADM-003 | GET/POST | `/admin/dead-letters[/reprocess]` | 실패 대기열 조회·재처리 | `operator` | FR-ING-007 |
| API-ADM-004 | POST | `/admin/reindex` | 재색인 실행 | `operator` | FR-ING-008 |
| API-ADM-005 | GET | `/admin/audit-records` | 감사 기록 조회 | `security_officer` | FR-AUTH-004 |
| API-ADM-006 | GET | `/admin/pipeline-status` | 파이프라인 지표 | `operator` | FR-ADMIN-001 |
| API-ADM-007 | GET/POST | `/admin/sequence-integrity` | 정합성 점검·재채번 | `operator` | FR-ADMIN-003, FR-SEQ-005 |
| API-ADM-008 | GET | `/admin/raw-events` | 원본 아카이브 조회 | `operator` 또는 `security_officer` + 접근 범위 | FR-ING-010 |

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

**커밋 문서가 실제로 갖는 것만 응답에 싣는다 (CR-017, DEV-060).** 원래 커밋 문서는 SHA·역할·소속 PR 번호·대상 브랜치만 가졌다 — `EVT-ING-002`가 커밋에 대해 SHA만 나르기 때문이다.

**WP-067이 그 공백을 메웠다 (CR-038, DEV-210).** `JOB-MIR-002`가 채운 `message`·`author`·`committer`·`authored_at`·`committed_at`·`parent_shas`·`changed_paths`·`changed_paths_truncated`·`patch_id`·`patch_id_unavailable`을 이 응답이 **실제로 반환한다.** 채우기만 하고 응답에 잇지 않으면 `/commit/...` 화면은 그대로 SHA만 보인다 — 보강했다는 사실을 사용자가 확인할 길이 없다.

**직접 푸시 커밋도 이 경로로 조회된다 (CR-038, DEV-206).** 그전에는 커밋 문서 자체가 만들어지지 않아 404였고(DEV-061), WP-027이 그 커밋을 선행·후행 목록에 노출하기 시작하면서 **사용자가 볼 수 있는 행이 클릭하면 없는 화면으로 갔다.** JOB-MIR-002가 문서를 만들면서 그 경로가 닫힌다. `role`은 `direct_push`이고 `pull_requests`는 빈 배열이다.

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

**`source_commits`는 커밋 문서와 조인해 채운다 (CR-038, DEV-211).** 원래는 `commit_sha`만 실었다(CR-017, DEV-062) — 커밋 문서를 조인해도 메시지·작성자가 없었기 때문이다. WP-067이 그것을 채우면서 이제 FR-SRCH-003 AC-3이 요구하는 `message`(제목 **첫 줄**)·`author`·`authored_at`이 실린다.

**제목은 첫 줄만이다.** 목록 행에 여러 줄이 들어가면 화면이 무너지고, 전문은 커밋 상세가 준다.

**조회는 한 번이다 — N+1이 아니다.** 최대 250개를 하나씩 물으면 그 비용이 목록 길이에 비례해 사용자에게 그대로 간다. 접근 범위는 이 조인에서도 강제된다(ADR-008) — 같은 저장소라는 것을 알고 있어도 우회 경로를 만들지 않는다.

**아직 보강되지 않은 커밋은 키가 없는 채로 남는다.** 거짓 `null`을 채우지 않는다 — "만들지 않았다"와 "만들었는데 비었다"는 다른 사실이다.

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
    {
      "commit_sha": "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
      "message": "feat: 재시도 백오프를 추가한다",
      "author": "kim",
      "authored_at": "2026-08-18T09:11:02Z"
    },
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

요청: `GET /api/v1/search?q=repo:acme/payments+base:main+seq:1280..1342+-author:bot&sort=merge_seq&order=desc&size=25&facets=true&seq_epoch=3`

**`seq:` 질의는 시퀀스 공간을 지목해야 하고, 그 공간의 에폭이 조회의 일부다** (CR-051, DEV-359). `seq_epoch`은 질의 문법이 아니라 **참조 맥락**이다 — 아래 「시퀀스 인용 계약」 절이 정본이다.

지원 질의 키 (FR-SRCH-005 AC-1): `repo`, `org`, `author`, `team`, `author_team`, `reviewer`, `label`, `base`, `head`, `state`, `merged`, `created`, `seq`, `release`, `path`, `is`, `kind`

**질의 문법 (CR-014).** 파서는 `@prs/query`가 갖고 서버와 클라이언트가 같은 코드를 쓴다 (ADR-001).

| 요소 | 형태 | 비고 |
| --- | --- | --- |
| 동등 | `key:value` | 같은 키 반복은 OR, 다른 키는 AND (AC-5) |
| 부정 | `-key:value` | 범위에도 붙는다 (AC-6) |
| 범위 | `key:a..b` | **`seq`·`merged`·`created` 세 키만** (DEV-037). 양끝이 모두 있어야 한다. **이 셋은 범위 형태로만 성립하며 스칼라는 400이다** (DEV-364) |
| 인용 | `key:"두 낱말"` | `"`와 `\`는 `\`로 escape한다 |
| 전문 검색어 | 키 없는 남은 문자열 | 공백 하나로 이어 붙인다 |

`op` 값은 넷이다 — `eq`, `not_eq`, `range`, **`not_range`** (CR-014, DEV-035). AC-6의 `-`는 문법 수준에서 모든 키에 붙으므로, 범위에만 붙일 수 없게 하면 사용자가 이해할 수 없는 특례가 된다.

**값 검증은 SRS가 값을 열거한 키에만 한다 (DEV-036).** `is`는 AC-1이 `merged`/`open`/`closed`/`reverted`를 명시했으므로 그 밖의 값은 400으로 거절한다. `state`처럼 열거되지 않은 키의 값은 검증하지 않는다 — 없는 제약을 지어내지 않는다.

**`key`가 세 범위 키가 아니면 `..`는 리터럴이다.** `path:src/a..b`는 범위가 아니라 그 문자열을 찾는 조건이다.

**질의 키가 가 닿는 자리 (CR-016, DEV-052).** 파서는 키를 17종으로 알지만 그것이 어느 필드를 보는지는 별개다.

| 키 | 대상 | 비고 |
| --- | --- | --- |
| `repo` | `repository` | `owner/name` 그대로 |
| `org` | `org_id` | **레지스트리 해석** — 문서에 조직 이름이 없다. `repository.owner`로 `org_id`를 찾는다 |
| `author` | `author` | |
| `team` | `allowed_team_ids` | **레지스트리 해석** — `team.slug` → `team_id`. **저장소 접근 권한 팀이다.** 지금은 결과를 내지 못한다 (문서의 팀 ID가 비어 있다) |
| `author_team` | `author_team_ids` | **레지스트리 해석.** **작성자의 소속 팀이며 `team`과 다르다** (CR-053, DEV-382). 집계의 `group_by=team`이 이 필드를 보고 `drill_down_query`도 이 키를 쓴다. 투영이 아직 채우지 않아 결과가 비어 있다 |
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
| `kind` | **문서 유형** | `pull_request` \\| `commit`. 값이 열거되어 있으므로 그 밖은 400이다. 집계의 `drill_down_query`가 모집단을 유지하는 수단이며(CR-053, DEV-383), `is:merged`가 우연히 PR만 남기는 것에 기대지 않는다 — 그 뜻은 "머지된 것"이지 "PR"이 아니다 |

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
  "query": "repo:acme/payments base:main seq:1280..1342 -author:bot",
  "parsed": {
    "filters": [
      { "key": "repo", "op": "eq", "values": ["acme/payments"] },
      { "key": "base", "op": "eq", "values": ["main"] },
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
      "highlight": { "title": [{ "text": "feat: 결제 재시도 로직", "matches": [{ "start": 6, "end": 8 }] }] },
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
  "facets_status": "ready",
  "next_cursor": "eyJzIjpbMTMxOCwiYWNtZS9wYXltZW50czoxMjEwIl0sImYiOiJhOWYzIn0",
  "sequence_context": {
    "sequence_space": "acme/payments@main",
    "repository": "acme/payments",
    "base_branch": "main",
    "seq_epoch": 3,
    "sequence_state": "ok"
  },
  "epoch_stale": false,
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

**`sequence_context`와 `epoch_stale`은 `seq:` 질의에서만 나타난다** (CR-051). `seq:`가 없는 질의는 어느 공간에도 묶이지 않으므로 두 키 다 싣지 않는다 — 빈 값이나 `null`로 실으면 화면이 "공간이 없는 시퀀스 조회"라는 없는 상태를 그린다.

**패싯 세 키는 함께 나타나거나 함께 빠진다** (CR-019 DEV-076 / CR-016 DEV-057, CR-044로 `facets_status` 추가). 네 경우가 서로 다른 뜻이며 **정본 표는 아래 「패싯 계약」 절 하나뿐이다** — 응답 형태를 두 곳에 적으면 구현이 다른 쪽을 보고 만든다.

| 응답 | 뜻 | 화면 |
| --- | --- | --- |
| 세 키 모두 **없음** | 패싯을 **세지 않았다** (요청하지 않았거나 WP-032 전) | 레일에 "아직 분포를 세지 않습니다" |
| `facets` + `facets_omitted: false` + `facets_status: "ready"` | 세었고 생략하지 않았다 | 분포 표시 |
| `facets: {}` + `facets_omitted: true` + `facets_status: "budget_omitted"` | 세려 했으나 **예산을 넘겨 생략했다** (FR-SRCH-009 AC-4) | "이번 조회에서는 생략했습니다" + 재시도 |
| `facets: {}` + `facets_omitted: true` + `facets_status: "failed"` | **계산이 실패했다** (FR-SRCH-009 예외 처리) | 레일에만 실패 표시 + 재시도 |

**생략과 실패는 `facets_status`로만 갈린다** — `facets_omitted`는 둘 다 `true`다. 그 필드는 "분포를 못 받았다"는 사실이고, **왜** 못 받았는지는 새 필드가 말한다. 기존 소비자는 `facets_omitted`만 보아도 깨지지 않는다.

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
      "supported_keys": ["repo","org","author","team","author_team","reviewer","label","base",
                         "head","state","merged","created","seq","release","path","is","kind"]
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

- 오류: `QUERY_SYNTAX_ERROR` (400), `SHA_PREFIX_TOO_SHORT` (400), `CURSOR_INVALID` (400), `CURSOR_QUERY_MISMATCH` (400), `QUERY_TOO_SHORT` (400), **`INVALID_PARAMETER` (400, `seq:` 질의의 공간 지목 실패와 `seq_epoch` 형식 오류 — CR-051)**, **`NOT_FOUND` (404, `seq:`가 지목한 저장소·공간을 확인할 수 없음 — CR-051)**, `SEARCH_TIMEOUT` (504), `PERMISSION_UNAVAILABLE` (503)
- **`seq:` 질의에 새 오류 코드를 만들지 않는다** (CR-051). 부족한 것은 파라미터이고(`INVALID_PARAMETER`), 확인할 수 없는 것은 자원이다(`NOT_FOUND`). `detail.reason`이 무엇이 부족한지를 가른다
- **문법·값 오류는 파서가 낸다** (CR-014, DEV-038). `@prs/query`가 오류 코드와 문자 오프셋을 함께 돌려주고 API는 그대로 실어 보낸다. `QUERY_TOO_SHORT`(전문 검색어 1자)도 파서가 판정한다 — 무엇이 전문 검색어인지 아는 곳이 파서뿐이다
- 페이지네이션: `size` 기본 25, 최대 200 (초과 시 200으로 절삭). `cursor`로 다음 페이지. **오프셋 파라미터는 없다** (공통 원칙 7, ADR-010)
- 정렬: `merge_seq` | `merged_at` | `created_at` | `updated_at` | `changed_files_count` | `additions` | `lead_time_seconds` | `relevance`. 기본 `merge_seq` desc
- **모든 정렬은 문서 ID를 마지막 키로 갖는다** (FR-SRCH-007 AC-4). 동점이 있어도 두 번 조회한 순서가 같다. 그 값은 `_id`가 아니라 **`doc_id` 필드**다 (CR-016, DEV-059) — Elasticsearch 8은 `_id` 정렬을 금지한다. `upsert`가 `_id`와 같은 값을 그 필드에 함께 넣는다
- **`relevance`는 전문 검색이 서기 전까지 문서 ID 순이다** (CR-016, DEV-056). 접근 범위 필터는 `filter` 절이라 점수를 만들지 않으므로 모든 문서의 점수가 같다. 키를 거절하지는 않는다 — AC-1이 지원 키로 열거했다. 실제 점수는 WP-032가 붙인다
- **`facets`와 `next_cursor`는 WP-032 전까지 이렇게 나간다** (CR-016, DEV-057). `next_cursor`는 **항상 `null`**로 실린다(키가 있고 값이 없다 = 다음 페이지가 없다). `facets`는 **키 자체가 없다** — 빈 객체는 "패싯을 셌는데 아무것도 없다"로 읽히기 때문이다

#### 시퀀스 인용 계약 (CR-051, DEV-349를 닫는다)

**시퀀스 서수는 한 공간 안에서만 뜻이 있다** (ADR-007 규칙 1). 그런데 v2.10까지 `seq:` 조건은
어느 공간의 서수인지 말하지 않았고, 접근 범위에 저장소가 여럿이면 **같은 번호가 공간마다 다른
커밋을 가리킨 채 한 목록에 섞였다.**

**이 문제는 이 저장소가 이미 한 번 풀었다.** `API-SEQ-004`가 "`base_branch`는 필수다 — 서버가
시퀀스 공간을 고르지 않는다"로 정한 것이 같은 판단이다 (CR-032, DEV-168). 그 절의 논리를 그대로
옮긴다: 서버가 공간을 고르면 **사용자가 묻지 않은 브랜치의 답**이 나오고, 정렬을 더해도 결정적으로
같은 오답일 뿐이다.

**규칙 1 — `seq:`는 공간을 지목한다.**

`seq:` 범위 조건(`range` 또는 `not_range`)이 있는 질의는 부정이 아닌 `repo:` 값 하나와 부정이 아닌
`base:` 값 하나를 함께 가져야 한다. 같은 값을 여러 번 적은 것은 정규화 뒤 하나로 본다.

| 질의 | 판정 |
| --- | --- |
| `repo:acme/payments base:main seq:1200..1350` | 통과 |
| `repo:acme/payments repo:acme/payments base:main seq:1200..1350` | 통과 (중복은 하나) |
| `repo:acme/payments base:main -seq:1200..1350` | 통과 (부정된 범위도 같은 규칙) |
| `seq:1200..1350` | `INVALID_PARAMETER`, `detail.reason: "sequence_space_required"` |
| `repo:acme/payments seq:1200..1350` | 같음 (`base` 없음) |
| `base:main seq:1200..1350` | 같음 (`repo` 없음) |
| `repo:a/x repo:b/y base:main seq:1200..1350` | `INVALID_PARAMETER`, `detail.reason: "sequence_space_ambiguous"` |
| `repo:a/x base:main base:release seq:1200..1350` | 같음 |

```json
{
  "error": {
    "code": "INVALID_PARAMETER",
    "message": "seq: 조건은 하나의 시퀀스 공간에서만 의미가 있습니다. repo:와 base:를 각각 하나씩 지정하세요.",
    "detail": { "field": "q", "reason": "sequence_space_required", "required_keys": ["repo", "base"] }
  },
  "correlation_id": "..."
}
```

**스칼라 `seq:1234`는 이 규칙의 대상이 아니다** (CR-051, DEV-364). SRS AC-2가 승인한 것은 범위뿐이고,
현재 구현에서 스칼라는 `MATCH_NONE`이 되어 언제나 0건이다. **이 CR을 핑계로 스칼라 기능을 만들지
않는다** — 다만 "조용히 0건"이라는 사실은 원장에 등재돼 있다.

**규칙 2 — 첫 요청이 에폭을 바인딩한다.**

`seq_epoch`이 없는 요청은 **최초 바인딩**이다. 순서가 통제다.

1. `q`를 파싱한다
2. `seq:` 범위 조건이 있는지 본다 — 없으면 아래 전부 건너뛴다
3. 규칙 1로 `repo`·`base`를 확정한다
4. 이 요청의 접근 범위를 **한 번만** 산출한다 (기존 규율, CR-043 DEV-272)
5. `API-SEQ-001`이 쓰는 것과 **같은 해석 경로**로 공간을 확인한다 — 미등록과 범위 밖은 같은 `NOT_FOUND`다
6. 그 공간의 현재 `seq_epoch`을 얻어 **유효 에폭**으로 삼는다
7. Elasticsearch 질의에 `seq_epoch = 유효 에폭`을 결합한다
8. 응답에 `sequence_context`를 싣는다

화면은 그 값을 URL에 기록한다. **그 순간부터 그 주소는 어느 세대의 서수를 뜻했는지를 들고 다닌다**
(ADR-007 규칙 5의 "공유 URL").

**규칙 3 — 에폭이 다르면 실행하지 않는다.**

요청한 `seq_epoch`이 현재와 다르면 HTTP **200**이되 조회를 실행하지 않는다. `API-SEQ-001`의
선례를 그대로 따른다.

```json
{
  "query": "repo:acme/payments base:main seq:1280..1342",
  "sequence_context": {
    "sequence_space": "acme/payments@main",
    "repository": "acme/payments",
    "base_branch": "main",
    "seq_epoch": 4,
    "sequence_state": "ok"
  },
  "requested_seq_epoch": 3,
  "epoch_stale": true,
  "next_cursor": null,
  "correlation_id": "..."
}
```

**`items`·`total`·`facets`·`relaxation_hints` 키를 넣지 않는다.** 실행하지 않은 것을 `items: []`,
`total: 0`으로 표현하면 그것은 "구간이 비었다"는 거짓말이다 — `API-SEQ-001`이 같은 이유로 같은
결정을 했다.

**현재 에폭으로 자동 이동하지 않는다.** 그것이 ADR-007이 막으려는 바로 그 동작이며, 사용자가
「현재 에폭으로 다시 조회」를 눌러 `seq_epoch`을 바꿀 때에만 새 세대의 결과가 나온다.

**규칙 4 — 에폭은 결과 집합의 일부다.**

`seq:` 질의의 실제 조건은 개념적으로 넷이다.

```text
repository   = 지목된 저장소 하나
base_branch  = 지목된 브랜치 하나
seq_epoch    = 유효 에폭
merge_seq    ∈ 요청 범위
```

앞의 둘은 이미 `q`가 만든다. **새로 결합되는 것은 `seq_epoch`이며 PR·커밋 두 인덱스에 똑같이
적용된다.** 재채번 도중에는 옛 세대와 새 세대의 문서가 잠시 함께 있을 수 있고, 그때 필터가 없으면
한 목록에 두 세대가 섞인다.

**목록과 패싯이 같은 에폭을 본다.** 패싯은 별도 요청이지만 같은 결과 집합의 분포이므로, 목록이
에폭 3이고 버킷이 에폭 4까지 세면 그 수는 아무 집합도 뜻하지 않는다 (QA-W001-16과 같은 규율).

**규칙 5 — 에폭은 커서 정체성의 일부다.**

`seq_epoch`은 `q` 밖의 파라미터라 지문에 넣지 않으면 **질의가 같고 에폭만 다른 두 조회가 같은
지문을 갖는다.** 그래서 유효 에폭을 지문 재료에 더한다.

| 질의 | 지문에 실리는 시퀀스 재료 |
| --- | --- |
| `seq:` 없음 | 없음 |
| `seq:` 있음 | 유효 에폭 |

첫 요청에 `seq_epoch`이 없어도 6단계에서 유효 에폭이 확정된 **뒤에** 지문을 만든다. 그래서 첫
페이지의 커서부터 이미 에폭에 묶인다. 에폭 3의 커서를 에폭 4 조회에 쓰면 `CURSOR_QUERY_MISMATCH`다.

**PIT과 혼동하지 않는다.** PIT은 색인 뷰를 고정하지 그 서수가 무엇을 뜻하는지를 고정하지 않는다.
두 장치는 다른 것을 지킨다.

**규칙 6 — 공간을 확인할 수 없으면 존재를 알리지 않는다.**

규칙 1을 만족해도 저장소가 미등록이거나, 접근 범위 밖이거나, 그 브랜치가 채번된 적이 없을 수 있다.
셋을 구분해 답하지 않는다 — `API-SEQ-001`이 이미 같은 이유로 셋을 `NOT_FOUND` 하나로 묶었다
(CR-027, DEV-137 / THR-006). **새로운 존재 신탁을 만들지 않는다.**

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "이 seq: 조건을 해석할 시퀀스 공간을 확인할 수 없습니다."
  },
  "correlation_id": "..."
}
```

화면은 여기서 W-009 저장소 개요로 가는 진단 링크를 제시할 수 있다. 그 화면 역시 같은 규칙으로
미등록과 범위 밖을 구분하지 않는다 (FR-ING-009 AC-10).

**규칙 7 — `seq_epoch` 파라미터의 형식.**

정수이며 1 이상이어야 한다. 아니면 `INVALID_PARAMETER`(`detail.field: "seq_epoch"`)다.
**형식 오류를 "지정하지 않음"으로 읽지 않는다** (DEV-363) — 오타 하나가 조용히 현재 에폭 조회로
흘러가면 그것이 이 CR이 막으려는 실패다.

**"없음"은 파라미터가 정말로 없을 때뿐이다.** `seq_epoch=`(빈 값)이나 같은 이름을 두 번 적어
배열이 된 경우도 거절한다 — 값이 **있으면서** 해석되지 않는 것을 "지정하지 않음"으로 접으면
형식 오류를 `null`로 접던 것과 같은 실패를 이름만 바꿔 되풀이한다.

**화면도 이 값을 미리 걸러 내지 않는다.** 붙여넣은 주소의 `seq_epoch=abc`를 클라이언트가 `null`로
접으면 그 파라미터가 요청에서 사라지고, 서버는 거절할 기회 없이 현재 세대로 바인딩한다 —
**화면의 관대함이 서버의 엄격함을 무력화하는 자리다.** 판정은 서버 한 곳에서 한다.

`q`에 `seq:` 범위 조건이 없는데 `seq_epoch`만 있으면 거절한다. 뜻이 없는 파라미터를 조용히 무시하면
화면이 그것을 계속 보내고, 나중에 그 값이 뜻을 갖게 되는 날 아무도 그 자리를 다시 보지 않는다.

**`sequence_state`는 조회를 막지 않는다.** 공간이 `stale`·`reassigning`이어도 에폭이 일치하면
"마지막으로 확정된 값"으로 답한다 (기존 시퀀스 계약과 같다). 화면은 그 상태를 값과 함께 보인다 —
숨기지 않는다.

#### 커서 계약 (CR-043, WP-032가 구현한다)

ADR-010은 커서의 **재료**(정렬 키 값 + 질의 지문)와 **동률 처리**(문서 ID를 마지막 키로)를 이미 정했다. 여기서 정하는 것은 그 아래층 — **봉인 방식·지문의 입력·실패의 갈래·색인 스냅숏**이다.

**커서 봉투는 버전·무결성·만료를 갖는다.** 계약의 예시 커서는 base64 JSON이고, 그것만으로는 사용자가 `s`(정렬 키 값)를 임의로 고쳐 **정상 커서처럼** 만들 수 있다. 접근 통제가 깨지지는 않는다 — 강제 필터는 질의 시점에 다시 걸린다 — 그러나 서버는 자기가 발급하지 않은 위치를 자기가 발급한 것처럼 신뢰하게 된다. 봉투는 다음을 싣는다.

| 항목 | 뜻 |
| --- | --- |
| `v` | 커서 스키마 버전. 모르는 버전은 `CURSOR_INVALID`다 |
| `p` | Point In Time 식별자 (아래) |
| `s` | `search_after`에 넘길 정렬 키 값 배열 |
| `f` | 질의 지문 (아래) |
| `x` | 만료 시각 |

무결성은 **HMAC-SHA256** 한 겹으로 충분하다. 전용 서명 키를 쓰고 상수 시간 비교로 검증한다. **새 범용 crypto 추상을 만들지 않는다** — 이 저장소의 기존 서명 자리(`ingest-gateway`의 웹훅 HMAC, `@prs/authz`의 세션·PKCE)는 각자의 목적에 묶여 있고, 커서에 그것을 재사용하면 한쪽의 키 회전이 다른 쪽을 끊는다.

**지문 `f`는 결과 집합의 정체성이다.** 다음을 정규화해 해시한다.

- 정규화한 질의 문자열
- 정렬 키와 정렬 방향
- **유효 접근 범위**(배열을 정렬한 뒤) 와 `access_scope_version`
- **`seq:` 질의의 유효 시퀀스 에폭** (CR-051). `seq:`가 없으면 이 재료가 없다 — `null`이나 `0` 같은 대체값을 쓰지 않는다

접근 범위를 지문에 넣는 것은 ADR-010이 이미 정한 것이며, 그 결과 **권한이 회수되면 진행 중이던 페이징이 죽는다.** 그것이 옳다 — 이전 권한 집합 기준으로 계산된 순서를 회수 뒤에 이어 쓰면 사용자는 지금 볼 수 없는 문서 사이의 위치에서 페이징을 계속하게 된다. 같은 요청 안에서 접근 범위를 두 번 산출하지 않는다.

**`size`와 패싯 요청 여부는 지문에 넣지 않는다.** 둘은 표현(presentation)이지 결과 집합의 정체성이 아니다 — 같은 순서의 같은 집합에서 페이지 크기만 바꾸는 것은 질의 의미의 변경이 아니다. 구현 감사에서 `search_after`의 모양 때문에 `size` 변경이 정확성을 깨는 것이 **증명되면** 그때 근거와 함께 포함한다. 추측으로 넣지 않는다.

**두 오류 코드는 다른 사실을 말한다.**

| 코드 | 뜻 | 화면 |
| --- | --- | --- |
| `CURSOR_QUERY_MISMATCH` | 커서 자체는 유효한데 현재 `q`·정렬·접근 범위와 지문이 다르다 | 현재 조건의 첫 페이지로 복귀 |
| `CURSOR_INVALID` | 디코딩 실패, 서명 불일치, 모르는 스키마 버전, 만료, PIT 부재, 정렬 키 값 형식 오류 | 현재 조건의 첫 페이지로 복귀 |

둘 다 사용자를 첫 페이지로 되돌리지만 **같은 기술 원인인 척하지 않는다.** 하나는 "조건이 바뀌었다"이고 다른 하나는 "이 커서를 쓸 수 없다"이다. 자동 재시도 루프를 만들지 않는다.

**모든 커서 순회에 Point In Time이 필요하다 — 정렬 키와 무관하다.** `search_after`는 "정렬 값이 이 커서보다 뒤"라는 조건이므로, 어떤 문서의 정렬 값이 페이지 사이에 움직이면 그 문서는 **두 번 나오거나 영영 나오지 않는다.** 정렬 키가 문서 자신의 필드라는 것은 그 값이 불변이라는 뜻이 아니다 — `updated_at`은 모든 PR 갱신 웹훅이, `changed_files_count`·`additions`는 보강 완료와 새 커밋이, `lead_time_seconds`는 머지 시각 확정이, `merged_at`은 미머지 PR의 머지가(`missing: _last` 무리에서 정렬 구간으로 들어온다), `merge_seq`는 에폭 상향이 움직인다. 움직이지 않는 것은 `created_at` 하나뿐이다. 첫 페이지에서 PIT을 열어 색인 뷰를 고정하고, keep-alive는 **5분**이며 다음 페이지 요청마다 갱신한다. 마지막 페이지에서 best-effort로 닫는다. 만료된 PIT은 `CURSOR_INVALID`다. `relevance`에는 이유가 하나 더 있다 — 다른 키는 **값**이 움직이고 점수는 **계산 근거**(BM25 term statistics)가 움직인다.

**`relevance`도 요청한 `order`를 존중한다.** FR-SRCH-007 AC-1은 키와 방향을 함께 승인했고, `relevance`만 방향을 무시할 근거를 SRS가 주지 않는다. 편의로 조용히 `desc`로 고정하지 않는다 — 지원하지 않기로 정하려면 그것은 SRS 변경이다.

#### 패싯 계약 (CR-043, WP-032가 구현한다)

**응답 상태는 넷이다.** CR-019 DEV-076이 정한 "`facets`와 `facets_omitted`는 함께 나타나거나 함께 빠진다"를 유지하면서, FR-SRCH-009의 예외 처리가 요구하는 **실패**를 별도 상태로 더한다.

| 상태 | 응답 | 화면 |
| --- | --- | --- |
| 요청하지 않음 | 세 키 모두 없음 | 레일에 "아직 분포를 세지 않습니다" |
| 성공 | `facets: {...}`, `facets_omitted: false`, `facets_status: "ready"` | 분포 표시 |
| 예산 초과로 생략 | `facets: {}`, `facets_omitted: true`, `facets_status: "budget_omitted"` | "이번 조회에서는 생략했습니다" + 재시도 |
| 계산 실패 | `facets: {}`, `facets_omitted: true`, `facets_status: "failed"` | 실패 상태 표시 + 재시도 |

**생략과 실패를 같은 안내로 그리지 않는다.** 예산 초과는 조건을 좁히면 풀리고, 계산 실패는 그렇지 않다. 하나로 뭉치면 사용자가 무엇을 해야 하는지 알 수 없다.

**"건수 일치"(QA-W001-16)를 `sum(buckets) == total`로 구현하지 않는다. 그 식은 틀리다.** 이유가 둘이다 — 각 패싯은 상위 20만 반환하므로 나머지 값이 생략되고, `label`과 `allowed_team_ids`는 다중 값이라 한 문서가 여러 bucket에 들어간다. 게다가 `total`은 `track_total_hits` 상한(1만) 위에서 근사다. 검증은 **bucket 단위**로 한다.

> 반환된 각 bucket `(field=value, count=N)`에 대해, 목록 조회와 **동일한 질의·정렬·접근 범위**에 그 bucket 필터 하나만 더한 독립 조회의 건수가 `N`과 같아야 한다.

**선택된 패싯 값도 계산 조건에 포함한다.** 일반적인 상거래 패싯은 자기 필드의 필터만 제외하고 분포를 다시 계산하지만(disjunctive facet), SRS AC-3은 "목록 조회와 동일한 질의 조건"이라고 명시한다. 다른 동작이 필요해지면 별도 요구사항과 CR을 연다.

**패싯은 목록과 실패 도메인을 나눈다.** 같은 요청 안에 `hits`와 `aggs`를 함께 넣으면 집계 하나가 타임아웃날 때 응답 전체가 못 쓰게 되어 "패싯 실패가 목록을 막지 않는다"를 지킬 수 없다. 두 요청으로 나누고, 패싯의 상한은 검색 의존 예산 3초의 **절반인 1.5초**다 (FR-SRCH-009 AC-4의 "전체 응답 예산의 절반"). 백엔드 아키텍처 8장의 `집계 타임아웃 (5초)`는 통계 API(REL-005)의 시계열 집계이며 이 예산이 아니다.

**패싯 집계도 강제 필터를 지난다.** 집계는 같은 `ScopedQuery` 아래에서 실행되면 안전하다. 위험한 것은 새 패싯 헬퍼가 `client.search({ index, aggs })`를 직접 불러 질의를 **잊는** 길이다. ADR-008 가드레일이 그 형태를 잡아야 한다.

**`team` 패싯은 `allowed_team_ids`를 센다.** `team:` 질의 키가 그 필드로 가므로(CR-016, DEV-052) 패싯이 다른 필드를 세면 "패싯을 눌렀는데 건수가 다르다"가 된다. 표시값(팀 slug)은 레지스트리에서 **일괄 해석**한다 — bucket마다 조회하지 않는다. 그리고 `allowed_team_ids`는 접근 통제 material이기도 하므로 불변식을 하나 건다: **접근 범위 밖 저장소가 가진 팀은 bucket에도 count에도 나타나지 않는다.**

**두 번째 페이지부터는 패싯을 다시 계산하지 않는다.** 첫 페이지만 `facets=true`로 요청하고 `CursorPager`의 이어 보기는 `facets=false`다. 같은 질의가 유지되는 동안 첫 페이지의 패싯 결과를 그대로 쓴다. `q`·필터·정렬이 바뀌면 커서와 패싯 상태를 **함께** 버린다.

#### 전문 검색 계약 (CR-043, WP-032가 구현한다)

**강조 구간을 HTML로 내보내지 않는다.** 위 응답 예시가 그 모양이다 — `<em>` 같은 마크업은 API 경계를 넘지 않는다. Elasticsearch의 highlighter는 원문을 이스케이프하지 않고 태그만 끼워 넣으므로, PR 제목이 마크업을 담고 있으면 그것이 그대로 실려 나간다. 화면이 그 문자열을 HTML로 그리면 THR-018의 완화 근거("PR 본문을 HTML로 렌더링하지 않음")가 무너진다. 계약은 **평문 조각과 일치 구간**이다.

```json
"highlight": {
  "title": [
    { "text": "feat: 결제 재시도 로직", "matches": [{ "start": 6, "end": 8 }] }
  ]
}
```

Elasticsearch 내부에서 `pre_tags`·`post_tags`를 쓰는 것은 무방하다 — 그 태그를 **응답 밖으로 내보내지 않는다.** 화면은 React 텍스트 노드와 `<mark>`로 조립한다. 상한은 필드당 조각 3개, 조각당 160자다 (FR-SRCH-011 AC-5).

**전문 검색의 대상 필드를 넓히지 않는다.** FR-SRCH-011 AC-1이 정한 것은 PR 제목, PR 본문, **머지 커밋 메시지**, 대상·소스 브랜치명이다. 그런데 `/search`는 `prs-pull-requests`와 `prs-commits`를 함께 돌고(CR-016, DEV-054) 커밋 문서에는 `role`이 `merge_commit`·`source_commit`·`direct_push`로 섞여 있다. 자유 텍스트를 `message`에 조건 없이 걸면 **원본 커밋 메시지까지** 검색 대상이 되어 AC-1이 정한 범위를 넘는다. WP-032는 점수 절의 커밋 축을 **first-parent 체인에 있는 커밋**(머지 커밋과 직접 푸시 커밋)으로 한정한다 — 그것이 "이 저장소의 머지 순서에 실제로 나타난 메시지"이며 AC-1의 뜻이다. 구조화 필터의 대상 인덱스는 바뀌지 않는다.

**`QUERY_TOO_SHORT`는 코드 포인트로 센다.** 현재 파서는 `String.length`(UTF-16 코드 단위)로 재므로 `𠮷`나 이모지 한 글자가 **2자로 세어져 통과한다.** trim 뒤 코드 포인트 수로 판정한다. 구조화 필터만 있고 자유 텍스트가 없으면 이 규칙을 적용하지 않는다.

### API-SRCH-005 저장된 검색 관리 (CR-049, DEV-333)

- 목적: 되풀이하는 조회 조건을 이름과 함께 보관하고, 필요하면 팀 하나에 공유하며, 나중에 그대로 다시 실행한다.
- 관련 요구사항: FR-SRCH-010
- 관련 화면/데이터: W-008, W-001 / ENT-CORE-006
- 인증: 세션 인증. 접근 범위 필터는 **이 API가 다루는 자원에 걸리지 않는다** — 저장된 검색은 PostgreSQL의 사용자 자산이고, 접근 범위는 그 질의를 **실행할 때** `API-SRCH-004`가 적용한다 (AC-3).

**하위 경로는 전부 이 ID에 속한다.** 새 `API-SRCH-###`를 만들지 않는다 — 하나의 자원(저장된 검색)에 대한 조작이며 ID를 늘리면 추적 매트릭스가 같은 것을 여러 줄로 말하게 된다.

| Method | Path | 목적 |
| --- | --- | --- |
| `GET` | `/api/v1/saved-searches` | 목록 (커서 순회, `view`로 두 논리 목록 구분) |
| `POST` | `/api/v1/saved-searches` | 생성 |
| `GET` | `/api/v1/saved-searches/share-targets` | 공유 대상으로 고를 수 있는 팀 목록 |
| `GET` | `/api/v1/saved-searches/{saved_search_id}` | 단건 조회 |
| `PATCH` | `/api/v1/saved-searches/{saved_search_id}` | 수정 (저장자만) |
| `DELETE` | `/api/v1/saved-searches/{saved_search_id}` | 삭제 (저장자만) |
| `POST` | `/api/v1/saved-searches/{saved_search_id}/run` | 실행 준비 — 권한·유효성 확인, 최종 실행 시각 갱신 |

**정적 경로가 파라미터 경로보다 먼저 등록되어야 한다.** `/share-targets`는 `/{saved_search_id}`와 같은 자리에서 겹치므로 등록 순서가 틀리면 `share-targets`가 ID로 해석된다. 이 사실은 산문이 아니라 **시험이 지킨다**.

#### 자원 표현

```json
{
  "saved_search_id": 42,
  "name": "결제 월간 리뷰",
  "query": "repo:acme/payments merged:2026-08-01..2026-08-31",
  "visibility": "team",
  "target_team": { "team_id": 101, "org_id": 7, "slug": "payments" },
  "owner": { "user_id": "oidc-sub-1", "login": "alice" },
  "is_owner": true,
  "query_status": "valid",
  "sequence_reference": {
    "status": "current",
    "stored_seq_epoch": 3,
    "current_seq_epoch": 3,
    "sequence_state": "ok"
  },
  "created_at": "2026-08-27T09:00:00Z",
  "last_run_at": "2026-08-27T10:00:00Z"
}
```

- `target_team`은 `visibility`가 `team`일 때만 있다. **식별자는 `team_id`다** — `slug`은 `(org_id, slug)`에서만 유일하므로 이름 하나가 팀 여럿을 가리킬 수 있고(DEV-331), 그것을 정체성으로 쓰면 다른 조직의 동명 팀으로 공유가 샌다. `org_id`와 `slug`은 화면이 사람에게 보여 주기 위한 것이다.
- `is_owner`는 **요청한 사람 기준**이다. 화면이 편집·삭제 액션을 그릴지 정하는 값이며, 서버는 이 값을 믿지 않고 매번 다시 판정한다.
- `query_status`는 `valid` 또는 `invalid`다. `invalid`면 `query_error`가 함께 실린다 — 파서가 낸 `token`·`offset_start`·`offset_end`를 그대로 옮긴다 (AC-6).
- `sequence_reference`는 **질의가 `seq:` 범위 조건을 담을 때만** 나타난다 (CR-051, AC-8). `status`는 넷이다.

| `status` | 뜻 | `stored_seq_epoch` | `current_seq_epoch`·`sequence_state` |
| --- | --- | --- | --- |
| `current` | 저장된 에폭이 현재와 같다 | 값 | 값 |
| `epoch_stale` | 달라졌다 — 그 서수는 다른 커밋을 가리킬 수 있다 | 값 | 값 |
| `unbound` | CR-051 이전에 에폭 없이 저장됐다 | `null` | 값 |
| `unavailable` | **이 사용자가 그 저장소를 볼 수 없다** | **키 자체가 없다** | **키 자체가 없다** |

  **`unavailable`은 `status` 하나만 싣는다** — 이것이 이 계약의 보안 경계다 (THR-043). 팀 공유는 **이름과 질의 문자열을 보이게 하는 일**이지 그 저장소를 읽을 권한을 주는 일이 아니며(AC-3, THR-012), 에폭 값은 "그 저장소의 히스토리가 몇 번 재작성됐다"를 말해 주는 활동 정보다. **`stored_seq_epoch`도 뺀다** — 저장자가 남긴 값이지만 공유된 것은 이름과 질의 문자열뿐이었고, `stored_seq_epoch: 5`는 그 저장소가 최소 다섯 세대를 거쳤다는 사실을 새로 알려 준다. FR-SRCH-010 AC-8은 "자신이 더 이상 구성원이 아닌 팀"이 아니라 **"자신이 접근할 수 없는 저장소"의 에폭·시퀀스 상태를 노출하지 않는다**고 정하며, 그 문장에는 어느 쪽 에폭인지 단서가 없다.
- **저장하는 것은 이름과 질의 문자열, 그리고 `seq:` 조건이 딛고 선 에폭뿐이다** (CR-051). 정렬·패싯 선택·커서·조회 결과·저장자의 접근 범위를 담지 않는다. 필터는 이미 질의 문자열 안에 있고, **시퀀스 공간의 정체성도 질의가 지목한 `repo:`·`base:`에서 나오므로 따로 저장하지 않는다** — 저장소·브랜치를 열로 복사하면 질의와 그 사본이 어긋나는 날이 온다.

#### `GET /api/v1/saved-searches`

- `view` (required): `mine` 또는 `team`
  - `mine` — 내가 소유한 것 전부(`private`와 `team` 모두)
  - `team` — 남이 소유하고 **내가 현재 구성원인 팀**에 공유한 것
  - 두 목록은 서로 배타다. 내가 소유한 `team` 검색은 `mine`에만 나타난다 — 같은 항목이 두 번 보이면 사용자가 그것을 두 개로 읽는다.
- `size` (optional, 기본 50, 최대 100)
- `cursor` (optional): 이전 응답의 `next_cursor`

정렬은 `created_at DESC, saved_search_id DESC`로 고정한다. 사용자가 정렬을 고르는 화면이 아니고, 동률에서 결정론이 없으면 커서 순회가 항목을 건너뛴다.

**`sequence_reference`는 페이지 단위로 한 번에 판정한다** (CR-051). 항목마다 저장소·시퀀스 공간을 조회하면 페이지 크기(최대 100)만큼 왕복이 생긴다. 순서는 이렇다: 페이지를 읽고 → `seq:`를 담은 질의들을 파싱해 `(repo, base)` 쌍을 모으고 → 저장소 행을 일괄 조회하고 → **요청자의 접근 범위로** 볼 수 있는 것을 가리고 → 시퀀스 공간을 일괄 조회해 상태를 붙인다. **자원 표현을 만드는 함수 안에서 데이터베이스를 부르지 않는다** — 그 자리에 한 번 왕복이 들어가면 그것은 언제나 항목 수만큼 늘어난다 (ADR-009와 같은 규율).

```json
{
  "view": "mine",
  "items": [ /* 자원 표현 */ ],
  "next_cursor": "eyJ2IjoxLCJ2aWV3IjoibWluZSIsLi4u.SIGNATURE",
  "correlation_id": "..."
}
```

`next_cursor`는 마지막 페이지에서 `null`이다. **키를 빼지 않는다** — 없는 키를 화면이 "더 있다"로 오해한다.

#### 커서 (CR-049, DEV-340)

ADR-010은 오프셋을 금지한다. 그러나 **W-001의 커서를 그대로 쓰지 않는다** — 저장된 검색의 정본은 PostgreSQL이고 순회하는 것이 Elasticsearch 문서가 아니다. PIT도 `search_after`도 여기에 뜻이 없다. 봉인 방식(base64url JSON + HMAC-SHA256)과 두 오류 코드만 공유하고, **순회의 뜻은 이 자원의 것이다.**

봉투가 싣는 것:

| 항목 | 왜 |
| --- | --- |
| 스키마 버전 | 형태가 바뀌면 옛 커서를 거절해야 한다 |
| `view` | `mine` 커서를 `team` 목록에 쓰면 다른 집합을 순회하게 된다 |
| `created_at`·`saved_search_id` | 키셋 위치. 정렬 키와 같은 쌍이다 |
| 지문 — 사용자 ID, `view`, **현재 팀 구성원 자격**, 접근 범위 버전 | 아래 |
| 만료 시각 | 무한히 사는 커서를 만들지 않는다 |

**팀 구성원 자격을 지문에 넣는 이유가 이 커서의 핵심이다.** `view=team` 목록의 내용은 "내가 어느 팀에 속해 있는가"가 정한다. 첫 페이지를 받은 뒤 팀에서 회수되면 그 커서가 가리키는 위치는 이제 **다른 집합의 위치**다. 지문 없이 이어 보면 회수된 팀의 항목을 계속 내주게 된다 — 접근 통제가 순회 도중에 조용히 무력해진다. 팀 ID를 정렬해 지문에 담고, 달라지면 `CURSOR_QUERY_MISMATCH`로 첫 페이지부터 다시 보게 한다.

서명 키는 `SEARCH_CURSOR_HMAC_KEY`를 그대로 쓴다. **새 시크릿을 만들지 않는다** — 배포가 관리할 키가 늘면 하나가 빠졌을 때의 실패가 늘어난다.

- 훼손·만료·모르는 스키마·형식 오류 → `400 CURSOR_INVALID`
- 지문 불일치(사용자·`view`·팀 구성 변경) → `400 CURSOR_QUERY_MISMATCH`

**남의 커서를 건네받은 경우도 이 갈래다.** 사용자 ID가 지문에 섞여 있으므로 서명은 유효한데 지문이 다르다. "이 커서를 당신이 쓸 수 없다"에 더 가까워 보이지만 그것을 구분하려면 **사용자 ID를 봉투에 평문 필드로 실어야 하고**, 봉투는 서명될 뿐 암호화되지 않으므로 OIDC `sub`가 base64 한 번으로 읽힌다. 구분의 값보다 노출의 대가가 크다 — 두 코드의 사용자 대면 결과는 어차피 같다(첫 페이지로 복귀).

둘 다 첫 페이지로 되돌리지만 **같은 사실을 말하지 않는다.** 자동 재시도 루프를 만들지 않는다.

#### `POST /api/v1/saved-searches`

```json
{ "name": "결제 월간 리뷰", "query": "repo:acme/payments base:main seq:1280..1342", "visibility": "team", "team_id": 101, "seq_epoch": 3 }
```

- `owner_user_id`를 **본문에서 받지 않는다.** 소유자는 세션이 정한다 — 받는 순간 그것이 남의 이름으로 저장하는 문이 된다.
- `visibility`가 `team`이면 `team_id`가 필수이고, `private`이면 `team_id`를 받지 않는다.
- `team_id`는 **요청이 주장하는 값이므로 믿지 않는다.** 저장 시점에 요청자가 그 팀의 구성원인지 다시 확인한다 (AC-1). 아니면 `400 INVALID_PARAMETER`다.
- **그 확인은 쓰기와 원자적이어야 한다** (CR-049 PR #59 리뷰). `READ COMMITTED`에서 각 문장은 자기 시작 시점의 스냅숏을 보므로, 멤버십을 읽고 나중에 `INSERT`하면 **그 사이에 커밋된 팀 탈퇴를 보지 못한다** — 이탈한 사람이 그 팀에 공유하는 행을 만들 수 있다. 같은 트랜잭션 안에서 `team_member` 행을 `SELECT ... FOR SHARE`로 잠근 뒤 쓴다. 잠그면 그 행을 지우려는 트랜잭션이 이쪽 커밋까지 기다리고, 반대로 삭제가 먼저 커밋했다면 이쪽 `SELECT`가 그것을 보고 거절한다 — 어느 순서든 결과가 일관된다. `/run`이 갱신 문장 자체에 권한 조건을 거는 것과 **같은 규율**이며, 판정과 쓰기 사이에 창을 남기지 않는다는 뜻이다.
- `query`는 `@prs/query`로 검증한다. 서버와 화면이 **같은 파서**를 쓴다 (ADR-001). 실패하면 `400 QUERY_SYNTAX_ERROR`이며 파서가 낸 오프셋을 그대로 싣는다.
- `name`은 공백만으로 이루어질 수 없다. 그 밖의 길이 상한은 이 계약이 새로 만들지 않는다 — 본문 크기 경계가 이미 있다.
- **`query`가 `seq:` 범위 조건을 담으면 `seq_epoch`이 필수다** (CR-051, AC-8). 담지 않으면 `seq_epoch`을 받지 않는다 — 있으면 `400 INVALID_PARAMETER`다. 질의는 `API-SRCH-004`의 「시퀀스 인용 계약」 규칙 1도 함께 만족해야 한다.

**서버가 현재 에폭을 대신 채우지 않는다.** 이것이 이 필드를 본문에서 받는 이유다. W-001이 에폭 3의 결과를 보는 동안 히스토리가 재작성되어 현재가 4가 될 수 있는데, 서버가 무조건 "현재"를 저장하면 **사용자가 본 것은 3이고 저장된 것은 4**가 된다. 그래서 화면이 자기가 보고 있던 에폭을 보내고 서버가 그것을 현재 값과 대조한다. 다르면 `409 SAVED_SEARCH_QUERY_INVALID`(`detail.reason: "epoch_stale"`)로 거절한다 — **저장을 거절하는 편이 사용자가 보지 않은 결과를 저장하는 것보다 낫다.** 이 대조도 `team_id` 확인과 같은 트랜잭션 안에서 한다.

**공간을 확인할 수 없으면 `404 NOT_FOUND`다** — `API-SRCH-004` 규칙 6과 같은 이유이며, 저장 경로가 새로운 존재 신탁이 되지 않게 한다.

**상한 검사는 경쟁 조건에서도 성립해야 한다** (AC-4, DEV-336). `SELECT count(*)` 뒤에 `INSERT`하는 순서는 99건 상태에서 동시 요청 둘을 101건으로 만든다. 소유자 행을 잠그고(`SELECT ... FOR UPDATE`) 세고 넣는 것을 **한 트랜잭션 안에서** 한다. 상한을 넘으면 `409 SAVED_SEARCH_LIMIT`이다. 여러 행에 걸친 개수를 `CHECK`로 강제하지 않는다 — PostgreSQL의 `CHECK`는 다른 행을 볼 수 없다.

응답 `201` + 자원 표현.

#### `PATCH /api/v1/saved-searches/{saved_search_id}`

`name`·`query`·`visibility`·`team_id`를 바꾼다. **저장자만 수행한다** (AC-2).

- 저장자가 아니면 `404 NOT_FOUND`다. `403`으로 답하면 "그 ID의 검색이 존재한다"가 새어 나간다.
- `query`를 바꾸면 `POST`와 같은 검증을 거친다.
- **수정 후의 최종 상태가 `team`이면 그 대상 팀의 현재 구성원 자격을 다시 확인한다** (AC-7). 저장자가 이미 그 팀에서 이탈했다면 거절한다 — 이탈한 사람이 그 팀의 공유 자산을 계속 바꾸게 두지 않는다. `private`으로 바꾸는 것과 삭제는 언제나 가능하다.
- **이 확인도 `POST`와 같은 잠금을 쓴다.** 검사 뒤 갱신 사이에 탈퇴가 커밋되면 같은 구멍이 열린다.
- `visibility`를 `private`으로 바꾸면 `team_id`를 지운다.

**`PATCH`가 시퀀스 인용을 조용히 옮기지 않는다** (CR-051). 이것이 이 절에서 가장 조심할 자리다 — 이름만 고치는 요청이 낡은 에폭을 현재 값으로 바꾸면 그것이 바로 이 CR이 막으려는 자동 재해석이다. 다섯 경우를 나눈다.

| 요청 | `seq_epoch` 처분 |
| --- | --- |
| `query`가 오지 않았고 `seq_epoch`도 없다 (이름·공개 범위·팀만 수정) | **그대로 둔다.** 낡았어도 낡은 채로 남는다 |
| `query`가 `seq:`를 잃었다 | `null`로 지운다. 뜻이 없어진 값을 남기지 않는다 |
| `query`가 `seq:`를 새로 얻었다 | `seq_epoch` 필수. 현재 값과 대조해 저장한다 |
| `query`의 `seq:`·`repo:`·`base:`가 바뀌었다 | 같음 — 인용 대상이 달라졌으므로 새 에폭을 확정해야 한다 |
| `query`는 그대로인데 `seq_epoch`이 왔다 | **명시적 재연결이다.** 현재 값과 대조해 갱신한다 |

마지막 줄이 화면의 「현재 에폭으로 다시 연결」이다. **본문에 `query`가 실려 있다는 사실만으로 재연결 의도를 판정하지 않는다** — 화면이 전체 폼을 보내는 구현이면 이름 한 글자 수정도 `query`를 담아 오기 때문이다. 판정의 재료는 `seq_epoch`의 존재와 질의의 실제 변화이지 본문 필드의 유무가 아니다.

**`unbound` 항목의 복구도 이 경로다.** 저장자가 현재 에폭을 확인해 `seq_epoch`을 보내면 그때 비로소 값이 생긴다. 서버가 목록 조회나 실행 시점에 채우지 않는다.

#### `DELETE /api/v1/saved-searches/{saved_search_id}`

저장자만 수행한다. 저장자가 아니면 `404`다. 응답 `204`.

#### `POST /api/v1/saved-searches/{saved_search_id}/run`

**이 경로는 검색을 대신 실행하지 않는다.** 하는 일은 넷이다: 실행 권한 확인, 질의 재검증, 최종 실행 시각 갱신, 그리고 화면이 이동할 곳을 알려 주는 것.

```json
{
  "saved_search_id": 42,
  "query": "repo:acme/payments base:main seq:1280..1342",
  "last_run_at": "2026-08-27T10:00:00Z",
  "navigation_url": "/search?q=repo%3Aacme%2Fpayments+base%3Amain+seq%3A1280..1342&seq_epoch=3",
  "correlation_id": "..."
}
```

**결과를 여기서 계산하면 AC-3이 구조적으로 위태로워진다.** 이 경로가 검색까지 수행하면 "누구의 범위로 계산했는가"가 이 핸들러의 판단이 되고, 언젠가 저장자의 범위를 캐시하는 최적화가 들어올 자리가 생긴다. 화면을 W-001로 보내고 그곳이 `API-SRCH-004`를 **실행자의 세션으로** 부르게 하면, 저장된 검색은 접근 통제 경로에 아예 참여하지 않는다.

- 실행 권한: 저장자이거나 대상 팀의 현재 구성원. 아니면 `404`.
- **`navigation_url`은 저장된 에폭을 그대로 싣는다** (CR-051). 현재 값으로 바꿔 보내지 않는다 — 낡았는지 판정하고 그 사실을 보이는 것은 `API-SRCH-004`와 W-001의 일이며, 여기서 현재 에폭을 붙이면 **사용자가 무효를 볼 기회 없이 다른 세대의 결과에 도착한다.**
- **`unbound` 항목은 실행하지 않는다.** 질의에 `seq:`가 있는데 저장된 에폭이 없으면 `409 SAVED_SEARCH_QUERY_INVALID`(`detail.reason: "sequence_unbound"`)이며 `last_run_at`도 갱신하지 않는다. 여기서 현재 에폭을 붙이는 것은 복구가 아니라 추측이다 — **저장 당시의 에폭은 어디에도 남아 있지 않다.**
- 질의가 현재 문법에서 무효면 `409 SAVED_SEARCH_QUERY_INVALID`이며 오류 위치를 함께 싣는다. **이때 `last_run_at`을 갱신하지 않는다** — 실행되지 않은 것을 실행했다고 적지 않는다.
- `last_run_at`은 **유효하고 권한 있는 실행에서만** 갱신하며, 저장자든 공유받은 구성원이든 똑같이 갱신한다. 그것이 "이 검색이 마지막으로 쓰인 시각"이라는 뜻이다.
- 권한 확인과 갱신 사이에 팀 구성이 바뀔 수 있으므로, **갱신 문장 자체가 권한 조건을 다시 건다.** 갱신된 행이 0이면 `404`다.

#### `GET /api/v1/saved-searches/share-targets`

```json
{ "teams": [ { "team_id": 101, "org_id": 7, "slug": "payments" } ], "correlation_id": "..." }
```

- 요청자가 **현재 구성원인 팀만** 반환한다. 이 목록이 곧 `POST`·`PATCH`가 받아들이는 `team_id`의 집합이다.
- 정본은 `team`·`team_member` 표다. **이 조회 때문에 GHE를 동기 호출하지 않는다** — 대화상자 하나가 외부 의존을 타면 GHE가 느릴 때 저장 자체가 막힌다.
- 같은 `slug`이 여러 조직에 있으면 `org_id`로 구분해 표시한다. 조직 이름을 담는 정본 표가 아직 없으므로 **새로 만들지 않고** `org_id`와 `slug`으로 구분한다.

#### 오류

| 코드 | 상태 | 언제 |
| --- | --- | --- |
| `QUERY_SYNTAX_ERROR` | 400 | 저장·수정하려는 질의가 현재 문법에서 무효 |
| `INVALID_PARAMETER` | 400 | `visibility`·`team_id` 조합이 어긋남, 구성원이 아닌 팀 지정, `view` 누락, `name`이 공백뿐 |
| `CURSOR_INVALID` | 400 | 커서 훼손·만료·모르는 스키마 |
| `CURSOR_QUERY_MISMATCH` | 400 | 사용자·`view`·팀 구성이 커서 발급 시점과 다름 |
| `NOT_FOUND` | 404 | 없는 항목, 볼 수 없는 항목, 소유하지 않은 항목에 대한 수정·삭제 |
| `SAVED_SEARCH_LIMIT` | 409 | 소유한 저장 검색이 100건 |
| `SAVED_SEARCH_NAME_CONFLICT` | 409 | 같은 이름의 내 검색이 이미 있음 |
| `SAVED_SEARCH_QUERY_INVALID` | 409 | 저장돼 있던 질의가 현재 문법에서 무효인데 실행을 요청. **저장 시점에 에폭이 이미 낡았거나(`detail.reason: "epoch_stale"`), 에폭 없이 저장된 항목의 실행을 요청한 경우(`"sequence_unbound"`)도 이 코드다** (CR-051) — 셋 다 "저장된 질의를 지금 그대로 쓸 수 없다"는 같은 사실이며, 새 코드를 만들면 화면이 같은 처리를 세 갈래로 나눠 쓰게 된다 |
| `NOT_FOUND` | 404 | 볼 수 없거나 존재하지 않는 저장 검색. **`seq:` 질의가 지목한 시퀀스 공간을 확인할 수 없는 경우도 같다** (CR-051) |

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

- 오류: `RANGE_INVERTED` (400), `RANGE_TOO_LARGE` (400), `SEQUENCE_SPACE_MISMATCH` (400), `CURSOR_INVALID` (400), `CURSOR_QUERY_MISMATCH` (400), `NOT_FOUND` (404). 커서 오류 둘은 WP-032가 커서를 세우면서 함께 선다 (CR-043)
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
| `next_cursor` | WP-032 전까지 항상 `null` | 키를 빼면 화면이 마지막 페이지를 오해하므로 `null`로 둔다 (DEV-138). **WP-032가 실제 값을 채운다** — 그 계약은 아래 「구간 커서와 패싯」 절이고, 근거는 SRS v2.7의 FR-SEQ-002 AC-6·7이다 (CR-043) |
| `summary.reverted_pull_request_count` | `prs-pull-requests.link_summary.is_reverted` | **WP-030에서 추가됐다** (CR-041, DEV-239 — CR-027 DEV-133의 이월 종결). 구간에 포함된 PR 중 현재 `link_summary.is_reverted`가 `true`인 수다. **되돌림 파생이 서기 전에는 키를 넣지 않았다** — 그때의 `0`은 "되돌림이 없다"와 "아직 세지 않았다"를 구분하지 못했기 때문이다(DEV-133). 이제 `is_reverted`를 실제로 쓰는 워커가 있으므로 `0`이 사실 주장이 된다. **요약 집계 왕복 안에서 `filter` 집계로 계산한다** — 간선 인덱스를 PR마다 다시 묻지 않는다(N+1 금지). `files_truncated_pull_request_count`와 같은 형태다 |

`RANGE_TOO_LARGE`의 `estimated_count`는 이름과 달리 **정확한 값**이다 (DEV-140). 정본이 PostgreSQL이므로 `count(*)`가 PK 범위 스캔 한 번이고, 추정할 이유가 없다. 필드 이름은 하위 호환을 위해 그대로 둔다.

#### 구간 커서와 패싯 (CR-043, WP-032가 구현한다)

**W-001의 커서와 같은 것을 쓰지 않는다.** 두 화면은 순회하는 정본이 다르다.

| 화면 | 무엇을 순회하나 | 커서 |
| --- | --- | --- |
| W-001 통합 검색 | Elasticsearch 검색 결과 | PIT + `search_after` (API-SRCH-004) |
| W-004 범위 조사 | PostgreSQL `merge_sequence`의 구간 멤버십 | 정본 서수 이어보기 (여기) |

WP-032의 구현 범위가 `search_after`를 적는다는 이유로 W-004의 멤버십까지 Elasticsearch가 소유하게 하지 않는다. 그러면 이 API가 존재하는 이유(DEV-130 — 색인 반영이 실패하면 구간이 **오류 없이 줄어든다**)가 그대로 되돌아온다. ADR-007을 깨는 최적화다.

**커서는 "완결 서수"를 가리킨다 — 그 서수 이하의 일치를 모두 반환했음이 보장되는 지점이다** (FR-SEQ-002 AC-7, SRS v2.8). 실제로 내준 것보다 멀리 가도, 아직 볼 것이 남았는데 멈춰도 안 된다. 봉인하는 것은 다음이다.

- 시퀀스 공간: 저장소, 대상 브랜치, `seq_epoch`
- 구간 경계: `from_seq`, `to_seq`
- 현재 `q`/필터의 지문
- `last_scanned_merge_seq`

에폭·경계·지문 중 하나라도 다르면 `CURSOR_QUERY_MISMATCH`다. 재채번으로 에폭이 바뀐 뒤 옛 커서를 이어 쓰면 **서수가 다른 두 공간을 한 목록으로 섞는다** — 그것이 에폭이 존재하는 이유다 (ADR-007). 훼손·만료·형식 오류는 `CURSOR_INVALID`이며, 무결성 보호는 API-SRCH-004의 커서와 같은 방식이다.

**페이지를 만드는 순서를 뒤집는다 (CR-043, DEV-270).** 지금 구현은 정본에서 첫 `size` 행을 읽고 **그 안에서만** `q`를 적용하는데, 요약은 구간 **전체**를 기준으로 센다. 두 수가 같은 응답 안에서 어긋난다.

> 실측(실제 PostgreSQL·Elasticsearch): 구간 1~60, `size=10`, 일치가 서수 51 하나뿐인 `q` → `summary.pull_request_count: 1`, `items: []`, `next_cursor: null`. 같은 질의를 `size=60`으로 하면 서수 51이 나온다. 데이터가 아니라 **절삭**이 원인이며, 커서가 없으므로 사용자는 그 항목에 **도달할 수 없다.**

한 페이지를 만드는 규칙은 이렇다.

1. `last_scanned_merge_seq` 다음부터 정본 구간을 **상한 있는 chunk**로 읽는다
2. 그 chunk를 Elasticsearch 강제 필터·`q`로 판정한다
3. 페이지가 `size`만큼 차거나 구간 끝에 닿을 때까지 1~2를 반복한다
4. **완결 서수**를 커서에 봉인한다 — 규칙은 하나이고 결과가 둘로 갈릴 뿐이다.
   - 페이지가 **차서 판정을 멈췄으면** → 목록에 **실제로 실은 마지막 일치의 서수**. 그 위에는 아직 안 내준 일치가 있을 수 있다
   - **판정할 것이 남지 않을 때까지 보고도** 차지 않았으면 → **마지막으로 검사한 서수**. 그 이하에 안 내준 일치가 없다

**둘 중 하나로 고정하면 각각 다른 방향으로 깨진다.** 언제나 "검사한 마지막 서수"로 두면, chunk 100 · `size` 10 · 그 chunk에 일치 20건일 때 앞의 10건만 내주고 커서를 100으로 봉인해 **나머지 10건이 영영 사라진다.** 반대로 언제나 "반환한 마지막 항목"으로 두면, 일치가 하나도 없는 페이지에서 **커서가 전진하지 못한다**(DEV-270이 만든 상태와 같다). 완결 서수는 그 둘을 하나의 물음으로 합친다 — **이 지점 이하에 아직 내주지 않은 일치가 있는가.**

실은 마지막 일치와 chunk 끝 사이의 **불일치 행은 다음 페이지에서 다시 판정된다.** 낭비지만 정확하고, 그 행들은 어차피 목록에 실리지 않으므로 중복이 생기지 않는다.

**일치가 적다는 이유로 구간 순회가 중간에서 끝나지 않는다.** 구간 상한이 이미 5만이므로 전체 스캔의 최악은 유계이고, chunk 크기는 실측으로 정하되 구간 전체를 메모리에 올리지 않는다.

**패싯은 넷이다** (FR-SEQ-002 AC-8, FR-SRCH-009 AC-1): 작성자, 팀, 라벨, 경로. 저장소와 대상 브랜치는 시퀀스 공간이 이미 고정하므로 패싯으로 다시 묻지 않고, PR 상태는 W-004의 승인 범위가 아니다. 경로는 `changed_paths.raw` 기준이다.

**패싯의 계산 대상은 페이지가 아니라 구간이다.** 현재 canonical `(from, to]` 멤버십과 현재 `q`/필터를 **모두 통과한 집합 전체**를 센다. 페이지 1이 50건이고 일치가 4,000건이면 패싯은 4,000건 기준이다. 정본 구간을 첫 `size`로 자른 뒤 집계하면 위 결함이 패싯 축에서 반복된다. 응답 상태·예산·검증 정의는 API-SRCH-004의 「패싯 계약」과 같다.

**패싯이 구간 멤버십을 바꾸지 않는다.** 멤버십은 공간·에폭·경계가 정하고, `q`와 패싯은 그 안에서 후보를 좁힐 뿐이다.

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
- 소비자: W-005의 릴리스 상세(`W-005-DETAIL`)와 미배포 구간(`W-005-UNRELEASED`). **구간 비교 버튼(`W-005-COMPARE`)은 이 API를 부르지 않는다** — FLOW-003대로 W-004로 앵커를 넘겨 이동하고, 결과 목록·패싯·뒤로가기 복귀는 거기 한 곳에만 둔다 (CR-030, DEV-156).

요청: `GET /api/v1/release-comparisons?repository=acme/payments&base_branch=main&from=build-20260812-03&to=build-20260814-01&size=0`

응답 200:

```json
{
  "sequence_space": "acme/payments@main",
  "seq_epoch": 3,
  "sequence_state": "ok",
  "epoch_stale": false,
  "normalized_direction": "from=build-20260812-03(seq 1280) → to=build-20260814-01(seq 1318)",
  "range": { "from_seq": 1280, "to_seq": 1318, "boundary": "(from, to]" },
  "summary": {
    "pull_request_count": 38,
    "commit_count": 41,
    "distinct_author_count": 12,
    "changed_files_total": 241,
    "additions_total": 5120,
    "deletions_total": 1840,
    "files_truncated_pull_request_count": 0,
    "top_changed_paths": [{ "path": "services/payments/src/retry.ts", "count": 9 }]
  },
  "items": [],
  "items_missing_in_index": 0,
  "next_cursor": null,
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

**요약과 항목은 API-SEQ-001의 계층을 그대로 딛는다.** `RangeSummary`·`RangeItem` 하나를 두 API가 공유하므로 W-004와 W-005가 같은 구간에 대해 다른 숫자를 말하는 일이 없다. `reverted_pull_request_count`도 **여기에 그대로 실린다** (CR-041, DEV-239). CR-027(DEV-133)이 관계 파생(WP-030) 전에는 세면 언제나 0이라 키 자체를 뺐고 화면도 그 자리를 "준비 중"으로 두었으나(CR-029, DEV-150), **WP-030이 되돌림 파생을 세우면서 그 이월이 끝났다** — 두 API가 `RangeSummary` 하나를 공유하므로 한쪽에만 생기지 않는다. 반대로 실측 요약이 내는 `commit_count`·`files_truncated_pull_request_count`·`top_changed_paths`와 봉투의 `sequence_state`·`epoch_stale`·`items_missing_in_index`는 여기에도 그대로 실린다. `unresolved_names`는 API-SEQ-001과 같이 **비면 키 자체를 넣지 않는다**(빈 배열은 "찾아봤고 없다"로 읽힌다, DEV-052).

- 요청 파라미터는 API-SEQ-001과 같다: `size`(0~200, 기본 50), `seq_epoch`(에폭 고정 인용). **`size=0`은 요약만** — 릴리스 상세 패널은 항목을 그리지 않으므로 항목 질의를 돌리지 않는다.
- 에폭 봉투도 같다. 요청 `seq_epoch`가 현재 에폭과 다르면 `epoch_stale: true` + `requested_seq_epoch`를 싣고 **결과는 내지 않는다**(ADR-007, WP-023). 재채번 중이면 `sequence_state: "reassigning"`과 마지막 확정 값이다.
- **`to=unreleased`는 마지막 릴리스 이후 브랜치 head까지다** (AC-5). `from`을 생략하면 마지막 릴리스가 시작 앵커다 — 미배포 구간의 정의가 그것이다. 릴리스가 하나도 없는 저장소에서는 404가 아니라 **200 + 공간 전체 구간**이다: 태그가 없으면 "전부 미배포"가 참이고, `RELEASE_NOT_INDEXED`는 **지목한 태그**가 없을 때의 코드다(DEV-146).
- **AC-4의 정규화는 서수로 한다.** 지정 순서와 무관하게 서수가 작은 쪽이 `from`이고, 뒤집힌 입력은 오류가 아니라 정규화 대상이다 — `normalized_direction`이 실제로 조회한 방향을 말한다.
- 오류: `SEQUENCE_SPACE_MISMATCH` (400, 두 릴리스가 다른 공간), `RELEASE_NOT_INDEXED` (404, **지목한 태그가 없다** — `detail.reason`이 `tag_not_found`(다른 태그는 있다)와 `release_not_indexed`(수집 자체가 없다)를 가른다), `ANCHOR_NOT_ON_BRANCH` (400, 태그가 체인 밖), `RANGE_TOO_LARGE` (400, 구간 5만 초과 — API-SEQ-001과 같은 가드다)

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

- 목적: 시퀀스 기준 인접 항목을 앞뒤 각 N건 반환한다.
- 관련 요구사항: FR-REL-001
- 소비자: `W-002-NEIGHBORS`(PR 상세)와 `W-003-SEQPOS`(커밋 상세). 두 화면이 같은 목록을 다른 앵커로 본다.

요청: `GET /api/v1/sequence-neighbors?repository=acme/payments&base_branch=main&pr_number=1234&count=10`

**앵커는 `pr_number` 또는 `commit_sha` 하나다** (CR-031, DEV-163). 둘 다 주거나 둘 다 없으면 400 `INVALID_PARAMETER`다. 커밋 앵커가 필요한 이유는 W-003이다 — **직접 푸시 커밋은 PR이 없어** `pr_number`로는 자기 위치를 물을 수 없다.

**`base_branch`는 필수다 — 서버가 시퀀스 공간을 고르지 않는다** (CR-032, DEV-168). 서수는 `(저장소, 대상 브랜치)` 공간 안에서만 의미가 있고(ADR-007), `merge_sequence`의 유일 색인이 공간별로 걸려 있으므로 **한 커밋이 `main`과 `release/*`의 현재 first-parent 체인에 함께 있는 것은 정상이다.** 앵커만 받아 저장소 전체에서 찾으면 어느 공간의 서수를 낼지 저장 순서가 정하게 되고, 사용자가 묻지 않은 브랜치의 답이 나온다. 정렬을 더해도 **결정적으로 같은 오답**일 뿐이다. 소비자인 두 화면은 이미 공간을 안다 — W-002는 PR 문서의 `base_branch`, W-003은 커밋 문서의 `base_branch`다. 없으면 400 `INVALID_PARAMETER`(`detail.field: "base_branch"`)다.

- **불변식**: `sequence_space`는 언제나 `<repository>@<요청한 base_branch>`다. 앵커도 이웃도 그 공간에서만 고른다.
- 그 공간에 앵커가 없으면 **다른 브랜치의 행으로 대신 답하지 않는다** — 409 `NO_SEQUENCE`(`reason: "not_sequenced"`)다. 다른 브랜치에는 있다는 사실도 알리지 않는다(그 답은 API-REL-002 포함 관계 조회의 몫이다).
- 채번된 적이 없는 브랜치는 404다 — API-SEQ-001과 같은 규칙이다 (CR-027, DEV-137). 빈 목록으로 200을 내면 "그 공간에 아무것도 없다"로 읽힌다.

응답 200:

```json
{
  "sequence_space": "acme/payments@main",
  "seq_epoch": 3,
  "sequence_state": "ok",
  "epoch_stale": false,
  "anchor": { "merge_seq": 1342, "kind": "pull_request", "pr_number": 1234,
              "commit_sha": "a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5" },
  "items": [
    { "merge_seq": 1339, "kind": "commit", "commit_sha": "c72d1e0f3a4b5c6d7e8f90a1b2c3d4e5f6071829",
      "pr_number": null, "title": null, "author": null, "merged_at": "2026-08-19T01:10:00Z",
      "is_anchor": false, "indexed": false, "url": "/commit/acme/payments/c72d1e0f3a4b5c6d7e8f90a1b2c3d4e5f6071829" },
    { "merge_seq": 1341, "kind": "pull_request", "commit_sha": "b41c9a0d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6071",
      "pr_number": 1233, "title": "fix: 세션 만료", "author": "lee",
      "merged_at": "2026-08-19T04:20:00Z", "is_anchor": false, "indexed": true,
      "url": "/pr/acme/payments/1233" },
    { "merge_seq": 1342, "kind": "pull_request", "commit_sha": "a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5",
      "pr_number": 1234, "title": "feat: 결제 재시도 로직", "author": "kim",
      "merged_at": "2026-08-19T05:02:11Z", "is_anchor": true, "indexed": true,
      "url": "/pr/acme/payments/1234" },
    { "merge_seq": 1343, "kind": "pull_request", "commit_sha": "d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708",
      "pr_number": 1240, "title": "fix: 세션 만료 처리", "author": "park",
      "merged_at": "2026-08-19T06:11:00Z", "is_anchor": false, "indexed": true,
      "url": "/pr/acme/payments/1240" }
  ],
  "boundary": { "at_start": false, "at_end": false },
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

**직접 푸시 커밋을 빼지 않는다** (CR-031, DEV-161 / FR-REL-001 AC-2). PR만 실으면 목록의 서수가 `1339 → 1341`처럼 건너뛴 채 보이고 사용자는 그것을 **누락으로 읽는다** — "서수는 `git log --first-parent`로 검증 가능해야 한다"(ADR-007)는 불변식이 화면에서 깨진다. 그 항목의 `title`·`author`는 커밋 메타데이터 보강(WP-067, JOB-MIR-002) 전까지 `null`이며, **소속 PR의 값으로 대신 채우지 않는다** (DEV-090과 같은 이유).

- `count`는 기본 10, 최대 50이며 **앞뒤 각각**이다 (AC-1). 응답 항목 수는 최대 `2 × count + 1`이다.
- `indexed: false`는 **정본(`merge_sequence`)에는 있는데 색인에 표시값이 없다**는 뜻이다 (DEV-130과 같은 규칙). 서수·SHA는 확정값이므로 행을 빼지 않고, 화면은 "색인 대기"로 밝힌다. 직접 푸시 커밋은 보강 전까지 언제나 이 상태다.
- **`merged_at`은 행의 종류가 정한다** (CR-032, DEV-169). 커밋 시각과 PR 머지 시각은 다른 값이다.
  - `kind: "commit"`(직접 푸시) → 그 커밋의 `committed_at`. PR이 없으므로 이것이 그 행의 시각으로서 참이다.
  - `kind: "pull_request"` + `indexed: true` → PR 문서의 `merged_at`.
  - `kind: "pull_request"` + `indexed: false` → **`null`**. 머지 시각은 PR 문서만 아는 값이고, 색인이 아직 그것을 싣지 못했다면 서버가 아는 것은 "모른다"다. **병합 커밋의 `committed_at`으로 대신 채우지 않는다** — 화면의 "머지 시각" 칸이 확인되지 않은 값을 확정처럼 그리게 된다. 화면은 `—`로 비운다.
- 에폭 봉투는 API-SEQ-001과 같다. `seq_epoch`는 현재 에폭이고, 요청에 `seq_epoch`를 실어 인용을 고정할 수 있다 — 다르면 `epoch_stale: true` + `requested_seq_epoch`를 싣고 **결과는 내지 않는다** (ADR-007). 재채번 중이면 `sequence_state: "reassigning"`과 마지막 확정 값이다.
- `boundary.at_start`는 앞쪽으로 `count`건을 채우지 못했다는 뜻이고 `at_end`는 뒤쪽이다 — 공간 경계에서 **오류가 아니라 존재하는 만큼만** 반환한다 (AC-4).
- 항목 표시값은 강제 접근 범위 필터를 지난 색인 조회로 채운다 (ADR-008). 요청 자체가 저장소 단위로 이미 걸러지므로 이웃이 다른 저장소로 새지 않는다.

응답 409 (시퀀스 없음) — **사유를 가른다** (CR-031, DEV-164):

```json
{
  "error": {
    "code": "NO_SEQUENCE",
    "message": "이 PR은 아직 머지되지 않아 머지 시퀀스가 없습니다.",
    "detail": { "pr_number": 1250, "reason": "not_merged", "state": "open" }
  },
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

`reason`은 둘이다: 미머지는 `not_merged`, **머지됐으나 아직 채번되지 않은** 개체는 `not_sequenced`다. 한 코드로 묶으면 화면이 "머지되지 않았다"는 **사실 주장**과 "아직 모른다"를 같이 그리게 되고, 그것은 C-014가 금지하는 것이다 (CR-019, DEV-077).

- 오류: `INVALID_PARAMETER` (400, 앵커가 둘이거나 없음 · `base_branch` 없음), `NO_SEQUENCE` (409), `NOT_FOUND` (404, 미등록·범위 밖 저장소, 채번된 적 없는 시퀀스 공간, 없는 PR·커밋)

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

### API-REL-003 동시 변경 상관 (CR-042, DEV-249)

- 목적: 기준 PR과 변경 경로가 겹치는 다른 PR을 겹침 정도 내림차순으로 반환한다. `W-002`의 동시 변경 하위 섹션이 유일한 소비자다.
- 관련 요구사항: FR-REL-007
- 신설 사유: 카탈로그에 한 줄만 있고 상세 절이 없었다 — 자격 판정·후보 선정·순서를 어디에도 적어 두지 않아 구현이 AC 다섯을 각자 해석하게 된다 (DEV-249).

요청: `GET /api/v1/co-changes?repository=acme/payments&pr_number=1234`

- `repository` (required), `pr_number` (required). **PR 전용이다** — FR-REL-007이 PR의 변경 경로 집합을 대상으로 정한다. 커밋 앵커를 받지 않는다.
- 앵커는 강제 접근 범위 필터를 지난 조회로 찾는다. 없거나 범위 밖이면 **404**다 (ADR-008, THR-004).

**계산 불가와 결과 0건은 다른 사실이다.** 자격을 갖추지 못한 기준 PR은 오류가 아니라 정상 도메인 상태이며, `available: false`와 사유를 함께 낸다 (DEV-254).

| `reason` | 조건 | 왜 계산할 수 없는가 |
| --- | --- | --- |
| `not_merged` | `merged_at`이 없다 | AC-2의 창이 **머지 시각 기준 ±90일**이다. 기준점이 없으면 창이 없다. `created_at`·`updated_at`으로 대체하지 않는다 — 그것은 AC-2가 정한 창이 아닌 다른 창을 계산한 뒤 그 결과를 자카드 상위 20이라고 부르는 것이다 |
| `enrichment_pending` | `enrichment_pending: true`이거나 `changed_paths`가 없다 | 경로 집합을 모르면 교집합이 성립하지 않는다 (FR-REL-007 예외 처리) |
| `too_many_changed_files` | `changed_files_count > 200` | AC-4. **판정은 `changed_files_count`로만 한다** — `files_truncated`는 `MAX_CHANGED_FILES`(3000) 상한의 표식이라 다른 계약이며, `files_truncated: false`에서 "그러니 200 이하"를 추론하면 틀린다 (DEV-254) |

후보(candidate) 자격은 AC-2~AC-4를 그대로 따른다. **같은 저장소**, 기준 PR 자신 제외, `merged_at`이 기준 PR의 `merged_at` ±90일 이내, `changed_files_count <= 200`, `enrichment_pending`이 아님, 경로 교집합 1개 이상. 같은 저장소라는 사실을 이유로 **강제 접근 범위 필터를 건너뛰지 않는다** (ADR-008).

**정확한 자카드를 계산한다 — 앱단 pre-limit을 두지 않는다** (DEV-255). 자격 조건과 경로 교집합 존재를 Elasticsearch가 먼저 강제하고, 자카드 `|A ∩ B| / |A ∪ B|`를 `changed_paths.raw`의 정확 값 위에서 계산해 정렬한다. "후보 N건을 먼저 가져와 앱에서 계산해 상위 20"은 **진짜 상위 20이 N번째 밖에 있을 수 있고**, 그 사실이 응답 어디에도 드러나지 않아 사용자는 완전한 답을 받았다고 믿는다. 조사 도구에서 그것은 조용한 오답이다.

- 정렬은 `similarity` 내림차순, 동률이면 `pr_number` 오름차순이다. 같은 정본에서 같은 순서를 보장한다 (ADR-004).
- `items`는 **최대 20건**이다 (AC-3).
- `overlapping_paths`는 최종 20건에 대해서만 계산하고 **사전순 오름차순 앞 10개**다 (AC-5, DEV-256). AC-5에 순위 개념이 없으므로 결정론을 우선한다.

응답 200:

```json
{
  "available": true,
  "anchor": { "repository": "acme/payments", "pr_number": 1234, "changed_files_count": 12 },
  "items": [
    {
      "repository": "acme/payments",
      "pr_number": 1180,
      "title": "fix: 결제 재시도 백오프",
      "author": "lee",
      "merged_at": "2026-07-02T11:20:00Z",
      "similarity": 0.4286,
      "overlapping_paths": ["src/payment/retry.ts", "src/payment/types.ts"],
      "url": "/pr/acme/payments/1180"
    }
  ],
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

응답 200 (계산 불가):

```json
{
  "available": false,
  "reason": "not_merged",
  "anchor": { "repository": "acme/payments", "pr_number": 1250 },
  "items": [],
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

- `available: true` + `items: []`는 **"자격을 갖췄고 겹치는 PR이 없다"**이다. `available: false`와 같은 그림으로 그리지 않는다.
- 오류: `INVALID_PARAMETER` (400, `pr_number` 없음·형식 오류), `NOT_FOUND` (404, 미등록·범위 밖 저장소, 없는 PR)

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

### API-REL-005 저장소 릴리스 목록 (CR-030, DEV-155)

- 목적: W-005의 릴리스 타임라인(C-032)을 채운다 — 한 저장소에 수집된 릴리스와 각 릴리스의 시퀀스 좌표, 직전 릴리스 대비 PR 수를 준다.
- 관련 요구사항: FR-SEQ-004 (구간 비교의 진입), FR-REL-002 (미배포 구간)
- 신설 사유: 릴리스 **목록**을 줄 경로가 없었다. `/containments`(API-REL-002)는 대상을 지목해 묻는 조회이고 `/release-comparisons`(API-SEQ-003)는 구간 비교다 — C-027의 공간 목록이 없어 API-SEQ-006을 세운 것과 같은 공백이다 (DEV-152 → DEV-155).

요청: `GET /api/v1/releases?repository=acme/payments&branch=main&limit=100`

응답 200:

```json
{
  "repository": "acme/payments",
  "releases": [
    {
      "tag_name": "build-20260814-01",
      "commit_sha": "b81f3e0a9c2d4e5f60718293a4b5c6d7e8f90a1b",
      "released_at": "2026-08-14T11:00:00Z",
      "source": "git_tag",
      "base_branch": "main",
      "sequence_space": "acme/payments@main",
      "seq_epoch": 3,
      "merge_seq": 1318,
      "previous_tag_name": "build-20260812-03",
      "pull_request_count_since_previous": 38
    },
    {
      "tag_name": "hotfix-20260813",
      "commit_sha": "a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5",
      "released_at": "2026-08-13T02:10:00Z",
      "source": "git_tag",
      "base_branch": null,
      "sequence_space": null,
      "seq_epoch": null,
      "merge_seq": null,
      "previous_tag_name": null,
      "pull_request_count_since_previous": null
    }
  ],
  "reason": null,
  "truncated": false,
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

- **목록은 저장소 스코프다** (DEV-158). `branch`를 주면 필터이고 없으면 전부다. 브랜치를 강제로 고정하면 "다른 대상 브랜치 릴리스 2건 선택"(FR-SEQ-004 AC-3 / QA-W005-03)이라는 상황 자체가 만들어지지 않아 그 규칙을 검증할 길이 사라진다. 화면은 행마다 브랜치를 표기한다.
- **체인 밖 태그도 싣는다**(`base_branch: null`). `release` 표가 그 상태를 허용하고(`release_seq_chk`), 숨기면 "그런 태그가 없다"로 오인된다 — API-SEQ-006이 채번 이력 없는 브랜치를 `unknown`으로 싣는 것과 같은 원칙이다. 서수가 없으므로 **비교 앵커로 선택할 수 없다**.
- **저장된 `merge_seq`를 그대로 믿지 않는다** (DEV-149). 릴리스 서수는 에폭에 묶인 스냅숏이므로, 이 API는 `release`를 **현재 에폭의 `merge_sequence`와 `commit_sha`로 조인해** 서수를 다시 얻는다(질의 한 번, 행마다 묻지 않는다). 현재 에폭 체인에 없으면 — 재채번 직후 아직 재해석되지 않았거나 체인 밖이거나 — `merge_seq: null`로 싣는다. 재채번 중에 **틀린 서수를 조용히 보이는 것보다 서수가 없다고 말하는 쪽**이 옳다.
- 정렬은 `released_at` 내림차순, 동률은 `tag_name` 오름차순 (와이어프레임 `W-005-LIST`).
- **`previous_tag_name`은 시각이 아니라 서수로 정한다** — 같은 공간·에폭에서 `merge_seq`가 바로 아래인 릴리스다. 태그는 나중에 옛 커밋을 가리키며 생길 수 있어 시각 순서와 서수 순서가 어긋나고, 구간은 서수로 잘리기 때문이다. 목록 정렬(시각)과 다를 수 있으므로 **비교 대상 태그명을 함께 싣는다**: 행이 무엇과 비교된 수인지 화면이 말할 수 있어야 한다.
- **`pull_request_count_since_previous`는 서수 차가 아니라 PR 문서 수다** (QA-W005-06). 반개구간 `(previous.merge_seq, merge_seq]`에서 `pull_request_number IS NOT NULL`인 서로 다른 PR의 수이며, 직접 푸시 커밋이 섞이면 서수 차와 달라진다. 그 공간에서 서수가 가장 낮은 릴리스는 비교 대상이 없으므로 **`null`이다 — 0이 아니다**: 세지 않은 것을 0으로 적지 않는다(DEV-133과 같은 원칙).
- **릴리스가 하나도 없으면 200 + `releases: []` + `reason: "release_not_indexed"`다** (API-REL-002와 같은 처리, DEV-146). 404가 아니다 — 저장소는 있고 릴리스가 없을 뿐이다. **"태그가 0개"와 "아직 한 번도 받지 않았다"는 구분하지 않는다**: `repository` 표에 릴리스 동기화 마커가 없어 서버가 판별할 수 없고, 판별할 수 없는 것을 두 상태로 그리면 둘 중 하나는 반드시 거짓이 된다 (DEV-159).
- `limit`은 기본 100, 최대 500이다. 넘치면 최신부터 채우고 `truncated: true`를 싣는다 — **말없이 자르지 않는다**. 커서 페이지네이션은 WP-032다.
- 접근 범위 밖 저장소는 `NOT_FOUND`(404)다. 목록 API는 단건 판정과 같은 `isRepositoryInScope`를 쓴다 (ADR-008, THR-004 — 존재를 드러내지 않는다).

### API-REL-006 관계 간선 조회 (CR-042, DEV-248)

- 목적: WP-029·WP-030이 `prs-links`에 저장한 간선을 화면에 준다. `C-021 LinkGroupList`의 유일한 데이터 소스다.
- 관련 요구사항: FR-REL-003, FR-REL-004, FR-REL-005, FR-REL-006 / FR-AUTH-002
- 소비자: `W-002-LINKS`(PR 상세)와 `W-003-LINKS`(커밋 상세).
- 신설 사유: 파생은 섰는데 그것을 읽을 경로가 없었다. API-REL-001·002·005는 `prs-links`를 읽지 않고, 003은 조회 시점 계산이며 004는 그래프(WP-043)다 (DEV-248).

요청: `GET /api/v1/relations?repository=acme/payments&pr_number=1234&link_type=reverts&direction=incoming&limit=50`

- `repository` (required)
- **앵커는 `pr_number` 또는 `commit_sha` 하나다.** 둘 다 주거나 둘 다 없으면 400 `INVALID_PARAMETER` — API-REL-001과 같은 규칙이다.
- `link_type` (required): `references` | `reverts` | `cherry_picks` | `stacks_on`. **`co_changes`·`precedes`는 여기 없다** — 저장하지 않고 조회 시점에 계산한다 (ADR-009). 전자는 API-REL-003, 후자는 API-REL-001이다.
- `direction` (required): `outgoing`(이 개체가 `from`) | `incoming`(이 개체가 `to`)
- `limit` (optional, 기본 50, 최대 100)

**한 요청은 한 유형 · 한 방향이다** (DEV-252). 여러 유형을 한 번에 받으면 어느 유형이 상한에 걸렸는지 응답이 말할 수 없고, 화면은 유형별 그룹으로 그리므로 묶어 받을 이유가 없다.

**끝점 조합이 성립하지 않는 요청은 서버가 거절한다.** `stacks_on`은 PR↔PR 관계이므로 `commit_sha` 앵커와 함께 오면 400 `INVALID_PARAMETER`(`detail.field: "link_type"`)다. 화면이 그런 요청을 보내지 않는 것이 1차 책임이지만, 서버가 받아 주면 빈 배열이 "관계 없음"으로 읽힌다 — **없는 것과 물을 수 없는 것은 다른 답이다.**

- 상한은 `limit`이고 **오프셋 파라미터를 만들지 않는다** (공통 원칙 7, ADR-010). 내부에서 `limit + 1`을 읽어 `truncated`를 판정한다. 커서를 세우지 않는 이유는 현재 어떤 요구사항도 관계 목록의 전량 열람을 요구하지 않기 때문이다 — 필요해지면 그때 커서 계약을 연다.

#### 접근 통제 — 두 번의 독립한 강제 필터 (THR-034, DEV-253)

**간선의 접근 범위는 근거를 소유한 저장소(`from` 쪽)의 것이지 대상의 것이 아니다** (THR-035). 그래서 이 API는 필터를 **두 번** 건다.

1. **앵커 해석** — 강제 접근 범위 필터를 지난 조회로 찾는다. 없거나 범위 밖이면 **404**다. 403으로 "있지만 못 본다"를 알리지 않는다 (THR-004).
2. **간선 조회** — `prs-links`를 강제 접근 범위 필터로 친다. 간선 문서가 source 저장소의 통제 material(`repository_id`·`org_id`·`visibility`·`allowed_team_ids`)을 싣고 있으므로 그대로 성립한다.
3. **대상 내용 조회** — 대상의 제목·본문·작성자를 실으려면 **대상 저장소를 다시 교집합해야 한다.** 대상 문서를 강제 접근 범위 필터를 지난 **batch 조회**로 읽는다. `mget`·`get`으로 우회하지 않는다.

**역방향 조회는 저장소 라우팅을 쓰지 않는다** (DEV-250). 간선은 source 저장소에 살기 때문에, `acme/b`의 PR을 가리키는 참조를 `b`로 라우팅해 찾으면 `acme/a`·`acme/c`가 만든 간선을 **구조적으로 놓친다.** 경계를 만드는 것은 라우팅이 아니라 강제 접근 범위 필터다. 되돌림·체리픽·스택은 동일 저장소 관계라 이 차이가 드러나지 않지만, 같은 경로를 쓰므로 규칙을 하나로 둔다.

**대상을 볼 수 없을 때** 간선 자체와 식별자·근거는 남기고 **내용 필드를 두지 않는다**(키 부재). `content_available: false`로 그 사실만 말한다. 화면 문구는 사유를 구분하지 않는다 — "권한이 없습니다"와 "대상이 존재합니다"는 둘 다 존재를 밝히는 문장이다.

**`resolved`와 `content_available`은 다른 사실이다.** 전자는 "대상 개체가 색인되었는가"(FR-REL-003 AC-3), 후자는 "이 요청자가 그 내용을 볼 수 있는가"다. `resolved: true`인데 `content_available: false`인 항목은 정상이다.

응답 200:

```json
{
  "anchor": { "repository": "acme/payments", "kind": "pull_request", "pr_number": 1234 },
  "link_type": "reverts",
  "direction": "incoming",
  "items": [
    {
      "link_id": "9f1c…",
      "link_type": "reverts",
      "direction": "incoming",
      "confidence": "exact",
      "evidence": "This reverts commit a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5",
      "resolved": true,
      "ambiguous": false,
      "content_available": true,
      "endpoint": {
        "kind": "pull_request",
        "repository": "acme/payments",
        "pr_number": 1301,
        "title": "Revert \"feat: 결제 재시도 로직\"",
        "author": "park",
        "url": "/pr/acme/payments/1301"
      }
    },
    {
      "link_id": "2b74…",
      "link_type": "reverts",
      "direction": "incoming",
      "confidence": "heuristic",
      "evidence": "Revert \"feat: 결제 재시도 로직\"",
      "resolved": true,
      "ambiguous": false,
      "content_available": false,
      "endpoint": { "kind": "pull_request", "repository": "acme/internal", "pr_number": 88 }
    }
  ],
  "truncated": false,
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

- `endpoint`는 **반대쪽 끝점**이다. `outgoing`이면 `to`, `incoming`이면 `from`이다. 화면이 방향을 다시 계산하지 않게 한다.
- **내부 Elasticsearch 문서 ID를 사용자 식별자로 노출하지 않는다.** `endpoint`는 `repository` + `pr_number` 또는 `commit_sha`로 말한다. `link_id`는 화면이 항목을 구분하는 불투명 키이며 그것 말고 다른 뜻을 주지 않는다.
- `content_available: false`이면 `title`·`author`·`url`이 **없다**(키 부재). `null`로 채우지 않는다 — 이 응답의 나머지 규칙과 같다.
- **미해결 참조**(`resolved: false`)는 `endpoint`에 대상 식별자가 없고 `reference_expression`이 그 자리를 대신한다. 화면은 원 표현을 보이되 링크를 비활성으로 둔다 (FR-REL-003 AC-3).
- `detached`는 **`stacks_on`에만 실린다** (FR-REL-006 AC-3, CR-041 DEV-238). 다른 유형에 `false`를 넣지 않는다 — "해제될 수 있는 관계인데 아직 아니다"라는 뜻이 되고 그런 개념이 없다.
- **`ambiguous`는 다중 후보 되돌림을 표시한다** (FR-REL-004 예외 처리, DEV-261). 같은 `evidence`를 공유하는 `confidence: heuristic` 항목이 응답 안에 둘 이상이면 그 항목들이 `true`다. 제목 대조 후보가 여럿일 때 저장 계층은 **후보를 좁히지 않으므로**(CR-041, DEV-237) 화면도 하나를 고르면 안 된다.
- `truncated: true`는 `limit`을 넘는 간선이 더 있다는 뜻이다. 화면은 그 사실을 밝히고 상세는 W-007(WP-043)로 넘긴다.

- 오류: `INVALID_PARAMETER` (400, 앵커가 둘이거나 없음 · 지원하지 않는 `link_type`·`direction` · 끝점 조합 불가), `NOT_FOUND` (404, 미등록·범위 밖 저장소, 없는 PR·커밋)

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
      "drill_down_query": "kind:pull_request org:acme merged:2026-07-01..2026-08-01 author_team:payments-core" },
    { "key": "session", "count": 288, "changed_files_sum": 1522,
      "additions_sum": 29110, "lead_time_median": 44100,
      "drill_down_query": "kind:pull_request org:acme merged:2026-07-01..2026-08-01 author_team:session" }
  ],
  "truncated": false,
  "approximate": false,
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

- **집계 대상은 `prs-pull-requests` 단독이다** (FR-STAT-001 AC-6, CR-053). 목록 조회(`API-SRCH-004`)는 PR과 커밋을 함께 보므로 화면 총계와 이 응답의 `total`은 같지 않을 수 있다
- `group_by`와 ES 필드의 대응 (CR-053, DEV-382)

  | `group_by` | ES 필드 | 다중값 |
  | --- | --- | --- |
  | `repository` | `repository` | 아니오 |
  | `org` | `org_id` (표시명은 레지스트리에서 일괄 해석) | 아니오 |
  | `team` | **`author_team_ids`** (작성자 소속 팀. `allowed_team_ids`가 **아니다**) | **예** |
  | `author` | `author` | 아니오 |
  | `label` | `labels` | **예** |
  | `base_branch` | `base_branch` | 아니오 |
  | `state` | `state` | 아니오 |

- **다중값 그룹에서는 한 PR이 여러 버킷에 들어간다.** 따라서 `sum(groups[].count)`가 `total`을 넘을 수 있으며 이는 정상이다 (FR-STAT-001 AC-7, DEV-385). `total`은 언제나 **고유 PR 수**다
- **`author_team_ids`는 현재 투영이 채우지 않는다** (원장 7장). 계약은 이 필드를 지목하고, 값이 비어 있는 동안 `team` 그룹이 비는 것을 그대로 드러낸다 — 없는 값을 다른 필드로 대신 채우지 않는다
- `size` 최대 500. 초과 시 상위 500 + `truncated: true` (AC-3)
- **정렬은 `count` 내림차순, 동률이면 그룹 키 오름차순이다** (FR-STAT-001 AC-8, DEV-389). 같은 데이터에 같은 요청이 다른 순서를 내지 않는다
- `drill_down_query`는 **집계와 같은 모집단을 가리킨다** — `kind:pull_request`를 포함하며, `team` 그룹의 경우 `team:`이 아니라 **`author_team:`**을 쓴다 (FR-STAT-001 AC-5, DEV-383)
- 질의에 `seq:` 범위가 있으면 요청에 `seq_epoch`이 필요하다 (아래 공통 규칙)
- 대상 100만 건 초과 시 `approximate: true` (FR-STAT-006 AC-3, 아래 공통 규칙)
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

- **집계 대상은 `prs-pull-requests` 단독이고 버킷 기준 시각은 `merged_at`이다** (FR-STAT-002 AC-6, CR-053). 커밋 문서에는 그 필드가 없다
- `interval`: `hour` | `day` | `week` | `month`. 버킷 400개 초과 시 `TOO_MANY_BUCKETS` (400)
- `timezone` 기본값은 `Asia/Seoul`이며 **버킷 경계를 그 시간대에서 계산한다** (FR-STAT-002 AC-2). UTC로 나눈 뒤 이름만 바꾸지 않는다 — 날짜 경계가 다른 지역에서 하루가 어긋난다
- `from`·`to` 미지정 시 최근 30일이며 `applied_range`에 실제 적용 구간을 명시한다
- 데이터 없는 버킷도 0으로 채워 반환한다 (AC-4)
- `group_by` 지정 시 계열 최대 20개 (AC-5). 그룹 선택 규칙과 다중값 의미는 `API-STAT-001`과 같다
- 질의에 `seq:` 범위가 있으면 요청에 `seq_epoch`이 필요하다 (아래 공통 규칙)

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

- **집계 대상은 `prs-pull-requests` 단독이며 `lead_time_seconds`는 머지된 PR로 한정한다** (FR-STAT-003 AC-2)
- `field`: `lead_time_seconds` | `first_review_wait_seconds`. 둘 다 **색인 시점 사전 계산 필드**이며 조회 시점 `script`를 쓰지 않는다 (AC-5)
- 표본 20건 미만이면 `low_sample: true`와 원값 목록 (`raw_values`)을 반환한다. **경계는 20이며 19는 `true`, 20은 `false`다**
- `raw_values`도 접근 범위를 지난 문서에서만 나온다
- `first_review_wait_seconds`는 리뷰 없는 PR을 제외하고 `excluded_count`에 집계한다 (FR-STAT-004 AC-1). **제외 사유를 구분한다** — 리뷰가 없어서 값이 없는 것과 보강이 끝나지 않아 모르는 것은 다른 사실이므로 `excluded_reasons`에 `no_review`·`enrichment_pending`으로 나눈다
- **`API-STAT-001`의 `lead_time_median`은 여기의 `p50`과 같은 값이다** (FR-STAT-003 AC-6, DEV-390). 두 API가 같은 것을 다른 이름으로 내지 않는다
- 질의에 `seq:` 범위가 있으면 요청에 `seq_epoch`이 필요하다 (아래 공통 규칙)

### API-STAT-004 분포 집계 (CR-053, DEV-386)

- 목적: 현재 질의 조건 위에서 변경 규모의 구간별 문서 수와 비율을 반환한다.
- 관련 요구사항: FR-STAT-005

요청:

```json
POST /api/v1/analytics/distributions
{
  "query": "org:acme merged:2026-07-01..2026-08-01",
  "dimension": "changed_files"
}
```

응답 200:

```json
{
  "dimension": "changed_files",
  "total": { "value": 1842, "relation": "eq" },
  "buckets": [
    { "key": "1",       "from": 1,    "to": 1,    "count": 402, "ratio": 0.2183,
      "drill_down_query": "kind:pull_request org:acme merged:2026-07-01..2026-08-01" },
    { "key": "2-5",     "from": 2,    "to": 5,    "count": 731, "ratio": 0.3968, "drill_down_query": "..." },
    { "key": "6-20",    "from": 6,    "to": 20,   "count": 508, "ratio": 0.2758, "drill_down_query": "..." },
    { "key": "21-100",  "from": 21,   "to": 100,  "count": 173, "ratio": 0.0939, "drill_down_query": "..." },
    { "key": "100+",    "from": 101,  "to": null, "count": 21,  "ratio": 0.0114, "drill_down_query": "..." },
    { "key": "unknown", "from": null, "to": null, "count": 7,   "ratio": 0.0038, "drill_down_query": null }
  ],
  "approximate": false,
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

- `dimension`: `changed_files` | `changed_lines`
- 구간은 `FR-STAT-005` AC-1·AC-2가 정한 그대로다. 파일 수는 `1` / `2-5` / `6-20` / `21-100` / `100 초과`, 라인 수는 `1-50` / `51-200` / `201-1000` / `1000 초과`
- **`changed_lines`는 `additions + deletions`다** (FR-STAT-005 AC-2, DEV-386). 두 값을 따로 세지 않으며, **그 합은 색인 시점에 사전 계산해 저장한다** — 조회 시점 `script`로 더하는 구현은 `NFR-001`이 금지한다 (AC-7)
- **`unknown` 구간은 값이 없는 문서다** (AC-5). 보강이 끝나지 않아 모르는 것이며 **0과 다르다** — 파일 0개인 PR은 `unknown`이 아니라 자기 구간에 들어간다. `unknown`에는 근거 목록으로 갈 질의가 없으므로 `drill_down_query`는 `null`이다
- `ratio`는 `count / total`이며 `total`이 0이면 모든 구간이 `count: 0`·`ratio: 0`이다 (예외/실패 처리)
- 집계 대상은 `prs-pull-requests` 단독이다 (FR-STAT-005 AC-6)
- 오류: `AGGREGATION_TIMEOUT` (504)

### API-STAT 공통 규칙 (CR-053)

네 집계 API가 함께 지키는 것이다. 하나씩 다시 적지 않는다.

**모집단.** 넷 다 `prs-pull-requests` 단독을 집계한다. 목록 조회는 PR과 커밋을 함께 보므로 화면
총계와 집계 총계가 다를 수 있고, 그 차이는 오류가 아니라 **다른 것을 세기 때문**이다.

**질의 해석.** 검색과 **같은 파서**(`@prs/query`)를 쓴다. 집계 전용 문법을 따로 두지 않는다 —
같은 문자열을 두 파서가 해석하면 한쪽만 넓어지는 날 아무 오류도 나지 않는다.

**접근 범위.** 모든 집계 질의는 `ScopedQuery`를 지난다 (ADR-008). 목록에서 이미 걸렀다는 이유로
집계에서 생략하지 않는다 — **건수도 정보다.** 부분 샤드 실패(`_shards.failed > 0`)를 정상 집계로
반환하지 않는다.

**시퀀스 에폭.** 질의에 `seq:` 범위가 있으면 요청은 `seq_epoch`을 함께 싣는다 (FR-STAT-006 AC-6,
ADR-007 규칙 5). 처리 순서는 **질의 파싱 → 공간 지목 판정 → 접근 범위 산출 → 시퀀스 문맥 해석 →
에폭 유효성 → 집계**다. 요청 에폭이 현재와 다르면 집계를 **계산하지 않고** 아래를 반환한다.

```json
{
  "epoch_stale": true,
  "requested_seq_epoch": 3,
  "current_seq_epoch": 4,
  "correlation_id": "..."
}
```

현재 에폭으로 조용히 다시 해석하지 않으며 `total: 0`이나 빈 버킷으로 위장하지 않는다. 에폭은
질의 문자열의 토큰이 아니라 **질의 밖의 별도 재료**이므로 `drill_down_query`에 숫자로 끼워 넣지
않는다 — 근거 목록으로 갈 때는 유효 에폭을 응답의 별도 필드로 전달한다.

**근사 집계.** 대상이 100만 건을 넘으면 Elasticsearch의 `random_sampler` 집계로 표본을 잡고
`approximate: true`와 함께 `sample_probability`를 반환한다. **그것이 보장하는 것만 주장한다** —
건수는 표본 비율로 되돌린 추정값이고 백분위는 표본 기반이다. **근거 목록으로 가는 조회는
근사하지 않는다** (`drill_down_query`를 실행하면 정확한 목록이 나온다). 설명할 수 없는 숫자를
정확한 숫자처럼 반환하지 않는다.

**타임아웃.** 5초를 넘으면 `AGGREGATION_TIMEOUT` (504)과 함께 기간 축소를 안내한다
(FR-STAT-001 예외/실패 처리).

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

### API-ING-002 저장소 수집 진단 조회 (CR-050, DEV-350)

- 목적: W-009를 채운다 — 사용자의 접근 범위 안 등록 저장소마다 "왜 이 저장소 결과가 없는가"에 답할 진단 정보를 준다.
- 관련 요구사항: FR-ING-009 AC-6·AC-7·AC-10, FR-ING-006, FR-ING-011 AC-6, FR-SEQ-001, FR-SEQ-005, FR-AUTH-002
- 신설 사유: W-009는 일반 사용자 화면인데 이 정보를 가진 경로가 `API-ADM-001`·`API-ADM-006` 둘뿐이고 **둘 다 `operator` 전용**이다. 특히 `API-ADM-006`은 FR-ADMIN-001 AC-4가 그 제한을 직접 승인했고, 그 응답은 저장소를 식별하지 않는 전역 지표라 이 화면의 데이터 계약이 아니다. 권한을 완화하면 승인된 보안 계약을 뒤집으므로 **일반 사용자 경로를 따로 세운다** (DEV-350).

요청: `GET /api/v1/repositories?limit=50&cursor=...&repository=acme/payments`

- `limit` (optional, 기본 50, 최대 100)
- `cursor` (optional) — 다음 페이지. **오프셋 파라미터는 없다** (ADR-010)
- `repository` (optional) — `owner/name` **완전 일치**. W-001·W-002·W-005의 진단 딥링크와 카드 단위 재시도가 쓴다

응답 200:

```json
{
  "items": [
    {
      "repository_id": 4021,
      "repository": "acme/payments",
      "registration_state": "active",
      "registered_at": "2026-03-02T04:11:00.000Z",
      "last_ingested_at": "2026-08-27T23:58:12.000Z",
      "document_counts": { "pull_requests": 1200, "commits": 2400, "total": 3600 },
      "backfill": { "state": "running", "job_id": "914", "progress": { "processed": 820, "total": 1200 } },
      "sequence_spaces": [
        { "base_branch": "main", "last_sequence": 1342, "seq_epoch": 3, "sequence_state": "ok", "last_assigned_at": "2026-08-27T23:40:02.000Z" }
      ],
      "reconciliation": { "last_completed_at": "2026-08-27T23:00:00.000Z", "missing_count": 0 },
      "unavailable": []
    }
  ],
  "next_cursor": null,
  "correlation_id": "..."
}
```

**접근 범위가 이 조회의 전부다** (ADR-008·THR-004). 정본이 PostgreSQL이라 `applyMandatoryScopeFilter`의 타입 강제가 닿지 않으므로, 저장소 행은 `API-SEQ-006`과 **같은 `isRepositoryInScope` 판정**을 지난다. 범위 밖 저장소는 목록에도 집계에도 없고, **가려진 건수조차 싣지 않는다** — `API-ADM-006`의 `slowest_repositories_out_of_scope`와 다른 판단인 이유는 그쪽이 `operator` 전용 전역 지표이기 때문이다. `repository=` 완전 일치 조회도 같은 판정을 지나며, **미등록과 범위 밖은 같은 빈 결과다** (FR-ING-009 AC-10).

`registration_state`는 `active | archived`다. **해제된 저장소를 숨기지 않는다** (AC-7) — 해제는 신규 수집 중단이고 기존 문서는 남으므로(FR-ING-009 AC-3) 그 사실 자체가 사용자가 찾던 답이다.

`last_ingested_at`은 **그 저장소의 durable `raw_event` 중 가장 최근 `received_at`**이다. "PR Search가 마지막으로 이벤트를 받아 보관한 시각"이며 `processed_at`과 섞지 않는다 — 받았지만 처리가 밀린 상태와 아예 받지 못한 상태는 다른 사실이고, 검색 반영 여부는 문서 수·백필·조정 스캔이 따로 말한다. 받은 적이 없으면 `null`이다. 페이지의 저장소 ID 전체를 `raw_event_repo_idx`로 **한 번에** 읽는다.

`document_counts`는 **검색 대상 투영 문서**만 센다 — PR과 커밋이며 릴리스·간선·원본 아카이브는 포함하지 않는다. Elasticsearch를 읽으므로 PostgreSQL에서 이미 범위를 걸렀더라도 **필수 접근 범위 필터를 다시 지난다** (ADR-008) — "앞 단계에서 확인했으니 생략한다"는 예외를 만들면 그 예외가 곧 우회 경로가 된다. 페이지 전체를 인덱스당 집계 한 번으로 세며 저장소마다 세지 않는다.

`backfill`은 **기존 `job` 모델을 그대로 읽는다**(`type = backfill`, `target = owner/name`). 새 상태 enum을 만들지 않고 `job.state`와 `job.progress`를 싣는다. 진행 중 잡이 있으면 그것이 우선이고, 없으면 가장 최근 잡이며, 잡 이력이 없으면 `null`이다. 페이지 대상 전체를 한 번에 읽는다.

`sequence_spaces`는 `repository.sequence_branches`가 기준이다 — **등록된 브랜치를 전부 싣는다.** 공간 행이 없으면 `sequence_state: "unknown"` · `seq_epoch: null` · `last_sequence: null`이며 `0`으로 그리지 않는다(`API-SEQ-006`과 같은 판단, CR-029 DEV-152). `stale`·`reassigning`에서도 마지막 확정 서수를 숨기지 않는다 — 경고와 함께 값을 준다.

`reconciliation`은 FR-ING-011 AC-6이 보존하는 **최근 완료된 회차**의 값이다. 미룬 회차의 부분 집계는 여기 오지 않는다. 완료된 스캔 기록이 없으면 두 필드가 모두 `null`이며, **`missing_count: 0`과 `null`은 다른 사실이다.**

`unavailable`은 이번 응답에서 채우지 못한 항목 이름을 담는다. **한 항목의 실패가 그 저장소의 나머지 사실을 지우지 않는다** — Elasticsearch 집계가 실패해도 등록 상태·시퀀스 공간·백필은 그대로 나간다 (FR-ING-009 예외 처리).

**커서는 PostgreSQL 키셋이다.** 정본이 `repository` 표이므로 PIT도 `search_after`도 뜻이 없다 — `API-SRCH-005`와 같은 이유이며, 공유하는 것은 봉인 방식(`API-SRCH-004`의 HMAC 봉투)과 두 오류 코드뿐이다.

| 재료 | 값 |
| --- | --- |
| `v` | 커서 스키마 버전 |
| 정렬 위치 | 마지막 항목의 `owner` · `name` · `repository_id` |
| `repository` 필터 | 완전 일치 값이 있으면 그것 (바뀌면 지문 불일치) |
| 접근 범위 지문 | 정규화한 범위의 **해시**. **원본 사용자 식별자를 싣지 않는다** — 봉투는 서명돼 있을 뿐 암호화돼 있지 않다 |
| 만료 | 봉인 시각 기준 |

정렬은 `owner ASC, name ASC, repository_id ASC`다. 세 번째 키가 동률을 깨며, 앞의 둘만으로는 같은 `owner/name`이 유일하더라도 정렬 안정성을 계약으로 보장할 수 없다.

- 순회 중 팀 소속·접근 범위가 바뀌어 지문이 달라지면 `CURSOR_QUERY_MISMATCH` (400). 이어 보면 회수된 범위의 저장소를 계속 내주게 된다
- 훼손·서명 불일치·모르는 버전·만료는 `CURSOR_INVALID` (400)
- 오류: `INVALID_PARAMETER` (400 — `limit` 범위 초과, `repository` 형식 오류), `CURSOR_INVALID` (400), `CURSOR_QUERY_MISMATCH` (400), `UNAUTHENTICATED` (401), `PERMISSION_UNAVAILABLE` (503)

### API-ING-003 저장소 등록 검토 요청 (CR-050, DEV-351)

- 목적: 일반 사용자가 미등록 저장소의 등록 검토를 요청한 사실을 기록한다.
- 관련 요구사항: FR-ING-009 AC-8·AC-9·AC-10
- 신설 사유: 와이어프레임의 `repo.request_registration` 이벤트, QA-W009-05, `A-002-REQUESTS` 섹션, 상태 매트릭스의 `empty_no_repository` 복구 경로가 모두 이 기능을 전제하고 있었는데 **정본도 API도 수명주기 계약도 없었다** — 파생 UI가 SRS 밖의 기능을 서술하던 자리다 (DEV-351).

요청: `POST /api/v1/repository-registration-requests`

```json
{ "repository": "acme/payments" }
```

응답 201:

```json
{ "request_id": "318", "repository": "acme/payments", "created_at": "2026-08-28T01:20:00.000Z", "correlation_id": "..." }
```

**이 요청은 등록이 아니다.** 저장소를 등록하지 않고, 수집·채번·백필을 시작하지 않으며, 시퀀스 대상 브랜치·미러 사용 여부를 정하지 않는다. 실제 등록·해제는 `API-ADM-001`이 하고 `operator` 전용이다 (FR-ING-009 AC-1~AC-5).

**대상 저장소의 실재 여부를 확인하지 않는다** (AC-10). GitHub Enterprise에 묻지 않으며, 따라서 "있다 / 없다 / 볼 수 없다"를 응답으로 구분하지 않는다 — 구분하면 이 경로가 곧 비공개 저장소의 존재 신탁이 된다 (FR-AUTH-002 AC-4, THR-004). 요청자의 GHE 접근 권한도 확인하지 않으므로 **응답은 "권한이 있다"는 뜻도 아니다.**

**같은 사용자의 같은 식별자 반복 요청은 하나의 기록이다** (AC-9). 다시 보내도 실패가 아니며 기존 기록을 그대로 돌려준다 — 자연 멱등이고, 별도의 중복 오류 코드를 만들지 않는다. 다른 사용자가 같은 저장소를 요청하는 것은 각자의 기록이다.

클라이언트가 `repository_id`·`org_id`·`visibility`·`sequence_branches`·`mirror_enabled`·`backfill`을 보내도 **받지 않는다.** 그 값들은 등록 시점에 운영자가 정하며, 요청자가 주장하는 값을 신뢰하면 등록 계약이 클라이언트 입력으로 열린다.

**운영자가 이 요청을 보고 처리하는 경로는 이 CR의 범위가 아니다.** 승인·반려 상태, 처리자, 사유는 A-002를 세우는 WP-040이 정한다 — 지금 그 열들을 미리 만들면 그 WP가 검증하지 않은 수명주기를 선점하게 된다.

- 오류: `INVALID_PARAMETER` (400 — `repository`가 `owner/name` 형식이 아니거나 길이 제한 초과), `UNAUTHENTICATED` (401)

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

**`type`은 집는 러너가 있는 것만 받는다** — `backfill`(JOB-ING-004)과 **`link_rebuild`(JOB-REL-006 참조 간선 전량 재파생, CR-039)**. 다른 값을 조용히 큐에 넣으면 아무 워커도 잡지 않는 유령 잡이 남고, 운영자는 진행률이 영원히 0인 이유를 알 수 없다 (CR-022, DEV-103).

`link_rebuild`가 열려 있어야 하는 이유는 그것이 **PostgreSQL 정본에서 `prs-links`를 복구하는 유일한 경로**이기 때문이다 (ADR-004). Redis stream retention은 정본이 아니고, WP-029 이전의 직접 푸시 커밋에는 `EVT-ING-003`이 애초에 없었다 — 이 경로가 없으면 과거 엔티티와 재구축한 인덱스가 간선을 영원히 얻지 못한다.

`target`은 두 유형 모두 **`owner/repo`**다. 잡 유형마다 다른 형식을 쓰면 러너가 자기 행을 해석하지 못한다.

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
  "sequence_space_state": { "ok": 41, "stale": 2, "reassigning": 1, "unknown": 6 },
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
- **`sequence_space_state`는 시퀀스 공간 상태의 전역 요약이다** (FR-ADMIN-001 AC-1). `ok`·`stale`·`reassigning`·`unknown` 네 상태의 **건수만** 담고 저장소도 브랜치도 식별하지 않는다 — 다른 전역 집계와 같은 성질이므로 접근 범위를 거치지 않는다. v0.9까지 "WP-021 이후에 더한다"로 남아 있었으나 WP-021은 이미 완료됐고 AC-1이 이 항목을 `Must`로 요구한다 (CR-050, DEV-354). 조회에 실패하면 다른 항목처럼 `"unavailable"`로 두고 `unavailable` 배열에 이름을 싣는다
- **W-009는 이 API를 부르지 않는다.** 저장소별 시퀀스 공간 상태는 `API-ING-002`가 접근 범위 안에서 따로 준다 — 이 API의 전역 건수는 `operator`가 보는 파이프라인 건강 지표이고 AC-4가 그 제한을 정한다

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

**운영 가용 조건** (CR-034, DEV-177). 이 두 경로는 커밋 그래프 접근이 있어야 성립하므로 **GHE 자격 증명이 구성된 배포에서만 등록된다.** 미구성 배포에서는 경로가 서지 않되 기동 로그의 `capabilities`가 `sequence_integrity: false`로 그 사실을 밝힌다 — 조용히 404를 내지 않는다. 미러 볼륨은 요구하지 않는다: 대조에 필요한 것은 first-parent 체인 읽기뿐이라 API 그래프로 선다 (ADR-005의 폴백 경로).

**202 이후에 실제로 무슨 일이 일어나는가** (CR-034, DEV-178·182). `sequence_reassign` 잡은 `sequence` 역할의 러너가 claim해 실행하며, 잡 행에 `queued → running → completed | failed`가 남는다. **영구 `queued`는 없다** — 그 상태가 남으면 `job_active_uk` 때문에 같은 공간의 다음 요청이 전부 `JOB_CONFLICT`로 거절된다.

수동 복구는 자동 재작성 복구(FR-SEQ-005)와 **다른 전략**을 쓴다.

- 자동 경로는 `mergeBase(저장 head, 새 head)`까지를 검증된 구간으로 보고 복사한다. 그 가정은 **head가 움직였을 때만** 참이다.
- 수동 복구가 다루는 상황에는 **head는 그대로이고 중간이 손상된 경우**가 있다. 그때 `mergeBase`는 head 자신이라 자동 전략은 손상 구간을 통째로 복사하고 재계산할 커밋이 0건이 된다 — 아무것도 고치지 않고 에폭만 올린다.
- 그래서 수동 경로는 **최초 불일치 `N`을 경계로** 삼는다: `1..N-1`은 대조로 검증됐으므로 복사하고, `N..head`는 실제 first-parent 체인에서 다시 계산한다. `N = 1`이면 전체 재계산이다. 실제 체인이 짧아졌으면 새 `head_seq`도 그 길이에 맞춘다.
- **실행 시점에 정합성을 다시 읽는다.** 큐에서 기다리는 사이 저장소가 바뀔 수 있고, 이미 고쳐진 것을 다시 고치면 멀쩡한 에폭이 무효가 된다. 일치하면 무동작으로 완료한다(실패가 아니다).
- 권한은 `operator` 역할이다 (3장). `mode`는 `sample`(기본) 또는 `full`이다. `sample`은 **최근 1000 서수**를 대조한다 (FR-ADMIN-003 AC-2)
- `new_epoch_expected`는 **현재 에폭 + 1의 실제 계산 결과**다. 고정값이 아니다
- 잡 유형 `sequence_reassign`은 마이그레이션 009가 `job_type_chk`에 추가한다 (CR-033, DEV-172 / DEV-128 해소). 그 전에는 잡 행 생성이 CHECK 위반이었다

**점검 실패는 시퀀스 공간 상태를 바꾸지 않는다** (CR-033, DEV-171 / FR-ADMIN-003 예외 처리, SRS v2.5). 커밋 그래프를 읽을 수 없으면 점검을 실패로 끝내고 사유와 `correlation_id`를 낸다 — **`sequence_space.state`는 그대로 둔다.** `unknown`은 이미 "채번된 적 없는 브랜치"라는 뜻으로 API-SEQ-006·C-027·W-004가 표시하고 있고(CR-029), 거기에 "점검 실패"를 얹으면 한 번의 일시적 그래프 오류가 이미 선 화면들을 거짓말하게 만든다. **점검은 관찰이다** — 진단 실행의 실패는 진단 결과에 담기지 진단 대상의 정본 상태가 되지 않는다. 새 상태값 `check_failed`도 만들지 않는다.

```json
{
  "sequence_space": "acme/payments@main",
  "seq_epoch": 3,
  "mode": "sample",
  "check_state": "failed",
  "reason": "commit_graph_unavailable",
  "message": "커밋 그래프를 읽을 수 없어 점검을 마치지 못했습니다.",
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

성공한 점검은 `check_state: "completed"`이며 그때만 `consistent`·`checked_count`·`first_mismatch`·`impact_estimate`를 싣는다 — **실패를 `consistent: true`로 표현하지 않는다.** 검사하지 않은 것을 "일치"로 적으면 그것이 곧 거짓이다.

**`first_mismatch`는 최초 지점이다.** 서수 오름차순으로 대조하다 처음 어긋난 곳 하나만 낸다 — 그 뒤는 전부 밀린 결과이므로 나열해도 정보가 늘지 않는다. 일치하면 `null`이다.

**`impact_estimate`는 실제 데이터로 계산한다** — 계산하지 않은 항목을 `0`으로 채우지 않는다 (DEV-133과 같은 규율).

- `affected_commit_count`: 최초 불일치 서수 이상의 `merge_sequence` 행 수
- `invalidated_safe_marker_count`: 그 구간에 걸린 `safe_marker` 수. 표식이 하나도 없으면 `0`이 참이다
- `affected_saved_search_count`: 아래 규칙으로 센다

**`affected_saved_search_count`의 판정 규칙** (CR-033, DEV-173). 이 값은 *"정확히 이 공간만 가리키는 저장 검색 수"*가 아니라 **"재채번으로 의미가 바뀔 가능성이 있는 저장 검색 수"**다. 재채번은 서수의 뜻을 바꾸므로 `seq` 술어를 가진 검색만 영향을 받고, 대상을 좁히지 않은 검색은 대상을 포함할 수 있으므로 **보수적으로 센다.**

**질의 문자열을 정규식으로 훑지 않는다** — `@prs/query` 파서로 술어를 읽는다. `"seq:"`가 인용 안의 본문이거나 부정 필터일 때 문자열 검색은 전부 오답을 낸다.

| 조건 | 판정 |
| --- | --- |
| `seq` 술어가 없다 | **제외** — 재채번이 의미를 바꾸지 않는다 |
| `repo:`가 대상 저장소와 일치 | 후보 |
| `repo:`가 없다 | **후보** — 대상 저장소를 포함할 수 있다 |
| `repo:`가 있고 대상과 다르다 | 제외 |
| `base:`가 대상 브랜치와 일치 | 후보 |
| `base:`가 없다 | **후보** — 대상 브랜치를 포함할 수 있다 |
| `base:`가 있고 대상과 다르다 | 제외 |

파싱에 실패하는 저장 질의(이미 실행 불가능한 것)는 **세지 않는다** — 영향 수를 부풀리지 않는다.
### API-ADM-004 무중단 재색인

- 목적: 매핑·분석기가 바뀐 새 버전 인덱스를 정본에서 채우고 별칭을 원자적으로 옮긴다.
- 관련 요구사항: FR-ING-008, NFR-008
- 관련 화면: A-003 (진행률 표시는 WP-040)
- 관련 잡: JOB-ING-006

요청:

```json
POST /api/v1/admin/reindex
{ "alias": "prs-pull-requests" }
```

응답 202:

```json
{
  "job_id": 9114,
  "type": "reindex",
  "state": "queued",
  "alias": "prs-pull-requests",
  "source_index": "prs-pull-requests-v1",
  "target_index": "prs-pull-requests-v2",
  "correlation_id": "0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
}
```

- Authz: `operator` 전용.
- 오류: 400 `INVALID_PARAMETER` (알 수 없는 별칭), 409 `JOB_CONFLICT` (같은 별칭에 활성 재색인), 409 `REINDEX_BUSY` (다른 별칭이 재색인 중 — 아래 동시 실행 상한), 503 `PERMISSION_UNAVAILABLE`.

**`alias`만 받는다. 구체 인덱스 이름을 받지 않는다.** 허용 값은 안정 별칭 넷(`prs-pull-requests`·`prs-commits`·`prs-links`·`prs-releases`)이고, 클라이언트가 `prs-pull-requests-v99` 같은 대상을 지정하지 못한다. 다음 버전을 정하는 것은 **서버**다 — 현재 별칭이 가리키는 구체 인덱스를 읽어 **아직 쓰이지 않은 다음 버전**을 고른다. `v1 + 1`을 그대로 쓰지 않는다 (CR-046, DEV-309): 재색인이 `v2`를 만든 뒤 전환 전에 실패·취소되면 그 shadow는 **유계 정리 대상으로 남고 별칭은 여전히 `v1`을 가리킨다.** 그 상태에서 다시 시도하면 `v2`를 또 계산해 **인덱스 생성에서 실패**하고, 정리가 돌 때까지 복구 자체가 막힌다 — 실패한 재색인이 다음 재색인을 막는 것은 이 계약이 만들려는 상태가 아니다. 서버는 비어 있는 다음 번호를 고르거나, 별칭에 붙지 않은 고아 shadow를 **명시적으로 제거·인수한 뒤** 큐에 넣는다. 클라이언트가 대상을 고르면 이미 서비스 중인 인덱스를 대상으로 지목해 정본을 덮어쓰는 요청이 가능해진다.

`job.type`은 `reindex`, `job.target`은 **안정 별칭**이다. 같은 별칭에 활성 잡이 둘일 수 없는 것은 `job_active_uk` 부분 유니크 인덱스가 이미 강제한다.

**동시 실행 상한은 1이다** (CR-045, DEV-300). 전 별칭을 통틀어 활성 재색인은 하나뿐이다. 일반 잡의 동시 실행 3을 그대로 적용하지 않는 이유는 재색인이 **클러스터 자원을 통째로 쓰는 작업**이기 때문이다 — PR·커밋·간선을 동시에 전량 재구축하면 색인 부하와 cutover 판정이 함께 복잡해진다. 상한을 넘으면 `409 REINDEX_BUSY`이며 실행 중인 별칭을 함께 알려 준다. 실측으로 여유가 확인되면 그때 올린다.

**API-ADM-002의 일반 잡 생성 목록에 `reindex`를 넣지 않는다.** SRS가 API-ADM-004를 재색인의 진입점으로 이미 정했다. API-ADM-002는 목록·진행률·중단·취소라는 **공통 잡 표면**을 계속 소유하고, 생성만 이 경로가 갖는다. 두 진입점이 각자 알고리즘을 만들지 않도록 **enqueue seam은 하나**다 — CLI(`pnpm es:reindex --alias <별칭>`)도 같은 seam을 부른다 (CR-045, DEV-302).

#### 진행 단계 (`job.progress`)

**`job.state`에 새 값을 만들지 않는다.** 기존 여섯(`queued`·`running`·`paused`·`completed`·`failed`·`cancelled`)을 그대로 쓰고, 세부 단계는 `progress`에 둔다 — 상태 기계를 늘리면 이미 그 여섯으로 판정하는 모든 운영 경로가 새 값을 모른다.

| `progress.phase` | 뜻 |
| --- | --- |
| `prepare` | 대상 인덱스 생성 |
| `dual_write` | 이중 쓰기 활성화 기록 (fencing 안에서) |
| `backfill` | PostgreSQL 정본 스캔·색인 |
| `verify` | 전환 전 검증 |
| `cutover` | 별칭 원자 전환 |
| `retention` | 이전 인덱스 보관 대기 |

`progress`는 그 밖에 `source_index`·`target_index`·`documents_scanned`·`documents_written`·`failures`·`dual_write_since`·`switched_at`을 싣는다. **보관 정본도 여기다** (CR-045, DEV-299) — 완료된 잡 행의 `progress.target_index`(전환된 새 인덱스)·`progress.source_index`(보관 대상)·`progress.switched_at`이 정리 스윕의 입력이며, 그것만으로 충분하므로 **새 표를 만들지 않는다.**

#### 이 API가 하지 않는 것

- **부분 재색인이 없다.** 별칭 하나가 단위다. "이 저장소만" 같은 요청을 받으면 정본과 색인의 대조 가능성이 대상마다 갈린다.
- **자동 트리거가 없다.** 매핑이 바뀌었다는 것을 시스템이 스스로 판정해 재색인을 걸지 않는다 — 배포와 재색인의 순서는 운영자가 정한다.

### API-ADM-008 원본 아카이브 조회

- 목적: 운영자와 보안 담당자가 수신된 원본 웹훅 이벤트를 조사한다.
- 관련 요구사항: FR-ING-010
- 관련 화면: A-001 (`A-001-ARCHIVE`, 화면은 WP-040)

요청: `GET /api/v1/admin/raw-events`

| 파라미터 | 필수 | 설명 |
| --- | --- | --- |
| `delivery_id` | 아니오 | 전달 식별자 정확 일치. 주면 나머지 조건은 무시한다 (AC-4의 대조 경로) |
| `repository` | 아니오 | `owner/name` 정확 일치 |
| `event_type` | 아니오 | 웹훅 이벤트 유형 |
| `action` | 아니오 | 이벤트 동작 |
| `received_from`, `received_to` | 아니오 | 수신 시각 범위 (ISO 8601) |
| `include_payload` | 아니오 | 기본 `false`. `true`면 항목마다 원본 payload를 싣는다 |
| `limit` | 아니오 | 기본 25, 최대 100 |
| `cursor` | 아니오 | 다음 페이지 |

권한: `operator` **또는** `security_officer`. **그리고** 요청자의 접근 범위 필터를 지난다 (FR-ING-010 AC-6).

응답 200:

```json
{
  "items": [
    {
      "delivery_id": "8f2c1e40-...",
      "event_type": "pull_request",
      "action": "closed",
      "repository": "acme/payments",
      "repository_id": 4021,
      "received_at": "2026-08-28T11:02:44.000Z",
      "correlation_id": "0f1d..."
    }
  ],
  "next_cursor": null,
  "index_available": true
}
```

- **접근 범위는 `repository_id` 목록으로 결합한다** (PR #65 리뷰). 엔티티 인덱스의 `org_team` 갈래(`org_id`·`visibility`·`allowed_team_ids`)를 쓰지 않는다 — 아카이브 문서에는 그 셋이 없고, 담아 두면 저장소의 가시성이 바뀌는 순간 낡는다. **낡은 접근 통제 재료는 그 자체가 유출 경로다.** 대신 같은 저장소 집합을 `explicit` 표현으로 고정해서 건다: 캐시된 접근 범위는 크기와 무관하게 언제나 저장소 목록을 들고 있고, 500개를 넘을 때의 조직·팀 치환은 **결과 집합이 같아야 한다**는 규칙 아래 있다(보안 문서 5.2). 규칙이 두 곳에 사는 것이 아니라 같은 집합의 다른 표현이다
- **역할 제한은 접근 범위 필터를 대체하지 않는다** (AC-6, THR-044). 역할은 이 엔드포인트를 부를 **자격**을 정하고, 무엇이 보이는지는 `ADR-008`의 필수 접근 범위 필터가 정한다. 접근 범위 밖 저장소의 원본과 **미등록 저장소의 원본**(`repository_id`가 없다)은 조회되지 않는다 — 후자는 어떤 접근 범위에도 속하지 않으며, 그 존재를 내주면 `FR-AUTH-002` AC-4가 막는 존재 신탁이 된다
- **`payload`는 기본으로 싣지 않는다.** 아카이브는 5억 건 규모(NFR-003)이고 payload는 건당 평균 8KB인 임의 JSON이다. 목록 응답의 기본값으로 두면 조사자가 원본을 보려던 것이 아닐 때도 그것을 내주게 되고, 그 노출은 되돌릴 수 없다. `include_payload=true`는 **명시적 열람 의사**이며 감사 기록에 그대로 남는다
- **`repository_id`는 필터의 재료이고 `repository`는 사람이 읽는 값이다.** 아카이브 문서는 둘을 함께 담는다 (`ENT-ING-003`). 하나만 담으면 접근 범위 필터를 걸 수 없거나(전자가 없을 때) 조사자가 저장소를 알아볼 수 없다(후자가 없을 때)
- **`index_available: false`는 오류가 아니다.** 아카이브 인덱스가 아직 없거나 ILM이 전 구간을 지운 상태에서는 빈 목록과 함께 이 값을 `false`로 준다. 500을 내지 않는다 — **레인 B의 부재가 운영 콘솔을 막으면 두 레인의 독립(AC-3)이 조회 쪽에서 깨진다**
- **정렬은 `received_at` 내림차순 + `delivery_id` 오름차순이다.** 두 번째 키가 타이브레이커이며 **없으면 전순서가 서지 않는다** — 동시 웹훅은 같은 밀리초를 흔히 만들고, 페이지 경계가 그 무리를 가르면 문서가 빠지거나 겹친다 (PR #65 리뷰). 커서는 두 값을 함께 봉인한다. **`search_after` 키셋이며 PIT을 쓰지 않는다** — 아카이브는 append-only 시계열이라 순회 중 앞쪽에 문서가 끼어들지 않고, ILM이 지우는 것은 순회의 꼬리다. PIT은 클러스터 자원을 쓰고 그 비용은 아직 운영 규모로 측정되지 않았다(DEV-058). **W-001의 PIT 커서와 합치지 않는다** — 재료도 수명도 다르다
- **`include_payload=true`는 감사 기록에 남는다** (`raw_event.view_payload`, 보안 문서 7장). 목록 조회 자체는 남기지 않는다 — 되돌릴 수 없는 노출은 원본을 펼친 요청뿐이고, 모든 조회를 남기면 그 신호가 묻힌다
- 커서 지문에는 질의 조건과 접근 범위, `include_payload`가 들어간다. `include_payload`를 도중에 켜면 지문이 달라져 `CURSOR_QUERY_MISMATCH`가 된다 — 같은 순회 안에서 노출 범위가 조용히 바뀌지 않는다

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
| `REINDEX_BUSY` | 409 | 다른 별칭이 재색인 중 (동시 실행 상한 1) | 실행 중인 재색인 완료 대기 |
| `SAVED_SEARCH_LIMIT` | 409 | 저장 100건 초과 | 기존 항목 삭제 |
| `SAVED_SEARCH_NAME_CONFLICT` | 409 | 같은 이름의 내 저장 검색이 이미 있음 (CR-049) | 이름 변경 |
| `SAVED_SEARCH_QUERY_INVALID` | 409 | 저장된 질의가 현재 문법에서 무효인데 실행을 요청 (CR-049). `detail.reason`이 `epoch_stale`·`sequence_unbound`를 가른다 (CR-051) | 질의 수정 또는 에폭 재연결(저장자) |
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
| API-SRCH-001~004, API-SEQ-001~003, API-SEQ-006, API-REL-001~002, API-REL-005 | stable | 하위 호환만. 필드 제거·의미 변경은 `/api/v2` |
| API-STAT-001~004, API-SEQ-004~005, API-REL-003~004, API-REL-006 | stable | 위와 동일 |
| API-ADM-* | internal | 운영 콘솔 전용. 프런트엔드와 동시 배포 전제로 변경 가능 |
| API-ING-001 | external | GHE 계약. 변경 시 웹훅 재등록 필요 |

버전 정책: 경로 접두 `/api/v1`. 하위 호환 변경(필드 추가, 새 enum 값에 대한 관대한 처리)은 버전을 올리지 않는다. 필드 제거·타입 변경·의미 변경은 `/api/v2`를 신설하고 최소 1개 릴리스 동안 병행 운영한다.
