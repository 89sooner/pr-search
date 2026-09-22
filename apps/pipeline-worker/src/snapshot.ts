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

import { prSnapshotRepo, sequenceProjectionRepo, sequenceSpaceRepo, sequenceWorkRepo, withTransaction } from '@prs/db';
import type { Pool } from '@prs/db';
import type { SnapshotSource } from '@prs/db';
import type { UpsertRequest } from '@prs/es';
import { docWorkRequest } from './sequence-projection.js';

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
  options: { readonly repositoryId: number; readonly prNumber: number; readonly source: SnapshotSource },
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
