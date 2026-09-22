# PR Search 용어집

> 상태: review | 버전: v0.16 | 갱신일: 2026-09-22

CR-114 / FR-SRCH-001 AC-7: **M 번호 표기 문자열**(`M-<저장소 코드>-<번호>`)은 그 자체가 통합 검색의 **식별자**다 — 커밋 SHA·PR 번호·GHE URL과 같은 자리에서 유형 `merge_number`로 판별되며, 해석은 색인이 아니라 현재 에폭의 정본(`merge_sequence`)에서 한다. 저장소 코드가 이름의 숫자 부분이므로(OD-009) 같은 코드를 가진 저장소가 여럿일 수 있고, 그때 후보는 여럿이다. `mnum:`의 **단일 값**(`mnum:1450`)은 양끝이 같은 닫힌 범위이지 새 연산자가 아니다. `base:` **생략**은 저장소가 추적하는 시퀀스 브랜치가 하나뿐일 때만 성립한다 — 서버가 공간을 고르는 것이 아니다. 금지 동의어: "M 번호 검색어"(전문 검색과 혼동), "M 번호 필터"(`mnum:` 범위 조건과 혼동), "기본 브랜치 추론"(고를 것이 없을 때만 통과한다).

CR-113 / FR-SEQ-001 AC-7·AC-8: **시퀀스 투영**(sequence projection)은 PostgreSQL 정본(`merge_sequence`·`sequence_space`·`pull_request_snapshot`·`commit_snapshot`)이 정한 서수를 커밋·PR 검색 문서의 `merge_seq`·`seq_epoch`·`sequence_space` 필드에 비추는 일이다. **재투영**(reprojection)은 이미 확정된 서수를 정본에서 색인으로 다시 비추는 것이며 **재채번**(reassignment, FR-SEQ-005)과 다르다 — 에폭·서수·M 번호·head를 바꾸지 않는다. **durable 투영 작업**(`sequence_work`의 `project` kind)은 공간 단위 `tail`(채번 뒤 증분)·`full`(전체 sweep)과 문서 단위 `doc`으로 나뉘며 generation·lease·CAS 규율(ENT-SEQ-006)을 그대로 쓴다. 문서별 판정은 `updated`(새로 반영)·`noop`(이미 같음)·`document_missing`(문서 없음)·`guard_rejected`(저장소·SHA·브랜치 불일치)·`stale_epoch`(구 에폭 작업)·`transient`(일시 실패·경쟁)이고, `updated=0`은 그 자체로 성공도 실패도 아니다. 「대상 없음」(직접 푸시·미수집·연결 미확정)과 「문서 생성 대기」는 구분한다. 금지 동의어: "색인 재채번", "서수 복구(재계산)".

CR-112 / FR-INT-001: **PIPE 연동**(`pipe_integration`, 계약 `PSI-1.0`)은 PIPE 서버가 사용자 신원을 위임해 pr-search의 고정 조회 10종을 쓰는 서버 간 연결이다. **연동 client**(`client_id`)는 정책 파일에 등록된 PIPE 서버 하나이며 mTLS 인증서·서명 공개키·저장소 **허용 목록**(`repository_ids`)을 갖는다. 실효 범위는 언제나 사용자 **접근 범위**와 허용 목록의 교집합이다. **사용자 assertion**(`pipe-user-assertion+jwt`)은 PIPE 서버가 서명한 60초 이하의 JWS다 — PIPE 로그인 JWT가 아니며 역할·저장소를 싣지 않는다. **identity binding**(ENT-INT-001)은 운영자가 검증한 `(issuer, subject) → 기존 사용자` 연결이다(금지 동의어: 계정 병합, 자동 매핑). **로그인 문맥**(`auth_context_id`, ENT-INT-002)은 PIPE가 로그인 자격 하나에서 만든 불투명 식별자이고, **문맥 회수 표식**은 그 문맥의 재발급을 막는 PostgreSQL 행이다. **검색 grant**(`psig1_…`, ENT-INT-003)는 300초 이하의 검색 전용 불투명 토큰이다(금지 동의어: 세션, 세션 토큰 — 일반 세션과 서로를 대신하지 못한다). **긴급 회수**(ENT-INT-004)는 client·서명 키·인증서를 재기동 없이 즉시 끊는 기록이다. **진단 창**은 grant 만료 뒤 120초 동안 `GRANT_EXPIRED`를 구분해 알리는 기간이며 인증 수명이 아니다. **private 리스너**는 search-api 프로세스 안에서 공개 리스너와 다른 포트로 듣는 mTLS 전용 서버다.

