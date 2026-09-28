/**
 * 필터 완화 후보 (FR-SRCH-006 AC-3, CR-016 DEV-055, CR-128).
 *
 * 결과가 0건일 때 "어떤 필터를 빼면 결과가 생기는지"를 알려 준다. 사용자가
 * 조건 다섯을 걸어 0건을 받았을 때, 어느 하나가 범인인지 스스로 찾게 두지
 * 않는 것이 이 기능의 전부다.
 *
 * **왕복을 한 번으로 고정한다.** 필터마다 질의를 따로 던지면 왕복이 필터
 * 수만큼 늘어나 NFR-001의 p95 500ms 예산을 그만큼 쓴다. `msearch` 하나로 묶고
 * 후보를 상한 8개로 자른다.
 *
 * **0건일 때만 계산한다.** 정상 경로의 지연에 영향이 없다.
 *
 * ## 후보는 본 조회와 같은 해석을 다시 밟는다 (CR-128, DEV-783)
 *
 * 후보는 필터 하나를 뺀 **질의**다. 그 질의가 무엇을 세는지는 본 조회와 같은 순서로
 * 정한다 — 대상 해석(`kind:`) → `kind:`를 걷어 낸 AST로 조립 → 강제 접근 범위 → 건수.
 *
 * 전에는 본 조회가 `kind:`로 좁힌 대상과 **걷어 내지 않은 원래 AST**를 받았다. `kind:`가
 * 남은 후보마다 `buildQuery`의 가드(`KindFilterNotAppliedError`)에 걸려, `kind:`와 다른
 * 필터를 함께 쓴 0건 검색이 전부 500이었다. 걷어 낸 AST를 넘기는 것만으로도 틀린다 —
 * `kind:`를 빼는 후보가 목록에서 사라지고, 좁힌 대상으로 세면 유형 조건을 뺐을 때 새로
 * 들어오는 다른 유형의 문서를 세지 못한다. 그래서 후보마다 **요청 경로가 허용한 원래
 * 대상**에서 `kind:`를 다시 해석한다.
 */

import {
  applyMandatoryScopeFilter,
  buildQuery,
  multiSearch,
  resolveSearchTarget,
  type AccessScope,
  type EntityAlias,
  type NameResolution,
  type ScopedSearchRequest,
} from '@prs/es';
import {
  analyzeMergeNumberBinding,
  analyzePrNumberBinding,
  analyzeSequenceBinding,
  serializeQuery,
  type QueryAst,
  type QueryFilter,
} from '@prs/query';
import type { Client, estypes } from '@elastic/elasticsearch';

/**
 * 후보 상한 (CR-016, DEV-055).
 *
 * 여덟을 넘는 필터를 건 사용자에게 여덟 개보다 많은 제안을 해 봐야 읽지
 * 않는다. 상한을 넘으면 잘랐다는 사실을 응답에 남긴다 — 조용한 절삭은
 * "이것이 전부"로 읽힌다.
 */
export const MAX_RELAXATION_HINTS = 8;

/**
 * 후보 갈래 하나의 시간 예산 (CR-128).
 *
 * Elasticsearch의 `timeout`이다 — **소프트**라 넘겨도 200에 `timed_out: true`와 그때까지의
 * 건수를 준다. 그 건수는 실제보다 작을 수 있으므로 세지 못한 것으로 본다. 패싯 예산과
 * 같다 — 둘 다 목록이 확정된 뒤에 붙는 부가 정보다.
 */
export const RELAXATION_BRANCH_BUDGET_MS = 1_500;

/**
 * `msearch` 왕복 전체의 상한 (CR-128).
 *
 * 넘기면 클라이언트가 끊고 후보 전부를 세지 못한 것으로 본다. **재시도하지 않는다** —
 * 본 조회는 이미 끝났고, 추천 하나 때문에 응답을 더 붙잡지 않는다.
 */
export const RELAXATION_REQUEST_TIMEOUT_MS = 3_000;

