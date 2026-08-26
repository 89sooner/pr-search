/**
 * 관계 간선 조회 (API-REL-006 / WP-031, CR-042).
 *
 * ## 접근 통제가 세 번 걸린다 (THR-034, DEV-253)
 *
 * 1. **앵커 해석** — 강제 접근 범위 필터를 지난 조회. 없거나 범위 밖이면 `null`을
 *    돌려주고 라우트가 404로 옮긴다. 403이면 "있지만 못 본다"가 새어 존재가
 *    드러난다 (THR-004).
 * 2. **간선 조회** — 간선 문서가 source 저장소의 통제 material을 싣고 있으므로
 *    같은 필터가 그대로 성립한다 (THR-035).
 * 3. **대상 내용 조회** — 간선이 보인다고 대상의 제목·작성자를 볼 수 있는 것은
 *    아니다. 저장소를 건너뛰는 참조에서 그 둘은 **다른 저장소**다. 대상 문서를
 *    강제 필터를 지난 batch 조회로 따로 읽고, 나오지 않으면 내용 필드를 **두지
 *    않는다**(키 부재). `mget`으로 지름길을 내지 않는다 — 그것이 정확히
 *    THR-034가 막으려는 유출이다.
 */

import type { Client } from '@elastic/elasticsearch';
import {
  applyMandatoryScopeFilter,
  assertNoShardFailures,
  commitDetailQuery,
  pullRequestDetailQuery,
  search,
  searchRelationLinks,
  type AccessScope,
  type RelationDirection,
  type RelationLinkHit,
} from '@prs/es';
import { parseReferenceKey } from '@prs/domain';

const PR_ALIAS = 'prs-pull-requests' as const;
const COMMIT_ALIAS = 'prs-commits' as const;

/** 이 API가 조회하는 간선 유형. `co_changes`·`precedes`는 저장하지 않는다 (ADR-009). */
export const RELATION_LINK_TYPES = ['references', 'reverts', 'cherry_picks', 'stacks_on'] as const;
export type RelationLinkType = (typeof RELATION_LINK_TYPES)[number];

export function isRelationLinkType(value: string): value is RelationLinkType {
  return (RELATION_LINK_TYPES as readonly string[]).includes(value);
}

export type EndpointKind = 'pull_request' | 'commit';

export type RelationAnchorInput =
  | { readonly kind: 'pull_request'; readonly prNumber: number }
  | { readonly kind: 'commit'; readonly commitSha: string };

export interface RelationDeps {
  readonly es: Client;
  readonly timeoutMs?: number;
}

interface AnchorDocument {
  readonly repository_id?: number;
  readonly repository?: string;
  readonly pr_number?: number;
  readonly commit_sha?: string;
}

interface TargetDocument {
  readonly doc_id?: string;
  readonly repository?: string;
  readonly pr_number?: number;
  readonly commit_sha?: string;
  readonly title?: string;
  readonly message?: string;
  readonly author?: string;
}

export interface ResolvedAnchor {
  readonly kind: EndpointKind;
  readonly repository: string;
  readonly repositoryId: number;
  readonly docId: string;
  readonly prNumber?: number;
  readonly commitSha?: string;
}

/**
 * **`stacks_on`은 PR↔PR 관계다** (FR-REL-006). 커밋 앵커로 물으면 서버가 거절한다 —
 * 빈 배열로 답하면 "관계 없음"으로 읽히는데, 실제로는 **물을 수 없는 질문**이다.
 * 없는 것과 아닌 것은 다른 주장이다 (CR-041이 `has_stack`에 대해 세운 규율).
 */
export function supportsAnchorKind(linkType: RelationLinkType, kind: EndpointKind): boolean {
  return linkType !== 'stacks_on' || kind === 'pull_request';
}

/** 신뢰도 표시 순서. 같은 정본에서 같은 순서를 내기 위해 `link_id`로 동률을 깬다. */
const CONFIDENCE_RANK: Readonly<Record<string, number>> = { exact: 0, derived: 1, heuristic: 2 };

function rankOf(confidence: string): number {
  return CONFIDENCE_RANK[confidence] ?? 3;
}

