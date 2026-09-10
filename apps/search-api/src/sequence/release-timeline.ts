/**
 * 릴리스 타임라인 (API-REL-005 / WP-026, CR-030 DEV-155).
 *
 * W-005-LIST와 W-005-UNRELEASED를 채운다 — 한 시퀀스 공간의 릴리스 목록과
 * 릴리스마다 "직전 릴리스 대비 실제 PR 수", 그리고 마지막 릴리스 이후의
 * 미배포 블록.
 *
 * **정본은 PostgreSQL이다** (DEV-142·130). `prs-releases`는 읽지 않는다 —
 * 색인 반영 실패가 목록을 조용히 줄이면 안 된다. 접근 통제는 이 파일이 아니라
 * `resolveSpace`가 맡는다 (ADR-008) — 여기 오는 `space`는 이미 범위 안이다.
 *
 * ## 미수집과 없음을 가른다 (DEV-146)
 *
 * 저장소에 릴리스가 **하나도 수집되지 않은 것**(`not_indexed`)과 수집은 됐으나
 * **이 공간에 없는 것**(빈 목록)은 다른 상태다. 앞은 수집 범위 문제라 저장소
 * 개요 경로를 함께 제시해야 하고, 뒤는 화면의 `empty_no_release`다.
 */

import { mergeSequenceRepo, releaseRepo } from '@prs/db';
import type { Pool, ReleaseSource } from '@prs/db';
import type { ResolvedSpace } from './space.js';

export interface ReleaseTimelineItem {
  readonly tag_name: string;
  readonly released_at: string;
  readonly commit_sha: string;
  readonly merge_seq: number;
  readonly source: ReleaseSource;
  /** 서수 선행 릴리스. 첫 릴리스면 `null`이고 `pull_request_count`는 히스토리 시작부터다. */
  readonly previous_tag_name: string | null;
  /** `(직전 서수, 이 서수]` 구간의 실제 PR 행 수 (QA-W005-06) — 서수 차이가 아니다. */
  readonly pull_request_count: number;
}

/** 마지막 릴리스 이후 브랜치 head까지 (W-005-UNRELEASED / FR-REL-002 AC-4). */
export interface UnreleasedBlock {
  readonly last_release_tag: string;
  readonly head_seq: number;
  /** 공간이 막 쓰이는 중이면 head 행이 아직 없을 수 있다 — 링크는 서수로 건다. */
  readonly head_commit_sha: string | null;
  readonly pending_pull_request_count: number;
}

export type ReleaseTimelineResult =
  /** 저장소에 릴리스가 하나도 수집되지 않았다. 200 + 사유 + 개요 경로다 — 오류가 아니다. */
  | { readonly kind: 'not_indexed' }
  | {
      readonly kind: 'ok';
      readonly releases: readonly ReleaseTimelineItem[];
      /** 서수 있는 릴리스가 하나도 없으면 `null` — "마지막 릴리스 이후"가 정의되지 않는다. */
      readonly unreleased: UnreleasedBlock | null;
    };

export async function loadReleaseTimeline(
  pool: Pool,
  space: ResolvedSpace,
): Promise<ReleaseTimelineResult> {
  const rows = await releaseRepo.listReleaseTimeline(
    pool,
    space.repositoryId,
    space.baseBranch,
    space.seqEpoch,
  );

  if (rows.length === 0) {
    /*
     * 이 공간·에폭에 서수 있는 릴리스가 없다. 저장소 전체로 하나도 없는 것인지
     * 확인해 미수집과 "이 브랜치에 없음"을 가른다 — 순서를 바꾸면(먼저 전체를
     * 보면) 대부분의 정상 경로가 불필요한 왕복을 낸다.
     */
    const indexed = await releaseRepo.hasAnyRelease(pool, space.repositoryId);
    return indexed ? { kind: 'ok', releases: [], unreleased: null } : { kind: 'not_indexed' };
  }

  // 서수 내림차순이므로 첫 행이 마지막 릴리스다 (DEV-159).
  const latest = rows[0]!;
  const latestSeq = Number(latest.merge_seq);
  const [pending, headPoint] = await Promise.all([
    mergeSequenceRepo.countPullRequestsAbove(
      pool,
      space.repositoryId,
      space.baseBranch,
      space.seqEpoch,
      latestSeq,
    ),
    mergeSequenceRepo.findPointBySeq(
      pool,
      space.repositoryId,
      space.baseBranch,
      space.seqEpoch,
      space.headSeq,
    ),
  ]);

  return {
    kind: 'ok',
    releases: rows.map((row) => ({
      tag_name: row.tag_name,
      released_at: row.released_at.toISOString(),
      commit_sha: row.commit_sha,
      merge_seq: Number(row.merge_seq),
      source: row.source,
      previous_tag_name: row.previous_tag_name,
      pull_request_count: Number(row.pull_request_count),
    })),
    unreleased: {
      last_release_tag: latest.tag_name,
      head_seq: space.headSeq,
      head_commit_sha: headPoint === null ? null : headPoint.commitSha,
      pending_pull_request_count: pending,
    },
  };
}
