# PR Search 용어집

> 상태: review | 버전: v0.2 | 갱신일: 2026-08-19

## 1. 목적

이 문서는 PR Search 도메인 용어의 단일 정의를 제공한다. 요구사항 문장, UI 라벨, API 경로, 데이터 엔티티, 이벤트 이름은 모두 이 문서의 표준 용어에서 파생된다. 문서 간 용어가 어긋나면 이 문서를 먼저 고치고 cascade한다.

## 2. 용어 표

### 2.1 형상 관리 기본 개념

| 용어(한글 표준) | 영문/코드 표준 | 정의 | 금지 동의어 | 관련 ID |
| --- | --- | --- | --- | --- |
| 저장소 | `repository` | 수집 대상이 되는 GitHub Enterprise 저장소 1개. 식별자는 `<owner>/<name>`이며 내부 키는 GHE 숫자 ID다 | 레포, repo, 프로젝트 | ENT-CORE-001 |
| 풀 리퀘스트 | `pull_request` | GHE의 병합 제안 단위. 사내 정책상 Squash & Merge만 사용하므로 머지된 PR 1건은 target 브랜치 커밋 1개를 만든다 | PR 요청, 머지 리퀘스트, MR | ENT-CORE-002 |
| PR 번호 | `pr_number` | 저장소 안에서 PR **생성 시점**에 부여되는 번호. 머지 순서를 뜻하지 않는다 | PR ID, 티켓 번호 | FR-SRCH-001 |
| 커밋 | `commit` | Git 커밋 1개. 40자 hex SHA로 식별한다 | 체인지셋, 리비전 | ENT-CORE-003 |
| 커밋 SHA | `commit_sha` | 커밋의 40자 hex 식별자. 7자 이상 접두는 축약 SHA로 취급한다 | 해시, 커밋 ID, 리비전 번호 | FR-SRCH-004 |
| 축약 SHA | `short_sha` | 커밋 SHA의 앞 7~12자 접두 문자열 | 짧은 해시 | FR-SRCH-004 |
| 머지 커밋 | `merge_commit_sha` | Squash & Merge 결과로 target 브랜치에 생긴 커밋의 SHA. PR과 1:1 대응한다 | 스쿼시 커밋, 최종 커밋 | FR-SRCH-003 |
| 원본 커밋 | `source_commit` | 머지 이전 PR head 브랜치에 있던 커밋. Squash 후 target 브랜치에는 존재하지 않는다 | 개별 커밋, 작업 커밋 | FR-SRCH-003 |
| 대상 브랜치 | `base_branch` | PR이 병합되는 브랜치. 머지 시퀀스 공간의 단위다 | 베이스, target, 기준 브랜치 | FR-SEQ-001 |
| 소스 브랜치 | `head_branch` | PR의 변경이 담긴 브랜치 | head, 피처 브랜치 | FR-REL-006 |
| 최초 부모 | `first_parent` | 머지 커밋의 첫 번째 부모. target 브랜치의 선형 히스토리를 따라간다 | 부모 커밋 | FR-SEQ-001 |

### 2.2 머지 시퀀스 (P4 CL 대체 개념)

