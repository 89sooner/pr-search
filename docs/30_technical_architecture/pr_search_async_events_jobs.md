# PR Search 비동기 작업 및 이벤트

> 상태: review | 버전: v0.12 | 갱신일: 2026-09-13

CR-079 / ADR-023: JOB-SEQ-004는 sequence 역할의 durable poll과 기존 EventBus를 사용한다. 원본 저장→refresh, snapshot 저장→reconcile, 번호 저장→materialize/announce가 각각 원자적이다. 기동/매초 poll·lease·generation CAS·retry·SIGTERM은 [설계](pr_search_wp074_design.md) 4~8절이 정본이다. 일일 스윕만으로 late mapping 재개를 대신하지 않는다. EVT-SEQ-004는 prs:projected에 발행하며 기존 link/commit-enrich는 이름 필터로 무시한다. ES는 sequence 역할의 durable materialize가 소유한다. **CR-084(WP-075)가 `annotate` 전용 소비자 그룹을 추가했다** — `mnumber`와 다른 group이며 전역 스위치 기본값이 꺼짐이라 켜기 전에는 구독하지 않는다.

## 1. 목적

장시간 작업, 큐, 이벤트, 재시도, 실패 대기열, 진행률 계약을 정의한다. 전달 계층 결정은 ADR-002를 따른다.

## 2. 큐 구조

`EventBus` 포트(ADR-002) 뒤에 Redis Streams 어댑터를 둔다. 스트림과 소비자 그룹은 다음과 같다.

| 스트림 | 소비자 그룹 | 워커 역할 | 파티션 키 | 동시성 |
| --- | --- | --- | --- | --- |
| `prs:ingest` | `enrich` | 보강 | `repository_id` | 저장소당 1, 전체 기본 16 |
| `prs:enriched` | `project` | 문서 투영 | `repository_id` | 전체 기본 16 |
| `prs:projected` | `link` | 관계 파생 | `repository_id` | 전체 기본 8 |
| `prs:sequence` | `sequence` | 서수 채번 | `repository_id:base_branch` | 시퀀스 공간당 1 (advisory lock) |
| `prs:release` | `release` | 릴리스 태그 스냅숏 동기화 (CR-028, DEV-144) | `repository_id` | 저장소당 1, 전체 기본 4 |
| `prs:batch` | `batch` | 백필·스캔·재색인·점검 | `job_id` | 전체 기본 3 |
| `prs:permission` | `authz` | 권한 캐시 무효화 | `user_id` | 전체 기본 4 |

**백필은 `prs:batch`로 분리한다.** 실시간 스트림과 워커 풀을 공유하지 않으므로 대형 저장소 백필이 실시간 수집 지연을 만들지 않는다 (FR-ING-006 AC-3).

**시퀀스 스트림은 파티션 키가 `repository_id:base_branch`다.** 같은 시퀀스 공간의 채번이 직렬화되어야 하기 때문이다. 추가로 PostgreSQL advisory lock이 이중 안전장치가 된다 (FR-SEQ-001 AC-6).

## 3. Job 카탈로그

| Job ID | 작업 | Trigger | Worker | Retry | Timeout | Progress Event | 관련 요구사항 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| JOB-ING-001 | 원본 이벤트 아웃박스 enqueue | 게이트웨이 (동기) | ingest-gateway | 없음 (아웃박스가 보증) | 300ms | - | FR-ING-001 |
| JOB-ING-002 | PR 보강 (커밋·파일·리뷰) | EVT-ING-001 | enrich | 5회 지수 백오프 | 60초 | - | FR-ING-004 |
| JOB-ING-003 | 문서 투영·업서트 | EVT-ING-002 | project | 5회 지수 백오프 | 30초 | - | FR-ING-005 |
| JOB-ING-004 | 저장소 백필 | 수동 (API-ADM-002) / 저장소 등록 | batch | 항목별 3회, 잡 전체는 재개 | 없음 (중단·재개) | EVT-JOB-001 | FR-ING-006 |

**JOB-ING-004의 실행은 이벤트가 아니라 `job` 행이 지시한다 (CR-022, DEV-101).** API가 행을 만들고 배치 워커가 폴링해 **원자적으로 claim한다** — 세는 것과 잡는 것이 한 트랜잭션에 있어야 동시 실행 상한(AC-6)이 성립한다. 이벤트를 함께 쓰면 진실이 둘이 되어 넷이 동시에 "둘뿐이네"를 읽는다. `prs:batch` 스트림은 진행률(`EVT-JOB-001`)에 쓴다.

**JOB-MIR-002는 `prs:projected`를 전용 소비자 그룹으로 읽는다 (CR-038, DEV-205).** consumer group은 broadcast가 아니라 **work sharing**이다 — 같은 group으로 두 소비자가 붙으면 이벤트가 나뉘어 각자 절반씩만 본다. 그런데 `prs:projected`는 **두 가지 독립된 일**의 방아쇠다: 관계 간선 파생(WP-029, group `link`)과 커밋 메타데이터 보강(WP-067, group `link:commit-enrich`). 카탈로그 `LOGICAL_CONSUMERS`가 토픽별 논리 소비자를 선언하고, 등록되지 않은 이름으로 구독하면 던진다 — 오타가 조용히 새 group을 만들면 그 소비자는 처음부터 다시 읽고 아무도 그 사실을 모른다. **기본 그룹 이름은 바꾸지 않는다**: 기존 소비자의 group을 바꾸면 Redis에서 읽던 자리를 잃는다.

**JOB-MIR-002의 방아쇠는 넷이다 (CR-038, DEV-206).** `EVT-ING-003`만으로는 성립하지 않는다 — 그 이벤트는 **커밋 문서 투영 뒤에** 나오므로, 애초에 문서가 없는 직접 푸시 커밋에 대해서는 발생하지 않는다. `sequence.assigned`(EVT-SEQ-001)가 실어 오는 `from_seq..to_seq`가 곧 **새로 채번된 first-parent 구간**이고 `merge_sequence`가 그 SHA를 정본으로 갖고 있다. `sequence.reassigned`는 `diverged_at_seq`부터의 구간만 다시 본다(그 앞은 복사된 구간이라 이미 보강돼 있다). 일 1회 스윕이 나머지를 메운다.

**이 잡은 문서를 만들기도 한다 (DEV-206).** 투영은 `EVT-ING-002`의 `source_commit_shas`와 머지 커밋으로만 커밋 문서를 만들고, 시퀀스 투영도 `update_by_query`뿐이라 없는 문서를 만들지 않는다. 그래서 직접 푸시 커밋은 문서 자체가 없었고 "부분 갱신만 한다"는 원래 규칙으로는 영원히 검색되지 않는다. **문서를 만들 때 접근 통제 material을 함께 싣는다** — 먼저 만들고 나중에 채우면 그 사이 문서를 강제 필터가 거를 수 없다 (DEV-213, fail closed). 새 문서의 초기 `document_version`은 **커밋 시각**이다: `now()`를 쓰면 이후 도착하는 정상 웹훅 투영이 전부 "오래된 이벤트"로 밀려난다 (DEV-209).

**메타데이터 보강은 `document_version`을 건드리지 않는다 (DEV-209).** 커밋 메시지·부모·변경 경로는 엔티티 상태가 아니라 **불변 git 사실**이라 새 것과 옛 것이라는 개념이 없다. 기존 조건부 업서트 스크립트는 버전이 더 클 때만 대입하므로 그대로 쓸 수 없어, 버전과 무관하게 대입하되 버전은 쓰지 않는 전용 경로를 둔다. 값이 이미 같으면 `noop`이다.

**`direct_push`는 근거를 요구한다 (DEV-207).** PR 연결이 그 순간 `null`이라는 이유만으로 확정하지 않는다 — push 웹훅과 PR 투영 사이에 경주가 있고 `merge_sequence.pull_request_number`는 나중에 채워질 수 있다. 최소 근거는 **first-parent 커밋이고 현재 알려진 PR 머지 매핑이 없다**이며, 역할은 매번 정본에서 다시 계산하므로 **이후 매핑이 생기면 `merge_commit`으로 교정된다.** 체인 소속을 모르는 경로(EVT-ING-003)는 역할을 건드리지 않는다.

**JOB-ING-010은 백필과 같은 실행 틀을 쓴다 (CR-037, DEV-194).** 마이그레이션 010이 세운 `pull_request_snapshot`은 **빈 표로 시작하고**, 업그레이드 이전에 이미 색인된 PR은 그것을 채울 경로가 없었다 — 투영은 바뀐 PR만 쓰고 조정 스캔은 이미 색인된 것을 건너뛴다. 그 PR들은 색인에만 존재하며 **ADR-004("Elasticsearch는 PostgreSQL만으로 전량 재구축 가능")가 그 데이터에 대해 성립하지 않는다.**

이 잡은 GHE의 PR 목록을 페이지네이션하며 **`pull_request_snapshot`만** 채운다 — 색인은 이미 그 문서를 갖고 있으므로 다시 쓰지 않는다. 문서를 만드는 경로는 백필과 **완전히 같다**(`buildUpsertRequests`): 다른 경로로 만들면 재구축의 근거와 실제 색인 내용이 갈라진다. 커서·재개·rate limit 처리도 백필의 것을 그대로 쓴다 — **두 번째 실행 틀도, 두 번째 GHE 클라이언트도 만들지 않는다.**

`document_version`은 **GitHub 엔티티의 `updated_at`**이다(DEV-099와 같은 규칙). 지금 시각을 쓰면 늦게 끝난 부트스트랩이 그 사이 도착한 웹훅 상태를 덮는다. 같은 PR을 다시 처리해도 조건부 업서트라 결과가 같다.

**부분 완료를 완료로 적지 않는다.** `repository.snapshot_bootstrapped_at`은 잡이 실패 0건으로 끝났을 때만 찍힌다 — 그 열이 JOB-ING-008의 `snapshot_bootstrap_pending` 판정 근거이므로, 거짓으로 찍으면 감시가 그 위에서 거짓을 말한다.

**마이그레이션이 이 일을 하지 않는다.** 스냅숏 내용은 GHE만 답할 수 있고, 마이그레이션 안에서 네트워크를 부르면 되돌릴 수도 재개할 수도 없는 배포 단계가 된다. 012는 스키마만 넓힌다.

