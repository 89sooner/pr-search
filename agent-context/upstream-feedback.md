# Upstream Feedback

## 재색인 후 `merge_seq`가 ES에서 사라져 M number 정렬이 깨진다 (설계 갭)

**발견**: 0.1.0-pilot.17 사내 운영, `prs-pull-requests` 재색인 후 (2026-09-22)  
**관련**: WP-074 / FR-SEQ-008 / ADR-004 / `packages/es/src/sequence.ts` / `apps/pipeline-worker/src/reindex.ts`

### 현상

Search 페이지에서 "M number" 내림차순 정렬이 "Merged at" 내림차순과 다른 결과를 보인다.  
M-1900-1450이 M-1900-1449보다 아래에 나타나는 등 M 번호 역순이 깨진다.

원인은 ES `merge_seq` 필드가 대량으로 비어 있기 때문이다.

| 시점         | ES `merge_seq` 있는 PR | DB `merge_sequence` 행 |
| ------------ | ---------------------: | ---------------------: |
| 재색인 전    |             38 / 1,906 |                  1,467 |
| 재색인 직후  |              0 / 4,214 |                  1,467 |
| 수동 복구 후 |          1,457 / 4,214 |                  1,467 |

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
   DB `merge_sequence` 테이블에서 `commit_sha → merge_seq` 매핑을 읽어 ES `update_by_query`로 직접 씀:

5. `merge_sequence`에서 매핑 추출
6. 500개 청크로 분할
7. ES `update_by_query`로 `merge_commit_sha`가 매칭되는 PR 문서에 `merge_seq`, `seq_epoch`, `sequence_space`, `base_branch`를 씀
8. 1,457문자 업데이트 확인 (10개는 PR 없는 direct push로 `merge_commit_sha` 없음)

### 요청

1. **재색인 후 `merge_seq` 재투영 경로 추가** — `requestMergeNumberMaterialize`가 `merge_number`를 위해 하는 일을 `merge_seq`에도 해야 한다. 재색인 완료 후 `applySequenceToDocuments`를 전체 시퀀스에 대해 실행하거나, 동등한 `update_by_query`를 예약하는 단계가 `rebuildAlias`에 있어야 한다. 현재 주석은 "재구축 뒤에 돈다"고 가정하지만 그 경로가 트리거되지 않는다.

2. **`merge_seq`에 durable work 재시도 추가** — `merge_number`의 `materialize` work는 ES에 쓸 때까지 재시도한다. `merge_seq`에도 같은 규율이 필요하다. `applySequenceToDocuments`가 fire-and-forget이면 타이밍 불일치로 영영 빠진다. 개별 PR 단위의 `update` (GET → 가드 → `update` 스크립트)로 바꾸거나, `update_by_query` 결과의 `updated` 수가 예상과 다르면 work를 재시도해야 한다.

3. **`sequence_assign` 잡에 `--force-reproject` 옵션 추가** — 수동 트리거 시 "새로 할당된 것만"이 아니라 "DB에 있는 전체 시퀀스를 ES에 다시 쓰는" 모드가 있어야 한다. 운영자가 재색인 후 이 모드로 실행하면 복구할 수 있다. 현재는 `sequence_assign`이 아무 일도 하지 않고 `completed`로 끝난다.

4. **`sequence_reassign`이 `consistent`일 때도 ES에 쓰기** — `repairSequence`가 "이미 일관적"이라고 판정해도 ES에는 `merge_seq`가 비어 있을 수 있다. `consistent`는 DB의 일관성이지 ES의 일관성이 아니다. ES 투영 상태를 함께 검사하거나, `consistent`일 때도 `applySequenceToDocuments`를 전체에 대해 실행해야 한다.

---

## 검색창에서 M-번호 완전 검색이 안 된다 (기능 누락)

**발견**: 0.1.0-pilot.17 사내 운영 (2026-09-22)  
**관련**: FR-SRCH-001 / FR-SRCH-004 / `packages/query/src/identifier.ts` / `packages/query/src/keys.ts` / `apps/search-api/src/sequence/merge-numbers.ts`

### 현상

검색창에 `M-1900-1450`을 입력하면 PR 하나가 나오는 것이 아니라 전문 검색(full-text)으로 처리되어 의도한 결과가 나오지 않는다.

### 근본 원인: 식별자 판별기가 M-번호를 모른다

`detectIdentifier` (`packages/query/src/identifier.ts:194`)는 다음만 인식한다:

1. GHE URL (`https://host/owner/repo/pull/1234`, `/commit/<sha>`)
2. `#1234` / `owner/repo#1234`
3. 순수 정수 (PR 번호)
4. 7~39자 hex (커밋 SHA 접두)
5. 40자 hex (커밋 SHA 정확)

`M-1900-1450` 형식은 어디에도 맞지 않아 `text` 해석으로 떨어진다 (`identifier.ts:256-258`).

### `mnum:` 쿼리 키는 있지만 범위 전용

`mnum:` 키가 등록되어 있다 (`keys.ts:67`), 그러나:

- **range-only** — 스칼라 `mnum:1450`는 파서가 거부한다 (`parse.ts:200-202`, `rangeOnlyKey` 에러)
- 단일 검색조차 `mnum:1450..1450`으로 써야 한다
- `repo:` + `base:` 바인딩이 필수이고 `merge_number_epoch` 게이트가 걸려 있다 (`query-builder.ts:158-168`)
- M-번호 표시 문자열(`M-1900-1450`)이 아니라 숫자 ordinal(`1450`)만 다룬다

### resolve API는 있지만 검색과 연결되지 않는다

