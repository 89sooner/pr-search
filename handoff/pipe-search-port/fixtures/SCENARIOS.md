# SCENARIOS — 합성 fixture와 시나리오 연결표

> 분류: 인수인계 자료 · 기준 SHA `da0ed9b5bd8fac59c7fcf02c593f69962468be4d`

이 디렉터리의 JSON은 전부 **합성 데이터**다. 실제 회사 코드, 실제 사용자 이름, 비공개 PR 본문, 토큰이 들어 있지 않다. 저장소 이름 `demo/modem`, 작성자 `dev-a`~`dev-d`·`kim-jh`·`lee-sy`, PR 번호, 커밋 SHA는 모두 지어낸 값이다.

**123건이라는 숫자는 demo 데이터이지 실제 시스템 지표가 아니다.**

## 0. 검증 상태

| 항목 | 상태 |
|---|---|
| JSON 문법 | 52개 전부 통과 |
| 계약 구조 검증 | 52개 전부 통과 (`validate-fixtures.mjs`) |
| 검증 범위 | 필수 키의 존재, `null` 허용 여부, 리터럴 union 값(`kind`, `status`, `merge_number_state`, `total.relation`), `sequence_space` 형식, `pull_request_numbers`의 세 상태, `epoch_stale` 응답의 키 생략 |
| 실행 명령 | `node fixtures/validate-fixtures.mjs` (Node 20 이상, 의존성 없음) |

fixture를 고치면 **반드시 이 검증기를 다시 돌린다.** 검증기가 통과하지 못하는 fixture는 계약을 벗어난 것이므로, 검증기를 느슨하게 고치는 대신 fixture를 고친다.

## 1. 파일 목록

### 1.1 검색 목록 (`GET /api/search`)

| 파일 | 내용 |
|---|---|
| `search-page1.json` | 50건, `next_cursor: "CURSOR_P2"`, `total: { value: 123, relation: "eq" }`, facet 세 종류 포함 |
| `search-page2.json` | 50건, `next_cursor: "CURSOR_P3"`, **facet 없음** |
| `search-page3.json` | 23건, `next_cursor: null`, facet 없음 |
| `search-total-gte.json` | 1페이지와 같되 `total: { value: 10000, relation: "gte" }` |
| `search-empty.json` | 0건. `relaxation_hints`가 붙는다 |
| `search-epoch-stale.json` | `epoch_stale: true`. **`items`·`total`·`facets` 키가 없다** |
| `search-mnumber-states.json` | M 배지 아홉 경우 |
| `search-messy-rows.json` | 긴 한글 제목, `null` 제목, `+0`과 `null`의 구별, 알 수 없는 상태, 직접 푸시 커밋 |

세 페이지의 성질은 다음과 같다. 이 값들은 실측했다.

```text
페이지별 건수      50 / 50 / 23   합계 123
PR 번호 중복       없음
merge_seq 중복     없음. 1..123을 빠짐없이 덮는다
정렬               pr_number 내림차순 (서버가 정렬한 결과를 그대로 재현한다)
PR 번호 순서 ≠ 반영 순서인 지점   6곳
facet               1페이지에만 있다
kind                전부 pull_request
```

**PR 번호 순서와 반영 순서를 일부러 어긋나게 만들었다.** 이 제품이 존재하는 이유가 "PR 번호는 생성 시각에 붙으므로 반영 순서를 말하지 못한다"이기 때문이다. PR 번호로 정렬한 목록에서 `M number` 열이 순서대로 내려가지 않는 것이 정상이며, 이것을 버그로 고치면 안 된다.

**`kind:pull_request` 검색 결과에 커밋 행을 섞지 않았다.** 직접 푸시 커밋 예시는 `search-messy-rows.json`에만 두었고, 그것은 `kind:commit` 조회(Commit history 탭)나 식별자 해석에서 나오는 모양을 보여 주기 위한 것이다.

### 1.2 식별자 해석 (`GET /api/resolve`)

