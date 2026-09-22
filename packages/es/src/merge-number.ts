/**
 * M 번호의 색인 반영 (WP-074 / FR-SEQ-008, CR-079, 상세 설계 8절).
 *
 * ## 소유자 필드다
 *
 * `merge_number`·`merge_number_epoch`·`merge_number_state`·`merge_number_reason`은
 * `merge_seq`와 같은 규율을 따른다 — 투영의 `params.doc`에 싣지 않고 이 모듈만 쓴다.
 * 투영이 돌 때마다 되돌아가면 안 되는 값이기 때문이다.
 *
 * ## 표기 문자열을 저장하지 않는다
 *
 * 색인의 `merge_number`는 정수다. `M-<코드>-<n>`은 저장소 **이름**에서 오는 표시값이라
 * API가 현재 이름으로 만든다 (OD-009). 저장하면 개명 뒤 옛 문자열이 남는다.
 *
 * ## 옛 쓰기를 거부한다
 *
 * 문서에 더 높은 `merge_number_epoch`가 있으면 낮은 에폭의 쓰기는 noop이다. 이벤트
 * 순서 역전이 새 에폭의 값을 옛 값으로 되돌리지 못하게 한다.
 */

import type { Client } from '@elastic/elasticsearch';
import { commitDocId, pullRequestDocId } from '@prs/domain';
import { search } from './search.js';
import { applyMandatoryScopeFilter, type AccessScope } from './scoped-query.js';
import { dualWrite, type WriteTargets } from './write-targets.js';

const PR_ALIAS = 'prs-pull-requests' as const;
const COMMIT_ALIAS = 'prs-commits' as const;

export interface MergeNumberDocUpdate {
  readonly repositoryId: number;
  readonly prNumber: number;
  readonly baseBranch: string;
  /** 정본 행의 머지 커밋. 문서의 `merge_commit_sha`와 다르면 쓰지 않는다. */
  readonly expectedMergeCommitSha: string;
  /** `null`이면 번호를 지운다 (에폭 상향 뒤 pending). */
  readonly mergeNumber: number | null;
  readonly mergeNumberEpoch: number;
  readonly state: 'assigned' | 'pending';
  readonly reason: string | null;
}

export type MergeNumberDocOutcome =
  /** 서비스 인덱스에 반영됐다. */
  | 'updated'
  /** 이미 같은 값이거나 더 높은 에폭이 있어 건드리지 않았다. */
  | 'noop'
  /** PR 문서가 아직 없다. 투영이 만든 뒤 다시 온다. */
  | 'document_missing'
  /** 문서의 저장소·브랜치·머지 커밋이 기대와 다르다. 쓰지 않는다. */
  | 'guard_rejected';

interface GuardSource {
  readonly repository_id?: number;
  readonly base_branch?: string;
  readonly merge_commit_sha?: string;
}

/**
 * 한 PR 문서의 M 필드를 쓴다. active와 shadow 모두에 적용한다 (`dualWrite`).
 *
 * 순서: 문서 읽기(가드) → 스크립트 갱신(에폭 가드). 가드를 스크립트에만 두면
 * `noop`의 이유를 알 수 없어 "왜 반영되지 않았나"에 답하지 못한다.
 */
export async function applyMergeNumberToDocument(
  client: Client,
  update: MergeNumberDocUpdate,
  targets: WriteTargets,
): Promise<MergeNumberDocOutcome> {
  const id = pullRequestDocId(update.repositoryId, update.prNumber);
  const routing = String(update.repositoryId);

  let source: GuardSource | undefined;
  try {
    const found = await client.get<GuardSource>({
      index: PR_ALIAS,
      id,
      routing,
      _source_includes: ['repository_id', 'base_branch', 'merge_commit_sha'],
    });
    source = found._source ?? undefined;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) return 'document_missing';
    throw error;
  }
  if (source === undefined) return 'document_missing';
  if (
    source.repository_id !== update.repositoryId ||
    source.base_branch !== update.baseBranch ||
    (source.merge_commit_sha ?? '').toLowerCase() !== update.expectedMergeCommitSha.toLowerCase()
  ) {
    return 'guard_rejected';
  }

  const result = await dualWrite(targets, PR_ALIAS, 'update', async (index) => {
    const response = await client.update({
      index,
      id,
      routing,
      refresh: true,
      retry_on_conflict: 3,
      script: {
        lang: 'painless',
        /*
         * 더 높은 에폭이 이미 있으면 쓰지 않는다. 같은 에폭의 같은 값이면 noop —
         * 갱신 없음이 갱신으로 보이면 안 된다.
         */
        source:
          'def cur = ctx._source.merge_number_epoch;' +
          ' if (cur != null && cur > params.epoch) { ctx.op = "noop"; return; }' +
          ' boolean same = ctx._source.merge_number == params.number' +
          '  && ctx._source.merge_number_epoch == params.epoch' +
          '  && ctx._source.merge_number_state == params.state' +
          '  && ctx._source.merge_number_reason == params.reason;' +
          ' if (same) { ctx.op = "noop"; return; }' +
          ' if (params.number == null) { ctx._source.remove("merge_number"); } else { ctx._source.merge_number = params.number; }' +
          ' ctx._source.merge_number_epoch = params.epoch;' +
          ' ctx._source.merge_number_state = params.state;' +
          ' if (params.reason == null) { ctx._source.remove("merge_number_reason"); } else { ctx._source.merge_number_reason = params.reason; }',
        params: {
          number: update.mergeNumber,
          epoch: update.mergeNumberEpoch,
          state: update.state,
          reason: update.reason,
        },
      },
    });
    return response.result;
  });
  return result === 'noop' ? 'noop' : 'updated';
}

