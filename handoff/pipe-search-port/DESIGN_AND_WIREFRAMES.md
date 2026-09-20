# DESIGN_AND_WIREFRAMES — 콘텐츠 전용 레이아웃, 토큰, 상태 전이

> 분류: 인수인계 자료 · 기준 SHA `da0ed9b5bd8fac59c7fcf02c593f69962468be4d`

이 문서의 와이어프레임은 전부 App Shell을 제외한다. `PIPE` 로고, 상단 사용자 메뉴, 전역 navigation은 그리지 않는다. 예시로 쓰인 저장소 이름·PR 번호·제목은 모두 합성 데이터다. `※`로 시작하는 줄은 배치 주석이며 실제 화면에 렌더링하지 않는다.

## 1. 원본이 실제로 쓰는 치수

아래는 `apps/web/app/repository-workspace.css`에서 그대로 읽은 값이다(`SOURCE_VERIFIED`). 포팅 대상 값이 아니라 **출발점**이다. 3장에서 어떤 값을 옮기고 어떤 값을 바꾸는지 정한다.

| 대상 | 원본 선언 | 줄 |
|---|---|---|
| 작업 공간 격자 | `grid-template-columns: 260px minmax(0, 1fr); gap: 24px; align-items: start` | `:12` |
| 사이드바 | `position: sticky; top: 24px; height: calc(100dvh - 48px); overflow: hidden; padding: 20px; border: 1px solid; border-radius: 12px` | `:32` |
| 트리의 최소 높이 | `flex: 1 1 0; min-height: 185px` | `:48` |
| 두 선택기 사이 간격 | `margin-top: 14px` | `:59` |
| 필드 | `flex-direction: column; gap: 7px` | `:51` |
| 필드 라벨 | `font-size: 12px; font-weight: 550` | `:52` |
| 입력 | `min-height: 39px; padding: 9px 11px; border-radius: 7px; font-size: 13px` | `:53` |
| focus 링 | `outline: 2px solid var(--ui-accent); outline-offset: 3px` | `:54` |
| 비활성 | `opacity: .6` | `:57` |
| 탭 상자 | `border: 1px solid; border-radius: 12px; overflow: clip` | `:72` |
| 탭 목록 | `padding: 0 18px; border-bottom: 1px solid; overflow-x: auto` | `:73` |
| 탭 하나 | `padding: 17px 16px; font-size: 13px; white-space: nowrap` | `:74` |
| 필터 격자 | `grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px` | `:79` |
| 범위 줄 | `grid-template-columns: 1fr 2fr; gap: 10px` | `:91` |
| 범위 입력 두 칸 | `repeat(2, minmax(0, 1fr)); gap: 10px` | `:92` |
| 필터 form(compact) | `padding: 18px`에 위아래 `10px`, 아래 여백 `8px` | `:94`, `:128` |
| 결과 스크롤 | `max-height: calc(100dvh - 460px); min-height: 320px; overflow: auto` | `:130` |
| 결과 머리글 | `padding: 14px 24px; border-block: 1px solid; font-size: 12px` | `:131` |
| 표 | `font-size: 12px` | `:134` |
| 표 셀 | `padding: 14px 12px; vertical-align: middle` | `:135` |
| 표 머리글 셀 | `font-size: 11px; font-weight: 600; white-space: nowrap` | `:136` |
| 제목 열 | `min-width: 220px; width: 48%` | `:138` |
| 보조 메타 | `font-size: 10px; margin-top: 6px` | `:139` |
| 시각 표기 | `font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap` | `:140` |
| 펼친 행 | `background: var(--ui-accent-soft)` | `:141` |
| 제목 버튼 | `font-size: 13px; font-weight: 550; line-height: 1.6; overflow-wrap: anywhere` | `:147` |
| 상세 상자 | `padding: 12px; border-radius: 7px` | `:151` |
| 본문 | `white-space: pre-wrap; line-height: 1.8; max-height: 250px; overflow: auto` | `:153` |
| 상세 두 열 | `grid-template-columns: 3fr 2fr; gap: 20px; margin-top: 18px` | `:154` |
| 파일·커밋 목록 | `max-height: 240px; overflow: auto` | `:157`, `:160` |
| 빈 상태 | `padding: 64px 24px; text-align: center` | `:162` |
| 이어 보기 영역 | `padding: 22px; gap: 16px` | `:166` |
| 1200px 이하 | 격자가 `220px minmax(0,1fr)`, gap `18px`, 필터 3열 | `:178` |
| 800px 이하 | 격자가 한 열, 사이드바 `position: static`, 필터 2열, 상세 한 열 | `:179` |

`repository-workspace.css`만으로는 최종 화면이 설명되지 않는다. 같은 클래스에 더 구체적인 규칙을 주는 `reader-workspace.css`와, 모달 전체를 소유하는 `source-workspace.css`의 실제 선언을 함께 확인했다.

| 대상 | 원본 선언 | 위치 |
|---|---|---|
| 필터 격자의 **실제 승자** | `.reader-ui .repo-filter-grid { grid-template-columns: 1fr 2fr 1.15fr 1fr; gap: 10px }` | `reader-workspace.css:100` |
| 좁은 폭의 필터 격자 | `grid-template-columns: 1fr 2fr` | `reader-workspace.css:185` |
| 사이드바(구체성 높은 쪽) | `position: sticky; top: 24px; padding: 20px; border-radius: 12px; box-shadow: var(--ui-shadow-soft)` | `reader-workspace.css:34` |
| 표 바깥 상자 | `.reader-table-scroll { border: 1px solid; border-radius: 10px; overflow-x: auto }` | `reader-workspace.css:119` |
| 모달 | `width: min(1480px, calc(100vw - 48px)); height: min(900px, calc(100dvh - 48px)); border-radius: 14px; overflow: hidden` | `source-workspace.css:51` |
| 모달 전체화면 | `width: 100vw; height: 100dvh; border-radius: 0` | `source-workspace.css:52` |
| 모달 머리글 | `padding: 15px 20px; gap: 14px; cursor: move; touch-action: none` | `source-workspace.css:53` |
| 모달 제목·부제 | 15px / 11px, 한 줄로 줄임 | `source-workspace.css:55-56` |
| Diff 격자 | `grid-template-columns: 260px minmax(0, 1fr); flex: 1; min-height: 0` | `source-workspace.css:65` |
| 변경 파일 패널 | `overflow: auto; padding: 15px 10px; border-right: 1px solid` | `source-workspace.css:66` |
| 변경 파일 항목 | 11px, 보조 메타 9px | `source-workspace.css:69`, `:72` |
| 코드 스크롤 | `overflow: auto; min-height: 0; flex: 1` | `source-workspace.css:81` |
| 줄 번호 칸 | **44px**. 좌우 두 코드 열의 합이 정확히 100%가 되도록 맞춘 값이다 | `source-workspace.css:87` |
| 코드 표의 최소 폭 | **388px** = 코드 열 150px 두 개 + 줄 번호 44px 두 개. 그 아래에서는 표 전체가 가로 스크롤한다 | `source-workspace.css:85` |
| Time-lapse 격자 | `grid-template-columns: 240px minmax(0, 1fr) 260px` | `source-workspace.css:107` |
| revision 패널 | `overflow: auto; padding: 14px 10px; border-right: 1px solid` | `source-workspace.css:108` |
| 음영 범례 | 칸 하나가 `17px × 12px`, 글자 10px | `source-workspace.css:4-5` |

