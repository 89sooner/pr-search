# Upstream Feedback

## 재색인 후 `merge_seq`가 ES에서 사라져 M number 정렬이 깨진다 (설계 갭)

> **상류 반영 (`CR-113` / WP-098, DEV-733, 2026-09-22) — 요청 1~4를 전부 받아들였고 원인 분석과 같다.** 수렴 경로가 없었다는 진단이 맞다: 채번 뒤 단발 `update_by_query`는 문서가 없으면 0건으로 끝나 다시 오지 않았고, 직접 푸시 커밋 문서는 `sequence.assigned` 이벤트 **뒤에** 보강이 만들어 구조적으로 서수를 받지 못했으며, 재색인은 replay가 없었다. 고친 것: (1) 서수 쓰기를 문서 ID 기반 guarded update(`packages/es/src/sequence-projection.ts` — `mget` 사전 판정 + painless 가드, 문서별 `updated`·`noop`·`document_missing`·`guard_rejected`·`stale_epoch`·`transient`)로 바꾸고 옛 `applySequenceToDocuments`를 지웠다. (2) 채번·재채번·복구 트랜잭션이 durable `sequence_work` `project`(`tail`·`full`)를 남기고, 늦은 PR 스냅숏은 문서 단위 work를, 커밋 보강은 문서 생성 직후 인라인 투영을 한다 — 새 push 없이 수렴하며 `MNUMBER_ENABLED=false`에서도 돈다(마이그레이션 034). (3) 재색인은 PR·커밋 재구축 직후 현재 정본을 replay하고 `verifyBeforeCutover`가 target 인덱스의 원시 필드·대표 정렬을 정본과 대조하며, 전환 울타리 안에서 에폭을 다시 본다. (4) `sequence_reassign`이 `consistent`여도 full sweep을 예약하고 잡 `progress`에 `db`/`projection`을 따로 적는다. 요청 3의 `--force-reproject`는 새 잡 유형 `sequence_reproject`(API-ADM-002, `expected_epoch` 필수)와 `./prsctl sequence reproject --repository <owner/name> --base-branch main --expected-epoch <현재 에폭> [--dry-run]`(RUNBOOK 7.E, RB-27)으로 들어왔다 — dry-run은 PG·ES·작업 큐·감사에 아무것도 쓰지 않는다. **재투영은 재채번이 아니다** — 기존 `merge_seq`·M 번호·에폭·head는 바뀌지 않으며, 이 보고의 「사내 임시 조치」(`update_by_query` 직접 실행)는 더 이상 쓰지 않는다(문서별 판정 없이 덮어쓴다). 반입 뒤 할 일: `./prsctl upgrade`(034 적용) 뒤 저장소마다 `./prsctl sequence reproject … --dry-run`으로 `would_update` 건수를 보고, `--dry-run` 없이 실행한 뒤 새 검색 요청으로 「M number」 정렬·`seq:` 범위를 확인해 이 항목 아래에 적어 달라. 사내 배포 SHA는 이 저장소에서 확인하지 못했다(pilot.17 태그 없음, NOT VERIFIED) — 반입 시 `./prsctl lineage`로 함께 적어 달라.

**발견**: 0.1.0-pilot.17 사내 운영, `prs-pull-requests` 재색인 후 (2026-09-22)
**관련**: WP-074 / FR-SEQ-008 / ADR-004 / `packages/es/src/sequence.ts` / `apps/pipeline-worker/src/reindex.ts`

### 현상

Search 페이지에서 "M number" 내림차순 정렬이 "Merged at" 내림차순과 다른 결과를 보인다.
M-1900-1450이 M-1900-1449보다 아래에 나타나는 등 M 번호 역순이 깨진다.

원인은 ES `merge_seq` 필드가 대량으로 비어 있기 때문이다.

| 시점         | ES `merge_seq` 있는 PR | DB `merge_sequence` 행 |
| ------------ | ---------------------- | ---------------------- |
| 재색인 전    | 38 / 1,906             | 1,467                  |
| 재색인 직후  | 0 / 4,214              | 1,467                  |
| 수동 복구 후 | 1,457 / 4,214          | 1,467                  |

### 근본 원인: `merge_seq`의 ES 투영이 fire-and-forget이며 재색인 뒤 재투영 경로가 없다

`merge_seq`와 `merge_number`는 서로 다른 코드 경로로 ES에 쓰인다.

**`merge_seq`** — `applySequenceToDocuments` (`packages/es/src/sequence.ts:71`):

- `update_by_query`로 `merge_commit_sha`가 매칭되는 PR 문서에 `merge_seq`를 쓴다.
- **새로 할당된 시퀀스만** `applied` 배열에 들어가서 ES에 쓰인다 (`sequence.ts:267-278`).
- 이미 DB에 할당된 시퀀스는 `applied`에 들어가지 않으므로 ES에 재투영되지 않는다.
- 실패해도 던지지 않고 다음 push 회차에 맡긴다 (`sequence.ts:283-299`).
- **재시도 메커니즘이 없다.** `merge_number`의 `materialize` durable work에 해당하는 것이 `merge_seq`에는 없다.

