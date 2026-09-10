# PR Search 프론트엔드 아키텍처

> 상태: review | 버전: v0.4 | 갱신일: 2026-09-11

CR-079: 기존 W-001/002/004의 실제 렌더 경로와 API DTO를 [상세 설계](pr_search_wp074_design.md) 9절로 고정한다. M은 API 생성 문자열이며 PR 번호를 대체하지 않는다. 행별 resolve 없이 페이지 batch, M deep link 1회 resolve, visible pending의 bounded poll을 사용한다. 기존 인증 BFF·from_q·cursor·epoch 경고·Conductor를 보존한다.

## 1. 목적

화면 ID, 라우팅, 렌더링 방식, 상태 경계, 컴포넌트 책임, API 호출, 접근성, 성능 기준을 정의한다. 화면 정의는 `../20_derived_ui_specs/`가 소유하며, 이 문서는 그것을 구현 구조로 번역한다.

## 2. 기술 스택 결정

| 항목 | 결정 | ADR |
| --- | --- | --- |
| Language | TypeScript | ADR-001 |
| Framework | Next.js (App Router) | ADR-011 |
| 렌더링 | 서버 컴포넌트 최초 렌더 + 클라이언트 상호작용 | ADR-011 |
| API 접근 | Next.js 라우트 핸들러가 `search-api`로 프록시 (브라우저 직접 호출 없음) | ADR-011 |
| UI 프리미티브 | `@conductor-by-89soone/react` + `css` + `tokens`만 사용 | ADR-006 |
| 서버 상태 | URL 질의 파라미터 + fetch 캐시 | ADR-011 |
| 클라이언트 상태 | React state (펼침, 선택, 폼 초안). 전역 스토어 미도입 | ADR-011 |
| 질의 파싱 | `@prs/query` (서버와 동일 코드) | ADR-001 |
| 테스트 | Vitest (단위), Playwright (E2E) | - |

전역 상태 관리 라이브러리를 도입하지 않는다. 이 제품에서 공유되어야 할 상태는 거의 전부 URL에 있고, 나머지는 컴포넌트 지역 상태로 충분하다.

## 3. 라우트/화면 매핑

| Route | 화면 ID | 관련 요구사항 | Rendering | 데이터 출처 |
| --- | --- | --- | --- | --- |
| `/` | W-001 | FR-SRCH-001 | 서버 (빈 상태) | - |
| `/search` | W-001 | FR-SRCH-005~009, FR-SRCH-011, FR-STAT-006, FR-REL-004, FR-REL-005 | 서버 최초 + 클라이언트 갱신 | API-SRCH-004, API-STAT-001. **관계 배지(C-015)는 `API-SRCH-004`가 싣는 `link_summary`로 그린다 — 행마다 관계를 조회하지 않는다** (CR-042, DEV-264 / ADR-009) |
| `/pr/[owner]/[repo]/[number]` | W-002 | FR-SRCH-003, FR-REL-001~007 | 서버 (헤더·개요·커밋) + 클라이언트 (관계·동시 변경) | API-SRCH-003, API-REL-001, API-REL-002, API-REL-003, API-REL-006 (관계 간선). API-REL-004는 W-007(WP-043) |
| `/commit/[owner]/[repo]/[sha]` | W-003 | FR-SRCH-002, FR-REL-001, FR-REL-002, FR-REL-003~005 | 서버 셸 + 클라이언트 조회 | API-SRCH-002, API-REL-001, API-REL-002, API-REL-006 (관계 간선) |
| `/ranges` | W-004 | FR-SEQ-002, FR-SEQ-003, FR-SEQ-006, FR-SEQ-007 | 서버 최초 + 클라이언트 갱신 | API-SEQ-001, API-SEQ-002, API-SEQ-006, API-SEQ-004, API-SEQ-005 |
| `/releases` | W-005 | FR-SEQ-004, FR-REL-002 | 서버 셸 + 클라이언트 조회 | API-REL-005, API-SEQ-003, API-SEQ-006 |
| `/analytics` | W-006 | FR-STAT-001~005 | 클라이언트 (패널별 독립 조회) | API-STAT-001~004 |
| `/graph` | W-007 | FR-REL-008 | 클라이언트 | API-REL-004 |
| `/saved-searches` | W-008 | FR-SRCH-010 | 서버 | API-SRCH-005 |
| `/repositories` | W-009 | FR-ING-006, FR-ING-009, FR-SEQ-001 | 서버 | API-ADM-001 (읽기), API-ADM-006 |
| `/ops/pipeline` | A-001 | FR-ADMIN-001, FR-ING-007, FR-ING-011 | 클라이언트 (30초 폴링) | API-ADM-006, API-ADM-003 |
| `/ops/repositories` | A-002 | FR-ING-009 | 서버 | API-ADM-001 |
| `/ops/jobs` | A-003 | FR-ADMIN-002, FR-ADMIN-003, FR-ING-006, FR-ING-008 | 클라이언트 (30초 폴링) | API-ADM-002, API-ADM-004, API-ADM-007 |
| `/ops/audit` | A-004 | FR-AUTH-004 | 서버 | API-ADM-005 |
| `/api/*` | - | FR-AUTH-001 | 라우트 핸들러 | `search-api` 프록시 |
| `/auth/callback` | - | FR-AUTH-001 | 라우트 핸들러 | OIDC 토큰 교환 |