**백필은 웹훅이 아니라 델리버리 ID가 없다 (CR-022, DEV-100).** `backfill:{repository_id}:{pr_number}`를 만들어 쓴다. **결정론적**이라야 재개·재시도에서 같은 PR이 같은 키를 갖고 실패 대기열(`(delivery_id, stage)` 유니크)에 중복이 쌓이지 않으며, **접두**가 있어야 운영자가 UUID 사이에서 출처를 안다. `job_id`는 넣지 않는다 — 넣으면 잡을 다시 실행할 때 같은 PR이 다른 키를 갖는다.
| JOB-ING-005 | 조정 스캔 | 스케줄 (기본 1시간) / **수동 (API-ADM-002, `type: reconcile`, CR-055)** | **`reconcile` 역할** (CR-034, DEV-179) | 3회 | 30분 | EVT-JOB-001 · `sequence.requested`(head 복구, DEV-180) | FR-ING-011 AC-1·AC-7 |
| JOB-ING-006 | 재색인 | 수동 (API-ADM-004) | batch | 없음 (실패 시 별칭 미전환) | 없음 | EVT-JOB-001 | FR-ING-008 |
| JOB-ING-007 | 아웃박스 재적재 | 스케줄 (5분) | batch | 3회 | 5분 | - | ADR-002 follow-up |
| JOB-ING-008 | PostgreSQL↔ES 정합성 감시 | 스케줄 (6시간) | **`project` 역할** | 3회 | 30분 | EVT-JOB-001 | ADR-004 follow-up |
| JOB-ING-009 | 실패 대기열 재처리 | 수동 (API-ADM-003) | ops (WP-009) → batch (WP-019 이후) | 이벤트별 누적 | 10분 | EVT-JOB-001 (batch 이후) | FR-ING-007 |
| JOB-ING-010 | 정본 스냅숏 부트스트랩 | 조정 스캔이 예약 (JOB-ING-005) / 수동 | **`reconcile` 역할** (CR-037, DEV-194) | 항목별 3회, 잡 전체는 재개 | 없음 (중단·재개) | EVT-JOB-001 | ADR-004 follow-up |
| EVT-REL-001 | `release.refresh_requested` | ingest-gateway, sequence(재채번 후) | release | `prs:release` | `{ repository_id, correlation_id }` — **태그 이름·SHA를 싣지 않는다**: 정본은 미러의 refs/tags 스냅숏이고(DEV-143), 이벤트는 "이 저장소의 태그가 바뀌었으니 다시 봐라"라는 신호일 뿐이다. payload를 신뢰하면 이벤트 순서 역전이 스냅숏을 되돌린다 | 파티션 `repository_id`, 저장소당 직렬 |
| JOB-SEQ-001 | 시퀀스 증분 채번 | `push` 웹훅 → 게이트웨이가 `prs:sequence`에 발행 (CR-025, DEV-116) / 백필 완료 / **수동 (API-ADM-002, `type: sequence_assign`, CR-055)** | sequence | 락 실패는 `defer`, 그 밖은 5회 지수 백오프 | 10분 | EVT-SEQ-001 | FR-SEQ-001, FR-ADMIN-002 AC-1 |
| JOB-SEQ-002 | 시퀀스 재채번 | 재작성 감지(자동) / 수동 (API-ADM-007 → `sequence_reassign` 잡) | `sequence` 역할 — 자동은 버스 소비자, **수동은 `startSequenceRepairRunner`가 잡을 claim한다** (CR-034, DEV-178) | 없음 (실패 시 `stale`) | 60분 | EVT-SEQ-002, EVT-JOB-001 | FR-SEQ-005, FR-ADMIN-003 AC-4 |
| JOB-SEQ-003 | 시퀀스 정합성 점검 | 수동 / 스케줄 (일 1회, 표본) | **`sequence` 역할** | 3회 | 30분 | EVT-JOB-001 | FR-ADMIN-003 |
| JOB-SEQ-004 | M 번호 채번 | EVT-SEQ-001·002 / PR snapshot 확정 후 durable reconcile / 기동·1초 poll / 일 1회 잔여 대조 | **sequence 역할**, 기존 공간 락 공유 | 락 5초 defer, 오류 5회 후 경보하되 durable retry 유지; 상세 설계 6.3 | 기존 회차 10분, batch 기본 100 | EVT-SEQ-004 | FR-SEQ-008 AC-9~14 |
| JOB-SEQ-005 | PR 제목 M 넘버 표기 | `EVT-SEQ-004`(`mnumber.assigned`) / 미표기 잔여 스윕 (일 1회) | **`annotate` 역할** — GHE 쓰기 자격 증명을 가진 유일한 워커이며 조회 역할과 분리한다 (ADR-022). **같은 정본 DB에서 실행자는 하나다**: `annotate:runner` advisory 세션 락을 쥔 프로세스만 쓴다 (CR-085 / DEV-629) | 시도 5회 지수 백오프. **재시도는 요청이 아니라 판단 전체를 다시 지난다** — 정본 확인 → 제목 재조회 → 순수 판정 → 간격 → 울타리 → PATCH (CR-085 / `AC-8`). 403·404는 재시도하지 않고 사유를 남긴다 | 이벤트 회차 25초 (**줄 서기부터 잰다**). 이 값은 버스의 `claimIdleMs` 30초보다 짧아야 하며, 넘기면 처리 중인 이벤트를 회수가 가로챈다. 스윕에는 시간 상한이 없고 대신 종료 신호가 진행 중인 회차를 끊는다 | - | FR-SEQ-009 |
| JOB-REL-001 | 참조 간선 추출 | **EVT-ING-003 / EVT-ING-005** (CR-039, DEV-215) | link | 3회 (**핸들러가 `delivery_count`로 집행한다**, DEV-228) | 30초 | - | FR-REL-003 |
| JOB-REL-002 | 되돌림 간선 파생 | **EVT-ING-003 / EVT-ING-005** (CR-041, DEV-230) | link | 3회 (**핸들러가 `delivery_count`로 집행**) | 30초 | - | FR-REL-004 |
| JOB-REL-003 | 체리픽 간선 파생 | **EVT-ING-005** (+ `EVT-ING-003`은 트레일러 경로만) (CR-041, DEV-231) | link | 3회 (**핸들러가 집행**) | 60초 | - | FR-REL-005 |
| JOB-REL-004 | 스택 간선 파생 | EVT-ING-003 (PR 이벤트) — **source 재파생 + 이 PR이 영향 주는 child 재평가 둘 다** (CR-041, DEV-232) | link | 3회 (**핸들러가 집행**) | 30초 | - | FR-REL-006 |
| JOB-REL-005 | 미해결 참조 해결 | **EVT-ING-003 / EVT-ING-005** (CR-039, DEV-215) | link | 3회 (위와 같다) | 30초 | - | FR-REL-003 AC-3 |
| JOB-REL-006 | 관계 전량 재파생 (**네 계열 전부** — CR-041, DEV-234) | 수동 (API-ADM-002). **`job.type`은 `link_rebuild`** (마이그레이션 001에 이미 있다), `target`은 `owner/repo` | **`link` 역할** (CR-039) | 항목별 3회, 잡 전체는 재개 | 없음 (중단·재개) | EVT-JOB-001 | FR-REL-003~006 |
| JOB-REL-007 | 릴리스 태그 스냅숏 동기화 (CR-028, DEV-144) | `release`·`create(tag)`·`push(refs/tags)` 웹훅 → 게이트웨이가 `prs:release`에 발행 / 6시간 보정 스윕 / 재채번(EVT-SEQ-002) 후 | release | 3회 지수 백오프 | 5분 | - | FR-REL-002, FR-SEQ-003 AC-1 |
| JOB-AUTH-001 | 권한 캐시 갱신·무효화 | EVT-AUTH-001 / TTL 만료 | authz | 3회 | 10초 | - | FR-AUTH-003 |

**JOB-AUTH-001의 대상 펼치기 (CR-015, DEV-042·DEV-045·DEV-046).** 게이트웨이는 웹훅이 준 것만 싣고, 펼치는 일은 전부 이 소비자가 한다 — 수신 경로에 GHE 동기 호출을 넣으면 NFR-002의 수신 p95 300ms가 무너지기 때문이다.

| 실린 필드 | 무효화 대상 | 찾는 방법 |
| --- | --- | --- |
| `user_ids[]` | 그 사용자들 | `app_user.github_user_id`로 조회한다. login은 개명될 수 있으나 숫자 id는 아니다 (DEV-043) |
| `team_id` | 팀 전원 | GHE에서 구성원을 다시 읽어 `team_member`를 갱신하고, 같은 응답을 무효화 대상으로 쓴다. 표가 비어 있어도 성립한다 |
| `repository_id` | 그 저장소를 볼 수 있던 사용자 | (`permission_cache.repository_ids`가 그 저장소를 담은 행) ∪ (`org_ids`가 그 저장소의 조직을 담은 `org_team` 행). 둘 다 GIN 색인으로 찾는다 |

무효화는 Redis 키 삭제 + `permission_cache` 행 삭제 + `app_user.access_scope_version` 증가다. **버전 증가가 울타리다** — 회수 직전에 시작된 GHE 조회가 회수 뒤에 끝나 회수 이전 범위를 캐시에 다시 써 넣는 것을 막는다 (DEV-044). 대량 무효화 시 사용자 단위 요청 병합과 동시 요청 상한 20을 적용한다 (FR-AUTH-003 예외 처리).

| JOB-SRCH-001 | 검색 결과 비동기 내보내기 | 수동 (API-SRCH-006) | batch | 없음 | 30분 | EVT-JOB-001 | FR-SRCH-012 |
| JOB-AUD-001 | 감사·원본 파티션 수명 (다가올 파티션 보장 + 만료 드롭) | 스케줄 (일 1회) | batch | 3회 | 10분 | - | FR-ING-003, FR-AUTH-004 |
| JOB-MIR-001 | 미러 fetch 동기화 | `push` 이벤트 / 스케줄 (6시간) | **mirror** (CR-023, DEV-113 — `sequence` 역할은 WP-021이 세운다) | 3회 | 15분 | - | ADR-005 |
| JOB-MIR-002 | 커밋 메타데이터 보강 | EVT-ING-003 (`entity_kind: commit`) / 백필 항목 / 수동 재보강 (API-ADM-002) | **mirror** | 항목별 3회 | 30초 (항목) | EVT-JOB-001 (배치 실행 시) | FR-SRCH-002, FR-REL-005, ENT-CORE-003 (CR-024, DEV-112) |

**JOB-ING-006의 상세는 3.5장이다** (CR-045). 계약이 "재색인 중 신규 이벤트 이중 쓰기"라고만 적으면 구현이 투영 하나만 고치고 끝낸다 — 별칭에 쓰는 경로는 **열일곱**이다.

### 3.1 JOB-MIR-002 커밋 메타데이터 보강 (CR-024, DEV-112)

WP-020이 커밋 **그래프**를 읽는 계층을 세웠지만, 그 결과를 `prs-commits` 문서에 **쓰는 잡은 어디에도 없었다.** API 계약 §커밋 상세가 "WP-020 이후 붙는 키"로 예고한 `parent_shas`·`message`·`author`·`committer`·`authored_at`·`committed_at`·`patch_id`·`changed_paths`가 그래서 계속 비어 있다. 이 잡이 그 자리를 채운다.

**입력은 커밋 SHA와 저장소다.** 커밋 문서는 투영(JOB-ING-003)이 PR 보강 결과에서 먼저 만들고, 이 잡은 그 위에 **부분 업데이트**만 얹는다. 문서를 새로 만들지 않는다 — 만들면 접근 범위 필드(`org_id`, `visibility`, `allowed_team_ids`)의 출처가 둘이 되어 어느 쪽이 맞는지 판정할 수 없다.

**출처는 `selectCommitGraph`가 고른 경로다.** 미러가 있으면 `git cat-file`/`rev-list` 한 번으로 전부 읽고, `mirror_enabled`가 꺼진 저장소는 GitHub API `GET /repos/{o}/{r}/commits/{sha}`로 같은 값을 얻는다. 두 경로의 반환 형태를 이 잡이 맞춰서 하나로 쓴다.

**모르는 것은 비워 두지 않고 사유를 적는다.**

| 필드 | 미러 경로 | API 폴백 경로 |
| --- | --- | --- |
| `parent_shas`, `message`, `author`, `committer`, `authored_at`, `committed_at` | `git cat-file commit` | 커밋 API 응답 |
| `changed_paths` | `git diff-tree --no-commit-id --name-only -r` — **파일 이름만 읽고 내용은 읽지 않는다.** blob이 필요 없으므로 지연 인출을 켜지 않아도 된다 | 커밋 API의 `files[].filename` (상한 300건, 초과 시 `changed_paths_truncated: true`) |
| `patch_id` | `MIRROR_ALLOW_BLOB_FETCH=true`인 저장소에서만. 아니면 필드를 **두지 않고** `patch_id_unavailable: blob_fetch_disabled` | 계산 불가. `patch_id_unavailable: no_mirror` |

`changed_paths`가 blob 없이 얻어진다는 점이 중요하다 — `git diff-tree --name-only`는 트리만 비교하므로 THR-015의 완화(“blob이 볼륨에 없음”)를 깨지 않는다. **patch-id만 blob을 요구한다.**

**멱등이다.** 같은 SHA로 다시 돌려도 같은 값을 쓰며, `document_version`은 건드리지 않는다 — 이 값들은 웹훅이 나르는 엔티티 상태가 아니라 Git 히스토리에서 읽은 **불변 사실**이므로 버전 경쟁의 대상이 아니다. 단 `patch_id`만은 `MIRROR_ALLOW_BLOB_FETCH`를 켠 뒤 재실행하면 `null`에서 값으로 바뀔 수 있다.

**소스 코드 본문은 어떤 경로로도 저장하지 않는다.** 이 잡은 경로 이름과 patch-id 해시만 다룬다 (NFR-005).

### 3.2 JOB-REL-001·005 참조 간선 파생과 해결 (CR-039, DEV-215~228)

**방아쇠는 둘이다.**

| 방아쇠 | 무엇을 깨우나 |
| --- | --- |
| `EVT-ING-003` (`ingestion.projected`) | PR 문서·PR 유래 커밋 문서가 색인됐다 |
| `EVT-ING-005` (`commit.metadata_ready`) | 커밋 메타데이터가 정본·색인에 모두 들어갔다 — **직접 푸시 커밋이 여기로 들어온다** |

