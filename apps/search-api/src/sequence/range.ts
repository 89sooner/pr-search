/**
 * 시퀀스 범위 조회 (API-SEQ-001, FR-SEQ-002).
 *
 * ## 어디서 읽는가가 이 파일의 전부다 (CR-027, DEV-130)
 *
 * **구간에 무엇이 속하는지는 PostgreSQL `merge_sequence`가 답한다.** 그 표가
 * first-parent walk의 결과 그 자체이고, `git log --first-parent A..B`와 대조 검증이
 * 성립하는 유일한 출처다 (ADR-007).
 *
 * Elasticsearch로 `range(merge_seq)`를 걸어도 결과는 나온다 — 그것이 이 결함의
 * 성질이다. 채번은 PostgreSQL을 먼저 커밋하고 뒤에 색인에 비추므로, 비추기가
 * 실패하면 서수가 붙지 않은 문서가 남고 **그 구간은 오류 없이 항목이 빠진 채**
 * 돌아온다. 범위 인용이 조용히 틀리는 것은 이 제품이 막으려는 실패 그 자체다.
 *
 * 그래서 역할이 갈린다:
 *
 * | 무엇 | 어디서 | 왜 |
 * | --- | --- | --- |
 * | 멤버십·순서·건수 | PostgreSQL | 정본이고 git과 대조 가능하다 |
 * | 제목·작성자·변경량·경로 | Elasticsearch | 정본에 없는 표시용 값이다 |
 * | `q` 필터 | Elasticsearch | 질의 문법이 색인 위에서만 평가된다 |
 *
 * 그리고 **정본에는 있는데 색인에 없는 항목은 버리지 않는다.** 목록에
 * `indexed: false`로 남기고 `items_missing_in_index`로 센다 — 덜 채워진 결과와
 * 완전한 결과를 응답만 보고 가를 수 있어야 한다.
 */

import { mergeSequenceRepo } from '@prs/db';
import type { MergeSequenceRow, Pool } from '@prs/db';
import {
  applyMandatoryScopeFilter,
  assertNoShardFailures,
  buildQuery,
  collectNames,
  multiSearch,
  search,
  type AccessScope,
  type NameResolution,
  type UnresolvedName,
} from '@prs/es';
import { serializeQuery, type QueryAst } from '@prs/query';
import type { Client } from '@elastic/elasticsearch';
import type { estypes } from '@elastic/elasticsearch';
import type { CursorSigner } from '../cursor/envelope.js';
import {
  RANGE_FACET_AXES,
  computeFacets,
  type FacetOutcome,
  type TeamSlugResolver,
} from '../search/facets.js';
import {
  computeRangeFingerprint,
  decodeRangeCursor,
  encodeRangeCursor,
  type RangeCursorAnchor,
} from './range-cursor.js';
import type { ResolvedSpace } from './space.js';

/** FR-SEQ-002 AC-4의 상한. 이 수를 넘으면 조회하지 않고 400이다. */
export const RANGE_LIMIT = 50_000;

/** API 계약: `size` 기본 50, 최대 200. 목록과 같은 상한을 쓴다. */
export const DEFAULT_RANGE_SIZE = 50;
export const MAX_RANGE_SIZE = 200;

/** 변경 경로 상위 N (FR-SEQ-002 AC-2). */
export const TOP_PATHS = 20;

/**
 * 정본 구간을 읽는 한 번의 크기 (WP-032, CR-043).
 *
 * **구간 전체를 메모리에 올리지 않는다.** 구간은 5만 건까지 허용되므로 한 번에
 * 읽으면 응답 하나가 그 전부를 든다. 반대로 너무 작으면 일치가 드문 구간에서
 * 왕복이 폭증한다 — 300이면 5만 건 최악에도 167회이고, 그 최악은 "일치가
 * 거의 없는 5만 건 구간을 끝까지 훑는" 경우다.
 *
 * 상한이 이미 5만이므로 전체 스캔의 최악은 **유계**다. 일치가 적다는 이유로
 * 순회를 중간에서 끝내지 않는다 (FR-SEQ-002 AC-6).
 */
export const RANGE_SCAN_CHUNK = 300;

export function clampRangeSize(raw: unknown): number {
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_RANGE_SIZE;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_RANGE_SIZE;
  return Math.min(parsed, MAX_RANGE_SIZE);
}