라우트 파라미터는 `pr_search_screen_flow_spec.md` 2장의 딥링크 표와 일치해야 한다. 불일치는 딥링크 공유를 깨뜨린다.

## 4. 상태 경계

| 종류 | 저장 위치 | 내용 | 규칙 |
| --- | --- | --- | --- |
| **URL 상태** | 라우트 + 쿼리 파라미터 | 질의 문자열, 필터, 정렬, 커서, 앵커, 기간, 그룹 키, 탭 | 화면 상태의 단일 진실. 필터 조작은 URL을 갱신하고 URL 변경이 조회를 유발한다 |
| **서버 상태** | Next.js fetch 캐시 + 컴포넌트 props | 검색 결과, 상세 문서, 집계 결과 | 클라이언트 스토어에 복제하지 않는다 |
| **클라이언트 상태** | React state | 섹션 펼침, 행 선택, 드로어 열림, 비교 대상 선택 | URL에 넣지 않는다(공유해도 의미가 없는 상태) |
| **폼 초안 상태** | React state | 앵커 입력 중 값, 저장된 검색 편집, 저장소 등록 폼 | 제출 전까지 서버에 보내지 않는다 |
| **세션 상태** | HttpOnly 쿠키 | 인증 세션 | 클라이언트 JavaScript가 읽지 않는다 |
| **사용자 컨텍스트** | 서버 컴포넌트 props | 역할, 접근 범위 요약, 표시 시간대 | 레이아웃에서 1회 조회해 하위로 전달 |

**URL 상태가 단일 진실이라는 규칙이 중요하다.** 이 제품의 핵심 사용 방식은 조사 결과를 티켓·메신저에 링크로 붙여 공유하는 것이다. 필터 상태를 컴포넌트 안에만 두면 링크가 재현되지 않아 제품 가치가 절반으로 준다.

### 4.1 URL ↔ 조회 흐름

```text
사용자가 패싯 체크
   ↓
질의 문자열 갱신 (@prs/query의 직렬화 함수)
   ↓
router.replace(새 URL)          ← 히스토리를 오염시키지 않도록 replace
   ↓
useSearchParams 변경 감지
   ↓
라우트 핸들러 호출 → 결과 갱신
```

정렬 변경·필터 변경은 `replace`, 화면 이동은 `push`를 쓴다. 필터를 다섯 번 조작한 뒤 뒤로가기 한 번으로 이전 화면에 돌아가야 한다.

## 5. 컴포넌트 소유권