| 용어(한글 표준) | 영문/코드 표준 | 정의 | 금지 동의어 | 관련 ID |
| --- | --- | --- | --- | --- |
| 머지 시퀀스 | `merge_seq` | (저장소, 대상 브랜치)마다 first-parent 히스토리를 루트부터 세어 각 커밋에 부여하는 1부터 시작하는 정수 서수. Perforce Changelist 번호와 같은 역할을 한다 | 시퀀스 번호, CL, 순번, 리비전 번호 | FR-SEQ-001, ENT-SEQ-001 |
| 시퀀스 공간 | `sequence_space` | 머지 시퀀스가 유효한 범위 단위. `(repository, base_branch)` 조합 1개가 시퀀스 공간 1개다. 서로 다른 시퀀스 공간의 번호는 비교하지 않는다 | 시퀀스 네임스페이스 | FR-SEQ-001 |
| 시퀀스 에폭 | `seq_epoch` | 시퀀스 공간의 재채번 세대 번호. 강제 푸시로 히스토리가 재작성되면 1 증가하며, 이전 에폭의 범위 인용은 무효로 표시된다 | 세대, 버전 | FR-SEQ-005 |
| 시퀀스 범위 | `sequence_range` | 시퀀스 공간 안의 반개구간 `(from_seq, to_seq]`. 시작 앵커는 제외하고 끝 앵커는 포함한다 | 구간, 범위 조회 | FR-SEQ-002 |
| 앵커 | `anchor` | 시퀀스 값으로 변환할 수 있는 지정 수단. 릴리스 태그, 커밋 SHA, PR 번호, 시각, 시퀀스 값 자체를 앵커로 쓴다 | 기준점, 마커 | FR-SEQ-003 |
| 릴리스 | `release` | 배포 단위를 가리키는 Git 태그 또는 CI 배포 이벤트. 시퀀스 앵커로 사용한다 | 빌드, 배포, 버전 | ENT-REL-001, FR-SEQ-004 |
| 안전 구간 표식 | `safe_marker` | "이 시퀀스까지는 검증됐다"를 기록한 표식. 시퀀스 공간별로 최신 표식 1개를 유지한다 | 검증선, 안전선 | FR-SEQ-006 |
| 조사 구간 | `investigation_range` | 회귀 원인을 찾기 위해 조사 대상으로 지정한 시퀀스 범위 | 의심 구간 | FR-SEQ-007 |

### 2.3 관계

| 용어(한글 표준) | 영문/코드 표준 | 정의 | 금지 동의어 | 관련 ID |
| --- | --- | --- | --- | --- |
| 관계 간선 | `link` | 두 개체(PR, 커밋, 릴리스, 이슈) 사이의 방향성 있는 관계 1건. 유형, 근거, 신뢰도를 함께 저장한다 | 엣지, 연결, 릴레이션 | ENT-REL-002, FR-REL-003 |
| 관계 유형 | `link_type` | 간선의 종류. `contains`, `precedes`, `references`, `reverts`, `cherry_picks`, `stacks_on`, `co_changes` 중 하나 | 링크 타입, 관계 종류 | FR-REL-001~007 |
| 포함 관계 | `contains` | PR이 커밋을 포함하거나 릴리스가 커밋을 포함하는 관계 | 소속, 하위 | FR-REL-002 |
| 선행 관계 | `precedes` | 같은 시퀀스 공간에서 시퀀스 값이 작은 개체가 큰 개체보다 먼저 반영되었음을 뜻하는 관계 | 이전, 앞선 | FR-REL-001 |
| 선행 항목 | `predecessor` | 기준 개체보다 머지 시퀀스가 작은 **항목**. PR 머지 커밋일 수도, 직접 푸시 커밋일 수도 있다 (CR-031) | 이전 PR, 앞 PR, 선행 PR | FR-REL-001 |
| 후행 항목 | `successor` | 기준 개체보다 머지 시퀀스가 큰 **항목**. PR 머지 커밋일 수도, 직접 푸시 커밋일 수도 있다 (CR-031) | 다음 PR, 뒤 PR, 후행 PR | FR-REL-001 |
| 참조 관계 | `references` | 텍스트에 적힌 `#123`, `Refs:`, 이슈 키 등에서 파생한 관계 | 언급, 멘션 | FR-REL-003 |
| 되돌림 관계 | `reverts` | 어떤 변경을 취소하는 커밋/PR과 취소 대상 사이의 관계 | 롤백, 취소 | FR-REL-004 |
| 체리픽 관계 | `cherry_picks` | 다른 브랜치의 동일 변경을 옮겨 담은 관계 | 백포트, 이식 | FR-REL-005 |
| 스택 관계 | `stacks_on` | PR의 대상 브랜치가 다른 PR의 소스 브랜치인 의존 관계 | 체인, 종속 PR | FR-REL-006 |
| 동시 변경 관계 | `co_changes` | 변경 경로 집합이 겹치는 두 PR 사이의 상관 관계 | 연관 변경 | FR-REL-007 |
| 패치 아이디 | `patch_id` | `git patch-id`가 산출하는, 공백·컨텍스트 차이에 둔감한 diff 지문. 체리픽 탐지에 쓴다 | diff 해시 | FR-REL-005 |
| 관계 신뢰도 | `link_confidence` | 간선 근거의 확실성. `exact`(SHA 일치), `derived`(구조 파생), `heuristic`(텍스트 추정) 세 단계다 | 정확도, 스코어 | FR-REL-003 |