export interface RelaxationHint {
  /** 제거 대상 필터를 질의 문자열 조각으로 되돌린 것. 화면이 그대로 보여 준다. */
  readonly remove: string;
  /** 그 필터를 뺐을 때의 건수. **언제나 정확한 건수다** — 세지 못한 후보는 싣지 않는다. */
  readonly would_yield: number;
}

/**
 * 세지 못한 후보의 진단 (CR-128).
 *
 * **응답에 싣지 않는다** — 호출부가 correlation ID와 함께 로그로 남긴다. 질의 문자열과
 * Elasticsearch 오류 본문을 담지 않는다: 둘 다 저장소·경로 이름을 실어 나를 수 있다.
 */
export interface RelaxationFailure {
  /**
   * `resolve`: 이름 해석(호출부가 잡는다 — 모순된 `kind:`의 0건에서만 후보 계산을 위해 처음 부른다),
   * `compute`: 후보 조립(호출부가 잡는다), `msearch`: 왕복 전체, `branch`: 갈래 일부.
   */
  readonly stage: 'resolve' | 'compute' | 'msearch' | 'branch';
  /** 오류 이름이나 갈래의 사유(`timed_out`·`shard_failures`·Elasticsearch 오류 유형). */
  readonly reason: string;
  /** Elasticsearch에 보낸 후보 수. */
  readonly counted: number;
  /** 세지 못한 후보 수. */
  readonly failed: number;
}

export interface RelaxationResult {
  readonly hints: readonly RelaxationHint[];
  /** 상한에 걸려 후보를 다 세지 못했는가. */
  readonly truncated: boolean;
  /**
   * 세지 못한 후보가 있는가 (CR-128).
   *
   * 참이면 `hints`의 건수는 정확하지만 빠진 후보가 있을 수 있다. **빈 목록이 「뺄 조건이
   * 없다」가 아니라 「계산하지 못했다」일 수 있다** — 이 값이 그 둘을 가른다.
   */
  readonly incomplete: boolean;
  /** `incomplete`의 진단. 응답에 싣지 않는다. */
  readonly failure?: RelaxationFailure;
}

export const NO_RELAXATION: RelaxationResult = { hints: [], truncated: false, incomplete: false };

/** 필터 하나를 뺀 AST. 원본 AST는 바꾸지 않는다 — 지문과 응답의 `parsed`가 그것을 쓴다. */
function without(ast: QueryAst, index: number): QueryAst {
  return { ...ast, filters: ast.filters.filter((_, at) => at !== index) };
}

/** 제거 대상을 사용자가 쓴 문법으로 되돌린다. */
function describe(filter: QueryFilter): string {
  return serializeQuery({ filters: [filter], text: null });
}

export interface RelaxationDeps {
  readonly es: Client;
  /**
   * 요청 경로가 허용한 **원래** 검색 대상 (CR-128).
   *
   * 본 조회가 `kind:`로 좁힌 대상이 아니다 — 후보마다 `kind:`를 이 대상에서 다시
   * 해석한다. 이 밖으로 넓히지 않는다: `resolveSearchTarget`은 좁히기만 한다.
   */
  readonly baseTarget: readonly EntityAlias[];
  readonly scope: AccessScope;
  readonly resolution: NameResolution;
  /** 본 조회가 확정한 유효 에폭. `seq:`가 없으면 `null` (CR-051). */
  readonly sequenceEpoch: number | null;
  /** 본 조회가 확정한 유효 M 번호 에폭. `mnum:`이 없으면 `null` (CR-106). */
  readonly mergeNumberEpoch: number | null;
  /** 본 조회가 묶인 `mnum:` 공간의 기준 브랜치. `mnum:`이 없으면 `null` (CR-114). */
  readonly mergeNumberBaseBranch: string | null;
  /** 갈래의 시간 예산. 시험이 예산 초과를 재현할 때만 넘긴다. */
  readonly branchBudgetMs?: number;
  /** 왕복 상한. 시험이 상한 초과를 재현할 때만 넘긴다. */
  readonly requestTimeoutMs?: number;
}

