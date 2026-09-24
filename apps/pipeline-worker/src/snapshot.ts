/**
 * 투영 결과를 PostgreSQL 정본으로 남긴다 (CR-034, DEV-184 / ADR-004).
 *
 * ## 두 투영 경로가 같은 함수를 쓴다
 *
 * 실시간(`project.ts`)과 백필·조정(`backfill.ts`의 `projectOne`)이 모두
 * `buildUpsertRequests`로 같은 문서를 만든다. 그 결과를 여기서 한 번만 저장해
 * 두 경로가 **같은 정본**을 남기게 한다 — 한쪽만 남기면 그쪽만 재구성 가능한
 * 반쪽 불변식이 된다.
 *
 * ## 색인보다 먼저 쓴다
 *
 * 정본이 먼저 있어야 색인 실패가 데이터 유실이 아니다. 반대로 하면 색인에는
 * 있고 정본에는 없는 창이 생기고, 그 창에서 프로세스가 죽으면 ADR-004가 깨진
 * 상태로 남는다.
 */

import {
  mergeSequenceRepo,
  prCommitLinkRepo,
  prSnapshotRepo,
  sequenceProjectionRepo,
  sequenceSpaceRepo,
  sequenceWorkRepo,
  withTransaction,
} from '@prs/db';
import type { Pool } from '@prs/db';
import type { SnapshotSource } from '@prs/db';
import { derivePullRequestState, type IngestionEnriched } from '@prs/domain';
import type { UpsertRequest } from '@prs/es';
import { docWorkRequest } from './sequence-projection.js';

/**
 * 원본 커밋 목록 가운데 **추적 브랜치의 현재 체인에 이미 오른** SHA (CR-117 / FR-SRCH-002 AC-7).
 *
 * 실시간·백필 두 투영이 **같은 함수**로 `ProjectionSource.chainShas`를 채운다 — 한쪽만 채우면
 * 그 경로만 체인 커밋의 역할을 `source_commit`으로 덮는다. 체인 정의는 관계 술어
 * (`EFFECTIVE_LINK_SQL`)와 같다. 한 문장이며 원본 목록 길이와 무관하게 왕복은 한 번이다.
 */
export async function chainShasOf(
  pool: Pool,
  repositoryId: number,
  sourceShas: readonly string[],
): Promise<ReadonlySet<string>> {
  if (sourceShas.length === 0) return new Set();
  const landers = await mergeSequenceRepo.findCurrentChainLanders(pool, repositoryId, sourceShas);
  return new Set(landers.keys());
}

/**
 * 보강 결과에서 관계 관측을 만든다 (CR-116 / WP-101).
 *
 * **여기서 만든다.** 문서에서 되읽으면 두 가지를 잃는다 — 문서에는
 * `enrichment_errors`가 없어 "커밋 조회가 실패했다"와 "리뷰만 실패했다"가 같아
 * 보이고, PR 본문을 원격에서 직접 읽었는지도 알 수 없다. 둘 다 **삭제 권한의
 * 재료**라 잃으면 안 된다.
 */
export function linkObservationOf(
  enriched: IngestionEnriched,
  documentVersion: number,
): Omit<Parameters<typeof prCommitLinkRepo.adoptLinkObservation>[1], 'repositoryId' | 'prNumber'> {
  const pr = enriched.pull_request;
  const commitsError = enriched.enrichment_errors.find((error) => error.component === 'commits');
  const prError = enriched.enrichment_errors.find((error) => error.component === 'pull_request');
  return {
    observedVersion: documentVersion,
    sourceShas: enriched.source_commit_shas,
    /*
     * **병합된 PR의 머지 커밋만 실제 병합 근거다** (FR-SRCH-002 AC-1).
     *
     * GitHub은 열린 PR에도 `merge_commit_sha`를 준다 — 시험 병합으로 만든 임시
     * 커밋이다. 그것을 병합으로 적으면 아직 병합되지 않은 PR이 커밋 하나를
     * "병합했다"고 주장한다.
     */
    mergeSha: pr !== null && derivePullRequestState(pr) === 'merged' ? pr.merge_commit_sha : null,
    commitsComplete: enriched.source_commits_complete,
    /*
     * PR 본문을 원격에서 직접 읽었는가. 보강 실패 목록에 `pull_request`가 없으면
     * API 응답이 이겼다는 뜻이다 (`enrich.ts`). 웹훅 사본만 있는 경우에는
     * `merge` 근거를 **지우지 않는다.**
     */
    pullRequestAuthoritative: prError === undefined && pr !== null,
    commitsErrorKind: commitsError === undefined ? null : `${commitsError.component}:${commitsError.kind}`,
    apiCommitCount: pr?.commits_count ?? null,
    sourceCommitsTruncated: enriched.source_commits_truncated,
    headSha: pr?.head_sha ?? null,
    baseSha: pr?.base_sha ?? null,
    baseBranch: pr?.base_ref ?? null,
    prState: pr === null ? null : derivePullRequestState(pr),
    reason: commitsError === undefined ? null : `commits_${commitsError.kind}`,
  };
}