컴포넌트 정의는 `../20_derived_ui_specs/pr_search_ui_component_spec.md`가 소유한다. 여기서는 코드 배치만 정의한다.

```text
apps/web/
  app/
    layout.tsx                     AppShell + 사용자 컨텍스트 조회
    (search)/search/page.tsx       W-001
    pr/[owner]/[repo]/[number]/    W-002
    commit/[owner]/[repo]/[sha]/   W-003
    range/page.tsx                 W-004
    releases/page.tsx              W-005
    analytics/page.tsx             W-006
    graph/page.tsx                 W-007
    saved-searches/page.tsx        W-008
    repositories/page.tsx          W-009
    ops/…                          A-001 ~ A-004
    api/…                          라우트 핸들러 (프록시)
  components/
    shell/       C-001 ~ C-003
    feedback/    C-004 ~ C-005
    search/      C-010 ~ C-017
    entity/      C-018 ~ C-025
    sequence/    C-026 ~ C-029, C-031
    analytics/   C-030, C-033 ~ C-036
    domain/      C-032, C-037 ~ C-039
    ops/         C-040 ~ C-047
  lib/
    api-client.ts   라우트 핸들러 호출 래퍼
    query-url.ts    질의 문자열 ↔ URL 동기화
    format.ts       SHA 축약, 시퀀스 표기, 기간 포맷
```

배치 규칙:

- 화면 폴더(`app/**`)에는 레이아웃 조립과 데이터 조회만 둔다. 재사용 가능한 UI는 `components/**`로 뺀다.
- `components/**`의 컴포넌트는 화면을 모른다. props로만 데이터를 받는다.
- Conductor 프리미티브를 감싸는 얇은 래퍼를 만들지 않는다. 필요하면 Conductor를 직접 쓴다.

## 6. 데이터 페칭 전략

| 화면 | 전략 | 이유 |
| --- | --- | --- |
| W-001 | 서버 컴포넌트가 최초 결과 조회 → 이후 필터·정렬·페이징은 클라이언트에서 라우트 핸들러 호출 | 최초 페인트가 빠르고, 이후 상호작용은 전체 재렌더 없이 처리 |
| W-002 | 헤더·개요·커밋은 서버, 관계·동시 변경은 클라이언트 지연 조회 | 점진적 공개 (IA 원칙 4). 관계 조회는 비용이 크다 |
| W-003 | 전부 서버 | 화면이 작고 지연 조회할 섹션이 없다 |
| W-004 | 앵커 정규화 결과와 범위 결과는 서버 최초 + 클라이언트 갱신 | 딥링크 재현이 필수 |
| W-005 | 서버 | 목록이 작다 |
| W-006 | 패널별 클라이언트 독립 조회 | 한 패널 실패가 다른 패널을 비우지 않아야 한다 (상태 매트릭스) |
| W-007 | 클라이언트 | 인터랙티브 캔버스 |
| A-001, A-003 | 클라이언트 30초 폴링 | 지표 신선도 30초 요구 (FR-ADMIN-001 AC-2) |
| A-004 | 서버 + 커서 페이징 | 정적 조회 |

폴링 규칙:

- 폴링 간격은 30초 고정이다. 백오프하지 않는다.
- 사용자가 표를 조작 중(행 선택, 스크롤 중)이면 갱신을 보류한다 (와이어프레임 A-001 구현 메모).
- 탭이 백그라운드면 폴링을 중단하고 포그라운드 복귀 시 즉시 1회 조회한다.
- 폴링은 A-001·A-003에만 쓴다. 사용자 조사 화면에는 자동 갱신을 넣지 않는다. 조사 중 화면이 스스로 바뀌면 사용자가 보던 근거가 사라진다.

## 7. 오류/로딩/권한 모델

상태 정의는 `../20_derived_ui_specs/pr_search_screen_state_matrix.md`가 소유한다. 구현 규칙만 정리한다.