CR-109 / FR-REG-001: **Revision Atlas**는 first-parent 순서를 x축으로 삼는 Regression view다. **MDVP**는 외부 live-test 환경이며 **MTBF**는 그 안의 시험 유형이다. **비교 가능한 PASS**는 동일 testcase/signature/HW/environment/configuration/policy·동일 공간/epoch의 이전 PASS다. **fixture 모드**는 명시적으로 opt-in한 합성 데이터·로컬 판정/큐이며 실제 장비·빌드 실행이 아니다. **최초 FAIL 경계 후보**는 재현 확인이 필요한 단일 revision 후보이며 원인 확정과 다르다.

> CR-097 용어: **고정 리비전(pinned revision)**은 탐색 시작 시 브랜치에서 해석한 40자 커밋 SHA다. **경로 이력(path history)**은 그 SHA에서 특정 파일/폴더 경로를 변경한 커밋 목록이다. **파일 비교(Diff)**는 두 고정 리비전의 텍스트 차이이고 **시간별 파일 탐색(Time-lapse)**은 리비전별 내용을 슬라이더로 탐색하는 기능이다. **관측 라인 이력(observed line history)**은 최대 30개 로드된 리비전의 인접 텍스트 정렬에서 추정한 변경 기록이며 Git blame·원본 생성 시점·분기 간 계보의 정본이 아니다. FR-SRC-001~004.


CR-091 용어 보완: **관리자 지정 역할**과 **실효 역할**을 더했다. 역할 표의 「관리자 지정」이 코드에서 성립하지 않았던 결함(`DEV-695`)을 고치며, 세션에 담긴 로그인 때의 역할과 요청마다 판정하는 역할을 다른 낱말로 가른다.

CR-090 용어 보완: GitHub Operations의 **운영 승인**은 운영자가 이 배포 범위에서 현재 적재된 gh capability 정의를 R0 범위에서 쓰기로 한 DB 결정이며, 실행 단위 승인(R3 승인자)과 다른 낱말이다. **운영자 차단**은 manifest 분류의 `policy_blocked`와 같은 코드를 쓰지만 다른 사실이고 응답의 `detail`로 가른다. 아래 GitHub Operations 용어 표에 여섯 행을 더했다.

