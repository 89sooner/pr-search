/**
 * 머지 시퀀스의 문서 단위 투영기 (CR-113 / WP-098, FR-SEQ-001 AC-7, ADR-004 Amendment).
 *
 * ## `update_by_query`를 버린 이유
 *
 * 옛 `applySequenceToDocuments`는 SHA 목록으로 문서를 찾아 한 번에 갱신했다. 그 방식은
 * **없는 문서를 말하지 못한다** — `updated: 0`이 "이미 같은 값"인지 "문서가 아직 없다"인지
 * "가드에 걸렸다"인지 구분되지 않았고, 그래서 실패가 성공처럼 지나갔다(사내 `pilot.17`
 * 보고: 재색인 뒤 `merge_seq` 0/4,214). 여기서는 문서 ID로 읽고(`mget`), 문서마다 판정하고,
 * 스크립트 가드로 쓴다. 결과는 **문서별로 보존**한다 — 건수 합계는 판정 재료가 아니다.
 *
 * ## 정본은 인자로 온다
 *
 * 이 모듈은 PostgreSQL을 모른다(`@prs/es`는 `@prs/db`를 의존하지 않는다 — `write-targets.ts`와
 * 같은 이유). "어느 문서에 몇 번을 쓰는가"는 애플리케이션 계층이 정본에서 해석해
 * `SequenceProjectionItem`으로 넘긴다. 여기서는 색인의 현재 값을 **읽어 대조만** 하고, 색인
 * 값으로 정본을 추정하지 않는다.
 *
 * ## 가드는 두 번이다
 *
 * 사전 읽기(`mget`)가 이유를 만들고, 스크립트가 경쟁을 막는다. 읽은 뒤 문서가 바뀌면
 * (투영이 `merge_commit_sha`를 고치거나 다른 공간이 먼저 썼거나 에폭이 올랐거나) 스크립트가
 * 같은 조건을 다시 검사해 `noop`으로 끝내고, 호출 측은 그것을 `transient`로 받아 다시 읽는다.
 *
 * ## 무엇을 바꾸지 않나
 *
 * `document_version`(웹훅 순서의 정본), PR 문서의 `base_branch`·`merge_commit_sha`, 접근 범위
 * 필드는 건드리지 않는다. 커밋 문서의 `base_branch`는 **없을 때만** 채우고, 다른 브랜치를
 * 달고 있으면 호출 측이 정본으로 확인해 `reclaim`을 세웠을 때만 바꾼다 — 커밋 문서는 SHA당
 * 하나라(`commitDocId`) 두 시퀀스 공간이 같은 문서를 두고 다투기 때문이다.
 */

import type { Client, estypes } from '@elastic/elasticsearch';
import { classifyFailure } from './upsert.js';
import { reportShadowFailure, type WriteTargets } from './write-targets.js';

export type SequenceDocKind = 'commit' | 'pull_request';

/** 문서 하나에 비출 정본 값. 애플리케이션 계층이 PostgreSQL에서 만든다. */
export interface SequenceProjectionItem {
  readonly kind: SequenceDocKind;
  /** `commitDocId` 또는 `pullRequestDocId`가 만든 값. */
  readonly docId: string;
  readonly repositoryId: number;
  readonly baseBranch: string;
  readonly seqEpoch: number;
  /** 표시용 공간 문자열. 필터로 쓰지 않는다 (CR-025, DEV-119). */
  readonly sequenceSpace: string;
  /** 커밋 문서의 `commit_sha`, PR 문서의 `merge_commit_sha`와 대조할 SHA (소문자). */
  readonly expectedSha: string;
  readonly mergeSeq: number;
  /**
   * 커밋 문서가 **다른** `base_branch`를 달고 있어도 이 공간이 가져간다.
   * 호출 측이 정본으로 "그 공간의 현재 에폭에 이 SHA가 없다"를 확인했을 때만 세운다.
   */
  readonly reclaim?: boolean;
}

export type SequenceDocOutcomeKind =
  /** 정본 값을 새로 썼다. */
  | 'updated'
  /** 이미 정본과 같아 쓸 것이 없었다. 완료다. */
  | 'noop'
  /** dry-run — 실제라면 썼을 문서. 아무것도 쓰지 않았다. */
  | 'would_update'
  /** 문서가 아직 없다. 투영·보강이 만든 뒤 다시 온다. */
  | 'document_missing'
  /** 문서의 저장소·SHA·브랜치가 기대와 다르다. `reason`이 어느 것인지 말한다. 쓰지 않았다. */
  | 'guard_rejected'
  /** 문서가 더 높은 에폭을 달고 있다 — 이 작업은 옛 에폭의 것이다. 쓰지 않았다. */
  | 'stale_epoch'
  /** 일시 실패·충돌·읽기와 쓰기 사이의 경쟁. 다시 읽고 다시 시도한다. */
  | 'transient';