`GET /api/v1/merge-numbers/resolve` (`apps/search-api/src/sequence/merge-numbers.ts:100`)가 `M-1900-1450` 문자열을 파싱하여 PR을 찾는다 (`packages/domain/src/mnumber.ts:69`, 정규식 `/^M-([0-9]+)-([1-9][0-9]*)$/`).

그러나 이 API는 검색 쿼리 언어가 아니라 URL 파라미터(`m_number`, `m_repository`, `m_base_branch`, `m_seq_epoch`)로만 접근한다 (`apps/web/lib/merge-number.ts:27-32`). 검색창 `q`와 연동되지 않는다.

### 요청

1. **식별자 판별기에 M-번호 패턴 추가** — `detectIdentifier`가 `M-<code>-<number>` 정규식을 인식하여 `merge_number` 해석을 반환하도록 추가. `packages/domain/src/mnumber.ts:20`의 정규식(`/^M-([0-9]+)-([1-9][0-9]*)$/`)을 재사용. 해석 결과로 resolve API를 호출하거나 `mnum:` 쿼리로 변환하면 검색창에서 `M-1900-1450` 입력 한 줄로 PR을 찾을 수 있다.

2. **`mnum:` 스칼라 검색 지원** — range-only 제약을 풀고 `mnum:1450` 단일 값 검색을 허용. `repo:` + `base:` 바인딩이 생략되면 (M-번호의 code 부분으로 저장소를 역산하거나) 접근 범위 내 전체 저장소에서 검색. 현재는 `mnum:1450..1450` + `repo:` + `base:`를 모두 써야 하는 것이 사용자 관점에서 비현실적이다.

---

## 수집 파이프라인에서 머지된 M-번호 단위로 커밋에 태그를 달아야 한다 (기능 누락)

**발견**: 0.1.0-pilot.17 사내 운영 (2026-09-22)  
**관련**: FR-SEQ-008 / `packages/es/src/mappings/commits.ts` / `apps/pipeline-worker/src/mnumber.ts` / `apps/pipeline-worker/src/release.ts`

### 확정 요건

M-number 할당 완료 후 해당 merge commit SHA에 **Lightweight Tag**를 자동 생성하여 GHE 원격 저장소에 push한다.

태그 명명 규칙: `M-{BR#}-{N}` (예: `M-1900-1`, `M-1900-1450`, `M-1900-2130`)

- `{BR#}` = M-number의 branch/repository code
- `{N}` = 해당 sequence의 ordinal
- **Annotated Tag가 아닌 Lightweight Tag 사용** (tagger/message/GPG 불필요)
- 로컬 mirror에만 만들지 말고 GHE 원격 저장소의 `refs/tags/M-{BR#}-{N}`에 반영

### Tag 생성 처리 순서

1. PR merge commit SHA 확정
2. 기존 로직에서 M-number atomic 할당
3. DB에 `M-number ↔ merge_commit_sha` 확정
4. `M-{BR#}-{N}` Lightweight Tag 생성 요청을 **durable work로 등록**
5. 원격 GHE의 동일 tag 존재 여부 확인
6. tag 없음 → 생성 후 push
7. tag 존재 + 동일 SHA → 성공으로 간주 (idempotent)
8. tag 존재 + 다른 SHA → **절대 force-update 금지**, conflict/failure 처리
9. 실패한 tag materialization은 성공할 때까지 재시도

### ES 투영 요건

`prs-commits`에 다음 필드 추가 (실제 merge commit `role: merge_commit`에만 투영):

- `merge_number`
- `merge_number_epoch`
- `merge_number_state`

현재 `prs-commits`에는 `merge_seq`는 있지만 `merge_number` 관련 필드가 없다.

두 경로는 역할이 다르며 둘 다 필요하다: Git Lightweight Tag(Git revision 직접 사용) + Commit ES projection(PR Search 검색·정렬).

### 재처리 / reconcile 요건

tag는 durable work로 관리. 재색인·worker 재시작·Git push 실패 후에도 원격 저장소에 tag가 존재해야 한다.

DB `merge_sequence`와 원격 `refs/tags/M-*` 정합성 검사 기능 필요:

- DB에는 있으나 remote tag 없음 → 재생성
- 다른 SHA를 가리키는 tag → 자동 수정 금지, 오류 보고
- 운영자가 전체 또는 특정 범위를 재검증할 수 있는 관리 경로 제공

### 요청

1. **M-number 할당 후 Lightweight Tag를 자동 생성·push** (형식: `M-{BR#}-{N}`, 대상: squash merge commit SHA)

2. **Tag materialization을 durable / idempotent하게 구현** (force update 금지, 네트워크 장애 시 재시도, worker 재시작 후 복구)

3. **`M-*` tag 불변성 보호** (생성 후 이동·삭제 금지, GHE repository rule/tag protection 적용, 잘못 생성된 tag는 별도 무효화/정정 정책)

4. **커밋 ES 문서에 M-number 투영** (`prs-commits`에 `merge_number`, `merge_number_epoch`, `merge_number_state` 추가, `role: merge_commit`에만)

5. **재처리 / reconcile 기능 추가** (DB↔remote tag 정합성 검사, 누락 tag 재생성, SHA 불일치는 오류 보고만)

6. **M-number를 Git revision으로 사용하는 동작을 테스트**
   - `git rev-parse M-1900-1450`, `git show M-1900-1450`
   - `git diff M-1900-2010..M-1900-2130`, `git log M-1900-2010..M-1900-2130`
   - `git checkout M-1900-2010`, `git log --oneline --decorate`
   - lightweight tag를 포함한 `git describe --tags`
