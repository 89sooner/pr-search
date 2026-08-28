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
import type { ArchiveAlias } from './archive.js';
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
export type SearchTarget = EntityAlias | ArchiveAlias | readonly EntityAlias[];

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

/**
 * 커서 순회가 딛고 서는 색인 스냅숏 (WP-032 / ADR-010 Amendment, CR-044 DEV-286).
 *
 * ## 왜 정렬 키와 무관하게 필요한가
 *
 * `search_after`는 "정렬 값이 이 커서보다 뒤"라는 조건이다. 어떤 문서의 정렬
 * 값이 페이지 **사이에** 움직이면 그 문서는 두 번 나오거나 영영 나오지 않는다.
 *
 * 정렬 키가 문서 자신의 필드라는 것은 그 값이 불변이라는 뜻이 아니다. 여덟 키
 * 중 움직이지 않는 것은 `created_at` 하나뿐이다 — `updated_at`은 모든 PR 갱신
 * 웹훅이, `changed_files_count`·`additions`는 보강 완료가, `lead_time_seconds`는
 * 머지 시각 확정이, `merged_at`은 미머지 PR의 머지가(`missing: _last` 무리에서
 * 정렬 구간으로 들어온다), `merge_seq`는 에폭 상향이 움직인다. `relevance`에는
 * 이유가 하나 더 있다: 값이 아니라 **계산 근거**(BM25 term statistics)가 움직인다.
 *
 * CR-043은 처음에 키별로 갈랐다가 CR-044에서 되물렸다 — 판정이 필요한 규칙은
 * 판정하는 사람이 틀릴 때마다 깨지고, 그 판정의 첫 시도가 이미 틀렸다.
 */
export const PIT_KEEP_ALIVE = '5m' as const;

export async function openPointInTime(client: Client, target: SearchTarget): Promise<string> {
  const response = await client.openPointInTime({
    index: toIndex(target),
    keep_alive: PIT_KEEP_ALIVE,
  });
  return response.id;
}

/**
 * PIT을 닫는다. **실패해도 던지지 않는다.**
 *
 * 마지막 페이지를 이미 만든 뒤에 부르는 정리 작업이다. 여기서 던지면 완성된
 * 응답이 500이 된다 — 사용자가 받을 결과를 청소 실패 때문에 버리는 셈이다.
 * 닫지 못한 PIT은 `keep_alive`가 지나면 스스로 사라진다.
 */
export async function closePointInTime(client: Client, id: string): Promise<boolean> {
  try {
    const response = await client.closePointInTime({ id });
    return response.succeeded;
  } catch {
    return false;
  }
}

/**
 * PIT 위에서 조회한다 (WP-032).
 *
 * **`index`를 함께 주지 않는다.** PIT이 이미 대상을 담고 있어 둘을 함께 주면
 * Elasticsearch가 요청을 거절한다. 그래서 `search`와 별도 함수다 — 하나로 묶고
 * 분기하면 다음 호출부가 둘 다 넘긴다.
 */
export async function searchWithPit<TDocument>(
  client: Client,
  pitId: string,
  query: ScopedQuery,
  options: ScopedSearchOptions = {},
): Promise<estypes.SearchResponse<TDocument>> {
  return client.search<TDocument>({
    ...options,
    pit: { id: pitId, keep_alive: PIT_KEEP_ALIVE },
    query,
  });
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
    /*
     * `routing`은 **헤더 줄**로 옮긴다 (WP-023, DEV-141).
     *
     * `search` API에서는 클라이언트가 `routing`을 쿼리스트링으로 올려 주지만,
     * `msearch`의 옵션은 해석 없이 NDJSON 본문 줄에 그대로 실린다. 본문에
     * `routing`이 있으면 Elasticsearch가 요청 전체를 400으로 거절한다 —
     * 대역 시험은 통과하고 실제 색인에서만 터지는 모양이라, CI의 실-ES
     * 계층(`range-es.test.ts`)이 처음 잡았다.
     */
    const { routing, ...body } = request.options ?? {};
    searches.push({ index: toIndex(request.target), ...(routing === undefined ? {} : { routing }) });
    searches.push({ ...body, query: request.query } as estypes.MsearchRequestItem);
  }

  return client.msearch<TDocument>({ searches });
}