/** Elasticsearch에 보낸 후보 하나. **보낸 순서가 곧 응답의 순서다.** */
interface CountedCandidate {
  readonly filter: QueryFilter;
  readonly request: ScopedSearchRequest;
}

/**
 * 갈래 하나의 정확한 건수. 셀 수 없으면 그 사유 (CR-128).
 *
 * **부분 결과를 정확한 건수로 보이지 않는다.** 샤드가 빠진 건수와 시간 예산을 넘긴 건수는
 * 실제보다 작을 수 있고, 사용자는 그 차이를 볼 수 없다 — 본 조회가 `assertNoShardFailures`로
 * 부분 결과를 거절하는 것과 같은 규칙이다.
 */
function countOf(
  one: estypes.MsearchResponseItem<unknown> | undefined,
): { readonly value: number } | { readonly reason: string } {
  if (one === undefined) return { reason: 'missing_response' };
  if (!('hits' in one)) return { reason: one.error.type };
  if ((one._shards.failed ?? 0) > 0) return { reason: 'shard_failures' };
  if (one.timed_out) return { reason: 'timed_out' };
  const total = one.hits.total;
  if (total === undefined) return { reason: 'total_missing' };
  if (typeof total === 'number') return { value: total };
  // `track_total_hits: true`면 `eq`다. 하한(`gte`)은 정확한 건수가 아니다.
  return total.relation === 'eq' ? { value: total.value } : { reason: 'total_lower_bound' };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * 후보를 센다.
 *
 * 필터가 하나뿐이면 계산하지 않는다 — 그것을 빼면 조건 없는 조회가 되고,
 * "필터를 전부 지우면 결과가 나옵니다"는 도움이 되지 않는다.
 *
 * **Elasticsearch의 실패는 던지지 않는다** (CR-128). 왕복 실패·갈래 오류·샤드 실패·시간
 * 초과는 `incomplete`와 `failure`로 답한다 — 본 조회는 이미 끝났고 추천은 부가 정보다.
 * 후보 조립의 실패(조립 규칙의 결함)와 접근 범위 오류는 던진다: 무엇을 삼키고 무엇을
 * 올릴지는 호출부(`runSearch`)가 정한다.
 *
 * @throws {AccessScopeUnavailableError} 접근 범위가 비어 있으면. 정상 경로가
 * 이미 같은 이유로 실패했을 것이므로 여기 도달하지 않는다.
 */
export async function computeRelaxationHints(
  ast: QueryAst,
  deps: RelaxationDeps,
): Promise<RelaxationResult> {
  if (ast.filters.length < 2) return NO_RELAXATION;

  const truncated = ast.filters.length > MAX_RELAXATION_HINTS;
  /*
   * **실행할 수 없는 질의를 제안하지 않는다** (CR-051, CR-106).
   *
   * `seq:`·`mnum:` 범위가 남은 채로 `repo:`나 `base:`를 빼거나, `pr_number:`가
   * 남은 채로 `repo:`를 빼면 그 질의는 지목을 잃어 각 AC가 400으로 거절한다.
   * "이 필터를 빼면 N건이 나옵니다"라고 제안해 놓고 실제로 빼면 오류가 나는
   * 것은 제안이 아니라 함정이다. 그런 후보는 세지 않고 건너뛴다.
   */
  const candidates = ast.filters
    .slice(0, MAX_RELAXATION_HINTS)
    .map((filter, index) => ({ filter, relaxed: without(ast, index) }))
    .filter(
      ({ relaxed }) =>
        analyzeSequenceBinding(relaxed).kind !== 'invalid' &&
        analyzeMergeNumberBinding(relaxed).kind !== 'invalid' &&
        analyzePrNumberBinding(relaxed).kind !== 'invalid',
    );

  const budget = deps.branchBudgetMs ?? RELAXATION_BRANCH_BUDGET_MS;
  const counted: CountedCandidate[] = [];
  for (const { filter, relaxed } of candidates) {
    /*
     * 후보마다 검색 대상을 다시 해석한다 (CR-128, DEV-783). `kind:`를 뺀 후보는 원래 대상
     * 전체를, 다른 필터를 뺀 후보는 남은 `kind:`가 정한 대상을 센다.
     *
     * **남은 유형이 없는 후보는 보내지 않는다** — `kind:pull_request -kind:pull_request`에서
     * 다른 필터를 뺀 후보처럼 어떤 문서도 매치할 수 없다. 0건이므로 목록에 싣지 않고, 빈
     * 인덱스 목록을 넘기면 Elasticsearch가 전체를 검색하므로 조회하지도 않는다.
     */
    const { target, ast: stripped } = resolveSearchTarget(relaxed, deps.baseTarget);
    if (target === null) continue;

    const built = buildQuery(
      stripped,
      deps.resolution,
      /*
       * 뺀 뒤에도 `seq:`·`mnum:`이 남았으면 같은 에폭으로 센다 — 본 조회와
       * 다른 세대를 세면 그 건수는 아무것도 뜻하지 않는다(CR-106).
       */
      {
        ...(deps.sequenceEpoch === null ? {} : { sequenceEpoch: deps.sequenceEpoch }),
        ...(deps.mergeNumberEpoch === null ? {} : { mergeNumberEpoch: deps.mergeNumberEpoch }),
        ...(deps.mergeNumberBaseBranch === null ? {} : { mergeNumberBaseBranch: deps.mergeNumberBaseBranch }),
      },
    );
    counted.push({
      filter,
      request: {
        target,
        // 강제 접근 범위 결합. 후보의 건수도 범위 밖 문서를 세지 않는다 (ADR-008).
        query: applyMandatoryScopeFilter(built.query, deps.scope),
        // 건수만 필요하다. 문서를 실어 오면 완화 계산이 본 조회보다 무거워진다.
        options: { size: 0, track_total_hits: true, timeout: `${String(budget)}ms` },
      },
    });
  }

  if (counted.length === 0) return { hints: [], truncated, incomplete: false };

  let response: estypes.MsearchResponse<unknown>;
  try {
    response = await multiSearch<unknown>(
      deps.es,
      counted.map((one) => one.request),
      { requestTimeout: deps.requestTimeoutMs ?? RELAXATION_REQUEST_TIMEOUT_MS, maxRetries: 0 },
    );
  } catch (error) {
    /*
     * 왕복 자체가 실패했다 — 통신 오류, 상한 초과, 요청 전체의 거절. 후보를 하나도 세지
     * 못했으므로 목록은 비지만 **「뺄 조건이 없다」가 아니다.** 던지지 않는다: 본 조회의
     * 200을 추천 때문에 5xx로 바꾸지 않는다 (FR-SRCH-006 예외/실패 처리).
     */
    return {
      hints: [],
      truncated,
      incomplete: true,
      failure: { stage: 'msearch', reason: errorName(error), counted: counted.length, failed: counted.length },
    };
  }

  const hints: RelaxationHint[] = [];
  let failed = 0;
  let reason: string | null = null;
  counted.forEach((candidate, index) => {
    // 보낸 후보만 짝짓는다 — 건너뛴 후보는 애초에 보내지 않았으므로 응답과 어긋나지 않는다.
    const outcome = countOf(response.responses[index]);
    if ('reason' in outcome) {
      failed += 1;
      reason ??= outcome.reason;
      return;
    }
    if (outcome.value === 0) return;
    hints.push({ remove: describe(candidate.filter), would_yield: outcome.value });
  });

  // 많이 나오는 것부터. 사용자가 가장 크게 잘못 건 조건이 위로 온다.
  hints.sort((left, right) => right.would_yield - left.would_yield);

  if (failed === 0) return { hints, truncated, incomplete: false };
  return {
    hints,
    truncated,
    incomplete: true,
    failure: { stage: 'branch', reason: reason ?? 'unknown', counted: counted.length, failed },
  };
}
