'use client';

/**
 * W-002 PR 상세 (WP-017 / FLOW-002, 상태 매트릭스 W-002).
 *
 * 판정은 `lib/pr-detail.ts`가 한다. 이 파일은 그 결과를 그리고, 조회와
 * 재조회를 붙인다.
 *
 * ## 진입 시 무엇을 부르는가
 *
 * **PR 문서 하나뿐이다.** 관계·동시 변경은 섹션을 확장할 때 부른다
 * (IA 원칙 4, QA-W002-17). 지금은 확장해도 부를 것이 없지만(WP-031),
 * **진입 시 함께 부르지 않는 구조**를 지금 잡는다 — 나중에 붙이면 이미
 * 잘못 만든 뒤다.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, Banner, Button, Panel } from '@conductor-by-89soone/react';
import { CommitList } from './CommitList';
import { EmptyState } from './EmptyState';
import { DetailSectionNav } from './DetailSectionNav';
import { EntityHeader } from './EntityHeader';
import { ErrorBanner } from './ErrorBanner';
import { RelationSection } from './RelationSection';
import { CoChangeSection } from './CoChangeSection';


import { NeighborSection } from './NeighborSequenceList';
import { ReleaseContainmentSection } from './ReleaseContainmentList';
import { PrTimeline } from './PrTimeline';
import { SequenceBadge } from './SequenceBadge';
import { formatDuration } from '../lib/format';
import {
  commitListModel,
  gheePullRequestUrl,
  reviewerStates,
  searchBackHref,
  timelineSteps,
  type PrDetailSource,
} from '../lib/pr-detail';
import { resolveDetailScreenState, type DetailStateInput } from '../lib/screen-state';

export interface PrDetailViewProps {
  readonly repository: string;
  readonly prNumber: number;
  readonly loginPath: string;
  readonly gheBaseUrl?: string;
  /** 검색에서 왔다면 원래 질의. 되돌아가는 링크를 만든다 (CR-019, DEV-078). */
  readonly fromQuery?: string;
}

interface Outcome {
  readonly detail: PrDetailSource | null;
  readonly errorBody: DetailStateInput['errorBody'];
  readonly status: number | null;
  readonly networkFailed: boolean;
}

const IDLE: Outcome = { detail: null, errorBody: null, status: null, networkFailed: false };

