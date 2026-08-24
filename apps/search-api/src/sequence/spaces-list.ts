/**
 * 시퀀스 공간 목록 (API-SEQ-006 / WP-025, CR-029 DEV-152).
 *
 * C-027 셀렉터를 채운다 — 접근 범위 안 등록 저장소의 시퀀스 대상 브랜치와
 * 브랜치별 현재 에폭·상태.
 *
 * **접근 통제가 목록의 전부다** (ADR-008·THR-004). 범위 밖 저장소는 결과에
 * 없고, 없다는 사실 외에는 아무것도 새지 않는다 — `resolveRepository`의
 * 단건 판정과 같은 `isRepositoryInScope`를 목록에도 그대로 쓴다.
 *
 * ## 채번된 적 없는 브랜치를 숨기지 않는다
 *
 * `sequence_space` 행이 없는 (저장소, 브랜치)는 `sequence_state: "unknown"` +
 * `seq_epoch: null`로 싣는다. 목록에서 빼면 사용자가 "등록이 안 됐다"로
 * 오인한다 — 등록은 됐고 채번이 아직인 상태는 다른 상태다.
 */

import { repositoryRepo, sequenceSpaceRepo } from '@prs/db';
import type { Pool, SequenceSpaceRow } from '@prs/db';
import { isRepositoryInScope, type AccessScope } from '@prs/es';

export interface SequenceSpaceItem {
  readonly repository: string;
  readonly repository_id: number;
  readonly base_branch: string;
  /** 표시 전용 문자열이다 (CR-025, DEV-119) — 필터·파라미터로 쓰지 않는다. */
  readonly sequence_space: string;
  readonly seq_epoch: number | null;
  readonly sequence_state: 'ok' | 'stale' | 'reassigning' | 'unknown';
}

export async function listSequenceSpaces(
  pool: Pool,
  scope: AccessScope,
): Promise<readonly SequenceSpaceItem[]> {
  const repositories = (await repositoryRepo.listActiveRepositories(pool)).filter((repository) =>
    isRepositoryInScope(
      {
        repositoryId: repository.repository_id,
        orgId: repository.org_id,
        visibility: repository.visibility,
        // `allowed_team_ids`는 아직 스키마에 없다 (WP-068, DEV-114) — 단건 판정과 같은 상태.
      },
      scope,
    ),
  );

  const spaces = await sequenceSpaceRepo.listSpacesForRepositories(
    pool,
    repositories.map((repository) => repository.repository_id),
  );
  const byKey = new Map<string, SequenceSpaceRow>();
  for (const row of spaces) byKey.set(`${String(row.repository_id)} ${row.base_branch}`, row);

  const items: SequenceSpaceItem[] = [];
  // listActiveRepositories가 owner, name 오름차순을 보장한다 — 브랜치는 등록 순서다.
  for (const repository of repositories) {
    const slug = `${repository.owner}/${repository.name}`;
    for (const branch of repository.sequence_branches) {
      const row = byKey.get(`${String(repository.repository_id)} ${branch}`);
      items.push({
        repository: slug,
        repository_id: repository.repository_id,
        base_branch: branch,
        sequence_space: `${slug}@${branch}`,
        seq_epoch: row === undefined ? null : row.seq_epoch,
        sequence_state: row === undefined ? 'unknown' : row.state,
      });
    }
  }
  return items;
}