/**
 * 에폭 상향 뒤 옛 에폭의 번호를 지운다 (ADR-007 규칙 5, 상세 설계 8절).
 *
 * `merge_number_epoch < newEpoch`인 문서만 만진다. 번호를 지우고 `pending`으로 두며
 * 에폭을 새 값으로 올린다 — 이후 낮은 에폭의 늦은 쓰기가 스크립트 가드에 걸린다.
 * `document_version`은 건드리지 않는다.
 */
export async function clearMergeNumbersBelowEpoch(
  client: Client,
  input: { readonly repositoryId: number; readonly baseBranch: string; readonly newEpoch: number },
  targets: WriteTargets,
): Promise<number> {
  const query = {
    bool: {
      filter: [
        { term: { repository_id: input.repositoryId } },
        { term: { base_branch: input.baseBranch } },
        { range: { merge_number_epoch: { lt: input.newEpoch } } },
      ],
    },
  };
  const pullRequests = await dualWrite(targets, PR_ALIAS, 'update_by_query', async (index) => {
    const response = await client.updateByQuery({
      index,
      routing: String(input.repositoryId),
      refresh: true,
      conflicts: 'proceed',
      query,
      script: {
        lang: 'painless',
        source:
          'ctx._source.remove("merge_number"); ctx._source.merge_number_state = "pending";' +
          ' ctx._source.merge_number_reason = "not_sequenced"; ctx._source.merge_number_epoch = params.epoch;',
        params: { epoch: input.newEpoch },
      },
    });
    return Number(response.updated ?? 0);
  });
  /*
   * 커밋 문서의 M 값도 같은 규칙으로 지운다 (CR-115 / FR-SEQ-012 AC-7). PR 문서만 지우면
   * `kind:commit mnum:` 조회가 옛 세대의 번호를 계속 낸다 — 두 인덱스는 같은 에폭 규율을
   * 따라야 한다(ADR-007 규칙 5). 커밋에는 `merge_number_reason`이 없다.
   */
  const commits = await dualWrite(targets, COMMIT_ALIAS, 'update_by_query', async (index) => {
    const response = await client.updateByQuery({
      index,
      routing: String(input.repositoryId),
      refresh: true,
      conflicts: 'proceed',
      query,
      script: {
        lang: 'painless',
        source: 'ctx._source.remove("merge_number"); ctx._source.merge_number_state = "pending"; ctx._source.merge_number_epoch = params.epoch;',
        params: { epoch: input.newEpoch },
      },
    });
    return Number(response.updated ?? 0);
  });
  return pullRequests + commits;
}

export interface MergeNumberCommitDocUpdate {
  readonly repositoryId: number;
  /** 정본 행의 머지 커밋 SHA — 문서 ID의 재료이자 가드다. */
  readonly commitSha: string;
  readonly baseBranch: string;
  readonly mergeNumber: number;
  readonly mergeNumberEpoch: number;
  readonly state: 'assigned' | 'pending';
}

/**
 * 머지 커밋 문서 하나에 M 값을 쓴다 (WP-100 / CR-115, FR-SEQ-012 AC-7).
 *
 * PR 문서의 `applyMergeNumberToDocument`와 같은 순서·같은 가드다 — 문서 읽기(저장소·브랜치·
 * SHA·**역할이 `merge_commit`인가**) → 에폭 가드 스크립트. 직접 푸시나 원본 커밋 문서가 같은
 * SHA를 가질 수는 없지만(문서 ID가 SHA다), 역할이 아직 `direct_push`인 채 보강 전인 문서
 * (DEV-207)에 번호를 얹지 않기 위해 역할을 본다 — 그 문서는 보강이 역할을 고친 뒤 다시 온다.
 */
