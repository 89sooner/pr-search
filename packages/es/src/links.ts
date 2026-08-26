/**
 * 참조 간선 쓰기·조회 (WP-029 / CR-039).
 *
 * ## 왜 조건부 업서트를 쓰지 않는가
 *
 * `bulkUpsert`의 스크립트는 `document_version`이 더 클 때만 대입한다. 그 규칙은
 * "같은 엔티티의 더 새로운 상태가 이긴다"를 지키기 위한 것인데, 간선에는
 * `document_version`이라는 개념이 없다 — 매핑에 필드 자체가 없다. 간선은 **현재
 * 정본에서 매번 다시 계산되는 파생물**이며, 그 계산 결과가 언제나 최신이다.
 *
 * 그래서 간선은 통째로 색인한다. 대신 **해결 상태를 잃지 않도록** 파생이 매번
 * 해결까지 다시 시도한다 (`JOB-REL-001`). 파생이 해결을 다시 하지 않으면 재파생이
 * `resolved: true`를 `false`로 되돌려 버린다.
 *
 * ## 접근 통제
 *
 * 간선의 접근 범위는 **근거를 소유한 저장소**(`from` 쪽)의 것이다 (THR-034).
 * `to_repository_id`가 다른 저장소를 가리켜도 이 값은 바뀌지 않는다. 그러므로
 * 대상의 **내용**을 반환하는 조회(WP-031)는 대상 접근 범위를 다시 교집합해야 한다.
 *
 * 접근 통제 material은 **문서 생성 시점에 함께** 넣는다. 먼저 만들고 나중에
 * 채우면 그 사이 강제 필터가 그 문서를 거를 수 없다 (THR-035, fail closed).
 */

import type { Client, estypes } from '@elastic/elasticsearch';

/** 간선 인덱스 별칭. */
export const LINKS_ALIAS = 'prs-links';

/** WP-029가 만드는 유일한 간선 유형. */
export const REFERENCE_LINK_TYPE = 'references' as const;

export type LinkEndpointKind = 'pull_request' | 'commit';

/** 근거를 소유한 저장소의 접근 통제 material (ADR-008). */
export interface LinkScopeFields {
  readonly repository_id: number;
  readonly org_id: number;
  readonly visibility: string;
  readonly allowed_team_ids: readonly number[];
}

/** 해결된 대상. 미해결 간선에는 없다. */
export interface ReferenceResolution {
  readonly to_type: LinkEndpointKind;
  readonly to_id: string;
  readonly to_repository_id: number;
}

export interface ReferenceLinkDoc {
  readonly link_id: string;
  readonly reference_key: string;
  readonly scope: LinkScopeFields;
  readonly from_type: LinkEndpointKind;
  readonly from_id: string;
  readonly confidence: 'derived' | 'heuristic';
  readonly evidence: string;
  /**
   * 간선이 처음 만들어진 시각이 아니라 **source의 정본 시각**이다 (CR-039).
   *
   * `now()`를 쓰면 재파생마다 값이 바뀌어 같은 입력이 다른 문서를 만든다 —
   * 결정론적 재구축(ADR-004)이 "같은 정본에서 같은 색인"을 뜻하지 못하게 된다.
   */
  readonly created_at: string;
  readonly resolution: ReferenceResolution | null;
}

export interface LinkWriteFailure {
  readonly link_id: string;
  readonly status: number;
  readonly reason: string;
}

export interface LinkWriteResult {
  readonly written: number;
  readonly failures: readonly LinkWriteFailure[];
}

function toSource(doc: ReferenceLinkDoc): Record<string, unknown> {
  const source: Record<string, unknown> = {
    link_id: doc.link_id,
    reference_key: doc.reference_key,
    repository_id: doc.scope.repository_id,
    org_id: doc.scope.org_id,
    visibility: doc.scope.visibility,
    allowed_team_ids: [...doc.scope.allowed_team_ids],
    from_type: doc.from_type,
    from_id: doc.from_id,
    link_type: REFERENCE_LINK_TYPE,
    confidence: doc.confidence,
    evidence: doc.evidence,
    resolved: doc.resolution !== null,
    created_at: doc.created_at,
  };
  if (doc.resolution !== null) {
    source['to_type'] = doc.resolution.to_type;
    source['to_id'] = doc.resolution.to_id;
    source['to_repository_id'] = doc.resolution.to_repository_id;
  }
  /*
   * `detached`를 넣지 않는다 — WP-030 소유다 (DEV-223). `strict` 매핑에서 값을
   * 두지 않는 것과 `false`를 두는 것은 다른 주장이며, 계산하지 않은 것을
   * `false`로 적으면 "확인했고 아니었다"가 된다.
   */
  return source;
}