export interface RangeItem {
  readonly merge_seq: number;
  readonly kind: 'pull_request' | 'commit';
  readonly pr_number?: number;
  readonly commit_sha: string;
  readonly title: string | null;
  readonly author: string | null;
  readonly merged_at: string | null;
  readonly changed_files_count: number | null;
  readonly additions: number | null;
  readonly deletions: number | null;
  /**
   * 이 항목의 문서가 색인에 있는가 (CR-027, DEV-130).
   *
   * `false`면 서수·SHA·PR 번호는 정본에서 나온 확정값이고 나머지는 아직 모른다.
   * **`null`과 뜻이 다르다** — `null`은 "그 문서에 그 값이 없다"이고 이것은
   * "그 문서를 아직 못 찾았다"이다.
   */
  readonly indexed: boolean;
  readonly url: string | null;
}

export interface RangeSummary {
  readonly pull_request_count: number;
  readonly commit_count: number;
  readonly distinct_author_count: number;
  readonly changed_files_total: number;
  readonly additions_total: number;
  readonly deletions_total: number;
  readonly files_truncated_pull_request_count: number;
  /**
   * 구간에 포함된 PR 중 현재 되돌려진 것의 수 (FR-SEQ-002 AC-2, CR-041 / DEV-239).
   *
   * **WP-030 전에는 이 키가 없었다.** 되돌림 파생이 서기 전에는 `is_reverted`가
   * 투영이 넣은 `false`뿐이라 세면 언제나 `0`이고, 그 `0`은 "되돌림이 없다"와
   * 구분되지 않았다 (CR-027, DEV-133). 이제 그 필드를 실제로 쓰는 워커가 있으므로
   * `0`이 사실 주장이 된다.
   */
  readonly reverted_pull_request_count: number;
  readonly top_changed_paths: readonly { readonly path: string; readonly count: number }[];
}

export interface RangeResult {
  readonly summary: RangeSummary;
  readonly items: readonly RangeItem[];
  readonly items_missing_in_index: number;
  readonly unresolved: readonly UnresolvedName[];
  /** 다음 페이지 커서. 구간 끝까지 검사했으면 `null`이다 (FR-SEQ-002 AC-6). */
  readonly nextCursor: string | null;
  /** 패싯. 요청하지 않았으면 `null`. */
  readonly facets: FacetOutcome | null;
}

export interface RangeRequest {
  readonly space: ResolvedSpace;
  readonly scope: AccessScope;
  readonly fromExclusive: number;
  readonly toInclusive: number;
  readonly size: number;
  /** `q`가 없으면 `null`. `match_all`을 넘기는 것과 구분한다 — 아래 주석 참고. */
  readonly ast: QueryAst | null;
  /**
   * 구간의 first-parent 커밋 수. `guardRange`가 이미 정확히 센 값이다.
   *
   * 다시 세지 않는 이유는 두 번 세면 그 사이에 채번이 끼어들 수 있어서다 —
   * 상한 검사를 통과한 수와 응답에 실리는 수가 달라지면 어느 쪽이 맞는지 알 수
   * 없다.
   */
  readonly rangeTotal: number;
  /** `app_user.access_scope_version`. 커서 지문의 재료다 (WP-032). */
  readonly scopeVersion: number;
  /** 이어 보기 커서. 첫 페이지면 `null`. */
  readonly cursor: string | null;
  /** 패싯을 함께 셀 것인가. */
  readonly facets: boolean;
}

export interface RangeDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly resolveNames: (names: {
    readonly orgs: readonly string[];
    readonly teams: readonly string[];
  }) => Promise<NameResolution>;
  readonly timeoutMs?: number;
  /** 커서 서명 (WP-032). 없으면 커서를 발급하지 않는 것이 아니라 던진다. */
  readonly cursorSigner: CursorSigner;
  /** 팀 ID → slug 일괄 해석 (DEV-281). */
  readonly resolveTeamSlugs?: TeamSlugResolver;
  readonly facetBudgetMs?: number;
  /** 정본 스캔 chunk 크기. 시험이 DEV-287의 반례를 재현할 때 줄인다. */
  readonly chunkSize?: number;
  readonly now?: () => number;
}

