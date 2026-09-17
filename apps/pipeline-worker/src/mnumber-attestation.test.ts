/**
 * 운영자 확인서 순수 판정 (CR-100 / WP-088, FR-SEQ-008 AC-15).
 *
 * 저장소 없이 돈다. 여기서 정하는 것은 「무엇을 덮고 무엇을 덮지 않는가」와 「유예의 기준 시각」이다.
 */

import { describe, expect, it } from 'vitest';
import type { MergeNumberBlockReason } from '@prs/domain';
import { MERGE_NUMBER_BLOCK_REASONS } from '@prs/domain';
import { ATTESTABLE_REASONS, applyAttestation, isAttestableReason } from './mnumber-attestation.js';
import type { EvidenceDecision } from './mnumber-evidence.js';

const COMMITTED_AT = new Date('2026-09-01T00:00:00Z');

function unresolved(reason: MergeNumberBlockReason, mergeSeq = 1): EvidenceDecision {
  return {
    kind: 'unresolved',
    reason,
    upsert: {
      repositoryId: 7431,
      baseBranch: 'main',
      seqEpoch: 1,
      mergeSeq,
      commitSha: 'a'.repeat(40),
      state: 'unresolved',
      prNumber: null,
      reason,
      sourceKind: 'unresolved_lookup',
      sourcePrVersion: null,
      mergedAt: null,
      proof: { schema_version: 1, profile: 'squash_only', lookup_complete: true, page_count: 1 },
    },
  };
}

const attestation = { attestation_id: 9, through_seq: null, grace_seconds: 3_600 };

describe('운영자 확인서가 덮는 사유', () => {
  it('부재 미확정과 프로파일 밖, 둘뿐이다 — 나머지 사유는 전부 덮지 않는다', () => {
    expect([...ATTESTABLE_REASONS].sort()).toEqual(['negative_evidence_unavailable', 'unsupported_merge_profile']);
    for (const reason of MERGE_NUMBER_BLOCK_REASONS) {
      const verdict = applyAttestation({ attestation, decision: unresolved(reason), row: { mergeSeq: 1, committedAt: COMMITTED_AT }, now: new Date('2026-09-02T00:00:00Z') });
      expect(verdict.kind, reason).toBe(isAttestableReason(reason) ? 'attested' : 'not_applicable');
    }
  });

  it('확정된 판정은 건드리지 않는다', () => {
    const confirmed: EvidenceDecision = { kind: 'direct_confirmed', upsert: null };
    expect(applyAttestation({ attestation, decision: confirmed, row: { mergeSeq: 1, committedAt: COMMITTED_AT }, now: new Date('2026-09-02T00:00:00Z') })).toEqual({ kind: 'not_applicable' });
  });
});

describe('범위와 유예', () => {
  it('`through_seq` 너머의 서수는 덮지 않는다 (포함 경계)', () => {
    const bounded = { ...attestation, through_seq: 3 };
    const now = new Date('2026-09-02T00:00:00Z');
    expect(applyAttestation({ attestation: bounded, decision: unresolved('negative_evidence_unavailable', 3), row: { mergeSeq: 3, committedAt: COMMITTED_AT }, now }).kind).toBe('attested');
    expect(applyAttestation({ attestation: bounded, decision: unresolved('negative_evidence_unavailable', 4), row: { mergeSeq: 4, committedAt: COMMITTED_AT }, now }).kind).toBe('not_applicable');
  });

  it('**유예의 기준은 `committed_at`이다** — 지나지 않았으면 그 시각을 돌려주고, 지나면 덮는다', () => {
    const pending = applyAttestation({ attestation, decision: unresolved('negative_evidence_unavailable'), row: { mergeSeq: 1, committedAt: COMMITTED_AT }, now: new Date('2026-09-01T00:59:59Z') });
    expect(pending).toEqual({ kind: 'grace_pending', readyAt: new Date('2026-09-01T01:00:00Z') });
    const attested = applyAttestation({ attestation, decision: unresolved('negative_evidence_unavailable'), row: { mergeSeq: 1, committedAt: COMMITTED_AT }, now: new Date('2026-09-01T01:00:00Z') });
    expect(attested.kind).toBe('attested');
  });

  it('유예 0은 즉시 덮는다 — backfill의 값이다', () => {
    const verdict = applyAttestation({ attestation: { ...attestation, grace_seconds: 0 }, decision: unresolved('unsupported_merge_profile'), row: { mergeSeq: 1, committedAt: COMMITTED_AT }, now: COMMITTED_AT });
    expect(verdict.kind).toBe('attested');
  });
});

describe('저장할 근거', () => {
  it('**번호를 받지도 소비하지도 않는 `direct_confirmed`이고 출처는 확인서다**; 원 사유·확인서 ID·유예·기준 시각이 proof에 남는다', () => {
    const now = new Date('2026-09-02T00:00:00Z');
    const verdict = applyAttestation({ attestation, decision: unresolved('unsupported_merge_profile', 7), row: { mergeSeq: 7, committedAt: COMMITTED_AT }, now });
    if (verdict.kind !== 'attested') throw new Error(`attested가 아니다: ${verdict.kind}`);
    expect(verdict.decision.kind).toBe('direct_confirmed');
    expect(verdict.decision.upsert).toMatchObject({
      mergeSeq: 7,
      state: 'direct_confirmed',
      prNumber: null,
      reason: null,
      sourceKind: 'operator_attestation',
      mergedAt: null,
      proof: {
        schema_version: 1,
        profile: 'squash_only',
        lookup_complete: true,
        attestation_id: 9,
        attested_reason: 'unsupported_merge_profile',
        attested_at: '2026-09-02T00:00:00.000Z',
        grace_seconds: 3_600,
        committed_at: '2026-09-01T00:00:00.000Z',
      },
    });
  });
});