**`merge_number`** — `applyMergeNumberToDocument` (`packages/es/src/merge-number.ts:64`):

- 개별 PR 문서를 GET으로 읽어 가드 검사 후 `update` 스크립트로 쓴다.
- `materialize` durable work가 `done`이 될 때까지 재시도한다 (`mnumber.ts:469-488`).
- 재색인 후에도 `requestMergeNumberMaterialize`가 `materialize` work를 다시 예약한다 (`reindex.ts:578-609`).

**재색인** — `runReindexJob` (`apps/pipeline-worker/src/reindex.ts:736`):

- PostgreSQL 스냅숏에서 문서를 다시 만든다.
- 스냅숏에는 `merge_seq`가 없다 — 투영이 그 키를 싣지 않기 때문이다 (`reindex.ts:343-345` 주석: "서수는 여기서 싣지 않는다. 채번 반영은 `applySequenceToDocuments`가 소유하고 그 경로가 재구축 뒤에 돈다").
- `merge_number`는 `requestMergeNumberMaterialize`로 재투영 의도를 남긴다 (`reindex.ts:621`).
- **`merge_seq`에 해당하는 재투영 단계가 없다.** 주석이 "재구축 뒤에 돈다"고 가정하지만, 그 경로가 실제로 트리거되지 않는다.

**`sequence_assign` 잡** — 수동 트리거해도 이미 DB에 할당된 시퀀스는 "새로 할당할 것이 없다"로 끝나고, `applied`가 빈 배열이 되어 ES에 아무것도 쓰지 않는다.

**`sequence_reassign` 잡** — `repairSequence`가 "이미 일관적"이라고 판정하면 `consistent`를 반환하고 에폭을 올리지 않으므로 ES 재투영이 일어나지 않는다.

### 타이밍 불일치 (초기 투영 갭)

재색인이 아니어도 발생한다. `applySequenceToDocuments`가 실행될 때 PR 문서에 `merge_commit_sha`가 아직 없으면 (투영이 덜 되었으면) `update_by_query`가 매칭되는 문서 0개로 끝난다. 나중에 투영이 `merge_commit_sha`를 채워도 `applySequenceToDocuments`는 재실행되지 않으므로 `merge_seq`가 영영 빠진다.

운영 서버에서 재색인 전 38개만 `merge_seq`가 있었던 것이 이 패턴이다 — 나머지 1,429개는 시퀀스 할당 시점에 PR 문서에 `merge_commit_sha`가 없었고, 이후 재투영 경로가 없었다.

### 사내 임시 조치

DB `merge_sequence` 테이블에서 `commit_sha → merge_seq` 매핑을 읽어 ES `update_by_query`로 직접 씀:

1. `merge_sequence`에서 매핑 추출
2. 500개 청크로 분할
3. ES `update_by_query`로 `merge_commit_sha`가 매칭되는 PR 문서에 `merge_seq`, `seq_epoch`, `sequence_space`, `base_branch`를 씀
4. 1,457문자 업데이트 확인 (10개는 PR 없는 direct push로 `merge_commit_sha` 없음)

### 요청

1. **재색인 후 `merge_seq` 재투영 경로 추가** — `requestMergeNumberMaterialize`가 `merge_number`를 위해 하는 일을 `merge_seq`에도 해야 한다. 재색인 완료 후 `applySequenceToDocuments`를 전체 시퀀스에 대해 실행하거나, 동등한 `update_by_query`를 예약하는 단계가 `rebuildAlias`에 있어야 한다. 현재 주석은 "재구축 뒤에 돈다"고 가정하지만 그 경로가 트리거되지 않는다.

2. **`merge_seq`에 durable work 재시도 추가** — `merge_number`의 `materialize` work는 ES에 쓸 때까지 재시도한다. `merge_seq`에도 같은 규율이 필요하다. `applySequenceToDocuments`가 fire-and-forget이면 타이밍 불일치로 영영 빠진다. 개별 PR 단위의 `update` (GET → 가드 → `update` 스크립트)로 바꾸거나, `update_by_query` 결과의 `updated` 수가 예상과 다르면 work를 재시도해야 한다.

3. **`sequence_assign` 잡에 `--force-reproject` 옵션 추가** — 수동 트리거 시 "새로 할당된 것만"이 아니라 "DB에 있는 전체 시퀀스를 ES에 다시 쓰는" 모드가 있어야 한다. 운영자가 재색인 후 이 모드로 실행하면 복구할 수 있다. 현재는 `sequence_assign`이 아무 일도 하지 않고 `completed`로 끝난다.

4. **`sequence_reassign`이 `consistent`일 때도 ES에 쓰기** — `repairSequence`가 "이미 일관적"이라고 판정해도 ES에는 `merge_seq`가 비어 있을 수 있다. `consistent`는 DB의 일관성이지 ES의 일관성이 아니다. ES 투영 상태를 함께 검사하거나, `consistent`일 때도 `applySequenceToDocuments`를 전체에 대해 실행해야 한다.
