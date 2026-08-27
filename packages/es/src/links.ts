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
import { dualWrite, reportShadowFailure, type WriteTargets } from './write-targets.js';

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

/**
 * 간선 벌크 쓰기의 공통 경로 (WP-035, DEV-295).
 *
 * 서비스 항목 전량을 먼저 싣고 shadow를 그 뒤에 싣는다 — 응답 항목이 요청
 * 순서와 1:1이라 앞 `count`개가 서비스 결과다. **왕복은 한 번**이며, shadow
 * 실패는 `LinkWriteResult`에 섞이지 않는다: 호출부의 재시도 예산과 완결 표식이
 * shadow 때문에 달라지면 안 되고(불변식 6), 그래도 잊혀서는 안 된다(불변식 7).
 */
async function sendLinkBulk(
  client: Client,
  targets: WriteTargets,
  count: number,
  build: (index: string) => unknown[],
  refresh: boolean,
): Promise<LinkWriteResult> {
  const shadow = targets.shadows[LINKS_ALIAS];
  const operations: unknown[] = [...build(LINKS_ALIAS)];
  if (shadow !== undefined) operations.push(...build(shadow));

  const response = await client.bulk({
    operations: operations as estypes.BulkRequest['operations'],
    ...(refresh ? { refresh: true } : {}),
  });

  const failures: LinkWriteFailure[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const item = response.items[offset];
    const outcome = item?.index ?? item?.update;
    if (outcome?.error === undefined || outcome.error === null) continue;
    failures.push({ link_id: outcome._id ?? '', status: outcome.status ?? 0, reason: outcome.error.type });
  }

  if (shadow !== undefined) {
    for (let offset = 0; offset < count; offset += 1) {
      const item = response.items[count + offset];
      const outcome = item?.index ?? item?.update;
      if (outcome !== undefined && (outcome.error === undefined || outcome.error === null)) continue;
      reportShadowFailure(targets, {
        alias: LINKS_ALIAS,
        index: shadow,
        operation: 'bulk',
        reason: outcome?.error?.type ?? '벌크 응답에 대응 항목이 없다',
      });
    }
  }

  return { written: count - failures.length, failures };
}