| 파일 | 용도 |
|---|---|
| `resolve-pr.json` | PR 하나로 해석된다 |
| `resolve-sha-from-ok.json` | 단일 커밋, `merge_seq: 42`, 공간 `demo/modem@main` |
| `resolve-sha-to-ok.json` | 단일 커밋, `merge_seq: 80`, 같은 공간 |
| `resolve-sha-ambiguous.json` | 커밋 후보 **2개**. 첫 후보를 고르지 않아야 한다 |
| `resolve-sha-unsequenced.json` | `merge_seq: null` |
| `resolve-sha-other-branch.json` | 공간이 `demo/modem@develop` |
| `resolve-sha-reversed.json` | `merge_seq: 80`. `from`에 넣어 역전을 만든다 |
| `resolve-empty.json` | 0건 + `reason_code` + `hint`. **200이다** |
| `resolve-truncated.json` | 후보 50건 + `truncated: true` |

### 1.3 저장소 목록 (`GET /api/repositories`)

| 파일 | 내용 |
|---|---|
| `repositories-page1.json` | 100건, `next_cursor: "REPO_C1"`. 첫 항목 `demo/modem`이 브랜치 세 개를 가진다 |
| `repositories-page2-empty.json` | **빈 배열** + `next_cursor: "REPO_C2"`. 권한 필터 때문에 생기는 빈 페이지다 |
| `repositories-page3.json` | 8건, `next_cursor: null`. `demo/late-repo`가 여기 있다 |
| `repositories-empty.json` | 0건. 접근 가능한 저장소가 없는 경우 |

빈 2페이지를 건너뛰고 3페이지까지 읽어 **108건**이 되어야 한다.

### 1.4 행 상세

| 파일 | 내용 |
|---|---|
| `detail-pr-1842.json` | 정상. 본문, base/head 브랜치, 변경 파일 3개, 커밋 3개(merge + source 2) |
| `detail-pr-uncollected.json` | **`changed_paths` 키 자체가 없다.** "아직 수집하지 않았다" |
| `detail-pr-truncated.json` | `files_truncated: true`, `source_commits_truncated: true`, 커밋 250개 |
| `detail-commit.json` | 커밋 상세. `body` 대신 `message`를 쓴다 |

### 1.5 소스 트리

| 파일 | 내용 |
|---|---|
| `source-tree-root.json` | 루트. directory 3, file 2, symlink 1, **submodule 1** |
| `source-tree-src.json` | `src` 하위 |
| `source-tree-truncated.json` | `truncated: true` |
| `source-tree-unicode.json` | 한글 파일명과 아주 긴 파일명 |

### 1.6 경로 이력

| 파일 | 내용 |
|---|---|
| `source-history-page1.json` | 50건, `revision: <A>`, `next_page: 2` |
| `source-history-page2.json` | 20건, **`revision`이 같다** (고정이 동작한 경우) |
| `source-history-moved-head.json` | 20건, **`revision`이 다르다.** 브랜치 머리가 움직인 경우 |
| `source-history-pr-states.json` | `pull_request_numbers`의 세 상태 + `pull_requests_unavailable: true` |
| `source-history-empty.json` | 0건 |

### 1.7 파일 내용

| 파일 | `status` | 용도 |
|---|---|---|
| `source-file-before.json` | `text` | diff의 before. 탭 들여쓰기 포함 |
| `source-file-after.json` | `text` | diff의 after. 줄 추가·수정 포함 |
| `source-file-binary.json` | `binary` | 텍스트 비교 불가 |
| `source-file-too-large.json` | `too_large` | 크기 초과 |
| `source-file-missing.json` | `missing` | 해당 revision에 경로가 없다 |
| `source-file-empty.json` | `text` | 내용이 빈 문자열 |
| `source-file-no-eof-newline.json` | `text` | 마지막 줄에 개행이 없다 |
| `source-file-crlf.json` | `text` | CRLF 줄바꿈 |
| `source-file-unicode.json` | `text` | 한글 주석, 탭, 400자 긴 줄 |

