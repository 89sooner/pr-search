/**
 * W-004 범위 조사의 판정 (WP-025 / FR-SEQ-002·003, API-SEQ-001·002·006).
 *
 * 판정을 렌더링에 섞지 않는다 — 앞선 화면들과 같은 이유다. 이 파일이 정하는 것:
 *
 * 1. **URL이 조사 상태의 정본이다** (딥링크 `/ranges?repo=&branch=&from=&to=&epoch=`).
 *    표시 문자열(`sequence_space`)은 파라미터로 쓰지 않는다 (CR-029 DEV-153, DEV-119).
 * 2. **조회 전 사전 판정** — 역전(교환 제안, QA-W004-07)과 5만 건 초과(QA-W004-08)는
 *    앵커 서수 차로 조회 전에 안다. 서버(RANGE_INVERTED·RANGE_TOO_LARGE)가 이중 방어다.
 * 3. **에폭은 비교이지 쓰기가 아니다** (FR-SEQ-005, QA-W004-21) — URL 에폭과 현재
 *    에폭이 다르면 `epoch_stale`을 알리고 **자동 재조회하지 않는다**.
 * 4. **없는 수를 지어내지 않는다** — 되돌림 보유 수는 WP-030 전까지 API에 키가
 *    없다(DEV-133·150). 0으로 그리면 "되돌림이 없다"는 거짓이 된다.
 */

/** API-SEQ-006 응답의 공간 하나. 서버가 더 보내도 무시한다. */
export interface SequenceSpaceOption {
  readonly repository: string;
  readonly base_branch: string;
  readonly sequence_space: string;
  readonly seq_epoch: number | null;
  readonly sequence_state: 'ok' | 'stale' | 'reassigning' | 'unknown';
}

/** 응답 → 옵션 목록. 모양이 어긋난 항목은 채우지 않고 건너뛴다. */
export function judgeSpaces(source: unknown): readonly SequenceSpaceOption[] {
  const raw = (source as { spaces?: unknown }).spaces;
  if (!Array.isArray(raw)) return [];
  const options: SequenceSpaceOption[] = [];
  for (const entry of raw) {
    const record = entry as Record<string, unknown>;
    if (typeof record['repository'] !== 'string' || typeof record['base_branch'] !== 'string') continue;
    const state = record['sequence_state'];
    options.push({
      repository: record['repository'],
      base_branch: record['base_branch'],
      sequence_space:
        typeof record['sequence_space'] === 'string'
          ? record['sequence_space']
          : `${record['repository']}@${record['base_branch']}`,
      seq_epoch: typeof record['seq_epoch'] === 'number' ? record['seq_epoch'] : null,
      sequence_state:
        state === 'ok' || state === 'stale' || state === 'reassigning' ? state : 'unknown',
    });
  }
  return options;
}

/** 딥링크 파라미터 (CR-029 DEV-153에서 확정한 이름들). */
export interface RangeParams {
  readonly repo: string | null;
  readonly branch: string | null;
  readonly from: string | null;
  readonly to: string | null;
  /** 인용의 에폭. 비교에만 쓴다 — 조회를 이 에폭으로 보내지 않는다. */
  readonly epoch: number | null;
  /**
   * 구간을 좁히는 질의 (WP-032 / FR-SEQ-002).
   *
   * **URL에 있다.** 패싯 클릭이 이 값을 갱신하고 그 변경이 조회를 유발한다 —
   * W-001과 같은 규칙이다(URL이 단일 진실). 커서는 URL에 싣지 않는다: 조건은
   * 공유할 수 있지만 페이징 위치는 발급자의 접근 범위로 봉인돼 있다.
   */
  readonly q: string | null;
}

const REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function parseRangeParams(searchParams: URLSearchParams): RangeParams {
  const repo = searchParams.get('repo');
  const branch = searchParams.get('branch');
  const rawEpoch = searchParams.get('epoch');
  const epoch = rawEpoch !== null && /^[1-9][0-9]*$/.test(rawEpoch) ? Number(rawEpoch) : null;
  return {
    repo: repo !== null && REPO_SLUG.test(repo) ? repo : null,
    branch: branch !== null && branch !== '' ? branch : null,
    from: emptyToNull(searchParams.get('from')),
    to: emptyToNull(searchParams.get('to')),
    epoch,
    q: emptyToNull(searchParams.get('q')),
  };
}

function emptyToNull(value: string | null): string | null {
  return value === null || value.trim() === '' ? null : value.trim();
}

/** 현재 조사 상태 → URL 쿼리. 빈 값은 싣지 않는다 — 공유 링크를 짧게 유지한다. */
export function formatRangeQuery(params: {
  readonly repo: string;
  readonly branch: string;
  readonly from?: string;
  readonly to?: string;
  readonly epoch?: number;
  readonly q?: string;
}): string {
  const query = new URLSearchParams();
  query.set('repo', params.repo);
  query.set('branch', params.branch);
  if (params.from !== undefined && params.from !== '') query.set('from', params.from);
  if (params.to !== undefined && params.to !== '') query.set('to', params.to);
  if (params.epoch !== undefined) query.set('epoch', String(params.epoch));
  if (params.q !== undefined && params.q !== '') query.set('q', params.q);
  return query.toString();
}

