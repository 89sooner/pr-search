/**
 * 필터 완화 후보 (FR-SRCH-006 AC-3, CR-016 DEV-055).
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
 */

import {
  applyMandatoryScopeFilter,
  buildQuery,
  multiSearch,
  type AccessScope,
  type NameResolution,
  type SearchTarget,
} from '@prs/es';
import { serializeQuery, type QueryAst, type QueryFilter } from '@prs/query';
import type { Client } from '@elastic/elasticsearch';

/**
 * 후보 상한 (CR-016, DEV-055).
 *
 * 여덟을 넘는 필터를 건 사용자에게 여덟 개보다 많은 제안을 해 봐야 읽지
 * 않는다. 상한을 넘으면 잘랐다는 사실을 응답에 남긴다 — 조용한 절삭은
 * "이것이 전부"로 읽힌다.
 */
export const MAX_RELAXATION_HINTS = 8;

export interface RelaxationHint {
  /** 제거 대상 필터를 질의 문자열 조각으로 되돌린 것. 화면이 그대로 보여 준다. */
  readonly remove: string;
  /** 그 필터를 뺐을 때의 건수. */
  readonly would_yield: number;
}

export interface RelaxationResult {
  readonly hints: readonly RelaxationHint[];
  /** 상한에 걸려 후보를 다 세지 못했는가. */
  readonly truncated: boolean;
}

export const NO_RELAXATION: RelaxationResult = { hints: [], truncated: false };

/** 필터 하나를 뺀 AST. */
function without(ast: QueryAst, index: number): QueryAst {
  return { ...ast, filters: ast.filters.filter((_, at) => at !== index) };
}

/** 제거 대상을 사용자가 쓴 문법으로 되돌린다. */
function describe(filter: QueryFilter): string {
  return serializeQuery({ filters: [filter], text: null });
}

export interface RelaxationDeps {
  readonly es: Client;
  readonly target: SearchTarget;
  readonly scope: AccessScope;
  readonly resolution: NameResolution;
}

/**
 * 후보를 센다.
 *
 * 필터가 하나뿐이면 계산하지 않는다 — 그것을 빼면 조건 없는 조회가 되고,
 * "필터를 전부 지우면 결과가 나옵니다"는 도움이 되지 않는다.
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
  const candidates = ast.filters.slice(0, MAX_RELAXATION_HINTS);

  const requests = candidates.map((_, index) => ({
    target: deps.target,
    query: applyMandatoryScopeFilter(buildQuery(without(ast, index), deps.resolution).query, deps.scope),
    // 건수만 필요하다. 문서를 실어 오면 완화 계산이 본 조회보다 무거워진다.
    options: { size: 0, track_total_hits: true } as const,
  }));

  const response = await multiSearch<unknown>(deps.es, requests);

  const hints: RelaxationHint[] = [];
  response.responses.forEach((one, index) => {
    // 한 갈래가 실패해도 나머지 후보는 쓸 수 있다. 완화 제안은 부가 정보이므로
    // 여기서 던져 본 조회의 200을 500으로 바꾸지 않는다.
    if (!('hits' in one)) return;

    const total = one.hits.total;
    const value = typeof total === 'number' ? total : (total?.value ?? 0);
    if (value === 0) return;

    const filter = candidates[index];
    if (filter === undefined) return;
    hints.push({ remove: describe(filter), would_yield: value });
  });

  // 많이 나오는 것부터. 사용자가 가장 크게 잘못 건 조건이 위로 온다.
  hints.sort((left, right) => right.would_yield - left.would_yield);

  return { hints, truncated };
}