/** 사전 읽기가 본 색인의 현재 값. 관측·대조 전용이며 정본이 아니다. */
export interface ObservedSequenceFields {
  readonly repository_id: number | null;
  readonly base_branch: string | null;
  readonly sha: string | null;
  readonly merge_seq: number | null;
  readonly seq_epoch: number | null;
  readonly sequence_space: string | null;
}

export interface SequenceDocOutcome {
  readonly docId: string;
  readonly kind: SequenceDocOutcomeKind;
  /** `guard_rejected`: `repository` · `sha` · `branch`. `transient`: ES가 말한 이유. */
  readonly reason?: string;
  /** 문서가 있었으면 사전 읽기가 본 값. */
  readonly observed?: ObservedSequenceFields;
}

export type SequenceOutcomeCounts = Readonly<Record<SequenceDocOutcomeKind, number>>;

export interface SequenceProjectionIndexResult {
  /** 실제로 쓴 인덱스(별칭 또는 shadow 구체 이름). */
  readonly index: string;
  readonly outcomes: readonly SequenceDocOutcome[];
  readonly counts: SequenceOutcomeCounts;
}

/**
 * 한 번의 투영 결과. **서비스 결과와 shadow 결과를 섞지 않는다** — active가 성공했다고
 * shadow의 누락이 덮이면 재색인이 불완전한 인덱스로 전환한다 (불변식 6·7).
 */
export interface SequenceProjectionResult {
  /** 별칭별 서비스 결과. 항목이 없던 별칭은 없다. */
  readonly served: Readonly<Record<string, SequenceProjectionIndexResult>>;
  /** 별칭별 shadow 결과. shadow가 없거나 항목이 없던 별칭은 없다. 예외는 `recordShadowFailure`로 갔다. */
  readonly shadows: Readonly<Record<string, SequenceProjectionIndexResult>>;
}

export const COMMITS_ALIAS = 'prs-commits' as const;
export const PULL_REQUESTS_ALIAS = 'prs-pull-requests' as const;

export function aliasOf(kind: SequenceDocKind): typeof COMMITS_ALIAS | typeof PULL_REQUESTS_ALIAS {
  return kind === 'commit' ? COMMITS_ALIAS : PULL_REQUESTS_ALIAS;
}

function shaFieldOf(kind: SequenceDocKind): 'commit_sha' | 'merge_commit_sha' {
  return kind === 'commit' ? 'commit_sha' : 'merge_commit_sha';
}

/** 사전 읽기에서 가져오는 필드. 본문·제목은 읽지 않는다 — 대조에 필요한 것만이다. */
const OBSERVED_FIELDS = ['repository_id', 'base_branch', 'commit_sha', 'merge_commit_sha', 'merge_seq', 'seq_epoch', 'sequence_space'] as const;