`EVT-ING-003`만으로는 성립하지 않는다. 그 이벤트는 `project` 워커가 **색인한 문서마다** 내는데, 직접 푸시 커밋 문서는
`project`가 만들지 않는다 — WP-067의 `commit-enrich`가 만든다 (DEV-206). 그 경로가 아무 이벤트도 내지 않으면 그 커밋의
메시지에 적힌 참조는 **영원히 간선이 되지 않는다.** CR-038이 JOB-MIR-002에서 잡은 것과 같은 모양이 한 홉 아래에 있었다.

**커밋의 `EVT-ING-003`이 먼저 와도 괜찮다.** 그때는 메시지가 아직 비어 있어 참조가 0건이지만, 나중에 `EVT-ING-005`가
같은 커밋을 다시 파생시킨다. 안정 식별자(아래)와 멱등 reconcile이 중복을 막는다.

**이벤트는 신호이고 본문이 아니다.** 핸들러는 payload의 텍스트를 쓰지 않고 **현재 PostgreSQL 정본**에서 읽는다
(`pull_request_snapshot.document`의 `title`·`body`, `commit_snapshot.message`). 그래서 오래된 이벤트가 늦게 재전달돼도
결과가 현재 정본으로 수렴한다 — 순서 역전이 옛 본문을 되살리지 않는다.

#### 안정 참조 식별자 `reference_key` (DEV-217)

`link_id`를 `{link_type}:{from_type}:{from_id}:{to_type}:{to_id}`로 만들면 **`to_id`가 해결 과정에서 바뀐다.**
`Refs: abc1234`는 미해결 상태에서 축약 SHA를, 해결 뒤에는 40자 SHA를 대상으로 갖는다. 그러면 같은 참조에 대해
미해결 간선과 해결된 간선이 둘 다 남아 FR-REL-003 AC-3(같은 간선을 갱신)·멱등·결정론적 ID가 한 번에 깨진다.

`references` 간선은 **해결 대상과 독립인 안정 식별자**를 갖는다.

| 참조 표현 | `reference_key` |
| --- | --- |
| `#N` | `pr:N` |
| `owner/repo#N` | `x:<owner>/<repo>:pr:N` |
| 40자 SHA | `commit:<sha>` |
| 7~12자 SHA | `commit-prefix:<prefix>` |
| GHE PR URL | `x:<owner>/<repo>:pr:N` |
| GHE 커밋 URL | `x:<owner>/<repo>:commit:<sha>` |

- **원문이 아니라 정규화된 locator다.** 소문자로 맞추고 트레일러 접두·구두점을 벗긴다.
- **저장소 등록 상태에 의존하지 않는다.** 등록되지 않은 저장소를 가리켜도 키가 정해지며, 나중에 등록돼도 키가 바뀌지 않는다.
- **접두 `x:`가 없으면 source 저장소다.** 간선은 언제나 source 저장소 범위로 저장되므로 생략이 모호하지 않다.
- **대상이 해결돼도 바꾸지 않는다.** `to_id`·`to_repository_id`만 채운다.

`references` 간선의 안정 ID는 `link_type` + source identity(`from_type`,`from_id`) + `reference_key`로 만든다.
`resolved`가 `false`에서 `true`로 바뀌어도 `link_id`는 그대로다.

#### 역방향 조회 (JOB-REL-005)

대상 T가 새로 쓸 수 있게 되면 **T를 가리키는 미해결 참조만** 조회한다. 전량 스캔하지 않는다.

- 대상이 PR N이면 후보 키는 `pr:N`(같은 저장소)과 `x:<owner>/<repo>:pr:N`(다른 저장소) 둘이다.
- 대상이 커밋 `<sha>`이면 `commit:<sha>`와 **길이 7~12의 접두 여섯**을 더한 일곱이다. 상한이 있어 `terms` 질의 하나로 끝난다.

#### 해결 규칙 (FR-REL-003 AC-3)

| 상황 | 결과 |
| --- | --- |
| 유일하게 일치 | `resolved: true`, `to_id`·`to_repository_id` 기입 |
| 0건 | `resolved: false` 유지 — **오류가 아니다** |
| 축약 SHA가 2건 이상 | `resolved: false` 유지. 첫 결과를 임의로 고르지 않는다 |
| 등록되지 않은 저장소 | `resolved: false` 유지. **임의의 외부 GitHub 조회로 확장하지 않는다** |
| 승인된 GHE 호스트가 아닌 URL | 참조로 인정하지 않는다 |

#### 완전한 파생 집합과 stale 제거 (DEV-220)

한 source의 `references` 간선은 **완전한 파생 집합**으로 취급한다. 정본의 현재 본문에서 원하는 집합을 다시 만들고,
없어진 간선을 제거한다 — `Refs: #10`이 `Refs: #20`으로 바뀌면 `#10` 간선이 사라져야 한다.

**추출이 실패한 회차는 제거를 하지 않는다.** 부분 결과를 완전한 결과로 확정하면 멀쩡한 간선이 사라진다.
실패는 기존 집합을 보존하고 `links_pending: true`로 표시한 뒤 재파생 대상으로 남긴다.

순서는 **원하는 간선 upsert → stale 제거 → 요약·`links_pending` 확정**이다. 중간에 실패하면 `links_pending`이 `true`로
남아 다음 회차가 같은 차이를 다시 본다 — 다중 인덱스 트랜잭션 대신 **수렴 경로**로 푼다.

#### 중복 제거와 상한 (FR-REL-003 AC-5)

같은 참조가 본문과 트레일러에 함께 나오면 **간선은 하나다.** `reference_key`로 중복을 제거하고 신뢰도는
`derived`(트레일러) > `heuristic`(본문 언급)이 이긴다. 근거 텍스트도 이긴 쪽의 것을 쓴다.

**100건 상한은 원시 일치가 아니라 중복 제거된 고유 참조에 적용한다.** 선택은 결정론적이어야 한다 —
본문 등장 순서를 보존하고 중복 제거 뒤 앞의 100개를 쓴다. 다시 돌려도 같은 100개가 나온다.

#### 실패 분류

| 상황 | 처리 |
| --- | --- |
| 대상 없음 | 실패가 아니다. `resolved: false`로 저장하고 ack |
| 결정론적 파싱 실패 | source 색인을 되돌리지 않는다. `links_pending: true` + 재파생 대상. ack |
| 일시적 DB·ES 실패 | 예산 안에서 `retry`, 소진하면 실패 대기열(`stage: link`) 기록 후 ack |

### 3.3 JOB-REL-006 관계 전량 재파생 (CR-039, DEV-221)

**Redis stream을 마이그레이션 보장으로 쓰지 않는다.** 새 소비자 그룹이 `0`부터 읽을 수는 있으나 stream retention은
정본이 아니고, WP-029 이전의 직접 푸시 커밋에는 애초에 `EVT-ING-003`이 없었다. 배포 뒤 "새 이벤트부터만 관계가 생긴다"는
운영 구멍이 남는다 — CR-037이 DEV-194에서 PR 스냅숏 축에 대해 이미 겪은 자리다.

- 입력은 **PostgreSQL 정본**(`pull_request_snapshot`, `commit_snapshot`)이다. Elasticsearch 현재 문서를 파생의 정본으로 읽지 않는다 (ADR-004)
- 저장소 범위로 열거하며 **재개 가능·경계 있음**이다. 커서는 `job` 행에 남는다
- **같은 파생 핸들러를 쓴다.** 두 번째 추출 알고리즘을 만들지 않는다 — 다른 경로로 만들면 재구축의 근거와 실제 색인 내용이 갈라진다
- GHE를 부르지 않는다. 내부 파생이라 rate limit과 무관하다
- **WP-030이 되돌림·체리픽·스택을 같은 틀에 확장했다 (CR-041, DEV-234).** 한 source를 만나면 그 종류에 적용되는 파생 계열을 **모두** 실행한다 — PR이면 `references`·`reverts`·`stacks_on`, 커밋이면 `references`·`reverts`·`cherry_picks`. 두 번째 재구축 틀을 만들지 않는다. 그래서 Redis 이력이 전혀 없어도 **PostgreSQL 정본만으로 `prs-links` 전량을 다시 만들 수 있고**, 그것이 이 축에서 ADR-004가 성립한다는 증명이다

### 3.4 JOB-REL-002·003·004 되돌림·체리픽·스택 파생 (CR-041, DEV-230~247)

세 계열은 `references`와 **같은 워커·같은 소비자 그룹·같은 배포 단위**를 쓴다. 역할을 늘리지 않는다 — 새 역할은
manifest·적용 순서·도달성 회귀를 통째로 늘리고, 파생의 입력(PostgreSQL 정본)이 같아서 나눌 이유가 없다.

#### 방아쇠 — source-ready만으로는 부족하다 (DEV-230·231·232·242)

관계 집합은 **source의 변화**뿐 아니라 **후보(candidate)의 변화**에도 달라진다. 이것이 이 장의 중심 계약이다.

| 계열 | source-ready 방아쇠 | 후보 변화 방아쇠 |
| --- | --- | --- |
| `reverts` | `EVT-ING-003` · `EVT-ING-005` | 새 PR/커밋의 제목·메시지가 기존 source의 제목 대조 후보가 된다 |
| `cherry_picks` | **`EVT-ING-005`** (트레일러는 `EVT-ING-003`으로도 성립) | 같은 `patch_id`를 가진 커밋이 나중에 들어온다 |
| `stacks_on` | `EVT-ING-003` (PR) | 상위 PR의 머지·종료·분기 변경이 **하위 PR의** 간선을 바꾼다 |

**왜 `EVT-ING-003`만으로는 안 되는가.** WP-029가 DEV-215에서 확인한 것과 같은 자리다 — 그 이벤트는 `project`
워커가 색인한 문서마다 내고, **직접 푸시 커밋 문서는 `project`가 만들지 않는다.** 되돌림·체리픽의 근거는 커밋
메시지이고 직접 푸시 커밋도 되돌림 커밋일 수 있다. `EVT-ING-003`만 구독하면 **그 커밋의 되돌림은 영원히 간선이
되지 않는다.**

**체리픽은 이유가 하나 더 있다.** `patch_id`는 커밋 보강이 채운다. `EVT-ING-003`은 투영 시점에 나오므로 그때는
`patch_id`가 아직 없다 — 그 시점에 판정하면 `derived` 경로가 언제나 "값 없음"으로 끝난다. **정본에 값이 들어간
뒤를 알리는 신호가 `EVT-ING-005`다.**

**후보 변화 방아쇠가 없으면 관계가 수렴하지 않는다 (DEV-242).** 세 가지가 모두 같은 모양이다.

| 시나리오 | source 이벤트 | 기대 |
| --- | --- | --- |
| `Revert "X"`가 후보 1건으로 해결된 뒤, 같은 제목의 PR이 하나 더 들어온다 | **없다** | FR-REL-004 예외 처리대로 간선이 **둘**이 된다 |
| `patch_id=P`인 커밋 A만 있다가 나중에 `patch_id=P`인 B가 들어온다 | **없다** | B → A 간선이 생긴다 |
| 하위 PR C가 상위 PR P에 스택돼 있는데 P가 머지된다 | **없다** | C→P가 `detached`가 된다 (FR-REL-006 AC-3) |

그래서 각 이벤트를 처리할 때 **두 방향**을 함께 본다: 이 엔티티를 source로 한 재파생, 그리고 **이 엔티티의 변화가
영향을 주는 다른 source들**의 재파생. 후자의 대상 목록은 경계가 있어야 한다 — 저장소 전량 스캔은 방아쇠마다
돌 수 없다. 후보 역방향 조회는 정본의 인덱스(마이그레이션 014)와 간선 인덱스의 `to_id` 조회로 좁힌다.

#### 파생 정본은 PostgreSQL이다 (ADR-004)

`pull_request_snapshot.document`(`title`·`state`·`base_branch`·`head_branch`)와 `commit_snapshot`
(`message`·`patch_id`·`committed_at`)이 유일한 파생 근거다. **Elasticsearch 현재 문서를 파생의 정본으로 읽지
않는다.** 색인은 파생의 **출력**이며, 영향받는 source를 좁히는 **조회 보조**로만 쓸 수 있다 — 그렇게 좁힌 뒤에도
최종 판정은 정본에서 다시 한다.

#### 되돌림 (FR-REL-004)

| 패턴 | 신뢰도 | 대상 |
| --- | --- | --- |
| `This reverts commit <sha>` 트레일러 | `exact` | 트레일러가 지목한 SHA |
| `Revert "<원본 제목>"` / PR 제목 접두 `Revert` | `heuristic` | 같은 저장소에서 제목이 일치하는 엔티티 |

