/**
 * 검색 진입점 (ADR-008).
 *
 * `search`는 `ScopedQuery`만 받는다. 접근 범위 필터를 거치지 않은 질의는 타입이
 * 맞지 않아 **컴파일되지 않는다.** 이것이 "필수 접근 범위 필터"를 런타임 검사가
 * 아니라 타입 시스템으로 강제하는 방법이다.
 *
 * 이 파일 밖에서 `client.search()`를 직접 호출하지 않는다. WP-013의 질의 빌더도
 * 최종적으로 여기를 거친다.
 */

import type { Client } from '@elastic/elasticsearch';
import type { estypes } from '@elastic/elasticsearch';
import type { EntityAlias } from './indices.js';
import type { ScopedQuery } from './scoped-query.js';

/** `query`는 별도 인자로 받는다. `SearchRequest.query`로 넘기면 브랜드가 지워진다. */
export type ScopedSearchOptions = Omit<estypes.SearchRequest, 'index' | 'query'>;

/**
 * 조회 대상.
 *
 * 별칭 하나 또는 여럿이다. `/search`는 PR과 커밋을 함께 돈다 (CR-016, DEV-054) —
 * W-001의 결과 표가 두 유형을 한 목록에 보여 주기 때문이다.
 *
 * **여럿을 도는 조회는 정렬에 `unmapped_type`이 필요하다.** 한쪽 인덱스에만 있는
 * 필드로 정렬하면 Elasticsearch가 HTTP 200에 샤드 부분 실패를 붙여 준다.
 * `buildSort`가 그 처리를 하고 `assertNoShardFailures`가 결과를 확인한다.
 */
export type SearchTarget = EntityAlias | readonly EntityAlias[];

function toIndex(target: SearchTarget): string | string[] {
  return typeof target === 'string' ? target : [...target];
}

export async function search<TDocument>(
  client: Client,
  target: SearchTarget,
  query: ScopedQuery,
  options: ScopedSearchOptions = {},
): Promise<estypes.SearchResponse<TDocument>> {
  return client.search<TDocument>({ ...options, index: toIndex(target), query });
}

/** `msearch`의 한 갈래. 질의마다 대상과 옵션이 다를 수 있다. */
export interface ScopedSearchRequest {
  readonly target: SearchTarget;
  readonly query: ScopedQuery;
  readonly options?: ScopedSearchOptions;
}

/**
 * 여러 질의를 한 번의 왕복으로 보낸다.
 *
 * 0건일 때의 완화 후보 산출이 이것을 쓴다 (CR-016, DEV-055). 필터마다 질의를
 * 따로 던지면 왕복이 필터 수만큼 늘어나 NFR-001의 p95 예산을 그만큼 쓴다.
 *
 * `search`와 같은 이유로 `ScopedQuery`만 받는다 — 우회 경로를 하나 더 만들지
 * 않는다.
 */
export async function multiSearch<TDocument>(
  client: Client,
  requests: readonly ScopedSearchRequest[],
): Promise<estypes.MsearchResponse<TDocument>> {
  const searches: estypes.MsearchRequestItem[] = [];

  for (const request of requests) {
    searches.push({ index: toIndex(request.target) });
    searches.push({ ...(request.options ?? {}), query: request.query } as estypes.MsearchRequestItem);
  }

  return client.msearch<TDocument>({ searches });
}
