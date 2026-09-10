/**
 * W-005 판정 (WP-026 / QA-W005-01~06, CR-030 DEV-155~159).
 *
 * 화면이 주장하는 사실은 전부 여기서 정한다 — 렌더링에 섞지 않는다.
 * 이 파일이 지키는 경계 셋:
 *
 * - **선택 복원이 거짓 비교를 만들지 않는 자리** (DEV-158): `select=`의 태그가
 *   현재 타임라인에 없으면(다른 브랜치 릴리스 포함) 복원하지 않고 경고로
 *   내린다. 서버의 `SEQUENCE_SPACE_MISMATCH`(400)는 이중 방어다.
 * - **순서에 의도가 없는 자리** (QA-W005-02): 체크 순서와 무관하게 시퀀스가
 *   작은 쪽이 시작 앵커가 되고, 무엇이 어느 쪽이 됐는지 문구로 명시한다.
 * - **첫 릴리스가 막다른 길이 되지 않는 자리** (DEV-158): 직전 릴리스가 없으면
 *   비교를 호출하지 않고 "첫 릴리스"로 판정한다 — 시작 앵커 없는 구간은
 *   W-004로 표현할 수 없다.
 */

import { formatRangeQuery, judgeSummary, type RangeSummaryView } from './range';

/** C-032의 선택 상한. 비교는 언제나 두 지점이다. */
export const MAX_COMPARE_SELECTION = 2;

export interface ReleasesParams {
  readonly branch: string | null;
  /** `select=` 딥링크 — 콤마 구분 최대 2개의 태그 이름이다 (CR-030, DEV-158). */
  readonly select: readonly string[];
}

export function parseReleasesParams(searchParams: URLSearchParams): ReleasesParams {
  const branchRaw = searchParams.get('branch');
  const branch = branchRaw === null || branchRaw.trim() === '' ? null : branchRaw.trim();

  const select: string[] = [];
  for (const piece of (searchParams.get('select') ?? '').split(',')) {
    const tag = piece.trim();
    if (tag !== '' && !select.includes(tag)) select.push(tag);
    if (select.length === MAX_COMPARE_SELECTION) break;
  }
  return { branch, select };
}

/** URL 왕복이 선택 상태를 보존한다 — 딥링크가 곧 화면 상태다 (ADR-007의 자세). */
export function formatReleasesQuery(params: ReleasesParams): string {
  const query = new URLSearchParams();
  if (params.branch !== null) query.set('branch', params.branch);
  if (params.select.length > 0) query.set('select', params.select.join(','));
  return query.toString();
}

export interface ReleaseView {
  readonly tagName: string;
  readonly releasedAt: string | null;
  readonly commitSha: string | null;
  readonly mergeSeq: number;
  readonly source: string | null;
  /** 서수 선행 릴리스. 첫 릴리스면 `null`이다 (DEV-159 — "직전"은 시각이 아니라 서수다). */
  readonly previousTagName: string | null;
  /** `null`은 "응답에 없었다"다 — 0으로 지어내지 않는다 (DEV-150과 같은 자세). */
  readonly pullRequestCount: number | null;
}

export interface UnreleasedView {
  readonly lastReleaseTag: string;
  readonly headSeq: number;
  readonly headCommitSha: string | null;
  readonly pendingPullRequestCount: number;
}

