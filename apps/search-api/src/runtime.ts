/**
 * 운영 조립 이음매 (WP-028 post-merge / CR-034, DEV-177).
 *
 * ## 왜 이 파일이 있나
 *
 * `index.ts`는 최상위에서 포트를 열기 때문에 시험이 가져올 수 없다. 그래서
 * "무엇을 만들어 `buildServer`에 넘기는가"가 **어떤 시험에도 걸리지 않는 자리**로
 * 남아 있었고, WP-028의 API-ADM-007이 정확히 그 자리에서 빠졌다 — 함수도 있고
 * 라우트 등록 코드도 있고 통합 시험도 초록이었지만, 운영 프로세스는 그 의존을
 * 넘기지 않아 **배포된 search-api에 두 경로가 아예 없었다.**
 *
 * 조립을 함수로 꺼내면 시험이 운영과 **같은 것**을 부른다. 목을 꽂아 라우트를
 * 세우는 시험은 "라우트가 존재한다"를 증명하지만 "운영이 그것을 세운다"는
 * 증명하지 않는다.
 */

import type { Pool } from '@prs/db';
import type { EventBus } from '@prs/bus';
import type { Client } from '@elastic/elasticsearch';
import { ApiCommitGraph, type GitHubClient } from '@prs/github';
import type { SearchApiConfig } from './config.js';
import type { ServerDeps } from './server.js';
import type { AuthContext } from './auth/context.js';
import type { RegistryDeps } from './ops/repositories.js';
import type { IntegrityDeps } from './ops/sequence-integrity.js';
import type { ReindexDeps } from './ops/reindex.js';
import { indexStatsPort, reindexIndexPort } from '@prs/es';
import { authRepo } from '@prs/db';
import { createCursorSigner } from './cursor/envelope.js';

/** 운영이 자격 증명으로 만든 GHE 접근. 없으면 GHE에 닿는 기능이 서지 않는다. */
export interface RuntimeGitHub {
  readonly client: GitHubClient;
}

export interface SearchDepsLike {
  readonly es: Client;
  readonly resolveNames: (names: {
    readonly orgs: readonly string[];
    readonly teams: readonly string[];
  }) => Promise<{
    readonly orgIds: ReadonlyMap<string, number>;
    // 이름 하나가 팀 여럿을 가리킬 수 있다 (WP-032, PR #57 리뷰 P2).
    readonly teamIds: ReadonlyMap<string, readonly number[]>;
  }>;
  readonly timeoutMs?: number;
}

export interface RuntimeParts {
  readonly config: SearchApiConfig;
  readonly pool: Pool;
  readonly bus: EventBus;
  readonly es: Client;
  /** 운영 로거. `index.ts`가 넘기는 것과 같은 함수다. */
  readonly log: (entry: Record<string, unknown>) => void;
  readonly github?: RuntimeGitHub | undefined;
  readonly registry?: RegistryDeps | undefined;
  readonly auth?: AuthContext | undefined;
  readonly searchDeps?: SearchDepsLike | undefined;
}

/**
 * 정합성 점검 의존 (API-ADM-007).
 *
 * **미러 볼륨을 만들지 않는다.** search-api는 조회 프로세스이고 미러는 워커의
 * 것이다 — 여기에 볼륨을 붙이면 배포 단위가 하나 늘고 디스크 산정이 바뀐다.
 * 대조에 필요한 것은 first-parent 체인 읽기뿐이므로, 이미 만들어 둔 GHE
 * 클라이언트 위에 **읽기 전용 API 그래프**를 얹는다 (ADR-005의 폴백 경로).
 *
 * @returns GHE 자격 증명이 없으면 `undefined`. 그때 API-ADM-007은 서지 않으며,
 * **그 사실을 호출부가 로그로 밝힌다** — 조용히 없는 것이 이 결함의 원인이었다.
 */
export function buildIntegrityDeps(pool: Pool, github: RuntimeGitHub | undefined): IntegrityDeps | undefined {
  if (github === undefined) return undefined;
  const graph = new ApiCommitGraph({ client: github.client, priority: 'realtime' });
  return { pool, graphFor: () => graph };
}

/**
 * 무중단 재색인 의존 (API-ADM-004 / WP-035).
 *
 * Elasticsearch 클라이언트만 있으면 선다 — 대상 버전을 정하는 데 필요한 것이
 * 별칭이 가리키는 인덱스와 실재하는 버전 목록뿐이기 때문이다. GHE 자격 증명은
 * 필요 없다.
 */
export function buildReindexDeps(pool: Pool, es: Client): ReindexDeps {
  return { pool, index: reindexIndexPort(es) };
}