### 2.4 검색

| 용어(한글 표준) | 영문/코드 표준 | 정의 | 금지 동의어 | 관련 ID |
| --- | --- | --- | --- | --- |
| 통합 검색 | `omni_search` | 입력 문자열 1개의 형태를 판별해 대상 개체로 해석하는 검색 진입점 | 만능 검색, 스마트 검색 | FR-SRCH-001 |
| 식별자 해석 | `resolve` | 입력 문자열을 개체 유형과 ID로 판별하는 동작 | 파싱, 인식 | FR-SRCH-001 |
| 해석 후보 | `resolution_candidate` | 식별자 해석 결과가 2건 이상일 때 제시하는 각 후보 | 모호성 결과 | FR-SRCH-001 |
| 구조화 질의 | `structured_query` | `repo:`, `author:`, `merged:`, `seq:` 같은 `key:value` 토큰으로 구성한 질의 문자열 | 검색 문법, 쿼리 DSL | FR-SRCH-005 |
| 필터 | `filter` | 결과 집합을 좁히는 조건 1개 | 조건, 파라미터 | FR-SRCH-006 |
| 패싯 | `facet` | 현재 결과 집합에 대한 필드별 값 분포와 건수 | 집계 사이드바, 분포 | FR-SRCH-009 |
| 커서 | `cursor` | 다음 페이지 위치를 가리키는 불투명 문자열. Elasticsearch `search_after` 값을 봉인해 만든다 | 오프셋, 페이지 토큰 | FR-SRCH-008 |
| 저장된 검색 | `saved_search` | 이름을 붙여 재사용·공유하는 질의 | 북마크, 즐겨찾기 | ENT-CORE-006, FR-SRCH-010 |

### 2.5 수집 파이프라인

| 용어(한글 표준) | 영문/코드 표준 | 정의 | 금지 동의어 | 관련 ID |
| --- | --- | --- | --- | --- |
| 웹훅 이벤트 | `webhook_event` | GHE가 전송한 HTTP 요청 1건과 그 payload | 훅, 알림 | ENT-ING-001, FR-ING-001 |
| 전달 식별자 | `delivery_id` | GHE가 웹훅 요청마다 부여하는 고유 ID(`X-GitHub-Delivery`). 멱등 키로 사용한다 | 딜리버리 ID, 요청 ID | FR-ING-002 |
| 원본 이벤트 | `raw_event` | 검증을 통과한 웹훅 payload를 가공 없이 보관한 레코드. 색인 재구성의 근거다 | 로우 데이터, 원문 | ENT-ING-001, FR-ING-003 |
| 보강 | `enrichment` | 웹훅 payload에 없는 커밋 목록, 변경 파일, 리뷰를 GitHub API 또는 미러에서 채워 넣는 처리 | 확장, 보완 | FR-ING-004, JOB-ING-002 |
| 투영 | `projection` | 원본 이벤트와 보강 결과를 검색 문서 형태로 정규화하는 처리 | 변환, 매핑 | FR-ING-005, JOB-ING-003 |
| 검색 문서 | `search_document` | Elasticsearch에 저장되는 정규화 문서 1건 | 인덱스 문서, ES 도큐먼트 | ENT-CORE-002 |
| 인덱스 별칭 | `index_alias` | 애플리케이션이 참조하는 논리 인덱스 이름. 재색인 시 실제 인덱스를 원자적으로 교체한다 | alias, 별명 | FR-ING-008 |
| 백필 | `backfill` | 웹훅 이전 과거 데이터를 GitHub API로 채우는 일괄 수집 | 초기 적재, 마이그레이션 | JOB-ING-004, FR-ING-006 |
| 조정 스캔 | `reconciliation_scan` | 수집 결과와 GHE 실제 상태를 주기적으로 대조해 누락을 찾는 처리 | 정합성 검사, 싱크 체크 | JOB-ING-005, FR-ING-011 |
| 재색인 | `reindex` | 새 매핑으로 인덱스를 다시 만들고 별칭을 전환하는 처리 | 리인덱싱, 재구축 | JOB-ING-006, FR-ING-008 |
| 실패 대기열 | `dead_letter_queue` | 재시도 상한을 넘긴 이벤트를 격리 보관하는 큐 | DLQ, 오류 큐 | FR-ING-007 |
| 수집 지연 | `ingestion_lag` | 웹훅 수신 시각과 검색 반영 시각의 차이 | 처리 지연, 랙 | NFR-002 |
| 이벤트 버스 | `event_bus` | 수신기와 워커 사이의 전달 계층 추상화. Redis Streams 또는 Kafka 어댑터로 구현한다 | 메시지 큐, 브로커 | ADR-002 |
| 미러 | `mirror` | 커밋 그래프 계산을 위해 유지하는 blobless bare 클론 | 로컬 클론, 캐시 | ADR-005 |