/** 앵커를 강제 접근 범위 필터로 해석한다. 없거나 범위 밖이면 `null`. */
export async function resolveRelationAnchor(
  repository: string,
  anchor: RelationAnchorInput,
  scope: AccessScope,
  deps: RelationDeps,
): Promise<ResolvedAnchor | null> {
  const isPr = anchor.kind === 'pull_request';
  const query = isPr
    ? pullRequestDetailQuery(repository, anchor.prNumber)
    : commitDetailQuery(repository, anchor.commitSha.toLowerCase());

  const response = await search<AnchorDocument>(
    deps.es,
    isPr ? PR_ALIAS : COMMIT_ALIAS,
    applyMandatoryScopeFilter(query, scope),
    {
      size: 1,
      _source: ['repository_id', 'repository', 'pr_number', 'commit_sha'],
      ...(deps.timeoutMs === undefined ? {} : { timeout: `${String(deps.timeoutMs)}ms` }),
    },
  );
  assertNoShardFailures(response);

  const source = response.hits.hits[0]?._source;
  if (source?.repository_id === undefined) return null;

  if (isPr) {
    if (source.pr_number === undefined) return null;
    return {
      kind: 'pull_request',
      repository: source.repository ?? repository,
      repositoryId: source.repository_id,
      docId: `${String(source.repository_id)}:${String(source.pr_number)}`,
      prNumber: source.pr_number,
    };
  }

  const sha = source.commit_sha ?? anchor.commitSha.toLowerCase();
  return {
    kind: 'commit',
    repository: source.repository ?? repository,
    repositoryId: source.repository_id,
    docId: `${String(source.repository_id)}:${sha}`,
    commitSha: sha,
  };
}

/** 반대쪽 끝점. `outgoing`이면 `to`, `incoming`이면 `from`이다. */
function otherEndpoint(
  hit: RelationLinkHit,
  direction: RelationDirection,
): { readonly kind: EndpointKind; readonly docId: string } | null {
  if (direction === 'outgoing') {
    if (hit.to_type === undefined || hit.to_id === undefined) return null;
    return { kind: hit.to_type, docId: hit.to_id };
  }
  if (hit.from_type === undefined || hit.from_id === undefined) return null;
  return { kind: hit.from_type, docId: hit.from_id };
}

/**
 * 대상 문서를 **종류별 한 왕복**으로 읽는다 (N+1 아님, DEV-253).
 *
 * 강제 접근 범위 필터를 지난다. 나오지 않은 ID는 볼 수 없거나 아직 색인되지
 * 않은 것이며, **둘을 응답에서 구분하지 않는다** — 구분하는 순간 존재 여부가
 * 샌다.
 */
async function loadTargets(
  alias: typeof PR_ALIAS | typeof COMMIT_ALIAS,
  docIds: readonly string[],
  scope: AccessScope,
  deps: RelationDeps,
): Promise<ReadonlyMap<string, TargetDocument>> {
  const out = new Map<string, TargetDocument>();
  if (docIds.length === 0) return out;

  const response = await search<TargetDocument>(
    deps.es,
    alias,
    applyMandatoryScopeFilter({ terms: { doc_id: [...docIds] } }, scope),
    {
      size: docIds.length,
      _source: ['doc_id', 'repository', 'pr_number', 'commit_sha', 'title', 'message', 'author'],
      ...(deps.timeoutMs === undefined ? {} : { timeout: `${String(deps.timeoutMs)}ms` }),
    },
  );
  assertNoShardFailures(response);

  for (const hit of response.hits.hits) {
    const source = hit._source;
    if (source?.doc_id !== undefined) out.set(source.doc_id, source);
  }
  return out;
}

/** `reference_key`를 사람이 읽는 원 표현으로 되돌린다. 대상을 못 볼 때의 표시값이다. */
export function referenceExpression(key: string): string | undefined {
  const target = parseReferenceKey(key);
  if (target === null) return undefined;
  const slug = target.repo === null ? '' : `${target.repo.owner}/${target.repo.name}`;
  if (target.kind === 'pull_request') return `${slug}#${String(target.number)}`;
  const sha = target.kind === 'commit' ? target.sha : target.prefix;
  return slug === '' ? sha : `${slug}@${sha}`;
}

function firstLine(message: string | undefined): string | undefined {
  if (message === undefined || message === '') return undefined;
  const index = message.indexOf('\n');
  return index < 0 ? message : message.slice(0, index);
}

function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

export interface RelationQueryInput {
  readonly repository: string;
  readonly anchor: RelationAnchorInput;
  readonly linkType: RelationLinkType;
  readonly direction: RelationDirection;
  readonly limit?: number;
}

export interface RelationQueryResult {
  readonly body: Record<string, unknown>;
}

/**
 * API-REL-006 본체.
 *
 * @returns 앵커가 없거나 접근 범위 밖이면 `null`. 라우트가 404로 옮긴다.
 */