`source-workspace.css:85`의 주석이 기록한 실측이 특히 쓸모 있다. `table-layout: fixed`에서는 셀의 `min-width`가 열 폭이 정해진 뒤 무력해지므로(375px 뷰포트에서 계산된 `min-width`가 150px로 읽히는데 실제 렌더 폭은 93px로 줄어드는 것을 브라우저에서 확인했다), **최소 폭을 셀이 아니라 표에 준다.** MUI `Table`로 옮길 때도 같은 함정이 있으므로 그대로 따른다.

**핵심 주의점**(`repository-workspace.css:14-30`의 주석이 직접 밝힌다): `.repo-topbar`와 `.repo-shell-main`은 이 컴포넌트의 실제 조상이 **아니다.** `RepositoryWorkspace`는 언제나 `ReaderShell` 안에 렌더링되고, 그 셸의 실제 크롬은 `.reader-header-inner`(최소 88px) + 테두리 1px + `.reader-container`의 위쪽 여백 32px = **121px**이다. 즉 원본의 `calc(100dvh - 48px)`와 `calc(100dvh - 460px)`는 그 121px 크롬과 sticky 동작을 전제로 손으로 맞춘 상수이며, **다른 호스트에서는 아무 의미가 없다.**

## 2. 콘텐츠와 호스트의 경계

| 항목 | 누가 소유하는가 | 근거·비고 |
|---|---|---|
| 페이지 배경색, 기본 글자색 | 호스트 | 콘텐츠는 `background.default`를 다시 칠하지 않는다 |
| 본문 글꼴과 monospace 글꼴 | 호스트 | 원본은 `--ui-font-mono`를 셸에서 받는다. PIPE 테마의 값을 그대로 상속한다 |
| 콘텐츠 상자의 폭과 높이 | 호스트 | 3장의 계약으로 받는다 |
| 콘텐츠 바깥 여백 | 호스트 또는 콘텐츠 중 **하나만** | 3.2의 두 모드로 명시한다 |
| App Shell 헤더·메뉴·로그인·테마 토글 | 호스트 | 콘텐츠가 그리지 않는다 |
| 전역 CSS reset, `body` 규칙 | 호스트 | 콘텐츠가 추가하지 않는다 |
| z-index 기준선, portal container | 호스트 | 5장 참조 |
| 라우터와 URL query | 호스트 | `navigation` 계약으로 받는다 |
| 좌우 패널 격자와 내부 스크롤 | **콘텐츠** | 3장 |
| 표 밀도, 열 폭, 행 높이 | **콘텐츠** | 4장 |
| 필터 격자와 제어 높이 | **콘텐츠** | 4장 |
| 모달의 크기와 내부 배치 | **콘텐츠** | 6장 |
| `Ctrl/Cmd+K` 등 단축키 | **콘텐츠** | `PD-009` |

**셸을 떼어 내면 사라지는 것**(`SOURCE_VERIFIED`)은 다음과 같다. 각각을 어떻게 대체하는지 함께 적었다.

| 사라지는 것 | 대체 |
|---|---|
| `reader/ReaderShell.tsx:25`의 `#omni-search-input` 해시 focus와 `:29-35`의 `⌘K`·`Ctrl+G` `window` 리스너. 둘 다 `[data-reader-search]` 입력을 찾는다 | 콘텐츠가 전부 소유한다(`PD-009`) |
| `ReaderShell`이 주는 121px 크롬을 전제한 높이 계산 | 격자 계약으로 대체한다(`PD-005`) |
| 전역 테마 토글과 `ThemeProvider` | 호스트 테마를 상속한다(`PD-006`) |
| `--ui-*` 토큰 정의 | PIPE theme의 역할 색으로 대응시킨다(7장) |
| 세션 만료 시 로그인 링크 | 호스트가 제공하거나 `onConnectionRequired`로 넘긴다 |

## 3. 크기와 스크롤 계약

### 3.1 기본 격자

호스트가 준 콘텐츠 상자의 폭을 W, 높이를 H로 둔다. **브라우저 창 1440px가 콘텐츠 폭 1440px이 아니다.** PIPE의 App Shell이 사이드 메뉴와 여백을 이미 가져가므로 실제 W는 그보다 작다.

기본 desktop 검수 프레임은 W=1280, H=800이다.

```text
루트 격자     : 260px / minmax(0, 1fr),  gap 24px
  좌측 열     : 문맥 제어(auto) / 트리(minmax(0, 1fr))
  우측 열     : 탭(auto) / 필터(auto) / 결과 머리글(auto) / 결과(minmax(0, 1fr))
```

W=1280에서 콘텐츠가 자체 여백을 소유하면 좌우 24px씩을 쓰고, 260 + 24 + 948 = 1232px가 된다.

### 3.2 여백 소유권의 두 모드

호스트가 이미 콘텐츠 여백을 주는 경우와 아닌 경우가 있다. **둘 다 지원하고 어느 모드인지 명시한다.** 중복 여백은 밀도를 망가뜨린다.

| 모드 | 조건 | 콘텐츠의 동작 |
|---|---|---|
| `self-padded` | 호스트가 여백 없이 상자만 준다 | 루트에 `padding: 24px`(compact는 16px)를 적용한다 |
| `host-padded` | 호스트가 이미 여백을 준다 | 루트 padding을 0으로 두고 격자만 만든다 |

모드는 주입 계약의 `layout.padding`으로 받는다. 기본값은 `self-padded`다.

### 3.3 높이 모드

| 모드 | 조건 | 동작 |
|---|---|---|
| `bounded` | 부모 높이가 확정되어 있다(호스트가 `layout.height`를 주거나 부모가 flex/grid로 확정 높이를 준다) | 루트를 `height: 100%`로 두고 결과 영역이 남은 높이를 전부 가진다. 좌우 패널이 각자 스크롤한다 |
| `document-flow` | 부모 높이가 확정되어 있지 않다 | 루트 높이를 `auto`로 두고 페이지 스크롤에 맡긴다. 좌측 트리에는 `max-height: 60vh`처럼 **상대적인** 상한만 둔다 |

