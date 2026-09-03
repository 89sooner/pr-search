# PR Search 디자인 시스템 토큰 문서

> 상태: review | 버전: v0.3 | 갱신일: 2026-09-03

## 1. 디자인 원칙

1. **Conductor를 소비하고 재정의하지 않는다.** 이 제품은 사내 `design-system`(Conductor)의 소비자다. 토큰을 새로 만들지 않고 Conductor의 semantic·component 토큰을 사용한다. 이 문서는 "제품 의미 → Conductor 토큰" 매핑표이지 독립 토큰 소스가 아니다.
2. 조사 도구에 맞는 높은 정보 밀도를 유지한다. 한 화면에서 25행 이상의 결과를 스캔할 수 있어야 한다.
3. 상태와 권한을 색상만으로 전달하지 않는다. 색은 보조 신호이며 라벨·아이콘이 주 신호다.
4. 식별자(SHA, 시퀀스 값, 브랜치명, 질의 문자열)는 항상 고정폭 서체를 사용한다. 이 제품에서 식별자 오독은 잘못된 조사 결론으로 직결된다.
5. 다크가 기준 테마이고 라이트는 같은 semantic 키 위의 두 번째 팔레트다. 두 테마 모두에서 대비 기준을 만족해야 한다.

## 2. 소비 방식

```text
@conductor-by-89soone/tokens  (토큰 소스, buildTokens / checkContrast CLI)
        ↓
@conductor-by-89soone/css     (@layer cdt.* 로 캐스케이드 제어되는 스타일시트)
        ↓
@conductor-by-89soone/react   (Radix 기반 React 프리미티브)
        ↓
PR Search 웹 대시보드
```

규칙:

- PR Search는 `@conductor-by-89soone/css`를 애플리케이션 진입점에서 한 번 import한다.
- 컴포넌트 스타일은 Conductor 블록 클래스(`blockClassName("btn")` → `cdt-btn`)와 유틸리티를 사용한다.
- 제품 전용 레이아웃(그리드 배치, 섹션 간격)만 애플리케이션 CSS로 작성하고, 그 안에서도 색·타이포·간격은 Conductor CSS 변수를 참조한다. 리터럴 색상값(`#rrggbb`)을 제품 코드에 쓰지 않는다.
- Conductor에 없는 토큰이 필요하면 `DEV-###`로 기록하고 design-system 저장소에 기여를 제안한다. 제품 안에서 임의 값을 정의하지 않는다.

## 3. 토큰 계층

| 계층 | 소유 | 예시 | PR Search에서의 사용 |
| --- | --- | --- | --- |
| Primitive | Conductor | `red.400` | 직접 사용 금지 |
| Semantic | Conductor | `surface.base`, `text.primary`, `status.success` | 이 문서의 매핑을 통해 사용 |
| Component | Conductor | `button.focusRing`, `badge.radius`, `banner.warning.background` | Conductor 컴포넌트가 내부적으로 사용. 제품은 오버라이드하지 않음 |
| Product mapping | PR Search | 아래 4~9장 | 제품 의미 → Conductor semantic 토큰 |

## 4. Color: 표면과 텍스트

| 제품 의미 | Conductor 토큰 | 사용처 |
| --- | --- | --- |
| 앱 배경 | `surface.canvas` | `AppShell` 바탕 |
| 기본 표면 | `surface.base` | 본문 영역 |
| 상승 표면 | `surface.raised` | 카드, 패널, 결과 테이블 컨테이너 |
| 오버레이 표면 | `surface.overlay` | Dialog, Drawer, DropdownMenu |
| 보조 표면 | `surface.subtle` | 테이블 헤더, 접힌 섹션 헤더 |
| 트랙 표면 | `surface.track` | Meter 트랙, 진행률 배경 |
| 타임라인 표면 | `surface.timeline` | `PrTimeline`, `ReleaseTimeline` |
| 주요 텍스트 | `text.primary` | 제목, 결과 행 제목 |
| 보조 텍스트 | `text.secondary` | 작성자, 시각, 메타 |
| 흐린 텍스트 | `text.muted` | 라벨, 도움말 |
| 최저 강조 텍스트 | `text.faint` | 비활성 항목, 플레이스홀더 |
| 식별자 텍스트 | `text.monoPayload` | SHA, 시퀀스 값, 질의 문자열, 브랜치명 |
| 기본 경계 | `border.default` | 카드·테이블 경계 |
| 약한 경계 | `border.subtle` | 행 구분선 |
| 강조 경계 | `border.strong` | 선택 행, 기준 개체 강조 |
| 컨트롤 경계 | `border.control` | 입력 필드 |
| 강조색 | `accent.DEFAULT` | 주요 액션, 링크 |
| 강조 약 | `accent.soft` | 선택 배경 |