CR-079 용어 보완: M 넘버의 화면 표기는 **M 번호**, 정본 필드명은 `merge_number`다. 공간은 repository_id·base_branch·seq_epoch로 한정한다. `pr_confirmed`는 merged·base·SHA가 일치하는 양성 증거, `direct_confirmed`는 PR 부재의 완결 증서, `unresolved`는 아직 결론을 낼 수 없는 상태다. 교정 가능한 commit.role=direct_push와 영구 direct_confirmed는 동의어가 아니다. 현재 production 부재 증서는 확보되지 않았다(DEV-581). 상세 데이터 어휘는 [설계 3·6절](../30_technical_architecture/pr_search_wp074_design.md)이 소유한다.

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
| 머지 시퀀스 | `merge_seq` | (저장소, 대상 브랜치)마다 first-parent 히스토리를 루트부터 세어 각 커밋에 부여하는 1부터 시작하는 정수 서수. Perforce Changelist 번호와 같은 역할을 한다. **이 값은 직접 푸시 커밋도 센다** — PR이 연결된 항목만 골라 다시 매긴 표시용 값이 「M 넘버」다(CR-077) | 시퀀스 번호, CL, 순번, 리비전 번호 | FR-SEQ-001, ENT-SEQ-001 |
| M 넘버 | `merge_number` | 「머지 시퀀스」(`merge_seq`)에서 파생하는 공간·에폭별 1-기반 조밀 서수. `merge_seq` 오름차순으로 두되 **근거가 확정된 Pull Request 항목만 세며**, 직접 푸시 커밋은 번호를 받지도 소비하지도 않는다. 시퀀스 공간(`(repository_id, base_branch)`)과 시퀀스 에폭을 `merge_seq`와 그대로 공유하므로, 에폭이 오르면 이 값도 함께 무효가 된다. 표기 형식은 `M-<저장소 코드>-<번호>`(예: `M-1900-1`)다. **선후관계 확인 전용이며 PR의 주 식별자를 대체하지 않는다** — 화면과 API는 PR 번호를 주 식별자로 유지하고 이 값을 병기한다 (CR-077 / CR-079; 직접 푸시 확정은 별도 증서, DEV-207 역할과 분리) | 머지 시퀀스, PR 번호, CL | FR-SEQ-008, FR-SEQ-009, ENT-SEQ-001 |
| M 번호 운영자 확인서 | `mnumber_attestation` | 시퀀스 공간·에폭 단위로 운영자가 남기는 결정. PR 근거가 끝내 나오지 않은 항목(`negative_evidence_unavailable`)과 squash 프로파일 밖 항목(`unsupported_merge_profile`)을 유예가 지난 뒤 번호를 받지도 소비하지도 않고 지나가게 한다. 행위자·사유·범위·유예를 담고 감사 기록을 만들며, 에폭이 오르면 효력이 없다. 이미 부여된 번호는 바꾸지 않는다 (CR-100) | 수동 근거, 스킵 플래그, 예외 목록, 자동 확정 | FR-SEQ-008 AC-15, ENT-SEQ-008 |
| 시퀀스 공간 | `sequence_space` | 머지 시퀀스가 유효한 범위 단위. `(repository, base_branch)` 조합 1개가 시퀀스 공간 1개다. 서로 다른 시퀀스 공간의 번호는 비교하지 않는다 | 시퀀스 네임스페이스 | FR-SEQ-001 |
| 시퀀스 에폭 | `seq_epoch` | 시퀀스 공간의 재채번 세대 번호. 강제 푸시로 히스토리가 재작성되면 1 증가하며, 이전 에폭의 **시퀀스 인용**은 무효로 표시되고 자동으로 재해석되지 않는다 (CR-051) | 세대, 버전 | FR-SEQ-005 |
| 시퀀스 인용 | `sequence reference` | 시퀀스 서수를 가리켜 두고 나중에 다시 쓰는 것. 셋뿐이다 — 안전 구간 표식, 저장된 검색의 `seq:` 조건, `seq:` 조건을 담은 공유 URL. **셋 다 시퀀스 공간과 에폭을 함께 보존한다** (ADR-007 규칙 5). 에폭이 달라지면 무효이며, 현재 세대로 옮기는 것은 언제나 사람의 명시적 행위다 | 인용, 참조, 북마크 | FR-SEQ-005, FR-SRCH-010, ADR-007 |
| 미연결 인용 | `unbound` | 시퀀스 인용인데 에폭이 없는 상태. CR-051 이전에 저장된 `seq:` 검색이 여기 해당한다. **저장 당시의 에폭은 복원할 수 없으므로 현재 값으로 채우지 않는다** — 그것은 복구가 아니라 추측이다. 실행을 막고 저장자가 다시 연결할 때까지 그대로 둔다 | 미바인딩, 에폭 없음 | FR-SRCH-010 |
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
| 커서 | `cursor` | 다음 페이지 위치를 가리키는 불투명 문자열. 순회하는 정본이 무엇인지에 따라 봉인하는 재료가 다르다 — 검색 결과는 Elasticsearch `search_after` 값을, 시퀀스 구간은 정본 서수를, 저장된 검색 목록은 PostgreSQL 키셋 값을 봉인한다 (CR-049) | 오프셋, 페이지 토큰 | FR-SRCH-008, FR-SEQ-002, FR-SRCH-010 |
| 저장된 검색 | `saved_search` | 이름을 붙여 재사용하는 질의. 저장자가 소유하며, 공개 범위가 `team`이면 대상 팀 하나에 조회·실행 권한으로 공유된다 | 북마크, 즐겨찾기 | ENT-CORE-006, FR-SRCH-010 |
| 대상 팀 | `target_team` | 저장된 검색을 공유받는 팀 하나. 저장·수정 시점에 저장자가 구성원인 팀 중에서 명시적으로 지정하며 `team_id`로 식별한다 (CR-049) | 공유 팀, 소속 팀 | ENT-CORE-004, FR-SRCH-010 |

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
| 조정 스캔 | `reconciliation_scan` | 수집 결과와 GHE 실제 상태를 대조해 누락을 찾는 처리. 주기 실행과 운영자의 즉시 실행 둘 다 같은 구현을 지나며 동시에 돌지 않는다 | 정합성 검사, 싱크 체크 | JOB-ING-005, FR-ING-011 |
| 등록 검토 요청 | `repository_registration_request` | 미등록 저장소를 등록해 달라고 사용자가 남기는 기록. 저장소를 등록하지 않으며 대상의 실재 여부도 확인하지 않는다. 처리 상태는 `pending`·`fulfilled`·`dismissed` 셋이고 `operator`만 본다 — 승인은 성공한 등록 그 자체이므로 그 사이의 상태를 두지 않는다 | 등록 요청, 등록 신청 | FR-ING-009 AC-8·AC-11, ENT-CORE-008, API-ADM-009 |
| 재색인 | `reindex` | 새 매핑으로 인덱스를 다시 만들고 별칭을 전환하는 처리 | 리인덱싱, 재구축 | JOB-ING-006, FR-ING-008 |
| 실패 대기열 | `dead_letter_queue` | 재시도 상한을 넘긴 이벤트를 격리 보관하는 큐 | DLQ, 오류 큐 | FR-ING-007 |
| 수집 지연 | `ingestion_lag` | 웹훅 수신 시각과 검색 반영 시각의 차이 | 처리 지연, 랙 | NFR-002 |
| 이벤트 버스 | `event_bus` | 수신기와 워커 사이의 전달 계층 추상화. Redis Streams 또는 Kafka 어댑터로 구현한다 | 메시지 큐, 브로커 | ADR-002 |
| 미러 | `mirror` | 커밋 그래프 계산을 위해 유지하는 blobless bare 클론 | 로컬 클론, 캐시 | ADR-005 |

