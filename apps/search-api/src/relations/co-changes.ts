/**
 * 동시 변경 상관 (API-REL-003 / WP-031, CR-042, FR-REL-007).
 *
 * ## 계산 불가와 결과 0건은 다른 사실이다 (DEV-254)
 *
 * 기준 PR이 미머지면 AC-2의 창(**머지 시각 ±90일**)에 기준점이 없다. `created_at`
 * 으로 대신하면 AC-2가 정한 창이 아닌 다른 창을 계산한 뒤 그 결과를 "자카드 상위
 * 20"이라고 부르게 된다. 그래서 오류가 아니라 **정상 도메인 상태**로 답한다.
 *
 * ## 앱단에서 후보를 먼저 자르지 않는다 (DEV-255)
 *
 * "후보 N건을 가져와 앱에서 자카드를 계산해 상위 20"은 **진짜 상위 20이 N번째
 * 밖에 있을 수 있고**, 그 사실이 응답 어디에도 드러나지 않는다. 자격 조건과
 * 경로 교집합 존재를 Elasticsearch가 강제하고 점수도 거기서 매긴다.
 */

import type { Client } from '@elastic/elasticsearch';
import type { estypes } from '@elastic/elasticsearch';
import {
  applyMandatoryScopeFilter,
  assertNoShardFailures,
  pullRequestDetailQuery,
  search,
  type AccessScope,
} from '@prs/es';

const PR_ALIAS = 'prs-pull-requests' as const;

/** FR-REL-007 AC-4. **`files_truncated`(3000 상한)와 다른 계약이다** (DEV-254). */
export const CO_CHANGE_MAX_CHANGED_FILES = 200;
/** FR-REL-007 AC-2. */
export const CO_CHANGE_WINDOW_DAYS = 90;
/** FR-REL-007 AC-3. */
export const CO_CHANGE_LIMIT = 20;
/** FR-REL-007 AC-5. */
export const CO_CHANGE_OVERLAP_LIMIT = 10;
/**
 * `changed_paths.raw`의 `ignore_above`.
 *
 * 이보다 긴 경로는 keyword로 색인되지 않아 `doc_values`에도 없다. 점수 계산이
 * 보는 집합과 기준 PR의 `_source` 배열이 어긋나면 분모가 틀어지므로, **양쪽을
 * 같은 기준으로 자른다.**
 */
export const PATH_IGNORE_ABOVE = 1024;

export type CoChangeReason = 'not_merged' | 'enrichment_pending' | 'too_many_changed_files';

export interface CoChangeDeps {
  readonly es: Client;
  readonly timeoutMs?: number;
}

interface AnchorSource {
  readonly repository?: string;
  readonly pr_number?: number;
  readonly merged_at?: string;
  readonly changed_files_count?: number;
  readonly changed_paths?: readonly string[];
  readonly enrichment_pending?: boolean;
  readonly doc_id?: string;
}

interface CandidateSource {
  readonly repository?: string;
  readonly pr_number?: number;
  readonly title?: string;
  readonly author?: string;
  readonly merged_at?: string;
  readonly changed_paths?: readonly string[];
}

/**
 * 자카드 `|A ∩ B| / |A ∪ B|`.
 *
 * `params.source`는 **맵**이다 — 리스트로 넘기고 `contains`를 쓰면 후보 경로마다
 * 선형 탐색이라 200 × 200이 된다.
 */
const JACCARD_SCRIPT = [
  "def paths = doc['changed_paths.raw'];",
  'int size = paths.size();',
  'if (size == 0) { return 0.0; }',
  'int shared = 0;',
  'for (int i = 0; i < size; i++) { if (params.source.containsKey(paths[i])) { shared++; } }',
  'double union = size + params.sourceCount - shared;',
  'if (union <= 0) { return 0.0; }',
  'return shared / union;',
].join(' ');

function shiftDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

/** `ignore_above`를 넘는 경로를 뺀다. 점수 계산이 보는 것과 같은 집합으로 맞춘다. */
function indexablePaths(paths: readonly string[]): readonly string[] {
  return paths.filter((path) => path.length <= PATH_IGNORE_ABOVE);
}

export interface CoChangeInput {
  readonly repository: string;
  readonly prNumber: number;
}

/**
 * @returns 앵커가 없거나 접근 범위 밖이면 `null`. 라우트가 404로 옮긴다.
 */