## 5. Color: 상태 매핑

Conductor `Status` 어휘(`queued` / `running` / `waiting` / `success` / `partial` / `danger` / `neutralEnd`)를 제품 상태에 매핑한다. 새 상태 어휘를 만들지 않는다.

### 5.1 PR 상태

| PR 상태 | Conductor 토큰 | 배지 라벨 |
| --- | --- | --- |
| 열림 (open) | `status.running` | `열림` |
| 리뷰 대기 | `status.waiting` | `리뷰 대기` |
| 머지됨 | `status.success` | `머지됨` |
| 닫힘(미머지) | `status.neutralEnd` | `닫힘` |
| 되돌려짐 | `status.danger` | `되돌려짐` |

### 5.2 시퀀스 공간 상태

| 공간 상태 | Conductor 토큰 | 배지 라벨 |
| --- | --- | --- |
| `ok` | `status.success` | `정상` |
| `reassigning` | `status.running` | `재채번 중` |
| `stale` | `status.partial` | `갱신 중단` |
| `unknown` | `status.neutralEnd` | `확인 불가` |

### 5.3 잡·파이프라인 상태

| 잡 상태 | Conductor 토큰 |
| --- | --- |
| `queued` | `status.queued` |
| `running` | `status.running` |
| `paused` | `status.waiting` |
| `completed` | `status.success` |
| `failed` | `status.danger` |
| `cancelled` | `status.neutralEnd` |

### 5.4 관계 신뢰도

신뢰도는 Conductor `SeverityTag`의 `Severity` 어휘를 재사용하지 않는다. 의미 축이 다르기 때문이다. `Badge`의 `Tone`을 사용한다.

| 신뢰도 | Conductor `Tone` | 배지 라벨 | 근거 표시 |
| --- | --- | --- | --- |
| `exact` (SHA 일치) | `success` | `확정` | 선택 |
| `derived` (구조 파생) | `info` | `파생` | 선택 |
| `heuristic` (텍스트 추정) | `warning` | `추정` | **필수** |

### 5.5 알림·경고 배너

| 상황 | Conductor `Banner` tone |
| --- | --- |
| 정보(재채번 중, 재색인 이중 쓰기) | `info` |
| 주의(에폭 무효, 시퀀스 갱신 중단, 인증 만료 임박, 근사 집계) | `warning` |
| 위험(권한 조회 실패, 검색 엔진 장애, 복구 불가 오류) | `danger` |

### 5.6 사용량 지표

| 상황 | Conductor 토큰 |
| --- | --- |
| 정상 범위 | `meter.normal` |
| 임계 근접(85% 이상) | `meter.warning` |
| 초과 | `meter.exceeded` |

원본 이벤트 저장 용량, API rate limit 잔량, 백필 진행률에 사용한다.

## 6. Typography

| 제품 의미 | Conductor 토큰 | 규칙 |
| --- | --- | --- |
| 화면 제목 | `font.size.*` 상위 단계 + `stack.sans` | 화면당 h1 1개 |
| 섹션 제목 | `font.size.*` 중간 단계 + `stack.sans` | 섹션 경계 명시 |
| 본문·테이블 셀 | `font.size.*` 기본 단계 + `stack.sans` | - |
| 라벨·메타 | `font.size.*` 하위 단계 + `text.muted` | - |
| **식별자** | `stack.mono` + `text.monoPayload` | SHA, 시퀀스 값, 브랜치명, 태그명, 질의 문자열, 전달 식별자, 상관 ID |

식별자 표기 규칙:

- 커밋 SHA: 기본 12자 축약. 툴팁·복사는 전체 40자. 축약 표시에 말줄임표를 붙이지 않는다(`a3f9c21b4e8d` 형태 그대로).
- 머지 시퀀스: 천 단위 구분 기호를 쓰지 않는다(`1342`, `1,342` 아님). 구분 기호는 SHA·번호와 혼동을 만든다.
- 시퀀스 공간: `owner/repo@branch` 형식으로 표기한다.
- PR 번호: `#1234` 형식. 저장소가 모호하면 `owner/repo#1234`.

## 7. Spacing / Layout

| 영역 | 밀도 |
| --- | --- |
| 결과 테이블(W-001, W-004, A-004) | 조밀. 행 높이를 낮게 유지해 25행 이상 스캔 가능 |
| 상세 화면 섹션(W-002, W-003) | 보통. 섹션 간 간격으로 경계를 만든다 |
| 운영 지표 그리드(A-001) | 조밀. 카드 그리드 |
| 통계 대시보드(W-006) | 보통. 차트 주변 여백 확보 |
| 폼(A-002, A-003) | 넉넉. 입력 오류 메시지 공간 확보 |

