/**
 * W-001의 조회 경로 선택과 호출 (WP-016 / FLOW-001).
 *
 * ## 어느 API를 부를지는 클라이언트가 정한다
 *
 * `repo:acme/a author:kim`을 `/resolve`로 보내면 "식별자가 아니다"라는
 * 답을 받으려고 왕복을 한 번 버린다. 같은 판별기가 브라우저에서도 돌므로
 * (ADR-001) **부르기 전에** 안다.
 *
 * ## 순수 부분과 I/O를 가른다
 *
 * `chooseRoute`는 순수하다 — 어떤 입력이 어느 경로로 가는지가 FLOW-001의
 * 핵심이고, 그것을 `fetch` 없이 시험할 수 있어야 한다.
 */

import { QUERY_KEYS, detectIdentifier } from '@prs/query';
import { PARAM, type QueryState } from './query-url';

/**
 * 해석 호출의 후보 상한.
 *
 * **50을 명시한다** (CR-019, DEV-080). `/resolve`의 기본값은 10이라 그대로
 * 부르면 11건에서 절삭 표시가 떠 FR-SRCH-004 AC-3이 정한 50 경계와 어긋난다.
 */
export const RESOLVE_LIMIT = 50;

export type SearchRoute =
  /** 식별자로 보인다 — 해석을 먼저 한다 (FLOW-001). */
  | { readonly kind: 'resolve'; readonly input: string }
  /** 구조화 질의나 전문 검색 — 목록을 조회한다. */
  | { readonly kind: 'search' }
  /** 부를 것이 없다. */
  | { readonly kind: 'none' };

/**
 * 어느 경로로 갈지 정한다.
 *
 * **구조화 질의가 이긴다.** `repo:` 같은 키가 하나라도 있으면 그것은 목록
 * 조회이지 식별자 해석이 아니다 — `1234`는 PR 번호지만 `repo:a/b 1234`는
 * "그 저장소에서 1234를 찾아라"에 가깝다.
 */
export function chooseRoute(state: QueryState, gheBaseUrl?: string): SearchRoute {
  const raw = state.q.trim();
  if (raw === '') return { kind: 'none' };

  /*
   * 지원 키가 붙은 토큰이 있으면 질의다. 판별기를 부르지 않는다.
   *
   * **키 목록을 파서에서 가져온다.** 처음에는 `[a-z_]+:` 같은 일반 패턴을
   * 썼는데 그것이 `https://…`의 **스킴에 걸려** 붙여넣은 GHE URL이 전문
   * 검색으로 떨어졌다 (QA-W001-02가 잡았다). 키가 무엇인지는 파서가 아는
   * 것이지 여기서 추측할 것이 아니다 (ADR-001).
   */
  const hasQueryKey = QUERY_KEYS.some((key) =>
    new RegExp(`(^|\\s)-?${key}:`, 'i').test(raw),
  );
  if (hasQueryKey) return { kind: 'search' };

  const detection = detectIdentifier(raw, gheBaseUrl === undefined ? {} : { gheBaseUrl });

  // 판별기가 거절했으면(7자 미만 hex 등) 화면이 이미 막았어야 한다.
  if (detection.rejection !== null) return { kind: 'none' };

  const kinds = new Set(detection.interpretations.map((i) => i.kind));
  if (kinds.has('commit') || kinds.has('pull_request')) return { kind: 'resolve', input: raw };
  return { kind: 'search' };
}

/** 목록 조회 URL. 프록시를 지나 `search-api`의 `/api/v1/search`가 된다. */
export function searchUrl(state: QueryState): string {
  const params = new URLSearchParams();
  params.set(PARAM.query, state.q.trim());
  if (state.sort !== null) params.set(PARAM.sort, state.sort);
  if (state.order !== null) params.set(PARAM.order, state.order);
  if (state.size !== null) params.set(PARAM.size, String(state.size));
  return `/api/search?${params.toString()}`;
}

/** 해석 URL. `limit`을 **명시한다** (DEV-080). */
export function resolveUrl(input: string): string {
  const params = new URLSearchParams({ q: input, limit: String(RESOLVE_LIMIT) });
  return `/api/resolve?${params.toString()}`;
}
