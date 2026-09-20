# pipe-search-port — PIPE Search 이식 인수인계 묶음

> 작성일 2026-09-21 · 원본 기준 SHA `da0ed9b5bd8fac59c7fcf02c593f69962468be4d`

## 1. 이 묶음은 무엇인가

pr-search의 현재 기본 `/search` 화면(`RepositoryWorkspace`)을 분석해, **PIPE 저장소에 연결된 다른 Claude 세션이 pr-search를 다시 조사하지 않고 같은 기능을 구현할 수 있도록** 만든 자체 완결형 명세 묶음이다.

구현 코드가 아니다. PIPE 화면도 아니다. pr-search의 운영 코드는 이 작업에서 **한 줄도 바뀌지 않았다.**

## 2. 이 묶음은 pr-search의 governed 문서가 아니다

pr-search 저장소의 `docs/` 아래 문서들은 변경 관리(CR) 규칙과 상태 헤더의 지배를 받고, 저장소의 검증 grep(`rg "TODO|TBD|미정" docs/`)이 훑는 대상이다. 이 묶음은 **다른 저장소를 위한 인수인계 자료**이므로 그 체계에 속하지 않는다.

그래서 `docs/`가 아니라 저장소 최상위의 `handoff/pipe-search-port/`에 두었다. `agent-context/`, `plans/`, `exports/`, `artifacts/`가 이미 같은 성격의 비관리 디렉터리로 존재한다.

**이 작업으로 CR을 열지 않았고 어떤 governed 문서도 고치지 않았다.** 커밋과 push도 하지 않았다. 위치를 옮기고 싶으면 디렉터리째 옮기면 된다. 문서 사이의 상호 참조는 전부 상대 경로다.

## 3. 읽는 순서

PIPE 담당 세션에게는 **`PIPE_SEARCH_IMPLEMENTATION_PROMPT.md`를 그대로 붙여넣고 나머지 파일을 첨부한다.** 그 문서가 실행 지시서이고 나머지는 참조다.

| 순서 | 파일 | 크기 | 내용 |
|---|---|---:|---|
| 1 | `PIPE_SEARCH_IMPLEMENTATION_PROMPT.md` | 63KB | A~G단계의 실행 지시. 핵심 계약을 직접 담고 있다 |
| 2 | `API_AND_ADAPTER_CONTRACT.md` | 36KB | 확인된 raw DTO, 요청·응답, URL·인코딩, 데이터 포트, 오류 |
| 3 | `reference/PURE_LOGIC_REFERENCE.md` | 33KB | 옮길 순수 함수의 알고리즘·상수·golden 입출력 |
| 4 | `DESIGN_AND_WIREFRAMES.md` | 50KB | 콘텐츠 전용 와이어프레임, 치수, 토큰, 상태 전이표, 포털 |
| 5 | `PARITY_AND_ACCEPTANCE.md` | 42KB | 이식 결정 `PD-001`~`PD-010`, 동등성표, 수용 테스트 `PS-T-001`~`PS-T-042` |
| 6 | `SOURCE_EVIDENCE.md` | 52KB | 기능 ID `PS-F-001`~`PS-F-132`의 원본 근거(파일·줄 번호) |
| 7 | `fixtures/SCENARIOS.md` | 13KB | fixture 52개의 용도와 시나리오 연결표 |
| — | `fixtures/*.json` | — | 합성 응답 52개 |
| — | `fixtures/validate-fixtures.mjs` | — | 계약 구조 검증기. fixture를 고치면 반드시 돌린다 |
| — | `MANIFEST.json` | — | 61개 파일의 크기와 sha256, 그리고 이번 검증 결과 |

`MANIFEST.json`의 해시는 **LF 개행 기준**이다. 이 저장소는 `core.autocrlf=true`를 쓰므로 체크아웃하면 작업 트리의 텍스트 파일이 CRLF가 되고, 그 상태에서 `sha256sum`을 돌리면 값이 맞지 않는다. 대조할 때는 개행을 LF로 정규화한 뒤 비교한다.

```bash
# 저장소 안에서 대조할 때
git show HEAD:handoff/pipe-search-port/<파일> | sha256sum
```

`assets/` 디렉터리는 **만들지 않았다.** 실제 화면 증거를 확보하지 못했기 때문이다(5장 참조).

## 4. 이번 범위

| 포함 | 제외 |
|---|---|
| 저장소·Base branch 선택, Files & folders 트리 | App Shell 전체(로고, 전역 헤더·메뉴, 로그인, 전역 테마 토글) |
| Search / Commit history / My open PRs / My merged PRs 네 탭 | Regression, bisect, MDVP, Job 실행 |
| 필터와 네 종류의 범위 편집 | 운영·관리·권한 관리 화면 |
| 결과 표, 서버 정렬, cursor 추가 조회, 행 상세 | 검색 데이터의 PIPE DB 재수집 |
| 경로 이력, 두 revision 비교, Diff, Time-lapse | API Gateway·BFF·JWT·세션 발급·Redis 연결 |
| 검색 문맥 URL, 복사, GHE 원문 링크 | 새 검색 엔진, 새 M 번호 계산, 새 권한 판정 |

**API 접근·사용자별 인증·검색 권한 연결은 이번 범위가 아니다.** 이번에는 UI가 쓸 데이터 포트와 raw 응답 계약, 그리고 합성 fixture까지만 준비한다. PIPE 담당 세션은 fixture로 모든 UI 상태를 동작 검증할 수 있고, 실제 transport는 나중에 같은 계약으로 갈아 끼운다.

