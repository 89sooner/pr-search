/**
 * 저장소 릴리스 목록 (API-REL-005 / WP-026, CR-030 DEV-155).
 *
 * C-032 ReleaseTimeline을 채운다. 이 경로가 생기기 전에는 릴리스 **목록**을 줄
 * API가 없었다 — `/containments`는 대상을 지목해 묻는 조회이고
 * `/release-comparisons`는 구간 비교다. C-027의 공간 목록이 없어 API-SEQ-006을
 * 세운 것과 같은 공백이었다 (DEV-152 → DEV-155).
 *
 * ## 저장소 스코프다
 *
 * `branch`는 선택 필터다 (DEV-158). 브랜치를 강제로 고정하면 "다른 대상 브랜치
 * 릴리스 2건 선택"(FR-SEQ-004 AC-3 / QA-W005-03)이라는 상황 자체가 만들어지지
 * 않아 그 규칙을 검증할 길이 사라진다.
 *
 * ## 서수가 없는 릴리스를 숨기지 않는다
 *
 * 체인 밖 태그이거나 현재 에폭으로 아직 재해석되지 않은 릴리스는 `merge_seq:
 * null`로 싣는다. 숨기면 "그런 태그가 없다"로 오인된다 — API-SEQ-006이 채번
 * 이력 없는 브랜치를 `unknown`으로 싣는 것과 같은 원칙이다.
 *
 * 접근 통제는 `resolveRepository` 한 곳에 있다 (ADR-008). 이 모듈은 이미 통과한
 * 저장소 ID만 받는다.
 */

import { releaseRepo } from '@prs/db';
import type { Pool, ReleaseSource } from '@prs/db';

/** 기본 페이지 크기. 화면이 한 번에 그리는 양이다. */
export const DEFAULT_RELEASE_LIMIT = 100;

/** 상한. 넘치면 최신부터 채우고 `truncated: true`를 싣는다 — 말없이 자르지 않는다. */
export const MAX_RELEASE_LIMIT = 500;

export function clampReleaseLimit(raw: unknown): number {
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_RELEASE_LIMIT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_RELEASE_LIMIT;
  return Math.min(parsed, MAX_RELEASE_LIMIT);
}

export interface ReleaseListItem {
  readonly tag_name: string;
  readonly commit_sha: string;
  readonly released_at: string;
  readonly source: ReleaseSource;
  readonly base_branch: string | null;
  /** 표시 전용 문자열이다 (CR-025, DEV-119) — 필터·파라미터로 쓰지 않는다. */
  readonly sequence_space: string | null;
  readonly seq_epoch: number | null;
  readonly merge_seq: number | null;
  readonly previous_tag_name: string | null;
  readonly pull_request_count_since_previous: number | null;
}

export interface ReleaseListResult {
  readonly releases: readonly ReleaseListItem[];
  /**
   * 릴리스가 하나도 없을 때의 사유 (DEV-146과 같은 처리). 오류가 아니라 상태다.
   *
   * **"태그가 0개"와 "아직 한 번도 받지 않았다"를 가르지 않는다** (DEV-159):
   * `repository` 표에 동기화 마커가 없어 서버가 판별할 수 없고, 판별할 수 없는
   * 것을 두 상태로 그리면 둘 중 하나는 반드시 거짓이 된다.
   */
  readonly reason: 'release_not_indexed' | null;
  readonly truncated: boolean;
}

export async function listReleases(
  pool: Pool,
  repositoryId: number,
  repositorySlug: string,
  branch: string | null,
  limit: number,
): Promise<ReleaseListResult> {
  // 절삭 판정을 위해 한 건 더 읽는다. 응답에는 `limit`까지만 싣는다.
  const rows = await releaseRepo.listReleaseTimeline(pool, repositoryId, branch, limit + 1);
  const truncated = rows.length > limit;
  const page = truncated ? rows.slice(0, limit) : rows;

  const releases = page.map((row): ReleaseListItem => {
    const seq = row.merge_seq === null ? null : Number(row.merge_seq);
    const count =
      row.pull_request_count_since_previous === null
        ? null
        : Number(row.pull_request_count_since_previous);
    return {
      tag_name: row.tag_name,
      commit_sha: row.commit_sha,
      released_at: row.released_at.toISOString(),
      source: row.source,
      base_branch: row.base_branch,
      // 서수가 확인된 릴리스만 공간을 말한다 — 확인되지 않은 서수에 좌표를 붙이지 않는다.
      sequence_space: seq === null || row.base_branch === null ? null : `${repositorySlug}@${row.base_branch}`,
      seq_epoch: row.seq_epoch,
      merge_seq: seq,
      previous_tag_name: row.previous_tag_name,
      pull_request_count_since_previous: count,
    };
  });

  /*
   * 빈 목록의 사유는 **저장소 전체**를 보고 정한다.
   *
   * 브랜치 필터가 걸러 낸 빈 목록에 `release_not_indexed`를 실으면 거짓이다 —
   * 릴리스는 있고 그 브랜치에 없을 뿐이다. 목록이 비었을 때만 한 번 더 묻는다.
   */
  let reason: 'release_not_indexed' | null = null;
  if (releases.length === 0 && !(await releaseRepo.hasAnyRelease(pool, repositoryId))) {
    reason = 'release_not_indexed';
  }

  return { releases, reason, truncated };
}