| 상태 | 구현 |
| --- | --- |
| `loading_initial` | 실제 콘텐츠와 같은 행 수·높이의 skeleton. 레이아웃 이동 금지 (QA-COMMON-13) |
| `loading_more` | 기존 결과 유지 + 하단 `Spinner`. 목록을 비우지 않는다 |
| `empty_*` | `C-004 EmptyState`에 `cause`를 넘겨 원인별 문구·액션을 렌더링 |
| `recoverable_error` | `C-005 ErrorBanner` + 재시도 버튼. 섹션 단위로 격리 |
| `unrecoverable_error` | `C-005 ErrorBanner` + 상관 ID 표시 |
| `no_permission` | 필요 역할명을 그대로 표시. 운영 내비게이션 항목은 애초에 렌더링하지 않는다 |
| `auth_expired` | 현재 경로를 `state`에 담아 OIDC로 리다이렉트, 복귀 후 원래 경로 |
| `not_found` | 접근 범위 밖과 실제 부재를 구분하지 않는다 (서버가 이미 404로 통일) |
| `stale`/`partial_data` | 마지막 갱신 시각과 부분 실패 영역을 명시 |
| `enrichment_pending`/`links_pending` | 배지 + 수동 재조회 버튼. 자동 폴링하지 않는다 |
| `epoch_stale` | `Banner` tone `warning` + 현재 에폭 재조회 액션. 자동 재조회하지 않는다 |

**오류 경계**: 각 화면 섹션을 React error boundary로 감싼다. 한 섹션의 렌더 예외가 화면 전체를 비우지 않게 한다. 경계는 `C-005 ErrorBanner`를 폴백으로 쓴다.

## 8. 접근성 기준

`NFR-007`(WCAG 2.1 AA)과 QA 체크리스트를 만족하기 위한 구현 규칙이다.

| 항목 | 규칙 |
| --- | --- |
| 랜드마크 | `AppShell`이 banner / navigation / main을 제공한다. 추가 랜드마크를 만들지 않는다 |
| 스킵 링크 | `AppShell`의 `skipLinkLabel`을 사용한다 |
| 키보드 도달 | 모든 인터랙티브 요소 도달 가능. 커스텀 캔버스(C-036)는 동등한 표 대체 제공 |
| 포커스 표시 | Conductor `button.focusRing`을 제거하지 않는다 |
| 포커스 관리 | 오버레이는 Conductor `Dialog`/`Drawer`가 트랩·복귀를 처리한다. 자체 구현 금지 |
| 라우트 전환 | 전환 후 `main` 상단으로 포커스 이동, 화면 제목을 `aria-live="polite"`로 알림 |
| 정렬 헤더 | `aria-sort` 반영 |
| 동적 건수 | 검색 결과 건수 변화를 `aria-live="polite"`로 알림 |
| 30초 폴링 지표 | `aria-live` 사용 금지 (반복 알림이 스크린 리더 사용을 방해) |
| 색상 | 상태를 색상만으로 전달하지 않는다. 배지에 라벨 텍스트 포함 |
| 대비 | Conductor `checkContrast`를 라이트·다크 모두에서 실행 |
| 차트 | 동일 데이터의 표 대체를 제공 (접힘 가능) |
| 비활성 | Conductor `Button`의 `blockedReason`으로 사유 제공. 이유 없는 비활성 금지 |
| 자동 검사 | axe를 CI에서 실행, 위반 0건 |

## 9. 성능 기준

| 항목 | 목표 | 방법 |
| --- | --- | --- |
| 최초 콘텐츠 표시 (LCP) | p75 1.5초 (사내망) | 서버 컴포넌트 최초 렌더, Conductor CSS 1회 로드, 폰트 서브셋 |
| 상호작용 응답 (INP) | p75 200ms | 필터 조작은 URL 갱신만 동기 처리, 조회는 비동기 |
| 레이아웃 이동 (CLS) | 0.1 미만 | skeleton이 실제 높이 예약, 배지 슬롯 최소 높이 고정, 시퀀스 열 고정폭 |
| 결과 테이블 렌더 | 200행까지 가상화 없이 | 페이지 크기 최대 200 (ADR-010). 그 이상은 커서 페이징 |
| 번들 크기 | 초기 라우트 250KB gzip 이하 | 차트·그래프 컴포넌트는 동적 import |
| 폴링 부하 | 화면당 30초 1회 | 백그라운드 탭 중단 |

