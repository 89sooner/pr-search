/**
 * W-005 릴리스 화면의 판정 (WP-026 / FR-SEQ-004, API-REL-005·API-SEQ-003).
 *
 * 판정을 렌더링에 섞지 않는다 — W-004(`lib/range.ts`)와 같은 이유다. 이 파일이
 * 정하는 것:
 *
 * 1. **선택은 URL이 아니라 화면 상태다** (CR-030, DEV-157). 딥링크가 나르는 것은
 *    공간(`/releases?repo=&branch=`)뿐이고, 조사가 시작되는 순간 — 구간 비교를
 *    누르는 순간 — 그 인용은 W-004의 URL이 갖는다. 조사 상태의 정본을 두 화면이
 *    나눠 갖지 않는다.
 * 2. **서수 없는 릴리스는 앵커가 될 수 없다** (DEV-158). 체인 밖 태그이거나 현재
 *    에폭으로 아직 재해석되지 않은 릴리스다 — 목록에는 있고 선택만 못 한다.
 * 3. **공간이 다르면 이동 전에 막는다** (FR-SEQ-004 AC-3). 서버도 400을 내지만,
 *    사용자를 W-004까지 보내 놓고 거기서 실패를 보여 주지 않는다.
 * 4. **방향은 서수가 정한다** (AC-4). 먼저 고른 쪽이 아니라 서수가 작은 쪽이
 *    시작이다.
 */

import { formatRangeQuery } from './range';

/** API-REL-005 응답의 릴리스 하나. 서버가 더 보내도 화면이 쓰는 것만 담는다. */
export interface ReleaseRowView {
  readonly tagName: string;
  readonly commitSha: string;
  readonly releasedAt: string;
  readonly baseBranch: string | null;
  readonly sequenceSpace: string | null;
  readonly seqEpoch: number | null;
  /** `null`이면 앵커가 될 수 없다 — 체인 밖이거나 현재 에폭 미재해석. */
  readonly mergeSeq: number | null;
  readonly previousTagName: string | null;
  /** `null`은 "비교 대상이 없다"이지 0이 아니다. */
  readonly pullRequestCountSincePrevious: number | null;
}

export interface ReleaseListView {
  readonly releases: readonly ReleaseRowView[];
  /** `release_not_indexed`면 릴리스가 하나도 없다 — 원인 둘을 함께 안내한다. */
  readonly reason: string | null;
  readonly truncated: boolean;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/** 응답 → 목록. 모양이 어긋난 항목은 지어내지 않고 건너뛴다. */
export function judgeReleases(source: unknown): ReleaseListView {
  const body = (source ?? {}) as Record<string, unknown>;
  const raw = body['releases'];
  const releases: ReleaseRowView[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      if (typeof record['tag_name'] !== 'string') continue;
      releases.push({
        tagName: record['tag_name'],
        commitSha: typeof record['commit_sha'] === 'string' ? record['commit_sha'] : '',
        releasedAt: typeof record['released_at'] === 'string' ? record['released_at'] : '',
        baseBranch: typeof record['base_branch'] === 'string' ? record['base_branch'] : null,
        sequenceSpace: typeof record['sequence_space'] === 'string' ? record['sequence_space'] : null,
        seqEpoch: numberOrNull(record['seq_epoch']),
        mergeSeq: numberOrNull(record['merge_seq']),
        previousTagName:
          typeof record['previous_tag_name'] === 'string' ? record['previous_tag_name'] : null,
        pullRequestCountSincePrevious: numberOrNull(record['pull_request_count_since_previous']),
      });
    }
  }
  return {
    releases,
    reason: typeof body['reason'] === 'string' ? body['reason'] : null,
    truncated: body['truncated'] === true,
  };
}

/** 딥링크 파라미터. 공간뿐이다 — 선택은 싣지 않는다 (DEV-157). */
export interface ReleaseParams {
  readonly repo: string | null;
  readonly branch: string | null;
}

const REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function parseReleaseParams(searchParams: URLSearchParams): ReleaseParams {
  const repo = searchParams.get('repo');
  const branch = searchParams.get('branch');
  return {
    repo: repo !== null && REPO_SLUG.test(repo) ? repo : null,
    branch: branch !== null && branch.trim() !== '' ? branch.trim() : null,
  };
}

/** 현재 공간 → URL 쿼리. 브랜치는 선택이라 없으면 싣지 않는다. */
export function formatReleaseQuery(params: {
  readonly repo: string;
  readonly branch?: string | null;
}): string {
  const query = new URLSearchParams();
  query.set('repo', params.repo);
  if (params.branch !== undefined && params.branch !== null && params.branch !== '') {
    query.set('branch', params.branch);
  }
  return query.toString();
}

/**
 * 이 릴리스를 비교 앵커로 고를 수 있는가.
 *
 * 서수가 없으면 구간의 끝이 될 수 없다. **행을 숨기는 대신 선택만 막는다** —
 * 숨기면 "그런 태그가 없다"로 오인된다 (DEV-158).
 */
export function isSelectable(release: ReleaseRowView): boolean {
  return release.mergeSeq !== null && release.baseBranch !== null;
}

export type SelectionVerdict =
  /** 아직 두 건이 아니다. `remaining`은 몇 건 더 골라야 하는지. */
  | { readonly kind: 'incomplete'; readonly remaining: number }
  /** 두 건이 다른 시퀀스 공간이다 — 이동 전에 막는다 (AC-3). */
  | { readonly kind: 'space_mismatch'; readonly spaces: readonly string[] }
  /** 고른 태그가 목록에 없거나 앵커가 될 수 없다. 정상 조작으로는 닿지 않는다. */
  | { readonly kind: 'not_anchorable'; readonly tagNames: readonly string[] }
  | {
      readonly kind: 'ready';
      readonly from: ReleaseRowView;
      readonly to: ReleaseRowView;
    };

/**
 * 선택 두 건 → 비교 가능 여부와 정규화된 방향.
 *
 * **서수가 작은 쪽이 시작이다** (AC-4). 사용자가 고른 순서는 보지 않는다 — 목록이
 * 시각 내림차순이라 위를 먼저 누르는 일이 흔하고, 그때마다 방향이 뒤집히면 같은
 * 두 릴리스가 누른 순서에 따라 다른 구간이 된다.
 */
export function judgeSelection(
  releases: readonly ReleaseRowView[],
  selection: readonly string[],
): SelectionVerdict {
  if (selection.length < 2) return { kind: 'incomplete', remaining: 2 - selection.length };

  const chosen = selection
    .map((tag) => releases.find((release) => release.tagName === tag))
    .filter((release): release is ReleaseRowView => release !== undefined);

  const anchorable = chosen.filter(isSelectable);
  if (anchorable.length < 2) {
    return {
      kind: 'not_anchorable',
      tagNames: chosen.filter((release) => !isSelectable(release)).map((release) => release.tagName),
    };
  }

  const [first, second] = anchorable as [ReleaseRowView, ReleaseRowView];
  if (first.baseBranch !== second.baseBranch) {
    return { kind: 'space_mismatch', spaces: [first.baseBranch ?? '', second.baseBranch ?? ''] };
  }

  const [from, to] =
    (first.mergeSeq ?? 0) <= (second.mergeSeq ?? 0) ? [first, second] : [second, first];
  return { kind: 'ready', from, to };
}

/**
 * 비교 → W-004 딥링크 (FLOW-003).
 *
 * 결과 목록을 여기서 그리지 않고 W-004로 보낸다 — 목록·패싯·뒤로가기 복귀를 한
 * 곳에만 둔다. 에폭을 함께 실어 인용이 어느 채번을 딛고 있는지 남긴다 (ADR-007).
 */
export function compareHref(repo: string, from: ReleaseRowView, to: ReleaseRowView): string {
  const query = formatRangeQuery({
    repo,
    branch: to.baseBranch ?? '',
    from: from.tagName,
    to: to.tagName,
    ...(to.seqEpoch === null ? {} : { epoch: to.seqEpoch }),
  });
  return `/ranges?${query}`;
}

