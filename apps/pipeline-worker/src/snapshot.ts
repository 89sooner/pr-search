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

import { prSnapshotRepo } from '@prs/db';
import type { Pool } from '@prs/db';
import type { SnapshotSource } from '@prs/db';
import type { UpsertRequest } from '@prs/es';

/** PR 문서 하나를 골라 정본에 남긴다. 커밋 문서는 대상이 아니다. */
export async function recordProjectionSnapshot(
  pool: Pool,
  requests: readonly UpsertRequest[],
  options: { readonly repositoryId: number; readonly prNumber: number; readonly source: SnapshotSource },
): Promise<void> {
  const pullRequest = requests.find((request) => request.alias === 'prs-pull-requests');
  if (pullRequest === undefined) return;

  await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
    repositoryId: options.repositoryId,
    prNumber: options.prNumber,
    documentVersion: pullRequest.doc.document_version,
    source: options.source,
    document: pullRequest.doc,
  });
}