동적 import 대상: `C-033 TimeSeriesChart`, `C-034 DistributionChart`, `C-036 RelationGraphCanvas`. 이들은 W-006·W-007에서만 쓰이므로 초기 번들에 넣지 않는다.

## 10. 라우트 핸들러 (프록시)

```text
apps/web/app/api/[...path]/route.ts
  1. 세션 쿠키 검증 (없으면 401 + 리다이렉트 힌트)
  2. 상관 ID 생성·전파
  3. search-api로 전달 — **세션 쿠키만** 허용 목록으로 넘긴다 (CR-018, DEV-067)
  4. 응답 통과. 오류 DTO는 변형하지 않고 그대로 전달
```

규칙:

- **신원을 주장하는 헤더를 만들지 않는다** (CR-018, DEV-067). 예전에 이 자리에는 "사용자 식별 헤더 부착"이 적혀 있었으나 그것은 CR-015 DEV-047이 정한 것과 정면으로 어긋난다. `search-api`는 `X-User-Id`·`X-Forwarded-User`·`Authorization`·`X-Roles` 어느 것도 읽지 않고 **전부 401로 거절한다**(WP-012가 시험으로 건다). 신원은 세션 쿠키가 나르고, `search-api`가 같은 Redis 저장소에서 직접 해석한다. 헤더를 믿기 시작하면 클러스터 안 무엇이든 신원을 위조할 수 있다.
- 클라이언트가 보낸 헤더를 그대로 전달하지 않는다. 전달 목록은 **세션 쿠키와 상관 ID뿐**이다.
- 접근 범위를 프런트엔드에서 계산하거나 전달하지 않는다. 서버가 세션으로 판정한다 (ADR-008).
- 오류 응답의 `code`와 `detail`을 그대로 클라이언트에 넘긴다. 프런트엔드가 오류를 재해석하지 않는다.

### 10.1 클라이언트 번들 경계 (CR-018, DEV-068)

**클라이언트 컴포넌트는 `@prs/authz`의 진입점을 import하지 않는다.** 그 진입점은 `@prs/es`를 재수출하고, `@prs/es`는 Node 전용 `@elastic/elasticsearch`를 끌어온다 — 브라우저 번들에 들어가면 빌드가 깨진다.

역할 모델처럼 클라이언트가 필요로 하는 것은 **서브패스로만** 가져온다:

| 필요한 것 | 가져오는 곳 | 이유 |
| --- | --- | --- |
| `Role`, `ROLES` | `@prs/authz/roles` | `roles.ts`는 import가 0개라 그 자체로 클라이언트 안전하다 |
| 질의 파서 | `@prs/query` | ADR-001 — 서버 파싱과 클라이언트 검증이 같은 코드를 쓴다 |
| 오류 코드 | `@prs/contracts` | 순수 상수 |

**역할 목록을 web에 복제하지 않는다.** 역할이 늘면 두 곳이 갈라지고, 갈라진 쪽이 운영 내비게이션을 잘못 거른다.

### 10.2 OIDC 왕복 상태 (CR-018, DEV-071)

`createAuthorizationRequest`가 만드는 `state`·`nonce`·`codeVerifier`·`returnTo` 넷은 인가 리다이렉트와 콜백 **사이를 건너야 한다**. 이것을 **짧은 수명(10분)의 HttpOnly·SameSite=Lax 쿠키**로 나른다.

- 서버 저장소(Redis)에 두지 않는 이유: 콜백 전에 이탈한 사용자의 흔적이 계속 쌓인다. 왕복 하나에 필요한 값이 왕복보다 오래 살 이유가 없다.
- URL에 두지 않는 이유: `codeVerifier`가 노출되면 PKCE가 막으려던 것을 그대로 연다.
- 콜백은 쿠키의 `state`와 질의 문자열의 `state`를 `statesMatch`로 비교하고, 검증이 끝나면 쿠키를 **즉시 만료시킨다**.