`status`가 `text`가 아닌 fixture는 전부 `text: null`이다. 검증기가 이것을 강제한다. **빈 문자열이 아니다** — 빈 문자열은 "내용이 없는 텍스트 파일"이고 `null`은 "텍스트가 아니다"이기 때문이다.

### 1.8 비교 메타데이터

| 파일 | 내용 |
|---|---|
| `source-diff-page1.json` | 파일 2개(modified, renamed), `next_page: 2`, 관련 PR 1건 |
| `source-diff-page2.json` | 파일 1개(added), `next_page: null`, `truncated: true`. **base/head가 1페이지와 같다** |
| `source-diff-page2-moved.json` | **`head`가 다르다.** 로딩 중 PR이 바뀐 경우 |
| `source-diff-file-states.json` | modified / added / removed / renamed / binary 대상 / 대용량 대상 여섯 가지 |
| `source-diff-empty.json` | `base: null`(최초 커밋), 파일 0개 |

### 1.9 오류 본문

| 파일 | 상태 코드로 쓸 값 | code |
|---|---|---|
| `error-cursor-invalid.json` | 400 | `INVALID_CURSOR` |
| `error-unauthenticated.json` | 401 | `UNAUTHENTICATED` |
| `error-permission-unavailable.json` | 503 | `PERMISSION_UNAVAILABLE` |
| `error-source-not-found.json` | 404 | `NOT_FOUND` |

`INVALID_CURSOR`와 `PERMISSION_UNAVAILABLE`의 `message`는 **한국어**다. 실제 `search-api`가 한국어 진단 문구를 주기 때문이며, 화면이 그것을 어떻게 다루는지(`serviceMessage`) 시험하기 위한 것이다.

## 2. 시나리오 이름과 응답 연결

수용 테스트(`PARITY_AND_ACCEPTANCE.md` 3장)가 `fx:` 이름으로 부르는 시나리오를, 각 요청에 어떤 파일로 답할지 정의한다.

| 시나리오 | 요청 | 응답 |
|---|---|---|
| `fx:default-search` | `repositories` 1회 | `repositories-page1.json` |
| | `search` cursor 없음 | `search-page1.json` |
| | `search` cursor `CURSOR_P2` | `search-page2.json` |
| | `search` cursor `CURSOR_P3` | `search-page3.json` |
| `fx:paging-123` | `fx:default-search`와 같다 | |
| `fx:repos-paged` | `repositories` cursor 없음 | `repositories-page1.json` |
| | `repositories` cursor `REPO_C1` | `repositories-page2-empty.json` |
| | `repositories` cursor `REPO_C2` | `repositories-page3.json` |
| `fx:paging-cursor-fail` | `search` cursor 없음 | `search-page1.json` |
| | `search` cursor `CURSOR_P2` | **400** + `error-cursor-invalid.json` |
| `fx:total-gte` | `search` cursor 없음 | `search-total-gte.json` |
| `fx:mnumber-states` | `search` cursor 없음 | `search-mnumber-states.json` |
| `fx:messy-rows` | `search` cursor 없음 | `search-messy-rows.json` |
| `fx:slow-previous` | `search` q에 `demo/modem` 포함 | `search-page1.json`을 **600ms 지연** 후 |
| | `search` q에 `demo/rfic` 포함 | `search-empty.json`을 즉시 |
| `fx:identifier-routes` | `resolve` q가 `demo/modem#1842` | `resolve-pr.json` |
| | `resolve` 그 밖 | `resolve-empty.json` |
| `fx:sha-range` | `resolve` q = `c81fa22` | `resolve-sha-from-ok.json` |
| | `resolve` q = `d71be10` | `resolve-sha-to-ok.json` |
| | `resolve` q = `abc1234` | `resolve-sha-ambiguous.json` |
| | `resolve` q = `f00dcaf` | `resolve-sha-unsequenced.json` |
| | `resolve` q = `bada550` | `resolve-sha-other-branch.json` |
| | `resolve` q = `e5e5e5e` | `resolve-sha-reversed.json` |
| `fx:detail-failure` | `pull-requests/.../1842` | `detail-pr-1842.json` |
| | 그 밖의 PR 상세 | **500** + `error-permission-unavailable.json` |
| `fx:source-tree` | `source/.../tree` path 없음 | `source-tree-root.json` |
| | `source/.../tree` path = `src` | `source-tree-src.json` |
| | `source/.../tree` path = `src/phy` | `source-tree-truncated.json` |
| `fx:encoding` | `source/.../tree` ref = `release/2026-Q1` | `source-tree-unicode.json` |
| | `source/.../file` path에 한글 포함 | `source-file-unicode.json` |
| `fx:history-pinned` | `history` page 없음 또는 1 | `source-history-page1.json` |
| | `history` page = 2, ref = 1페이지의 `revision` | `source-history-page2.json` |
| | `history` page = 2, ref = 브랜치 이름 | `source-history-moved-head.json` (**틀린 요청의 증거다**) |
| `fx:history-pr-states` | `history` | `source-history-pr-states.json` |
| `fx:diff-basic` | `diff` page 없음 또는 1 | `source-diff-page1.json` |
| | `diff` page = 2 | `source-diff-page2.json` |
| | `file` revision = base | `source-file-before.json` |
| | `file` revision = head | `source-file-after.json` |
| `fx:diff-moved` | `diff` page 1 | `source-diff-page1.json` |
| | `diff` page 2 | `source-diff-page2-moved.json` |
| `fx:diff-file-states` | `diff` | `source-diff-file-states.json` |
| | `file` path = `docs/diagram.png` | `source-file-binary.json` |
| | `file` path = `src/generated/tables.c` | `source-file-too-large.json` |
| | `file` path = `src/phy/rf_config.h`, revision = base | `source-file-missing.json` |
| `fx:diff-unicode` | `file` | `source-file-unicode.json`, `source-file-crlf.json`, `source-file-no-eof-newline.json` |
| `fx:timelapse` | `history` | `source-history-page1.json` |
| | `file` revision별 | `source-file-before.json`과 `source-file-after.json`을 번갈아 |