### 2.6 권한과 감사

| 용어(한글 표준) | 영문/코드 표준 | 정의 | 금지 동의어 | 관련 ID |
| --- | --- | --- | --- | --- |
| 사용자 | `user` | SSO로 인증된 사내 구성원 | 계정, 멤버 | ENT-CORE-005 |
| 팀 | `team` | GHE 조직의 팀. 권한 판정과 집계 그룹의 단위다 | 그룹, 조직 | ENT-CORE-004 |
| 접근 범위 | `access_scope` | 사용자가 조회할 수 있는 저장소 ID 집합 | 권한 목록, ACL | FR-AUTH-002 |
| 강제 필터 | `mandatory_filter` | 모든 검색 질의에 서버가 무조건 결합하는 접근 범위 조건 | 보안 필터, 권한 필터 | FR-AUTH-002 |
| 권한 캐시 | `permission_cache` | 접근 범위를 저장해 두는 캐시. 최대 신선도 5분을 보장한다 | ACL 캐시 | FR-AUTH-003 |
| 감사 기록 | `audit_record` | 조회·내보내기·관리 액션 1건의 기록 | 로그, 이력 | ENT-CORE-007, FR-AUTH-004 |

## 3. 네이밍 규칙

- 엔티티/테이블: 영문 표준명 단수형 snake_case (예: `pull_request`, `merge_sequence`)
- Elasticsearch 인덱스: `prs-<개체 복수형>-<버전>` 형태의 실제 인덱스와 `prs-<개체 복수형>` 별칭 (예: `prs-pull-requests-v1` / 별칭 `prs-pull-requests`)
- Elasticsearch 필드: snake_case, 위 표의 영문 표준명을 그대로 사용한다. 축약 금지(`sha` 단독 사용 금지, `commit_sha`로 쓴다)
- API 경로: 영문 표준명 복수형 kebab-case (예: `/api/v1/pull-requests`, `/api/v1/sequence-ranges`)
- 이벤트 이름: `<도메인>.<행위>` (예: `ingestion.event_received`, `sequence.reassigned`)
- 잡 이름: `<도메인>.<작업>` (예: `ingestion.backfill`, `sequence.assign`)
- UI 라벨: 위 표의 한글 표준 용어만 사용한다. 금지 동의어를 화면에 노출하지 않는다
- 코드 식별자: 영문 표준명 기반 camelCase(TypeScript 변수/함수), PascalCase(타입/컴포넌트)

## 4. 운영 원칙

1. FR에 등장하는 모든 도메인 명사는 이 표에 존재해야 한다.
2. 용어 변경은 CR을 통해 진행하고 요구사항/UI/API/데이터 문서로 cascade한다.
3. 금지 동의어를 발견하면 표준 용어로 치환한다.
4. "CL", "Changelist"는 Perforce 개념을 설명할 때만 사용하고, 이 제품의 기능 명칭으로는 사용하지 않는다. 제품 안에서의 대응 개념은 항상 **머지 시퀀스**다.
5. "빌드"와 "릴리스"를 혼용하지 않는다. 시퀀스 앵커가 되는 개체는 항상 **릴리스**이며, 릴리스의 표시 이름이 `build-YYYYMMDD-NN`일 수 있을 뿐이다.

