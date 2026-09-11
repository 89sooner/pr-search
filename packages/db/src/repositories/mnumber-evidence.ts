/**
 * `mnumber_evidence` 리포지터리 (ENT-SEQ-005, FR-SEQ-008 AC-10 / WP-074, ADR-023).
 *
 * ## 행이 없으면 미확정이다
 *
 * 기존 `merge_sequence.pull_request_number`를 근거로 승격하지 않는다 (DEV-581).
 * 그 열은 채번이 색인에서 읽은 **후보 힌트**이고, 늦게 도착한 PR이 그 값을 나중에
 * 채우기도 한다. M 번호는 한 번 부여하면 옮기지 않으므로, 부여의 근거는 이 표에
 * 따로 남아 검증 가능해야 한다.
 *
 * ## 확정은 되돌리지 않는다
 *
 * `unresolved → 확정`과 **같은 근거의 재검증**만 정상 전이다. 확정 뒤 다른 근거가
 * 오면 여기서 덮지 않고 호출 측이 공간 blocker를 `mapping_conflict`로 남긴다 —
 * 조용히 바꾸면 이미 부여된 번호가 다른 PR을 가리킨다.
 */

import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

export type EvidenceState = 'unresolved' | 'pr_confirmed' | 'direct_confirmed';

/**
 * 근거의 출처.
 *
 * `authoritative_absence`는 **production 판정기가 만들지 않는다** (DEV-581, 상세 설계
 * 2.2). 격리 통합 시험만 직접 주입하며, 그 사실은 `proof.fixture_seeded`로 남는다.
 */
export type EvidenceSourceKind = 'pr_detail' | 'verified_snapshot' | 'unresolved_lookup' | 'authoritative_absence';

/** `proof`에 허용되는 필드 (상세 설계 6.2). 제목·본문·작성자·URL·토큰은 넣지 않는다. */
export interface EvidenceProof {
  readonly schema_version: 1;
  readonly profile: 'squash_only';
  readonly matched_repository_id?: number;
  readonly matched_base_branch?: string;
  readonly matched_merge_commit_sha?: string;
  readonly merged?: boolean;
  readonly page_count?: number;
  readonly lookup_complete?: boolean;
  readonly scan_started_at?: string;
  readonly scan_finished_at?: string;
  readonly observed_head?: string;
  readonly source_request_id_hash?: string;
  /** 격리 시험이 주입한 근거임을 밝힌다. production 입력이 아니다. */
  readonly fixture_seeded?: true;
  /** 후속 회차가 이어 받을 열거 cursor (`partial_lookup`). */
  readonly resume_page?: number;
}

export interface EvidenceRow {
  readonly repository_id: number;
  readonly base_branch: string;
  readonly seq_epoch: number;
  readonly merge_seq: number;
  readonly commit_sha: string;
  readonly state: EvidenceState;
  readonly pr_number: number | null;
  readonly reason: string | null;
  readonly evidence_version: number;
  readonly source_kind: EvidenceSourceKind;
  readonly source_pr_version: number | null;
  readonly merged_at: Date | null;
  readonly checked_at: Date;
  readonly first_pending_at: Date | null;
  readonly proof: EvidenceProof;
}

export interface EvidenceUpsert {
  readonly repositoryId: number;
  readonly baseBranch: string;
  readonly seqEpoch: number;
  readonly mergeSeq: number;
  readonly commitSha: string;
  readonly state: EvidenceState;
  readonly prNumber: number | null;
  readonly reason: string | null;
  readonly sourceKind: EvidenceSourceKind;
  readonly sourcePrVersion: number | null;
  readonly mergedAt: Date | null;
  readonly proof: EvidenceProof;
}

/**
 * 근거를 남긴다. 같은 행이 있으면 `evidence_version`을 올리며 덮는다.
 *
 * **전이 규칙은 호출 측이 지킨다.** 이 함수는 저장만 한다 — 확정 뒤 다른 확정이
 * 오는 것을 막으려면 먼저 `listEvidence`로 읽고 판정한 뒤 호출한다. 그 판정을
 * 여기 넣으면 시험 주입 경로(`direct_confirmed`)까지 같은 규칙에 걸린다.
 *
 * `first_pending_at`은 미확정이 **처음** 관측된 시각이며 이후 미확정 재기록은
 * 그 값을 보존한다. 확정되면 NULL이다.
 *
 * @throws 같은 서수에 다른 커밋의 근거가 이미 있으면. 에폭이 같은데 SHA가 다르면
 *   정본이 손상된 것이라 조용히 넘기지 않는다.
 */
