# PIPE Search 포팅 — 1차 Claude 작업 지시서

## 지금 전달할 대상

이 묶음은 pr-search 저장소에 연결된 Claude에게 전달하는 첫 번째 작업 지시서다. PIPE 프런트엔드 구현물이나 완성된 API 연동 명세가 아니다.

`PR_SEARCH_TO_PIPE_STAGE1_CLAUDE_PROMPT.md`를 첨부하고 `START_STAGE1.txt`의 내용을 입력한다. 이 문서에는 PIPE 제공 스택, 기능 범위, 콘텐츠 전용 와이어프레임, 디자인 품질 기준, 조사 파일, 데이터·상태 계약의 추출 지시가 들어 있다. 이전 대화 전체를 함께 전달할 필요는 없다.

## 두 세션의 역할

| 세션 | 입력 | 해야 할 일 | 하지 않을 일 |
|---|---|---|---|
| 1차: pr-search 담당 | 이 지시서 + pr-search 코드 | 현재 Search를 분석해 PIPE용 자체 완결형 구현 명세 묶음 작성 | 원본 운영 코드 변경, UI 구현, 인증 연동 |
| 2차: PIPE 담당 | 1차가 만든 명세 묶음 + PIPE 코드 | 실제 버전·테마 확인 후 Search 콘텐츠 구현·fixture 검증 | 새 App Shell·로그인·검색 서버 구현 |

## 1차에서 돌려받아야 할 핵심 결과

핵심 파일은 `PIPE_SEARCH_IMPLEMENTATION_PROMPT.md`다. 그 파일과 API/디자인/동등성 명세, 필요한 순수 로직 참조, 합성 fixture를 묶어 2차 Claude에게 전달한다. 1차 보고서의 요약문만 전달하면 계약·예외 상태가 누락될 수 있다.

1차는 실제 source SHA·심벌·줄 범위와 동작을 근거로 명세를 채워야 한다. 현재 지시서가 모든 API DTO를 검증 완료한 자료라고 오인해서 그대로 재출력하면 안 된다.

## 범위

App Shell을 제외한 Search 콘텐츠가 대상이다. 저장소·파일 패널, 검색 탭·조건·표·행 상세, 파일 이력·Diff·Time-lapse는 포함한다. 로고·전역 헤더·메뉴·로그인·전역 테마 토글과 Regression·MDVP·Job 실행은 제외한다.

MUI 7.1 중심으로 기존 PIPE 디자인 시스템을 사용한다. Ant Design 4.20은 기존 wrapper 재사용을 우선하고, RSuite 4.10은 새 표에 추가 혼용하지 않는다. React/Router/React Query/Axios와 실제 minor 버전은 PIPE에서 확인한다. 참조 사이트의 미감을 위해 shadcn·Tailwind·Radix 등의 새 스택을 설치하는 지시가 아니다.

## API 작업과의 경계

이번에는 UI에서 사용할 데이터 포트와 raw 응답 계약, 합성 fixture까지만 준비한다. 실제 API 접근·사용자별 인증·검색 권한 연결은 별도 후속 작업이다. 운영 서비스 오류에 자동으로 mock을 보여주거나, 인증을 꺼서 연결 완료처럼 처리하지 않는다.

## 파일

- `PR_SEARCH_TO_PIPE_STAGE1_CLAUDE_PROMPT.md`: 1차 Claude에게 전달할 전체 지시서.
- `START_STAGE1.txt`: 첨부와 함께 입력할 시작 문구.
- `README.md`: 전달 순서와 범위.

문서 작성일: 2026-09-20.