**반드시 지킬 것**: 부모 높이가 확정되지 않았는데 `height: 100%`만 넣는 상태를 두지 않는다. 그 경우 높이가 0으로 접히거나 내용이 잘린다. 구현 시 부모의 확정 여부를 실제로 확인하고, 확인할 수 없으면 `document-flow`를 기본으로 한다.

`bounded` 모드에서도 **조작부 + 최소 결과 높이**가 들어가지 않으면(예: H가 560px 미만이거나 200% 확대 상태) `document-flow`로 자동 전환한다. `overflow: hidden`으로 입력과 버튼을 잘라 내지 않는다.

### 3.4 스크롤 소유자

```text
콘텐츠 루트            overflow: visible   (자체 스크롤을 만들지 않는다)
├─ 좌측 패널          overflow: hidden    (자신은 스크롤하지 않는다)
│  ├─ 문맥 제어       auto 높이
│  └─ 트리 목록       overflow: auto      ← 좌측의 유일한 스크롤 소유자, min-height: 0
└─ 우측 패널          overflow: hidden, min-width: 0
   ├─ 탭             auto
   ├─ 필터           auto (펼치면 결과 높이를 줄인다)
   ├─ 결과 머리글     auto (스크롤하지 않고 고정된다)
   └─ 결과 영역       overflow: auto      ← 우측의 유일한 수직 스크롤 소유자, min-height: 0
      └─ 표          필요할 때만 overflow-x: auto
```

격자와 flex의 스크롤 자식에는 `min-height: 0`과 `min-width: 0`을 반드시 준다. 이것이 없으면 자식이 내용 크기만큼 부풀어 부모를 밀어낸다.

**중첩 이중 스크롤을 만들지 않는다.** 결과 영역이 스크롤하고 그 안의 표가 또 수직으로 스크롤하면 사용자가 작업 문맥을 잃는다. 표의 수평 스크롤만 별도로 허용한다.

좌측 트리와 우측 결과는 서로 독립적으로 스크롤하되, `bounded` 모드에서 두 패널의 바깥 상자 **하단을 맞춘다.** 목표는 차이 4px 이내이며, `compact`와 `document-flow`에서는 이 기준을 적용하지 않는다.

### 3.5 표 머리글 고정

결과 영역이 스크롤할 때 표 머리글은 `position: sticky; top: 0`으로 고정한다.

원본의 이 표에는 그 선언이 없다. 확인 범위를 밝힌다: `repository-workspace.css`, `reader-workspace.css`, `source-workspace.css`, `ui.css` 어디에도 `.repo-table th`나 `.reader-table-scroll th`에 `position: sticky`를 주는 규칙이 없다. 다만 같은 저장소의 **다른 화면**은 쓰고 있다 — `workbench.css:109`의 `.prs-result-table .ui-table-header-cell`이 `position: sticky; inset-block-start: 0; z-index: var(--ui-z-raised)`를 준다.

즉 원본 저장소는 이 패턴을 알고 있으면서 이 표에만 적용하지 않았다. 50행 단위로 이어 읽는 표에서 머리글이 사라지면 열을 잃으므로 이번 포팅에서는 적용한다. 이것은 `PORT_DECISION`이며, 기댈 선례가 같은 저장소 안에 있다.

## 4. 와이어프레임

### 4.1 기본 Search — 필터 닫힘

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│ ┌──────────────────────┐  ┌───────────────────────────────────────────────────┐ │
│ │ Find Repository      │  │ Search | Commit history | My open PRs | My merged │ │
│ │ [demo/modem       ▾] │  ├───────────────────────────────────────────────────┤ │
│ │ Base branch          │  │ REPOSITORY WORKSPACE                              │ │
│ │ [main             ▾] │  │ Pull requests                     ⌷ demo/modem    │ │
│ ├──────────────────────┤  │ [Filters (2) ▾]                                   │ │
│ │ Files & folders   ↻  │  │ [Search ↵]  [Reset]               ⌘ K Quick search│ │
│ │ ⌥ main  a91bc21      │  ├───────────────────────────────────────────────────┤ │
│ │ [Filter root entries]│  │ ⌸ Pull requests 123 items   PR Descending      ↻  │ │
│ │ [/ All changes     ] │  ├──────┬───────────┬────────────────────┬───────────┤ │
│ │ ▾ src                │  │ # ↓  │ M number  │ Title              │ …         │ │
│ │   ▸ phy              │  ├──────┼───────────┼────────────────────┼───────────┤ │
│ │   ▸ l1               │  │ #548 │ M-1900-42 │ RF calibration upd │ …      ▸  │ │
│ │   ▸ rrc              │  │ #547 │ Awaiting… │ NR measurement fix │ …      ▸  │ │
│ │ ▸ tests              │  │ #546 │           │ L1 scheduler tweak │ …      ▸  │ │
│ │   README.md          │  │ #545 │ M-1900-41 │ RRC timer cleanup  │ …      ▸  │ │
│ │                      │  │                                                   │ │
│ │                      │  │                                        50 shown   │ │
│ └──────────────────────┘  └───────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
※ 좌측 패널 260px, gap 24px, 우측이 남은 폭. 페이지 제목은 우측 패널 안에 한 번만 둔다.
※ 필터가 닫혀 있어도 검색어 입력을 밖에 다시 만들지 않는다. 활성 개수가 숨은 조건을 알린다.
※ #546 행처럼 M 키가 없는 행은 셀을 비워 둔다. 배지 자체를 그리지 않는다.
```

ASCII 폭 때문에 생략한 열은 4.3에 표로 전부 적었다.

### 4.2 Filters 펼침

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│ REPOSITORY WORKSPACE                                                          │
│ Pull requests                                                 ⌷ demo/modem    │
│ [Filters (4) ▴]                                                               │
│                                                                               │
│ Status        Title · PR number · commit SHA        Author        Label       │
│ [Merged   ▾]  [NR measurement                   ]   [dev-a    ]   [All    ▾]  │
│                                                                               │
│ Range filter                   M number from          M number to             │
│ [M number                ▾]    [42               ]    [80               ]     │
│                                                                               │
│ PR 1842–2044 · M 42–80                                                        │
│                                                                               │
│ [Search ↵]  [Reset]                                           ⌘ K Quick search│
└───────────────────────────────────────────────────────────────────────────────┘
※ 첫 줄 격자는 1fr 2.4fr 1.1fr 1.1fr. 검색어 칸에 가장 넓은 폭을 준다.
※ 범위 줄 격자는 1fr 1fr 1fr. 선택기 한 칸과 From/To 두 칸이 같은 줄에서 편집된다.
※ 활성 요약은 선택되지 않은 유형의 조건까지 전부 보여 준다(여기서는 PR 범위가 숨어 있다).
※ helper text와 오류 문구는 높이를 예약해 두어 옆 제어의 baseline이 흔들리지 않게 한다.
```