/** API-SEQ-002가 돌려준 앵커 하나 (화면이 쓰는 것만). */
export interface ResolvedAnchorView {
  readonly position: 'from' | 'to';
  readonly expression: string;
  readonly kind: string;
  readonly mergeSeq: number;
  readonly commitSha: string;
  readonly boundary: 'exclusive' | 'inclusive';
  readonly occurredAt: string | null;
}

/** 정규화 응답 → 앵커 뷰 목록. AC-5의 넷(표현·서수·SHA·에폭)은 호출부가 함께 그린다. */
export function judgeResolvedAnchors(source: unknown): readonly ResolvedAnchorView[] {
  const raw = (source as { resolved?: unknown }).resolved;
  if (!Array.isArray(raw)) return [];
  const anchors: ResolvedAnchorView[] = [];
  for (const entry of raw) {
    const record = entry as Record<string, unknown>;
    const position = record['position'];
    if (position !== 'from' && position !== 'to') continue;
    if (typeof record['merge_seq'] !== 'number' || typeof record['commit_sha'] !== 'string') continue;
    anchors.push({
      position,
      expression: typeof record['expression'] === 'string' ? record['expression'] : '',
      kind: typeof record['kind'] === 'string' ? record['kind'] : 'unknown',
      mergeSeq: record['merge_seq'],
      commitSha: record['commit_sha'],
      boundary: record['boundary'] === 'exclusive' ? 'exclusive' : 'inclusive',
      occurredAt: typeof record['occurred_at'] === 'string' ? record['occurred_at'] : null,
    });
  }
  return anchors;
}

/** 구간 5만 건 한도 — 서버 `RANGE_LIMIT`과 같은 값이다 (FR-SEQ-002 AC-4). */
export const RANGE_CLIENT_LIMIT = 50_000;

/** 조회 전 사전 판정 (QA-W004-07·08·09). */
export type RangePreflight =
  | { readonly kind: 'not_ready' }
  | { readonly kind: 'inverted'; readonly fromSeq: number; readonly toSeq: number }
  | { readonly kind: 'too_large'; readonly expected: number }
  | { readonly kind: 'ok'; readonly expected: number };

export function preflightRange(
  from: ResolvedAnchorView | null,
  to: ResolvedAnchorView | null,
): RangePreflight {
  if (from === null || to === null) return { kind: 'not_ready' };
  if (from.mergeSeq > to.mergeSeq) {
    return { kind: 'inverted', fromSeq: from.mergeSeq, toSeq: to.mergeSeq };
  }
  /*
   * 반개구간 `(from, to]`의 커밋 수는 정확히 서수 차다 — 서수는 1씩 증가하는
   * 조밀한 값이므로(FR-SEQ-001) 추정이 아니라 계산이다. PR 수는 이보다 작거나
   * 같으므로 이 값이 한도를 넘으면 조회 전에 축소를 안내한다 (QA-W004-08).
   */
  const expected = to.mergeSeq - from.mergeSeq;
  if (expected > RANGE_CLIENT_LIMIT) return { kind: 'too_large', expected };
  return { kind: 'ok', expected };
}

/**
 * URL 에폭 대 현재 에폭 (QA-W004-21).
 *
 * `unpinned`(URL에 에폭 없음)는 경고가 아니다 — 사용자가 지금 막 시작한
 * 조사다. `stale`일 때만 무효 경고를 내고, **재조회는 사용자의 클릭**이다.
 */
export function judgeEpoch(urlEpoch: number | null, currentEpoch: number): 'match' | 'stale' | 'unpinned' {
  if (urlEpoch === null) return 'unpinned';
  return urlEpoch === currentEpoch ? 'match' : 'stale';
}

/** C-028이 그리는 요약. 되돌림 수는 WP-030 전까지 값이 없다 (DEV-150). */
export interface RangeSummaryView {
  readonly pullRequestCount: number;
  readonly commitCount: number;
  readonly distinctAuthorCount: number;
  readonly changedFilesTotal: number;
  readonly additionsTotal: number;
  readonly deletionsTotal: number;
  readonly filesTruncatedPullRequestCount: number;
  readonly topChangedPaths: readonly { readonly path: string; readonly count: number }[];
  /** `pending`은 "계산 안 함"이다 — 0으로 그리면 "되돌림 없음"이라는 거짓이 된다. */
  readonly reverted: { readonly kind: 'pending'; readonly owner: 'WP-030' } | { readonly kind: 'count'; readonly count: number };
}