- 방향은 **되돌림 주체 → 대상**이다. 역방향 조회는 `to_id`로 한다 (ADR-009 — 간선을 양방향 저장하지 않는다).
- **제목 대조 후보가 2건 이상이면 모두 저장한다** (FR-REL-004 예외 처리). `LIMIT 1`·"첫 결과"·"가장 최근 하나"로
  좁히지 않는다 — 조사 도구가 자신 있게 틀린 답을 내는 것이 다중 후보를 보여 주는 것보다 나쁘다. 화면이 다중
  후보임을 표시하는 것은 WP-031이다.
- **되돌림의 되돌림(AC-5)에 전용 코드를 두지 않는다.** `B reverts A`와 `C reverts B`가 각각 정상 파생되면 연쇄는
  그 자체로 표현된다. 특수 분기를 두면 그 분기가 틀렸을 때 조용히 어긋난다.

#### 체리픽 (FR-REL-005)

- **트레일러 `(cherry picked from commit <sha>)`는 `patch_id` 가용성과 무관하게 동작한다** (AC-1). `no_mirror`·
  `blob_fetch_disabled`·`compute_failed` 어느 상태에서도 `exact` 간선을 만든다.
- **`patch_id` 기반 `derived` 판정은 트레일러가 없을 때만, 그리고 값이 실제로 있을 때만** 한다 (AC-2, CR-024
  DEV-111). 세 사유를 하나로 뭉개지 않는다 — `no_mirror`·`blob_fetch_disabled`는 **시도하지 않은 것**이고
  `compute_failed`는 **시도해서 실패한 것**이다. 앞의 둘에서 `derived` 경로를 도는 것은 계산 자원 낭비이자
  "시도했다"는 거짓 기록이다.
- **동일 저장소 안으로 한정한다** (AC-3). 이 조건은 **PostgreSQL 질의 자신이** 강제한다 — 넓게 가져와 뒤에서
  거르면 그 필터 한 줄이 사라지는 순간 저장소 간 간선이 조용히 생긴다.
- **방향과 상위 5건 순서를 결정론으로 고정한다 (DEV-243).** AC-4는 "상위 5건"만 말하고 순서를 정하지 않았는데,
  순서가 비결정론이면 **같은 정본에서 다른 색인이 나와 ADR-004의 재구축 증명이 성립하지 않는다.**
  - 방향: **나중 커밋 → 이른 커밋.** 체리픽은 원본이 먼저 있고 사본이 뒤에 온다. 미래 커밋을 현재 커밋의
    "원본 후보"로 거꾸로 잇지 않는다 — 나중 커밋이 들어오면 **그 커밋이 source가 되어** 이쪽으로 간선을 만든다.
  - 정렬: `committed_at` 내림차순(=시간상 가장 가까운 이전 후보부터), 동률이면 `commit_sha` 오름차순.
  - 같은 쌍을 양방향으로 중복 저장하지 않는다.

#### 스택 (FR-REL-006)

- 조건: **하위 PR의 `base_branch` == 같은 저장소의 다른 `open` PR의 `head_branch`.** 방향은 하위 → 상위,
  신뢰도는 `derived`다.
- **후보가 여럿일 수 있다 (DEV-244).** 계약이 `head_branch`의 유일성을 보장하지 않으므로 첫 결과로 숨기지 않는다.
  조건을 만족하는 모든 후보를 `pr_number` 오름차순으로 평가하고, 순환 규칙을 통과한 후보마다 간선을 만든다.
- **더 이상 성립하지 않는 간선은 지우지 않고 `detached: true`로 바꾼다 (DEV-238).** AC-3이 요구하는 것은 "해제
  상태로 **표시**"이며, 지우면 "그런 관계가 있었다"는 사실이 사라진다. 조건이 다시 성립하면(상위 PR 재오픈·분기
  복구) `detached: false`로 되돌린다.
  **한 번도 성립한 적 없는 후보에는 간선을 만들지 않는다** — `detached: true`인 간선을 미리 만들면 "확인했고
  아니었다"가 아니라 "있었던 적 없는 관계"를 주장하게 된다.
- **깊이 상한 10, 순환 시 간선을 만들지 않고 지표로 기록한다** (AC-4·AC-5). 상한을 넘긴 탐색은 중단한다.

#### 완전한 파생 집합 — 계열마다 수명이 다르다 (DEV-233·241)

`references`가 세운 규율(DEV-220)을 잇되 **하나의 일반화로 뭉치지 않는다.**

| 계열 | 정본에서 사라진 간선 |
| --- | --- |
| `reverts` | 제거한다 (본문이 근거이므로 근거가 사라지면 간선도 사라진다) |
| `cherry_picks` | 제거한다 (후보 집합에서 빠지면 사라진다) |
| `stacks_on` | **제거하지 않는다.** `detached: true`로 표시한다 |

**실패한 회차는 어느 계열에서도 제거를 하지 않는다.** 부분 결과를 완전한 결과로 확정하면 멀쩡한 간선이 사라진다.

**요약 boolean은 간선 하나의 결과가 아니다 (DEV-241).** "간선 하나를 지웠으니 `has_revert = false`"는 틀렸다 —
다른 되돌림 간선이 남아 있을 수 있다. 조정이 끝난 뒤 **현재 active 간선 집합에서 다시 계산한다.**

| leaf | 정의 |
| --- | --- |
| `has_revert` | 이 엔티티를 `from`으로 하는 active `reverts` 간선이 1건 이상 |
| `is_reverted` | 이 엔티티를 `to`로 하는 active `reverts` 간선이 1건 이상 |
| `has_cherry_pick` | 이 엔티티가 걸린 active `cherry_picks` 간선이 1건 이상 (방향 무관 — 목록 배지의 뜻이다) |
| `has_stack` | 이 PR이 걸린 `stacks_on` 간선 중 `detached`가 아닌 것이 1건 이상 |

`false`는 **"확인했고 현재 없다"**일 때만 쓴다.

#### 실패 처분 — `links_pending`을 재해석하지 않는다 (DEV-246)

`links_pending`은 **FR-REL-003 참조 추출의 완결 상태**다(WP-029). WP-030의 실패를 그 표식으로 나르면 한 필드가
두 뜻을 갖게 되고, 화면이 "관계 미확정"을 참조 기준으로 읽던 계약이 깨진다. **새 pending 필드도 만들지 않는다** —
SRS가 요구하지 않는다.

| 상황 | 처분 |
| --- | --- |
| 후보 없음 | 실패가 아니다. 간선 0건으로 확정하고 ack |
| 일시적 DB·ES 실패 | 예산 안에서 `retry`. **핸들러가 `delivery_count`로 집행한다**(DEV-228) — 어댑터는 상한을 보지 않는다 |
| 예산 소진 | 실패 대기열(`stage: link`) 기록 후 종료 처분. **파티션을 풀어야 뒤 이벤트가 흐른다.** 보정은 JOB-REL-006 |

### 3.5 JOB-ING-006 무중단 재색인 (CR-045, DEV-292~303)

FR-ING-008이 승인한 것은 **"새 인덱스 생성 → 정본에서 채우기 → 별칭 원자 전환"** 셋과 "재색인 중 신규 이벤트 이중 쓰기"다. 그 문장이 정하지 않은 것을 여기서 정한다 — **어디에 이중으로 쓰는지, 전환을 언제 해도 되는지, 실패했을 때 무엇이 남는지**.

#### 불변식 아홉

이것들은 구현 선택지가 아니라 수용 조건이다.

| # | 불변식 | 왜 |
| --- | --- | --- |
| 1 | 읽기는 **언제나 안정 별칭만** 쓴다 | FR-ING-008 AC-1. 구체 인덱스를 읽는 경로가 하나라도 있으면 전환이 그 경로를 지나친다 |
| 2 | 재구축의 원본은 **PostgreSQL 정본**이다 | ADR-004. 옛 인덱스를 `_reindex` source로 쓰면 "색인은 정본만으로 재구축 가능하다"가 증명되지 않는다 — 옛 인덱스에만 있는 오염이 그대로 옮겨 간다 |
| 3 | 새 인덱스가 **완전해지기 전에 별칭을 옮기지 않는다** | AC-5 |
| 4 | 전환은 **단일 원자 액션**이다 | AC-3. `remove` → `add` 두 호출 사이에 별칭이 사라진다 |
| 5 | 재색인 중 발생한 변경이 새 인덱스에서 **빠지지 않는다** | AC-2 |
| 6 | shadow 쓰기 실패가 **서비스 중인 인덱스를 끊지 않는다** | FR-ING-008 예외 처리 |
| 7 | shadow가 불완전하면 **절대 전환하지 않는다** | 6과 짝이다. 실패를 흡수하되 그 사실을 잊지 않는다 |
| 8 | 취소·실패한 잡이 **뒤늦게 `completed`로 덮이지 않는다** | CR-037 DEV-197이 같은 모양을 이미 겪었다 |
| 9 | 운영 쓰기 경로와 시험 전용 경로가 **다르지 않다** | CR-034가 배운 것 — 격리된 함수 시험은 "운영이 그것을 부른다"를 증명하지 않는다 |

#### 이중 쓰기의 대상은 열일곱이다 (DEV-295)

계약이 "신규 이벤트 이중 쓰기"라고만 적으면 구현은 투영(`bulkUpsert`) 하나만 고치고 끝낸다. **별칭에 쓰는 경로를 전수로 적는다** — 하나라도 빠지면 그만큼 새 인덱스가 조용히 뒤처지고, 그 사실은 전환 뒤에야 드러난다.

| 파일 | 함수 | 연산 |
| --- | --- | --- |
| `packages/es/src/upsert.ts` | `bulkUpsert` · `upsertOne` | bulk · update |
| `packages/es/src/commit-metadata.ts` | `upsertCommitMetadata` | update |
| `packages/es/src/sequence.ts` | `applySequenceToDocuments` · `applyEpochBump` | update_by_query |
| `packages/es/src/registry.ts` | `markRepositoryArchived` · `applyRepositoryTeams` | update_by_query |
| `packages/es/src/releases.ts` | `pruneReleaseDocuments` · `applyReleaseTagsToDocuments` | delete_by_query · update_by_query |
| `packages/es/src/links.ts` | `writeReferenceLinks` · `deleteStaleReferenceLinks` · `resolveReferenceLinks` · `updateLinkSummary` · `writeDerivedLinks` · `deleteStaleDerivedLinks` · `setLinkDetached` · `setLinkResolved` | bulk · delete_by_query · update |

**삭제도 이중으로 한다.** `delete_by_query`가 빠지면 새 인덱스에 지워야 할 문서가 남아 두 인덱스가 갈라진다 — 그리고 그 차이는 건수 대조를 통과할 수도 있다(같은 수의 다른 문서).

**쓰기 대상은 한 seam이 정한다.** 함수마다 "지금 재색인 중인가"를 묻게 하면 새 쓰기 경로가 그 물음을 잊는다. 논리 대상 집합을 한 곳에서 해석한다 — 평시에는 `[서비스 인덱스]`, 재색인 중에는 `[서비스 인덱스, shadow 인덱스]`. **`@prs/es`가 `@prs/db`에 의존하게 만들지 않는다**(의존 방향 유지) — 대상 해석은 애플리케이션 계층이 하고 `@prs/es` 원시체는 대상을 인자로 받는다.

#### 활성화와 전환의 울타리 (DEV-296)

막아야 할 경주 둘이 있고, 방향이 반대다.

```
[유실]  writer: 대상이 [old]뿐이라고 판단
        reindex: 이중 쓰기 활성화
        writer: old에만 쓴다
        backfill: 그 문서를 이미 지나갔다
        cutover  → 그 변경이 new에서 사라진다

[불완전] writer: [old, new] 쓰기 시작
        cutover: 별칭을 new로 옮긴다
        writer: new 쓰기가 실패한다
                → 이미 new가 서비스 중인데 불완전하다
```

**별칭 단위 PostgreSQL advisory lock으로 조정한다.** `@prs/db`의 세션 범위·트랜잭션 범위 락이 이미 있다(CR-037이 세션 범위를 신설했다).

