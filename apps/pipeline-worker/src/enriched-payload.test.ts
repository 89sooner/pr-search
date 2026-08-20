/**
 * `EVT-ING-002` payload 검증 (WP-008).
 *
 * 이 이벤트는 우리가 만든다. 그래서 시험의 목적은 "남의 API가 이상할 때"가
 * 아니라 **"우리 계약이 깨졌을 때 조용히 넘어가지 않는가"**다.
 */

import { describe, expect, it } from 'vitest';
import { parseEnriched } from './enriched-payload.js';

const VALID = {
  delivery_id: 'delivery-1',
  repository_id: 4021,
  entity_kind: 'pull_request',
  pr_number: 1234,
  pull_request: {
    number: 1234,
    title: 'feat: 결제 재시도',
    body: null,
    state: 'open',
    draft: false,
    labels: ['bug'],
    merged: false,
    created_at: '2026-08-01T09:00:00.000Z',
    updated_at: null,
    closed_at: null,
    merged_at: null,
    merge_commit_sha: null,
    author: 'jdoe',
    head_ref: 'feature/retry',
    head_sha: 'b1c2',
    base_ref: 'main',
    base_sha: 'c1d2',
  },
  source_commit_shas: ['dddd1111'],
  changed_files: [{ filename: 'src/pay.ts', additions: 3, deletions: 1, status: 'modified' }],
  reviews: [{ id: 1, state: 'APPROVED', reviewer: 'alice', submitted_at: '2026-08-01T12:00:00.000Z' }],
  source_commits_truncated: false,
  files_truncated: false,
  enrichment_pending: false,
  enrichment_errors: [],
  correlation_id: 'corr-1',
};

describe('parseEnriched', () => {
  it('정상 payload를 그대로 읽는다', () => {
    const parsed = parseEnriched(VALID);
    expect(parsed.kind).toBe('ok');
    if (parsed.kind !== 'ok') return;
    expect(parsed.enriched.delivery_id).toBe('delivery-1');
    expect(parsed.enriched.pull_request?.author).toBe('jdoe');
    expect(parsed.enriched.changed_files).toHaveLength(1);
    expect(parsed.enriched.reviews[0]?.state).toBe('APPROVED');
  });

  it.each([
    ['payload가 객체가 아니다', 'not-an-object'],
    ['delivery_id가 없다', { ...VALID, delivery_id: '' }],
    ['repository_id가 없다', { ...VALID, repository_id: '4021' }],
    ['pr_number가 없다', { ...VALID, pr_number: 0 }],
  ])('%s면 거절한다', (_label, payload) => {
    expect(parseEnriched(payload).kind).toBe('invalid');
  });

  it('알 수 없는 entity_kind를 거절한다 — PR API에 다른 것을 밀어 넣지 않는다', () => {
    const parsed = parseEnriched({ ...VALID, entity_kind: 'release' });
    expect(parsed.kind).toBe('invalid');
    if (parsed.kind !== 'invalid') return;
    expect(parsed.reason).toContain('release');
  });

  it('모양이 깨진 PR은 null로 두고 이벤트는 살린다 (부분 문서가 낫다)', () => {
    const parsed = parseEnriched({ ...VALID, pull_request: { number: 1234 } });
    expect(parsed.kind).toBe('ok');
    if (parsed.kind !== 'ok') return;
    expect(parsed.enriched.pull_request).toBeNull();
    expect(parsed.enriched.pr_number).toBe(1234);
  });

  it('배열 원소 하나가 이상하면 그 원소만 버린다', () => {
    const parsed = parseEnriched({
      ...VALID,
      changed_files: [{ filename: 'ok.ts', additions: 1, deletions: 0, status: 'modified' }, { additions: 9 }],
      reviews: [{ id: 1, state: 'APPROVED', reviewer: 'alice', submitted_at: null }, { state: 'APPROVED' }],
      source_commit_shas: ['aaaa', 42, ''],
    });
    expect(parsed.kind).toBe('ok');
    if (parsed.kind !== 'ok') return;
    expect(parsed.enriched.changed_files).toHaveLength(1);
    expect(parsed.enriched.reviews).toHaveLength(1);
    expect(parsed.enriched.source_commit_shas).toEqual(['aaaa']);
  });

  it('빠진 불리언은 false로 읽는다 — 절삭됐다고 지어내지 않는다', () => {
    const { files_truncated, source_commits_truncated, enrichment_pending, ...rest } = VALID;
    void files_truncated;
    void source_commits_truncated;
    void enrichment_pending;
    const parsed = parseEnriched(rest);
    expect(parsed.kind).toBe('ok');
    if (parsed.kind !== 'ok') return;
    expect(parsed.enriched.files_truncated).toBe(false);
    expect(parsed.enriched.source_commits_truncated).toBe(false);
    expect(parsed.enriched.enrichment_pending).toBe(false);
  });
});
