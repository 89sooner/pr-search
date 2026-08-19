# PR Search

GitHub Enterprise의 PR·커밋을 수집해 **커밋 SHA ↔ PR 양방향 검색**과 **Perforce Changelist를 대체하는 머지 시퀀스**를 제공하는 사내 읽기 전용 검색·분석 대시보드다.

설계 문서가 진실이다. 코드를 읽기 전에 `docs/20_derived_ui_specs/pr_search_ai_agent_execution_brief.md`를 먼저 읽는다.

## 저장소 구조

```
docs/                     설계 문서 (SRS → 파생 UI → 아키텍처 → 딜리버리)
packages/
  domain/                 도메인 타입, 관계 어휘, 상수        @prs/domain
  contracts/              API DTO와 오류 코드                 @prs/contracts
  query/                  구조화 질의 파서와 AST              @prs/query   (WP-025)
  es/                     Elasticsearch 매핑과 질의 빌더      @prs/es      (WP-003)
  db/                     PostgreSQL 리포지터리 계층          @prs/db      (WP-002)
  github/                 GHE REST 클라이언트                 @prs/github  (WP-006)
  bus/                    EventBus 포트와 Redis Streams       @prs/bus     (WP-005)
apps/
  ingest-gateway/         웹훅 수신 (Fastify)                 (WP-004)
  pipeline-worker/        보강·투영·채번·관계 파생 (순수 Node) (WP-007~)
  search-api/             조회 API (Fastify)                  (WP-021)
  web/                    대시보드 (Next.js App Router)       (WP-019~)
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
pnpm dev                 # 전 앱 개발 서버
```

전체 명령 목록은 `docs/30_technical_architecture/pr_search_infrastructure_operations.md` 8장이 원본이다.

## 검증

```bash
pnpm typecheck && pnpm lint && pnpm lint:deps && pnpm test && pnpm build
```

CI(`.github/workflows/ci.yml`)가 같은 순서로 돈다.

각 앱은 `GET /healthz`를 노출한다 — `web` 3000, `ingest-gateway` 3001, `search-api` 3002, `pipeline-worker` 3003.

## 작업 방식

- 구현은 `docs/40_delivery/pr_search_work_packages.md`의 WP 단위로 진행하고 각 WP의 제외 목록을 지킨다.
- 커밋/PR에 ID를 남긴다: `Refs: WP-001 NFR-008`.
- WP 완료마다 `docs/40_delivery/pr_search_implementation_traceability.md`를 갱신한다.
- 문서와 코드가 어긋나면 원장에 `DEV-###`를 등록한다. 조용히 코드만 바꾸지 않는다.
