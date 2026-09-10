'use client';

/**
 * W-005 릴리스·빌드 (WP-026 / FLOW-003, FR-SEQ-004·FR-REL-002).
 *
 * ## 흐름이 상태의 정본을 정한다
 *
 * - **URL이 화면 상태다** — 브랜치와 비교 선택이 `?branch=&select=`에 실리고,
 *   체크가 바뀌면 URL을 그 자리에서 갱신한다 (ADR-007의 자세, DEV-158).
 *   브랜치는 ref가 아니라 **살아 있는 파라미터**에서 읽는다 — C-027로 같은
 *   저장소의 다른 브랜치로 옮기면 같은 컴포넌트 인스턴스가 새 URL을 받는다.
 * - **목록은 공간당 한 번, 상세는 행 선택 시 태그당 한 번** 조회한다
 *   (IA 원칙 4 — QA-W002-17과 같은 규칙).
 * - **비교는 조회가 아니라 이동이다** (FLOW-003): 두 태그를 앵커로
 *   `/ranges`에 전달한다. 시퀀스가 작은 쪽이 시작이 되고 방향 문구가 실행
 *   전에 보인다 (QA-W005-02). 상세 요약만 API-SEQ-003을 부른다.
 * - **`select=`의 낯선 태그는 복원하지 않는다** (DEV-158) — 다른 브랜치
 *   릴리스가 딥링크로 실려 오는 자리이고, 경고가 `error_space_mismatch`의
 *   화면 쪽 처리다. 서버 400은 이중 방어다.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge, Banner, Button, Panel } from '@conductor-by-89soone/react';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { RangeSummaryCard } from './RangeSummaryCard';
import { ReleaseTimeline } from './ReleaseTimeline';
import { SequenceSpaceSelector, type SequenceSpaceRef } from './SequenceSpaceSelector';
import { judgeSpaces, type SequenceSpaceOption } from '../lib/range';
import {
  compareHref,
  formatReleasesQuery,
  judgeComparison,
  judgeSelection,
  judgeTimeline,
  parseReleasesParams,
  planCompare,
  planDetail,
  unreleasedHref,
  type ComparisonView,
  type ReleasesParams,
  type TimelineView,
} from '../lib/releases';

type TimelineOutcome =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly timeline: TimelineView }
  | { readonly kind: 'server_error'; readonly code: string; readonly message: string; readonly correlationId: string | null; readonly status: number }
  | { readonly kind: 'offline' };

type DetailOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly tag: string }
  | { readonly kind: 'first_release'; readonly tag: string }
  | { readonly kind: 'ready'; readonly tag: string; readonly fromTag: string; readonly comparison: ComparisonView }
  | { readonly kind: 'failed'; readonly tag: string; readonly message: string };

export interface ReleasesViewProps {
  readonly owner: string;
  readonly repo: string;
  readonly loginPath: string;
}

/** 공간 목록은 셀렉터의 자기 데이터다 (API-SEQ-006) — 진입 시 한 번 부른다. */
function useSequenceSpaces(): {
  readonly spaces: readonly SequenceSpaceOption[] | null;
  readonly failed: boolean;
} {
  const [spaces, setSpaces] = useState<readonly SequenceSpaceOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async (): Promise<void> => {
      try {
        const response = await fetch('/api/sequence-spaces', { cache: 'no-store' });
        if (!alive) return;
        if (!response.ok) {
          setFailed(true);
          return;
        }
        setSpaces(judgeSpaces(await response.json()));
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return (): void => {
      alive = false;
    };
  }, []);
  return { spaces, failed };
}