export interface TimelineView {
  readonly seqEpoch: number | null;
  readonly sequenceState: 'ok' | 'stale' | 'reassigning' | 'unknown';
  readonly releases: readonly ReleaseView[];
  readonly unreleased: UnreleasedView | null;
  /** 릴리스 미수집 (DEV-146) — 빈 목록과 다른 상태다. 저장소 개요 경로를 함께 낸다. */
  readonly notIndexed: boolean;
  readonly registrationStatusPath: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function judgeRelease(value: unknown): ReleaseView | null {
  const record = asRecord(value);
  if (record === null) return null;
  const tagName = record['tag_name'];
  const mergeSeq = record['merge_seq'];
  // 태그와 서수가 이 화면의 정체성이다 — 없으면 그 행은 그릴 수 없다.
  if (typeof tagName !== 'string' || tagName === '' || typeof mergeSeq !== 'number') return null;
  return {
    tagName,
    releasedAt: typeof record['released_at'] === 'string' ? record['released_at'] : null,
    commitSha: typeof record['commit_sha'] === 'string' ? record['commit_sha'] : null,
    mergeSeq,
    source: typeof record['source'] === 'string' ? record['source'] : null,
    previousTagName:
      typeof record['previous_tag_name'] === 'string' && record['previous_tag_name'] !== ''
        ? record['previous_tag_name']
        : null,
    pullRequestCount:
      typeof record['pull_request_count'] === 'number' ? record['pull_request_count'] : null,
  };
}

/**
 * 목록 응답을 화면 사실로 옮긴다.
 *
 * **순서는 서버의 것을 그대로 신뢰한다** (DEV-154·159와 같은 규칙) — 서수
 * 내림차순은 서버가 보장하고, 클라이언트 재정렬은 부분 지식으로 거짓을 만든다.
 */
export function judgeTimeline(source: unknown): TimelineView {
  const record = asRecord(source) ?? {};

  const releasesRaw = record['releases'];
  const releases: ReleaseView[] = [];
  if (Array.isArray(releasesRaw)) {
    for (const entry of releasesRaw) {
      const view = judgeRelease(entry);
      if (view !== null) releases.push(view);
    }
  }

  let unreleased: UnreleasedView | null = null;
  const unreleasedRecord = asRecord(record['unreleased']);
  if (
    unreleasedRecord !== null &&
    typeof unreleasedRecord['last_release_tag'] === 'string' &&
    typeof unreleasedRecord['head_seq'] === 'number' &&
    typeof unreleasedRecord['pending_pull_request_count'] === 'number'
  ) {
    unreleased = {
      lastReleaseTag: unreleasedRecord['last_release_tag'],
      headSeq: unreleasedRecord['head_seq'],
      headCommitSha:
        typeof unreleasedRecord['head_commit_sha'] === 'string'
          ? unreleasedRecord['head_commit_sha']
          : null,
      pendingPullRequestCount: unreleasedRecord['pending_pull_request_count'],
    };
  }

  const stateRaw = record['sequence_state'];
  return {
    seqEpoch: typeof record['seq_epoch'] === 'number' ? record['seq_epoch'] : null,
    sequenceState:
      stateRaw === 'ok' || stateRaw === 'stale' || stateRaw === 'reassigning' ? stateRaw : 'unknown',
    releases,
    unreleased,
    notIndexed: record['reason'] === 'release_not_indexed',
    registrationStatusPath:
      typeof record['registration_status_path'] === 'string' ? record['registration_status_path'] : null,
  };
}

/**
 * 체크박스 토글 — 상한 2를 넘기지 않는다 (C-032 `maxSelection`).
 *
 * 셋째 선택을 **바꿔치기하지 않고 무시하는** 이유: 바꿔치기는 사용자가 고른
 * 것을 말없이 버린다. 컴포넌트는 상한에서 나머지 체크박스를 비활성으로 그려
 * 이 분기가 사실상 방어선이 되게 한다.
 */
export function toggleSelection(current: readonly string[], tag: string): readonly string[] {
  if (current.includes(tag)) return current.filter((existing) => existing !== tag);
  if (current.length >= MAX_COMPARE_SELECTION) return current;
  return [...current, tag];
}

export interface SelectionJudgement {
  readonly selected: readonly ReleaseView[];
  /** 타임라인에 없는 태그 — 다른 브랜치 릴리스 포함. 복원하지 않고 경고한다 (DEV-158). */
  readonly unknown: readonly string[];
}

export function judgeSelection(
  select: readonly string[],
  releases: readonly ReleaseView[],
): SelectionJudgement {
  const byTag = new Map(releases.map((release) => [release.tagName, release]));
  const selected: ReleaseView[] = [];
  const unknown: string[] = [];
  for (const tag of select) {
    const release = byTag.get(tag);
    if (release === undefined) unknown.push(tag);
    else selected.push(release);
  }
  return { selected, unknown };
}

export interface ComparePlan {
  readonly from: ReleaseView;
  readonly to: ReleaseView;
  /** "from=A(seq X) → to=B(seq Y)" — 정규화가 무엇을 바꿨는지 실행 전에 명시한다 (QA-W005-02). */
  readonly direction: string;
}

/** 선택 순서와 무관하게 시퀀스가 작은 쪽이 시작이다. 같은 서수는 뒤집지 않는다 — `(s, s]`는 유효한 빈 구간이다. */
export function planCompare(first: ReleaseView, second: ReleaseView): ComparePlan {
  const [from, to] = first.mergeSeq > second.mergeSeq ? [second, first] : [first, second];
  return {
    from,
    to,
    direction: `from=${from.tagName}(seq ${String(from.mergeSeq)}) → to=${to.tagName}(seq ${String(to.mergeSeq)})`,
  };
}

/** W-004로 넘어가는 인용 URL. 에폭을 실어 다음 사람이 QA-W004-21의 보호를 받게 한다 (ADR-007). */
export function compareHref(
  repo: string,
  branch: string,
  plan: ComparePlan,
  epoch: number | null,
): string {
  return `/ranges?${formatRangeQuery({
    repo,
    branch,
    from: plan.from.tagName,
    to: plan.to.tagName,
    ...(epoch === null ? {} : { epoch }),
  })}`;
}

/** 미배포 구간의 W-004 인용 (QA-W005-04) — 끝 앵커는 브랜치 head의 서수다. */
export function unreleasedHref(
  repo: string,
  branch: string,
  unreleased: UnreleasedView,
  epoch: number | null,
): string {
  return `/ranges?${formatRangeQuery({
    repo,
    branch,
    from: unreleased.lastReleaseTag,
    to: `seq:${String(unreleased.headSeq)}`,
    ...(epoch === null ? {} : { epoch }),
  })}`;
}

export type DetailPlan =
  /** 직전 릴리스가 없다 — 비교 호출 없이 "첫 릴리스"로 그린다 (DEV-158). */
  | { readonly kind: 'first_release'; readonly release: ReleaseView }
  | { readonly kind: 'compare'; readonly fromTag: string; readonly release: ReleaseView };

export function planDetail(release: ReleaseView): DetailPlan {
  return release.previousTagName === null
    ? { kind: 'first_release', release }
    : { kind: 'compare', fromTag: release.previousTagName, release };
}

export interface ComparisonView {
  readonly direction: string | null;
  /** `reverted`는 키 부재를 `pending`으로 판정한다 (DEV-156 — DEV-150과 같은 코드가 맡는다). */
  readonly summary: RangeSummaryView | null;
}

export function judgeComparison(source: unknown): ComparisonView {
  const record = asRecord(source) ?? {};
  return {
    direction:
      typeof record['normalized_direction'] === 'string' ? record['normalized_direction'] : null,
    summary: judgeSummary(source),
  };
}