interface RawObserved {
  readonly repository_id?: unknown;
  readonly base_branch?: unknown;
  readonly commit_sha?: unknown;
  readonly merge_commit_sha?: unknown;
  readonly merge_seq?: unknown;
  readonly seq_epoch?: unknown;
  readonly sequence_space?: unknown;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function observe(kind: SequenceDocKind, source: RawObserved): ObservedSequenceFields {
  const sha = asString(source[shaFieldOf(kind)]);
  return {
    repository_id: asNumber(source.repository_id),
    base_branch: asString(source.base_branch),
    sha: sha === null ? null : sha.toLowerCase(),
    merge_seq: asNumber(source.merge_seq),
    seq_epoch: asNumber(source.seq_epoch),
    sequence_space: asString(source.sequence_space),
  };
}

export const SEQUENCE_PROJECTION_CHUNK = 500;

/**
 * 한 인덱스에서 항목들의 현재 값을 읽는다. 없는 문서는 `null`이다.
 *
 * 재색인의 전환 전 검증도 이 함수로 **구체 target 인덱스**를 읽는다 — 읽는 자리가 하나여야
 * 검증이 투영과 다른 눈으로 보지 않는다.
 */
export async function readSequenceProjection(
  client: Client,
  index: string,
  items: readonly Pick<SequenceProjectionItem, 'kind' | 'docId' | 'repositoryId'>[],
): Promise<Map<string, ObservedSequenceFields | null>> {
  const out = new Map<string, ObservedSequenceFields | null>();
  for (let offset = 0; offset < items.length; offset += SEQUENCE_PROJECTION_CHUNK) {
    const chunk = items.slice(offset, offset + SEQUENCE_PROJECTION_CHUNK);
    if (chunk.length === 0) continue;
    const response = await client.mget<RawObserved>({
      index,
      docs: chunk.map((item) => ({
        _id: item.docId,
        routing: String(item.repositoryId),
        _source: [...OBSERVED_FIELDS],
      })),
    });
    response.docs.forEach((doc, position) => {
      const item = chunk[position];
      if (item === undefined) return;
      const found = doc as { found?: boolean; _source?: RawObserved; error?: unknown };
      if (found.error !== undefined) {
        throw new Error(`mget 항목 실패 ${item.docId}: ${JSON.stringify(found.error).slice(0, 200)}`);
      }
      out.set(item.docId, found.found === true ? observe(item.kind, found._source ?? {}) : null);
    });
  }
  return out;
}

type Classification =
  | { readonly kind: 'write' }
  | { readonly kind: 'noop' }
  | { readonly kind: 'document_missing' }
  | { readonly kind: 'guard_rejected'; readonly reason: 'repository' | 'sha' | 'branch' }
  | { readonly kind: 'stale_epoch' };

/**
 * 사전 읽기 값으로 문서 하나를 판정한다. 스크립트가 같은 규칙을 다시 검사한다 — 둘이
 * 다르면 읽기는 한 이유를 말하고 쓰기는 다른 일을 한다.
 */
export function classifySequenceTarget(item: SequenceProjectionItem, observed: ObservedSequenceFields | null): Classification {
  if (observed === null) return { kind: 'document_missing' };
  if (observed.repository_id !== item.repositoryId) return { kind: 'guard_rejected', reason: 'repository' };
  if (observed.sha !== item.expectedSha.toLowerCase()) return { kind: 'guard_rejected', reason: 'sha' };
  const sameBranch = observed.base_branch === item.baseBranch;
  if (item.kind === 'pull_request') {
    // PR의 base 브랜치는 PR의 사실이다. 복구가 그것을 바꾸지 않는다 — 다르면 이 공간의 PR이 아니다.
    if (!sameBranch) return { kind: 'guard_rejected', reason: 'branch' };
  } else if (observed.base_branch !== null && !sameBranch && item.reclaim !== true) {
    return { kind: 'guard_rejected', reason: 'branch' };
  }
  if (sameBranch && observed.seq_epoch !== null && observed.seq_epoch > item.seqEpoch) return { kind: 'stale_epoch' };
  const same =
    sameBranch &&
    observed.merge_seq === item.mergeSeq &&
    observed.seq_epoch === item.seqEpoch &&
    observed.sequence_space === item.sequenceSpace;
  return same ? { kind: 'noop' } : { kind: 'write' };
}

/**
 * 쓰기 스크립트. 사전 읽기와 **같은 규칙**을 실제 갱신 시점에 다시 검사한다.
 *
 * 가드에 걸리면 `noop`으로 끝낸다 — 호출 측은 "쓰려던 것이 noop으로 끝났다"를 경쟁으로 보고
 * `transient`로 분류해 다시 읽는다. 같은 값이면 진짜 noop이지만 그 경우는 사전 읽기가 이미
 * 걸러 여기까지 오지 않는다.
 */
export const SEQUENCE_PROJECTION_SCRIPT = [
  'def sha = ctx._source[params.sha_field];',
  "if (sha == null || !sha.toLowerCase().equals(params.sha)) { ctx.op = 'noop'; return; }",
  "if (ctx._source.repository_id != params.repository_id) { ctx.op = 'noop'; return; }",
  'def branch = ctx._source.base_branch;',
  'boolean same_branch = branch != null && branch.equals(params.branch);',
  "if (params.kind == 'pull_request') { if (!same_branch) { ctx.op = 'noop'; return; } }",
  "else if (branch != null && !same_branch && !params.reclaim) { ctx.op = 'noop'; return; }",
  'def epoch = ctx._source.seq_epoch;',
  "if (same_branch && epoch != null && epoch > params.epoch) { ctx.op = 'noop'; return; }",
  'boolean same = same_branch && ctx._source.merge_seq == params.seq && epoch == params.epoch',
  '  && params.space.equals(ctx._source.sequence_space);',
  "if (same) { ctx.op = 'noop'; return; }",
  'ctx._source.merge_seq = params.seq;',
  'ctx._source.seq_epoch = params.epoch;',
  'ctx._source.sequence_space = params.space;',
  'ctx._source.base_branch = params.branch;',
].join('\n');

const RETRY_ON_CONFLICT = 3;

function emptyCounts(): Record<SequenceDocOutcomeKind, number> {
  return { updated: 0, noop: 0, would_update: 0, document_missing: 0, guard_rejected: 0, stale_epoch: 0, transient: 0 };
}

export interface ProjectSequenceOptions {
  /** 읽고 판정만 한다. `write`는 `would_update`로 보고하고 아무것도 쓰지 않는다. */
  readonly dryRun?: boolean;
}

/** 한 인덱스에 항목들을 비춘다. 서비스와 shadow가 **같은 경로**를 쓴다. */
async function projectIntoIndex(
  client: Client,
  index: string,
  items: readonly SequenceProjectionItem[],
  options: ProjectSequenceOptions,
): Promise<SequenceProjectionIndexResult> {
  const observed = await readSequenceProjection(client, index, items);
  const outcomes: SequenceDocOutcome[] = [];
  const counts = emptyCounts();
  const pending: SequenceProjectionItem[] = [];

  for (const item of items) {
    const seen = observed.get(item.docId) ?? null;
    const verdict = classifySequenceTarget(item, seen);
    const base = seen === null ? {} : { observed: seen };
    switch (verdict.kind) {
      case 'write':
        if (options.dryRun === true) {
          outcomes.push({ docId: item.docId, kind: 'would_update', ...base });
          counts.would_update += 1;
        } else {
          pending.push(item);
        }
        break;
      case 'guard_rejected':
        outcomes.push({ docId: item.docId, kind: 'guard_rejected', reason: verdict.reason, ...base });
        counts.guard_rejected += 1;
        break;
      default:
        outcomes.push({ docId: item.docId, kind: verdict.kind, ...base });
        counts[verdict.kind] += 1;
    }
  }

  for (let offset = 0; offset < pending.length; offset += SEQUENCE_PROJECTION_CHUNK) {
    const chunk = pending.slice(offset, offset + SEQUENCE_PROJECTION_CHUNK);
    const operations: unknown[] = [];
    for (const item of chunk) {
      operations.push({ update: { _index: index, _id: item.docId, routing: String(item.repositoryId), retry_on_conflict: RETRY_ON_CONFLICT } });
      operations.push({
        script: {
          lang: 'painless',
          source: SEQUENCE_PROJECTION_SCRIPT,
          params: {
            kind: item.kind,
            sha_field: shaFieldOf(item.kind),
            sha: item.expectedSha.toLowerCase(),
            repository_id: item.repositoryId,
            branch: item.baseBranch,
            epoch: item.seqEpoch,
            seq: item.mergeSeq,
            space: item.sequenceSpace,
            reclaim: item.reclaim === true,
          },
        },
      });
    }
    /*
     * `refresh: true` — 서수는 검색에서 보여야 뜻이 있고(정렬·`seq:` 범위), 호출 측의 검증이
     * 곧바로 검색으로 대조한다. 옛 `update_by_query`도 같은 선택이었다.
     */
    const response = await client.bulk({ refresh: true, operations: operations as NonNullable<estypes.BulkRequest['operations']> });
    response.items.forEach((entry, position) => {
      const item = chunk[position];
      if (item === undefined) return;
      const update = entry.update;
      const seen = observed.get(item.docId) ?? null;
      const base = seen === null ? {} : { observed: seen };
      if (update === undefined) {
        outcomes.push({ docId: item.docId, kind: 'transient', reason: 'bulk_item_missing', ...base });
        counts.transient += 1;
        return;
      }
      const status = update.status ?? 0;
      if (update.error === undefined && status < 300) {
        if (update.result === 'updated') {
          outcomes.push({ docId: item.docId, kind: 'updated', ...base });
          counts.updated += 1;
        } else {
          // 쓰려 했는데 스크립트가 noop으로 끝냈다 — 읽기와 쓰기 사이에 문서가 바뀌었다. 다시 읽는다.
          outcomes.push({ docId: item.docId, kind: 'transient', reason: 'guard_raced', ...base });
          counts.transient += 1;
        }
        return;
      }
      if (status === 404) {
        outcomes.push({ docId: item.docId, kind: 'document_missing' });
        counts.document_missing += 1;
        return;
      }
      const type = update.error?.type ?? 'unknown';
      const verdict = status === 409 ? 'retryable' : classifyFailure(status, update.error);
      outcomes.push({ docId: item.docId, kind: 'transient', reason: `${String(status)} ${type}${verdict === 'rejected' ? ' (rejected)' : ''}`, ...base });
      counts.transient += 1;
    });
  }

  // 항목 순서를 입력 순서로 되돌린다 — 호출 측이 위치로 대조하지 않게 하려는 배려일 뿐이다.
  const order = new Map(items.map((item, index) => [item.docId, index]));
  outcomes.sort((a, b) => (order.get(a.docId) ?? 0) - (order.get(b.docId) ?? 0));
  return { index, outcomes, counts };
}

/**
 * 커밋·PR 문서에 정본 서수를 비춘다. 별칭마다 서비스 인덱스에 쓰고, shadow가 있으면
 * **같은 항목을 같은 규칙으로** 한 번 더 쓴다 (WP-035 이중 쓰기, DEV-295).
 *
 * 서비스 쪽 예외는 그대로 던진다. shadow 쪽 예외는 `recordShadowFailure`로만 알린다 —
 * 그러나 shadow의 **문서별 결과**는 돌려준다. 재색인 replay가 "target 인덱스에 다 썼는가"를
 * 그 결과로 판정한다.
 */
export async function projectSequenceToDocuments(
  client: Client,
  items: readonly SequenceProjectionItem[],
  targets: WriteTargets,
  options: ProjectSequenceOptions = {},
): Promise<SequenceProjectionResult> {
  const served: Record<string, SequenceProjectionIndexResult> = {};
  const shadows: Record<string, SequenceProjectionIndexResult> = {};
  const byAlias = new Map<string, SequenceProjectionItem[]>();
  for (const item of items) {
    const alias = aliasOf(item.kind);
    byAlias.set(alias, [...(byAlias.get(alias) ?? []), item]);
  }

  for (const [alias, group] of byAlias) {
    served[alias] = await projectIntoIndex(client, alias, group, options);
    const shadow = targets.shadows[alias];
    if (shadow === undefined) continue;
    try {
      shadows[alias] = await projectIntoIndex(client, shadow, group, options);
    } catch (error) {
      reportShadowFailure(targets, { alias, index: shadow, operation: 'update', reason: String(error) });
    }
  }
  return { served, shadows };
}

/** 결과 하나가 "이 인덱스에서 끝났다"고 볼 수 있는가 — 쓸 것이 없거나 썼다. */
export function isSettledOutcome(kind: SequenceDocOutcomeKind): boolean {
  return kind === 'updated' || kind === 'noop';
}

/**
 * 대표 범위 조회 — 구체 인덱스에서 한 공간·에폭의 `[from, to]` 구간을 서수 순으로 읽는다.
 * 재색인의 전환 전 검증이 "실제 정렬이 정본 순서와 같은가"를 여기서 본다. 결과는 서수
 * 목록뿐이며 사용자에게 나가지 않는다.
 */
export async function readSequenceOrder(
  client: Client,
  index: string,
  space: { readonly repositoryId: number; readonly baseBranch: string; readonly seqEpoch: number },
  range: { readonly fromInclusive: number; readonly toInclusive: number },
): Promise<readonly { readonly docId: string; readonly mergeSeq: number }[]> {
  const size = Math.max(0, range.toInclusive - range.fromInclusive + 1);
  if (size === 0) return [];
  const response = await client.search<{ doc_id?: string; merge_seq?: number }>({
    index,
    routing: String(space.repositoryId),
    size: Math.min(size, 10_000),
    _source: ['doc_id', 'merge_seq'],
    sort: [{ merge_seq: { order: 'asc' } }, { doc_id: { order: 'asc' } }],
    query: {
      bool: {
        filter: [
          { term: { repository_id: space.repositoryId } },
          { term: { base_branch: space.baseBranch } },
          { term: { seq_epoch: space.seqEpoch } },
          { range: { merge_seq: { gte: range.fromInclusive, lte: range.toInclusive } } },
        ],
      },
    },
  });
  return response.hits.hits.map((hit) => ({
    docId: hit._source?.doc_id ?? hit._id ?? '',
    mergeSeq: Number(hit._source?.merge_seq ?? Number.NaN),
  }));
}