export async function applyMergeNumberToCommitDocument(
  client: Client,
  update: MergeNumberCommitDocUpdate,
  targets: WriteTargets,
): Promise<MergeNumberDocOutcome> {
  const id = commitDocId(update.repositoryId, update.commitSha);
  const routing = String(update.repositoryId);

  let source: (GuardSource & { readonly role?: string; readonly commit_sha?: string }) | undefined;
  try {
    const found = await client.get<GuardSource & { readonly role?: string; readonly commit_sha?: string }>({
      index: COMMIT_ALIAS,
      id,
      routing,
      _source_includes: ['repository_id', 'base_branch', 'commit_sha', 'role'],
    });
    source = found._source ?? undefined;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) return 'document_missing';
    throw error;
  }
  if (source === undefined) return 'document_missing';
  if (
    source.repository_id !== update.repositoryId ||
    source.base_branch !== update.baseBranch ||
    (source.commit_sha ?? '').toLowerCase() !== update.commitSha.toLowerCase() ||
    source.role !== 'merge_commit'
  ) {
    return 'guard_rejected';
  }

  const result = await dualWrite(targets, COMMIT_ALIAS, 'update', async (index) => {
    const response = await client.update({
      index,
      id,
      routing,
      refresh: true,
      retry_on_conflict: 3,
      script: {
        lang: 'painless',
        source:
          'def cur = ctx._source.merge_number_epoch;' +
          ' if (cur != null && cur > params.epoch) { ctx.op = "noop"; return; }' +
          ' boolean same = ctx._source.merge_number == params.number' +
          '  && ctx._source.merge_number_epoch == params.epoch' +
          '  && ctx._source.merge_number_state == params.state;' +
          ' if (same) { ctx.op = "noop"; return; }' +
          ' if (params.number == null) { ctx._source.remove("merge_number"); } else { ctx._source.merge_number = params.number; }' +
          ' ctx._source.merge_number_epoch = params.epoch;' +
          ' ctx._source.merge_number_state = params.state;',
        params: { number: update.state === 'assigned' ? update.mergeNumber : null, epoch: update.mergeNumberEpoch, state: update.state },
      },
    });
    return response.result;
  });
  return result === 'noop' ? 'noop' : 'updated';
}

/** 색인이 지금 말하는 M 값. 관측·대조 전용이며 표시 정본이 아니다. */
export interface MergeNumberProjection {
  readonly merge_number: number | null;
  readonly merge_number_epoch: number | null;
  readonly merge_number_state: string | null;
  readonly merge_commit_sha: string | null;
  readonly index: string;
}

/**
 * 실제 검색 hit에서 M 값을 읽는다 (`_search`, 접근 범위 필수).
 *
 * 실시간 `GET`으로 읽지 않는다 — 계약이 "검색에서 보인다"를 묻기 때문이다 (상세
 * 설계 7절). `refresh` 전 문서는 GET에는 보여도 검색에는 없다.
 *
 * @returns hit이 없으면 `null`.
 */
export async function readMergeNumberProjection(
  client: Client,
  scope: AccessScope,
  repositoryId: number,
  prNumber: number,
): Promise<MergeNumberProjection | null> {
  const scoped = applyMandatoryScopeFilter(
    { bool: { filter: [{ term: { repository_id: repositoryId } }, { term: { pr_number: prNumber } }] } },
    scope,
  );
  const response = await search<{
    merge_number?: number;
    merge_number_epoch?: number;
    merge_number_state?: string;
    merge_commit_sha?: string;
  }>(client, PR_ALIAS, scoped, {
    size: 1,
    _source: ['merge_number', 'merge_number_epoch', 'merge_number_state', 'merge_commit_sha'],
    routing: String(repositoryId),
  });
  const hit = response.hits.hits[0];
  if (hit === undefined) return null;
  const source = hit._source ?? {};
  return {
    merge_number: typeof source.merge_number === 'number' ? source.merge_number : null,
    merge_number_epoch: typeof source.merge_number_epoch === 'number' ? source.merge_number_epoch : null,
    merge_number_state: typeof source.merge_number_state === 'string' ? source.merge_number_state : null,
    merge_commit_sha: typeof source.merge_commit_sha === 'string' ? source.merge_commit_sha : null,
    index: hit._index,
  };
}

/** 워커 내부 관측용 — 자기 저장소 하나짜리 explicit 범위로 읽는다 (`findPullRequestByMergeCommit`과 같은 원칙). */
export async function readMergeNumberProjectionInternal(
  client: Client,
  repositoryId: number,
  prNumber: number,
): Promise<MergeNumberProjection | null> {
  return readMergeNumberProjection(client, { kind: 'explicit', repositoryIds: [repositoryId] }, repositoryId, prNumber);
}