/**
 * PR 문서 하나를 골라 정본에 남긴다. 커밋 문서는 대상이 아니다.
 *
 * ## 스냅숏과 M 재개 의도는 한 트랜잭션이다 (WP-074 / FR-SEQ-008 AC-11, 상세 설계 5.2)
 *
 * 머지된 PR의 스냅숏이 **실제로 갱신됐을 때** 그 base 브랜치의 `reconcile` work를
 * 같은 트랜잭션에서 요청한다. 늦게 도착한 PR 정보로 확정이 가능해졌는데 새 push나
 * 일일 스윕을 기다리게 하지 않기 위해서다. 낮은 버전이라 무시된 스냅숏은 새 정보가
 * 아니므로 요청하지 않는다. 채번된 적 없는 브랜치(공간 없음)도 요청할 것이 없다.
 *
 * 실시간·백필·조정·부트스트랩 네 경로가 모두 이 함수를 지난다 — 같은 primitive여야
 * 한 경로만 재개를 빠뜨리는 날이 없다.
 *
 * ## 늦은 PR 문서의 시퀀스 투영 의도도 같은 트랜잭션이다 (CR-113 / FR-SEQ-001 AC-7)
 *
 * 머지된 PR의 `merge_commit_sha`가 **현재 에폭 체인에 이미 채번된 SHA**이면, 그 PR 문서에
 * 서수를 비출 문서 단위 `project` work를 남긴다. 채번이 PR 문서보다 먼저였거나(사내
 * pilot.17의 1,429건이 이 모양이었다) `merge_commit_sha`가 나중에 채워진 경우가 여기서
 * 잡힌다. 아직 채번되지 않은 SHA면 남기지 않는다 — 채번의 `tail` work가 그때 비춘다.
 */
export async function recordProjectionSnapshot(
  pool: Pool,
  requests: readonly UpsertRequest[],
  options: {
    readonly repositoryId: number;
    readonly prNumber: number;
    readonly source: SnapshotSource;
    /**
     * 이 PR의 관계 관측 (CR-116 / WP-101).
     *
     * **선택 항목이 아니다.** 기본값을 두면 호출부가 빠뜨렸을 때 그 사실이
     * 드러나지 않고, 그 경로만 관계를 갱신하지 않는 상태가 조용히 남는다.
     * `linkObservationOf`가 보강 결과에서 만든다.
     */
    readonly linkObservation: Omit<
      Parameters<typeof prCommitLinkRepo.adoptLinkObservation>[1],
      'repositoryId' | 'prNumber'
    >;
  },
): Promise<void> {
  const pullRequest = requests.find((request) => request.alias === 'prs-pull-requests');
  if (pullRequest === undefined) return;

  await withTransaction(pool, async (client) => {
    const updated = await prSnapshotRepo.upsertPullRequestSnapshot(client, {
      repositoryId: options.repositoryId,
      prNumber: options.prNumber,
      documentVersion: pullRequest.doc.document_version,
      source: options.source,
      document: pullRequest.doc,
    });

    /*
     * ## 관계 채택은 **머지 여부보다 먼저** 한다 (CR-116 / WP-101, FR-SRCH-002 AC-6)
     *
     * 아래의 `state !== 'merged'` 조기 반환 뒤에 두면 **열린 PR의 관계가 통째로
     * 빠진다.** 사내에서 잘못된 번호를 남긴 #2355가 바로 열린 PR이었다 — 그 경로가
     * 갱신되지 않으면 이 CR이 고치려는 결함이 그대로 남는다.
     *
     * 스냅숏이 낮은 버전이라 무시됐어도(`!updated`) 건너뛰지 않는다. 채택은
     * **자기 버전 가드**를 따로 가지며, 마이그레이션이 seed한 관측처럼 관계 쪽만
     * 뒤처진 경우가 실재한다. 오래된 관측은 거기서 `stale`로 접힌다.
     *
     * 관계 변경과 재투영 의도가 **같은 트랜잭션**이다. 색인 쓰기가 실패하거나
     * 직후에 프로세스가 죽어도 제거의 근거와 할 일이 PostgreSQL에 남는다.
     */
    const adoption = await prCommitLinkRepo.adoptLinkObservation(client, {
      repositoryId: options.repositoryId,
      prNumber: options.prNumber,
      ...options.linkObservation,
    });
    if (adoption.affected.length > 0) {
      await prCommitLinkRepo.bumpCommitLinkGenerations(client, options.repositoryId, adoption.affected);
    }

    if (!updated) return;

    const doc = pullRequest.doc as { readonly state?: unknown; readonly base_branch?: unknown };
    if (doc.state !== 'merged' || typeof doc.base_branch !== 'string' || doc.base_branch === '') return;
    const space = await sequenceSpaceRepo.findSequenceSpace(client, options.repositoryId, doc.base_branch);
    if (space === undefined) return;
    await sequenceWorkRepo.requestWork(client, {
      kind: 'reconcile',
      repositoryId: options.repositoryId,
      baseBranch: doc.base_branch,
      seqEpoch: space.seq_epoch,
      payload: { trigger_kind: 'snapshot', pr_number: options.prNumber },
    });

    const mergeSha = (pullRequest.doc as { readonly merge_commit_sha?: unknown }).merge_commit_sha;
    if (typeof mergeSha !== 'string' || mergeSha === '') return;
    const target = await sequenceProjectionRepo.findProjectionTargetBySha(client, {
      repositoryId: options.repositoryId,
      baseBranch: doc.base_branch,
      seqEpoch: space.seq_epoch,
      commitSha: mergeSha,
    });
    if (target === undefined) return;
    await sequenceWorkRepo.requestWorkBatch(client, [
      docWorkRequest({ repositoryId: options.repositoryId, baseBranch: doc.base_branch, seqEpoch: space.seq_epoch }, 'pull_request', options.prNumber, 'snapshot'),
    ]);
  });
}