Range filter 유형별 입력 구성은 다음과 같다.

| 유형 | 입력 | 비활성 조건과 안내 |
|---|---|---|
| `PR number` | 숫자 두 칸, `min=1`, `step=1` | 없음 |
| `M number` | 숫자 두 칸, `min=1`, `step=1` | 저장소나 base branch가 없으면 비활성. `Select a repository and base branch to filter by M number.` |
| `Merged date` | 날짜 선택기 두 칸(`YYYY-MM-DD`) | 없음. `Clear`와 `Today`를 제공한다 |
| `Merge order` | 텍스트 두 칸, 자리표시자 `7+ character SHA` | 저장소나 base branch가 없으면 비활성. `Select a repository and base branch to search a merge-order range.` |

### 4.3 결과 표의 여덟 열

| 열 | 기준 폭 | 정렬 가능 | 내용과 표시 규칙 |
|---|---:|---|---|
| `#` | 64px | 예(`pr_number`) | PR이면 `#1842`, 커밋이면 SHA 앞 12자. GHE 원문으로 가는 새 탭 링크. monospace |
| `M number` | 132px | 예(`merge_seq`) | 서버가 준 문자열 또는 상태 라벨. `assigned`일 때만 링크 |
| `Title` | 남은 폭, 최소 220px | 아니오 | 최대 두 줄로 줄이고 아래에 `sequence_space` 보조 메타. 누르면 상세가 펼쳐진다 |
| `Author` | 92px | 아니오 | 두 글자 아바타 + 이름. 긴 이름은 줄이되 전체 값을 확인할 수 있게 한다 |
| `Status` | 84px | 아니오 | 아이콘 + 텍스트. `Merged` / `Open` / `Closed` / `—` |
| `Merged at` | 136px | 예(`merged_at`) | `YYYY-MM-DD HH:MM UTC`. `tabular-nums`, 줄바꿈 없음 |
| `Changes` | 92px | 아니오 | `+N` 및 `−N`. `null`과 `0`을 구별한다. `tabular-nums` |
| (상세) | 40px | 아니오 | `aria-label`을 가진 아이콘 버튼 |

최소 폭의 합은 64 + 132 + 220 + 92 + 84 + 136 + 92 + 40 = **860px**이다. 결과 패널이 이보다 좁으면 **표 안에서만** 가로 스크롤을 허용한다. 열을 아무 표시 없이 지우거나 글자를 줄여 억지로 맞추지 않는다.

### 4.4 행 상세

```text
#548 │ M-1900-42 │ RF calibration update │ dev-a │ Merged │ … │ ▾
┌──────────────────────────────────────────────────────────────────────────────┐
│ feature/rf-fix → main              [View in GHE ↗]  [View diff]              │
│                                                                              │
│ 합성 PR 본문이다. 실제 서비스에서는 서버가 준 문자열을 평문으로 그린다.        │
│ 줄바꿈은 보존하고 Markdown이나 HTML로 해석하지 않는다.                        │
│                                                                              │
├──────────────────────────────────────┬───────────────────────────────────────┤
│ Changed files                        │ Commit                                │
│ ⌸ src/phy/rf_calibration.c           │ d71be10a3f2c…                         │
│ ⌸ src/phy/rf_config.h                │ c81fa2290b17…                         │
│                                      │ ※ 누르면 전체 SHA를 복사한다           │
└──────────────────────────────────────┴───────────────────────────────────────┘
※ 행 아래 펼침이 기본안이다. 오른쪽 drawer로 바꾸지 않는다.
※ 두 열의 비율은 3:2, gap 20px. 좁은 폭에서는 한 열로 접는다.
※ 본문·파일 목록·커밋 목록에 각각 상한 높이와 자체 스크롤을 둔다(250px / 240px / 240px).
```

본문은 **평문 문단**이다(`SOURCE_VERIFIED`: `RepositoryWorkspace.tsx:60`). `white-space: pre-wrap`으로 줄바꿈만 보존한다. `dangerouslySetInnerHTML`을 쓰지 않는다. Markdown 렌더러를 새로 도입하지 않는다. 원본이 하지 않는 일이고, 신뢰하지 않는 PR 본문을 HTML로 해석하면 그대로 취약점이 된다.

### 4.5 Commit history

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Search | Commit history | My open PRs | My merged PRs                        │
├──────────────────────────────────────────────────────────────────────────────┤
│ PATH HISTORY                                                              ↻  │
│ ⌸ src/phy/rf_calibration.c                                                   │
│ Changes that touched this file · a91bc21                                     │
│                                                                              │
│ ⌾ 50 loaded commits      [Compare selected (2/2)]      [Time-lapse]          │
│                                                                              │
│ Select two revisions to compare this file. Folder history includes changes   │
│ under the selected path. History is path-based; renamed files can be         │
│ followed from their previous path in Diff.                                   │
├───┬───────────┬────────────────────────┬────────────┬────────┬───────┬───────┤
│ □ │ Revision  │ Change                 │ Linked PRs │ Author │ Comm. │ Insp. │
├───┼───────────┼────────────────────────┼────────────┼────────┼───────┼───────┤
│ ☑ │ d71be10a3 │ RF calibration update  │ #548       │ dev-a  │ 09-19 │ Diff  │
│ ☑ │ c81fa2290 │ RF configuration       │ —          │ dev-b  │ 09-18 │ Diff  │
│ □ │ b12de4371 │ L1 scheduler tweak     │ Pending    │ dev-c  │ 09-17 │ Diff  │
└───┴───────────┴────────────────────────┴────────────┴────────┴───────┴───────┘
                          [Load older commits]
