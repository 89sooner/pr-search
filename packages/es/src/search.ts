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

export async function search<TDocument>(
  client: Client,
  alias: EntityAlias,
  query: ScopedQuery,
  options: ScopedSearchOptions = {},
): Promise<estypes.SearchResponse<TDocument>> {
  return client.search<TDocument>({ ...options, index: alias, query });
}
