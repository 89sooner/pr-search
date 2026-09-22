#hidden
# aci:v1 id=f3df0a8 src=agent-context/upstream-feedback.md
@kv sha256=e801a88067391b5b74f5bf6aeb36bb0ee6cf3531ade309de9afbae770e092645 bytes=34340 lines=262 title=Upstream-Feedback
@sig agent-context/upstream-feedback.md;packages/es/src/sequence-projection.ts;/prsctl;owner/name;packages/es/src/sequence.ts;apps/pipeline-worker/src/reindex.ts;packages/es/src/merge-number.ts;packages/query/src/identifier.ts;prs/domain;api/v1/resolve;acme/smp1900;tools/app1900;org/smp1900;packages/query/src/keys.ts;apps/search-api/src/sequence/merge-numbers.ts;host/owner/repo/pull/1234;owner/repo;api/v1/merge-numbers/resolve;packages/domain/src/mnumber.ts;apps/web/lib/merge-number.ts;refs/tags/M-;git/refs;git/ref/tags/;update/delete
@h1 Upstream Feedback
@h2 재색인 후 merge_seq가 ES에서 사라져 M number 정렬이 깨진다 (설계 갭)
@path 상류 반영 (CR-113 / WP-098, DEV-733, 2026-09-22) — 요청 1~4를 전부 받아들였고 원인 분석과 같다. 수렴 경로가 없었다는 진단이 맞다: 채번 뒤 단발 update_by_query는 문서가 없으면 0건으로 끝나 다시 오지 않았고, 직접 푸시 커밋 문서는 sequence.assigned 이벤트 뒤에 보강이 만들어 구조적으로 서수를 받지 못했으며, 재색인은 replay가 없었다. 고친 것: (1) 서수 쓰기를 문서 ID 기반 guarded update(packages/es/src/sequence-projection.ts — mget 사전 판정 + painless 가드, 문서별 updated·noop·document_missing·guard_rejected·stale_epoch·transient)로 바꾸고 옛 applySequenceToDocuments를 지웠다. (2) 채번·재채번·복구 트랜잭션이 durable sequence_work project(tail·full)를 남기고, 늦은 PR 스냅숏은 문서 단위 work를, 커밋 보강은 문서 생성 직후 인라인 투영을 한다 — 새 push 없이 수렴하며 MNUMBER_ENABLED=false에서도 돈다(마이그레이션 034). (3) 재색인은 PR·커밋 재구축 직후 현재 정본을 replay하고 verifyBeforeCutover가 target 인덱스의 원시 필드·대표 정렬을 정본과 대조하며, 전환 울타리 안에서 에폭을 다시 본다. (4) sequence_reassign이 consistent여도 full sweep을 예약하고 잡 progress에 db/projection을 따로 적는다. 요청 3의 --force-reproject는 새 잡 유형 sequence_reproject(API-ADM-002, expected_epoch 필수)와 ./prsctl sequence reproject --repository <owner/name> --base-branch main --expected-epoch <현재 에폭> [--dry-run](RUNBOOK 7.E, RB-27)으로 들어왔다 — dry-run은 PG·ES·작업 큐·감사에 아무것도 쓰지 않는다. 재투영은 재채번이 아니다 — 기존 merge_seq·M 번호·에폭·head는 바뀌지 않으며, 이 보고의 「사내 임시 조치」(update_by_query 직접 실행)는 더 이상 쓰지 않는다(문서별 판정 없이 덮어쓴다). 반입 뒤 할 일: ./prsctl upgrade(034 적용) 뒤 저장소마다 ./prsctl sequence reproject … --dry-run으로 would_update 건수를 보고, --dry-run 없이 실행한 뒤 새 검색 요청으로 「M number」 정렬·seq: 범위를 확인해 이 항목 아래에 적어 달라. 사내 배포 SHA는 이 저장소에서 확인하지 못했다(pilot.17 태그 없음, NOT VERIFIED) — 반입 시 ./prsctl lineage로 함께 적어 달라. main a6ea00d(PR #223)에 병합됐다. *(이 주석은 2026-09-22 14:48 사내 동기화 커밋 aeb2b8e가 파일을 통째로 덮으며 지웠던 것을 CR-114 브랜치에서 복원한 것이다 — 사내 쪽 사본에도 함께 실어 달라.)*
@p 발견: 0.1.0-pilot.17 사내 운영, prs-pull-requests 재색인 후 (2026-09-22)
@path 관련: WP-074 / FR-SEQ-008 / ADR-004 / packages/es/src/sequence.ts / apps/pipeline-worker/src/reindex.ts
@h3 현상
@p Search 페이지에서 "M number" 내림차순 정렬이 "Merged at" 내림차순과 다른 결과를 보인다.
@path M-1900-1450이 M-1900-1449보다 아래에 나타나는 등 M 번호 역순이 깨진다.
@p 원인은 ES merge_seq 필드가 대량으로 비어 있기 때문이다.
@p | 시점 | ES merge_seq 있는 PR | DB merge_sequence 행 | | ------------ | ---------------------: | ---------------------: | | 재색인 전 | 38 / 1,906 | 1,467 | | 재색인 직후 | 0 / 4,214 | 1,467 | | 수동 복구 후 | 1,457 / 4,214 | 1,467 |
@h3 근본 원인: merge_seq의 ES 투영이 fire-and-forget이며 재색인 뒤 재투영 경로가 없다
@p merge_seq와 merge_number는 서로 다른 코드 경로로 ES에 쓰인다.
@path merge_seq — applySequenceToDocuments (packages/es/src/sequence.ts:71):
@b update_by_query로 merge_commit_sha가 매칭되는 PR 문서에 merge_seq를 쓴다.
@b 새로 할당된 시퀀스만 applied 배열에 들어가서 ES에 쓰인다 (sequence.ts:267-278).
@b 이미 DB에 할당된 시퀀스는 applied에 들어가지 않으므로 ES에 재투영되지 않는다.
@b 실패해도 던지지 않고 다음 push 회차에 맡긴다 (sequence.ts:283-299).
@b 재시도 메커니즘이 없다. merge_number의 materialize durable work에 해당하는 것이 merge_seq에는 없다.
@path merge_number — applyMergeNumberToDocument (packages/es/src/merge-number.ts:64):
@b 개별 PR 문서를 GET으로 읽어 가드 검사 후 update 스크립트로 쓴다.
@b materialize durable work가 done이 될 때까지 재시도한다 (mnumber.ts:469-488).
@b 재색인 후에도 requestMergeNumberMaterialize가 materialize work를 다시 예약한다 (reindex.ts:578-609).
@path 재색인 — runReindexJob (apps/pipeline-worker/src/reindex.ts:736):
@b PostgreSQL 스냅숏에서 문서를 다시 만든다.
@b 스냅숏에는 merge_seq가 없다 — 투영이 그 키를 싣지 않기 때문이다 (reindex.ts:343-345 주석: "서수는 여기서 싣지 않는다. 채번 반영은 applySequenceToDocuments가 소유하고 그 경로가 재구축 뒤에 돈다").
@b merge_number는 requestMergeNumberMaterialize로 재투영 의도를 남긴다 (reindex.ts:621).
@b merge_seq에 해당하는 재투영 단계가 없다. 주석이 "재구축 뒤에 돈다"고 가정하지만, 그 경로가 실제로 트리거되지 않는다.
@p sequence_assign 잡 — 수동 트리거해도 이미 DB에 할당된 시퀀스는 "새로 할당할 것이 없다"로 끝나고, applied가 빈 배열이 되어 ES에 아무것도 쓰지 않는다.
@p sequence_reassign 잡 — repairSequence가 "이미 일관적"이라고 판정하면 consistent를 반환하고 에폭을 올리지 않으므로 ES 재투영이 일어나지 않는다.
@h3 타이밍 불일치 (초기 투영 갭)
@p 재색인이 아니어도 발생한다. applySequenceToDocuments가 실행될 때 PR 문서에 merge_commit_sha가 아직 없으면 (투영이 덜 되었으면) update_by_query가 매칭되는 문서 0개로 끝난다. 나중에 투영이 merge_commit_sha를 채워도 applySequenceToDocuments는 재실행되지 않으므로 merge_seq가 영영 빠진다.
@p 운영 서버에서 재색인 전 38개만 merge_seq가 있었던 것이 이 패턴이다 — 나머지 1,429개는 시퀀스 할당 시점에 PR 문서에 merge_commit_sha가 없었고, 이후 재투영 경로가 없었다.
@h3 사내 임시 조치
@p DB merge_sequence 테이블에서 commit_sha → merge_seq 매핑을 읽어 ES update_by_query로 직접 씀:
@b merge_sequence에서 매핑 추출
@b 500개 청크로 분할
@b ES update_by_query로 merge_commit_sha가 매칭되는 PR 문서에 merge_seq, seq_epoch, sequence_space, base_branch를 씀
@b 1,457문자 업데이트 확인 (10개는 PR 없는 direct push로 merge_commit_sha 없음)
@p DB merge_sequence 테이블에서 commit_sha → merge_seq 매핑을 읽어 ES update_by_query로 직접 씀:
@b merge_sequence에서 매핑 추출
@b 500개 청크로 분할
@b ES update_by_query로 merge_commit_sha가 매칭되는 PR 문서에 merge_seq, seq_epoch, sequence_space, base_branch를 씀
@b 1,457문자 업데이트 확인 (10개는 PR 없는 direct push로 merge_commit_sha 없음)
@h3 요청
@b 재색인 후 merge_seq 재투영 경로 추가 — requestMergeNumberMaterialize가 merge_number를 위해 하는 일을 merge_seq에도 해야 한다. 재색인 완료 후 applySequenceToDocuments를 전체 시퀀스에 ... 약하는 단계가 rebuildAlias에 있어야 한다. 현재 주석은 "재구축 뒤에 돈다"고 가정하지만 그 경로가 트리거되지 않는다.
@b merge_seq에 durable work 재시도 추가 — merge_number의 materialize work는 ES에 쓸 때까지 재시도한다. merge_seq에도 같은 규율이 필요하다. applySequenceToDocuments가 fire-and-f ... date 스크립트)로 바꾸거나, update_by_query 결과의 updated 수가 예상과 다르면 work를 재시도해야 한다.
@b sequence_assign 잡에 --force-reproject 옵션 추가 — 수동 트리거 시 "새로 할당된 것만"이 아니라 "DB에 있는 전체 시퀀스를 ES에 다시 쓰는" 모드가 있어야 한다. 운영자가 재색인 후 이 모드로 실행하면 복구할 수 있다. 현재는 sequence_assign이 아무 일도 하지 않고 completed로 끝난다.
@b sequence_reassign이 consistent일 때도 ES에 쓰기 — repairSequence가 "이미 일관적"이라고 판정해도 ES에는 merge_seq가 비어 있을 수 있다. consistent는 DB의 일관성이지 ES의 일관성이 아니다. ES 투영 상태를 함께 검사하거나, consistent일 때도 applySequenceToDocuments를 전체에 대해 실행해야 한다.
@p ---
@h2 검색창에서 M-번호 완전 검색이 안 된다 (기능 누락)
@path 상류 반영 (CR-114 / WP-099, DEV-738, 2026-09-22) — 요청 1은 그대로, 요청 2는 일부만 받아들였다. (1) 판별기(packages/query/src/identifier.ts)가 M-<코드>-<번호>를 유형 merge_number로 읽는다 — 정규식은 @prs/domain의 parseMergeNumber 하나를 재사용하고, PR 제목 접두 [M-1900-1450]과 소문자 m-1900-1450도 같은 것으로 읽는다. /api/v1/resolve는 그 해석을 정본에서 푼다: 접근 범위 안에서 저장소 이름의 코드가 같은 저장소들의 추적 브랜치마다 현재 에폭 merge_sequence.merge_number에서 PR을 찾아 pull_request 후보로 낸다(색인의 merge_number나 표시 문자열은 읽지 않는다 — 투영은 늦을 수 있다). 후보에 merge_number·merge_number_epoch·merge_number_state와 정본의 merge_seq·seq_epoch·sequence_space가 실린다. 코드가 같은 저장소(예: acme/smp1900·tools/app1900)나 시퀀스 브랜치가 여럿이면 후보 배열이며 자동 이동하지 않는다(FR-SRCH-001 AC-5). 검색창(Repository workspace·legacy 화면 모두)이 이 문자열을 해석 경로로 보낸다. M 번호 기능이 꺼진 배포(MNUMBER_ENABLED=false)는 후보 0건과 reason_code: merge_number_disabled(200)로 답한다. (2) mnum:1450은 mnum:1450..1450과 같은 닫힌 범위로 받는다. base:는 저장소가 추적하는 시퀀스 브랜치가 하나뿐일 때 생략할 수 있다(repo:org/smp1900 mnum:1450) — 둘 이상이면 400과 브랜치 목록으로 거절한다. 받아들이지 않은 것: 「repo:도 없이 접근 범위 전체 저장소에서 검색」. 서수는 시퀀스 공간 안에서만 뜻이 있고(ADR-007 규칙 1) 공간마다 유효 에폭이 달라 merge_number_epoch 게이트를 공간마다 걸어야 하며, 같은 코드의 공간이 여럿이면 같은 번호가 다른 PR을 가리킨 채 한 목록에 섞인다. 저장소를 건너 한 줄로 찾는 요구는 코드를 담은 M-1900-1450 문자열이 채운다. 제품 결정으로 SRS OD-014(권고안: 열지 않음)에 열어 두었으니 다른 판단이면 알려 달라. seq:·pr_number:의 단일 값은 열지 않았다(요청에 없음). 반입 뒤 할 일: 검색창에 M-<코드>-<번호> 하나만 넣어 PR 상세로 가는지, repo:<owner/name> mnum:<n>이 한 건을 내는지 확인해 이 항목 아래에 적어 달라. 사내 배포 SHA는 NOT VERIFIED(반입 시 ./prsctl lineage로 함께).
@p 발견: 0.1.0-pilot.17 사내 운영 (2026-09-22)
@path 관련: FR-SRCH-001 / FR-SRCH-004 / packages/query/src/identifier.ts / packages/query/src/keys.ts / apps/search-api/src/sequence/merge-numbers.ts
@h3 현상
@path 검색창에 M-1900-1450을 입력하면 PR 하나가 나오는 것이 아니라 전문 검색(full-text)으로 처리되어 의도한 결과가 나오지 않는다.
@h3 근본 원인: 식별자 판별기가 M-번호를 모른다
@path detectIdentifier (packages/query/src/identifier.ts:194)는 다음만 인식한다:
@path GHE URL (https://host/owner/repo/pull/1234, /commit/<sha>)
@path #1234 / owner/repo#1234
@b 순수 정수 (PR 번호)
@b 7~39자 hex (커밋 SHA 접두)
@b 40자 hex (커밋 SHA 정확)
@path M-1900-1450 형식은 어디에도 맞지 않아 text 해석으로 떨어진다 (identifier.ts:256-258).
@h3 mnum: 쿼리 키는 있지만 범위 전용
@p mnum: 키가 등록되어 있다 (keys.ts:67), 그러나:
@b range-only — 스칼라 mnum:1450는 파서가 거부한다 (parse.ts:200-202, rangeOnlyKey 에러)
@b 단일 검색조차 mnum:1450..1450으로 써야 한다
@b repo: + base: 바인딩이 필수이고 merge_number_epoch 게이트가 걸려 있다 (query-builder.ts:158-168)
@path M-번호 표시 문자열(M-1900-1450)이 아니라 숫자 ordinal(1450)만 다룬다
@h3 resolve API는 있지만 검색과 연결되지 않는다
@path GET /api/v1/merge-numbers/resolve (apps/search-api/src/sequence/merge-numbers.ts:100)가 M-1900-1450 문자열을 파싱하여 PR을 찾는다 (packages/domain/src/mnumber.ts:69, 정규식 /^M-([0-9]+)-([1-9][0-9]*)$/).
@path 그러나 이 API는 검색 쿼리 언어가 아니라 URL 파라미터(m_number, m_repository, m_base_branch, m_seq_epoch)로만 접근한다 (apps/web/lib/merge-number.ts:27-32). 검색창 q와 연동되지 않는다.
@h3 요청
@path 식별자 판별기에 M-번호 패턴 추가 — detectIdentifier가 M-<code>-<number> 정규식을 인식하여 merge_number 해석을 반환하도록 추가. packages/domain/src/mnumber.ts:20의 정규식(/^M-([0-9]+)-([1-9][0-9]*)$/)을 재사용. 해석 결과로 resolve API를 호출하거나 mnum: 쿼리로 변환하면 검색창에서 M-1900-1450 입력 한 줄로 PR을 찾을 수 있다.
@b mnum: 스칼라 검색 지원 — range-only 제약을 풀고 mnum:1450 단일 값 검색을 허용. repo: + base: 바인딩이 생략되면 (M-번호의 code 부분으로 저장소를 역산하거나) 접근 범위 내 전체 저장소에서 검색. 현재는 mnum:1450..1450 + repo: + base:를 모두 써야 하는 것이 사용자 관점에서 비현실적이다.
@p ---
@h2 수집 파이프라인에서 머지된 M-번호 단위로 커밋에 태그를 달아야 한다 (기능 누락)
@cmd 상류 반영 (CR-115 / WP-100, FR-SEQ-012, 2026-09-22) — 요청 1~6을 전부 받아들였고 확정 요건대로 구현했다(기본 꺼짐). (1) 채번 트랜잭션이 PR마다 durable tag work를 번호·checkpoint와 같은 트랜잭션에 남기고, tag 역할(JOB-SEQ-007, worker-annotate 컨테이너에 annotate,tag)이 그것을 집어 원격 GHE에 refs/tags/M-{BR#}-{N}을 lightweight로 만든다 — POST /repos/{o}/{r}/git/refs에 {ref, sha}만 싣는다(tagger·message·GPG 없음). 이름은 M 표기 문자열 그 자체이고 대상은 정본 행의 squash merge commit SHA다. (2) 처리 순서는 요청대로다: 정본 재확인 → GET /git/ref/tags/… → 없음이면 생성 / 같은 SHA면 성공(호출 없음) / 다른 SHA 또는 annotated면 conflict로 기록·보고만 — force-update·삭제 메서드가 클라이언트에 아예 없고 회귀 시험이 그 부재를 잠근다. 응답을 받지 못한 생성은 unknown으로 남겼다가 다음 시도의 조회가 확정하고, 403·404는 저장소를 차단해 쿨다운 뒤 다시 보며, 429는 대기 신호까지 기다린다. 실패는 성공할 때까지 재시도하고 워커 재시작·이벤트 유실·CR-115 이전에 채번된 번호는 일 1회 잔여 스윕(회차당 MNUMBER_TAG_SWEEP_LIMIT, 기본 500)이 backfill한다. (3) 불변성 보호 — 이 제품은 태그를 옮기거나 지우지 않는다. GHE ruleset으로 M-*의 update/delete를 막고 생성만 App에 허용하는 것은 RUNBOOK 7.F의 운영 절차이며(이 제품이 규칙을 만들지 않는다), 잘못 만든 태그의 정정도 사람이 GHE에서 지운 뒤 대조로 다시 만드는 절차다. (4) prs-commits의 role: merge_commit 문서에 merge_number·merge_number_epoch·merge_number_state를 투영한다(PR 문서와 같은 materialize work가 둘 다 쓰고, 에폭 상향 정리·재색인 뒤 재투영도 커밋 문서까지) — kind:commit repo:… mnum:…이 성립한다. 커밋 검색 결과 행·화면 배지에 그 값을 노출하는 것은 이번에 열지 않았다(DEV-742, 색인 값은 있다). (5) 대조 — 잡 mnumber_tag_reconcile(운영 화면 A-003 실행 폼 「M-number tag reconcile (GHE tags)」, POST /api/v1/admin/jobs)과 ./prsctl mnumber tags reconcile --repository <owner/name> --base-branch main [--dry-run]·./prsctl mnumber tags status …: DB에 있으나 원격에 없으면 재생성(work 재요청), 다른 SHA·annotated는 보고만, 원격에만 있는 M-*도 보고만. dry-run은 원격을 읽기만 하고 PG·작업 큐·감사에 아무것도 쓰지 않는다. (6) 실제 git 저장소에 가짜 GHE가 받은 ref를 적용해 git rev-parse·show·log a..b·diff a..b·describe --tags·checkout·log --oneline --decorate가 태그로 동작함을 시험으로 증명했다. 받아들이지 않은 것·유보한 것: 시퀀스 브랜치를 둘 이상 추적하는 저장소는 태그 이름에 브랜치가 없어 만들지 않고 disabled(multiple_sequence_branches)로 남긴다(SRS OD-015, 권고안: 저장소별 태그 대상 브랜치 설정 — 다른 판단이면 알려 달라); annotated 태그는 쓰지 않는다. 자격은 태그 전용 App(Contents: write — ref 생성에 공식 문서가 요구하는 권한이며 표기 App의 Pull requests: write보다 넓다)이라 표기 App과도 나눴다(GHE_TAG_APP_ID·GHE_TAG_PRIVATE_KEY·GHE_TAG_INSTALLATIONS, 전역 MNUMBER_TAG_ENABLED 기본 false, 저장소별 tag_enabled). 감사 merge_number.tag(system:tag)는 실제로 만든 경우(created)와 결과 불명 뒤 관측(observed)만 남긴다. 반입 뒤 할 일: 태그 전용 App 등록·설치와 M-* ruleset을 먼저 만들고, ./prsctl upgrade(마이그레이션 035) 뒤 한 저장소만 tag_enabled로 두고 MNUMBER_TAG_ENABLED=true로 켠 다음, ./prsctl mnumber tags status …로 done이 느는지와 로컬 클론에서 git fetch --tags && git rev-parse M-1900-1450을 확인해 이 항목 아래에 적어 달라. 이미 손으로 만든 M-* 태그가 있다면 켜기 전에 --dry-run 대조로 conflict 목록을 먼저 본다. 사내 배포 SHA는 NOT VERIFIED(반입 시 ./prsctl lineage로 함께).
@p 발견: 0.1.0-pilot.17 사내 운영 (2026-09-22)
@path 관련: FR-SEQ-008 / packages/es/src/mappings/commits.ts / apps/pipeline-worker/src/mnumber.ts / apps/pipeline-worker/src/release.ts
@h3 확정 요건
@p M-number 할당 완료 후 해당 merge commit SHA에 Lightweight Tag를 자동 생성하여 GHE 원격 저장소에 push한다.
@path 태그 명명 규칙: M-{BR#}-{N} (예: M-1900-1, M-1900-1450, M-1900-2130)
@path {BR#} = M-number의 branch/repository code
@b {N} = 해당 sequence의 ordinal
@path Annotated Tag가 아닌 Lightweight Tag 사용 (tagger/message/GPG 불필요)
@path 로컬 mirror에만 만들지 말고 GHE 원격 저장소의 refs/tags/M-{BR#}-{N}에 반영
@h3 Tag 생성 처리 순서
@b PR merge commit SHA 확정
@b 기존 로직에서 M-number atomic 할당
@b DB에 M-number ↔ merge_commit_sha 확정
@b M-{BR#}-{N} Lightweight Tag 생성 요청을 durable work로 등록
@b 원격 GHE의 동일 tag 존재 여부 확인
@b tag 없음 → 생성 후 push
@b tag 존재 + 동일 SHA → 성공으로 간주 (idempotent)
@risk tag 존재 + 다른 SHA → 절대 force-update 금지, conflict/failure 처리
@b 실패한 tag materialization은 성공할 때까지 재시도
@h3 ES 투영 요건
@p prs-commits에 다음 필드 추가 (실제 merge commit role: merge_commit에만 투영):
@b merge_number
@b merge_number_epoch
@b merge_number_state
@p 현재 prs-commits에는 merge_seq는 있지만 merge_number 관련 필드가 없다.
@cmd 두 경로는 역할이 다르며 둘 다 필요하다: Git Lightweight Tag(Git revision 직접 사용) + Commit ES projection(PR Search 검색·정렬).
@h3 재처리 / reconcile 요건
@p tag는 durable work로 관리. 재색인·worker 재시작·Git push 실패 후에도 원격 저장소에 tag가 존재해야 한다.
@path DB merge_sequence와 원격 refs/tags/M-* 정합성 검사 기능 필요:
@b DB에는 있으나 remote tag 없음 → 재생성
@b 다른 SHA를 가리키는 tag → 자동 수정 금지, 오류 보고
@b 운영자가 전체 또는 특정 범위를 재검증할 수 있는 관리 경로 제공
@h3 요청
@b M-number 할당 후 Lightweight Tag를 자동 생성·push (형식: M-{BR#}-{N}, 대상: squash merge commit SHA)
@b Tag materialization을 durable / idempotent하게 구현 (force update 금지, 네트워크 장애 시 재시도, worker 재시작 후 복구)
@dec M-* tag 불변성 보호 (생성 후 이동·삭제 금지, GHE repository rule/tag protection 적용, 잘못 생성된 tag는 별도 무효화/정정 정책)
@b 커밋 ES 문서에 M-number 투영 (prs-commits에 merge_number, merge_number_epoch, merge_number_state 추가, role: merge_commit에만)
@b 재처리 / reconcile 기능 추가 (DB↔remote tag 정합성 검사, 누락 tag 재생성, SHA 불일치는 오류 보고만)
@cmd M-number를 Git revision으로 사용하는 동작을 테스트
@path - git rev-parse M-1900-1450, git show M-1900-1450
@path - git diff M-1900-2010..M-1900-2130, git log M-1900-2010..M-1900-2130
@path - git checkout M-1900-2010, git log --oneline --decorate
@b - lightweight tag를 포함한 git describe --tags
@p ---
@h2 pull_request_numbers union semantics로 과거 PR 번호가 커밋에 영구히 남는다 (설계 갭)
@todo 상류 반영 (CR-116 / WP-101, FR-SRCH-002 AC-6, 2026-09-23) — 삭제의 목적은 그대로 받아들였고, 요청 1의 방식만 다른 것으로 바꿨다. 원인 분석이 맞다: params.union은 HashSet 합집합이라 한 번 더해진 ... . 사내 배포 SHA는 NOT VERIFIED(반입 시 ./prsctl lineage로 함께), 내부망 적용은 NOT RUN이다.
@p 발견: 0.1.0-pilot.17 사내 운영 (2026-09-22)
@path 관련: FR-SRCH-002 / packages/es/src/upsert.ts / apps/pipeline-worker/src/documents.ts / apps/pipeline-worker/src/enrich.ts
@h3 현상
@path commit history 페이지에서 거의 모든 커밋에 아직 open 상태인 PR #2355가 "Linked PRs"로 표시된다. 실제 머지된 PR 번호와 함께 #2355가 항상 2개씩 보인다.
@h3 근본 원인: union 필드는 추가만 하고 빼지 않는다
@p pull_request_numbers는 ES upsert에서 union 필드로 동작한다 (upsert.ts:43-50). HashSet으로 중복만 제거하고 합집합만 수행한다 — 한 번 추가된 PR 번호는 영영 빠지지 않는다.
@p PR 투영 파이프라인 (documents.ts:341-372, enrich.ts:276-279):
@b PR 이벤트(synchronize 등)가 올 때마다 GHE API GET /pulls/{n}/commits로 source_commit_shas를 가져온다.
@b buildCommitDocuments가 source_commit_shas의 각 커밋에 union: { pull_request_numbers: [prNumber] }를 기록한다.
@b 이후 PR이 rebase되어 source_commit_shas가 줄어들어도, 과거에 기록된 PR 번호는 빠지지 않는다.
@h3 발생 조건
@p PR이 base 브랜치의 과거 커밋 위에 있을 때(생성 시점의 base가 현재보다 과거):
@b PR 생성 시 source_commit_shas에 base..head 사이의 커밋이 포함됨
@b 이 커밋들은 dev 브랜치 first-parent 체인 위에 있는 일반 머지 커밋들
@b PR이 rebase되어 base가 최신으로 당겨지면 source_commit_shas가 줄어듦
@b 하지만 과거에 union으로 기록된 PR 번호는 빠지지 않음
@path 실제 사례: PR #2355는 8번의 synchronize 이벤트가 발생했고, 과거 base가 2d8aa30a (9월 17일 커밋)일 때의 source_commit_shas에 dev 체인의 커밋 110개가 포함되었다. 이후 base가 e3ee2f90 (9월 22일 커밋)로 당겨지면서 source_commit_shas가 2개로 줄었지만, 110개 커밋에 #2355가 영구히 남았다.
@h3 영향 규모 (사내 서버)
@p | 항목 | 값 | | -------------------- | ------------------------------------------------------------------------ | | 영향받은 PR | 279개 | | 잘못 연결된 커밋 | 3,481개 (1차) + 660개 (웹훅 재발생분) |
@path | 주요 PR | #983 (250개), #1528 (251개), #1384 (229개), #2272 (174개), #1091 (191개) |
@p | 모든 저장소에서 영향 | repo 1877 (smp1900), 119 (admin), 399 (pipe) |
@h3 사내 임시 조치
@path scripts/cleanup-stale-pr-links.mjs 스크립트로 정리:
@b 모든 PR 문서에서 현재 source_commit_shas + merge_commit_sha를 읽어 유효 SHA 집합 구성
@b 모든 커밋 문서에서 pull_request_numbers를 읽어 유효 SHA 집합에 없는 PR 번호 식별
@b ES update_by_query로 해당 PR 번호를 pull_request_numbers 배열에서 제거
@p 스크립트는 dry-run 기본, --apply로 실행, --repo로 특정 저장소 필터링 지원. 그러나 웹훅이 계속 들어오면 synchronize 이벤트로 union이 다시 추가되므로 일시적 해결이다.
@h3 요청
@b 투영 전 old source_commit_shas를 읽고 빠진 커밋에서 PR 번호 제거 — PR 투영 워커가 PR 문서를 갱신하기 전에 기존 source_commit_shas를 읽고, 새 목록에서 빠진 커밋을 계산하여, 그 커밋에서 PR 번호를 제거하는 u ... 하는 것이다. 이것이 가장 안전한 접근이다 — 기존 구조와 union semantics를 유지하면서 빠진 커밋만 정확히 제거한다.
@b 또는 source_commit_shas를 stateful 대입으로 변경 — pull_request_numbers를 union이 아닌 매 투영마다 전체 목록을 대입하는 stateful 필드로 변경. 단, N:M 관계에서 다른 PR의 번호를 덮어쓰지 않도록, ... 를 "이 PR이 기여한 번호"와 "다른 PR이 기여한 번호"로 분리하거나, PR 번호별로 개별 업데이트해야 한다. 복잡도가 높다.
@b pull_request_numbers에서 빈 배열을 허용하고 빈 배열을 빈 배열로 명시적 대입 — 현재 pull_request_numbers가 빈 배열이 되면 ES에서 필드 자체가 사라지는 데 (cleanup-stale-pr-links.mjs의 painle ... 작인지 확인 필요. 빈 배열을 명시적으로 저장할 수 있다면, "이 PR에 속하는 커밋이 0개"와 "아직 모름"을 구분할 수 있다.
@b 재색인 시 pull_request_numbers 재투영 경로 추가 — 현재 재색인은 merge_seq뿐 아니라 pull_request_numbers도 재투영하지 않는다. 재색인 후에도 모든 커밋의 pull_request_numbers가 빈 상태로 시작하며, ... 의 requestMergeNumberMaterialize와 같은 재투영 단계가 pull_request_numbers에도 필요하다.