/** 구간 크기 검증의 결과. 조회를 시작하기 전에 끝난다. */
export type RangeGuard =
  | { readonly kind: 'ok'; readonly total: number }
  | { readonly kind: 'inverted' }
  | { readonly kind: 'too_large'; readonly total: number };

/**
 * 조회 전에 구간을 검사한다 (AC-3, AC-4).
 *
 * **역전을 먼저 본다.** `from > to`면 건수는 언제나 0이라, 순서를 뒤집으면
 * "0건이니 통과"가 되어 사용자가 받는 것은 빈 목록이다 — 오타를 정답처럼
 * 돌려주는 셈이다.
 *
 * 건수는 추정이 아니라 정확한 값이다 (DEV-140). 정본이 PostgreSQL이므로
 * `count(*)`가 기본 키 범위 스캔 한 번이다.
 */
export async function guardRange(
  pool: Pool,
  space: ResolvedSpace,
  fromExclusive: number,
  toInclusive: number,
): Promise<RangeGuard> {
  if (fromExclusive > toInclusive) return { kind: 'inverted' };

  const total = await mergeSequenceRepo.countRange(
    pool,
    space.repositoryId,
    space.baseBranch,
    space.seqEpoch,
    fromExclusive,
    toInclusive,
  );
  if (total > RANGE_LIMIT) return { kind: 'too_large', total };
  return { kind: 'ok', total };
}

/** 색인에서 꺼내는 표시용 필드. 정본이 주지 않는 것만 담는다. */
interface PullRequestSource {
  readonly pr_number?: number;
  readonly title?: string;
  readonly author?: string;
  readonly merged_at?: string;
  readonly changed_files_count?: number;
  readonly additions?: number;
  readonly deletions?: number;
}

interface SummaryAggregations {
  readonly distinct_authors?: { readonly value: number };
  readonly changed_files?: { readonly value: number | null };
  readonly additions?: { readonly value: number | null };
  readonly deletions?: { readonly value: number | null };
  readonly files_truncated?: { readonly doc_count: number };
  readonly reverted?: { readonly doc_count: number };
  readonly top_paths?: { readonly buckets: readonly { readonly key: string; readonly doc_count: number }[] };
}

const EMPTY_SUMMARY_AGGS: RangeSummary = {
  pull_request_count: 0,
  commit_count: 0,
  distinct_author_count: 0,
  changed_files_total: 0,
  additions_total: 0,
  deletions_total: 0,
  files_truncated_pull_request_count: 0,
  reverted_pull_request_count: 0,
  top_changed_paths: [],
};

/**
 * 구간 전체의 PR 번호로 거는 질의.
 *
 * **`range(merge_seq)`가 아니라 `terms(pr_number)`다.** 정본이 준 목록을 그대로
 * 쓰므로, 색인의 `merge_seq`가 아직 비어 있어도 그 PR의 표시 필드는 찾아진다 —
 * 채번 반영이 늦어도 요약이 조용히 줄지 않는다.
 *
 * 상한은 `RANGE_LIMIT`(5만)이고 Elasticsearch의 `index.max_terms_count` 기본값은
 * 65,536이라 구간 전체를 한 번에 실을 수 있다.
 */
function prNumbersQuery(
  space: ResolvedSpace,
  prNumbers: readonly number[],
  extra: estypes.QueryDslQueryContainer | null,
): estypes.QueryDslQueryContainer {
  const filter: estypes.QueryDslQueryContainer[] = [
    { term: { repository_id: space.repositoryId } },
    { terms: { pr_number: [...prNumbers] } },
  ];
  if (extra !== null) filter.push(extra);
  return { bool: { filter } };
}

/** 요약 집계. 라우팅으로 단일 샤드에 닿으므로 `terms` 집계가 근사가 아니라 정확하다. */
const SUMMARY_AGGS: Record<string, estypes.AggregationsAggregationContainer> = {
  distinct_authors: { cardinality: { field: 'author' } },
  changed_files: { sum: { field: 'changed_files_count' } },
  additions: { sum: { field: 'additions' } },
  deletions: { sum: { field: 'deletions' } },
  files_truncated: { filter: { term: { files_truncated: true } } },
  /*
   * 되돌려진 PR 수 (DEV-239). **간선 인덱스를 PR마다 다시 묻지 않는다** — 그러면
   * 5만 건 구간에서 요약이 서지 않는다. 목록·요약이 이미 도는 이 왕복 안에서
   * `filter` 집계 하나로 끝낸다. `files_truncated`가 같은 형태의 선례다.
   */
  reverted: { filter: { term: { 'link_summary.is_reverted': true } } },
  top_paths: { terms: { field: 'changed_paths.raw', size: TOP_PATHS } },
};

