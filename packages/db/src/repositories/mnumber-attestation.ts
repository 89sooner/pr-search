/**
 * `mnumber_attestation` 리포지터리 (ENT-SEQ-008, FR-SEQ-008 AC-15 / CR-100 · WP-088, ADR-023 보완).
 *
 * ## 확인서가 무엇인가
 *
 * 운영자가 「이 시퀀스 공간의 이 에폭에서, PR 근거가 끝내 나오지 않은 항목과 squash 프로파일 밖
 * 항목은 번호를 받지 않고 지나간다」고 행위자·사유와 함께 남긴 결정이다. 공식 GHE 읽기 계약에는
 * 직접 푸시의 부재 증서가 없어(DEV-581) production이 스스로 `direct_confirmed`를 만들지 못하는데,
 * 확인서는 상세 설계 2.2가 열어 둔 「사내 승인된 증거 소스」다.
 *
 * ## 표가 지키는 규칙
 *
 * - 공간·에폭마다 활성 확인서는 하나다 (부분 유일 인덱스). 바꾸려면 철회하고 다시 만든다.
 * - 철회는 세 열만 바꾼다. 본문은 불변이라 감사 기록과 대조할 수 있다.
 * - 에폭이 오르면 옛 확인서는 조회되지 않는다 — 확인서 자체는 남아 이력이 된다.
 */

import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

export interface AttestationRow {
  readonly attestation_id: number;
  readonly repository_id: number;
  readonly base_branch: string;
  readonly seq_epoch: number;
  /** NULL이면 에폭 전체. 값이 있으면 그 서수까지(포함). */
  readonly through_seq: number | null;
  /** `committed_at`부터 이 시간이 지난 항목에만 적용한다. */
  readonly grace_seconds: number;
  readonly actor: string;
  readonly reason: string;
  readonly created_at: Date;
  readonly revoked_at: Date | null;
  readonly revoked_by: string | null;
  readonly revoke_reason: string | null;
}

export interface CreateAttestationInput {
  readonly repositoryId: number;
  readonly baseBranch: string;
  readonly seqEpoch: number;
  readonly throughSeq: number | null;
  readonly graceSeconds: number;
  readonly actor: string;
  readonly reason: string;
}

/**
 * 확인서를 만든다.
 *
 * @throws 같은 공간·에폭에 활성 확인서가 있으면 PostgreSQL `23505`(unique_violation)다. 호출 측이
 *   사람이 읽을 문장으로 바꾼다 — 여기서 삼키면 「만들었다」는 거짓 응답이 된다.
 */
export async function createAttestation(db: Queryable, input: CreateAttestationInput): Promise<AttestationRow> {
  const result = await db.query<AttestationRow>(
    `INSERT INTO mnumber_attestation
       (repository_id, base_branch, seq_epoch, through_seq, grace_seconds, actor, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [input.repositoryId, input.baseBranch, input.seqEpoch, input.throughSeq, input.graceSeconds, input.actor, input.reason],
  );
  return result.rows[0] as AttestationRow;
}

/** 활성 확인서를 철회한다. 없거나 이미 철회됐으면 `undefined` — 바뀐 것이 없다. */
export async function revokeAttestation(
  db: Queryable,
  attestationId: number,
  revoke: { readonly actor: string; readonly reason: string },
): Promise<AttestationRow | undefined> {
  const result = await db.query<AttestationRow>(
    `UPDATE mnumber_attestation
        SET revoked_at = clock_timestamp(), revoked_by = $2, revoke_reason = $3
      WHERE attestation_id = $1 AND revoked_at IS NULL
      RETURNING *`,
    [attestationId, revoke.actor, revoke.reason],
  );
  return result.rows[0];
}

/** 공간·에폭의 활성 확인서. 없으면 `undefined`이며 그때 채번은 기존 규칙(미확정에서 멈춤) 그대로다. */
export async function findActiveAttestation(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
): Promise<AttestationRow | undefined> {
  const result = await db.query<AttestationRow>(
    `SELECT * FROM mnumber_attestation
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND revoked_at IS NULL`,
    [repositoryId, baseBranch, seqEpoch],
  );
  return result.rows[0];
}

export async function findAttestation(db: Queryable, attestationId: number): Promise<AttestationRow | undefined> {
  const result = await db.query<AttestationRow>('SELECT * FROM mnumber_attestation WHERE attestation_id = $1', [attestationId]);
  return result.rows[0];
}

/** 확인서 목록. 기본은 활성만이며 `includeRevoked`로 이력까지 본다. 최신이 먼저다. */
export async function listAttestations(
  db: Queryable,
  filter: { readonly repositoryId?: number; readonly includeRevoked?: boolean } = {},
): Promise<AttestationRow[]> {
  const result = await db.query<AttestationRow>(
    `SELECT * FROM mnumber_attestation
      WHERE ($1::bigint IS NULL OR repository_id = $1)
        AND ($2::boolean OR revoked_at IS NULL)
      ORDER BY created_at DESC, attestation_id DESC`,
    [filter.repositoryId ?? null, filter.includeRevoked === true],
  );
  return result.rows;
}