**울타리를 쥐는 구간은 대상 확정이 아니라 "확정 → 두 인덱스 쓰기 완료 → shadow 실패 기록"까지다** (CR-046, DEV-308). 대상 확정만 감싸고 놓으면 위 표의 **두 번째 경주가 그대로 남는다** — writer가 `[old, new]`를 확정하고 락을 놓은 뒤, 전환이 락을 잡아 별칭을 옮기고, 그 다음에 writer의 shadow 쓰기가 실패하면 **이미 서비스 중인 새 인덱스가 불완전하다.** 내가 그 경주를 바로 위에 적어 놓고 울타리를 그것보다 짧게 잡았다.

따라서 전환은 **진행 중인 논리 쓰기가 하나도 없을 때만** 별칭을 옮긴다. shadow 실패가 잡을 `failed`로 만드는 기록도 같은 구간 안에서 끝나야 한다 — 그 기록이 울타리 밖으로 밀리면 전환이 "실패 없음"을 보고 지나간다.

성능을 이유로 울타리를 좁히려면 **먼저 정확성 증명이 있어야 한다.** 이 문단이 그 증명을 한 번 건너뛴 자리다.

**활성화 순서를 뒤집지 않는다.** ① 대상 인덱스 생성 → ② 이중 쓰기 활성화를 정본에 기록(울타리 안) → ③ 그 뒤에 정본 스캔 시작. 반대로 하면 스캔 이후·활성화 이전의 변경이 통째로 빠진다.

#### 정본에서 재구축한다 (DEV-295의 뒷면)

별칭마다 정본이 다르고, **전부 PostgreSQL에 있다.**

| 별칭 | 정본 |
| --- | --- |
| `prs-pull-requests` | `pull_request_snapshot` + 현재 저장소·파생 상태 |
| `prs-commits` | `commit_snapshot` + 시퀀스·저장소 상태 |
| `prs-links` | 정본 엔티티에서 **재파생**한다 (JOB-REL-006의 경로를 그대로 쓴다) |
| `prs-releases` | `release` 표 |

**두 번째 문서 생성 알고리즘을 만들지 않는다.** 운영 투영·파생이 쓰는 빌더를 그대로 재사용한다 — 따로 만들면 재구축 결과와 평시 결과가 갈라지고, 그 차이는 전환 뒤에 드러난다.

**정본에 없는 필드를 옛 인덱스에서 베껴 오지 않는다.** 어떤 필드가 옛 인덱스에만 있고 정본에서 복구할 수 없다면 그것은 **ADR-004 결함**이다. 임시로 통과시키지 말고 DEV를 등록하고 정본을 먼저 복구한다. 재색인의 성공을 거짓으로 선언하지 않는다.

#### 전환 전 검증 (DEV-297)

`source_count == target_count` 하나로 판정하지 않는다. **같은 수의 다른 문서**가 가능하다. 최소한 다음을 모두 확인한 뒤에만 별칭을 옮긴다.

- 정본 스캔이 끝났다
- 알려진 실패가 0이다 (bulk 응답의 **item 단위** 실패 포함 — HTTP 200이 완료가 아니다)
- 이중 쓰기 구간에 치명 실패가 없었다
- 대상 매핑·설정이 의도한 버전이다
- 별칭별 기대 정본 커버리지가 맞는다
- 대표 질의가 새 인덱스에서 성립한다
- 잡이 여전히 `running`이다 — 취소·실패로 바뀌지 않았다

#### 실패·취소 처분 (DEV-298)