function buildUrl(space: ResolvedSpace, row: MergeSequenceRow): string | null {
  const [owner, rest] = space.sequenceSpace.split('/');
  const name = rest?.split('@')[0];
  if (owner === undefined || name === undefined || name === '') return null;
  return row.pull_request_number === null
    ? `/commit/${owner}/${name}/${row.commit_sha}`
    : `/pr/${owner}/${name}/${String(row.pull_request_number)}`;
}

/** 정본에서 읽은 페이지와, 그 페이지를 만들며 알아낸 것. */
interface ScannedPage {
  readonly rows: readonly MergeSequenceRow[];
  readonly sources: ReadonlyMap<number, PullRequestSource>;
  /**
   * 완결 서수 — **그 이하에 아직 내주지 않은 일치가 없는 지점** (AC-7).
   *
   * 구간을 끝까지 검사했으면 `null`이다. 그때는 다음 페이지가 없다.
   */
  readonly completeSeq: number | null;
}

/**
 * 정본 구간을 **chunk로 훑으며** 페이지를 만든다 (CR-043 DEV-270, CR-044 DEV-287).
 *
 * ## 순서를 뒤집은 이유
 *
 * 예전 구현은 정본에서 첫 `size` 행을 읽고 **그 안에서만** `q`를 판정했다.
 * 요약은 구간 **전체**를 세므로 두 수가 같은 응답 안에서 어긋났고, 커서가 없어
 * 사용자는 잘린 쪽 항목에 **도달할 수 없었다.**
 *
 * > 실측: 구간 1~60, `size=10`, 일치가 서수 51 하나뿐인 `q` →
 * > `summary.pull_request_count: 1`, `items: []`, `next_cursor: null`.
 *
 * 그래서 "먼저 자르고 판정한다"를 "판정하며 채운다"로 바꾼다. 페이지가 찰
 * 때까지, 또는 구간이 끝날 때까지 chunk를 읽는다.
 *
 * ## 완결 서수를 정하는 자리가 여기다
 *
 * 페이지가 차서 멈췄으면 **실제로 실은 마지막 일치**의 서수를 봉인한다. 그
 * 위에는 아직 안 내준 일치가 있을 수 있기 때문이다. chunk 끝까지 밀면 같은
 * chunk의 남은 일치가 사라진다 — 고치려던 결함이 반대 방향으로 재현된다.
 */