## 11. 테스트 전략

| 계층 | 대상 | 도구 |
| --- | --- | --- |
| 단위 | `query-url` 직렬화·역직렬화 왕복, `format` 함수(SHA 축약, 시퀀스 표기) | Vitest |
| 컴포넌트 | 상태별 렌더링(각 화면의 상태 매트릭스 전 항목) | Vitest + Testing Library |
| 접근성 | 화면별 axe 검사, 키보드 시나리오 | Vitest + axe |
| E2E | FLOW-001~008 전 경로, 권한 매트릭스(역할 6종 × 화면 13종) | Playwright |
| 시각 회귀 | 라이트·다크 두 테마의 주요 화면 | Playwright 스크린샷 |

### gh 실행 출력 렌더링 규칙 (CR-008, ADR-018)

GitHub Operations 화면은 실행기 stdout·stderr를 그린다. 그 텍스트는 GitHub에서 왔고 GitHub 내용은 아무나 쓸 수 있으므로 **신뢰하지 않는다**. gh 2.97.0 자신도 외부 입력이 섞인 터미널 escape 처리에서 보안 수정을 한 이력이 있다.

| 규칙 | 내용 |
| --- | --- |
| 무해화 위치 | 프런트엔드가 아니라 서버의 `SafeGhOutput` 경계. 화면은 이미 무해화된 값만 받는다 |
| 원시 HTML | gh 출력에 `dangerouslySetInnerHTML`을 쓰지 않는다. 코드 검사로 0건을 강제한다 |
| Markdown | 안전 렌더러만. 원시 HTML 통과 옵션을 켜지 않는다 |
| 표시 컴포넌트 | `SafeGhOutputViewer`(C-063). `ExecutionPanel`(C-058)이 출력 영역에 이것을 쓴다 |
| 절단·바이너리 | 경계가 표시한 절단·바이너리 플래그를 그대로 사용자에게 보여준다 |
| 링크 | `--web` 계열이 돌려준 URL은 링크로 그린다. 서버가 브라우저를 띄우지 않는다 (ADR-019) |

같은 규칙이 관계 근거 문자열(`evidence`, THR-020)과 PR 본문에도 이미 적용되어 있다. gh 출력은 그 목록에 추가되는 것이지 예외가 아니다.

상태별 렌더링 테스트가 중요하다. 이 제품은 정상 경로보다 비정상 상태(`enrichment_pending`, `no_sequence`, `epoch_stale`, `sequence_reassigning`)가 사용자 신뢰를 좌우한다. 상태 매트릭스의 모든 항목에 대응하는 테스트를 만든다.

## 12. 픽스처 정책

백엔드가 없는 동안에도 화면을 개발·검증할 수 있어야 한다.

- 픽스처는 `../30_technical_architecture/pr_search_api_contracts.md`의 JSON 예시를 그대로 사용한다. 임의로 만들지 않는다.
- 픽스처는 정상 응답뿐 아니라 각 오류 코드와 부분 상태(`enrichment_pending`, `truncated`, `approximate`, `low_sample`)를 모두 포함한다.
- 픽스처 데이터는 합성이며 실제 GHE 데이터를 포함하지 않는다.
- 실제 API 연결 시 픽스처를 삭제하지 않고 테스트용으로 유지한다. 계약 테스트가 픽스처와 실제 응답 스키마의 일치를 검증한다.

## 9. GitHub Operations 화면 (CR-005 신규)

### 9.1 라우트