export function ReleasesView({ owner, repo, loginPath }: ReleasesViewProps): ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = parseReleasesParams(new URLSearchParams(searchParams.toString()));
  const repository = `${owner}/${repo}`;
  const branch = params.branch;
  /*
   * 목록 조회 효과가 실행 시점의 `select=`를 읽기 위한 통로다. `select`를 효과
   * 의존성에 넣으면 체크할 때마다(우리가 URL을 되쓸 때마다) 목록을 다시 부른다 —
   * "공간당 한 번"이 깨진다.
   */
  const paramsRef = useRef<ReleasesParams>(params);
  paramsRef.current = params;

  const { spaces, failed: spacesFailed } = useSequenceSpaces();
  const [outcome, setOutcome] = useState<TimelineOutcome>({ kind: 'loading' });
  const [selection, setSelection] = useState<readonly string[]>([]);
  /** `select=`에서 복원하지 못한 태그들 — 경고로만 남는다 (DEV-158). */
  const [unknownSelect, setUnknownSelect] = useState<readonly string[]>([]);
  const [detail, setDetail] = useState<DetailOutcome>({ kind: 'idle' });
  const detailCache = useRef(new Map<string, { fromTag: string; comparison: ComparisonView }>());

  // 목록 조회 — 공간당 한 번 (API-REL-005). 공간이 바뀌면 이전 화면 상태는 전부 무효다.
  useEffect(() => {
    if (branch === null) return;
    let alive = true;
    setOutcome({ kind: 'loading' });
    setSelection([]);
    setUnknownSelect([]);
    setDetail({ kind: 'idle' });
    detailCache.current.clear();
    void (async (): Promise<void> => {
      try {
        const query = new URLSearchParams({ repository, base_branch: branch });
        const response = await fetch(`/api/releases?${query.toString()}`, { cache: 'no-store' });
        const body: unknown = await response.json();
        if (!alive) return;
        if (!response.ok) {
          const record = body as Record<string, unknown>;
          const error = (record['error'] ?? {}) as { code?: string; message?: string };
          setOutcome({
            kind: 'server_error',
            code: error.code ?? 'UNKNOWN',
            message: error.message ?? '릴리스 목록을 불러오지 못했습니다.',
            correlationId: typeof record['correlation_id'] === 'string' ? record['correlation_id'] : null,
            status: response.status,
          });
          return;
        }
        const timeline = judgeTimeline(body);
        setOutcome({ kind: 'ready', timeline });
        // 딥링크 선택 복원 — 타임라인에 실재하는 태그만 살린다 (DEV-158).
        const judged = judgeSelection(paramsRef.current.select, timeline.releases);
        setSelection(judged.selected.map((release) => release.tagName));
        setUnknownSelect(judged.unknown);
      } catch {
        if (alive) setOutcome({ kind: 'offline' });
      }
    })();
    return (): void => {
      alive = false;
    };
  }, [repository, branch]);

  /** 체크 상태를 URL에 되쓴다 — 이 URL이 곧 공유 가능한 화면 상태다. */
  const applySelection = useCallback(
    (next: readonly string[]): void => {
      setSelection(next);
      const query = formatReleasesQuery({ branch, select: next });
      router.replace(`/releases/${owner}/${repo}?${query}`);
    },
    [branch, owner, repo, router],
  );

  const openDetail = useCallback(
    async (tag: string): Promise<void> => {
      if (outcome.kind !== 'ready' || branch === null) return;
      const release = outcome.timeline.releases.find((entry) => entry.tagName === tag);
      if (release === undefined) return;

      const plan = planDetail(release);
      if (plan.kind === 'first_release') {
        // 직전 릴리스가 없다 — 비교를 부르지 않는다 (DEV-158).
        setDetail({ kind: 'first_release', tag });
        return;
      }

      const cached = detailCache.current.get(tag);
      if (cached !== undefined) {
        setDetail({ kind: 'ready', tag, fromTag: cached.fromTag, comparison: cached.comparison });
        return;
      }

      setDetail({ kind: 'loading', tag });
      try {
        const query = new URLSearchParams({
          repository,
          base_branch: branch,
          from: plan.fromTag,
          to: tag,
        });
        const response = await fetch(`/api/release-comparisons?${query.toString()}`, { cache: 'no-store' });
        const body: unknown = await response.json();
        if (!response.ok) {
          const error = ((body as Record<string, unknown>)['error'] ?? {}) as { message?: string };
          setDetail({ kind: 'failed', tag, message: error.message ?? '상세 요약을 불러오지 못했습니다.' });
          return;
        }
        const comparison = judgeComparison(body);
        // 태그당 한 번만 부른다 — 다시 선택해도 캐시가 답한다 (IA 원칙 4).
        detailCache.current.set(tag, { fromTag: plan.fromTag, comparison });
        setDetail({ kind: 'ready', tag, fromTag: plan.fromTag, comparison });
      } catch {
        setDetail({ kind: 'failed', tag, message: '네트워크 오류로 상세 요약을 불러오지 못했습니다.' });
      }
    },
    [outcome, branch, repository],
  );

  // 브랜치가 없으면 조회할 공간이 정해지지 않았다 — 셀렉터로 안내한다.
  if (branch === null) {
    return (
      <div data-testid="releases-view">
        <Panel as="section" aria-label="시퀀스 공간 선택">
          <p data-testid="releases-need-branch">브랜치를 지정하면 릴리스 타임라인을 조회합니다.</p>
          {spacesFailed ? (
            <p data-testid="spaces-error">시퀀스 공간 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.</p>
          ) : null}
          {spaces === null && !spacesFailed ? <p data-testid="spaces-loading">공간 목록을 불러오는 중…</p> : null}
          {spaces !== null ? (
            <SequenceSpaceSelector
              spaces={spaces}
              value={null}
              onChange={(next: SequenceSpaceRef) => {
                router.push(
                  `/releases/${next.repository}?${formatReleasesQuery({ branch: next.baseBranch, select: [] })}`,
                );
              }}
            />
          ) : null}
        </Panel>
        <span data-testid="login-path" hidden>
          {loginPath}
        </span>
      </div>
    );
  }

  const timeline = outcome.kind === 'ready' ? outcome.timeline : null;
  const selectionJudgement = timeline === null ? null : judgeSelection(selection, timeline.releases);
  const comparePair =
    selectionJudgement !== null && selectionJudgement.selected.length === 2
      ? planCompare(selectionJudgement.selected[0]!, selectionJudgement.selected[1]!)
      : null;
  /*
   * 상세의 구간 링크 재료. 두 태그 다 현재 타임라인에 실재할 때만 선다 —
   * `previous_tag_name`은 같은 타임라인의 행에서 왔지만, 공간 전환 직후의
   * 낡은 상세 상태가 남는 순간까지 방어한다.
   */
  const detailRangePlan = (() => {
    if (detail.kind !== 'ready' || timeline === null) return null;
    const fromView = timeline.releases.find((entry) => entry.tagName === detail.fromTag);
    const toView = timeline.releases.find((entry) => entry.tagName === detail.tag);
    if (fromView === undefined || toView === undefined) return null;
    return planCompare(fromView, toView);
  })();

  return (
    <div data-testid="releases-view">
      <Panel as="section" aria-label="시퀀스 공간">
        {spaces !== null ? (
          <SequenceSpaceSelector
            spaces={spaces}
            value={{ repository, baseBranch: branch }}
            onChange={(next: SequenceSpaceRef) => {
              // 공간 전환은 새 화면이다 — 선택을 승계하면 다른 브랜치 태그가 남는다 (DEV-158).
              router.push(
                `/releases/${next.repository}?${formatReleasesQuery({ branch: next.baseBranch, select: [] })}`,
              );
            }}
          />
        ) : null}
        {spacesFailed ? (
          <p data-testid="spaces-error">시퀀스 공간 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.</p>
        ) : null}
      </Panel>

      {outcome.kind === 'loading' ? <p data-testid="releases-loading">릴리스 타임라인을 불러오는 중…</p> : null}
      {outcome.kind === 'offline' ? (
        <p data-testid="releases-offline" role="alert">
          네트워크 오류로 릴리스 목록을 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.
        </p>
      ) : null}
      {outcome.kind === 'server_error' ? (
        <ErrorBanner
          tone={outcome.status >= 500 ? 'danger' : 'warning'}
          title={`릴리스 목록 조회 실패 (${outcome.code})`}
          impact={outcome.message}
          correlationId={outcome.correlationId}
          recoverable={outcome.status < 500}
        />
      ) : null}

      {timeline !== null ? (
        <>
          {timeline.sequenceState === 'reassigning' ? (
            <Banner tone="warning" title="재채번 진행 중" data-testid="releases-reassigning-banner">
              마지막 확정 값으로 표시 중입니다 — 아직 재해석되지 않은 릴리스는 목록에 없을 수 있습니다.
            </Banner>
          ) : null}

          {unknownSelect.length > 0 ? (
            <Banner tone="warning" title="복원하지 못한 비교 선택" data-testid="release-selection-unknown">
              {unknownSelect.join(', ')} — 이 브랜치의 릴리스가 아니라 선택을 복원하지 않았습니다. 다른
              브랜치의 릴리스와는 비교할 수 없습니다.
            </Banner>
          ) : null}

          {timeline.notIndexed ? (
            <EmptyState
              cause="not_indexed"
              title="이 저장소의 릴리스가 아직 수집되지 않았습니다"
              description="수집이 서면 타임라인이 채워집니다. 저장소 등록 상태를 먼저 확인하세요."
              actions={
                <a data-testid="release-registration-path" href={timeline.registrationStatusPath ?? '/repositories'}>
                  저장소 등록 상태 보기
                </a>
              }
            />
          ) : null}

          {!timeline.notIndexed && timeline.releases.length === 0 ? (
            <EmptyState
              cause="no_result"
              title="이 브랜치에는 릴리스가 없습니다"
              description="태그가 이 브랜치의 first-parent 체인에 닿으면 타임라인에 나타납니다. 태그 생성은 GHE에서 합니다."
            />
          ) : null}

          {timeline.releases.length > 0 ? (
            <>
              <Panel as="section" aria-label="구간 비교" data-testid="release-compare-bar">
                {comparePair === null ? (
                  <p data-testid="release-compare-hint">
                    비교할 릴리스 2건을 선택하세요 ({selection.length}/2)
                  </p>
                ) : (
                  <>
                    {/* 정규화 방향을 실행 전에 명시한다 (QA-W005-02). */}
                    <p data-testid="release-compare-direction">{comparePair.direction}</p>
                    <Button
                      data-testid="release-compare-go"
                      onClick={() => {
                        router.push(compareHref(repository, branch, comparePair, timeline.seqEpoch));
                      }}
                    >
                      구간 비교 →
                    </Button>
                  </>
                )}
              </Panel>

              <ReleaseTimeline
                releases={timeline.releases}
                selection={selection}
                onSelectionChange={applySelection}
                detailTag={detail.kind === 'idle' ? null : detail.tag}
                onDetailSelect={(tag) => void openDetail(tag)}
              />

              <Panel as="section" aria-label="선택한 릴리스 상세" data-testid="release-detail">
                {detail.kind === 'idle' ? (
                  <p data-testid="release-detail-hint">릴리스를 선택하면 직전 릴리스 대비 요약을 보여 줍니다.</p>
                ) : null}
                {detail.kind === 'loading' ? (
                  <p data-testid="release-detail-loading">{detail.tag}의 상세 요약을 불러오는 중…</p>
                ) : null}
                {detail.kind === 'failed' ? (
                  <p data-testid="release-detail-error" role="alert">
                    {detail.message}{' '}
                    <Button data-testid="release-detail-retry" onClick={() => void openDetail(detail.tag)}>
                      다시 시도
                    </Button>
                  </p>
                ) : null}
                {detail.kind === 'first_release' ? (
                  <div data-testid="release-detail-first">
                    <Badge tone="neutral">첫 릴리스</Badge>
                    <p>
                      {detail.tag}는 이 공간의 첫 릴리스입니다 — 직전 릴리스가 없어 비교 요약이 서지
                      않습니다. 목록의 PR 수가 히스토리 시작부터의 수입니다.
                    </p>
                    {/* 시작 앵커가 없는 구간은 W-004로 표현할 수 없다 (DEV-158) — 링크 대신 사유를 남긴다. */}
                    <p data-testid="release-detail-first-no-range">
                      구간 진입은 직전 릴리스가 있는 릴리스에서 가능합니다.
                    </p>
                  </div>
                ) : null}
                {detail.kind === 'ready' ? (
                  <div data-testid={`release-detail-ready-${detail.tag}`}>
                    <p data-testid="release-detail-direction">{detail.comparison.direction ?? ''}</p>
                    {detail.comparison.summary === null ? (
                      <p data-testid="release-detail-empty">요약을 해석하지 못했습니다.</p>
                    ) : (
                      <RangeSummaryCard summary={detail.comparison.summary} />
                    )}
                    {detailRangePlan === null ? null : (
                      <a
                        data-testid="release-detail-range-link"
                        href={compareHref(repository, branch, detailRangePlan, timeline.seqEpoch)}
                      >
                        이 구간 PR 목록 보기 →
                      </a>
                    )}
                  </div>
                ) : null}
              </Panel>

              {timeline.unreleased !== null ? (
                <Panel as="section" aria-label="미배포 구간" data-testid="release-unreleased">
                  <p>
                    마지막 릴리스 <strong>{timeline.unreleased.lastReleaseTag}</strong> 이후 대기 중인 PR{' '}
                    <strong data-testid="release-pending-count">
                      {timeline.unreleased.pendingPullRequestCount.toLocaleString()}
                    </strong>
                    건 (head seq {timeline.unreleased.headSeq})
                  </p>
                  <Button
                    data-testid="release-unreleased-go"
                    onClick={() => {
                      router.push(
                        unreleasedHref(repository, branch, timeline.unreleased!, timeline.seqEpoch),
                      );
                    }}
                  >
                    미배포 구간 조회 →
                  </Button>
                </Panel>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
      <span data-testid="login-path" hidden>
        {loginPath}
      </span>
    </div>
  );
}

/** `/releases` 진입 — 공간을 고르면 타임라인으로 이동한다 (W-004와 같은 구조). */
export function ReleaseSpacePicker(): ReactNode {
  const router = useRouter();
  const { spaces, failed } = useSequenceSpaces();
  return (
    <div data-testid="releases-picker">
      <p data-testid="releases-picker-hint">저장소와 브랜치를 고르면 릴리스 타임라인을 보여 줍니다.</p>
      {failed ? (
        <p data-testid="spaces-error">시퀀스 공간 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.</p>
      ) : null}
      {spaces === null && !failed ? <p data-testid="spaces-loading">공간 목록을 불러오는 중…</p> : null}
      {spaces !== null ? (
        <SequenceSpaceSelector
          spaces={spaces}
          value={null}
          onChange={(next: SequenceSpaceRef) => {
            router.push(
              `/releases/${next.repository}?${formatReleasesQuery({ branch: next.baseBranch, select: [] })}`,
            );
          }}
        />
      ) : null}
    </div>
  );
}