/** 참조 간선을 통째로 색인한다. 같은 `link_id`면 덮어쓴다 (멱등). */
export async function writeReferenceLinks(
  client: Client,
  docs: readonly ReferenceLinkDoc[],
  options: { readonly refresh?: boolean } = {},
): Promise<LinkWriteResult> {
  if (docs.length === 0) return { written: 0, failures: [] };

  const operations: unknown[] = [];
  for (const doc of docs) {
    operations.push({
      index: { _index: LINKS_ALIAS, _id: doc.link_id, routing: String(doc.scope.repository_id) },
    });
    operations.push(toSource(doc));
  }

  const response = await client.bulk({
    operations: operations as estypes.BulkRequest['operations'],
    ...(options.refresh === true ? { refresh: true } : {}),
  });

  const failures: LinkWriteFailure[] = [];
  for (const item of response.items) {
    const outcome = item.index;
    if (outcome?.error === undefined || outcome.error === null) continue;
    failures.push({
      link_id: outcome._id ?? '',
      status: outcome.status ?? 0,
      reason: outcome.error.type,
    });
  }
  return { written: docs.length - failures.length, failures };
}

/**
 * 이번 파생이 만들지 않은 **이 source의** 참조 간선을 지운다 (DEV-220).
 *
 * 본문에서 참조가 사라지면 간선도 사라져야 한다. 조사 도구에서 없는 참조를
 * 있다고 말하는 것은 있는 참조를 놓치는 것과 같은 등급의 오류다.
 *
 * **먼저 refresh한다** — `delete_by_query`는 색인이 아니라 **검색**으로 대상을
 * 찾는다. `refresh: true` 옵션은 지운 *뒤에* 새로 고치는 것이라 이 문제를 풀지
 * 않는다. 같은 source가 1초 안에 두 번 파생되면 앞 회차가 남긴 간선이 검색에
 * 보이지 않아 영영 지워지지 않는다.
 *
 * `keep`이 비어 있으면 이 source의 참조 간선을 **전부** 지운다 — 본문에서 참조가
 * 모두 사라진 정상 결과다. 호출 측이 **완전한 파생에 성공했을 때만** 부른다.
 */
export async function deleteStaleReferenceLinks(
  client: Client,
  input: {
    readonly repositoryId: number;
    readonly fromType: LinkEndpointKind;
    readonly fromId: string;
    readonly keep: readonly string[];
  },
): Promise<number> {
  await client.indices.refresh({ index: LINKS_ALIAS });

  const filter: estypes.QueryDslQueryContainer[] = [
    { term: { repository_id: input.repositoryId } },
    { term: { link_type: REFERENCE_LINK_TYPE } },
    { term: { from_type: input.fromType } },
    { term: { from_id: input.fromId } },
  ];

  const response = await client.deleteByQuery({
    index: LINKS_ALIAS,
    routing: String(input.repositoryId),
    // 파생이 동시에 같은 문서를 건드리면 다음 회차가 잡는다.
    conflicts: 'proceed',
    refresh: true,
    query: {
      bool: {
        filter,
        ...(input.keep.length === 0 ? {} : { must_not: [{ ids: { values: [...input.keep] } }] }),
      },
    },
  });
  return response.deleted ?? 0;
}

/* ------------------------------------------------------------------------- */
/* 미해결 참조 역방향 조회 (JOB-REL-005)                                       */
/* ------------------------------------------------------------------------- */

export interface UnresolvedLink {
  readonly link_id: string;
  readonly repository_id: number;
  readonly reference_key: string;
}