| 라우트 | 화면 | 비고 |
| --- | --- | --- |
| `/gh` | W-010 GitHub Command Center | capability 검색과 생성형 폼 |
| `/gh/pr`, `/gh/issue`, `/gh/repo`, `/gh/actions`, `/gh/release`, `/gh/project`, `/gh/codespace`, `/gh/settings`, `/gh/search`, `/gh/tools` | W-011~W-019, W-022 | 업무 중심 화면 |
| `/gh/api` | W-020 gh API 탐색기 | |
| `/gh/history` | W-021 실행 이력·저장된 Recipe | |
| `/gh/recipes/[id]` | W-023 Recipe 빌더 | |
| `/admin/gh/policy`, `/admin/gh/registry`, `/admin/gh/audit` | A-005, A-006, A-007 | |

기존 규칙은 그대로다 — 브라우저는 Next.js 라우트 핸들러만 호출하고 핸들러가 프록시한다 (ADR-011). URL 질의 파라미터가 단일 진실이라는 원칙도 유지하되, **실행 요청 본문은 URL에 넣지 않는다.** 비밀 입력이 URL·히스토리·리퍼러에 남으면 안 되기 때문이다 (NFR-010).

### 9.2 GenericCommandForm

capability 하나를 받아 폼 전체를 생성하는 단일 컴포넌트다. 명령마다 화면을 만들지 않는 것이 ADR-015의 핵심이다.

```text
GhCapability
     │
     ├─ positional 컨트롤 생성
     ├─ flag 컨트롤 생성 (타입별)
     ├─ 제약 검증 (conflicts / requires / oneOf)
     ├─ 권한 미리보기 (필요 권한 vs 보유 권한)
     ├─ 위험도 미리보기
     ├─ 정확한 argv 미리보기 (비밀 마스킹)
     └─ 실행
```

flag 타입 → 컨트롤 매핑. 모든 컨트롤은 Conductor 프리미티브로 구현한다 (ADR-006). 자체 UI 프리미티브나 리터럴 색상값을 만들지 않는다.

| flag 타입 | 컨트롤 |
| --- | --- |
| boolean | `Switch` / `Checkbox` |
| enum | `Select` |
| string | `Input` |
| number | `NumberInput` |
| repeatable | 다중 값 입력 |
| repository | `RepositoryPicker` |
| branch / ref | `BranchPicker` |
| user / team | `UserTeamPicker` |
| file | `FileUpload` |
| stdin secret | `SecretInput` (값 재표시 없음) |
| date | `DatePicker` |

**argv 미리보기와 실제 실행 argv는 같은 구조화 명령 모델에서 파생한다.** 두 경로를 따로 만들면 미리보기가 거짓말을 하게 되고, 그 순간 확인 절차 전체가 무의미해진다 (FR-GH-002 AC-4).

### 9.3 실행 상태 표현

실행 수명주기(FR-GH-006)의 10개 상태를 화면 상태로 매핑한다. 진행 중 출력은 SSE로 받아 append-only로 렌더링하고, 상한 초과 시 절삭 사실을 표시한다.

미지원 capability는 목록에서 숨기지 않는다. 비활성 상태와 사유(`unsupported_by_host`, `policy_blocked`, `terminal_only`, `requires_extension`)를 함께 보여준다 (FR-GH-013 AC-5).


## 작업대 표현 계층 (CR-067 / WP-073)

FR-SRCH-001·006~011, FR-SEQ-005, NFR-007에 따른 표현 변경이다. Shell은 역할 기반 NavList와 빠른 검색 진입을, SearchView는 기존 URL/요청/커서/에폭 상태를, ResultWorkbench는 응답 안의 선택을 각각 소유한다. 선택 키는 문서 종류·저장소·식별자·시퀀스 공간이다. 질의/정렬/에폭/조회 세대 경계에서 선택 컴포넌트를 다시 마운트해 이전 응답이 남지 않게 한다. 미리보기는 ResultRow 데이터만 사용한다. 선택·필터 접기·초안은 영구 저장하지 않는다. API/인가/DB/ES 계약과 자동 재조회 금지 규칙은 기존 그대로다. 스타일은 Conductor 위의 `workbench.css` 제품 배치로 한정한다.
