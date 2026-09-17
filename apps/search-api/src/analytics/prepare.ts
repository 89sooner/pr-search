/**
 * 집계 네 API의 공통 준비 (WP-037 / CR-053 `API-STAT 공통 규칙`).
 *
 * ## 순서가 규칙이다
 *
 *   질의 파싱 → 모집단 확정 → 접근 범위 산출 → 시퀀스 문맥 → 에폭 → 집계
 *
 * `CR-051`이 `/search`에 세운 순서를 그대로 따른다. **공간 해석이 접근 통제를
 * 지나야** 미등록 저장소와 범위 밖 저장소가 같은 답을 받고, 그래야 존재 여부가
 * 새지 않는다.
 *
 * ## 검색과 같은 파서를 쓴다
 *
 * 집계 전용 문법을 만들지 않는다. 같은 문자열을 두 파서가 해석하면 **한쪽만
 * 넓어지는 날 아무 오류도 나지 않는다** — `packages/query/src/sequence-binding.ts`가
 * 같은 이유로 하나뿐인 것과 같다.
 */

import {
  QueryParseError,
  analyzePrNumberBinding,
  hasMergeNumberRangeFilter,
  parseQuery,
  type QueryAst,
  type RepositoryBindingAnalysis,
} from '@prs/query';
import {
  applyMandatoryScopeFilter,
  buildQuery,
  collectNames,
  resolveSearchTarget,
  type AccessScope,
  type EntityAlias,
  type NameResolution,
  type ScopedQuery,
  type UnresolvedName,
} from '@prs/es';
import type { Pool } from '@prs/db';
import {
  resolveMergeNumberRangeEpoch,
  resolveSequenceContext,
  type MergeNumberRangeOutcome,
  type SequenceContextOutcome,
} from '../search/sequence-context.js';
import { ANALYTICS_TARGET } from './types.js';

export interface PrepareInput {
  readonly rawQuery: string;
  readonly rawEpoch: unknown;
  readonly scope: AccessScope;
  /** M 번호 기능 켜짐 여부 (CR-106). 꺼져 있으면 `mnum:`을 지원하지 않는 키로 거절한다. */
  readonly mergeNumberEnabled: boolean;
}

export interface PrepareDeps {
  readonly pool: Pool;
  readonly resolveNames: (names: {
    readonly orgs: readonly string[];
    readonly teams: readonly string[];
  }) => Promise<NameResolution>;
}

/** 준비 결과. 라우트가 그대로 분기한다 — 이 모듈은 HTTP를 모른다. */
export type PrepareOutcome =
  | { readonly kind: 'parse_error'; readonly error: QueryParseError }
  /**
   * 질의가 커밋만 지목했다 (CR-053, FR-STAT-001 AC-6).
   *
   * **0건으로 답하지 않는다.** 집계 대상은 PR이므로 `kind:commit`은 "결과가
   * 없다"가 아니라 **물음 자체가 이 API의 것이 아니다**. 조용한 0건은 이
   * 저장소가 반복해서 고쳐 온 실패이며(DEV-364), 여기서 되풀이하지 않는다.
   */
  | { readonly kind: 'population_empty' }
  /** 시퀀스 문맥이 거절했다. 사유는 `/search`와 같은 문자열이다. */
  | { readonly kind: 'sequence'; readonly outcome: SequenceContextOutcome }
  /**
   * `mnum:`이 있는데 M 번호 기능이 꺼져 있다 (CR-106).
   *
   * 판정만 옮긴다 — 응답 모양(`QUERY_SYNTAX_ERROR`, 제외된 `supported_keys`)은
   * `/search`와 같은 문구를 쓰도록 라우트가 `checkMergeNumberFeatureFlag`로 만든다.
   */
  | { readonly kind: 'merge_number_disabled' }
  /** `pr_number:`가 저장소를 지목하지 못했다. 사유는 `/search`와 같은 문자열이다. */
  | { readonly kind: 'pr_number_binding'; readonly binding: Extract<RepositoryBindingAnalysis, { kind: 'invalid' }> }
  /** `mnum:` 공간 판정이 거절했다. 사유는 `/search`와 같은 문자열이다. */
  | { readonly kind: 'merge_number_range'; readonly outcome: Extract<MergeNumberRangeOutcome, { kind: 'unbindable' | 'space_unavailable' }> }
  | {
      readonly kind: 'ready';
      readonly ast: QueryAst;
      readonly target: readonly EntityAlias[];
      readonly scoped: ScopedQuery;
      readonly unresolved: readonly UnresolvedName[];
      readonly sequenceEpoch: number | null;
    };