async function scanPage(
  request: RangeRequest,
  deps: RangeDeps,
  extra: estypes.QueryDslQueryContainer | null,
  startAfter: number,
  scoped: (extraClause: estypes.QueryDslQueryContainer | null, numbers: readonly number[]) => ScopedRequest,
): Promise<ScannedPage> {
  const { space } = request;
  const chunkSize = deps.chunkSize ?? RANGE_SCAN_CHUNK;
  const timeout = deps.timeoutMs === undefined ? {} : { timeout: `${String(deps.timeoutMs)}ms` };
  const routing = String(space.repositoryId);

  const rows: MergeSequenceRow[] = [];
  const sources = new Map<number, PullRequestSource>();

  let scannedSeq = startAfter;
  /** 목록에 실제로 실은 마지막 일치의 서수. */
  let returnedSeq: number | null = null;
  /** 페이지가 찬 뒤에 **또 다른 일치**를 봤는가. 봤으면 다음 페이지가 있다. */
  let sawMoreAfterFull = false;
  /** 정본 구간을 끝까지 읽었는가. */
  let exhausted = false;

  while (rows.length <= request.size) {
    const chunk = await mergeSequenceRepo.findRangePage(
      deps.pool,
      space.repositoryId,
      space.baseBranch,
      space.seqEpoch,
      scannedSeq,
      request.toInclusive,
      chunkSize,
    );
    if (chunk.length === 0) {
      exhausted = true;
      break;
    }

    /*
     * chunk 하나를 한 왕복으로 판정한다.
     *
     * `q`가 없으면 판정할 것이 없으므로 부르지 않는다 — 표시 필드는 페이지가
     * 정해진 뒤에 한 번에 가져온다. `q`가 있으면 판정과 표시를 **같은 응답**에서
     * 얻는다: 어차피 매치된 문서를 읽는 참이다.
     */
    if (extra !== null) {
      const numbers = [
        ...new Set(
          chunk.filter((row) => row.pull_request_number !== null).map((row) => row.pull_request_number!),
        ),
      ];
      if (numbers.length > 0) {
        const response = await search<PullRequestSource>(
          deps.es,
          'prs-pull-requests',
          scoped(extra, numbers),
          {
            size: numbers.length,
            routing,
            _source: PAGE_SOURCE_FIELDS,
            ...timeout,
          },
        );
        assertNoShardFailures(response);
        for (const hit of response.hits.hits) {
          const source = hit._source;
          if (source?.pr_number !== undefined) sources.set(source.pr_number, source);
        }
      }
    }

    for (const row of chunk) {
      const matched =
        extra === null || (row.pull_request_number !== null && sources.has(row.pull_request_number));

      if (matched) {
        if (rows.length >= request.size) {
          /*
           * 페이지가 찼는데 일치가 또 나왔다 — 다음 페이지가 있다.
           *
           * **이 행을 소비하지 않고 멈춘다.** `scannedSeq`도 올리지 않는다:
           * 커서는 `returnedSeq`를 봉인하므로 다음 페이지가 이 행부터 다시
           * 판정한다.
           */
          sawMoreAfterFull = true;
          break;
        }
        rows.push(row);
        returnedSeq = Number(row.merge_seq);
      }
      scannedSeq = Number(row.merge_seq);
    }

    if (sawMoreAfterFull) break;
    if (chunk.length < chunkSize) {
      exhausted = true;
      break;
    }
  }

  /*
   * 완결 서수 — 규칙은 하나이고 결과가 둘로 갈린다 (AC-7).
   *
   *   - 끝까지 검사했다 → 다음 페이지가 없다 (`null`)
   *   - 페이지가 차서 멈췄다 → 실제로 실은 마지막 일치의 서수
   *
   * 두 번째에서 `scannedSeq`(마지막으로 **검사한** 서수)를 쓰면 같은 chunk의
   * 남은 일치가 영영 사라진다 (DEV-287).
   */
  const completeSeq = exhausted || !sawMoreAfterFull ? null : returnedSeq;

  return { rows, sources, completeSeq };
}

/** 색인에서 꺼내는 표시용 필드. 정본이 주지 않는 것만 담는다. */
const PAGE_SOURCE_FIELDS: string[] = [
  'pr_number',
  'title',
  'author',
  'merged_at',
  'changed_files_count',
  'additions',
  'deletions',
];

/**
 * 반개구간 `(from, to]`를 조회한다.
 *
 * 순서는 바꿀 수 없다: 정본에서 멤버십을 읽고 → 색인에서 채운다. 반대로 하면
 * 색인이 목록의 길이를 정하게 된다.
 *
 * @throws {CursorInvalidError} 커서를 쓸 수 없으면.
 * @throws {CursorQueryMismatchError} 공간·에폭·경계·지문이 다르면.
 */