## 5. 검증한 것과 하지 못한 것

### 검증했다

| 항목 | 결과 |
|---|---|
| `merged:` 범위의 형식·경계·시간대 | 확인 완료 | 양쪽 경계 필수, `gte`/`lte`로 **양끝 포함**, `time_zone`이 없어 **UTC 해석**. `API_AND_ADAPTER_CONTRACT.md` 8.1장 |
| 순수 로직 단위 시험(`repository-search`, `search-fetch`, `merge-number`, `source-analysis`, `format`, `service-message`) | 120/120 통과 (Node 22.23.2, 기준 커밋) |
| 질의 패키지 시험(`identifier`, `parse`) | 115/115 통과 |
| 기본 Search 화면의 접근성·상호작용 시험(`a11y/repository-workspace.test.tsx`) | 15/15 통과 |
| fixture 52개의 JSON 문법 | 전부 통과 |
| fixture 52개의 계약 구조(필수 키, `null` 허용, 리터럴 union) | 전부 통과 |
| 123건 페이징 데이터의 정합성 | 50/50/23, PR 번호·merge_seq 중복 없음, facet은 1페이지에만 |

이 통과 결과가 `PURE_LOGIC_REFERENCE.md`의 golden 벡터를 **기준 커밋에서 실제로 성립하는 값**으로 만든다.

### 하지 못했다

| 항목 | 상태 | 이유 |
|---|---|---|
| 실행 중인 화면의 스크린숏 | NOT RUN | 백엔드(PostgreSQL·Elasticsearch·Redis)와 `search-api`를 띄우지 않았다. 이번 작업이 문서 작성이므로 기동하지 않았다 |
| 실제 브라우저의 computed style | NOT RUN | 위와 같다. 치수는 CSS 선언값과 이식 결정값으로만 제시한다 |
| 대비비 측정 | NOT RUN | PIPE 테마의 실제 색이 정해지지 않았다. 목표값만 제시한다 |
| PIPE의 실제 패키지 버전·경로·theme | 확인 불가 | 이 세션은 PIPE 저장소에 접근하지 못한다. 구현 지시서의 A단계 점검표로 넘겼다 |
| GHE 실데이터 동작 | NOT RUN | 사내 환경에 접근하지 않았다 |

문서에 `TARGET_VERIFY`, `NOT RUN`, "확인하지 못했다"라고 적힌 것은 **정말 확인되지 않은 것**이다. 확인된 사실처럼 다루면 안 된다.

## 6. 반드시 전달해야 할 세 가지 발견

### 6.1 M 링크가 기본 화면에서 끝까지 처리되지 않는다

M 배지의 링크는 정상적으로 만들어지고 네 파라미터(`m_repository`·`m_base_branch`·`m_seq_epoch`·`m_number`)를 전부 싣는다. 그런데 그 파라미터를 **해석하는 컴포넌트는 `SearchView`만 렌더링한다.** 운영 기본값에서 열리는 `RepositoryWorkspace`는 네 key를 읽지 않는다.

따라서 배지를 누르면 같은 화면이 다시 열리고 파라미터는 무시된다. `RepositoryWorkspace`는 배지에 `onCopy`도 넘기지 않으므로 `Copy M link` 버튼도 없다.

**원본에 없는 기능이므로 포팅에도 넣지 않되, 조용히 무시하지는 않는다.** 이식 결정 `PD-001`이 네 값을 보여 주는 안내를 요구한다.

### 6.2 `DEV-729`는 미해결 결함이며 복제 대상이 아니다

범위 유형을 바꿔 제출하면, 다른 유형에 남은 반쪽짜리 값이 먼저 걸려 방금 완성한 조건의 제출을 막는다. pr-search의 ledger에 "저자 판단이 필요한 설계 공백"으로 등재되어 있고 기준 커밋에서도 `open`이다.

이식 결정 `PD-002`가 검증 기준을 활성 판정과 맞추도록 정했다. **원본과 동작이 달라지는 지점이므로 차이표와 전용 시험(`PS-T-013b`)으로 고정했다.**

### 6.3 e2e 통과는 이 화면의 근거가 아니다

pr-search의 `playwright.config.ts`가 `PRS_LEGACY_SEARCH: '1'`을 고정하므로, e2e 스위트 전체가 `SearchView`만 렌더링하고 포팅 대상인 `RepositoryWorkspace`에는 닿지 않는다(`DEV-728`, 미해결).

특히 `e2e/mnumber.spec.ts`가 M 진입을 통과시키는 것은 `SearchView`를 시험하기 때문이며, 6.1의 사실과 모순되지 않는다. **이번 포팅의 동작 근거는 `a11y/repository-workspace.test.tsx`와 순수 함수 단위 시험이다.**

이 밖의 차이(날짜 표기 불일치, 필터 격자의 열 수 불일치, ledger의 WP-096 상태가 코드보다 늦은 것)는 `SOURCE_EVIDENCE.md` 6장에 정리했다.

## 7. 다음 단계

1. 이 묶음을 PIPE 담당 Claude에게 전달한다. `PIPE_SEARCH_IMPLEMENTATION_PROMPT.md`를 본문으로 붙이고 나머지를 첨부한다.
2. PIPE 담당 세션이 A단계(환경 점검)를 먼저 수행하고 실제 값을 보고한다.
3. B~G단계를 순서대로 진행한다.
4. **별도 후속 작업**: API 접근 경로, 사용자별 인증 위임, 검색 권한 연결.
