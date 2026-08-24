/**
 * C-020 포함 릴리스의 판정 (WP-024 / FR-REL-002, API-REL-002).
 *
 * 판정을 렌더링에 섞지 않는다 — 앞선 WP들과 같은 이유다. 그리고 이 파일의
 * 핵심은 **네 가지 "빈 목록"을 가르는 것**이다:
 *
 * | 상태 | 뜻 | 화면 |
 * | --- | --- | --- |
 * | `ready` | 포함 릴리스가 있다 | 목록 (시각 오름차순, QA-W002-08) |
 * | `unreleased` | **판정했고** 아직 어떤 릴리스에도 없다 | `미배포` 배지 + 대기 PR 수 (QA-W002-09) |
 * | `release_not_indexed` | 릴리스 수집이 아직 없다 — 판정 자체가 성립 안 함 | 사유 문장 |
 * | `not_sequenced` | 대상에 서수가 없다 (미머지·체인 밖) — 비교 기준이 없다 | 사유 문장 |
 *
 * 넷을 하나의 "비어 있음"으로 뭉치면 화면이 거짓을 말한다 — 미수집 저장소의
 * PR에 `미배포` 배지를 붙이면 "판정했다"는 거짓이 된다 (CR-028, DEV-146).
 */

/** `/api/v1/containments` 응답 중 화면이 쓰는 것. 서버가 더 보내도 무시한다. */
export interface ContainmentSource {
  readonly merge_seq?: number | null;
  readonly releases?: readonly {
    readonly tag_name?: string;
    readonly released_at?: string;
    readonly base_branch?: string;
    readonly merge_seq?: number;
    readonly source?: string;
  }[];
  readonly unreleased?: boolean;
  readonly pending_pull_request_count?: number;
  readonly reason?: string;
}

export interface ReleaseItem {
  readonly tagName: string;
  readonly releasedAt: string;
  readonly baseBranch: string;
  readonly mergeSeq: number | null;
  readonly source: string;
}

export type ContainmentState =
  | { readonly kind: 'ready'; readonly releases: readonly ReleaseItem[] }
  | { readonly kind: 'unreleased'; readonly pendingPrCount: number }
  | { readonly kind: 'release_not_indexed' }
  | { readonly kind: 'not_sequenced' };

/** 응답 본문 → 화면 상태. 모양이 어긋난 항목은 조용히 채우지 않고 건너뛴다. */
export function judgeContainment(source: ContainmentSource): ContainmentState {
  if (source.reason === 'release_not_indexed') return { kind: 'release_not_indexed' };
  if (source.reason === 'target_not_sequenced' || source.merge_seq === null || source.merge_seq === undefined) {
    return { kind: 'not_sequenced' };
  }

  const releases: ReleaseItem[] = [];
  for (const entry of source.releases ?? []) {
    if (typeof entry.tag_name !== 'string' || entry.tag_name === '') continue;
    if (typeof entry.released_at !== 'string' || entry.released_at === '') continue;
    releases.push({
      tagName: entry.tag_name,
      releasedAt: entry.released_at,
      baseBranch: entry.base_branch ?? '',
      mergeSeq: typeof entry.merge_seq === 'number' ? entry.merge_seq : null,
      source: entry.source ?? 'git_tag',
    });
  }

  if (releases.length > 0) return { kind: 'ready', releases };

  /*
   * 빈 목록 + `unreleased: true`만 미배포다. 플래그 없이 비어 있으면 서버가
   * 판정하지 못한 것으로 읽는다 — 없는 판정을 있는 것처럼 그리지 않는다.
   */
  if (source.unreleased === true) {
    return { kind: 'unreleased', pendingPrCount: source.pending_pull_request_count ?? 0 };
  }
  return { kind: 'not_sequenced' };
}