※ Revision 셀과 Linked PRs 배지는 '누르면 복사'다. 결과 표의 '누르면 이동'과 다르므로
   tooltip과 aria-label로 구분한다(Copy full SHA … / Copy PR #…).
※ Change 열의 제목과 Inspect 열의 Diff 버튼은 같은 동작이다.
※ 이것은 무한 스크롤이 아니라 명시적 버튼이다. 결과 표와 혼동하지 않는다.
※ Linked PRs의 세 상태: 번호 배지 / — (없음 확정) / Pending (아직 모름).
```

### 4.6 Diff

```text
┌─ DIFF · Pull request #548 ───────────────────────── [⛶ 전체화면] [✕ 닫기] ┐
│ demo/modem · c81fa2290 → d71be10a3                                        │
├───────────────────────────────────────────────────────────────────────────┤
│ [Side by side | Unified]  [⌕ Find in diff…]  3 change groups  [↑] [↓]     │
│                                            [⇄ Swap]  [⏱ Time-lapse]       │
├─────────────────────┬─────────────────────────────────────────────────────┤
│ Changed files  2    │ src/phy/rf_calibration.c        □ Show all lines    │
│ [Filter files…]     ├──────────────────────┬──────────────────────────────┤
│ ⌸ rf_calibration.c  │ BEFORE · c81fa2290   │ AFTER · d71be10a3            │
│   modified   +12 −3 │  12 │ old line       │  12 │ old line               │
│ ⌸ rf_config.h       │  13 │ removed text   │  13 │ added text             │
│   renamed    +2 −0  │     │ [변경 없는 줄 접기]                            │
│   ← rf_cfg.h        │  40 │ …              │  40 │ …                      │
│                     │                                                     │
│ [More files]        │ Before: no newline at EOF. 15 changed rows ·        │
│                     │ Revisions stay pinned while you inspect.            │
└─────────────────────┴─────────────────────────────────────────────────────┘
※ split 모드의 열 폭은 44px / calc(50% - 44px)를 두 번 반복해 좌우 줄 번호를 정렬한다.
※ 좌우가 하나의 수직 스크롤을 공유한다. 두 개의 독립 스크롤로 나누지 않는다.
※ 변경 파일 패널은 240–280px. 나머지를 코드에 준다.
※ 기본은 변경 줄 앞뒤 3줄만 보인다. Find 입력이 있으면 접지 않는다.
```

### 4.7 Time-lapse

```text
┌─ TIME-LAPSE · src/phy/rf_calibration.c ────────── [⛶] [✕ 닫기] ┐
│ demo/modem · Revision-aware file history                        │
├─────────────────────────────────────────────────────────────────┤
│ [◀]  ──────────────────────────────●──────  [▶]   48 / 50       │
│ [Analyze line history]  [Related PRs]                           │
│ Showing the loaded path revisions. Load older commits in        │
│ History before opening Time-lapse to extend the window.         │
├──────────────┬────────────────────────────┬─────────────────────┤
│ Revisions    │ d71be10a3f2c  [⌕ Find…]    │ Line history · 42   │
│ d71be10a3    │   40 │ code                │ 3 observed versions │
│  RF update   │   41 │ code                │ ┌─────────────────┐ │
│  dev-a 09-19 │ ▸ 42 │ selected line       │ │ d71be10a3       │ │
│ c81fa2290    │   43 │ code                │ │ Aligned replace │ │
│  RF config   │      │                     │ └─────────────────┘ │
│  dev-b 09-18 │      │                     │ Low ▪▪▪▪▪ High      │
│              │      │                     │ 30 revisions        │
│              │      │                     │ analyzed. Line      │
│              │      │                     │ correspondence is   │
│              │      │                     │ inferred from       │
│              │      │                     │ adjacent diffs,     │
│              │      │                     │ not authoritative   │
│              │      │                     │ blame.              │
└──────────────┴────────────────────────────┴─────────────────────┘
※ 슬라이더는 '이미 불러온 revision'만 가리킨다. 전체 이력이 아니다.
※ 줄 추적은 Analyze를 눌러야 시작한다. 자동으로 돌지 않는다.
※ 음영 다섯 단계에는 반드시 범례를 붙인다. 색만으로 의미를 전달하지 않는다.
```

모달 크기는 원본에 **선언이 있다.** 그것을 그대로 옮기지 않는 이유와 함께 적는다.

| 항목 | 원본(`source-workspace.css:51-52`, `:65`, `:107`) | 이번 값 | 이유 |
|---|---|---|---|
| 기본 폭 | `min(1480px, calc(100vw - 48px))` | `min(1280px, 가용 폭 - 48px)` | 원본은 브라우저 폭(`100vw`)을 쓴다. PIPE에서는 App Shell이 이미 폭을 가져가므로 `100vw`가 실제 가용 폭보다 크다. 또한 1480px는 세 열(파일 목록 260 + 코드 두 열)이 충분히 넓은 값인데, PIPE의 콘텐츠 폭이 그만큼 되지 않을 수 있다 |
| 기본 높이 | `min(900px, calc(100dvh - 48px))` | `가용 높이 - 48px`를 상한으로 | 같은 이유. `100dvh`는 셸 크롬을 모른다 |
| 전체화면 | `width: 100vw; height: 100dvh; border-radius: 0` | 호스트 viewport에 맞춘다 | 뜻이 같다 |
| radius | `14px` | 10px(패널 토큰) | 화면 전체의 곡률을 하나로 맞춘다 |
| Diff 변경 파일 패널 | `260px` 고정 | 240–280px | 원본 값이 이 범위 안에 있다 |
| Time-lapse 격자 | `240px / minmax(0,1fr) / 260px` | 그대로 | 원본을 따른다 |
| 줄 번호 칸 | `44px` | 그대로 | 좌우 코드 열의 합이 100%가 되도록 맞춘 값이다 |
| 코드 표 최소 폭 | `388px` | 그대로 | 그 아래에서는 표가 가로 스크롤한다 |
| 툴바 | — | 좁아지면 줄바꿈한다 | 닫기·찾기·현재 revision 정보에는 항상 접근할 수 있어야 한다 |

**이 네 가지 변경(폭, 높이, radius, 파일 패널 범위)이 원본과 다른 지점이다.** 나머지는 원본 값을 그대로 쓴다. `100vw`와 `100dvh`를 쓰지 않는 것이 변경의 핵심 이유이며, `PD-005`와 같은 근거다.

## 5. 포털과 z-index

MUI `Menu`, `Popper`, `Select`의 목록, antd `DatePicker`의 달력, `Dialog`는 전부 **콘텐츠 루트 바깥**으로 렌더링될 수 있다. 따라서 `.pipe-pr-search .something` 형태의 자손 선택자만으로 스타일이 닿는다고 가정하면 안 된다.

지켜야 할 규칙은 다음과 같다.

1. 포털 내용의 스타일은 **컴포넌트 자신의 `sx`나 `slotProps`**로 준다. 전역 선택자로 덮어쓰지 않는다.
2. 포털의 container는 호스트의 정책을 따른다. PIPE가 특정 container를 지정하는 관행이 있으면 그것을 쓴다(`TARGET_VERIFY`).
3. z-index는 호스트 테마의 `zIndex` 척도를 그대로 쓴다. 숫자를 직접 적지 않는다.
4. antd 컴포넌트와 MUI 컴포넌트가 같은 화면에서 겹칠 수 있으므로, 두 라이브러리의 z-index 기준이 어긋나지 않는지 **실제로 겹쳐 놓고** 확인한다(`TARGET_VERIFY`).
5. 스타일시트 삽입 순서를 확인한다. Emotion의 삽입 지점이 antd의 CSS보다 뒤인지 앞인지에 따라 같은 선택자의 승패가 뒤집힌다(`TARGET_VERIFY`).

## 6. 모달의 소유권 규칙

Diff 위에서 Time-lapse를 열 수 있으므로(`SOURCE_VERIFIED`: `SourceDialogs.tsx:89`) 두 모달이 동시에 열린다. 다음을 명시적으로 정한다.

| 항목 | 규칙 |
|---|---|
| `Escape` | **가장 위의 모달만** 닫는다. 아래 모달은 남는다 |
| focus trap | 가장 위의 모달만 활성. 아래 모달은 비활성이 된다 |
| focus 복귀 | 각 모달은 자신을 연 제어로 focus를 돌려준다. Time-lapse는 Diff의 `Time-lapse` 버튼으로, Diff는 `View diff` 버튼으로 |
| body 스크롤 잠금 | 첫 모달이 걸고 **마지막 모달이 닫힐 때** 푼다. 안쪽 모달을 닫는다고 풀리면 안 된다 |
| 배경 클릭 | 가장 위의 모달만 반응한다 |

MUI `Dialog`는 중첩을 기본으로 지원하지만 위 동작이 실제로 그렇게 되는지 확인한다(`TARGET_VERIFY`). 특히 body 스크롤 잠금의 참조 계수가 제대로 동작하는지 본다.

## 7. 디자인 토큰

아래 값은 `PORT_DECISION`의 기본값이다. PIPE 테마와 충돌하면 호환 가능한 최소 조정만 하고 차이표에 남긴다. **이 세션은 PIPE의 실제 색상값과 브랜드 글꼴을 알지 못한다.** 아래에 hex 값이 하나도 없는 것은 그 때문이다.

### 7.1 타이포그래피

| 항목 | 값 | 원본 대비 | 검수 기준 |
|---|---|---|---|
| 페이지 제목 | 20px / 28px, 600 | 원본은 `clamp(20px, 2vw, 27px)`, 650 | 콘텐츠 안에 한 번만. hero 없음 |
| eyebrow | 11px / 16px, 600, 자간 넓힘 | 원본과 같은 자리 | 제목 위 한 줄 |
| 주요 본문 | 14px / 20px | 원본 13px보다 1px 크다 | 편집 필드와 설명의 리듬이 맞는다 |
| 표 데이터 | 13px / 20px | 원본 12px보다 1px 크다 | 주요 내용을 11px 이하로 줄이지 않는다 |
| 표 머리글 | 12px / 16px, 600 | 원본 11px | 데이터보다 작되 읽힌다 |
| 필드 라벨·보조 메타 | 12px / 18px | 원본 12px·10px | 작은 크기를 낮은 대비로 다시 약화하지 않는다 |
| 코드·SHA | 호스트 monospace, 12–13px | 원본 11px | 코드와 식별자에만 쓴다 |
| 숫자 | `font-variant-numeric: tabular-nums` | 원본은 시각 열에만 적용 | PR/M 번호·날짜·diff 수치 전부에 적용한다 |

원본보다 1px씩 키운 이유를 적는다. 원본은 `ReaderShell`의 좁은 콘텐츠 폭에 맞춰 밀도를 높였는데, PIPE의 콘텐츠 폭과 기본 글꼴이 다르고 MUI의 기본 행 높이가 더 크다. 원본 수치를 그대로 옮기면 MUI 제어 사이에서 표만 작아 보인다. **13px 아래로는 내려가지 않는다**는 것이 지켜야 할 하한이다.

### 7.2 간격과 크기

| 항목 | 값 | 비고 |
|---|---|---|
| 간격 단계 | 4 / 8 / 12 / 16 / 24 / 32px | 임의 margin 누적을 막는다 |
| 콘텐츠 내부 여백 | desktop 24px, compact 16px | `self-padded` 모드에서만 |
| 패널 간격 | 24px | 원본과 같다 |
| 좌측 패널 폭 | 260px (1200px 이하에서 220px) | 원본과 같다 |
| 일반 제어 높이 | 40px | 원본 39px. MUI `size="small"`의 40px에 맞춘다 |
| 아이콘 버튼 | 32–36px, 터치 목표 40px 이상 | 시각 크기보다 클릭 영역을 확보한다 |
| 표 머리글 / 행 | 40px / 44–48px | 원본 셀 padding 14px 12px에 해당한다. 제목이 두 줄이면 자연히 늘어난다 |
| 패널 radius | 10px | 원본 12px보다 조금 작다. MUI 기본과 이질감을 줄인다 |
| 제어 radius | 6px | 원본 7px. MUI와 antd의 외형 차이를 줄인다 |
| 테두리 | 1px, divider 계열 | 표·입력·패널의 역할별 강도를 구분한다 |
| 그림자 | 패널에는 거의 쓰지 않고 overlay에만 | 카드 위 카드가 겹친 모습을 만들지 않는다 |
| focus 링 | 2px, offset 2px | 원본은 offset 3px. 촘촘한 표에서 이웃 행을 침범하지 않게 줄인다 |

### 7.3 색 역할

hex 값을 쓰지 않고 호스트 테마의 역할에 연결한다.

| 쓰임 | 테마 역할 |
|---|---|
| 콘텐츠 바탕 | `background.default` |
| 패널·표 바탕 | `background.paper` |
| 주요 글자 | `text.primary` |
| 보조 글자·머리글 | `text.secondary` |
| 비활성 글자 | `text.disabled` |
| 테두리·구분선 | `divider` |
| 강조·링크·활성 정렬 | `primary.main` |
| hover 배경 | `action.hover` |
| 선택·펼친 행 배경 | `action.selected` |
| 오류 | `error.main` |
| 경고(M `unavailable`) | `warning.main` |
| 성공(Merged) | `success.main` |

상태 배지는 **아이콘과 텍스트로** 구분한다. `Merged` / `Open` / `Closed`를 색만으로 구분하지 않는다. PIPE Job의 `SUCCESS` / `FAIL` 배지를 의미까지 재사용하지 않는다. PR의 `Merged`는 Job의 성공이 아니다.

M 배지의 tone 세 가지는 다음으로 대응시킨다.

| 원본 tone | 대응 | 쓰이는 상태 |
|---|---|---|
| `accent` | `primary` 계열, 약한 배경 | `assigned` |
| `neutral` | `divider` 테두리 + `text.secondary` | `pending`, `not_applicable` |
| `warning` | `warning.main` 계열 | `unavailable` |

### 7.4 상태 구분

hover / keyboard focus / expanded·selected / disabled / error를 서로 구별한다.

- 선택된 행과 펼친 행은 `action.selected`로 **약하게** 칠한다. 원본은 `--ui-accent-soft`를 쓴다.
- 오류가 난 행 전체를 붉게 칠하지 않는다. 오류는 해당 영역 안에만 둔다.
- 정렬되지 않은 열의 화살표를 활성 열과 같은 강도로 그리지 않는다. 원본은 비활성 열에도 아래 화살표를 항상 그리므로(`RepositoryWorkspace.tsx:377`) **대비를 낮춰** 구분한다.
- `disabled`는 투명도만으로 표현하지 않는다. `title`이나 helper text로 사유를 함께 말한다(원본이 M 범위 입력에서 하는 방식).

### 7.5 동작(motion)

| 대상 | 시간 |
|---|---|
| hover, focus | 100–120ms |
| Collapse(필터), 행 상세 펼침 | 140–180ms |
| Dialog 등장·퇴장 | 140–180ms |

`prefers-reduced-motion: reduce`에서는 전환을 제거하거나 60ms 이하로 줄인다. 행마다 순차 등장하는 연출, spring, shimmer 반복, 차트 애니메이션은 넣지 않는다. 이 화면은 오래 읽고 반복 조작하는 도구다.

### 7.6 한 화면의 일관성

MUI `Select`와 antd `DatePicker`가 같은 줄에 섞인다. **하나의 compact field wrapper**를 만들어 라벨 간격, 제어 높이, helper text 위치, 오류 표시 위치를 통일한다. wrapper가 다음을 소유한다.

```text
CompactField
  라벨          12px, 아래 간격 7px
  제어 영역     높이 40px 고정, 안쪽 여백 통일
  helper/오류   12px, 높이 예약(18px), 위 간격 4px
```

전역 theme를 덮어쓰지 않는다. `body`에 reset을 다시 적용하지 않는다. 스타일은 `pipe-pr-search` 루트 또는 각 컴포넌트의 `sx`에 가둔다. `ThemeProvider`가 필요하면 **기존 theme를 상속하는 좁은 범위**로만 쓰고 전역 provider를 새로 세우지 않는다.

## 8. 반응형

기준은 브라우저 창이 아니라 **Search에게 실제로 주어진 콘텐츠 폭**이다.

| 콘텐츠 폭 | 구성 |
|---|---|
| 1120px 이상 | 260px 문맥 패널 + gap 24px + 결과 |
| 768–1119px | 문맥 패널을 `Repository & files` 버튼으로 여는 로컬 drawer로 바꾼다. 결과 폭을 우선한다 |
| 768px 미만 | 한 열. 탭은 가로 스크롤. 필터는 세로 한 열. 소스 모달은 전체화면 |

이 drawer는 **Search의 저장소 패널**이지 전역 App Shell의 navigation이 아니다. 결과 열을 영구히 지우지 않는다.

200% 확대, 가로로 긴 파일명, 짧은 viewport에서 주요 제어(Search 버튼, 닫기 버튼, 현재 revision 정보)가 가려지지 않는지 확인한다.

## 9. 상태의 소유자

| 상태 | 소유자 | 원칙 |
|---|---|---|
| 적용된 저장소·브랜치·탭·필터·정렬·경로 | URL(호스트 라우터 + `navigation` 어댑터) | 공유와 새로고침이 된다 |
| 입력 중인 조건(`draft`) | feature의 지역 상태 | 입력할 때마다 검색하거나 URL을 갱신하지 않는다 |
| 결과 페이지·행 상세·트리·source 응답 | PIPE의 기존 React Query client | 계정과 문맥별로 key를 나눈다. Recoil에 중복 저장하지 않는다 |
| Filters 펼침, 행 상세 펼침, 모달 열림 | feature의 지역 상태 | 검색 조건과 섞지 않는다 |
| 비교할 두 revision | history의 지역 상태 | 같은 파일·revision 문맥에서만 유효하다 |
| SHA 두 칸과 확정된 `seqRange` | feature의 지역 상태 | URL에 넣지 않는다(`PD-010`) |
| PIPE 로그인, 공통 theme | 호스트 | Search가 재정의하지 않는다 |
| 검색 identity와 접속 상태 | 주입받는다 | 실제 판정과 발급은 다음 연동 작업이다 |

## 10. 이벤트 전이표

각 행은 그 이벤트에서 **무엇을 보존하고 무엇을 지우는지**를 정한다. 근거는 `RepositoryWorkspace.tsx`의 해당 줄이다.

| 이벤트 | 보존 | 초기화 | 요청 처리 | 근거 |
|---|---|---|---|---|
| `repository changed` | `tab`, `sort`, `order`, `q`, `author`, `label`, `state`, 날짜·PR 범위 | `base`, `path`, `mnum_from`, `mnum_to`, `source_ref`, `path_kind`, `cursor`, `expanded` | 이전 검색·트리 요청을 취소한다. `seqRange`는 공간 불일치로 질의에서 자동으로 빠진다 | `:322`, `:112`, `:147` |
| `base branch changed` | 저장소, 탭, 정렬, 나머지 필터 | `mnum_from`, `mnum_to`(draft와 URL 양쪽), `source_ref`, `path_kind`, `cursor`, `expanded` | 같다. 트리를 새 브랜치로 다시 읽는다 | `:332`, `:112` |
| `tab changed` | 저장소, base, 경로, 모든 필터 값 | `cursor`, `expanded`(`requestKey`가 바뀌므로) | history 탭은 검색 요청 자체를 하지 않는다 | `:336`, `:147`, `:149` |
| `file/folder/root selected` | 모든 필터 | `cursor`, `expanded` | `tab`을 `history`로 바꾸고 `path`, `path_kind`, `source_ref`를 넣는다 | `:333` |
| `filter draft changed` | 적용된 조건 전부 | 없음 | **요청을 보내지 않는다.** URL도 갱신하지 않는다 | `:235`, `:350`, `:353` |
| `Search submitted` | 저장소, 탭, 정렬, 경로 | SHA 두 칸이 비었으면 `seqRange` | SHA 범위가 있으면 먼저 두 번의 `resolve`를 기다린다. 실패하면 **`navigate`를 하지 않는다** | `:255-286` |
| `Reset clicked` | `repository`, `tab`, `sort`, `order`, `source_ref`, `path_kind` | 12개 필터 key, `shaFrom`, `shaTo`, `seqRange`, `rangeType`(→`pr`) | 새 조회가 나간다 | `:370` |
| `sort changed` | 모든 필터, 저장소, 탭 | `cursor`, `expanded` | 서버에 `sort`·`order`를 보낸다. 받은 행을 클라이언트에서 다시 정렬하지 않는다 | `:237`, `:147` |
| `next page requested` | 표시 중인 행 전부, 첫 페이지 facet | 없음 | `cursor`를 실어 보내고 응답을 뒤에 붙인다. `facets=false` | `:164`, `:181` |
| `next page failed` | 표시 중인 행 전부 | 없음 | 오류를 띄우고 **자동 재시도를 멈춘다.** 관측자 콜백이 `error` 동안 무동작이 된다 | `:195-198`, `:210` |
| `refresh requested` | 모든 조건 | `cursor` | 첫 페이지부터 다시 읽는다 | `:372` |
| `PR detail opened` | 표 상태 | 이전에 펼친 행(하나만 열린다) | 해당 행의 상세를 조회한다 | `:390`, `:393` |
| `PR detail closed` | — | `expanded` | 진행 중인 상세 요청을 취소한다 | `:50` |
| `history page loaded` | 고정 revision, 선택한 비교 대상 | 없음 | 2페이지부터는 `sha` 중복을 지우고 뒤에 붙인다 | `SourceHistory.tsx:64` |
| `two revisions selected` | history 목록 | 없음 | 먼저 고른 것이 head다 | `SourceHistory.tsx:72` |
| `Diff opened` | 아래 화면 전부 | — | base/head를 첫 응답으로 고정한다 | `SourceDialogs.tsx:44-48` |
| `Diff closed` | — | 선택 파일, 검색어, swap, 표시 범위 | 진행 중인 파일 조회를 취소한다 | `api.ts:26` |
| `Time-lapse opened` | 아래 화면 전부 | — | History에서 열면 이미 읽은 목록을 쓰고 조회하지 않는다 | `SourceDialogs.tsx:94` |
| `Time-lapse closed` | — | 선택 줄, 분석 결과 | 진행 중인 분석을 `abort`한다 | `SourceDialogs.tsx:101` |
| `URL externally changed` | 지역 상태(모달, 펼침) | — | `draft`를 새 URL 값으로 다시 맞춘다 | `:108` |
| `search identity changed` | 저장소·경로 문맥 | My 탭의 결과 캐시 | 새 identity로 key를 나눈다. 이전 사용자 데이터가 보이면 안 된다 | `PD-001` 범위 밖, `PS-T-036` |
| `component unmounted` | — | 전부 | `window` 리스너 제거, 관측자 disconnect, 모든 요청 취소, body 잠금 해제 | `:305`, `PS-T-040` |

**반드시 지킬 것**: 새 문맥을 요청하는 동안 이전 저장소의 결과를 새 머리글 아래 보여 주지 않는다. 원본은 `loadedKey === requestKey` 비교로 이것을 막는다(`:188-189`). 요청 취소를 지원하지 않는 transport를 쓴다면 **요청 세대(generation) 번호를 비교해** 늦게 도착한 응답을 버리는 방식으로 같은 보호를 만든다.

React Query를 쓸 때의 추가 규칙이다.

- `staleTime`과 자동 refetch를 **query별로** 정한다. 기본 설정의 `refetchOnWindowFocus`가 켜져 있으면, 조사 중인 고정 revision이 조용히 다른 스냅숏으로 바뀔 수 있다.
- cursor 기반 이어 보기는 `useInfiniteQuery`의 `getNextPageParam`으로 **서버가 준 `next_cursor`만** 쓴다. 페이지 번호로 가짜 cursor를 만들지 않는다.
- 이어 보기 실패에 `retry`를 켜지 않는다. 원본의 무자동재시도 규칙(CR-043)을 깨뜨린다.
- 첫 페이지에만 facet을 요청하므로 페이지 파라미터에 `facets` 여부를 넣고, 병합 시 첫 페이지의 facet을 보존한다.

## 11. 예외 상태 매트릭스

| 상태 | 표시 위치 | 가능한 동작 | 해서는 안 되는 일 |
|---|---|---|---|
| 최초 로딩 | 각 패널의 골격(표는 7행) | 다른 PIPE 기능을 계속 쓴다 | 전역 로딩으로 앱을 잠근다 |
| 검색어·범위 오류 | 해당 필드 + 요약 영역 | 고쳐서 다시 검색한다 | 보이지 않는 필드만 오류로 지목한다 |
| 결과 0건 | 결과 영역의 빈 상태 | 조건 수정, Reset | 통신 실패를 0건으로 표시한다 |
| 접근 가능한 저장소 없음 | 문맥 패널 | 안내 | 권한 밖 저장소 이름을 노출한다 |
| 목록 API 실패 | 결과 영역 | 명시적 재시도 | 무한 자동 재요청 |
| 다음 페이지 실패 | 기존 행 + 하단 안내 | `Reload first page` | 이미 보여 준 행을 지우거나 중복 추가한다 |
| 트리만 실패 | 트리 영역 | 트리 재시도 | PR 검색까지 중단한다 |
| 상세만 실패 | 펼친 행 안 | 그 상세만 재시도 | 전체 화면 실패로 확대한다 |
| history의 PR 조회 실패 | history 안내 | 이력 조회는 계속한다 | 연결 없음을 사실로 확정한다 |
| source가 일부·비텍스트·너무 큼 | 모달의 해당 영역 | 사유 설명, 허용된 원문 열기 | 빈 코드를 실제 소스인 것처럼 보인다 |
| M `pending`·키 없음 | 배지 또는 빈 셀 | 사유 확인 | 번호나 링크를 만든다 |
| epoch 무효 | 검색 영역 | 다시 해석하도록 안내 | 옛 번호로 그대로 진행한다 |
| 검색 identity 미제공 | My 탭, 접속 상태 | 외부 callback 또는 안내 | Knox ID 문자열로 사용자를 추정한다 |
| 검색 연결 미설정 | Search 안내 | fixture 경로에서만 demo | 운영 오류에서 자동으로 mock으로 내려간다 |
| 검색 권한·접속 장애 | Search 영역 | 재시도, 외부 연결 안내 | PIPE 전체를 로그아웃시킨다 |
| 복사 실패 | 페이지의 live region | 수동 선택·복사 안내 | 성공 알림을 띄운다 |
