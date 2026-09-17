/**
 * CR-101 / DEV-718 — 병합된 PR의 `state` 계약: 투영이 만드는 값과 질의가 찾는 값이 같은가.
 *
 * pilot.12에서 Status=Merged와 My merged PRs가 0건이었던 원인은 질의가 아니라 문서였다. 투영이
 * GitHub의 원시 `state`(`open`·`closed`)를 그대로 색인해 `is:merged`(`term state=merged`)와 맞는
 * 문서가 없었다. 단위 시험은 투영의 `state`를 단언하지 않았고 통합·e2e 픽스처는 `state:'merged'`를
 * 손으로 심어 두 계층이 각자 통과했다. 이 시험은 **실제 투영 함수의 출력**을 **실제 질의 번역**과
 * 맞대어, 어느 한쪽이 어긋나면 여기서 깨지게 한다.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseQuery } from '@prs/query';
import { EMPTY_RESOLUTION, buildQuery } from '@prs/es';
import { PULL_REQUEST_STATES, derivePullRequestState, type EnrichedPullRequest, type IngestionEnriched } from '@prs/domain';
import type { RepositoryRow } from '@prs/db';
import { buildPullRequestDocument } from '../apps/pipeline-worker/src/documents.js';

const REPOSITORY: RepositoryRow = {
  repository_id: 4021,
  owner: 'acme',
  name: 'payments',
  org_id: 77,
  visibility: 'internal',
  sequence_branches: ['main'],
  mirror_enabled: true,
  status: 'active',
  registered_at: new Date('2026-08-01T00:00:00.000Z'),
  allowed_team_ids: [],
  snapshot_bootstrapped_at: null,
  last_reconciled_at: null,
  last_reconcile_missing_count: null,
  annotate_enabled: true,
  annotate_blocked_at: null,
  annotate_blocked_reason: null,
};

/** GitHub REST·웹훅이 병합된 PR에 실제로 주는 모양: `state: closed` + `merged: true` + `merged_at`. */
const MERGED_PR: EnrichedPullRequest = {
  number: 1234,
  title: 'feat: 결제 재시도',
  body: null,
  state: 'closed',
  draft: false,
  labels: [],
  merged: true,
  created_at: '2026-08-01T09:00:00.000Z',
  updated_at: '2026-08-02T10:30:00.000Z',
  closed_at: '2026-08-02T10:30:00.000Z',
  merged_at: '2026-08-02T10:30:00.000Z',
  merge_commit_sha: 'a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5',
  author: 'jdoe',
  head_ref: 'feature/retry',
  head_sha: 'b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e',
  base_ref: 'main',
  base_sha: 'c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e',
};

function enriched(pullRequest: EnrichedPullRequest): IngestionEnriched {
  return {
    delivery_id: 'delivery-cr101',
    repository_id: REPOSITORY.repository_id,
    entity_kind: 'pull_request',
    pr_number: pullRequest.number,
    pull_request: pullRequest,
    source_commit_shas: [],
    changed_files: [],
    reviews: [],
    source_commits_truncated: false,
    files_truncated: false,
    enrichment_pending: false,
    enrichment_errors: [],
    correlation_id: 'corr-cr101',
  };
}

function docOf(pullRequest: EnrichedPullRequest): Record<string, unknown> {
  return buildPullRequestDocument({
    enriched: enriched(pullRequest),
    repository: REPOSITORY,
    documentVersion: 1_754_042_400_000,
    indexedAt: new Date('2026-08-02T10:30:05.000Z'),
    authorTeams: { kind: 'unknown' },
  }).doc as Record<string, unknown>;
}

/** 질의가 `state`에 거는 값들. 번역기가 `term`(단일)이든 `terms`(목록)든 값만 본다 — 모양은 번역기의 몫이다. */
function stateValuesOf(query: string): string[] {
  const built = buildQuery(parseQuery(query), EMPTY_RESOLUTION);
  const filters = ((built.query as { bool?: { filter?: unknown[] } }).bool?.filter ?? []) as Record<string, unknown>[];
  const values: string[] = [];
  for (const clause of filters) {
    const term = clause['term'] as { state?: unknown } | undefined;
    const terms = clause['terms'] as { state?: unknown } | undefined;
    if (typeof term?.state === 'string') values.push(term.state);
    if (Array.isArray(terms?.state)) values.push(...(terms.state as string[]));
  }
  return values;
}

const read = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

describe('병합된 PR의 state 계약 (CR-101 / DEV-718)', () => {
  it('**GitHub이 closed + merged로 준 PR을 투영은 merged로 색인하고, is:merged와 state:merged는 바로 그 값을 찾는다**', () => {
    const doc = docOf(MERGED_PR);
    expect(doc['state']).toBe('merged');
    expect(stateValuesOf('is:merged')).toEqual([doc['state']]);
    expect(stateValuesOf('state:merged')).toEqual([doc['state']]);
    // 병합된 PR은 더 이상 closed가 아니다 — 세 상태는 배타다.
    expect(stateValuesOf('is:closed')).not.toContain(doc['state']);
  });

  it('병합되지 않은 closed와 open은 원시 값 그대로이며 is:closed·is:open이 각각 찾는다', () => {
    const closed = docOf({ ...MERGED_PR, merged: false, merged_at: null });
    expect(closed['state']).toBe('closed');
    expect(stateValuesOf('is:closed')).toEqual([closed['state']]);
    expect(stateValuesOf('is:merged')).not.toContain(closed['state']);
    const open = docOf({ ...MERGED_PR, state: 'open', merged: false, merged_at: null, closed_at: null });
    expect(open['state']).toBe('open');
    expect(stateValuesOf('is:open')).toEqual([open['state']]);
  });

  it('투영·마이그레이션 032·M 번호의 관문이 같은 어휘(`merged`)를 쓴다', () => {
    expect(PULL_REQUEST_STATES).toContain('merged');
    expect(derivePullRequestState({ state: 'closed', merged: true })).toBe('merged');
    expect(read('apps/pipeline-worker/src/documents.ts')).toContain("put(doc, 'state', derivePullRequestState(pr))");
    const migration = read('packages/db/migrations/032_pull_request_snapshot_merged_state.up.sql');
    expect(migration).toContain(`'"merged"'::jsonb`);
    expect(migration).toContain("document->>'merged_at' IS NOT NULL");
    // 늦은 PR 스냅숏의 채번 재개 관문(AC-11)과 스냅숏 근거는 같은 값을 기다린다 — 이제 실제 문서가 그 값을 갖는다.
    expect(read('apps/pipeline-worker/src/snapshot.ts')).toContain("doc.state !== 'merged'");
    expect(read('apps/pipeline-worker/src/mnumber-evidence.ts')).toContain("doc['state'] === 'merged'");
  });
});