레이아웃 안정성 규칙:

- 주요 콘텐츠 영역은 로딩 중에도 높이를 유지한다. skeleton은 실제 콘텐츠와 같은 행 수·높이로 그린다.
- 배지·상태 칩이 나중에 도착해 행 높이가 변하지 않도록, 배지 슬롯의 최소 높이를 예약한다.
- 시퀀스 배지 열은 최대 자릿수 기준 고정폭으로 예약한다.
- Conductor `appShell.navWidth`, `appShell.mainMaxWidth`를 그대로 사용한다.

## 8. Interaction

| 상태 | Conductor 토큰 | 규칙 |
| --- | --- | --- |
| hover | `state.hover` | 행·카드 hover |
| focus | `button.focusRing`(컴포넌트 토큰) | 포커스 링을 제거하지 않는다 |
| selected | `state.selected` | 선택 행, 활성 내비게이션 |
| disabled | `state.disabled` | 일반 비활성 |
| **정책 비활성** | `state.disabledPolicy` | 권한 부족으로 막힌 액션. `blockedReason`과 함께 사용 |
| elevation hover | `elevation.hover` | 카드 hover |
| elevation raised | `elevation.raised` | 카드·패널 |
| elevation overlay | `elevation.overlay` | Dialog·Drawer |

`state.disabled`와 `state.disabledPolicy`를 구분해 쓰는 것이 이 제품에서 중요하다. "지금은 할 수 없음"(로딩 중)과 "당신은 할 수 없음"(권한 부족)은 사용자의 다음 행동이 완전히 다르다.

## 9. Motion

**이 표는 Conductor 컴포넌트가 쓰는 토큰을 적는다.** 제품이 직접 만드는 전환의 목록이 아니다 — 아래 마지막 규칙이 그것을 금지하고, 실제로 `apps/web`에는 CSS 파일이 0건이며 루트 레이아웃이 Conductor CSS만 가져온다(ADR-006). 제품이 쓸 수 있는 모션은 Conductor가 이미 컴포넌트 안에 넣어 둔 것뿐이다.

| 용도 | Conductor 토큰 |
| --- | --- |
| 즉시 피드백(hover, focus) | `motion.fast` |
| 오버레이 등장·퇴장 | `motion.standard` (Tooltip은 팝오버 예산 `motion.fast`) |
| 강조 등장 | `motion.bounce` (사용 최소화) |
| 무한 회전(Spinner) | `motion.spin` |

- 30초 주기 지표 갱신에는 전환 애니메이션을 쓰지 않는다. 값이 계속 움직이면 읽기를 방해한다.
- `prefers-reduced-motion` 설정 시 모든 전환을 제거한다. Conductor CSS가 이를 처리하므로 제품에서 별도 애니메이션을 추가하지 않는다.

### 9.1 제품이 직접 만드는 전환 — 섹션 확장과 탭 전환은 즉시다 (CR-064)

이전 판은 위 표에 "일반 전환(섹션 확장, 탭 전환) → `motion.standard`"를 넣었는데, **같은 절의 마지막 규칙과 어긋났다.** 섹션 확장과 탭 전환은 Conductor 프리미티브가 아니라 제품이 직접 만드는 동작이다 — Conductor에 `Tabs`도 `Accordion`도 없다(`Tabs.tsx`가 `Button` 조합으로 WAI-ARIA 탭을 직접 구현한다). 그 둘에 모션을 주려면 제품이 자체 CSS를 두어야 하는데 바로 그것을 금지하는 규칙이 아래에 있다.

**두 동작을 따로 감사해 각각 즉시로 확정한다.**

| 동작 | 현재 구현 | 판단 |
| --- | --- | --- |
| 탭 전환 (`Tabs.tsx`) | 선택 탭이 `variant="secondary"`, 나머지가 `ghost`. 패널은 즉시 교체 | **즉시를 유지한다.** 분석 화면의 탭은 고빈도 조작이고, 전환을 넣으면 연속 조작에서 지연이 누적된다. 선택 상태의 시각 피드백은 Conductor `Button`이 `motion.fast`로 이미 준다 |
| 섹션 확장 (`hidden` 토글, 다섯 곳) | `hidden={!expanded}`. `NeighborSequenceList`·`ReleaseContainmentList`·`CoChangeSection`·`PendingSection`·`RelationSection` | **즉시를 유지한다.** `hidden`은 `display: none`이라 높이 전환이 성립하지 않고, 전환을 넣으려면 제품이 자체 CSS를 두어야 한다 — 위 규칙이 금지한다. 상위 요구사항도 이 모션을 요구하지 않는다: SRS에 섹션 확장 모션 요구가 없고 `NFR-007`은 접근성만 정한다 |