/**
 * 대상 T를 가리키는 **미해결** 참조만 찾는다.
 *
 * 미해결 간선 전량을 스캔하지 않는다 — `reference_key` 후보는 대상 하나당
 * 최대 일곱(전체 SHA 하나 + 접두 여섯)으로 상한이 있으므로 `terms` 하나면 된다.
 *
 * 후보는 두 형태다. **같은 저장소 형태**(`pr:20`)는 그 저장소의 간선에서만
 * 뜻이 있으므로 `repository_id`로 좁힌다. **저장소를 명시한 형태**
 * (`x:acme/b:pr:20`)는 어느 저장소의 본문에서든 나올 수 있으므로 좁히지 않는다.
 */
export async function findUnresolvedReferences(
  client: Client,
  input: {
    /** 대상이 속한 저장소. 같은 저장소 형태 후보를 이 저장소로 좁힌다. */
    readonly targetRepositoryId: number;
    readonly sameRepoKeys: readonly string[];
    readonly crossRepoKeys: readonly string[];
    readonly limit?: number;
  },
): Promise<readonly UnresolvedLink[]> {
  const should: estypes.QueryDslQueryContainer[] = [];
  if (input.sameRepoKeys.length > 0) {
    should.push({
      bool: {
        filter: [
          { term: { repository_id: input.targetRepositoryId } },
          { terms: { reference_key: [...input.sameRepoKeys] } },
        ],
      },
    });
  }
  if (input.crossRepoKeys.length > 0) {
    should.push({ terms: { reference_key: [...input.crossRepoKeys] } });
  }
  if (should.length === 0) return [];

  const response = await client.search<UnresolvedLink>({
    index: LINKS_ALIAS,
    size: input.limit ?? 500,
    _source: ['link_id', 'repository_id', 'reference_key'],
    query: {
      bool: {
        minimum_should_match: 1,
        should,
        filter: [{ term: { link_type: REFERENCE_LINK_TYPE } }, { term: { resolved: false } }],
      },
    },
  });

  const links: UnresolvedLink[] = [];
  for (const hit of response.hits.hits) {
    if (hit._source === undefined) continue;
    links.push(hit._source);
  }
  return links;
}

/**
 * 미해결 간선을 해결 상태로 **갱신**한다 (FR-REL-003 AC-3).
 *
 * `link_id`는 그대로다 — 그것이 `reference_key`를 ID 재료로 쓴 이유다 (DEV-217).
 * 부분 갱신이라 `evidence`·`confidence`·`created_at`을 건드리지 않는다.
 */
export async function resolveReferenceLinks(
  client: Client,
  updates: readonly {
    readonly link_id: string;
    readonly repository_id: number;
    readonly resolution: ReferenceResolution;
  }[],
  options: { readonly refresh?: boolean } = {},
): Promise<LinkWriteResult> {
  if (updates.length === 0) return { written: 0, failures: [] };

  const operations: unknown[] = [];
  for (const update of updates) {
    operations.push({
      update: {
        _index: LINKS_ALIAS,
        _id: update.link_id,
        routing: String(update.repository_id),
        retry_on_conflict: 3,
      },
    });
    operations.push({
      doc: {
        resolved: true,
        to_type: update.resolution.to_type,
        to_id: update.resolution.to_id,
        to_repository_id: update.resolution.to_repository_id,
      },
    });
  }

  const response = await client.bulk({
    operations: operations as estypes.BulkRequest['operations'],
    ...(options.refresh === true ? { refresh: true } : {}),
  });

  const failures: LinkWriteFailure[] = [];
  for (const item of response.items) {
    const outcome = item.update;
    if (outcome?.error === undefined || outcome.error === null) continue;
    failures.push({
      link_id: outcome._id ?? '',
      status: outcome.status ?? 0,
      reason: outcome.error.type,
    });
  }
  return { written: updates.length - failures.length, failures };
}

/* ------------------------------------------------------------------------- */
/* 대상 해석 (JOB-REL-001이 파생 중에 부른다)                                  */
/* ------------------------------------------------------------------------- */

export type TargetLookup =
  | { readonly key: string; readonly kind: 'pull_request'; readonly repositoryId: number; readonly prNumber: number }
  | { readonly key: string; readonly kind: 'commit'; readonly repositoryId: number; readonly sha: string }
  | { readonly key: string; readonly kind: 'commit_prefix'; readonly repositoryId: number; readonly prefix: string };