export async function runRange(request: RangeRequest, deps: RangeDeps): Promise<RangeResult> {
  const { space, scope } = request;
  const now = (deps.now ?? Date.now)();

  // 1. `q`를 ES 절로 옮긴다. 없으면 `null` — `match_all`을 끼워 넣지 않는다.
  let extra: estypes.QueryDslQueryContainer | null = null;
  let unresolved: readonly UnresolvedName[] = [];
  if (request.ast !== null) {
    const resolution = await deps.resolveNames(collectNames(request.ast));
    /*
     * `q`에 `seq:` 범위가 있으면 에폭이 필요하다 (CR-051) — 이 화면은 이미
     * 공간을 확정했으므로 그 에폭을 그대로 넘긴다. 넘기지 않으면
     * `buildQuery`가 던지고 이 경로가 500이 된다 (PR #64 리뷰 P2).
     */
    const built = buildQuery(request.ast, resolution, {
      sequenceEpoch: request.space.seqEpoch,
    });
    extra = built.query;
    unresolved = built.unresolved;
  }

  /*
   * 2. 커서를 먼저 연다 — **조회를 시작하기 전에.**
   *
   * 에폭·경계·지문이 어긋난 커서로 조회를 돌리면 그 왕복이 통째로 버려지고,
   * 더 나쁘게는 옛 공간의 서수부터 새 공간을 훑게 된다.
   */
  const anchor: RangeCursorAnchor = {
    repositoryId: space.repositoryId,
    baseBranch: space.baseBranch,
    seqEpoch: space.seqEpoch,
    fromExclusive: request.fromExclusive,
    toInclusive: request.toInclusive,
  };
  const fingerprint = computeRangeFingerprint({
    query: request.ast === null ? '' : serializeQuery(request.ast),
    scope,
    scopeVersion: request.scopeVersion,
  });
  const resumed =
    request.cursor === null
      ? null
      : decodeRangeCursor(request.cursor, anchor, fingerprint, deps.cursorSigner, now);

  /*
   * 3. 요약과 패싯이 볼 구간 **전체**의 PR 번호.
   *
   * 페이지가 아니라 구간이 기준이다 — 페이지 1이 50건이고 일치가 4,000건이면
   * 패싯은 4,000건 기준이다 (FR-SEQ-002 AC-8).
   */
  const prNumbers = await mergeSequenceRepo.listPullRequestNumbersInRange(
    deps.pool,
    space.repositoryId,
    space.baseBranch,
    space.seqEpoch,
    request.fromExclusive,
    request.toInclusive,
  );

  const timeout = deps.timeoutMs === undefined ? {} : { timeout: `${String(deps.timeoutMs)}ms` };
  const routing = String(space.repositoryId);
  const scoped = (extraClause: estypes.QueryDslQueryContainer | null, numbers: readonly number[]): ScopedRequest =>
    applyMandatoryScopeFilter(prNumbersQuery(space, numbers, extraClause), scope);

  const startAfter = resumed?.completeSeq ?? request.fromExclusive;

  if (prNumbers.length === 0) {
    /*
     * 구간에 PR이 하나도 없다 — 직접 푸시만 있는 구간이거나 빈 구간이다.
     * `terms`에 빈 목록을 넣으면 아무것도 매치하지 않지만, 그 왕복은 답을
     * 바꾸지 않으므로 하지 않는다.
     *
     * `q`가 없으면 정본 행은 그대로 목록이 된다 — 커서도 여기서 성립한다.
     */
    const bare =
      request.size === 0 || extra !== null
        ? { rows: [], completeSeq: null }
        : await scanPage(request, deps, null, startAfter, scoped);

    return {
      // `q`가 있으면 판정할 PR이 하나도 없으므로 0건이다 (DEV-136).
      summary: { ...EMPTY_SUMMARY_AGGS, commit_count: extra === null ? request.rangeTotal : 0 },
      items: bare.rows.map((row) => toUnindexedItem(space, row)),
      // PR이 없는 항목은 커밋 문서로만 존재하고, 그 문서에는 표시할 값이 없다.
      items_missing_in_index: 0,
      unresolved,
      nextCursor:
        bare.completeSeq === null
          ? null
          : encodeRangeCursor(bare.completeSeq, anchor, fingerprint, deps.cursorSigner, now),
      /*
       * 패싯을 셀 문서가 없다. `null`이 아니라 빈 분포를 준다 — 요청했고
       * 계산했으며 결과가 비었다는 사실이 "세지 않았다"와 다르다.
       */
      facets: request.facets ? { facets: {}, omitted: false, status: 'ready' } : null,
    };
  }

  /*
   * 4. 요약·패싯(구간 전체)과 페이지(chunk 순회)를 함께 돌린다.
   *
   * 셋 다 강제 필터를 지난다 (ADR-008). 패싯은 **별도 요청**이라 목록·요약과
   * 실패 도메인이 갈린다 — 분포 하나가 예산을 넘겨도 구간 결과는 나간다.
   */

  /*
   * `q`가 있으면 **거르지 않은 건수**를 따로 센다.
   *
   * `items_missing_in_index`는 `q`와 무관하게 늘 같은 뜻이어야 한다 — "정본에는
   * PR이 있는데 색인에 문서가 없는 수". 거른 건수 하나로 그것을 계산하면
   * "필터에 걸러진 것"과 "문서가 없는 것"이 한 숫자에 섞이고, 같은 필드가 요청에
   * 따라 다른 것을 세게 된다.
   *
   * `q`가 없으면 두 질의가 같으므로 세지 않는다.
   */
  const requests: { target: 'prs-pull-requests'; query: ScopedRequest; options: estypes.MsearchRequestItem }[] = [];
  const summaryIndex = extra === null ? 0 : 1;
  if (extra !== null) {
    requests.push({
      target: 'prs-pull-requests',
      query: scoped(null, prNumbers),
      options: { size: 0, routing, track_total_hits: true, ...timeout } as estypes.MsearchRequestItem,
    });
  }
  requests.push({
    target: 'prs-pull-requests',
    query: scoped(extra, prNumbers),
    options: {
      size: 0,
      routing,
      aggs: SUMMARY_AGGS,
      track_total_hits: true,
      ...timeout,
    } as estypes.MsearchRequestItem,
  });

  const [response, scanned, facets] = await Promise.all([
    multiSearch<PullRequestSource>(deps.es, requests),
    request.size === 0
      ? Promise.resolve<ScannedPage>({ rows: [], sources: new Map(), completeSeq: null })
      : scanPage(request, deps, extra, startAfter, scoped),
    request.facets
      ? computeFacets(
          { target: 'prs-pull-requests', query: scoped(extra, prNumbers), axes: RANGE_FACET_AXES, routing },
          {
            es: deps.es,
            ...(deps.resolveTeamSlugs === undefined ? {} : { resolveTeamSlugs: deps.resolveTeamSlugs }),
            ...(deps.facetBudgetMs === undefined ? {} : { budgetMs: deps.facetBudgetMs }),
          },
        )
      : Promise.resolve(null),
  ]);

  const summaryResponse = asResult(response.responses[summaryIndex]);

  const aggs = (summaryResponse?.aggregations ?? {}) as SummaryAggregations;
  /** `q`를 지난 PR 수. 구간 전체 기준이다. */
  const matchedTotal = totalOf(summaryResponse);
  /** 색인에 문서가 있는 PR 수. `q`와 무관하다. */
  const indexedTotal = extra === null ? matchedTotal : totalOf(asResult(response.responses[0]));

  /*
   * `q`가 없으면 표시 필드를 **페이지가 정해진 뒤에** 한 번에 가져온다.
   *
   * `q`가 있는 경로에서는 `scanPage`가 판정하며 이미 읽었다 — 같은 문서를 두 번
   * 읽지 않는다.
   */
  const sources = new Map<number, PullRequestSource>(scanned.sources);
  if (extra === null && scanned.rows.length > 0) {
    const pagePrNumbers = [
      ...new Set(
        scanned.rows.filter((row) => row.pull_request_number !== null).map((row) => row.pull_request_number!),
      ),
    ];
    if (pagePrNumbers.length > 0) {
      const pageResponse = await search<PullRequestSource>(
        deps.es,
        'prs-pull-requests',
        scoped(null, pagePrNumbers),
        { size: pagePrNumbers.length, routing, _source: PAGE_SOURCE_FIELDS, ...timeout },
      );
      assertNoShardFailures(pageResponse);
      for (const hit of pageResponse.hits.hits) {
        const source = hit._source;
        if (source?.pr_number !== undefined) sources.set(source.pr_number, source);
      }
    }
  }

  /*
   * `q`가 있으면 목록도 요약도 그것을 지난 집합을 말한다 (DEV-136).
   *
   * **거르는 자리가 바뀌었다** — 예전에는 정본 페이지를 먼저 자른 뒤 여기서
   * 걸렀고, 그래서 첫 `size` 행 밖의 일치에 도달할 수 없었다 (DEV-270). 이제
   * `scanPage`가 판정하며 채우므로 여기 오는 행은 이미 전부 일치다.
   *
   * `q`가 없으면 정본의 모든 행이 목록에 남는다 — 색인에 없어도 서수와 SHA는
   * 확정값이므로 보여 줄 것이 있다.
   */
  const items = scanned.rows.map((row) => toItem(space, row, sources));

  /*
   * 커밋 수의 뜻 (DEV-139): 구간의 **first-parent 커밋 수**다. PR의 원본 커밋까지
   * 세지 않는다 — DoD가 `git log --first-parent A..B`와 대조하라고 하므로 그
   * 명령이 세는 것과 같은 것을 센다.
   *
   * `q`가 걸리면 PR 문서가 없는 직접 푸시 커밋은 **판정할 수 없다.** 통과로 세면
   * 요약이 목록보다 커지므로 세지 않는다. 그래서 필터가 있을 때 커밋 수는 곧
   * 걸러진 PR 수다 — 서수 하나에 머지 커밋 하나이므로 둘은 같은 수다.
   */
  const commitCount = extra === null ? request.rangeTotal : matchedTotal;

  return {
    summary: {
      pull_request_count: extra === null ? prNumbers.length : matchedTotal,
      commit_count: commitCount,
      distinct_author_count: aggs.distinct_authors?.value ?? 0,
      changed_files_total: Math.round(aggs.changed_files?.value ?? 0),
      additions_total: Math.round(aggs.additions?.value ?? 0),
      deletions_total: Math.round(aggs.deletions?.value ?? 0),
      files_truncated_pull_request_count: aggs.files_truncated?.doc_count ?? 0,
      reverted_pull_request_count: aggs.reverted?.doc_count ?? 0,
      top_changed_paths: (aggs.top_paths?.buckets ?? []).map((bucket) => ({
        path: bucket.key,
        count: bucket.doc_count,
      })),
    },
    items,
    items_missing_in_index: Math.max(0, prNumbers.length - indexedTotal),
    unresolved,
    nextCursor:
      scanned.completeSeq === null
        ? null
        : encodeRangeCursor(scanned.completeSeq, anchor, fingerprint, deps.cursorSigner, now),
    facets,
  };
}