/**
 * 운영 `buildServer` 인자를 만든다. **`index.ts`와 시험이 같은 함수를 쓴다.**
 *
 * 여기서 한 줄이 빠지면 그 기능은 배포에서 사라진다 — 그래서 이 함수가
 * 시험 대상이다.
 */
export function buildServerDeps(parts: RuntimeParts): ServerDeps {
  const integrity = buildIntegrityDeps(parts.pool, parts.github);
  if (integrity === undefined) {
    /*
     * 조용히 숨기지 않는다 (CR-034, DEV-177). 운영자가 `/admin/sequence-integrity`가
     * 404인 이유를 로그에서 읽을 수 있어야 한다.
     */
    parts.log({
      level: 'warn',
      message: 'GHE 자격 증명이 없어 시퀀스 정합성 점검 경로를 등록하지 않는다 (API-ADM-007)',
    });
  }

  return {
    config: parts.config,
    ops: { pool: parts.pool, bus: parts.bus, log: (entry) => { parts.log({ ...entry }); } },
    pipeline: {
      pool: parts.pool,
      bus: parts.bus,
      es: parts.es,
      metricsQueryUrl: parts.config.metricsQueryUrl,
      log: (entry) => { parts.log({ ...entry }); },
    },
    ...(parts.registry === undefined ? {} : { registry: parts.registry }),
    ...(parts.auth === undefined || parts.searchDeps === undefined
      ? {}
      : {
          auth: parts.auth,
          /*
           * 커서 서명과 팀 이름 해석을 **여기서** 붙인다 (CR-034, DEV-177).
           *
           * `index.ts`가 직접 만들면 "무엇을 넘기는가"가 어떤 시험에도 걸리지
           * 않는 자리로 남는다. 서명자가 빠지면 커서가 조용히 사라지고, 그
           * 실패는 오류가 아니라 "결과가 이게 전부"로 보인다.
           */
          search: {
            ...parts.searchDeps,
            // `seq:` 질의의 시퀀스 공간을 확인한다 (CR-051). 없으면 그 질의만
            // 조용히 실패하므로 타입이 필수로 잡는다.
            pool: parts.pool,
            cursorSigner: createCursorSigner(parts.config.searchCursorKey),
            resolveTeamSlugs: (ids: readonly number[]) => authRepo.resolveTeamSlugs(parts.pool, ids),
          },
          sequence: {
            ...parts.searchDeps,
            pool: parts.pool,
            cursorSigner: createCursorSigner(parts.config.searchCursorKey),
            resolveTeamSlugs: (ids: readonly number[]) => authRepo.resolveTeamSlugs(parts.pool, ids),
          },
          /*
           * 저장된 검색 (WP-033 / API-SRCH-005).
           *
           * **Elasticsearch를 받지 않는다.** 이 자원의 정본은 `saved_search`
           * 표이고 순회도 PostgreSQL 키셋이다 — 색인 클라이언트를 넘기면
           * "이미 있으니까"라는 이유로 목록을 색인에서 읽는 최적화가 언젠가
           * 들어온다. 그러면 저장된 검색이 ADR-004의 재구축 대상이 된다.
           *
           * 커서 서명자는 검색·구간과 **같은 키**를 쓴다. 새 시크릿을 만들면
           * 배포가 관리할 값이 늘고, 하나가 빠졌을 때의 실패가 늘어난다.
           */
          savedSearch: {
            pool: parts.pool,
            cursorSigner: createCursorSigner(parts.config.searchCursorKey),
          },
          /*
           * 저장소 수집 진단 (WP-034 / API-ING-002·003, CR-050).
           *
           * **Elasticsearch를 받는다** — 저장된 검색과 다른 점이다. 문서 수는
           * 색인에만 있고, 그 집계도 `applyMandatoryScopeFilter`를 지난다.
           * PostgreSQL에서 이미 접근 범위를 걸렀다는 이유로 생략하지 않는다.
           *
           * 커서 서명자는 검색·구간·저장 검색과 **같은 키**를 쓴다. 새 시크릿을
           * 만들면 배포가 관리할 값이 늘고 하나가 빠졌을 때의 실패가 는다.
           */
          repositories: {
            pool: parts.pool,
            es: parts.es,
            cursorSigner: createCursorSigner(parts.config.searchCursorKey),
            log: (entry) => { parts.log({ ...entry }); },
          },
          /*
           * 원본 아카이브 조회 (WP-036 / API-ADM-008, CR-052).
           *
           * **세션이 있을 때만 선다.** 이 블록 안에 있는 것이 그 뜻이다 —
           * 조회는 역할 제한에 더해 요청자의 접근 범위 필터를 지나야 하는데
           * (AC-6), 이름 붙은 관리 토큰은 접근 범위를 산출할 대상이 없다.
           *
           * `pool`을 받지 않는다. 이 자원의 정본은 `raw_event`(PostgreSQL)지만
           * 조회 대상은 그것으로부터 만들어진 **파생 사본**이고, 두 곳을 함께
           * 넘기면 "정본이 여기 있으니까"라는 이유로 PostgreSQL을 직접 훑는
           * 경로가 언젠가 들어온다. 그 경로에는 ILM도 접근 범위 필터도 없다.
           *
           * 커서 서명자는 검색·구간·저장 검색·저장소 개요와 **같은 키**를 쓴다.
           */
          rawEvents: {
            es: parts.es,
            cursorSigner: createCursorSigner(parts.config.searchCursorKey),
          },
          /*
           * 감사 기록 조회 (WP-039 / API-ADM-005, CR-054).
           *
           * **세션이 있을 때만 선다.** 이 경로는 `security_officer` 전용이고
           * 역할은 세션에만 있다 — 이름 붙은 관리 토큰에는 그 역할이 없으며,
           * 있다고 가정해 열면 감사 평면이 토큰 하나로 열린다.
           *
           * **Elasticsearch를 받지 않는다.** 정본은 `audit_record`이고 순회도
           * PostgreSQL 키셋이다. 색인 클라이언트를 넘기면 "이미 있으니까"라는
           * 이유로 감사를 색인에서 읽는 최적화가 언젠가 들어오고, 그러면 감사
           * 기록이 `ADR-004`의 재구축 대상이 된다 — 재구축 가능한 감사는 감사가
           * 아니다.
           *
           * 커서 서명자는 다른 경로와 **같은 키**를 쓴다.
           */
          audit: {
            pool: parts.pool,
            cursorSigner: createCursorSigner(parts.config.searchCursorKey),
          },
        }),
    ...(integrity === undefined ? {} : { integrity }),
    reindex: buildReindexDeps(parts.pool, parts.es),
    /*
     * 색인 상태 조회 (WP-040 / API-ADM-004 `GET`, CR-055).
     *
     * **세션과 무관하다.** `API-ADM-006`과 같은 갈래의 전역 운영 지표이며 저장소를
     * 식별하지 않으므로 접근 범위를 산출할 대상이 필요 없다 — `reindex`와 같은
     * 자리에 선다.
     */
    indexStatus: { pool: parts.pool, stats: indexStatsPort(parts.es) },
    /*
     * 등록 검토 요청 대기열 (WP-040 / API-ADM-009, CR-055).
     *
     * **커서 서명자는 다른 경로와 같은 키를 쓴다.** 새 시크릿을 만들면 배포가
     * 관리할 값이 늘고 하나가 빠졌을 때의 실패가 는다.
     *
     * `es`를 받지 않는다. 이 자원의 정본은 `repository_registration_request`이고
     * 순회도 PostgreSQL 키셋이다 — 색인 클라이언트를 넘기면 "이미 있으니까"라는
     * 이유로 대기열을 색인에서 읽는 최적화가 언젠가 들어온다.
     */
    requestQueue: {
      pool: parts.pool,
      cursorSigner: createCursorSigner(parts.config.searchCursorKey),
      log: (entry) => { parts.log({ ...entry }); },
    },
    log: (entry) => { parts.log({ ...entry }); },
  };
}