/** 참조 간선을 통째로 색인한다. 같은 `link_id`면 덮어쓴다 (멱등). */
export async function writeReferenceLinks(
  client: Client,
  docs: readonly ReferenceLinkDoc[],
  targets: WriteTargets,
  options: { readonly refresh?: boolean } = {},
): Promise<LinkWriteResult> {
  if (docs.length === 0) return { written: 0, failures: [] };

  return sendLinkBulk(
    client,
    targets,
    docs.length,
    (index) => {
      const operations: unknown[] = [];
      for (const doc of docs) {
        operations.push({
          index: { _index: index, _id: doc.link_id, routing: String(doc.scope.repository_id) },
        });
        operations.push(toSource(doc));
      }
      return operations;
    },
    options.refresh === true,
  );
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
  targets: WriteTargets,
): Promise<number> {
  const filter: estypes.QueryDslQueryContainer[] = [
    { term: { repository_id: input.repositoryId } },
    { term: { link_type: REFERENCE_LINK_TYPE } },
    { term: { from_type: input.fromType } },
    { term: { from_id: input.fromId } },
  ];

  // **삭제도 이중으로 한다** (WP-035, DEV-295).
  return dualWrite(targets, LINKS_ALIAS, 'delete_by_query', async (index) => {
    await client.indices.refresh({ index });
    const response = await client.deleteByQuery({
      index,
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
  });
}

/* ------------------------------------------------------------------------- */
/* 미해결 참조 역방향 조회 (JOB-REL-005)                                       */
/* ------------------------------------------------------------------------- */

export interface ReferencingLink {
  readonly link_id: string;
  readonly repository_id: number;
  readonly reference_key: string;
  readonly resolved: boolean;
}

/** 한 페이지 크기. 상한이 아니라 왕복 단위다 — 호출이 끝까지 페이지를 넘긴다. */
export const REFERENCE_PAGE_SIZE = 500;

/**
 * 대상 T를 가리킬 수 있는 참조 간선을 **전부** 찾는다.
 *
 * 간선 전량을 스캔하지 않는다 — `reference_key` 후보는 대상 하나당 최대
 * 일곱(전체 SHA 하나 + 접두 여섯)으로 상한이 있으므로 `terms` 하나면 된다.
 *
 * 후보는 두 형태다. **같은 저장소 형태**(`pr:20`)는 그 저장소의 간선에서만
 * 뜻이 있으므로 `repository_id`로 좁힌다. **저장소를 명시한 형태**
 * (`x:acme/b:pr:20`)는 어느 저장소의 본문에서든 나올 수 있으므로 좁히지 않는다.
 *
 * ## 왜 페이지를 끝까지 넘기는가 (PR #44 리뷰 P2)
 *
 * 한 페이지만 읽으면 같은 대상을 가리키는 간선이 페이지 크기를 넘을 때 나머지가
 * **영원히 미해결로 남는다** — 대상 색인은 보통 한 번뿐인 사건이라 다시 깨울
 * 방아쇠가 없다. `link_id` 정렬 + `search_after`로 끝까지 넘긴다.
 *
 * ## 왜 해결된 것도 가져오는가 (PR #44 리뷰 P1)
 *
 * 축약 SHA 참조는 **한 번 유일했다가 나중에 모호해질 수 있다.** 새 커밋이 같은
 * 접두를 갖는 순간 이미 해결된 간선이 "자신 있게 틀린 답"이 된다. `resolved`로
 * 걸러 내면 그 간선을 다시 볼 방법이 없으므로, 판정은 호출 측이 한다.
 */
export async function findReferencesTo(
  client: Client,
  input: {
    /** 대상이 속한 저장소. 같은 저장소 형태 후보를 이 저장소로 좁힌다. */
    readonly targetRepositoryId: number;
    readonly sameRepoKeys: readonly string[];
    readonly crossRepoKeys: readonly string[];
    /** `unresolved`면 미해결만. `any`면 해결된 것도 함께 (접두 재평가용). */
    readonly include?: 'unresolved' | 'any';
    readonly pageSize?: number;
  },
): Promise<readonly ReferencingLink[]> {
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

  const filter: estypes.QueryDslQueryContainer[] = [{ term: { link_type: REFERENCE_LINK_TYPE } }];
  if (input.include !== 'any') filter.push({ term: { resolved: false } });

  const size = input.pageSize ?? REFERENCE_PAGE_SIZE;
  const links: ReferencingLink[] = [];
  let after: estypes.SortResults | undefined;

  for (;;) {
    const response = await client.search<ReferencingLink>({
      index: LINKS_ALIAS,
      size,
      _source: ['link_id', 'repository_id', 'reference_key', 'resolved'],
      // 안정 정렬이 있어야 `search_after`가 항목을 건너뛰지 않는다.
      sort: [{ link_id: 'asc' }],
      ...(after === undefined ? {} : { search_after: after }),
      query: { bool: { minimum_should_match: 1, should, filter } },
    });

    const hits = response.hits.hits;
    for (const hit of hits) {
      if (hit._source === undefined) continue;
      links.push(hit._source);
    }
    if (hits.length < size) return links;
    after = hits.at(-1)?.sort;
    if (after === undefined) return links;
  }
}

/**
 * 해결 상태를 **되돌린다** (PR #44 리뷰 P1).
 *
 * 축약 SHA 참조는 한 번 유일했다가 나중에 모호해질 수 있다. 그때 대상 필드를
 * 그대로 두면 간선이 "자신 있게 틀린 답"을 계속 말한다 — 지운다. 필드를
 * 남기지 않는 것이 미해결 간선의 모양이다.
 */
const UNRESOLVE_SCRIPT = [
  'boolean changed = false;',
  'if (ctx._source.resolved != false) { ctx._source.resolved = false; changed = true; }',
  "for (def key : ['to_type', 'to_id', 'to_repository_id']) {",
  '  if (ctx._source.containsKey(key)) { ctx._source.remove(key); changed = true; }',
  '}',
  "if (!changed) { ctx.op = 'noop'; }",
].join('\n');

/**
 * 간선의 해결 상태를 **갱신**한다 (FR-REL-003 AC-3).
 *
 * `link_id`는 그대로다 — 그것이 `reference_key`를 ID 재료로 쓴 이유다 (DEV-217).
 * 부분 갱신이라 `evidence`·`confidence`·`created_at`을 건드리지 않는다.
 *
 * `resolution`이 `null`이면 해결을 **되돌린다.**
 */
export async function resolveReferenceLinks(
  client: Client,
  updates: readonly {
    readonly link_id: string;
    readonly repository_id: number;
    readonly resolution: ReferenceResolution | null;
  }[],
  targets: WriteTargets,
  options: { readonly refresh?: boolean } = {},
): Promise<LinkWriteResult> {
  if (updates.length === 0) return { written: 0, failures: [] };

  return sendLinkBulk(
    client,
    targets,
    updates.length,
    (index) => {
      const operations: unknown[] = [];
      for (const update of updates) {
        operations.push({
          update: {
            _index: index,
            _id: update.link_id,
            routing: String(update.repository_id),
            retry_on_conflict: 3,
          },
        });
        operations.push(
          update.resolution === null
            ? { script: { lang: 'painless', source: UNRESOLVE_SCRIPT } }
            : {
                doc: {
                  resolved: true,
                  to_type: update.resolution.to_type,
                  to_id: update.resolution.to_id,
                  to_repository_id: update.resolution.to_repository_id,
                },
              },
        );
      }
      return operations;
    },
    options.refresh === true,
  );
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
  /*
   * **생략하면 건드리지 않는다** (CR-041, PR #46 리뷰 P1).
   *
   * `links_pending`은 **참조 추출의 완결 상태**다. 관계 파생만 도는 회차가 그것을
   * `false`로 덮으면 참조 쪽의 실패 표식이 사라지고, 그 문서는 재파생 대상에서
   * 조용히 빠진다 — 실패했는데 아무도 다시 하지 않는 자리가 하나 더 생긴다.
   */
  'if (params.links_pending != null && ctx._source.links_pending != params.links_pending) {',
  '  ctx._source.links_pending = params.links_pending; changed = true;',
  '}',
  /*
   * WP-030의 네 leaf도 **leaf 단위로** 대입한다 (CR-041, DEV-241·222).
   *
   * `params.relations`가 없으면 건드리지 않는다 — 참조만 고치는 회차가 관계
   * boolean을 지우면 안 되고, 그 반대도 마찬가지다. 값이 넘어왔다는 것은
   * **호출 측이 active 간선 집합에서 다시 계산했다**는 뜻이다.
   */
  'if (params.relations != null) {',
  '  for (def entry : params.relations.entrySet()) {',
  '    if (ctx._source.link_summary[entry.getKey()] != entry.getValue()) {',
  '      ctx._source.link_summary[entry.getKey()] = entry.getValue(); changed = true;',
  '    }',
  '  }',
  '}',
  "if (!changed) { ctx.op = 'noop'; }",
].join('\n');

export interface LinkSummaryUpdate {
  readonly alias: 'prs-pull-requests' | 'prs-commits';
  readonly docId: string;
  readonly repositoryId: number;
  /** 생략하면 참조 수를 건드리지 않는다 — 세지 못한 회차의 정직한 표현이다. */
  readonly referenceCount?: number;
  /**
   * 참조 추출의 완결 상태 (FR-REL-003).
   *
   * **생략하면 건드리지 않는다.** 관계 파생(WP-030)만 도는 회차는 이 값을 넘기지
   * 않는다 — 그 워커는 참조를 추출하지 않았으므로 그 상태에 대해 할 말이 없다.
   */
  readonly linksPending?: boolean;
  /**
   * WP-030의 관계 leaf (CR-041). **생략하면 건드리지 않는다.**
   *
   * 참조만 고치는 회차가 관계 boolean을 지우지 않게 하는 것이 생략의 뜻이다.
   *
   * **부분 집합을 받는다.** `has_stack`은 PR 문서에만 있는 leaf이고 커밋 매핑에는
   * 선언되어 있지 않다 — 스택은 PR↔PR 관계이기 때문이다. 커밋에 `false`를 쓰면
   * `dynamic: strict`가 거부하며, 거부하는 것이 옳다: **없는 것과 아닌 것은
   * 다른 주장**이다.
   */
  readonly relations?: Partial<RelationSummary>;
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
  targets: WriteTargets,
  options: { readonly refresh?: boolean } = {},
): Promise<LinkSummaryResult> {
  const served = await sendSummary(client, input.alias, input, options.refresh === true);

  /*
   * shadow에도 같은 요약을 보낸다 (WP-035, DEV-295).
   *
   * **`missing`을 실패로 세지 않는다** — 정본 스캔이 아직 그 문서에 닿지 않았을
   * 뿐이고, 닿으면 요약이 함께 실린다. 실패로 세면 정상 진행이 전환을 막는다.
   */
  const shadow = targets.shadows[input.alias];
  if (shadow !== undefined) {
    try {
      await sendSummary(client, shadow, input, options.refresh === true);
    } catch (error) {
      reportShadowFailure(targets, {
        alias: input.alias,
        index: shadow,
        operation: 'update',
        reason: String(error),
      });
    }
  }

  return served;
}

/** 한 인덱스에 요약을 반영한다. 서비스와 shadow가 **같은 경로**를 쓴다. */
async function sendSummary(
  client: Client,
  index: string,
  input: LinkSummaryUpdate,
  refresh: boolean,
): Promise<LinkSummaryResult> {
  try {
    const response = await client.update({
      index,
      id: input.docId,
      routing: String(input.repositoryId),
      retry_on_conflict: 3,
      ...(refresh ? { refresh: true } : {}),
      script: {
        lang: 'painless',
        source: LINK_SUMMARY_SCRIPT,
        params: {
          reference_count: input.referenceCount ?? null,
          links_pending: input.linksPending ?? null,
          /*
           * `null`이면 스크립트가 건드리지 않는다 — WP-029만 도는 회차가 WP-030의
           * 네 값을 지우지 않고, 그 반대도 마찬가지다 (DEV-222).
           */
          relations: input.relations === undefined ? null : { ...input.relations },
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

/* ------------------------------------------------------------------------- */
/* 파생 간선 — 되돌림·체리픽·스택 (WP-030 / CR-041)                            */
/* ------------------------------------------------------------------------- */

/**
 * `references`가 아닌 저장 간선 유형.
 *
 * `contains`(릴리스↔커밋)는 릴리스 투영이 소유하므로 여기 없다.
 */
export const DERIVED_LINK_TYPES = ['reverts', 'cherry_picks', 'stacks_on'] as const;
export type DerivedLinkTypeName = (typeof DERIVED_LINK_TYPES)[number];

export interface DerivedLinkDoc {
  readonly link_id: string;
  readonly link_type: DerivedLinkTypeName;
  readonly scope: LinkScopeFields;
  readonly from_type: LinkEndpointKind;
  readonly from_id: string;
  readonly to_type: LinkEndpointKind;
  readonly to_id: string;
  readonly to_repository_id: number;
  readonly confidence: 'exact' | 'derived' | 'heuristic';
  readonly evidence: string;
  /** `stacks_on`만 갖는다. 다른 유형에는 두지 않는다 (CR-041, DEV-238). */
  readonly detached?: boolean;
  /** source 정본의 시각. `now()`가 아니다 — 재파생이 결정론적이어야 한다. */
  readonly created_at: string;
  /**
   * 대상이 색인되었는가.
   *
   * 되돌림 트레일러는 대상 SHA를 **직접 지목**하므로 대상 문서가 아직 없어도
   * 끝점이 정해진다. 그때는 `false`로 저장하고 대상이 나타나면 갱신한다 —
   * `link_id`가 끝점으로 만들어지므로 **같은 문서의 갱신**이다.
   */
  readonly resolved: boolean;
}

function toDerivedSource(doc: DerivedLinkDoc): Record<string, unknown> {
  const source: Record<string, unknown> = {
    link_id: doc.link_id,
    repository_id: doc.scope.repository_id,
    org_id: doc.scope.org_id,
    visibility: doc.scope.visibility,
    allowed_team_ids: [...doc.scope.allowed_team_ids],
    from_type: doc.from_type,
    from_id: doc.from_id,
    to_type: doc.to_type,
    to_id: doc.to_id,
    to_repository_id: doc.to_repository_id,
    link_type: doc.link_type,
    confidence: doc.confidence,
    evidence: doc.evidence,
    resolved: doc.resolved,
    created_at: doc.created_at,
  };
  /*
   * `detached`는 `stacks_on`에만 둔다 (DEV-238). `strict` 매핑에서 값을 두지
   * 않는 것과 `false`를 두는 것은 다른 주장이다 — 되돌림 간선에 `false`를 적으면
   * "해제될 수 있는 관계인데 아직 아니다"라는 뜻이 되고, 그런 개념이 없다.
   */
  if (doc.link_type === 'stacks_on') source['detached'] = doc.detached === true;
  /*
   * `reference_key`를 두지 않는다 — 그것은 대상이 나중에 밝혀지는 참조의 정체성
   * 수단이며(DEV-217), 이 셋은 대상을 알아낸 뒤에 만들어진다.
   */
  return source;
}

/** 파생 간선을 통째로 색인한다. 같은 `link_id`면 덮어쓴다 (멱등). */
export async function writeDerivedLinks(
  client: Client,
  docs: readonly DerivedLinkDoc[],
  targets: WriteTargets,
  options: { readonly refresh?: boolean } = {},
): Promise<LinkWriteResult> {
  if (docs.length === 0) return { written: 0, failures: [] };

  return sendLinkBulk(
    client,
    targets,
    docs.length,
    (index) => {
      const operations: unknown[] = [];
      for (const doc of docs) {
        operations.push({
          index: { _index: index, _id: doc.link_id, routing: String(doc.scope.repository_id) },
        });
        operations.push(toDerivedSource(doc));
      }
      return operations;
    },
    options.refresh === true,
  );
}

/**
 * 이번 파생이 만들지 않은 **이 source의 이 유형** 간선을 지운다 (DEV-233).
 *
 * `stacks_on`에는 쓰지 않는다 — 그 계열은 제거가 아니라 `detached`다. 호출 측이
 * 유형을 넘기므로 규칙이 한곳에 모이지 않지만, **계열마다 수명이 다르다는 사실을
 * 하나의 추상으로 덮는 것보다 낫다.** 덮으면 그 차이가 조건문 속으로 숨는다.
 *
 * `deleteStaleReferenceLinks`와 같은 이유로 **먼저 refresh한다** —
 * `delete_by_query`는 검색으로 대상을 찾는다.
 *
 * 호출 측이 **완전한 파생에 성공했을 때만** 부른다. 실패한 회차가 부르면 멀쩡한
 * 간선이 사라진다.
 */
export async function deleteStaleDerivedLinks(
  client: Client,
  input: {
    readonly repositoryId: number;
    readonly linkType: 'reverts' | 'cherry_picks';
    readonly fromType: LinkEndpointKind;
    readonly fromId: string;
    readonly keep: readonly string[];
  },
  targets: WriteTargets,
): Promise<number> {
  // **삭제도 이중으로 한다** (WP-035, DEV-295).
  return dualWrite(targets, LINKS_ALIAS, 'delete_by_query', async (index) => {
    await client.indices.refresh({ index });
    const response = await client.deleteByQuery({
      index,
      routing: String(input.repositoryId),
      conflicts: 'proceed',
      refresh: true,
      query: {
        bool: {
          filter: [
            { term: { repository_id: input.repositoryId } },
            { term: { link_type: input.linkType } },
            { term: { from_type: input.fromType } },
            { term: { from_id: input.fromId } },
          ],
          ...(input.keep.length === 0 ? {} : { must_not: [{ ids: { values: [...input.keep] } }] }),
        },
      },
    });
    return response.deleted ?? 0;
  });
}

/** 간선 하나의 최소 정보. 조정과 요약 재계산이 읽는다. */
export interface StoredLink {
  readonly link_id: string;
  readonly repository_id: number;
  readonly link_type: string;
  readonly from_type: string;
  readonly from_id: string;
  readonly to_type?: string;
  readonly to_id?: string;
  readonly detached?: boolean;
  readonly resolved?: boolean;
}

const LINK_FIELDS = [
  'link_id',
  'repository_id',
  'link_type',
  'from_type',
  'from_id',
  'to_type',
  'to_id',
  'detached',
  'resolved',
];

/**
 * 한 저장소에서 조건에 맞는 간선을 **끝까지** 가져온다.
 *
 * 한 페이지만 읽으면 페이지를 넘는 간선이 조정에서 영영 빠진다 — WP-029가 PR #44
 * 리뷰에서 배운 자리다. `link_id` 정렬 + `search_after`로 끝까지 넘긴다.
 */
async function scrollLinks(
  client: Client,
  repositoryId: number,
  filter: readonly estypes.QueryDslQueryContainer[],
  pageSize: number,
): Promise<readonly StoredLink[]> {
  const out: StoredLink[] = [];
  let after: readonly unknown[] | undefined;

  for (;;) {
    const response = await client.search<StoredLink>({
      index: LINKS_ALIAS,
      routing: String(repositoryId),
      size: pageSize,
      _source: LINK_FIELDS,
      sort: [{ link_id: 'asc' }],
      query: { bool: { filter: [{ term: { repository_id: repositoryId } }, ...filter] } },
      ...(after === undefined ? {} : { search_after: [...after] }),
    });
    const hits = response.hits.hits;
    for (const hit of hits) {
      if (hit._source !== undefined) out.push(hit._source);
    }
    if (hits.length < pageSize) return out;
    const last = hits[hits.length - 1];
    if (last?.sort === undefined) return out;
    after = last.sort;
  }
}

/** 이 source가 가진 특정 유형의 간선 전부. */
export async function findLinksFrom(
  client: Client,
  input: {
    readonly repositoryId: number;
    readonly fromType: LinkEndpointKind;
    readonly fromId: string;
    readonly linkTypes: readonly string[];
    readonly pageSize?: number;
  },
): Promise<readonly StoredLink[]> {
  return scrollLinks(
    client,
    input.repositoryId,
    [
      { terms: { link_type: [...input.linkTypes] } },
      { term: { from_type: input.fromType } },
      { term: { from_id: input.fromId } },
    ],
    input.pageSize ?? REFERENCE_PAGE_SIZE,
  );
}

/**
 * 이 대상을 가리키는 간선 전부 (역방향).
 *
 * `to_repository_id`가 아니라 `repository_id`(= source 저장소)로 라우팅한다는 점에
 * 주의한다 — 저장소 간 간선은 source 쪽에 산다. 되돌림·체리픽·스택은 모두 동일
 * 저장소 관계이므로 이 경로에서 둘은 같다.
 */
export async function findLinksTo(
  client: Client,
  input: {
    readonly repositoryId: number;
    readonly toType: LinkEndpointKind;
    readonly toId: string;
    readonly linkTypes: readonly string[];
    readonly pageSize?: number;
  },
): Promise<readonly StoredLink[]> {
  return scrollLinks(
    client,
    input.repositoryId,
    [
      { terms: { link_type: [...input.linkTypes] } },
      { term: { to_type: input.toType } },
      { term: { to_id: input.toId } },
    ],
    input.pageSize ?? REFERENCE_PAGE_SIZE,
  );
}

/**
 * `detached` 표식을 바꾼다 (FR-REL-006 AC-3, DEV-238).
 *
 * 간선을 **지우지 않는다.** 지우면 "그런 의존이 있었다"는 사실이 사라져 사후
 * 조사가 불가능해진다. 조건이 다시 성립하면 `false`로 되돌린다.
 */
export async function setLinkDetached(
  client: Client,
  updates: readonly { readonly link_id: string; readonly repository_id: number; readonly detached: boolean }[],
  targets: WriteTargets,
  options: { readonly refresh?: boolean } = {},
): Promise<LinkWriteResult> {
  if (updates.length === 0) return { written: 0, failures: [] };

  return sendLinkBulk(
    client,
    targets,
    updates.length,
    (index) => {
      const operations: unknown[] = [];
      for (const update of updates) {
        operations.push({
          update: {
            _index: index,
            _id: update.link_id,
            routing: String(update.repository_id),
            retry_on_conflict: 3,
          },
        });
        operations.push({ doc: { detached: update.detached } });
      }
      return operations;
    },
    options.refresh === true,
  );
}

/**
 * 대상이 색인된 파생 간선의 `resolved`를 갱신한다.
 *
 * 되돌림 트레일러처럼 **끝점은 알지만 대상 문서가 아직 없는** 간선이 있다.
 * `link_id`가 끝점으로 만들어지므로 이것은 새 문서가 아니라 **같은 문서의 갱신**
 * 이다 — `references`가 `reference_key`로 얻는 성질을 이쪽은 끝점으로 얻는다.
 */
export async function setLinkResolved(
  client: Client,
  updates: readonly { readonly link_id: string; readonly repository_id: number; readonly resolved: boolean }[],
  targets: WriteTargets,
  options: { readonly refresh?: boolean } = {},
): Promise<LinkWriteResult> {
  if (updates.length === 0) return { written: 0, failures: [] };

  return sendLinkBulk(
    client,
    targets,
    updates.length,
    (index) => {
      const operations: unknown[] = [];
      for (const update of updates) {
        operations.push({
          update: {
            _index: index,
            _id: update.link_id,
            routing: String(update.repository_id),
            retry_on_conflict: 3,
          },
        });
        operations.push({ doc: { resolved: update.resolved } });
      }
      return operations;
    },
    options.refresh === true,
  );
}

/* ------------------------------------------------------------------------- */
/* 관계 요약 재계산 (CR-041, DEV-241)                                          */
/* ------------------------------------------------------------------------- */

export interface RelationSummary {
  readonly has_revert: boolean;
  readonly is_reverted: boolean;
  readonly has_cherry_pick: boolean;
  readonly has_stack: boolean;
}

interface SummaryAggs {
  readonly out_revert?: { readonly doc_count: number };
  readonly in_revert?: { readonly doc_count: number };
  readonly cherry?: { readonly doc_count: number };
  readonly stack?: { readonly doc_count: number };
}

/**
 * 한 엔티티의 관계 요약을 **현재 active 간선 집합에서** 다시 계산한다 (DEV-241).
 *
 * ## 왜 간선 하나의 결과로 쓰면 안 되는가
 *
 * "간선을 지웠으니 `has_revert = false`"는 틀렸다 — 같은 종류의 다른 간선이 남아
 * 있을 수 있다. `false`는 **"확인했고 현재 없다"**여야 하며, 그러려면 조정이 끝난
 * 뒤 집합 전체를 봐야 한다.
 *
 * 왕복은 한 번이다. 바깥 질의가 "이 엔티티에 걸린 간선"으로 좁히고 filter 집계
 * 넷이 그 안에서 센다.
 */
export async function summarizeRelations(
  client: Client,
  input: {
    readonly repositoryId: number;
    readonly kind: LinkEndpointKind;
    readonly docId: string;
  },
): Promise<RelationSummary> {
  const touching: estypes.QueryDslQueryContainer[] = [
    { bool: { filter: [{ term: { from_type: input.kind } }, { term: { from_id: input.docId } }] } },
    { bool: { filter: [{ term: { to_type: input.kind } }, { term: { to_id: input.docId } }] } },
  ];

  const response = await client.search({
    index: LINKS_ALIAS,
    routing: String(input.repositoryId),
    size: 0,
    query: {
      bool: {
        filter: [
          { term: { repository_id: input.repositoryId } },
          { terms: { link_type: [...DERIVED_LINK_TYPES] } },
        ],
        should: touching,
        minimum_should_match: 1,
      },
    },
    aggs: {
      out_revert: {
        filter: {
          bool: {
            filter: [
              { term: { link_type: 'reverts' } },
              { term: { from_type: input.kind } },
              { term: { from_id: input.docId } },
            ],
          },
        },
      },
      in_revert: {
        filter: {
          bool: {
            filter: [
              { term: { link_type: 'reverts' } },
              { term: { to_type: input.kind } },
              { term: { to_id: input.docId } },
            ],
          },
        },
      },
      cherry: { filter: { term: { link_type: 'cherry_picks' } } },
      /*
       * `detached`가 아닌 것만 센다. `must_not`은 **필드가 없는 문서도 통과**시키므로
       * 값을 두지 않는 다른 유형과도 안전하다 — 바깥 filter가 이미 `stacks_on`으로
       * 좁히지만, 그 사실에 기대지 않는다.
       */
      stack: {
        filter: {
          bool: {
            filter: [{ term: { link_type: 'stacks_on' } }],
            must_not: [{ term: { detached: true } }],
          },
        },
      },
    },
  });

  const aggs = (response.aggregations ?? {}) as SummaryAggs;
  return {
    has_revert: (aggs.out_revert?.doc_count ?? 0) > 0,
    is_reverted: (aggs.in_revert?.doc_count ?? 0) > 0,
    has_cherry_pick: (aggs.cherry?.doc_count ?? 0) > 0,
    has_stack: (aggs.stack?.doc_count ?? 0) > 0,
  };
}
