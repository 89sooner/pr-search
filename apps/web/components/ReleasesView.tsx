'use client';

/**
 * W-005 릴리스·빌드 (WP-026 / FR-SEQ-004, FR-REL-002, FLOW-003).
 *
 * ## 이 화면이 하지 않는 것
 *
 * **구간 결과를 그리지 않는다.** 릴리스 2건을 고르면 W-004로 앵커를 넘겨 이동한다
 * (FLOW-003). 목록·패싯·뒤로가기 복귀를 두 화면이 나눠 가지면 같은 조사가 두 곳에
 * 반쯤씩 있게 된다 — 조사 상태의 정본은 W-004의 URL 하나다.
 *
 * ## 목록은 저장소 전체다
 *
 * API는 `branch` 필터를 받지만 이 화면은 **보내지 않는다** (CR-030, DEV-158).
 * 브랜치가 다른 릴리스가 한 목록에 있어야 "다른 대상 브랜치 2건 선택"(AC-3)이
 * 만들어지고, 그래야 그 규칙이 검증된다. C-027이 고르는 공간은 **미배포 구간의
 * 기준**이다 — 미배포는 브랜치 head까지의 구간이라 공간 없이는 정의되지 않는다.
 *
 * ## 없는 수를 지어내지 않는다
 *
 * 직전 릴리스가 없으면 "없음"이고 0이 아니다. 되돌림 보유 수는 WP-030 전까지 API에
 * 키가 없어 "준비 중"이다 (DEV-133·150). 릴리스 0건은 오류가 아니라 상태이며,
 * 그 원인 둘("태그가 없다"와 "아직 수집되지 않았다")은 서버가 판별할 수 없으므로
 * 하나의 안내에서 함께 말한다 (DEV-159).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge, Button, Panel } from './ui';
import { SequenceSpaceSelector, type SequenceSpaceRef } from './SequenceSpaceSelector';
import { ReleaseTimeline } from './ReleaseTimeline';
import { RangeSummaryCard } from './RangeSummaryCard';
import { ErrorBanner } from './ErrorBanner';
import { EmptyState } from './EmptyState';
import { judgeSpaces, judgeSummary, type RangeSummaryView, type SequenceSpaceOption } from '../lib/range';
import {
  compareHref,
  formatReleaseQuery,
  judgeComparisonRange,
  judgeReleases,
  hasStartAnchor,
  judgeSelection,
  parseReleaseParams,
  unreleasedHref,
  type ComparisonRangeView,
  type ReleaseListView,
} from '../lib/release';

type ListOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly view: ReleaseListView }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'failed' };

type SummaryOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly summary: RangeSummaryView;
      readonly range: ComparisonRangeView | null;
    }
  | { readonly kind: 'failed' };

export interface ReleasesViewProps {
  readonly loginPath: string;
}

export function ReleasesView({ loginPath }: ReleasesViewProps): ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = useRef(parseReleaseParams(new URLSearchParams(searchParams.toString())));

  const [spaces, setSpaces] = useState<readonly SequenceSpaceOption[] | null>(null);
  const [spacesFailed, setSpacesFailed] = useState(false);
  const [space, setSpace] = useState<SequenceSpaceRef | null>(
    initial.current.repo !== null && initial.current.branch !== null
      ? { repository: initial.current.repo, baseBranch: initial.current.branch }
      : null,
  );
  const [list, setList] = useState<ListOutcome>({ kind: 'idle' });
  /**
   * 목록 재조회 방아쇠.
   *
   * 같은 저장소로 상태만 새 객체로 바꾸면 효과가 다시 돌지 않는다 — 의존성이
   * 파생 문자열(`repository`)이기 때문이다. 실패 화면에서 "다시 시도"가 아무 일도
   * 하지 않던 자리다.
   */
  const [reloadToken, setReloadToken] = useState(0);
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [detailTag, setDetailTag] = useState<string | null>(null);
  const [detail, setDetail] = useState<SummaryOutcome>({ kind: 'idle' });
  const [unreleased, setUnreleased] = useState<SummaryOutcome>({ kind: 'idle' });

  // 공간 목록은 이 화면의 자기 데이터다 (API-SEQ-006) — 진입 시 한 번 부른다.
  useEffect(() => {
    let alive = true;
    void (async (): Promise<void> => {
      try {
        const response = await fetch('/api/sequence-spaces', { cache: 'no-store' });
        if (!alive) return;
        if (!response.ok) {
          setSpacesFailed(true);
          return;
        }
        setSpaces(judgeSpaces(await response.json()));
      } catch {
        if (alive) setSpacesFailed(true);
      }
    })();
    return (): void => {
      alive = false;
    };
  }, []);

  const repository = space?.repository ?? null;
  const baseBranch = space?.baseBranch ?? null;

  /** 저장소가 정해지면 목록을 부른다 — **브랜치는 싣지 않는다** (DEV-158). */
  useEffect(() => {
    if (repository === null) return;
    let alive = true;
    setList({ kind: 'loading' });
    setSelection([]);
    setDetailTag(null);
    setDetail({ kind: 'idle' });
    void (async (): Promise<void> => {
      try {
        const query = new URLSearchParams({ repository });
        const response = await fetch(`/api/releases?${query.toString()}`, { cache: 'no-store' });
        if (!alive) return;
        if (response.status === 404) {
          setList({ kind: 'not_found' });
          return;
        }
        if (!response.ok) {
          setList({ kind: 'failed' });
          return;
        }
        setList({ kind: 'ready', view: judgeReleases(await response.json()) });
      } catch {
        if (alive) setList({ kind: 'failed' });
      }
    })();
    return (): void => {
      alive = false;
    };
  }, [repository, reloadToken]);

  /**
   * 요약 조회 하나 — 상세와 미배포가 같은 API를 다른 앵커로 부른다.
   *
   * **공간은 호출부가 정한다.** 목록이 저장소 스코프라 행마다 브랜치가 다를 수
   * 있고(DEV-158), 셀렉터의 브랜치를 고정으로 쓰면 `release/2.4` 릴리스의 상세를
   * `main` 공간에서 풀어 `SEQUENCE_SPACE_MISMATCH`가 난다 — 화면이 스스로 만든
   * 조합을 스스로 거절하는 꼴이다. 미배포만 셀렉터의 공간을 쓴다.
   */
  const fetchSummary = useCallback(
    async (space: string, params: Record<string, string>): Promise<SummaryOutcome> => {
      if (repository === null) return { kind: 'idle' };
      const query = new URLSearchParams({
        repository,
        base_branch: space,
        // 요약만 쓴다 — 항목 질의를 돌리지 않는다 (API-SEQ-003 `size=0`).
        size: '0',
        ...params,
      });
      try {
        const response = await fetch(`/api/release-comparisons?${query.toString()}`, {
          cache: 'no-store',
        });
        if (!response.ok) return { kind: 'failed' };
        const body: unknown = await response.json();
        const summary = judgeSummary(body);
        if (summary === null) return { kind: 'failed' };
        return { kind: 'ready', summary, range: judgeComparisonRange(body) };
      } catch {
        return { kind: 'failed' };
      }
    },
    [repository],
  );

  /** 미배포 구간 — 공간이 정해져야 뜻이 있다 (브랜치 head까지의 구간이므로). */
  useEffect(() => {
    if (repository === null || baseBranch === null) return;
    let alive = true;
    setUnreleased({ kind: 'loading' });
    void (async (): Promise<void> => {
      const outcome = await fetchSummary(baseBranch, { to: 'unreleased' });
      if (alive) setUnreleased(outcome);
    })();
    return (): void => {
      alive = false;
    };
  }, [repository, baseBranch, fetchSummary]);

  const rows = list.kind === 'ready' ? list.view.releases : [];
  const selected = detailTag === null ? null : (rows.find((row) => row.tagName === detailTag) ?? null);

  /*
   * 상세는 **직전 릴리스 대비**다. 직전이 없으면 부르지 않는다 — 공간 처음부터로
   * 대신하면 "직전 대비"라는 이름이 거짓이 된다.
   */
  useEffect(() => {
    if (selected === null || selected.previousTagName === null) {
      setDetail({ kind: 'idle' });
      return;
    }
    let alive = true;
    setDetail({ kind: 'loading' });
    const previous = selected.previousTagName;
    const current = selected.tagName;
    // **행의 공간**으로 묻는다 — 셀렉터의 브랜치가 아니다 (위 주석 참조).
    const space = selected.baseBranch;
    if (space === null) {
      setDetail({ kind: 'failed' });
      return;
    }
    void (async (): Promise<void> => {
      const outcome = await fetchSummary(space, { from: previous, to: current });
      if (alive) setDetail(outcome);
    })();
    return (): void => {
      alive = false;
    };
  }, [selected, fetchSummary]);

  const verdict = judgeSelection(rows, selection);

  return (
    <div data-testid="releases-view">
      <Panel as="section" aria-label="Sequence space">
        {spacesFailed ? (
          <p data-testid="spaces-error">Unable to load sequence spaces. Please try again later.</p>
        ) : null}
        {spaces === null && !spacesFailed ? <p data-testid="spaces-loading">Loading sequence spaces…</p> : null}
        {spaces !== null ? (
          <SequenceSpaceSelector
            spaces={spaces}
            value={space}
            onChange={(next) => {
              setSpace(next);
              router.replace(
                `/releases?${formatReleaseQuery({ repo: next.repository, branch: next.baseBranch })}`,
                { scroll: false },
              );
            }}
          />
        ) : null}
        <p data-testid="releases-scope-note">
          This list includes releases from <strong>all base branches in this repository</strong> . The selected space (
          {baseBranch ?? "Not selected"}) defines the unreleased range below.
        </p>
      </Panel>

      {space === null ? (
        <EmptyState
          cause="no_query"
          title="Select a sequence space"
          description="Select a repository and base branch to view the release timeline."
        />
      ) : null}

      {list.kind === 'loading' ? <p data-testid="releases-loading">Loading releases…</p> : null}

      {list.kind === 'not_found' ? (
        <EmptyState
          cause="not_found"
          title="Repository not found"
          description="The repository is unregistered or outside your access scope."
        />
      ) : null}

      {list.kind === 'failed' ? (
        <ErrorBanner
          tone="danger"
          title="Unable to load releases"
          impact="Timeline and range comparison are unavailable."
          action={
            <Button
              data-testid="releases-retry"
              onClick={() => {
                setReloadToken((token) => token + 1);
              }}
            >
              Try again
            </Button>
          }
        />
      ) : null}

      {list.kind === 'ready' && list.view.reason === 'release_not_indexed' ? (
        /*
         * 원인 둘을 함께 말한다 (DEV-159). 서버는 "태그가 0개"와 "아직 받지
         * 않았다"를 판별할 수 없고, 판별할 수 없는 것을 두 안내로 가르면 둘 중
         * 하나는 반드시 거짓이 된다.
         *
         * **W-009가 서면서 저장소 진단 링크를 건다** (CR-050, DEV-159 해소).
         * 판별할 수 없다는 사실은 그대로이므로 문구는 여전히 둘을 함께 말하고,
         * 링크는 "수집 상태를 직접 확인할 수 있다"를 더한다.
         */
        <EmptyState
          cause="not_indexed"
          title="No releases in this repository"
          description="No tags exist yet, or release ingestion has not reached this repository. Check tags in GitHub Enterprise."
          actions={
            repository === null ? undefined : (
              <Link
                href={`/repositories?repository=${encodeURIComponent(repository)}`}
                data-testid="releases-open-repository-overview"
              >
                View repository ingestion status
              </Link>
            )
          }
        />
      ) : null}

      {list.kind === 'ready' && list.view.truncated ? (
        <p data-testid="releases-truncated">
          Only recent releases are shown. Older releases are omitted.
        </p>
      ) : null}

      {list.kind === 'ready' && rows.length > 0 ? (
        <>
          <ReleaseTimeline
            releases={rows}
            selection={selection}
            onSelectionChange={setSelection}
            selectedTag={detailTag}
            onSelect={setDetailTag}
          />

          <Panel as="section" aria-label="Compare range">
            {verdict.kind === 'ready' ? (
              <>
                <p data-testid="compare-direction">
                  {verdict.from.tagName} <Badge tone="neutral">Excluded</Badge> → {verdict.to.tagName}{' '}
                  <Badge tone="neutral">Included</Badge> — The lower ordinal is the start.
                </p>
                <Link
                  href={compareHref(space?.repository ?? '', verdict.from, verdict.to)}
                  data-testid="compare-link"
                >
                  View PRs in this range
                </Link>
              </>
            ) : null}

            {verdict.kind === 'incomplete' ? (
              <p data-testid="compare-incomplete">
                Select {verdict.remaining} more releases to compare.
              </p>
            ) : null}

            {/* AC-3: 이동 전에 막고 사유를 말한다 — W-004까지 보내 놓고 실패시키지 않는다. */}
            {verdict.kind === 'space_mismatch' ? (
              <ErrorBanner
                tone="warning"
                title="Cannot compare releases from different base branches"
                impact={`The selected releases belong to ${verdict.spaces.join(' · ')} branches. Each branch has its own sequence, so these ordinals cannot form a single range.`}
                action={<span>Select two releases from the same branch.</span>}
                recoverable
              />
            ) : null}

            {verdict.kind === 'not_anchorable' ? (
              <ErrorBanner
                tone="warning"
                title="A release without an ordinal cannot be a range endpoint"
                impact={`${verdict.tagNames.join(', ')} is outside the base branch's first-parent chain or has not been resolved in the current epoch.`}
                action={<span>Select a release with an ordinal.</span>}
                recoverable
              />
            ) : null}
          </Panel>

          <Panel as="section" aria-label="Release details">
            {selected === null ? (
              <p data-testid="detail-empty">Select a release tag to view changes since the previous release.</p>
            ) : selected.previousTagName === null ? (
              <p data-testid="detail-no-previous">
                {selected.tagName} is the earliest release in this space. No previous release exists for comparison.
              </p>
            ) : (
              <>
                <p data-testid="detail-heading">
                  {selected.tagName} — compared with previous release ({selected.previousTagName})
                </p>
                {detail.kind === 'loading' ? <p data-testid="detail-loading">Loading summary…</p> : null}
                {detail.kind === 'failed' ? (
                  <p data-testid="detail-failed">Unable to load summary.</p>
                ) : null}
                {detail.kind === 'ready' ? <RangeSummaryCard summary={detail.summary} /> : null}
              </>
            )}
          </Panel>

          <Panel as="section" aria-label="Unreleased range">
            {unreleased.kind === 'loading' ? (
              <p data-testid="unreleased-loading">Checking unreleased range…</p>
            ) : null}
            {unreleased.kind === 'failed' ? (
              <p data-testid="unreleased-failed">Unable to load unreleased range.</p>
            ) : null}
            {unreleased.kind === 'ready' ? (
              <>
                <p data-testid="unreleased-summary">
                  Since the last release: {unreleased.summary.pullRequestCount} PRs are pending through {baseBranch ?? ''}{' '}
                  head.
                </p>
                {unreleased.range === null ? null : (
                  <>
                    <Link
                      href={unreleasedHref(
                        repository ?? '',
                        baseBranch ?? '',
                        { fromSeq: unreleased.range.fromSeq, toSeq: unreleased.range.toSeq },
                        unreleased.range.seqEpoch,
                      )}
                      data-testid="unreleased-link"
                    >
                      View unreleased changes
                    </Link>
                    {hasStartAnchor(unreleased.range) ? null : (
                      <p data-testid="unreleased-no-start">
                        This space has no numbered releases to use as a start anchor. Choose a start point in range investigation.
                      </p>
                    )}
                  </>
                )}
              </>
            ) : null}
          </Panel>
        </>
      ) : null}

      <p hidden data-testid="login-path">
        {loginPath}
      </p>
    </div>
  );
}