/** `applyMandatoryScopeFilter`의 반환 타입. 브랜드가 지워지지 않게 그대로 받는다. */
type ScopedRequest = ReturnType<typeof applyMandatoryScopeFilter>;

/** msearch 응답의 한 칸은 결과이거나 오류다. 오류 칸은 집계도 히트도 없다. */
function asResult(
  entry: estypes.MsearchResponseItem<PullRequestSource> | undefined,
): estypes.SearchResponse<PullRequestSource> | null {
  if (entry === undefined || 'error' in entry) return null;
  return entry as estypes.SearchResponse<PullRequestSource>;
}

function totalOf(result: estypes.SearchResponse<PullRequestSource> | null): number {
  const total = result?.hits.total;
  if (total === undefined) return 0;
  return typeof total === 'number' ? total : total.value;
}

function toUnindexedItem(space: ResolvedSpace, row: MergeSequenceRow): RangeItem {
  return {
    merge_seq: Number(row.merge_seq),
    kind: row.pull_request_number === null ? 'commit' : 'pull_request',
    ...(row.pull_request_number === null ? {} : { pr_number: row.pull_request_number }),
    commit_sha: row.commit_sha,
    title: null,
    author: null,
    merged_at: null,
    changed_files_count: null,
    additions: null,
    deletions: null,
    indexed: false,
    url: buildUrl(space, row),
  };
}

function toItem(
  space: ResolvedSpace,
  row: MergeSequenceRow,
  sources: ReadonlyMap<number, PullRequestSource>,
): RangeItem {
  const source = row.pull_request_number === null ? undefined : sources.get(row.pull_request_number);
  if (source === undefined) return toUnindexedItem(space, row);

  return {
    merge_seq: Number(row.merge_seq),
    kind: 'pull_request',
    ...(row.pull_request_number === null ? {} : { pr_number: row.pull_request_number }),
    commit_sha: row.commit_sha,
    title: source.title ?? null,
    author: source.author ?? null,
    merged_at: source.merged_at ?? null,
    changed_files_count: source.changed_files_count ?? null,
    additions: source.additions ?? null,
    deletions: source.deletions ?? null,
    indexed: true,
    url: buildUrl(space, row),
  };
}