export async function upsertEvidence(db: Queryable, input: EvidenceUpsert): Promise<EvidenceRow> {
  const result = await db.query<EvidenceRow>(
    `INSERT INTO mnumber_evidence
       (repository_id, base_branch, seq_epoch, merge_seq, commit_sha, state, pr_number, reason,
        source_kind, source_pr_version, merged_at, checked_at, first_pending_at, proof)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, clock_timestamp(),
             CASE WHEN $6 = 'unresolved' THEN clock_timestamp() ELSE NULL END, $12::jsonb)
     ON CONFLICT (repository_id, base_branch, seq_epoch, merge_seq) DO UPDATE
        SET state             = EXCLUDED.state,
            pr_number         = EXCLUDED.pr_number,
            reason            = EXCLUDED.reason,
            evidence_version  = mnumber_evidence.evidence_version + 1,
            source_kind       = EXCLUDED.source_kind,
            source_pr_version = EXCLUDED.source_pr_version,
            merged_at         = EXCLUDED.merged_at,
            checked_at        = clock_timestamp(),
            first_pending_at  = CASE
                                  WHEN EXCLUDED.state = 'unresolved'
                                    THEN COALESCE(mnumber_evidence.first_pending_at, clock_timestamp())
                                  ELSE NULL
                                END,
            proof             = EXCLUDED.proof
      WHERE mnumber_evidence.commit_sha = EXCLUDED.commit_sha
     RETURNING *`,
    [
      input.repositoryId,
      input.baseBranch,
      input.seqEpoch,
      input.mergeSeq,
      input.commitSha.toLowerCase(),
      input.state,
      input.prNumber,
      input.reason,
      input.sourceKind,
      input.sourcePrVersion,
      input.mergedAt,
      JSON.stringify(input.proof),
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(
      `서수 ${String(input.mergeSeq)}의 근거에 다른 커밋이 이미 있다: ` +
        `${String(input.repositoryId)}/${input.baseBranch}@${String(input.seqEpoch)} != ${input.commitSha}`,
    );
  }
  return row;
}

/** 서수 목록의 근거. 없는 서수는 결과에 없다 — 그 부재가 곧 미확정이다. */
export async function listEvidence(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  mergeSeqs: readonly number[],
): Promise<Map<number, EvidenceRow>> {
  const out = new Map<number, EvidenceRow>();
  if (mergeSeqs.length === 0) return out;
  const result = await db.query<EvidenceRow>(
    `SELECT * FROM mnumber_evidence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_seq = ANY($4::bigint[])`,
    [repositoryId, baseBranch, seqEpoch, mergeSeqs],
  );
  for (const row of result.rows) out.set(Number(row.merge_seq), row);
  return out;
}

export async function findEvidence(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  mergeSeq: number,
): Promise<EvidenceRow | undefined> {
  const result = await db.query<EvidenceRow>(
    `SELECT * FROM mnumber_evidence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_seq = $4`,
    [repositoryId, baseBranch, seqEpoch, mergeSeq],
  );
  return result.rows[0];
}

/**
 * checkpoint 이하에서 마지막으로 확정된 PR의 `merged_at` (AC-6 회차 경계 대조).
 * 없으면 `null`이며 그때 첫 PR은 대조 대상이 없다.
 */
export async function findLastConfirmedMergedAt(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  uptoSeqInclusive: number,
): Promise<Date | null> {
  const result = await db.query<{ merged_at: Date | null }>(
    `SELECT merged_at FROM mnumber_evidence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3
        AND merge_seq <= $4 AND state = 'pr_confirmed'
      ORDER BY merge_seq DESC
      LIMIT 1`,
    [repositoryId, baseBranch, seqEpoch, uptoSeqInclusive],
  );
  return result.rows[0]?.merged_at ?? null;
}
