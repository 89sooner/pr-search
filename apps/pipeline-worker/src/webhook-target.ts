/**
 * 원본 웹훅 payload에서 보강 대상을 꺼낸다 (FR-ING-004).
 *
 * **여기서 타입 단언을 쓰지 않는 이유.** `payload.pull_request.number`를
 * `as number`로 믿고 넘기면 GHE가 다른 모양을 보낸 날 `undefined`가 URL에
 * `/pulls/undefined`로 들어가 404가 되고, 그 404는 "삭제된 PR"로 오해되어
 * 즉시 실패 대기열로 간다. 모양이 다르면 모양이 다르다고 말해야 한다.
 *
 * 또 하나: **PR 이벤트가 아닌 것을 PR API에 밀어 넣지 않는다.** `push`나
 * `member` 이벤트에는 PR 번호라는 개념이 없다.
 */

import type { EnrichedPullRequest } from '@prs/domain';

/**
 * 보강이 다루는 이벤트 종류.
 *
 * 이 셋만 PR 번호를 갖는다. 나머지 지원 이벤트(`push`, `release`, `member`,
 * `team`, `repository`, `create`, `delete`)는 소비자가 생길 때까지 진행되지
 * 않는다 (DEV-016). 원본은 `raw_event`에 남아 있으므로 유실이 아니다.
 */
export const PR_EVENT_TYPES: ReadonlySet<string> = new Set([
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
]);

export interface EnrichTarget {
  readonly owner: string;
  readonly repo: string;
  readonly repositoryId: number;
  readonly prNumber: number;
  /**
   * 웹훅이 이미 준 PR.
   *
   * API 보강이 실패해도 이것으로 부분 문서를 만든다 — FR-ING-004 AC-3이
   * 말하는 "웹훅 payload만으로 만든 부분 문서"가 정확히 이 값이다.
   */
  readonly webhookPullRequest: EnrichedPullRequest | null;
}

export type TargetOutcome =
  /** 보강 대상이다. */
  | { readonly kind: 'target'; readonly target: EnrichTarget }
  /** 이 워커의 일이 아니다. 진행하지 않고 ack한다. */
  | { readonly kind: 'skip'; readonly reason: string }
  /** 모양이 계약과 다르다. 재시도해도 같으므로 실패 대기열로 보낸다. */
  | { readonly kind: 'invalid'; readonly reason: string };

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** 정수만 받는다. `"1234"`도 `1234.5`도 PR 번호가 아니다. */
function asPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

/** 라벨 배열에서 이름만 꺼낸다. 모양이 다른 원소는 조용히 버린다 — 라벨 하나가
 *  이상하다고 PR 전체를 실패로 만들 이유는 없다. */
function asLabelNames(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const entry of value) {
    const name = asString(asRecord(entry)?.['name']);
    if (name !== undefined) names.push(name);
  }
  return names;
}

/** `owner/repo`를 나눈다. 조각이 둘이 아니거나 비면 실패다. */
export function splitFullName(fullName: string): { owner: string; repo: string } | undefined {
  const parts = fullName.split('/');
  if (parts.length !== 2) return undefined;
  const [owner, repo] = parts;
  if (owner === undefined || repo === undefined || owner === '' || repo === '') return undefined;
  return { owner, repo };
}

/** 웹훅의 `pull_request` 객체를 EVT-ING-002가 나르는 모양으로 정규화한다. */
export function normalizePullRequest(value: unknown): EnrichedPullRequest | undefined {
  const pr = asRecord(value);
  if (pr === undefined) return undefined;

  const number = asPositiveInteger(pr['number']);
  const head = asRecord(pr['head']);
  const base = asRecord(pr['base']);
  if (number === undefined || head === undefined || base === undefined) return undefined;

  const headRef = asString(head['ref']);
  const headSha = asString(head['sha']);
  const baseRef = asString(base['ref']);
  const baseSha = asString(base['sha']);
  if (headRef === undefined || headSha === undefined || baseRef === undefined || baseSha === undefined) {
    return undefined;
  }

  return {
    number,
    title: asString(pr['title']) ?? '',
    body: asNullableString(pr['body']),
    state: asString(pr['state']) ?? 'unknown',
    draft: asBoolean(pr['draft']),
    labels: asLabelNames(pr['labels']),
    merged: asBoolean(pr['merged']),
    created_at: asNullableString(pr['created_at']),
    updated_at: asNullableString(pr['updated_at']),
    closed_at: asNullableString(pr['closed_at']),
    merged_at: asNullableString(pr['merged_at']),
    merge_commit_sha: asNullableString(pr['merge_commit_sha']),
    author: asNullableString(asRecord(pr['user'])?.['login']),
    head_ref: headRef,
    head_sha: headSha,
    base_ref: baseRef,
    base_sha: baseSha,
  };
}

/**
 * 원본 payload에서 보강 대상을 정한다.
 *
 * @param eventType `raw_event.event_type`. 웹훅 payload 안이 아니라 헤더에서 온 값이다.
 * @param payload `raw_event.payload` 원본.
 */
export function extractTarget(eventType: string, payload: unknown): TargetOutcome {
  if (!PR_EVENT_TYPES.has(eventType)) {
    return { kind: 'skip', reason: `PR 이벤트가 아니다: ${eventType}` };
  }

  const root = asRecord(payload);
  if (root === undefined) return { kind: 'invalid', reason: 'payload가 객체가 아니다' };

  const repository = asRecord(root['repository']);
  if (repository === undefined) return { kind: 'invalid', reason: 'payload에 repository가 없다' };

  const fullName = asString(repository['full_name']);
  if (fullName === undefined) return { kind: 'invalid', reason: 'repository.full_name이 없다' };
  const slug = splitFullName(fullName);
  if (slug === undefined) {
    return { kind: 'invalid', reason: `repository.full_name이 owner/repo가 아니다: ${fullName}` };
  }

  const repositoryId = asPositiveInteger(repository['id']);
  if (repositoryId === undefined) return { kind: 'invalid', reason: 'repository.id가 없다' };

  // PR 번호의 출처는 둘이다 — `pull_request.number`가 정본이고, `pull_request`가
  // 통째로 빠진 payload를 위해 최상위 `number`를 본다.
  const webhookPullRequest = normalizePullRequest(root['pull_request']) ?? null;
  const prNumber = webhookPullRequest?.number ?? asPositiveInteger(root['number']);
  if (prNumber === undefined) {
    return { kind: 'invalid', reason: 'payload에서 PR 번호를 찾을 수 없다' };
  }

  return {
    kind: 'target',
    target: { ...slug, repositoryId, prNumber, webhookPullRequest },
  };
}
