/**
 * 관계 간선의 **사용자 대면** 조회 (WP-031 / CR-042, DEV-248·250·251·252).
 *
 * ## 왜 `links.ts`가 아니라 여기인가
 *
 * `links.ts`는 ADR-008 가드레일의 허용 목록에 `no_requester`로 올라 있다 —
 * 파생·조정은 이벤트와 운영자 잡이 깨우므로 요청자가 없고, 읽는 것이 사용자에게
 * 나가지 않는 파생 사실이기 때문이다. **그 면제는 파일 단위다.** 사용자에게
 * 내주는 조회를 거기 넣으면 워커용으로 쓴 사유를 그대로 물려받고, 검사기는
 * 아무것도 말하지 않는다 (DEV-265).
 *
 * 그래서 이 파일은 목록 밖에 있고, `search`를 거치므로 `ScopedQuery`가 아닌
 * 질의는 **컴파일되지 않는다.**
 *
 * ## 왜 워커의 `findLinksFrom`/`findLinksTo`를 쓰지 않는가
 *
 * 둘 다 `repositoryId`로 **라우팅**한다. 되돌림·체리픽·스택은 동일 저장소
 * 관계라 그 경로에서는 옳지만, **참조는 저장소를 건너뛴다.** 간선은 근거를
 * 소유한 저장소(source)에 살기 때문에, `acme/b`의 PR을 가리키는 참조를 `b`로
 * 라우팅해 찾으면 `acme/a`가 만든 간선을 **어떤 라우팅으로도 찾을 수 없다**
 * (DEV-250). 그리고 `scrollLinks`는 끝까지 읽어 메모리에 모은다 — 조정에는
 * 옳지만(한 페이지만 읽으면 나머지가 영영 조정되지 않는다) 사용자 요청에는
 * 상한이 필요하다 (DEV-252).
 *
 * ## 라우팅을 아예 쓰지 않는다
 *
 * `outgoing`은 앵커의 저장소로 라우팅해도 옳다 — 간선의 `repository_id`가
 * 앵커의 것이기 때문이다. 그래도 쓰지 않는다. 방향마다 규칙이 갈리면 다음
 * 사람이(또는 내가) `incoming`에도 "최적화"로 라우팅을 넣게 되고, 그 순간
 * 저장소를 건너뛰는 참조가 조용히 사라진다. **경계를 만드는 것은 라우팅이
 * 아니라 강제 접근 범위 필터다.** 대가는 샤드 12개를 도는 것이며, 응답이
 * `limit + 1`로 묶여 있으므로 그 대가가 요청 크기에 비례해 커지지 않는다.
 */

import type { Client } from '@elastic/elasticsearch';
import type { estypes } from '@elastic/elasticsearch';
import { LINKS_ALIAS, type LinkEndpointKind } from './links.js';
import { applyMandatoryScopeFilter, type AccessScope } from './scoped-query.js';
import { search } from './search.js';

/** 한 요청이 돌려주는 기본 건수. */
export const RELATION_LIMIT_DEFAULT = 50;
/** 한 요청의 상한. 넘겨 요청하면 여기로 깎는다. */
export const RELATION_LIMIT_MAX = 100;

export type RelationDirection = 'outgoing' | 'incoming';

/** 사용자에게 나가는 간선 하나. 워커의 `StoredLink`와 **다른 타입이다** (DEV-251). */
export interface RelationLinkHit {
  readonly link_id: string;
  readonly link_type: string;
  /** 근거를 소유한 저장소. `incoming`에서는 반대쪽 끝점의 저장소이기도 하다. */
  readonly repository_id: number;
  readonly confidence: string;
  readonly evidence: string;
  readonly resolved: boolean;
  /** `stacks_on`에만 있다 (CR-041, DEV-238). */
  readonly detached?: boolean;
  /** `references`에만 있다. 대상을 볼 수 없을 때 표시할 원 표현의 재료다. */
  readonly reference_key?: string;
  readonly from_type?: LinkEndpointKind;
  readonly from_id?: string;
  readonly to_type?: LinkEndpointKind;
  readonly to_id?: string;
  readonly to_repository_id?: number;
}

export interface RelationLinkPage {
  readonly items: readonly RelationLinkHit[];
  /** `limit`을 넘는 간선이 더 있다. */
  readonly truncated: boolean;
}

const LINK_READ_FIELDS = [
  'link_id',
  'link_type',
  'repository_id',
  'confidence',
  'evidence',
  'resolved',
  'detached',
  'reference_key',
  'from_type',
  'from_id',
  'to_type',
  'to_id',
  'to_repository_id',
];

/** 요청이 보낸 값을 계약 범위로 깎는다. 거절하지 않는다 — 상한은 서버의 것이다. */
export function clampRelationLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return RELATION_LIMIT_DEFAULT;
  const floored = Math.floor(value);
  if (floored < 1) return 1;
  return Math.min(floored, RELATION_LIMIT_MAX);
}

/**
 * 한 앵커의 한 유형 · 한 방향 간선을 상한 안에서 가져온다.
 *
 * `limit + 1`을 읽어 `truncated`를 판정한다 — "더 있는가"를 별도 왕복으로 묻지
 * 않는다. 정렬은 `link_id` 오름차순이라 같은 정본에서 **같은 페이지**가 나온다
 * (ADR-004).
 */
export async function searchRelationLinks(
  client: Client,
  input: {
    readonly scope: AccessScope;
    readonly linkType: string;
    readonly direction: RelationDirection;
    readonly anchorKind: LinkEndpointKind;
    /** `{repository_id}:{pr_number}` 또는 `{repository_id}:{commit_sha}`. */
    readonly anchorDocId: string;
    readonly limit?: number;
    readonly timeoutMs?: number;
  },
): Promise<RelationLinkPage> {
  const limit = clampRelationLimit(input.limit);

  /*
   * 문서 ID가 `{repository_id}:...`라 전역에서 유일하다 (`pullRequestDocId`·
   * `commitDocId`). 그래서 끝점 조건만으로 충분하고 `to_repository_id`를 함께
   * 걸 이유가 없다 — 걸면 저장소를 건너뛰는 참조에서 옳게 동작하지만 같은
   * 값을 두 번 검사하는 것이고, 나중에 그 조건이 라우팅으로 오해될 여지를 남긴다.
   */
  const endpoint: readonly estypes.QueryDslQueryContainer[] =
    input.direction === 'outgoing'
      ? [{ term: { from_type: input.anchorKind } }, { term: { from_id: input.anchorDocId } }]
      : [{ term: { to_type: input.anchorKind } }, { term: { to_id: input.anchorDocId } }];

  const response = await search<RelationLinkHit>(
    client,
    LINKS_ALIAS,
    applyMandatoryScopeFilter(
      { bool: { filter: [{ term: { link_type: input.linkType } }, ...endpoint] } },
      input.scope,
    ),
    {
      size: limit + 1,
      _source: LINK_READ_FIELDS,
      sort: [{ link_id: 'asc' }],
      ...(input.timeoutMs === undefined ? {} : { timeout: `${String(input.timeoutMs)}ms` }),
    },
  );

  const hits = response.hits.hits;
  const items: RelationLinkHit[] = [];
  for (const hit of hits.slice(0, limit)) {
    if (hit._source !== undefined) items.push(hit._source);
  }
  return { items, truncated: hits.length > limit };
}