| 상황 | 처분 |
| --- | --- |
| 서비스 인덱스 쓰기 성공 + shadow 실패 | 서비스 결과는 **보존**한다. 재색인 잡을 `failed`로, 별칭 전환 금지, 이후 shadow 쓰기 중단, 옛 인덱스가 계속 서비스 |
| 서비스 인덱스 쓰기 자체 실패 | 기존 재시도·오류 처리 그대로. 재색인 때문에 달라지지 않는다 |
| bulk 응답의 item 단위 실패 | **실패다.** 집계 건수만 보고 성공으로 세지 않는다 (PR #47이 배운 것: HTTP 성공 ≠ 완전한 결과) |
| 전환 **전** 취소 | 별칭 전환 금지, 옛 인덱스 유지, shadow는 정리 대상 |
| 전환 **후** 늦은 취소 | 이미 성공한 전환을 되돌리지 않는다. 러너가 `completed`를 뒤늦게 덮지 않도록 CAS로 종료한다 (`finishJobIfRunning` 선례) |

#### 보관 (DEV-299)

전환 성공 뒤 옛 구체 인덱스를 **즉시 지우지 않는다.** 기본 보관은 **7일**이며(FR-ING-008 AC-4), 정본은 완료된 잡 행의 `progress`다(`source_index`·`switched_at`). 정리 스윕은 주입 가능한 시계로 시험한다. **현재 별칭이 가리키는 인덱스는 어떤 경우에도 지우지 않는다.** 실패·취소로 남은 shadow도 별칭에 붙지 않은 것을 확인한 뒤 유계 정리 대상으로 둔다.

#### 배포 (DEV-292)

JOB-ING-006의 워커는 **`batch` 역할**이다. 새 역할을 만들지 않는다 — 인프라 3장이 `pipeline-worker:batch`를 이미 배포 단위로 승인했다. **다만 그 manifest가 저장소에 없었다**(이 CR이 신설한다). 같은 역할의 JOB-ING-007(아웃박스 재적재)도 그래서 배포되지 않고 있었다.

## 4. Event 카탈로그

| Event ID | 이름 | Producer | Consumer | **전송 스트림** | Payload | Ordering/Dedupe |
| --- | --- | --- | --- | --- | --- | --- |
| EVT-ING-001 | `ingestion.event_received` | ingest-gateway | enrich | `prs:ingest` | `{ delivery_id, event_type, action, repository_id, correlation_id, occurred_at }` | 파티션 `repository_id`, 멱등 `delivery_id` |
| EVT-ING-002 | `ingestion.enriched` | enrich | project | `prs:enriched` | **self-contained bounded (CR-010, DEV-013)** — `{ delivery_id, repository_id, entity_kind, pr_number, pull_request, source_commit_shas[], changed_files[], reviews[], source_commits_truncated, files_truncated, enrichment_pending, enrichment_errors[], correlation_id }`. `pull_request`는 **PR 문서 매핑(ENT-CORE-002)이 선언한 PR 고유 필드 전부**를 나른다 (CR-011, DEV-018) — `number, title, body, state, draft, labels[], author, created_at, updated_at, closed_at, merged, merged_at, merge_commit_sha, head_ref, head_sha, base_ref, base_sha`. `created_at`이 없으면 투영이 `lead_time_seconds`·`first_review_wait_seconds`를 계산할 수 없다. 투영이 GitHub API를 다시 부르지 않아도 되도록 필요한 것을 실어 보낸다. 원본 웹훅 전량·patch/diff 본문·소스 코드·토큰은 싣지 않는다. 커밋 250건·파일 3000건 상한 유지 | 위와 동일 |
| EVT-ING-003 | `ingestion.projected` | project | link | `prs:projected` | `{ repository_id, entity_kind, entity_id, document_version, correlation_id }` | 위와 동일 |
| EVT-ING-005 | `commit.metadata_ready` | mirror (JOB-MIR-002) | link | **`prs:projected`** | `{ repository_id, commit_sha, entity_id, metadata_source, correlation_id }` — **bounded 식별자만.** 메시지 본문·경로 목록을 싣지 않는다: link 워커가 `commit_snapshot`에서 읽는다 (CR-039, DEV-215) | 파티션 `repository_id`, 멱등 `(repository_id, commit_sha, metadata_source)` |
| EVT-ING-004 | `ingestion.failed` | 모든 워커 | ops | `prs:batch` | `{ delivery_id, stage, error, retry_count, correlation_id }` | 멱등 `(delivery_id, stage)` — **`dead_letter`의 유일 제약이 같은 키로 강제한다** (CR-012, DEV-022) |
| EVT-SEQ-001 | `sequence.assigned` | sequence | project, ops | **`prs:projected`** (CR-025, DEV-121) | `{ repository_id, base_branch, seq_epoch, from_seq, to_seq, head_sha }` | 시퀀스 공간별 직렬 |
| EVT-SEQ-002 | `sequence.reassigned` | sequence | project, 알림, ops | `prs:projected` | `{ repository_id, base_branch, old_epoch, new_epoch, diverged_at_seq, affected_count }` | 시퀀스 공간별 직렬 |
| EVT-SEQ-003 | `sequence.stale` | sequence | ops, 알림 | `prs:projected` | `{ repository_id, base_branch, reason, last_error }` | 최신 값 우선 |
| EVT-SEQ-004 | `mnumber.assigned` | sequence의 durable announce | `link`·`commit-enrich`·`mnumber`는 이름으로 무시하고 **`annotate` 전용 그룹이 소비한다** (WP-075 / CR-084) | `prs:projected` | `{ repository_id, base_branch, seq_epoch, from_mnumber, to_mnumber, pull_request_numbers[] }`. 상세 설계 8절의 상한/멱등 ID. **payload는 힌트이며 소비자는 현재 epoch·정본을 재검증한다.** WP-074 ES는 독립 materialize work가 소유한다 | 공간별 멱등, 전달 순서 비의존 |
| EVT-AUTH-001 | `permission.invalidated` | ingest-gateway | authz | `prs:permission` | `{ user_ids[], team_id, repository_id, reason }` — 세 대상 필드는 모두 선택이며 **하나 이상이 있어야 한다.** `member` 웹훅은 `user_ids`, `team` 웹훅은 `team_id`, `repository` 웹훅은 `repository_id`를 채운다. 게이트웨이는 펼치지 않는다 (CR-015, DEV-041·DEV-042) | 집합 연산이라 멱등 |
| EVT-JOB-001 | `job.progress` | 배치 워커 | ops | `prs:batch` | `{ job_id, type, target, state, progress: { done, total, unit }, cursor }` | 최신 값 우선 |

**전송 스트림 열은 CR-025가 더했다 (DEV-121).** 그전까지 카탈로그는 Producer와 Consumer만 적고 **어느 스트림이 그 이벤트를 나르는지**를 적지 않았다. WP-021이 `EVT-SEQ-001`을 내려다가 그 빈칸을 만났다 — `project`가 읽는 `prs:enriched`에 실으면 투영 핸들러가 모양이 다른 payload를 받고, `prs:sequence`에 실으면 채번이 자기 이벤트를 다시 소비한다. 소비자 이름만으로는 전송 수단이 정해지지 않는다.

한 스트림이 여러 이벤트를 나르므로 **소비자는 봉투의 `event_name`으로 가른다.** 새 규약이 아니다 — `EventEnvelope`에 이미 있는 필드다.

**되먹임 금지 (CR-039, DEV-216).** `EVT-ING-005`는 `prs:projected`로 나가는데, 그 이벤트를 **내는** JOB-MIR-002가 같은 토픽을
`link:commit-enrich` 그룹으로 **읽고 있다.** 그래서 자기 이벤트를 자기가 다시 받는다. 토픽을 새로 만들어 푸는 대신
`event_name` 판별을 계약으로 못 박는다.

| 소비자 | 처리하는 `event_name` | 무시(ack)하는 것 |
| --- | --- | --- |
| `link:commit-enrich` (JOB-MIR-002) | `ingestion.projected`(commit), `sequence.assigned`, `sequence.reassigned` | **`commit.metadata_ready`** |
| `link` (JOB-REL-001·005) | `ingestion.projected`, `commit.metadata_ready` | 시퀀스 이벤트 |

JOB-MIR-002는 **`commit.metadata_ready`를 받아 `commit.metadata_ready`를 다시 내지 않는다.** 무한 루프의 유일한 방어선이
이 규칙이므로 시험으로 직접 건다.

`EVT-ING-003`을 JOB-MIR-002가 재발행해 같은 뜻으로 쓰는 방식은 **기각한다** — 한 이벤트 이름이 "투영이 색인했다"와
"보강이 채웠다" 두 가지를 뜻하게 되고, 그 순간 위 표를 쓸 수 없다.

## 5. 재시도와 백오프

### 5.1 표준 재시도 정책 (FR-ING-007 AC-1)

| 시도 | 지연 |
| --- | --- |
| 1차 재시도 | 1초 |
| 2차 | 2초 |
| 3차 | 4초 |
| 4차 | 8초 |
| 5차 | 16초 |
| 초과 | 실패 대기열로 이동 |

각 지연에 ±20% 지터를 적용해 동시 실패 시 재시도가 몰리지 않게 한다.

**rate limit 대기는 이 재시도와 다르다 (CR-010, DEV-014).** 둘을 같은 것으로 세면 실제 장애가 아닌 대기가 실패로 집계된다.

| | 표준 재시도 | rate limit defer |
| --- | --- | --- |
| 언제 | 네트워크·5xx·타임아웃 등 실제 실패 | 주 한도 소진, `retry-after` 수신 |
| 얼마나 기다리나 | 1·2·4·8·16초 + ±20% 지터 | GitHub이 알려 준 회복 시각(`retryAt`)까지 |
| 재시도 예산 | 소비한다 (5회) | **소비하지 않는다** |
| 소진하면 | 실패 대기열 | 없음 — 회복 시각이 지나면 그냥 다시 시도한다 |

한도가 10분 뒤에 풀리는데 30초마다 재전달되면 회복 전에 5회를 소진해 멀쩡한 이벤트가 실패 대기열로 간다. 그래서 `EventBus` 핸들러가 처분을 돌려준다 — `retry`(표준 백오프), `defer`(지정 시각까지, 예산 미소비), `dead_letter`(종료 기록 후 ack). 어느 어댑터를 쓰든 아래는 지켜야 한다.

- `retryAt` 이전에 GHE로 HTTP 요청을 다시 보내지 않는다
- rate limit defer는 재시도 예산을 소비하지 않는다
- 관계없는 파티션을 프로세스 전역 sleep으로 막지 않는다
- 같은 파티션의 기존 순서 보장을 깨지 않는다
- 표준 재시도는 5회다
- 재시도 소진 뒤 실패 대기열에 기록하고 **원 이벤트는 ack해 파티션을 푼다**
- 404는 즉시 실패 대기열로 보내고 ack한다

**재시도 예산을 집행하는 것은 핸들러다 (CR-039, DEV-228).** 어댑터는 `retry`를 받으면 백오프를 늘리고 미ack로 둘 뿐
**횟수 상한을 보지 않는다** — Redis·in-memory 두 구현 모두 그렇다. 그래서 핸들러가 `delivery_count`를 읽어 예산 소진 시
종료 처분(`dead_letter`)으로 바꾸지 않으면 **영구 실패가 무한 재시도되며 그 파티션의 뒤 이벤트를 영영 막는다.**

- 새 소비자를 만들 때 `delivery_count >= MAX_RETRIES`를 **반드시** 확인한다 (`authz.ts`가 선례다)
- `defer`는 예산을 소비하지 않으므로 이 검사 대상이 아니다
- 이것은 어댑터의 결함이 아니라 **분업**이다: 어댑터는 언제 다시 부를지를, 핸들러는 언제 그만둘지를 정한다

### 5.2 재시도 대상 판정

| 분류 | 예시 | 처리 |
| --- | --- | --- |
| **재시도 가능** | GHE 5xx, 네트워크 타임아웃, ES 429, PostgreSQL 일시 연결 실패, advisory lock 획득 실패 | 표준 백오프로 재시도 |
| **재시도 가능 (특수)** | GHE rate limit 소진 (403 + `x-ratelimit-remaining: 0`) | 표준 백오프가 아니라 `x-ratelimit-reset` 시각까지 대기 후 재시도 (FR-ING-004 AC-2) |
| **재시도 가능 (특수)** | GHE secondary rate limit (429 + `retry-after`) | 헤더가 지정한 시간만큼 해당 토큰 격리 |
| **재시도 불가** | 서명 불일치, 404 (삭제된 PR), 매핑 위반(`dynamic: strict` 거부), payload 파싱 실패 | 즉시 실패 대기열로 이동. 재시도 낭비 없음 |
| **부분 성공** | 보강 일부 실패 (파일 목록은 얻고 리뷰는 실패) | 얻은 것만 반영하고 `enrichment_pending: true` 유지 후 재시도 |

### 5.3 실패 대기열 (FR-ING-007)

- 상한 초과 이벤트는 `dead_letter` 테이블에 `state: 'pending'`으로 저장한다. 실패 사유, 마지막 오류 메시지, 재시도 횟수를 함께 남긴다 (AC-2).
- 운영자가 개별 또는 일괄 재처리한다 (AC-3). 재처리는 `raw_event`에서 원본을 읽어 파이프라인에 재투입하며 멱등 규칙이 그대로 적용된다 (AC-4).
- 같은 이벤트가 3회 재처리 실패하면 `state: 'held'`로 전환하고 자동 재처리 대상에서 제외한다. 운영자 개입이 필요함을 A-001에 표시한다.
- 실패 대기열 잔량이 100건을 넘으면 경보를 발생시킨다 (AC-5). 세는 대상은 `state IN ('pending','reprocessing')`이다 — `held`는 이미 사람이 보기로 한 것이고 `resolved`는 끝난 것이라 임계를 잠식하면 안 된다.

**재투입 지점은 항상 `prs:ingest`다 (CR-012).** 어느 단계에서 실패했든 마찬가지다. `EVT-ING-002`·`EVT-ING-003`은 어디에도 보존되지 않으므로 `project` 단계 실패를 그 단계부터 되살릴 방법이 없다. 다시 만들 수 있는 유일한 출발점은 `raw_event`의 원본이며, 앞 단계를 다시 도는 비용은 멱등 규칙(FR-ING-002)이 중복을 만들지 않는다는 보장으로 상쇄된다.

**JOB-ING-009의 실행 주체는 단계에 따라 다르다 (CR-012, DEV-024).** 재처리 자체는 "행을 읽어 스트림에 다시 넣는" I/O 가벼운 작업이라 `ops` 모듈이 요청 안에서 직접 수행한다(1회 최대 500건). `batch` 워커와 `prs:batch` 스트림은 WP-019가 세우므로, 진행률 이벤트 `EVT-JOB-001`과 10분 타임아웃은 그때부터 적용된다. 그전까지 재처리 결과는 응답 본문이 그대로 알려 준다.

**`EVT-ING-004`는 아직 발행되지 않는다 (CR-012, DEV-026).** 카탈로그가 정한 소비자 `ops`는 스트림 소비자가 아니라 `dead_letter` 테이블을 읽는 조회 모듈이고, 경보 경로는 `dead_letter_total{state}` 지표가 맡는다(WP-009 범위). 지금 토픽을 만들면 소비자 없는 스트림이 하나 생길 뿐이다. 알림 소비자가 생기는 운영 고도화(REL-005)에서 발행 여부를 정한다 — **워커가 `dead_letter` 행을 동기적으로 남기므로 이벤트가 없다고 기록이 유실되지는 않는다.**

## 6. 진행률 보고

배치 잡은 `job.progress` 필드를 30초 이내 간격으로 갱신한다 (FR-ADMIN-002 AC-3).

```json
{
  "job_id": 8801,
  "type": "backfill",
  "target": "acme/payments",
  "state": "running",
  "progress": { "done": 1842, "total": 5210, "unit": "pull_request" },
  "cursor": { "page": 19, "last_pr_number": 3368 },
  "started_at": "2026-08-19T02:00:00Z"
}
```

- `cursor`는 중단 후 재개 지점이다 (FR-ING-006 AC-4). 잡이 중단되어도 이 값에서 이어간다.
- `total`을 미리 알 수 없는 잡(조정 스캔)은 `unit`을 `repository`로 두고 저장소 수를 총량으로 쓴다.
- 진행률 갱신은 잡 처리 트랜잭션과 분리한다. 진행률 쓰기 실패가 잡을 중단시키지 않는다.

## 7. 잡 동시성과 중복 방지

- `job` 테이블의 부분 유니크 인덱스(`WHERE state IN ('queued','running','paused')`)가 같은 `(type, target)` 잡의 동시 실행을 막는다 (FR-ADMIN-002 AC-4).
- 중복 요청은 409 `JOB_CONFLICT`와 실행 중 잡 ID를 반환한다.
- 동시 실행 백필 잡 수는 설정값이며 기본 3이다 (FR-ING-006 AC-6). `prs:batch` 소비자 동시성으로 강제한다.
- 중단 요청 후 30초 안에 잡이 멈추지 않으면 강제 종료하고 `cancelled`로 기록한다 (FR-ADMIN-002).
- **잡 유형은 그 유형을 집는 러너가 배포에 있을 때만 실행 요청을 받는다** (FR-ADMIN-002 AC-6, CR-055). `job_type_chk`에 이름이 있다는 것으로는 부족하다.

### 7.1 수동 실행이 자동 실행과 만나는 자리 (CR-055)

`FR-ADMIN-002` AC-1의 제어 대상 중 **조정 스캔과 시퀀스 채번은 원래 자동 경로만 갖고 있었다.** `CR-055`가 수동 진입점을 열면서 각 잡의 실행 경로가 둘이 되었고, 그 둘이 만나는 자리를 여기서 정한다.

| 잡 | 자동 경로 | 수동 경로 | 두 경로가 만나는 자리 |
| --- | --- | --- | --- |
| JOB-ING-005 조정 스캔 | `reconcile` 역할의 주기 스윕 (기본 1시간) | `job` 행 `type: reconcile`, `target: all` | **루프 하나가 두 방아쇠를 함께 처리한다.** 매 순회에서 수동 잡을 먼저 집어 보고, 없고 주기가 됐으면 주기 스윕을 돈다 — `runReconcileSweep` 호출 지점이 하나뿐이라 겹칠 자리가 없다. 수동끼리는 `job_active_uk`가 막는다 |
| JOB-SEQ-001 시퀀스 채번 | `prs:sequence` 이벤트 소비 (`push` 웹훅·백필 완료·조정 스캔의 head 복구) | `job` 행 `type: sequence_assign`, `target: owner/repo@브랜치` | **같은 `assignSequence` 구현 하나.** 시퀀스 공간의 직렬은 기존 PostgreSQL advisory lock이 이미 강제하며(8장), 락 실패는 양쪽 모두 재시도로 처리한다 |

**두 번째 실행 구조를 만들지 않는다.** 수동 경로는 새 알고리즘이 아니라 기존 실행에 도달하는 다른 문이다. 러너가 자기 유형의 잡 행을 `claimNextJob`으로 집어 그 함수를 부르며, 그 함수는 자기가 어느 문으로 불렸는지 알지 못한다.

**두 잡의 직렬화 근거가 서로 다르다 — 하나를 다른 하나로 일반화하지 않는다** (PR #88 리뷰 P2).

`JOB-SEQ-001`은 **PostgreSQL advisory lock이 시퀀스 공간마다 이미 걸려 있다**(8장). 그 락은 프로세스 안이든 밖이든 똑같이 작동하므로 버스 소비자와 잡 러너가 같은 프로세스에서 동시에 깨어나도 안전하고, 늦게 온 쪽은 `locked` 결과를 받아 재시도한다.

**중단은 상태 보존이 아니라 실행 정지다** (PR #89 리뷰 P1). 조건부 종료 전이(`finishJobIfRunning`)는 잡 행이 `cancelled`로 남는 것까지만 보장하고, 그동안 전량 스윕은 저장소를 계속 돌며 GHE를 부른다 — **화면은 "취소됨"을 보이는데 비싼 스캔이 진행 중이다.** `runReconcileSweep`는 취소 신호를 받아 남은 대상을 돌지 않는다.

**확인 지점은 저장소 안에까지 있다** (PR #91 리뷰 P1, DEV-443). 저장소 사이에서만 보면 활성 저장소가 하나뿐이거나 그 저장소의 24시간 창이 넓을 때 확인 지점이 사실상 사라진다. 신호는 `reconcileRepository`까지 내려가 **다음 페이지를 요청하기 전**, **PR 하나를 되돌리기 전**, 그리고 **후속 단계를 시작하기 전**에 확인된다. 마지막 지점이 없으면 마지막 단위를 처리하는 동안 들어온 취소를 루프가 정상 종료하며 놓친다 (DEV-448). 이 스캔은 백필과 달리 **재개 커서를 저장하지 않으므로** 중간에 끊어도 부분 상태가 남지 않는다 — 매 회차가 창을 처음부터 다시 읽고 이미 색인된 PR은 걸러진다. 끊어서 잃는 것은 "이번 회차가 창을 끝까지 읽었다"는 사실 하나뿐이며, 그래서 중단된 회차는 **완주 기록도 채번 예약도 팀 범위 동기화도 하지 않는다.** 취소를 연속 미완주로 세지도 않는다 — 그것은 저장소의 건강 문제가 아니라 운영자의 지시다.

**이것은 협조적 중단이며 30초 강제 종료가 아니다** (DEV-447). 이미 시작한 PR 하나의 보강은 끝까지 가고 그 안에서 GHE를 여러 번 부른다. 요청 하나는 `GHE_REQUEST_TIMEOUT_MS`로 묶여 있으나 그 합에는 상한이 없으며, 진행 중인 왕복을 밖에서 끊을 경로도 아직 없다. **`FR-ADMIN-002`의 예외 처리가 요구하는 강제 종료와 지금 구현의 차이는 `DEV-447`에 열려 있다** — 협조적 중단을 강제 종료라 부르지 않는다.

`JOB-ING-005`에는 그런 락이 없다. **단일 복제본 배치는 프로세스 수를 제한할 뿐 한 프로세스 안의 독립적인 비동기 루프 둘을 직렬화하지 못한다** — 주기 스윕이 GHE 응답을 기다리는 `await` 지점에서 잡 러너 루프가 깨어나면 같은 전량 스캔이 둘 겹친다. 그래서 이 잡은 **루프를 하나로 만든다**: `runReconcileSweep`를 부르는 자리가 코드에 하나뿐이면 겹칠 수 있는 구조 자체가 없다.

**락을 새로 만들지 않는 이유는 배포 불변식을 믿어서가 아니라 겹칠 수 없는 구조가 락보다 낫기 때문이다.** 락은 그것이 실제로 무엇을 막는지 검증하기 어렵고, 검증하지 못한 락은 있으나 마나다.

**조정 스캔의 head 복구는 계속 이벤트로 보낸다.** `sequence_assign` 잡 유형에 러너가 생겼다고 해서 `CR-034`(DEV-180)의 판단을 되돌리지 않는다 — 그 경로는 공간마다 멱등해야 하고 활성 잡 제약에 걸리면 안 된다. 잡 행으로 바꾸면 복구하려고 만든 행이 **이후의 모든 복구를 막는 자물쇠**가 되며, 그것이 DEV-180이 실제로 밟은 함정이다.

## 8. 순서 보장

| 대상 | 보장 수준 | 방법 |
| --- | --- | --- |
| 같은 저장소의 이벤트 처리 | 느슨한 순서 | 파티션 키 `repository_id`. 워커 동시성 때문에 완전 직렬은 아님 |
| 같은 문서의 업서트 | 강한 순서 | `document_version` 조건부 업서트. 순서가 뒤바뀌어도 최신이 이긴다 (FR-ING-005 AC-1) |
| 같은 시퀀스 공간의 채번 | 강한 직렬 | 파티션 키 + PostgreSQL advisory lock (FR-SEQ-001 AC-6) |
| 실패 대기열 재처리 | 순서 무관 | 멱등과 버전 조건부 업서트가 순서 의존을 제거 |
| 백필과 실시간 이벤트 | 순서 무관 | 백필 문서도 `document_version` 규칙을 따라 실시간을 덮어쓰지 않는다 (FR-ING-006 AC-5) |

**설계 원칙**: 순서 보장을 큐에만 의존하지 않는다. `document_version` 조건부 업서트가 있으면 순서가 어긋나도 최종 상태가 옳다. 큐의 순서 보장은 시퀀스 채번에만 필수다.

**M 넘버 채번은 큐 순서에 기대지 않는다 (CR-077).** `JOB-SEQ-004`는 이벤트가 실어 온 구간을 그대로 믿지 않고 정본의 `mnumber_head_seq`에서 다시 시작한다 — 이벤트가 순서를 바꿔 도착하거나 두 번 도착해도 결과가 같다. **다만 미러 fetch와 채번 사이에는 순서 보장이 필요하다** (DEV-576): 미러가 갱신되기 전에 `JOB-SEQ-001`이 돌면 옛 head를 읽고 조용히 "새 커밋 없음"으로 끝나므로, 그 뒤의 M 넘버 채번도 할 일이 없다고 판단한다. 이 경주는 멱등으로 덮이지 않는다 — 다음 회차가 언제 오는지가 지연 그 자체이기 때문이다.

## 9. 스케줄

| 잡 | 주기 | 시각 | 비고 |
| --- | --- | --- | --- |
| JOB-ING-005 조정 스캔 | 1시간 | 매시 정각 + 저장소별 분산 | 저장소를 시간 단위로 분산해 API 부하 평탄화 |
| JOB-ING-007 아웃박스 재적재 | 5분 | - | `queued_at`이 10분 이상 지나고 `processed_at`이 없는 행 |
| JOB-ING-008 정합성 감시 | 6시간 | - | PostgreSQL↔ES 문서 수·표본 대조. 표본 1000건 (CR-033, DEV-174). **ES에만 있는 잉여 문서는 자동 삭제하지 않는다** — 불일치로 보고·경보만 한다. 지문에는 **접근 통제 필드**(`org_id`·`visibility`·`allowed_team_ids`·`repository_archived`)가 포함되며 그 기대값은 `repository` 표에서 합성한다 (CR-037, DEV-193). 부트스트랩 전 저장소는 `snapshot_bootstrap_pending`으로 구분해 보고한다 (DEV-195) |
| JOB-MIR-002 커밋 메타데이터 보강 | 일 1회 | 05:00 KST | **스케줄은 보정이다.** 주 전달은 `sequence.assigned`·`sequence.reassigned`·`EVT-ING-003` 세 방아쇠이며, 스윕은 이벤트가 놓친 것과 이 잡이 서기 전에 쌓인 과거 데이터를 메운다 (CR-038, DEV-206) |
| JOB-ING-010 정본 스냅숏 부트스트랩 | 조정 스캔 주기(1시간)에 편승 | - | 스케줄 잡이 아니다. 조정 스캔이 `snapshot_bootstrapped_at IS NULL`인 저장소를 **한 주기에 최대 5개씩** 큐에 넣는다 — 첫 배포에서 GHE 한도를 통째로 태우지 않기 위해서다 (CR-037, DEV-194) |
| JOB-SEQ-003 정합성 점검 (표본) | 1일 | 04:00 KST | 시퀀스 공간별 최근 1000개 대조. **그래프를 읽지 못하면 공간 상태를 바꾸지 않고 실패로 끝낸다** (CR-033, DEV-171) |
| JOB-MIR-001 미러 동기화 (보정) | 6시간 | - | push 이벤트 누락 대비 |
| JOB-SEQ-004 M 넘버 채번 (잔여 스윕) | 일 1회 | 04:30 KST | **스케줄은 보정이다.** 주 전달은 `sequence.assigned`·`sequence.reassigned`이며, 스윕은 **PR 연결이 뒤늦게 채워져 멈춰 있던 자리**를 이어받는다 (FR-SEQ-008 AC-3) |
| JOB-SEQ-005 PR 제목 표기 (미표기 스윕) | 일 1회 | 05:30 KST | 주 전달은 `mnumber.assigned`다. 스윕은 GHE 장애·한도로 밀린 표기와, 쓰기 직후 프로세스가 죽어 정본에 결과를 못 남긴 행을 메운다. **`done`·`mismatch`는 끝난 상태라 다시 보지 않는다** (CR-084) — `mismatch`를 다시 보면 덮지 않기로 한 제목에 요청만 반복한다. `failed`는 일시 실패였을 수 있어 다시 보고, `disabled`는 **운영자가 저장소를 다시 켰을 때만** 대상이 된다. `unknown`(응답을 받지 못해 결과를 모르는 행)도 다시 본다 — 확인이 곧 제목 조회이고, 이미 붙어 있으면 호출 없이 끝난다. **`body_changed`는 다시 보지 않는다** (CR-085 / `AC-9`): 서버가 저장한 제목이 보낸 값과 달랐던 행이며, 자동으로 다시 쓰면 그 차이를 덮는다. 운영자가 `annotate_resume`으로 열 때까지 대상에서 빠진다. 다시 보는 것이 다시 쓰는 것은 아니다: 처리는 언제나 제목 조회부터이고 이미 같은 접두가 있으면 호출 없이 `done`이 된다 |
| JOB-MIR-002 커밋 메타데이터 재보강 | 수시 | - | 스케줄 잡이 아니다. `EVT-ING-003`으로 상시 구동되며, 스케줄 항목에 적는 것은 **미보강 잔여분 스윕**뿐이다 (일 1회, 05:00 KST) |
| JOB-AUD-001 보존 만료 | 1일 | 03:00 KST | **다가올 파티션을 먼저 보장한 뒤** 만료 파티션을 드롭한다 (CR-054, DEV-417). **대상은 `raw_event`(3년, FR-ING-003 AC-4)와 `audit_record`(1년, NFR-006) 둘뿐이다** — 인프라 9.6이 같은 잡에 얹었던 "완료 잡·해소된 DLQ 90일 정리"는 승인한 FR이 없어 CR-054가 그 귀속을 제거했다(DEV-407). **행 단위 DELETE가 아니라 파티션 DROP이며 관리 롤이 수행한다** (FR-AUTH-004 AC-3). 드롭한 파티션마다 `retention.purge`를 남긴다 |

## 10. 운영 지표

| 지표 | 정의 | 임계 | 관련 요구사항 |
| --- | --- | --- | --- |
| `ingest_received_total` | 웹훅 수신 건수 | - | FR-ADMIN-001 |
| `ingest_rejected_total` | 서명 검증 실패 건수 | 5분간 10건 초과 시 경보 | FR-ING-001 AC-2, NFR-005 |
| `ingest_duplicate_total` | 중복 전달 건수 | - | FR-ING-002 AC-3 |
| `ingest_response_seconds` | 수신 응답 시간 히스토그램 | p95 300ms 초과 시 경보 | NFR-002 |
| `queue_depth{stream}` | 스트림별 대기 길이 | 10000 초과 시 경보 | FR-ADMIN-001 |
| `stage_latency_seconds{stage}` | 단계별 처리 지연 | - | FR-ADMIN-001 AC-1 |
| `ingestion_lag_seconds` | 수신 → 색인 반영 지연 | p95 10초, p99 60초 초과 시 경보 | NFR-002 |
| `enrich_pending_total` | 보강 대기 문서 수 | 증가 추세 시 경보 | FR-ING-004 |
| `github_rate_limit_remaining{token}` | 토큰별 잔여 한도 | 10% 미만 시 경고 | FR-ING-004 AC-2 |
| `dead_letter_total{state}` | 실패 대기열 잔량 | pending 100건 초과 시 경보 | FR-ING-007 AC-5 |
| `retry_total{stage,reason}` | 재시도 횟수 | 급증 시 경보 | - |
| `sequence_space_state{state}` | 시퀀스 공간 상태별 수 | `stale` 1개 이상 시 경보 | FR-SEQ-001 |
| `sequence_reassign_total` | 재채번 발생 횟수 | 1건이라도 발생 시 알림 | FR-SEQ-005 AC-5 |
| `reconcile_missing_total` | 조정 스캔이 발견한 누락 수 (`repository`·`kind` 라벨) | 0 초과 시 경고 | FR-ING-011 AC-4, NFR-002 |
| `sequence_integrity_mismatch_total` | 정합성 점검이 발견한 불일치 공간 수 (`repository`·`base_branch` 라벨) | 1건이라도 발생 시 경보 | FR-ADMIN-003 AC-3 |
| `sequence_integrity_check_failed_total` | 점검을 마치지 못한 횟수 (`reason` 라벨). **공간 상태를 바꾸지 않으므로** 실패는 이 지표로만 보인다 (CR-033, DEV-171) | 3회 연속 시 경보 | FR-ADMIN-003 예외 처리 |
| `projection_consistency_mismatch_total` | PG↔ES 불일치 수 (`index`·`kind` 라벨: `count` \| `content` \| `missing_in_es` \| `extra_in_es`) | 0 초과 시 경고 | ADR-004 (JOB-ING-008) |
| `reconcile_incomplete_cycles` | 조정 스캔이 연속으로 완주하지 못한 주기 수 (`repository` 라벨) | **3 이상 시 경보** | FR-ING-011 예외 처리 |
| `job_duration_seconds{type}` | 잡 소요 시간 | 재색인 4시간 초과 시 경보 | NFR-008 |
| `mirror_disk_usage_ratio` | 미러 볼륨 사용률 | 85% 초과 시 경보 | ADR-005 |
| `patch_id_failure_total` | patch-id 계산 실패 수 | 증가 추세 시 경고 | FR-REL-005 |
| `permission_cache_hit_ratio` | 권한 캐시 적중률 | 0.8 미만 시 경고 | FR-AUTH-003 AC-5 |
| `link_pending_total` | 관계 파생 대기 문서 수 | 증가 추세 시 경고 | FR-REL-003 |
| `link_relations_total` | 파생한 간선 수 (`link_type`·`confidence` 라벨: `reverts` \| `cherry_picks` \| `stacks_on`) | - | FR-REL-004~006 (CR-041) |
| `link_stack_cycle_total` | 순환이 감지되어 간선을 만들지 않은 횟수 (`repository` 라벨) | **0이 정상이며 양수는 조사 대상이다** | FR-REL-006 AC-5 (DEV-247) |

## 11. 사용자 가시 복구 경로

| 상황 | 화면 표시 | 사용자 행동 |
| --- | --- | --- |
| 보강 대기 | `enrichment_pending` 배지 + 재조회 버튼 | 잠시 후 재조회 |
| 관계 파생 대기 | `links_pending` 배지 | 잠시 후 재조회 |
| 시퀀스 채번 중단 | `sequence_stale` 경고 배너 | 운영자 문의 |
| 재채번 진행 중 | `sequence_reassigning` 배너 | 완료 후 재조회 |
| 에폭 무효 | `epoch_stale` 경고 + 현재 에폭 재조회 액션 | 재조회 |
| 실패 대기열 적체 | A-001 경보 상태 | 운영자 재처리 |
| 백필 진행 중 | W-009·A-003 진행률 | 대기 |
| 검색 엔진 장애 | `degraded` 배너 ("검색 실패, 수집은 계속됨") | 복구 대기 |
| 내보내기 잡 실패 | 잡 상태 `failed` + 사유 | 재실행 |

부분 파일은 제공하지 않는다. 내보내기 실패 시 완성된 파일만 다운로드 가능하다 (FR-SRCH-012 예외 처리).

### 8.1 검색 내보내기 실행 상세 (JOB-SRCH-001, WP-044 / CR-072)

`batch` 역할의 내보내기 러너는 기존 `job` PG 폴링·claim을 사용한다. `POST /exports`가 job과 `search_export` 요청을 원자적으로 넣으므로 불완전한 요청이 실행되지 않는다. 실행 당시 접근 범위와 시퀀스 바인딩을 고정하고 페이지마다 PG 버전을 확인한다. PIT은 한 작업 안에서 순회하고 종료 시 닫으며 실패 후 부분 파일을 재사용하지 않는다.

완료는 `search_export`와 job의 원자적 공개 상태로 조회한다. 새 알림 소비자나 브라우저 스트림은 추가하지 않으며 W-001이 소유자 전용 상태 API를 폴링한다. 30분을 초과한 실행 또는 프로세스 중단으로 남은 오래된 running claim은 `failed/export_timeout`이 된다. `export_scope_changed`, `export_epoch_changed`, `export_limit_exceeded`, `export_failed`를 표시 가능한 실패 사유로 저장한다. pause/cancel이 끼어들면 running 조건부 완료가 공개를 거절하며 resume은 새로운 PIT에서 전체 파일을 다시 생성한다.

## 9. GitHub Operations Plane 잡과 이벤트 (CR-005 신규)

Operations Plane의 비동기 처리는 수집 파이프라인과 큐를 공유하지 않는다 (ADR-013). 실행 요청은 사용자 지시로만 생기고, 처리 지연이 수집에 영향을 주면 안 되기 때문이다.

### 9.1 큐

| 큐 | 생산자 | 소비자 | 파티션 키 | 비고 |
| --- | --- | --- | --- | --- |
| `prs:gh:executions` | `search-api`(실행 수락) | `gh-executor` | `{host}:{owner}/{name}` | 같은 저장소 작업의 순서를 유지한다. **구현됨 (CR-086)**: 파티션 4, 소비자 그룹 `gh-executor`, 실행기가 `GH_EXECUTOR_MAX_CONCURRENT`(기본 2)개 구독으로 파티션을 나눠 맡는다 — 구독 수가 곧 동시 실행 수다 |
| `prs:gh:recipes` | `search-api` | `gh-executor` | `recipe_id` | Recipe 단계 진행 |

### 9.2 잡

| Job ID | 이름 | 트리거 | 동시 실행 | 재시도 | 관련 FR |
| --- | --- | --- | --- | --- | --- |
| JOB-GH-001 | gh 명령 실행 | `prs:gh:executions` 소비 | 실행기 상한까지 | **쓰기 작업은 재시도하지 않는다.** R0 읽기만 1회 재시도 | FR-GH-002, FR-GH-006 |
| JOB-GH-002 | Recipe 단계 진행 | `prs:gh:recipes` 소비 | Recipe당 1 | 실패 정책에 따름 (기본 `abort`) | FR-GH-005 |
| JOB-GH-003 | capability 드리프트 점검 | 일 1회 + 배포 시 | 1 | 3회 | FR-GH-001, FR-GH-011 |
| JOB-GH-004 | 위임 토큰 갱신 | 만료 30분 전 | 사용자당 1 | 3회 | FR-GH-008 |
| JOB-GH-005 | 임시 workspace 정리 | 10분 주기 | 1 | 재시도 없음 (다음 주기) | FR-GH-007 |
| JOB-GH-006 | 아티팩트 만료 정리 | 일 1회 | 1 | 3회 | FR-GH-007 |
| JOB-GH-007 | 고아 실행 회수 | 5분 주기 | 1 | 재시도 없음 | FR-GH-006, FR-GH-012 | **구현됨 (CR-086)** — 실행기 안의 스윕(`startSweeper`, 주기 `GH_EXECUTOR_SWEEP_MS` 기본 15초): 하트비트가 `GH_EXECUTOR_ORPHAN_AFTER_MS`를 넘긴 `running`을 `failed`(`executor_lost`)로 회수하고, `GH_EXECUTOR_QUEUED_STALE_MS`를 넘긴 `queued`를 다시 집는다(발행 유실 대비) |
| JOB-GH-008 | 실행 잠금 만료 해제 | 1분 주기 | 1 | 재시도 없음 | FR-GH-012 |

**JOB-GH-001이 재시도하지 않는 이유.** 쓰기 작업의 자동 재시도는 중복 실행 위험을 만든다. `pr merge`가 타임아웃으로 실패했을 때 실제로 머지되었는지 아닌지 실행기는 알 수 없다. 재시도는 사용자가 결과를 보고 판단한다.

**JOB-GH-007이 필요한 이유.** 실행기 파드가 죽으면 `running` 상태 행이 영원히 남는다. 이 잡이 실행기 하트비트가 끊긴 실행을 `failed`로 회수한다 (NFR-012 상태 정합성).

### 9.3 이벤트

| Event ID | 이름 | 발행자 | 구독자 | 페이로드 요지 | 관련 FR |
| --- | --- | --- | --- | --- | --- |
| EVT-GH-001 | `gh.execution.requested` | `search-api` | `gh-executor`, 감사 | 실행 ID, capability, 위험도, 중복 방지 키 | FR-GH-002 |
| EVT-GH-002 | `gh.execution.state_changed` | `gh-executor` | 웹(SSE), 감사 | 실행 ID, 이전·현재 상태 | FR-GH-006 |
| EVT-GH-003 | `gh.execution.output` | `gh-executor` | 웹(SSE) | 실행 ID, 스트림 종류, 청크 (영속 저장 안 함) | FR-GH-006 | **R0 미구현** — SSE는 상태 변화만 흘린다 (`DEV-651`) |
| EVT-GH-004 | `gh.execution.finished` | `gh-executor` | 감사, 이력 | 실행 ID, 종료 코드, 출력 해시, 아티팩트 | FR-GH-012 |
| EVT-GH-005 | `gh.approval.requested` | `search-api` | 알림, A-007 | 실행 ID, 필요 역할, 위험도 | FR-GH-009 |
| EVT-GH-006 | `gh.capability.drift_detected` | JOB-GH-003 | 알림, A-006 | 설치 gh 버전, manifest 버전, 차이 요약 | FR-GH-011 |
| EVT-GH-007 | `gh.identity.revoked` | JOB-GH-004 | 웹, 감사 | 사용자, 사유 | FR-GH-008 |

`EVT-GH-003`은 영속 저장하지 않는다. 출력 원문을 저장하면 비밀이 흘러들 수 있고 크기 상한도 지키기 어렵다. 이력에는 출력 해시와 절삭된 요약만 남는다 (FR-GH-012).

### 9.4 R0 구현 상태 (CR-086 / WP-077)

| 항목 | 상태 |
| --- | --- |
| `JOB-GH-001` | 구현 — `apps/gh-executor/src/runner.ts`. 큐에서 꺼낼 때 **재검증**(manifest 해시·gh 버전 → capability 열림 → 저장소 활성·이름 불변 → 연결 살아 있음·호스트 일치·만료 전·행위자 일치 → 봉인 해제 → 같은 빌더로 argv 재조립해 저장값과 대조) → `claim` → spawn → 결과 기록. 러너는 던지지 않고 이벤트는 결과와 무관하게 `ack`된다 — 재전달하면 같은 행을 다시 본다 |
| `JOB-GH-004` 위임 토큰 갱신 | 부분 — 주기 잡이 아니라 **요청 시점 갱신**이다: 실행 요청에서 만료 15분 전이면 `grant_type=refresh_token`으로 갱신하고 봉인을 한 트랜잭션에서 교체한다(refresh token은 1회용). 주기 잡은 다음 판 |
| `JOB-GH-007` | 구현 (위 표) |
| `JOB-GH-003` capability 드리프트 점검 | **구현 (CR-088, `DEV-671`)** — `apps/gh-executor/src/registry-check.ts`. 자리는 실행기다(gh 바이너리와 DB를 둘 다 가진 프로세스). 헬스 서버를 먼저 열고(`registry.status: unchecked`) **기동 시 한 번 기다린 뒤** 구독을 세우며(비동기 판·동시 4, 10초 안팎), 그 뒤 `GH_EXECUTOR_REGISTRY_CHECK_MS`(기본 1일) 주기로 돈다. 동시 1(체인, 진행 중이면 tick 건너뜀), 일시 오류 재시도 3회(5·15·45초, `stop()`이 즉시 끊는다). 검사 = `validateManifest`(적재한 manifest 재계산 대조·커버리지) + `checkDriftAsync`(실제 바이너리 해시·버전·인벤토리 해시·command/flag/JSON 필드 diff — 이벤트 루프를 막지 않는다, `DEV-680`). 결과는 `gh_capability_snapshot`(해시마다 한 행)·`gh_capability_verification`(회차마다 한 행, append-only)에 남는다. 드리프트·구조 실패면 `stale` 플래그가 서고 러너의 재검증이 실행을 `registry_stale`로 거절한다(FR-GH-011 AC-3의 `execution_disabled`) — 프로세스는 종료하지 않고 헬스 `registry.stale`·지표 `gh_registry_stale`이 사실을 말한다. 일시 오류는 `stale`을 바꾸지 않고, DB 기록 실패도 판정을 바꾸지 않는다(`DEV-679`) |
| `JOB-GH-002`·`005`·`006`·`008` | 미구현 (Recipe·workspace 정리 잡·아티팩트·잠금). workspace는 실행 종료 즉시 `destroyWorkspace`가 지우며 tmpfs라 재기동에 사라진다 |
| `EVT-GH-001` | 구현 — `prs:gh:executions` 페이로드는 `execution_id`뿐이다. 실행기는 그 ID로 DB 정본을 다시 읽는다 |
| `EVT-GH-002` | 부분 — 버스 이벤트가 아니라 SSE가 DB의 상태 변화를 1초 폴링으로 흘린다. 감사는 `gh_execution` 행 자체다 |
| `EVT-GH-003` | 미구현 (`DEV-651`) |
| `EVT-GH-004` | 부분 — 종료는 `gh_execution` 행의 상태·종료 코드·출력 해시로 남는다. 별도 이벤트는 없다 |
| `EVT-GH-006` 드리프트 감지 | **버스 이벤트로 발행하지 않는다 (`DEV-673`)** — 드리프트는 `gh_capability_verification` 행(status `drift`, diff)·실행기 로그·지표 `gh_registry_stale`·헬스 `registry.stale`·A-006으로 드러난다. 구독자로 적힌 「알림」 채널이 아직 없다. 알림 채널을 붙이는 판이 발행 여부를 정한다 |
| `EVT-GH-005`·`007` | 미구현 (승인·철회 알림). 철회는 `github_identity_connection.revoked_at`과 사유로 남는다 |