/**
 * 집계 질의를 만든다.
 *
 * @returns `ready`면 `scoped`가 강제 접근 범위 필터를 이미 지난 질의다.
 *   그 밖은 조회하지 않고 그대로 답할 판정이다.
 */
export async function prepareAnalyticsQuery(
  input: PrepareInput,
  deps: PrepareDeps,
): Promise<PrepareOutcome> {
  let ast: QueryAst;
  try {
    ast = parseQuery(input.rawQuery);
  } catch (error) {
    if (error instanceof QueryParseError) return { kind: 'parse_error', error };
    throw error;
  }

  /*
   * `kind:` 필터를 모집단에 반영한다 (CR-053, DEV-383).
   *
   * 집계의 바닥은 PR 하나이므로, `kind:commit`은 교집합을 비운다. `null`이
   * 나오면 이 API가 답할 물음이 아니다.
   */
  const { target, ast: scopedAst } = resolveSearchTarget(ast, ANALYTICS_TARGET);
  if (target === null) return { kind: 'population_empty' };

  /*
   * 접근 범위는 **호출 측이 이미 한 번 산출해 넘긴다** (CR-043, DEV-272).
   * 여기서 다시 부르면 같은 요청 안에서 두 값이 어긋날 여지가 생긴다.
   */
  const sequence = await resolveSequenceContext(deps.pool, {
    ast,
    rawEpoch: input.rawEpoch,
    scope: input.scope,
  });
  if (sequence.kind !== 'none' && sequence.kind !== 'bound') {
    return { kind: 'sequence', outcome: sequence };
  }

  /*
   * `pr_number:`·`mnum:` (CR-106). `/search`와 같은 파서를 공유하므로 같은
   * 판정을 거친다 — 이 판정 없이 `mnum:`을 그대로 두면 아래 `buildQuery`가
   * `MergeNumberEpochRequiredError`를 던지고, 이 함수를 부르는 라우트 어디에도
   * 그 오류를 잡는 코드가 없어 처리되지 않은 500이 된다(독립 검토가 실측).
   */
  if (!input.mergeNumberEnabled && hasMergeNumberRangeFilter(ast)) {
    return { kind: 'merge_number_disabled' };
  }
  const prNumberBinding = analyzePrNumberBinding(ast);
  if (prNumberBinding.kind === 'invalid') {
    return { kind: 'pr_number_binding', binding: prNumberBinding };
  }
  const mergeNumberRange = await resolveMergeNumberRangeEpoch(
    deps.pool,
    { ast, scope: input.scope },
    sequence.kind === 'bound'
      ? { repository: sequence.context.repository, baseBranch: sequence.context.base_branch, epoch: sequence.context.seq_epoch }
      : undefined,
  );
  if (mergeNumberRange.kind === 'unbindable' || mergeNumberRange.kind === 'space_unavailable') {
    return { kind: 'merge_number_range', outcome: mergeNumberRange };
  }

  const resolution = await deps.resolveNames(collectNames(scopedAst));
  const sequenceEpoch = sequence.kind === 'bound' ? sequence.epoch : null;
  const mergeNumberEpoch = mergeNumberRange.kind === 'bound' ? mergeNumberRange.epoch : null;
  const built = buildQuery(
    // `kind:`가 걷어내진 AST다 — 남기면 `buildQuery`가 던진다 (CR-053).
    scopedAst,
    resolution,
    /*
     * `seq:`/`mnum:` 범위가 있는데 대응 에폭이 없으면 `buildQuery`가 던진다
     * (CR-051, CR-106). 조용히 모든 세대를 함께 집계하는 것보다 조립 오류를
     * 드러내는 편이 낫다.
     */
    {
      ...(sequenceEpoch === null ? {} : { sequenceEpoch }),
      ...(mergeNumberEpoch === null ? {} : { mergeNumberEpoch }),
    },
  );

  /*
   * 강제 필터 결합에 우회 경로가 없다 (ADR-008).
   *
   * **목록에서 이미 걸렀다는 이유로 생략하지 않는다** — 건수도 정보이고,
   * 생략을 한 번 허용하면 그 자리가 곧 우회 경로가 된다 (`CR-052`가 아카이브
   * 조회에서 내린 판단과 같다).
   */
  return {
    kind: 'ready',
    ast,
    target,
    scoped: applyMandatoryScopeFilter(built.query, input.scope),
    unresolved: built.unresolved,
    sequenceEpoch,
  };
}
