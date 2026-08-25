#hidden
# aci:v1 id=f7b39dc src=agent-context/risks.md
@kv sha256=fbfba7ae18be0330d398a7f85dfa87aa3d531ad5f5a55eab4f5eec95baa29b1c bytes=9933 lines=181 title=리스크-불확실한-가정-함정
@sig agent-context/risks.md;HOME/.nvm/versions/node/v22.23.2/bin;regression/runtime-reachability.test.ts;repos/89sooner/pr-search/pulls/;exports/202608260047.md;DISTINCT;pull_request_number;NOT;NULL;expected;Node;e2e;Codex;v20;install;visitor;engines;v22;a11y;require;ESM;PATH;HOME;versions
@h1 리스크 · 불확실한 가정 · 함정
@h2 절차 함정 (이 세션에서 실제로 밟은 것들)
@h3 등가 변이를 킬로 착각하지 마라 — 두 WP 연속으로 나왔다
@path WP-026 M3: "직전 대비 PR 수"에 count(DISTINCT pull_request_number)와
@p WHERE pull_request_number IS NOT NULL이 함께 있어, 각각을 지우는 변이가 둘 다 살아남았다 (count(DISTINCT col)은 NULL을 세지 않는다). 둘을 함께 지운 변이가 expected 3 to be 2로 킬됐다.
@todo WP-027 M3: if (next && phase === 'idle') load()에서 next &&만 떼는
@p 변이가 살아남았다 — 접는 시점에는 이미 조회가 끝나 idle이 아니다. 마운트 조회로 바꾸자 여섯 시험이 잡았다.
@p → 변이를 걸었으면 답이 실제로 달라지는지 먼저 확인한다. 살아남았을 때 "시험 구멍"이라고 결론 내리기 전에 "등가 변이인가"를 의심한다.
@h3 lint는 마지막 파일을 쓴 뒤에 다시 돌려라
@path WP-027 백엔드에서 라우트 등록 직후 pnpm lint를 돌리고 통합 시험 파일은 그
@p 뒤에 썼다. 그래서 커밋 메시지의 "lint 통과"가 그 파일을 본 적 없는 결과였고, 미사용 import(vi)가 커밋에 들어갔다. Node 22로 옮겨 전 계층을 다시 돌릴 때 드러났다.
@h3 대역(mock)이 실제보다 관대하면 그만큼이 사각지대다
@p e2e 앵커 대역이 무엇을 주든 해석해 줬다. 그래서 "맨 숫자 앵커" 결함(Codex P1)이 CI 초록을 받았다. 지금은 대역이 서버와 같은 갈래로 판정한다(맨 숫자· seq:0은 400). 새 대역을 쓸 때 같은 질문을 하라: 이 대역이 틀린 입력을 받아 주지는 않는가?
@h3 임시 컨테이너에서는 슬라이스마다 커밋하라
@path 직전 웹 세션이 CR-030 캐스케이드를 커밋하지 않고 끝나 전부 유실됐다.
@h3 draft → ready 전환이 Codex 리뷰를 부른다
@path PR #32에서 지적 3건(P1 하나·P2 둘)이 왔고 전부 실결함이었다. 리뷰가 오면
@p 먼저 실측으로 검증하고(3건 모두 코드를 읽어 확인했다), 수정마다 결함 재적용 으로 킬을 확인한 뒤, 원장의 해당 WP 검증 장에 리뷰 라운드 표를 남긴다 (6.24장·6.26장이 형식 선례).
@h2 환경 리스크
@h3 Node 버전이 셋으로 갈린다
@p | 버전 | 상태 | | --- | --- | | v20.12.0 (셸 기본값) | pnpm install 거부 — eslint-visitor-keys@5.0.1이 ^20.19.0 \|\| ^22.13.0 \|\| >=24 요구 | | v20.19.6 | ... y 설정 로드 실패 (require(ESM) 미지원) | | v22.23.2 | 정상. .nvmrc(22)·CI와 같은 메이저 |
@p 전역 기본값은 바꾸지 않았다(사용자의 다른 프로젝트 영향). 명령마다
@path export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH가 필요하다.
@h3 백킹 서비스는 세션 시작 시 부분적으로만 준비돼 있었다
@b prs_test DB가 없어서 통합 시험이 전부 실패했다 → 생성함
@b 개발 DB prs에 마이그레이션이 없었다 → 8종 적용함
@b Playwright가 요구하는 chromium 빌드(1200)가 없었다 → 설치함
@b 컨테이너 3종은 3일째 healthy였다
@p 이전 세션들에서 PG·Redis가 죽어 재기동한 기록이 있으니, 통합 시험이 갑자기 연결 오류를 내면 docker ps부터 본다.
@h2 설계상 주의할 점
@b unknown 시퀀스 공간 상태는 이미 뜻이 있다 — "채번된 적 없는 브랜치"
@path (API-SEQ-006, C-027, W-004). WP-028이 여기에 "점검 실패"를 얹으면 이미 선
@p 화면이 거짓을 말한다. todos.md 0번 참조.
@path indexed: false 규칙(DEV-130)은 이제 세 곳에 있다 — 범위 결과, 릴리스
@p 타임라인, 선행·후행. 새 목록을 만들 때 같은 질문을 하라: 정본에는 있는데 색인에 없는 항목을 행으로 남기는가?
@path 에폭은 비교이지 쓰기가 아니다 — W-004·W-002 모두 불일치 시 경고만 내고
@p 자동 재조회하지 않는다. 새 화면도 같은 규칙을 따른다.
@b git add -A 주의 — agent-context/가 .gitignore에 없다.
@h2 검증되지 않은 것 (NOT RUN)
@b 실제 GHE 대상 smoke, OIDC 실연동 — 사내망 전제라 이 환경에서 돌지 않는다.
@p 목 서버 계약 시험 + 실 PostgreSQL·Redis·Elasticsearch로 대체하고 있다.
@p ---
@h1 2026-08-25 후반 세션이 추가한 것
@h2 가장 큰 함정 — 시험이 초록인데 운영이 부르지 않는다
@path WP-028은 API도 러너도 스윕도 만들어 놓고 배포에서 하나도 실행되지 않는 상태로
@p 원장에 done이 기록돼 있었다. 격리된 함수 시험은 전부 통과했다.
@b 통합 시험이 buildServer에 목을 직접 꽂아 라우트를 세웠다 — 그것은 "라우트가
@p 존재한다"를 증명하지 "운영이 그것을 세운다"를 증명하지 않는다
@b startReconcileSweeper는 정의만 되고 부르는 곳이 없었다
@b sequence_reassign 잡을 집는 러너가 없어 행이 영구 queued로 남았고,
@p job_active_uk 때문에 이후 요청이 전부 거절됐다
@risk 대응: regression/runtime-reachability.test.ts — 선언 → 기동 → 종료 →
@p manifest가 한 줄로 이어지는지만 묻는 계층을 세웠다.
@h2 그 회귀 시험조차 첫 형태는 통과했다
@p expect(WORKER_INDEX).toContain('startReconcileSweeper')로 썼더니 호출을 지워도 import 줄이 남아 통과했다. 변이 셋(M2·M3·M5)이 살아남는 것을 보고 reconcileSweeper = startReconcileSweeper(처럼 호출 형태로 고쳤다.
@path → WP-028의 N5와 같은 교훈이 다시 나왔다: 변이가 죽었다고 시험이 그 자리를
@p 지키는 것은 아니고, 살아남았을 때가 시험을 고칠 때다.
@h2 머지 뒤에 리뷰가 온다 — 머지 직후 반드시 다시 확인
@path 이 세션에서 다섯 번 겪었다. PR #35는 머지(08:52:03Z) 1분 뒤(08:53:18Z)에
@p 리뷰가 도착해, 머지 직전에 확인했을 때는 0건이었다.
@code lang=bash sha=c4cdec2a5321 lines=3 kept=3
|gh api repos/89sooner/pr-search/pulls/<N>/comments --jq 'length'
|gh api graphql -f query='{ repository(owner:"89sooner",name:"pr-search"){ pullRequest(number:N){
|  reviewThreads(first:20){ nodes{ id isResolved isOutdated path line } } } } }'
@p 머지된 PR의 지적은 같은 PR에 밀어 넣을 수 없다 — 후속 CR로 정정하고 원장의 해당 WP 검증 장에 X.Y.1 머지 후 리뷰 라운드 절을 만든다(6.27.1·6.28.1·6.30.1이 선례).
@h2 접근 범위에서 "각자 구현"은 유출이다
@path WP-068에서 등록 경로(search-api)와 팀 웹훅 경로(pipeline-worker)가 같은 동기화를
@p 하는데 앱은 서로를 가져올 수 없다(lint:deps). 각자 구현했더니 웹훅 쪽만 정본의 옛 값을 되써서 팀에서 회수된 구성원이 문서를 계속 보는 유출이 났다.
@p → 공유 판정은 패키지로 올린다. 색인 클라이언트처럼 무거운 의존은 포트로 받아 패키지가 그 타입에 묶이지 않게 한다(scope-source.ts 선례).
@h2 부분 성공을 성공으로 처리하면 재시도 경로가 사라진다
@p setAllowedTeams(정본)가 성공하고 applyRepositoryTeams(색인)가 실패했을 때 catch로 넘기면, 다음 동기화는 GHE가 같은 답을 주므로 "바뀐 것 없음"으로 판단해 건너뛴다. 회수된 팀이 색인에 영원히 남는다.
@p → 정본을 되돌려 다음 회차가 같은 차이를 다시 보게 한다.
@h2 소급 대상 목록을 다른 기능에서 빌려 오지 마라
@p applyRepositoryTeams가 markRepositoryArchived의 ARCHIVABLE_ALIASES(두 색인)를 재사용했는데, repository_archived는 둘에만 있고 allowed_team_ids는 네 매핑이 모두 선언한다. 둘만 소급하면 관계·릴리스 문서가 옛 권한을 들고 남는다.
@h2 문서 상태를 한 곳만 고치면 모순이 남는다
@p 원장의 WP 상태를 done으로 바꾸면서 pr_search_work_packages.md의 순서표와 DoD 체크박스를 그대로 두었다. 후속 에이전트가 작업 패키지 문서를 기준으로 판단하면 재작업하게 된다. 미해결 항목이다 (todos.md 0번).
@h2 환경 (변경 없음, 재확인)
@b Node v22.23.2 필수. 셸 기본값 v20.12.0으로는 pnpm install이 거부된다
@b 컨테이너 3종(prs-postgres/redis/elasticsearch) healthy, prs·prs_test DB 존재
@b 마이그레이션은 이 세션에서 009·010·011을 추가 적용했다
@p ---
@h1 2026-08-26 인계 검증 세션이 추가한 것
@h2 컨텍스트 파일 자체가 커밋되지 않은 채 인계된다
@p 직전 세션이 agent-context/*.md 7개와 _handoff/ 전체를 쓰고 커밋 없이 끝냈다. 위 4번("임시 컨테이너에서는 슬라이스마다 커밋하라")이 경고하는 바로 그 상황인데, 경고문을 담은 파일이 거기 걸려 있다.
@p → 인계받은 에이전트는 코드 작업 전에 이 변경분을 커밋할지 먼저 정하라. 단 git add -A는 쓰지 마라 — exports/는 무시되지만 다른 미추적 산출물이 함께 들어갈 수 있다. 경로를 지목해 stage 한다.
@h2 기록된 파일 위치를 그대로 믿지 마라
@p session-notes.md와 todos.md가 전사를 "저장소 루트"에 있다고 적었지만 실제
@path 위치는 exports/202608260047.md였고 그 디렉터리는 .gitignore 대상이다. 그래서
@p "커밋에 딸려 들어갈 수 있다"는 경고까지 통째로 잘못된 근거 위에 있었다.
@p → 컨텍스트 문서의 경로 주장은 인계 시점에 ls로 확인한다. 비용이 거의 없고, 틀린 경로는 그것을 근거로 세운 판단까지 함께 틀리게 만든다.