/**
 * 참조 대상이 **색인되었는지** 찾는다 (FR-REL-003 AC-3의 판정 기준).
 *
 * 왕복은 한 번이다 — `msearch`로 묶는다. 접두는 후보를 **둘까지** 가져온다:
 * 하나면 유일, 둘이면 모호다. 모호하면 해결하지 않는다 — 첫 결과를 임의로 고르면
 * 조사 도구가 자신 있게 틀린 답을 낸다 (ADR-012).
 */
export async function findReferenceTargets(
  client: Client,
  lookups: readonly TargetLookup[],
): Promise<ReadonlyMap<string, ReferenceResolution>> {
  const resolved = new Map<string, ReferenceResolution>();
  if (lookups.length === 0) return resolved;

  const prs = lookups.filter((l): l is Extract<TargetLookup, { kind: 'pull_request' }> => l.kind === 'pull_request');
  const commits = lookups.filter((l): l is Extract<TargetLookup, { kind: 'commit' }> => l.kind === 'commit');
  const prefixes = lookups.filter(
    (l): l is Extract<TargetLookup, { kind: 'commit_prefix' }> => l.kind === 'commit_prefix',
  );

  const bodies: estypes.MsearchRequestItem[] = [];
  const shapes: Array<{ readonly kind: 'pull_request' | 'commit' } | { readonly kind: 'prefix'; readonly key: string; readonly repositoryId: number }> = [];

  if (prs.length > 0) {
    bodies.push({ index: 'prs-pull-requests' });
    bodies.push({
      size: prs.length,
      _source: ['repository_id', 'pr_number'],
      query: {
        bool: {
          minimum_should_match: 1,
          should: prs.map((l) => ({
            bool: { filter: [{ term: { repository_id: l.repositoryId } }, { term: { pr_number: l.prNumber } }] },
          })),
        },
      },
    } as estypes.MsearchRequestItem);
    shapes.push({ kind: 'pull_request' });
  }

  if (commits.length > 0) {
    bodies.push({ index: 'prs-commits' });
    bodies.push({
      size: commits.length,
      _source: ['repository_id', 'commit_sha'],
      query: {
        bool: {
          minimum_should_match: 1,
          should: commits.map((l) => ({
            bool: { filter: [{ term: { repository_id: l.repositoryId } }, { term: { commit_sha: l.sha } }] },
          })),
        },
      },
    } as estypes.MsearchRequestItem);
    shapes.push({ kind: 'commit' });
  }

  for (const lookup of prefixes) {
    bodies.push({ index: 'prs-commits' });
    bodies.push({
      // 둘이면 모호다. 셋 이상인지는 알 필요가 없다 — 판정이 같다.
      size: 2,
      _source: ['repository_id', 'commit_sha'],
      query: {
        bool: {
          filter: [
            { term: { repository_id: lookup.repositoryId } },
            { prefix: { commit_sha: lookup.prefix } },
          ],
        },
      },
    } as estypes.MsearchRequestItem);
    shapes.push({ kind: 'prefix', key: lookup.key, repositoryId: lookup.repositoryId });
  }

  if (bodies.length === 0) return resolved;

  const response = await client.msearch<{ repository_id: number; pr_number?: number; commit_sha?: string }>({
    searches: bodies,
  });

  const byPr = new Map<string, string>();
  const byCommit = new Map<string, string>();

  response.responses.forEach((result, index) => {
    const shape = shapes[index];
    if (shape === undefined) return;
    if (!('hits' in result)) return;

    if (shape.kind === 'prefix') {
      const hits = result.hits.hits;
      // 0건이면 아직 없는 것, 2건 이상이면 모호한 것. 둘 다 미해결이 정답이다.
      if (hits.length !== 1) return;
      const hit = hits[0]!;
      if (hit._source === undefined || hit._id === undefined) return;
      resolved.set(shape.key, {
        to_type: 'commit',
        to_id: hit._id,
        to_repository_id: hit._source.repository_id,
      });
      return;
    }

    for (const hit of result.hits.hits) {
      if (hit._source === undefined || hit._id === undefined) continue;
      if (shape.kind === 'pull_request' && hit._source.pr_number !== undefined) {
        byPr.set(`${String(hit._source.repository_id)}:${String(hit._source.pr_number)}`, hit._id);
      }
      if (shape.kind === 'commit' && hit._source.commit_sha !== undefined) {
        byCommit.set(`${String(hit._source.repository_id)}:${hit._source.commit_sha}`, hit._id);
      }
    }
  });

  for (const lookup of prs) {
    const docId = byPr.get(`${String(lookup.repositoryId)}:${String(lookup.prNumber)}`);
    if (docId === undefined) continue;
    resolved.set(lookup.key, { to_type: 'pull_request', to_id: docId, to_repository_id: lookup.repositoryId });
  }
  for (const lookup of commits) {
    const docId = byCommit.get(`${String(lookup.repositoryId)}:${lookup.sha}`);
    if (docId === undefined) continue;
    resolved.set(lookup.key, { to_type: 'commit', to_id: docId, to_repository_id: lookup.repositoryId });
  }

  return resolved;
}