export async function getCoChanges(
  input: CoChangeInput,
  scope: AccessScope,
  deps: CoChangeDeps,
): Promise<Record<string, unknown> | null> {
  const timeout = deps.timeoutMs === undefined ? {} : { timeout: `${String(deps.timeoutMs)}ms` };

  const anchorResponse = await search<AnchorSource>(
    deps.es,
    PR_ALIAS,
    applyMandatoryScopeFilter(pullRequestDetailQuery(input.repository, input.prNumber), scope),
    {
      size: 1,
      _source: [
        'doc_id',
        'repository',
        'pr_number',
        'merged_at',
        'changed_files_count',
        'changed_paths',
        'enrichment_pending',
      ],
      ...timeout,
    },
  );
  assertNoShardFailures(anchorResponse);

  const anchor = anchorResponse.hits.hits[0]?._source;
  if (anchor === undefined) return null;

  const anchorBody: Record<string, unknown> = {
    repository: anchor.repository ?? input.repository,
    pr_number: anchor.pr_number ?? input.prNumber,
  };
  if (anchor.changed_files_count !== undefined) {
    anchorBody['changed_files_count'] = anchor.changed_files_count;
  }

  const unavailable = (reason: CoChangeReason): Record<string, unknown> => ({
    available: false,
    reason,
    anchor: anchorBody,
    items: [],
  });

  // 순서는 계약의 표 그대로다. 한 PR이 둘 이상에 걸리면 먼저 걸리는 것을 낸다.
  if (anchor.merged_at === undefined || anchor.merged_at === null) return unavailable('not_merged');
  if (anchor.enrichment_pending === true || anchor.changed_paths === undefined) {
    return unavailable('enrichment_pending');
  }
  if ((anchor.changed_files_count ?? 0) > CO_CHANGE_MAX_CHANGED_FILES) {
    return unavailable('too_many_changed_files');
  }

  const sourcePaths = indexablePaths(anchor.changed_paths);
  if (sourcePaths.length === 0) {
    return { available: true, anchor: anchorBody, items: [] };
  }

  const sourceMap: Record<string, boolean> = {};
  for (const path of sourcePaths) sourceMap[path] = true;

  const eligibility: estypes.QueryDslQueryContainer = {
    bool: {
      filter: [
        { term: { repository: anchor.repository ?? input.repository } },
        {
          range: {
            merged_at: {
              gte: shiftDays(anchor.merged_at, -CO_CHANGE_WINDOW_DAYS),
              lte: shiftDays(anchor.merged_at, CO_CHANGE_WINDOW_DAYS),
            },
          },
        },
        { range: { changed_files_count: { lte: CO_CHANGE_MAX_CHANGED_FILES } } },
        // 교집합이 있는 후보만. "겹치는 것이 없다"를 점수 0으로 받아 버리지 않는다.
        { terms: { 'changed_paths.raw': [...sourcePaths] } },
      ],
      must_not: [
        { term: { enrichment_pending: true } },
        // 자기 자신은 후보가 아니다.
        ...(anchor.doc_id === undefined ? [] : [{ term: { doc_id: anchor.doc_id } }]),
      ],
    },
  };

  const response = await search<CandidateSource>(
    deps.es,
    PR_ALIAS,
    applyMandatoryScopeFilter(
      {
        script_score: {
          query: eligibility,
          script: {
            source: JACCARD_SCRIPT,
            params: { source: sourceMap, sourceCount: sourcePaths.length },
          },
        },
      },
      scope,
    ),
    {
      size: CO_CHANGE_LIMIT,
      // 점수 내림차순, 동률은 `pr_number` 오름차순 — 같은 정본에서 같은 순서 (ADR-004).
      sort: [{ _score: { order: 'desc' } }, { pr_number: { order: 'asc' } }],

      _source: ['repository', 'pr_number', 'title', 'author', 'merged_at', 'changed_paths'],
      ...timeout,
    },
  );
  assertNoShardFailures(response);

  const items = response.hits.hits.map((hit) => {
    const candidate = hit._source;
    const overlap = indexablePaths(candidate?.changed_paths ?? [])
      .filter((path) => sourceMap[path] === true)
      // AC-5에 순위 개념이 없다. 결정론을 우선한다 (DEV-256).
      .sort()
      .slice(0, CO_CHANGE_OVERLAP_LIMIT);

    const item: Record<string, unknown> = {
      repository: candidate?.repository ?? null,
      pr_number: candidate?.pr_number ?? null,
      title: candidate?.title ?? null,
      author: candidate?.author ?? null,
      merged_at: candidate?.merged_at ?? null,
      similarity: Math.round((hit._score ?? 0) * 10_000) / 10_000,
      overlapping_paths: overlap,
    };
    if (candidate?.repository !== undefined && candidate.pr_number !== undefined) {
      item['url'] = `/pr/${candidate.repository}/${String(candidate.pr_number)}`;
    }
    return item;
  });

  return { available: true, anchor: anchorBody, items };
}