/** 기동 로그·헬스에 실을 기능 가용성. 없는 것을 없다고 말하기 위한 값이다. */
export function runtimeCapabilities(parts: RuntimeParts): Readonly<Record<string, boolean>> {
  return {
    repository_registry: parts.registry !== undefined,
    session_auth: parts.auth !== undefined,
    sequence_integrity: buildIntegrityDeps(parts.pool, parts.github) !== undefined,
    /** 저장소 수집 진단은 세션이 있어야 선다 — 접근 범위 없이 낼 수 없다. */
    repository_overview: parts.auth !== undefined && parts.searchDeps !== undefined,
    /** 원본 아카이브 조회도 같다 (FR-ING-010 AC-6). 토큰만으로는 서지 않는다. */
    raw_event_archive: parts.auth !== undefined && parts.searchDeps !== undefined,
    /** 감사 기록 조회는 `security_officer` 역할이 필요하고 역할은 세션에만 있다. */
    audit_records: parts.auth !== undefined && parts.searchDeps !== undefined,
    reindex: true,
    /** 색인 상태 조회는 재색인과 같은 자리에 선다 (API-ADM-004 `GET`). */
    index_status: true,
    /** 등록 검토 요청 대기열. 커서 서명 키는 다른 경로와 같은 값이다. */
    registration_request_queue: true,
  };
}