/* ------------------------------------------------------------------------- */
/* 핫패스 비정규화 (`link_summary.reference_count`, `links_pending`)            */
/* ------------------------------------------------------------------------- */

/**
 * **leaf 하나만 대입한다** (CR-039, DEV-222).
 *
 * `bulkUpsert`의 조건부 스크립트는 `ctx._source[key] = value`로 객체를 통째
 * 바꾼다. `link_summary`를 그렇게 쓰면 WP-030이 써 둔 네 값(`has_revert`·
 * `is_reverted`·`has_cherry_pick`·`has_stack`)이 사라진다.
 *
 * 숫자는 `equals`로 비교하지 않는다 — painless에서 `Integer(3).equals(Long(3))`은
 * 거짓이고, 그러면 값이 같은데도 매번 갱신으로 세어진다.
 */
export const LINK_SUMMARY_SCRIPT = [
  'if (ctx._source.link_summary == null) { ctx._source.link_summary = new HashMap(); }',
  'boolean changed = false;',
  /*
   * **참조 수는 셌을 때만 쓴다.** 완결을 보장할 수 없는 회차(정본 부재·추출 실패·
   * 쓰기 실패)는 `links_pending`만 세우고 수는 건드리지 않는다 — 세지 못한 것을
   * 어떤 값으로든 적으면 그 값이 거짓말이 된다.
   */
  'if (params.reference_count != null) {',
  '  def cur = ctx._source.link_summary.reference_count;',
  '  int next = params.reference_count;',
  '  if (cur == null || ((Number)cur).intValue() != next) {',
  '    ctx._source.link_summary.reference_count = next; changed = true;',
  '  }',
  '}',
  'if (ctx._source.links_pending != params.links_pending) {',
  '  ctx._source.links_pending = params.links_pending; changed = true;',
  '}',
  "if (!changed) { ctx.op = 'noop'; }",
].join('\n');

export interface LinkSummaryUpdate {
  readonly alias: 'prs-pull-requests' | 'prs-commits';
  readonly docId: string;
  readonly repositoryId: number;
  /** 생략하면 참조 수를 건드리지 않는다 — 세지 못한 회차의 정직한 표현이다. */
  readonly referenceCount?: number;
  readonly linksPending: boolean;
}

export type LinkSummaryResult = 'updated' | 'noop' | 'missing';

/**
 * source 문서의 관계 요약을 갱신한다.
 *
 * **문서를 만들지 않는다.** source 문서는 투영(또는 커밋 보강)이 만든다 — 여기서
 * 만들면 접근 통제 material 없는 문서가 생긴다. 없으면 `missing`이며, 그것은
 * 실패가 아니라 "아직 색인되지 않았다"는 사실이다.
 */
export async function updateLinkSummary(
  client: Client,
  input: LinkSummaryUpdate,
  options: { readonly refresh?: boolean } = {},
): Promise<LinkSummaryResult> {
  try {
    const response = await client.update({
      index: input.alias,
      id: input.docId,
      routing: String(input.repositoryId),
      retry_on_conflict: 3,
      ...(options.refresh === true ? { refresh: true } : {}),
      script: {
        lang: 'painless',
        source: LINK_SUMMARY_SCRIPT,
        params: {
          reference_count: input.referenceCount ?? null,
          links_pending: input.linksPending,
        },
      },
    });
    return response.result === 'noop' ? 'noop' : 'updated';
  } catch (error) {
    if (isNotFound(error)) return 'missing';
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  const shape = error as { statusCode?: number; meta?: { statusCode?: number } };
  return shape.statusCode === 404 || shape.meta?.statusCode === 404;
}
