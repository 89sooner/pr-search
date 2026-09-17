/**
 * 운영자 확인서의 순수 판정 (CR-100 / WP-088, FR-SEQ-008 AC-15, ENT-SEQ-008, ADR-023 보완).
 *
 * ## 확인서가 하는 일 한 문장
 *
 * **근거 조회가 이미 「부재 미확정」이나 「프로파일 밖」으로 끝난 항목을, 유예가 지났고 범위 안이면,
 * 번호를 받지도 소비하지도 않는 `direct_confirmed`로 바꾼다.** 새 조회를 하지 않고 기존 판정 위에
 * 얹힌다 — 확인서가 없으면 이 파일은 아무것도 바꾸지 않는다.
 *
 * ## 확인서가 덮지 않는 것
 *
 * | 사유 | 왜 덮지 않는가 |
 * | --- | --- |
 * | `pr_evidence_pending` · `profile_unverified` | 아직 묻지 못했다. 「모른다」는 「없다」가 아니다 |
 * | `partial_lookup` · `fetch_failed` | 열거가 끝나지 않았거나 실패했다. 다음 회차가 이어 간다 |
 * | `mapping_conflict` · `canonical_mismatch` · `number_capacity_exceeded` | 데이터 충돌이다. 사람이 원인을 봐야 한다 |
 *
 * ## 유예는 근거가 아니라 안전 여유다
 *
 * AC-10대로 시간 경과는 직접 푸시의 근거가 아니다. 근거는 확인서다. 유예는 **늦게 도착하는 PR 정보가
 * 먼저 확정될 기회**를 주는 장치다 — 방금 squash된 PR을 GHE 검색 색인이 아직 모를 때 그것을 직접
 * 푸시로 지나가면 그 PR은 이 에폭에서 번호를 받지 못한다(AC-3, 번호는 옮기지 않는다). 기준 시각은
 * 정본 행의 `committed_at`이라 과거 이력의 backfill은 첫 회차에 한 번에 지나가고, 새 push는 유예 뒤에
 * 다시 본다.
 */

import type { AttestationRow, EvidenceUpsert } from '@prs/db';
import type { MergeNumberBlockReason } from '@prs/domain';
import type { EvidenceDecision } from './mnumber-evidence.js';

/** 확인서가 덮는 사유. 나머지는 위 표의 이유로 덮지 않는다. */
export const ATTESTABLE_REASONS: readonly MergeNumberBlockReason[] = ['negative_evidence_unavailable', 'unsupported_merge_profile'];

/** 기본 유예 24시간. `prsctl mnumber attest --grace-hours`로 바꾼다. */
export const DEFAULT_ATTESTATION_GRACE_SECONDS = 24 * 60 * 60;
/** 유예 상한 30일 — DB CHECK와 같은 값이다. */
export const MAX_ATTESTATION_GRACE_SECONDS = 30 * 24 * 60 * 60;

export type AttestationVerdict =
  /** 확인서가 이 항목을 덮지 않는다. 판정은 그대로다. */
  | { readonly kind: 'not_applicable' }
  /** 덮는 항목이지만 유예가 아직 지나지 않았다. `readyAt`에 다시 본다. */
  | { readonly kind: 'grace_pending'; readonly readyAt: Date }
  /** 번호 없이 지나간다. 저장할 근거가 `decision.upsert`다. */
  | { readonly kind: 'attested'; readonly decision: EvidenceDecision & { readonly kind: 'direct_confirmed' } };

export function isAttestableReason(reason: string): reason is (typeof ATTESTABLE_REASONS)[number] {
  return (ATTESTABLE_REASONS as readonly string[]).includes(reason);
}

export interface ApplyAttestationInput {
  readonly attestation: Pick<AttestationRow, 'attestation_id' | 'through_seq' | 'grace_seconds'>;
  /** `resolveEvidence`의 판정. `unresolved`가 아니면 아무것도 하지 않는다. */
  readonly decision: EvidenceDecision;
  readonly row: { readonly mergeSeq: number; readonly committedAt: Date };
  readonly now: Date;
}

export function applyAttestation(input: ApplyAttestationInput): AttestationVerdict {
  const { attestation, decision, row, now } = input;
  if (decision.kind !== 'unresolved') return { kind: 'not_applicable' };
  if (!isAttestableReason(decision.reason)) return { kind: 'not_applicable' };
  if (attestation.through_seq !== null && row.mergeSeq > attestation.through_seq) return { kind: 'not_applicable' };

  const readyAt = new Date(row.committedAt.getTime() + attestation.grace_seconds * 1_000);
  if (now.getTime() < readyAt.getTime()) return { kind: 'grace_pending', readyAt };

  const upsert: EvidenceUpsert = {
    ...decision.upsert,
    state: 'direct_confirmed',
    prNumber: null,
    reason: null,
    sourceKind: 'operator_attestation',
    sourcePrVersion: null,
    mergedAt: null,
    proof: {
      ...decision.upsert.proof,
      attestation_id: attestation.attestation_id,
      attested_reason: decision.reason,
      attested_at: now.toISOString(),
      grace_seconds: attestation.grace_seconds,
      committed_at: row.committedAt.toISOString(),
    },
  };
  return { kind: 'attested', decision: { kind: 'direct_confirmed', upsert } };
}