export function judgeSummary(source: unknown): RangeSummaryView | null {
  const raw = (source as { summary?: unknown }).summary;
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const num = (key: string): number => (typeof record[key] === 'number' ? (record[key] as number) : 0);
  const paths = Array.isArray(record['top_changed_paths'])
    ? (record['top_changed_paths'] as unknown[])
        .map((entry) => entry as Record<string, unknown>)
        .filter((entry) => typeof entry['path'] === 'string' && typeof entry['count'] === 'number')
        .map((entry) => ({ path: entry['path'] as string, count: entry['count'] as number }))
    : [];
  return {
    pullRequestCount: num('pull_request_count'),
    commitCount: num('commit_count'),
    distinctAuthorCount: num('distinct_author_count'),
    changedFilesTotal: num('changed_files_total'),
    additionsTotal: num('additions_total'),
    deletionsTotal: num('deletions_total'),
    filesTruncatedPullRequestCount: num('files_truncated_pull_request_count'),
    topChangedPaths: paths,
    // 키가 실려 오면 그 값을 쓴다 — WP-030이 채우는 날 화면 수정 없이 값이 선다.
    reverted:
      typeof record['reverted_pull_request_count'] === 'number'
        ? { kind: 'count', count: record['reverted_pull_request_count'] }
        : { kind: 'pending', owner: 'WP-030' },
  };
}

/** 결과 행 (DEV-154의 전용 표가 그린다). */
export interface RangeItemView {
  readonly mergeSeq: number;
  readonly kind: 'pull_request' | 'commit';
  readonly prNumber: number | null;
  readonly commitSha: string;
  readonly title: string | null;
  readonly author: string | null;
  readonly mergedAt: string | null;
  readonly changedFilesCount: number | null;
  readonly additions: number | null;
  readonly deletions: number | null;
  /** `false`면 서수·SHA·PR 번호만 확정이고 나머지는 색인 대기다 (DEV-130). */
  readonly indexed: boolean;
}

/** 응답 항목 → 행. **순서를 바꾸지 않는다** (QA-W004-11 — 서버가 서수 오름차순을 보장한다). */
export function judgeItems(source: unknown): readonly RangeItemView[] {
  const raw = (source as { items?: unknown }).items;
  if (!Array.isArray(raw)) return [];
  const items: RangeItemView[] = [];
  for (const entry of raw) {
    const record = entry as Record<string, unknown>;
    if (typeof record['merge_seq'] !== 'number' || typeof record['commit_sha'] !== 'string') continue;
    items.push({
      mergeSeq: record['merge_seq'],
      kind: record['kind'] === 'commit' ? 'commit' : 'pull_request',
      prNumber: typeof record['pr_number'] === 'number' ? record['pr_number'] : null,
      commitSha: record['commit_sha'],
      title: typeof record['title'] === 'string' ? record['title'] : null,
      author: typeof record['author'] === 'string' ? record['author'] : null,
      mergedAt: typeof record['merged_at'] === 'string' ? record['merged_at'] : null,
      changedFilesCount: typeof record['changed_files_count'] === 'number' ? record['changed_files_count'] : null,
      additions: typeof record['additions'] === 'number' ? record['additions'] : null,
      deletions: typeof record['deletions'] === 'number' ? record['deletions'] : null,
      // 키가 없으면 색인 확인이 안 된 것이다 — 있다고 지어내지 않는다.
      indexed: record['indexed'] === true,
    });
  }
  return items;
}

/**
 * 앵커 정규화 실패 → C-026 상태 (상태 매트릭스의 `error_anchor_*`).
 *
 * `SEQUENCE_SPACE_MISMATCH`와 `ANCHOR_NOT_MERGED`를 가르는 이유는 사용자가
 * 할 일이 다르기 때문이다 — 이쪽은 브랜치를 바꾸고, 저쪽은 머지를 기다린다.
 */
export type AnchorFailureView =
  | { readonly kind: 'not_on_branch'; readonly suggestedSha: string | null }
  | { readonly kind: 'not_merged' }
  | { readonly kind: 'space_mismatch'; readonly releaseBranch: string | null }
  | { readonly kind: 'unresolvable'; readonly reason: string | null; readonly ambiguous: boolean };

export function judgeAnchorFailure(body: unknown): AnchorFailureView | null {
  const error = (body as { error?: { code?: string; detail?: Record<string, unknown> } }).error;
  if (error === undefined || typeof error.code !== 'string') return null;
  const detail = error.detail ?? {};
  switch (error.code) {
    case 'ANCHOR_NOT_ON_BRANCH': {
      const suggested = detail['suggested_anchor'] as Record<string, unknown> | undefined;
      return {
        kind: 'not_on_branch',
        suggestedSha: typeof suggested?.['commit_sha'] === 'string' ? suggested['commit_sha'] : null,
      };
    }
    case 'ANCHOR_NOT_MERGED':
      return { kind: 'not_merged' };
    case 'SEQUENCE_SPACE_MISMATCH':
      return {
        kind: 'space_mismatch',
        releaseBranch:
          typeof detail['release_base_branch'] === 'string' ? detail['release_base_branch'] : null,
      };
    case 'ANCHOR_UNRESOLVABLE':
      return {
        kind: 'unresolvable',
        reason: typeof detail['reason'] === 'string' ? detail['reason'] : null,
        ambiguous: detail['ambiguous'] === true,
      };
    default:
      return null;
  }
}
