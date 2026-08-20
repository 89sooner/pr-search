# PR Search

GitHub Enterprise를 위한 사내 도구다. 두 가지 일을 한다.

- **PR·커밋 검색과 조사** — PR·커밋을 수집해 **커밋 SHA ↔ PR 양방향 검색**과 **Perforce Changelist를 대체하는 머지 시퀀스**를 제공한다
- **GitHub 운영 콘솔** — `gh` CLI가 지원하는 GitHub 작업을 웹에서 구성·실행한다 (CR-005)

두 축은 아키텍처·인증·감사에서 분리되어 있다 (ADR-013). 조사 쪽은 읽기 전용 파생 시스템이고, 운영 쪽은 사용자가 명시적으로 요청한 작업만 사용자 위임 자격 증명으로 실행한다.

설계 문서가 진실이다. 코드를 읽기 전에 `docs/20_derived_ui_specs/pr_search_ai_agent_execution_brief.md`를 먼저 읽는다.

## 저장소 구조

```
docs/                     설계 문서 (SRS → 파생 UI → 아키텍처 → 딜리버리)
packages/
  domain/                 도메인 타입, 관계 어휘, 상수        @prs/domain
  contracts/              API DTO와 오류 코드                 @prs/contracts
  query/                  구조화 질의 파서와 AST              @prs/query   (WP-025)
  es/                     Elasticsearch 매핑과 접근 범위 경계  @prs/es
  db/                     PostgreSQL 리포지터리 계층          @prs/db      (WP-002)
  github/                 GHE REST 클라이언트                 @prs/github  (WP-006)
  bus/                    EventBus 포트와 Redis Streams       @prs/bus     (WP-005)
  gh-cli/                 gh capability 모델과 argv 조립      @prs/gh-cli  (WP-045)
apps/
  ingest-gateway/         웹훅 수신 (Fastify)                 (WP-004)
  pipeline-worker/        보강·투영·채번·관계 파생 (순수 Node) (WP-007~)
  search-api/             조회 API (Fastify)                  (WP-021)
  web/                    대시보드 (Next.js App Router)       (WP-019~)
  gh-executor/            격리된 gh 실행기                    (WP-047)
```

## 의존 방향

허용 방향은 `domain → 나머지 패키지 → apps` 한 방향뿐이다. `pnpm lint:deps`가 강제하며 위반 시 종료 코드 1로 실패한다.

- `@prs/domain`은 워크스페이스 내부 의존을 갖지 않는다.
- `packages/*`는 `@prs/domain`과 다른 `packages/*`만 의존한다. 앱은 의존할 수 없다.
- `apps/*`는 어떤 패키지든 의존하되 다른 앱은 의존하지 않는다.
- 그래프에 순환이 없어야 한다.

## 개발

전제: Node 20+, pnpm 10+, Docker.

```bash
pnpm install
docker compose up -d     # PostgreSQL 16 / Elasticsearch 8.x / Redis 7
pnpm db:migrate          # 스키마 적용
pnpm db:seed             # 개발용 합성 시드
pnpm es:apply-mappings   # ES 인덱스 4종 + 별칭
pnpm dev                 # 전 앱 개발 서버
```

전체 명령 목록은 `docs/30_technical_architecture/pr_search_infrastructure_operations.md` 8장이 원본이다.

## 검증

```bash
pnpm typecheck && pnpm lint && pnpm lint:deps && pnpm test && pnpm build
pnpm test:integration    # 실제 PostgreSQL·Elasticsearch 필요
```

`pnpm test`는 백킹 서비스 없이 돌고, `pnpm test:integration`은 실제 PostgreSQL·Elasticsearch에 붙는다. 접속 정보는 `DATABASE_URL`/`POSTGRES_*`와 `ELASTICSEARCH_NODE` 환경 변수에서 읽으며 DB 테스트는 `POSTGRES_TEST_DB`(기본 `prs_test`)를 쓴다.

CI(`.github/workflows/ci.yml`)가 같은 순서로 돈다.

각 앱은 `GET /healthz`를 노출한다 — `web` 3000, `ingest-gateway` 3001, `search-api` 3002, `pipeline-worker` 3003.

## 작업 방식

- 구현은 `docs/40_delivery/pr_search_work_packages.md`의 WP 단위로 진행하고 각 WP의 제외 목록을 지킨다.
- 커밋/PR에 ID를 남긴다: `Refs: WP-001 NFR-008`.
- WP 완료마다 `docs/40_delivery/pr_search_implementation_traceability.md`를 갱신한다.
- 문서와 코드가 어긋나면 원장에 `DEV-###`를 등록한다. 조용히 코드만 바꾸지 않는다.
