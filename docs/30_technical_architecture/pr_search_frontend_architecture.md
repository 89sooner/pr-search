# PR Search 프론트엔드 아키텍처

> 상태: review | 버전: v0.2 | 갱신일: 2026-08-19

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
| `/search` | W-001 | FR-SRCH-005~009, FR-SRCH-011, FR-STAT-006 | 서버 최초 + 클라이언트 갱신 | API-SRCH-004, API-STAT-001 |
| `/pr/[owner]/[repo]/[number]` | W-002 | FR-SRCH-003, FR-REL-001~007 | 서버 (헤더·개요·커밋) + 클라이언트 (관계·동시 변경) | API-SRCH-003, API-REL-001, API-REL-002, API-REL-003, API-REL-004 |
| `/commit/[owner]/[repo]/[sha]` | W-003 | FR-SRCH-002, FR-REL-002 | 서버 | API-SRCH-002, API-REL-002 |
| `/range` | W-004 | FR-SEQ-002, FR-SEQ-003, FR-SEQ-006, FR-SEQ-007 | 서버 최초 + 클라이언트 갱신 | API-SEQ-001, API-SEQ-002, API-SEQ-004, API-SEQ-005 |
| `/releases/[owner]/[repo]` | W-005 | FR-SEQ-004, FR-REL-002 | 서버 | API-SEQ-003 |
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
    releases/[owner]/[repo]/       W-005
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
  3. search-api로 전달 (사용자 식별 헤더 부착, 클라이언트 헤더는 전달하지 않음)
  4. 응답 통과. 오류 DTO는 변형하지 않고 그대로 전달
```

규칙:

- 클라이언트가 보낸 헤더를 그대로 전달하지 않는다. 사용자 식별은 서버가 세션에서 결정한다.
- 접근 범위를 프런트엔드에서 계산하거나 전달하지 않는다. 서버가 세션으로 판정한다 (ADR-008).
- 오류 응답의 `code`와 `detail`을 그대로 클라이언트에 넘긴다. 프런트엔드가 오류를 재해석하지 않는다.

## 11. 테스트 전략

| 계층 | 대상 | 도구 |
| --- | --- | --- |
| 단위 | `query-url` 직렬화·역직렬화 왕복, `format` 함수(SHA 축약, 시퀀스 표기) | Vitest |
| 컴포넌트 | 상태별 렌더링(각 화면의 상태 매트릭스 전 항목) | Vitest + Testing Library |
| 접근성 | 화면별 axe 검사, 키보드 시나리오 | Vitest + axe |
| E2E | FLOW-001~008 전 경로, 권한 매트릭스(역할 6종 × 화면 13종) | Playwright |
| 시각 회귀 | 라이트·다크 두 테마의 주요 화면 | Playwright 스크린샷 |

상태별 렌더링 테스트가 중요하다. 이 제품은 정상 경로보다 비정상 상태(`enrichment_pending`, `no_sequence`, `epoch_stale`, `sequence_reassigning`)가 사용자 신뢰를 좌우한다. 상태 매트릭스의 모든 항목에 대응하는 테스트를 만든다.

## 12. 픽스처 정책

백엔드가 없는 동안에도 화면을 개발·검증할 수 있어야 한다.

- 픽스처는 `../30_technical_architecture/pr_search_api_contracts.md`의 JSON 예시를 그대로 사용한다. 임의로 만들지 않는다.
- 픽스처는 정상 응답뿐 아니라 각 오류 코드와 부분 상태(`enrichment_pending`, `truncated`, `approximate`, `low_sample`)를 모두 포함한다.
- 픽스처 데이터는 합성이며 실제 GHE 데이터를 포함하지 않는다.
- 실제 API 연결 시 픽스처를 삭제하지 않고 테스트용으로 유지한다. 계약 테스트가 픽스처와 실제 응답 스키마의 일치를 검증한다.