## GitHub Operations 용어 (CR-005 신규)

| 용어 | 코드 표기 | 정의 | 혼동 주의 | 관련 FR |
| --- | --- | --- | --- | --- |
| Search / Data Plane | - | 웹훅 수집·검색·분석을 담당하는 읽기 전용 파생 시스템 축 | Operations Plane과 자격 증명·감사가 분리된다 | ADR-013 |
| GitHub Operations Plane | - | 사용자가 명시적으로 요청한 GitHub 작업을 실행하는 축 | 데이터 파이프라인이 아니다 | FR-GH-002 |
| capability | `gh_capability` | 실행 가능한 `gh` command path 하나와 그 argument·flag·제약·위험도·권한 정보 | `gh` command와 1:1이지만 의미 정보가 덧붙는다 | FR-GH-001 |
| capability manifest | `capability_manifest` | 고정 gh 버전의 전 capability를 담은 검증된 목록. 버전과 내용 해시를 갖는다 | 인벤토리(자동 추출 결과)와 다르다 — 오버라이드가 반영된 최종본이다 | FR-GH-001, ADR-015 |
| 의미 오버라이드 | `semantic_override` | help가 주지 않는 정보(상호 배타, 의존, 위험도, 필요 권한, 비밀 여부)를 사람이 보강한 것 | 자동 파싱 결과가 아니다 | ADR-015 |
| 분류 상태 | `support` | capability가 어떻게 취급되는지 — `supported`, `unsupported_by_host`, `preview`, `policy_blocked`, `terminal_only`, `admin_only`, `requires_extension`, `requires_local_workspace` | `unknown`은 허용되지 않는다 | FR-GH-001 AC-2 |
| flag 분류 | - | flag가 UI에서 어떻게 표현되는지 — `mapped_to_typed_control`, `mapped_to_generic_control`, `mapped_to_web_equivalent`, `terminal_only`, `policy_blocked`, `unsupported_by_host`, `requires_admin_approval` | 위와 다른 축이다 | FR-GH-001 AC-3 |
| 위험도 | `risk_level` | `R0`(읽기) / `R1`(가역 쓰기) / `R2`(영향 큰 쓰기) / `R3`(파괴적·관리자·비밀) | 관계 신뢰도(`confidence`)와 다른 축이다 | FR-GH-009 |
| 위임 신원 | `delegated_identity` | 사용자를 대신해 GitHub을 호출하는 사용자 액세스 토큰 기반 자격 증명 | 수집용 설치 토큰과 다르다 | FR-GH-008, ADR-014 |
| 유효 권한 | - | Operations App 권한 ∩ 사용자 GitHub 권한 | 설치 권한만으로 판단하지 않는다 | FR-GH-008 AC-3 |
| 실행 | `gh_execution` | 하나의 capability 실행 요청과 그 결과 | 잡(`job`)과 다르다 — 잡은 파이프라인 배치 작업이다 | FR-GH-002 |
| 중복 방지 키 | `idempotency_key` | 같은 요청의 재전송이 새 실행을 만들지 않게 하는 키 | 웹훅 멱등 키(`delivery_id`)와 다른 축이다 | FR-GH-012 AC-5 |
| Recipe | `gh_recipe` | 등록된 capability만 조합한 다단계 작업 정의 | shell 스크립트가 아니다. 임의 명령을 넣을 수 없다 | FR-GH-005 |
| 임시 workspace | `workspace` | 로컬 git이나 파일이 필요한 실행에 배정되는 격리된 디렉터리 | 서버의 실제 소스 트리가 아니다 | FR-GH-007 |
| 레지스트리 드리프트 | `registry_stale` | 실행기의 gh 버전과 manifest 생성 버전이 다른 상태 | 이 상태에서 신규 command를 실행하지 않는다 | FR-GH-011 AC-3 |
| 구조화 invocation (GhInvocation) | 사용자가 구성한 gh 작업의 구조 표현. capability ID, 컨텍스트, positional, flag, stdin 원본, 파일 바인딩, 출력 옵션으로 이뤄진다. 문자열 명령이 아니라 이것이 요청·검증·미리보기·실행·감사·재실행의 단일 진실이다 (CR-008, ADR-017) |
| 의미 제약 모델 (GhCapabilityConstraint) | capability의 유효 조합 정의. `requires`·`conflicts`·`oneOf`·`exactlyOne`·`atLeastOne`·`implies`·반복 가능·최소/최대·값 열거·조건부 필수·입력원 제약·컨텍스트 의존 제약을 표현한다. 폼·서버 검증·argv 빌더·테스트 생성기가 같은 모델을 읽는다 (CR-008) |
| SafeGhOutput | gh stdout·stderr와 GitHub 텍스트가 사용자 화면에 닿기 전에 반드시 통과하는 무해화 경계. ANSI CSI·OSC·제어 문자 무해화, invalid UTF-8 치환, 바이너리 탐지, 바이트 상한, 스트리밍 청크 경계 보정 (CR-008, ADR-018) |
| 웹 등가 (web equivalent) | 터미널 UX를 웹 표현으로 대체한 기능. `gh browse`의 의미는 "브라우저 프로세스 실행"이 아니라 "대상 URL로 이동"이므로 웹에서는 링크가 등가다. `terminal_only`로 밀어 넣기 전에 먼저 찾는다 (CR-008, ADR-019) |
| parity 차원 | capability parity를 판정하는 28개 축. command path·alias·positional·flag(고유/inherited/short/반복)·입출력·컨텍스트·gh config·TTY/editor/browser 요구·출력 형식·`--json` 필드·`--jq`·`--template`·페이지네이션·REST/GraphQL 모드·GHES 버전·사용자 권한·App 권한·정책·위험도 (CR-008) |
| extension capability plane | core gh와 분리된 gh extension의 capability 영역. 탐색·메타데이터는 허용하되 실행은 관리자 허용 목록과 정확한 버전 pin을 만족할 때만. core parity와 수치를 분리 보고한다 (CR-008, ADR-019) |
| 결과 계약 (GhResultContract) | capability 출력의 의미 정의. `kind`·스키마·자원 종류·바인딩 가능 여부·sensitivity·result adapter를 담는다. 입력 계약만 있고 출력 계약이 없으면 명령 조합이 일반화되지 않는다 (CR-009, ADR-020) |
| 자원 참조 (GhResourceRef) | 명령 사이를 잇는 공통 typed 참조. `owner/repo#123` 같은 문자열을 매번 재파싱하지 않기 위한 것이다 (CR-009) |
| 입출력 port | capability가 선언하는 바인딩 지점. 어떤 명령 뒤에 어떤 명령을 이을 수 있는지는 이름이 아니라 port 타입으로 계산한다 (CR-009) |
| GhBinding | Recipe 단계 사이의 구조화된 연결. 출발 단계·출력 port·도착 단계·도착 입력으로 이뤄지며, 표현식이 아니다 — 표현식 해석기를 두지 않는 것이 요점이다 (CR-009) |
| capability 그래프 (GhCapabilityGraph) | manifest에서 계산한 node=capability, edge=출력 port→호환 입력 port 그래프. Recipe 빌더가 호환 가능한 다음 단계를 제안하는 근거 (CR-009) |
| composability 상태 | capability 결과를 어디까지 이을 수 있는지의 분류. `fully_bindable`·`partially_bindable`·`terminal_result`·`artifact_result`·`opaque_result`·`secret_non_bindable`·`policy_blocked`·`unsupported_by_host`. `unknown` 금지 (CR-009) |
| result adapter | `--json`이 없는 명령의 결과를 어떻게 구조화하는지. `native_json`·`gh_api_structured`·`resource_url`·`artifact`·`opaque_text`·`stream`·`exit_status`·`secret_non_bindable`. 출력 텍스트를 깨지기 쉬운 정규식으로 무조건 파싱하지 않기 위한 분류다 (CR-009) |