**상위 요구사항을 낮춘 것이 아니다.** SRS·PRD 어디에도 이 두 전환의 모션 요구가 없었고, 파생 문서인 이 표가 상위 근거 없이 배정한 뒤 구현이 그것을 지키지 못한 상태로 남아 있었다. 정정 방향은 표 쪽이다.

## 10. 차트 색상

`dataviz` 원칙을 따르되 팔레트는 Conductor semantic 토큰에서 가져온다.

1. 계열 색은 계열 구분에만 쓴다. 값의 크기는 위치·길이로 표현한다.
2. 계열이 20개를 넘으면 색으로 구분하지 않는다. 상위 N개만 색을 주고 나머지는 `text.muted` 계열로 묶는다.
3. 순서형 데이터(변경 규모 구간)는 단일 색조의 명도 단계를 쓴다. 범주형 팔레트를 쓰지 않는다.
4. 모든 차트는 동일 데이터의 표 대체를 제공한다 (NFR-007).
5. 라이트·다크 두 테마에서 각각 대비를 검증한다.

## 11. 검증

| 검증 항목 | 방법 | 기준 |
| --- | --- | --- |
| 색상 대비 | Conductor `checkContrast` CLI | 본문 4.5:1, 큰 텍스트 3:1 (라이트·다크 모두) |
| 리터럴 색상값 사용 | 제품 CSS·TSX에 대한 정적 검사 | `#rrggbb` 리터럴 0건 |
| Conductor 외부 UI 라이브러리 | 의존성 검사 | 0건 |
| 토큰 미사용 하드코딩 간격 | 정적 검사 | 임의 px 값 0건(레이아웃 그리드 제외) |
| 접근성 자동 검사 | axe | 위반 0건 |

## 12. 알려진 제한

| 제한 | 영향 | 대응 |
| --- | --- | --- |
| Conductor에 차트 프리미티브가 없다 | C-033, C-034를 제품에서 구현해야 한다 | Conductor semantic 토큰만 사용해 구현하고, 안정화 후 design-system 기여를 제안한다 |
| Conductor에 그래프 캔버스 프리미티브가 없다 | C-036을 제품에서 구현해야 한다 | W-007은 조건부 범위(REL-004 ACC-06)이므로 착수 시점에 재검토한다 |
| Conductor `Severity` 어휘는 관계 신뢰도와 의미 축이 다르다 | 신뢰도에 `SeverityTag`를 쓸 수 없다 | `Badge`의 `Tone`으로 매핑한다 (5.4장) |

## GitHub Operations 토큰 매핑 (CR-005 신규)

| 개념 | Conductor 매핑 | 근거 |
| --- | --- | --- |
| 위험도 R0 | `Tone` 중립 | 읽기 전용. 시각적으로 눈에 띌 필요가 없다 |
| 위험도 R1 | `Tone` 정보 | 가역적 쓰기 |
| 위험도 R2 | `Tone` 경고 | 확인이 필요한 쓰기 |
| 위험도 R3 | `Tone` 위험 | 파괴적·관리자·비밀 |
| 실행 상태 | 기존 `Status` 어휘 재사용 | `running`/`succeeded`/`failed`/`cancelled`는 기존 잡 상태와 같은 축이다 |
| 정책 차단·미지원 | `Tone` 비활성 + 사유 텍스트 | 숨기지 않고 비활성으로 보여준다 |

**`Severity`를 위험도에 쓰지 않는다.** `Severity`는 이미 관계 신뢰도(`exact`/`derived`/`heuristic`)에 매핑되어 있고 의미 축이 다르다. 위험도는 `Badge`의 `Tone`으로 표현한다 (기존 5.4장 규칙과 같은 이유).

| 제한 | 영향 | 대응 |
| --- | --- | --- |
| Conductor에 코드/argv 표시 프리미티브가 없다 | C-054 `ArgvPreview`를 제품에서 구현해야 한다 | Conductor semantic 토큰만 사용해 구현하고, 안정화 후 design-system 기여를 제안한다 |
| Conductor에 스트리밍 로그 뷰어가 없다 | C-058의 출력 영역을 제품에서 구현해야 한다 | 동일. 가상 스크롤은 접근성 요구(NFR-007)를 함께 만족시켜야 한다 |