### 2.6 권한과 감사

| 용어(한글 표준) | 영문/코드 표준 | 정의 | 금지 동의어 | 관련 ID |
| --- | --- | --- | --- | --- |
| 사용자 | `user` | SSO로 인증된 사내 구성원 | 계정, 멤버 | ENT-CORE-005 |
| 팀 | `team` | GHE 조직의 팀. **이 낱말 하나가 두 가지 쓰임을 갖는다** — 아래 둘로 갈라 쓴다 | 그룹, 조직 | ENT-CORE-004 |
| 접근 권한 팀 | `allowed_team_ids` | 저장소를 볼 수 있는 팀. 질의 키 `team:`이 이것을 본다. **권한의 단위이지 성과의 단위가 아니다** | 소속 팀, 작성자 팀 | FR-AUTH-002 |
| 작성자 팀 | `author_team_ids` | PR 작성자가 속한 팀. 질의 키 `author_team:`과 집계 그룹 키 `팀`이 이것을 본다. **접근 권한 팀과 섞으면 권한을 성과로 읽게 된다** (CR-053, DEV-382) | 접근 권한 팀 | FR-STAT-001 |
| 관리자 지정 역할 | `app_user.roles[]` | IdP 그룹·GHE 팀으로 줄 수 없고 관리자가 정본에 적어야만 받는 역할 — `release_manager`·`operator`·`security_officer`. 배포 호스트의 `prsctl role grant`·`revoke`로만 바꾸며 부여·회수가 감사된다 (CR-015, CR-091) | 관리자 권한, 수동 역할 | FR-AUTH-001 AC-10 |
| 실효 역할 | `roles` (`/me`) | 한 요청의 역할 판정에 쓰는 역할 — 로그인 때 합성한 IdP·팀 매핑 역할과 관리자 지정 역할의 합집합에 `developer`를 더한 것. **요청마다 정본에서 만들며 세션에 저장하지 않는다** (CR-091) | 세션 역할(로그인 때의 절반만 뜻한다) | FR-AUTH-001 AC-10 |
| 접근 범위 | `access_scope` | 사용자가 조회할 수 있는 저장소 ID 집합 | 권한 목록, ACL | FR-AUTH-002 |
| 강제 필터 | `mandatory_filter` | 모든 검색 질의에 서버가 무조건 결합하는 접근 범위 조건 | 보안 필터, 권한 필터 | FR-AUTH-002 |
| 권한 캐시 | `permission_cache` | 접근 범위를 저장해 두는 캐시. 최대 신선도 5분을 보장한다 | ACL 캐시 | FR-AUTH-003 |
| 감사 기록 | `audit_record` | 조회·내보내기·관리 액션 1건의 기록 | 로그, 이력 | ENT-CORE-007, FR-AUTH-004 |
| 감사 액션 | `AuditAction` | 감사 기록 1건이 무엇을 남기는지 정하는 안정 식별자(`대상.동작` 형태). **정본은 `srs_final.md` FR-AUTH-004의 「감사 대상 액션 정본」 표 하나이며 개수가 아니라 목록이다** — 개수를 계약에 적으면 액션을 하나 더할 때마다 낡는다 (CR-054) | 감사 유형, 액션 코드, 감사 이벤트 | FR-AUTH-004 AC-1·AC-7 |
| 활성 감사 액션 | `active` | 소유 WP가 완료된 시점에 실제 도달 가능한 경로에서 기록되어야 하는 감사 액션 | 필수 액션 | FR-AUTH-004 AC-1 |
| 미활성 감사 액션 | `not activated` | 계약이 승인했으나 그 기능을 만드는 WP가 아직 오지 않은 감사 액션. **누락이 아니다** — 합성 경로를 만들어 기록만 남기지 않는다 (CR-054) | 미구현 액션, 누락 액션 | FR-AUTH-004 AC-1 |
| legacy 감사 어휘 | - | 과거에 기록되어 `audit_record`에 남아 있으나 정본 표에 없는 `action` 값. 감사 기록은 불변이므로(AC-3) **다시 쓰지 않고**, 조회는 이 값도 필터할 수 있어야 한다 (CR-054) | 폐기 액션, 구 액션 | FR-AUTH-004 AC-7 |

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
| 운영 승인 | `gh_operations_policy.approved_*` | 운영자가 이 배포 범위에서 현재 적재된 capability 정의(gh 버전·manifest 판·manifest 해시)를 R0 범위에서 쓰기로 한 DB 결정. 실행기 검증 기록과 보고서 해시에 묶이고 운영 정책 revision으로 남는다. 없으면 기능이 켜져 있어도 새 실행을 시작하지 않는다 | 실행 단위 승인(`gh_approval`, R3 승인자)과 다르다. 196개 명령의 실행 허용·사내 GHES 확인·REL-007 완료가 아니다 (CR-090) | FR-GH-011 AC-6~AC-8 |
| 운영 승인 필요 | `admin_action_required` | 현재 적재된 정의의 운영 승인이 없어(승인 없음·철회·정의 변경) 새 실행을 거절하는 판정 | 레지스트리 드리프트(`registry_stale`)·운영자 차단과 다른 사실이다 (CR-090) | FR-GH-011 AC-3·AC-6 |
| 운영자 차단 | `policy_blocked` (`detail: operator_blocked`) | 운영자가 실행 가능한 capability의 새 실행권을 사유와 함께 막은 정책. 재개는 명시적으로만 한다 | manifest 분류가 실행 차원에서 막은 `policy_blocked`(열지 않기로 한 command)와 코드가 같지만 다른 사실이다. 이미 실행 중인 작업을 취소하지 않는다 (CR-090) | FR-GH-009 AC-8 |
| 운영 정책 revision | `gh_operations_policy.revision` | 배포 범위 하나의 운영 승인·차단 상태에 붙는 번호. 변경마다 기대 revision을 대조하고 1씩 올리며 이력 한 행을 남긴다 | manifest 판(`r0.3`)·검증기 보고서 판(`r2`)과 다른 번호다 (CR-090) | FR-GH-011 AC-8 |
| 배포 범위 | `scope` | 운영 정책과 실행기 검증 기록이 속하는 단위 = 서버 설정 `GHE_BASE_URL`의 호스트. 클라이언트가 지정하지 않는다 | 사용자의 저장소 접근 범위(`access_scope`)와 다르다 (CR-090) | FR-GH-011 AC-6 |
| 근거 신선도 한도 | `evidence_max_age_ms` | 운영 승인의 근거로 받을 수 있는 실행기 검증 기록의 최대 나이이자, 실행기가 마지막 통과 뒤 새 실행권을 줄 수 있는 한도 = 검사 주기 + 한 회차 최악 소요(기본 91,225,000ms, 25시간 20분 25초) | 검사 주기(`GH_EXECUTOR_REGISTRY_CHECK_MS`) 자체가 아니다 (CR-090) | FR-GH-011 AC-7·AC-9 |
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