export function PrDetailView({
  repository,
  prNumber,
  loginPath,
  gheBaseUrl,
  fromQuery,
}: PrDetailViewProps): ReactNode {
  const [outcome, setOutcome] = useState<Outcome>(IDLE);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    const controller = new AbortController();
    setLoading(true);

    const url = `/api/pull-requests/${encodeURIComponent(repository)}/${String(prNumber)}`;

    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        const body: unknown = await response.json();
        if (mine !== generation.current) return;

        setOutcome(
          response.ok
            ? { ...IDLE, detail: body as PrDetailSource, status: response.status }
            : { ...IDLE, errorBody: body as Outcome['errorBody'], status: response.status },
        );
      } catch (error) {
        if (controller.signal.aborted || mine !== generation.current) return;
        void error;
        setOutcome({ ...IDLE, networkFailed: true });
      } finally {
        if (mine === generation.current) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
    // `nonce`가 바뀌면 다시 부른다 — 수동 재조회다 (자동 폴링 금지).
  }, [repository, prNumber, nonce]);

  const refetch = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  const screen = resolveDetailScreenState({
    loading,
    networkFailed: outcome.networkFailed,
    errorBody: outcome.errorBody,
    status: outcome.status,
    detail: outcome.detail,
    loginPath,
  });

  const backHref = searchBackHref(fromQuery);

  if (screen.kind === 'loading_initial') {
    return (
      <div data-testid="pr-detail" data-screen-state="loading_initial">
        <Panel as="section" aria-busy="true" data-testid="detail-skeleton">
          <p>불러오는 중…</p>
        </Panel>
      </div>
    );
  }

  if (screen.kind === 'not_found') {
    return (
      <div data-testid="pr-detail" data-screen-state="not_found">
        {/*
         * **존재 여부를 드러내지 않는다** (QA-W002-18, FR-AUTH-002 AC-4).
         * "권한이 없습니다"라고 쓰면 "있긴 있다"가 새어 나간다.
         */}
        {/*
         * **저장소 수집 상태로 가는 경로를 함께 준다** (QA-W009-13, CR-050 DEV-358).
         *
         * 이 화면은 "없다"와 "볼 수 없다"를 구분하지 않으므로(THR-004) 사용자는
         * 어느 쪽인지 모른 채 남는다 — 저장소 진단이 그 답을 스스로 찾는 자리다.
         * **링크가 존재를 주장하지 않는다**: W-009 조회도 같은 접근 범위를 지나고
         * 미등록과 범위 밖을 같은 빈 결과로 답한다 (FR-ING-009 AC-10).
         */}
        <EmptyState
          cause="not_found"
          description="이 PR을 찾을 수 없습니다. 번호가 정확한지 확인하세요. 저장소가 아직 수집되지 않았을 수도 있습니다."
          actions={
            <>
              <a href={backHref}>검색으로 돌아가기</a>{' '}
              <a
                href={`/repositories?repository=${encodeURIComponent(repository)}`}
                data-testid="pr-open-repository-overview"
              >
                이 저장소의 수집 상태 보기
              </a>
            </>
          }
        />
      </div>
    );
  }

  if (screen.kind === 'no_permission') {
    return (
      <div data-testid="pr-detail" data-screen-state="no_permission">
        <EmptyState cause="no_permission" />
      </div>
    );
  }

  if (screen.kind === 'auth_expired') {
    return (
      <div data-testid="pr-detail" data-screen-state="auth_expired">
        <ErrorBanner
          tone="warning"
          title="세션이 만료되었습니다"
          impact="다시 로그인하면 보던 화면으로 돌아옵니다."
          action={
            <a href={`${screen.loginPath}?return_to=${encodeURIComponent(`/pr/${repository}/${String(prNumber)}`)}`}>
              다시 로그인
            </a>
          }
        />
      </div>
    );
  }

  if (screen.kind === 'offline') {
    return (
      <div data-testid="pr-detail" data-screen-state="offline">
        <ErrorBanner
          tone="danger"
          title="서버에 연결하지 못했습니다"
          impact="네트워크 연결을 확인한 뒤 다시 시도하세요."
          recoverable
          action={
            <Button variant="secondary" onClick={refetch}>
              다시 시도
            </Button>
          }
        />
      </div>
    );
  }

  if (screen.kind === 'error_other') {
    return (
      <div data-testid="pr-detail" data-screen-state="error_other">
        <ErrorBanner
          tone="danger"
          title="조회에 실패했습니다"
          impact={screen.message}
          recoverable={screen.correlationId === null}
          correlationId={screen.correlationId}
          action={
            <Button variant="secondary" onClick={refetch}>
              다시 시도
            </Button>
          }
        />
      </div>
    );
  }

  const pr = outcome.detail ?? {};
  const commits = commitListModel(pr);
  const reviewers = reviewerStates(pr);
  const external = gheePullRequestUrl(gheBaseUrl, pr.repository ?? repository, pr.pr_number ?? prNumber);

  return (
    <div data-testid="pr-detail" data-screen-state="ready">
      <EntityHeader
        kind="pull_request"
        title={pr.title ?? `#${String(pr.pr_number ?? prNumber)}`}
        identifier={`${pr.repository ?? repository} #${String(pr.pr_number ?? prNumber)}`}
        externalUrl={external}
        badges={
          <>
            {pr.state === undefined ? null : (
              <Badge tone={pr.state === 'merged' ? 'success' : 'neutral'}>{pr.state}</Badge>
            )}
            {pr.draft === true ? <Badge tone="neutral">draft</Badge> : null}
            <SequenceBadge
              merge_seq={pr.merge_seq ?? null}
              seq_epoch={pr.seq_epoch ?? null}
              sequence_space={pr.sequence_space ?? null}
              state={pr.state ?? null}
            />
          </>
        }
      />
      <DetailSectionNav sections={[{ id: 'overview-heading', label: '개요' }, { id: 'commits-heading', label: '커밋' }, { id: 'timeline-heading', label: '타임라인' }, { id: 'neighbors-heading', label: '선행·후행' }, { id: 'releases-heading', label: '포함 릴리스' }, { id: 'links-heading', label: '관계' }]} />

      {/*
       * 저장소가 보관됨이면 알린다 — 결과가 갱신되지 않는 이유가 된다.
       */}
      {pr.repository_archived === true ? (
        <Banner tone="warning" title="보관된 저장소">
          <p>이 저장소는 보관되어 더 이상 갱신되지 않습니다.</p>
        </Banner>
      ) : null}

      <Panel as="section" aria-labelledby="overview-heading" data-testid="pr-overview">
        <h2 id="overview-heading">개요</h2>
        <dl>
          <dt>대상 브랜치</dt>
          <dd>{pr.base_branch ?? '—'}</dd>
          <dt>소스 브랜치</dt>
          <dd>{pr.head_branch ?? '—'}</dd>
          <dt>작성자</dt>
          <dd>{pr.author ?? '—'}</dd>
          <dt>라벨</dt>
          <dd>{(pr.labels ?? []).length === 0 ? '—' : (pr.labels ?? []).join(', ')}</dd>
          <dt>변경 규모</dt>
          <dd>
            {pr.changed_files_count === undefined ? '—' : `파일 ${String(pr.changed_files_count)}개`}
            {pr.additions === undefined ? '' : ` +${String(pr.additions)}`}
            {pr.deletions === undefined ? '' : ` -${String(pr.deletions)}`}
            {/* 파일 목록 절삭도 밝힌다 — 조용히 자르면 규모를 오해한다. */}
            {pr.files_truncated === true ? ' (변경 파일 목록이 절삭되었습니다)' : ''}
          </dd>
          <dt>리드타임</dt>
          <dd>{pr.lead_time_seconds === undefined ? '—' : formatDuration(pr.lead_time_seconds)}</dd>
          <dt>첫 리뷰 대기</dt>
          <dd>
            {pr.first_review_wait_seconds === undefined
              ? '—'
              : formatDuration(pr.first_review_wait_seconds)}
          </dd>
          <dt>리뷰어</dt>
          <dd data-testid="reviewers">
            {reviewers.length === 0
              ? '—'
              : reviewers.map((r) => (
                  <span key={r.login} data-testid={`reviewer-${r.login}`}>
                    {r.login}{' '}
                    {/*
                     * 상태는 **둘뿐이다** (CR-020, DEV-085). "변경 요청"은
                     * 투영이 저장하지 않아 만들지 않는다.
                     */}
                    <Badge tone={r.status === 'approved' ? 'success' : 'neutral'}>
                      {r.status === 'approved' ? '승인함' : '아직 아님'}
                    </Badge>
                  </span>
                ))}
          </dd>
        </dl>
      </Panel>

      <CommitList {...commits} onRefetch={refetch} refetching={loading} />

      <PrTimeline steps={timelineSteps(pr)} />

      {/*
       * 골격 셋. **숨기지 않는다** — 숨기면 기능 부재로 오인한다.
       * 미머지 PR의 선행·후행은 특히 그렇다 (QA-W002-07).
       */}
      {/*
        * 선행·후행 (WP-027, CR-031). **미머지면 조회하지 않는다** (DEV-164):
        * PR 문서의 `state`로 아는 사실을 409로 되묻지 않는다. 그때도 섹션은
        * 숨기지 않고 사유를 그린다 (QA-W002-07).
        */}
      <NeighborSection
        repository={repository}
        sectionId="neighbors"
        anchor={{ kind: 'pull_request', prNumber }}
        baseBranch={pr.base_branch ?? null}
        documentEpoch={pr.seq_epoch ?? null}
        {...(pr.state === 'merged' ? {} : { skip: { reason: 'not_merged' as const } })}
      />
      <ReleaseContainmentSection
        repository={repository}
        kind="pull_request"
        id={String(prNumber)}
        sectionId="releases"
      />
      {/*
        * 관계와 동시 변경은 **독립한 하위 섹션**이다 (WP-031, CR-042).
        *
        * 한쪽이 실패해도 다른 쪽과 상세 본체는 그대로다 — 상태 매트릭스 W-002의
        * `partial_failure`가 정한 규칙이다. `links_pending`은 **참조 그룹에만**
        * 넘긴다: 그 필드는 참조 추출의 완결 상태이고, 되돌림·체리픽·스택은 그
        * 상태에서도 이미 계산돼 있다 (CR-041, CR-042 DEV-258).
        */}
      <RelationSection
        repository={repository}
        kind="pull_request"
        id={String(prNumber)}
        sectionId="links"
        linksPending={pr.links_pending === true}
      />
      <CoChangeSection repository={repository} prNumber={prNumber} sectionId="cochanges" />


      <p>
        <a href={backHref} data-testid="back-link">
          검색으로 돌아가기
        </a>
      </p>
    </div>
  );
}