/**
 * 미배포 구간 → W-004 딥링크.
 *
 * 끝 앵커는 **서수**다. 브랜치 head를 가리키는 앵커 유형을 새로 만들지 않는다 —
 * 앵커 5종은 그대로 두고, 비교 응답이 알려 준 `range.to_seq`를 시퀀스 앵커로
 * 넘긴다. 시작도 같은 응답의 `from_seq`를 쓴다: 화면이 본 것과 W-004가 조회할
 * 것이 같아야 한다.
 *
 * ## `seq:` 접두를 반드시 붙인다
 *
 * 맨 숫자는 `classifyAnchor`가 **의도적으로 `ambiguous`로 판정한다** — `1234`가
 * PR 번호인지 서수인지 시스템이 고르지 않는다. 접두 없이 넘기면 W-004가 두 앵커를
 * 모두 해석하지 못해 **조회 버튼이 잠긴 채로 도착한다**. 링크를 만드는 쪽이 뜻을
 * 명시하는 것이 옳다.
 *
 * ## 시작 서수 0은 앵커로 표현할 수 없다
 *
 * 반개구간의 시작 `0`은 "공간 맨 앞"이라는 정상 값이지만(`from_seq=0`), 앵커 문법은
 * 1 이상만 받는다(`positiveWithin`). 채번된 릴리스가 하나도 없는 공간에서 그 값이
 * 나오며, 그때는 **`from`을 싣지 않는다** — 없는 앵커를 지어내거나 시작을 1로
 * 올려 첫 커밋을 조용히 빼지 않는다. W-004는 끝 앵커만 채운 채로 열리고 시작은
 * 사용자가 고른다.
 */
export function unreleasedHref(
  repo: string,
  branch: string,
  range: { readonly fromSeq: number; readonly toSeq: number },
  epoch: number | null,
): string {
  const query = formatRangeQuery({
    repo,
    branch,
    ...(range.fromSeq >= 1 ? { from: `seq:${String(range.fromSeq)}` } : {}),
    to: `seq:${String(range.toSeq)}`,
    ...(epoch === null ? {} : { epoch }),
  });
  return `/ranges?${query}`;
}

/** 시작 앵커를 실을 수 있는가. 화면이 "시작은 직접 고르세요"를 말할 근거다. */
export function hasStartAnchor(range: { readonly fromSeq: number }): boolean {
  return range.fromSeq >= 1;
}

/** 비교 응답에서 화면이 쓰는 것 (요약은 `judgeSummary`가 따로 본다). */
export interface ComparisonRangeView {
  readonly fromSeq: number;
  readonly toSeq: number;
  readonly normalizedDirection: string | null;
  readonly seqEpoch: number | null;
}

export function judgeComparisonRange(source: unknown): ComparisonRangeView | null {
  const body = (source ?? {}) as Record<string, unknown>;
  const range = body['range'];
  if (typeof range !== 'object' || range === null) return null;
  const record = range as Record<string, unknown>;
  if (typeof record['from_seq'] !== 'number' || typeof record['to_seq'] !== 'number') return null;
  return {
    fromSeq: record['from_seq'],
    toSeq: record['to_seq'],
    normalizedDirection:
      typeof body['normalized_direction'] === 'string' ? body['normalized_direction'] : null,
    seqEpoch: numberOrNull(body['seq_epoch']),
  };
}

/**
 * 행의 "직전 대비" 표기.
 *
 * **비교 대상 태그명을 함께 말한다** (DEV-155). "직전"은 서수 기준인데 목록은 시각
 * 내림차순이라 바로 아래 행이 아닐 수 있다 — 무엇과 비교한 수인지 말하지 않으면
 * 사용자가 인접 행과의 차이로 읽는다. 비교 대상이 없으면 **0이 아니라 없음**이다.
 */
export function previousLabel(release: ReleaseRowView): string {
  if (release.previousTagName === null || release.pullRequestCountSincePrevious === null) {
    return 'No previous release';
  }
  return `${release.previousTagName} — PRs added: ${String(release.pullRequestCountSincePrevious)}`;
}