export async function getRelations(
  input: RelationQueryInput,
  scope: AccessScope,
  deps: RelationDeps,
): Promise<RelationQueryResult | null> {
  const anchor = await resolveRelationAnchor(input.repository, input.anchor, scope, deps);
  if (anchor === null) return null;

  const page = await searchRelationLinks(deps.es, {
    scope,
    linkType: input.linkType,
    direction: input.direction,
    anchorKind: anchor.kind,
    anchorDocId: anchor.docId,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
  });

  const endpoints = page.items.map((hit) => otherEndpoint(hit, input.direction));
  const prIds = new Set<string>();
  const commitIds = new Set<string>();
  for (const endpoint of endpoints) {
    if (endpoint === null) continue;
    (endpoint.kind === 'pull_request' ? prIds : commitIds).add(endpoint.docId);
  }

  const [prTargets, commitTargets] = await Promise.all([
    loadTargets(PR_ALIAS, [...prIds], scope, deps),
    loadTargets(COMMIT_ALIAS, [...commitIds], scope, deps),
  ]);

  /*
   * 다중 후보 판정 (FR-REL-004 예외 처리, DEV-261).
   *
   * 저장 계층은 제목 대조 후보를 **좁히지 않는다** (CR-041, DEV-237). 같은 근거
   * 문자열에서 나온 `heuristic` 간선이 둘 이상이면 그것이 곧 "후보가 여럿"이며,
   * 화면이 첫 항목을 확정된 대상처럼 그리면 안 된다는 신호다. 새 저장 필드를
   * 만들지 않고 응답이 이미 싣는 근거로 판정한다.
   */
  const heuristicByEvidence = new Map<string, number>();
  for (const hit of page.items) {
    if (hit.confidence !== 'heuristic') continue;
    heuristicByEvidence.set(hit.evidence, (heuristicByEvidence.get(hit.evidence) ?? 0) + 1);
  }

  const ordered = page.items
    .map((hit, index) => ({ hit, endpoint: endpoints[index] ?? null }))
    .sort((a, b) => {
      const rank = rankOf(a.hit.confidence) - rankOf(b.hit.confidence);
      return rank !== 0 ? rank : a.hit.link_id.localeCompare(b.hit.link_id);
    });

  const items = ordered.map(({ hit, endpoint }) => {
    const target =
      endpoint === null
        ? undefined
        : (endpoint.kind === 'pull_request' ? prTargets : commitTargets).get(endpoint.docId);

    const item: Record<string, unknown> = {
      link_id: hit.link_id,
      link_type: hit.link_type,
      direction: input.direction,
      confidence: hit.confidence,
      evidence: hit.evidence,
      resolved: hit.resolved === true,
      ambiguous:
        hit.confidence === 'heuristic' && (heuristicByEvidence.get(hit.evidence) ?? 0) > 1,
      content_available: target !== undefined,
    };
    // `detached`는 `stacks_on`에만 있다 (CR-041, DEV-238). 없는 것을 `false`로 만들지 않는다.
    put(item, 'detached', hit.detached);

    const endpointBody: Record<string, unknown> = {};
    if (endpoint !== null) endpointBody['kind'] = endpoint.kind;
    if (target !== undefined) {
      put(endpointBody, 'repository', target.repository);
      put(endpointBody, 'pr_number', target.pr_number);
      put(endpointBody, 'commit_sha', target.commit_sha);
      put(endpointBody, 'title', target.title ?? firstLine(target.message));
      put(endpointBody, 'author', target.author);
      if (target.repository !== undefined) {
        if (target.pr_number !== undefined) {
          endpointBody['url'] = `/pr/${target.repository}/${String(target.pr_number)}`;
        } else if (target.commit_sha !== undefined) {
          endpointBody['url'] = `/commit/${target.repository}/${target.commit_sha}`;
        }
      }
    }
    /*
     * 대상을 못 볼 때의 표시값. `references`만 갖는다 — 나머지 셋은 동일 저장소
     * 관계라 앵커가 보이면 대상 저장소도 보인다.
     */
    if (hit.reference_key !== undefined) {
      put(endpointBody, 'reference_expression', referenceExpression(hit.reference_key));
    }
    item['endpoint'] = endpointBody;
    return item;
  });

  const anchorBody: Record<string, unknown> = {
    repository: anchor.repository,
    kind: anchor.kind,
  };
  put(anchorBody, 'pr_number', anchor.prNumber);
  put(anchorBody, 'commit_sha', anchor.commitSha);

  return {
    body: {
      anchor: anchorBody,
      link_type: input.linkType,
      direction: input.direction,
      items,
      truncated: page.truncated,
    },
  };
}