`fx:history-pinned`의 마지막 줄이 중요하다. **`ref`에 브랜치 이름을 실어 보내면 다른 스냅숏이 돌아온다.** fixture client는 이 잘못된 요청에 일부러 다른 `revision`으로 답하므로, 고정이 깨지면 시험이 즉시 실패한다. 이런 식으로 fixture가 규칙을 강제한다.

## 3. fixture client가 지켜야 할 규칙

1. **요청 파라미터를 실제로 읽는다.** `cursor`, `page`, `path`, `revision`, `ref`, `q`를 무시하고 항상 같은 응답을 주면 페이징·고정·인코딩 시험이 전부 무의미해진다.
2. **지연을 흉내 낼 수 있어야 한다.** `fx:slow-previous`가 경합 시험의 전부다.
3. **오류를 상태 코드와 함께 던진다.** `SearchPortError`의 `status`·`code`를 채운다.
4. **호출 횟수를 셀 수 있어야 한다.** `PS-T-003`(정확히 3회), `PS-T-016`(정확히 3회), `PS-T-017`(자동 재시도 없음)이 이것에 기댄다.
5. **JSON을 깊은 복사해서 돌려준다.** 화면이 응답 객체를 변형하면 다음 시험이 오염된다.
6. **production으로 자동 전환하지 않고, 그 반대도 하지 않는다.** fixture client는 fixture만 준다.

## 4. 하지 말아야 할 일

- 시험을 통과시키려고 fixture의 문제 있는 행(`title: null`, `additions: null`, `pull_request_numbers: null`)을 지우는 것. 그 행들이 시험의 목적이다.
- 성능을 맞추려고 123건을 줄이는 것. 페이징이 실제로 동작하는지가 `PS-T-016`의 전부다.
- 간단한 fixture client를 진짜 검색 엔진처럼 만드는 것. 질의 문자열을 해석해 필터링할 필요가 없다. 시나리오가 정한 응답을 주면 된다.
- 실제 GHE 호스트 이름을 넣는 것. fixture의 `url`은 `https://ghe.example.internal/...`이며 실재하지 않는다.
