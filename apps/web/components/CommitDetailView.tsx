'use client';

/**
 * W-003 커밋 상세 (WP-018 / FLOW-002, 상태 매트릭스 W-003).
 *
 * 판정은 `lib/commit-detail.ts`와 `lib/screen-state.ts`가 한다. 이 파일은
 * 그 결과를 그리고 조회와 재조회를 붙인다 — W-002와 같은 구조다.
 *
 * ## 진입 시 무엇을 부르는가
 *
 * **커밋 문서 하나뿐이다.** 그 응답이 소속 PR까지 담아 온다(서버가 조인한다).
 * 릴리스·관계는 각각 WP-024·WP-031이라 부를 것이 없다.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, Banner, Button, Panel } from '@conductor-by-89soone/react';
import { ChangedPathList } from './ChangedPathList';
import { EmptyState } from './EmptyState';
import { EntityHeader } from './EntityHeader';
import { ErrorBanner } from './ErrorBanner';
import { LinkedPrList } from './LinkedPrList';
import { PendingSection } from './PendingSection';
import { ReleaseContainmentSection } from './ReleaseContainmentList';
import { NeighborSection } from './NeighborSequenceList';
import { SequencePosition } from './SequencePosition';
import { ShaChip } from './ShaChip';
import {
  changedPathModel,
  commitTitle,
  gheCommitUrl,
  hasCommitMetadata,
  landedAsCommitSha,
  linkedPrState,
  roleLabel,
  sequencePositionState,
  type CommitDetailSource,
} from '../lib/commit-detail';
import { searchBackHref } from '../lib/pr-detail';
import { resolveDetailScreenState, type DetailStateInput } from '../lib/screen-state';

export interface CommitDetailViewProps {
  readonly repository: string;
  readonly commitSha: string;
  readonly loginPath: string;
  readonly gheBaseUrl?: string;
  readonly fromQuery?: string;
}

interface Outcome {
  readonly detail: CommitDetailSource | null;
  readonly errorBody: DetailStateInput['errorBody'];
  readonly status: number | null;
  readonly networkFailed: boolean;
}

const IDLE: Outcome = { detail: null, errorBody: null, status: null, networkFailed: false };

export function CommitDetailView({
  repository,
  commitSha,
  loginPath,
  gheBaseUrl,
  fromQuery,
}: CommitDetailViewProps): ReactNode {
  const [outcome, setOutcome] = useState<Outcome>(IDLE);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    const controller = new AbortController();
    setLoading(true);

    const url = `/api/commits/${encodeURIComponent(repository)}/${commitSha}`;

    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        const body: unknown = await response.json();
        if (mine !== generation.current) return;

        setOutcome(
          response.ok
            ? { ...IDLE, detail: body as CommitDetailSource, status: response.status }
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
  }, [repository, commitSha, nonce]);

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
      <div data-testid="commit-detail" data-screen-state="loading_initial">
        <Panel as="section" aria-busy="true" data-testid="detail-skeleton">
          <p>불러오는 중…</p>
        </Panel>
      </div>
    );
  }

  if (screen.kind === 'not_found') {
    return (
      <div data-testid="commit-detail" data-screen-state="not_found">
        {/*
         * **존재 여부를 드러내지 않는다** (QA-W002-18과 같은 규칙,
         * FR-AUTH-002 AC-4). W-002와 문구까지 같아야 한다 — 다르면 그 차이
         * 자체가 신호가 된다.
         */}
        <EmptyState
          cause="not_found"
          description="이 커밋을 찾을 수 없습니다. SHA가 정확한지 확인하세요."
          actions={<a href={backHref}>검색으로 돌아가기</a>}
        />
      </div>
    );
  }

  if (screen.kind === 'no_permission') {
    return (
      <div data-testid="commit-detail" data-screen-state="no_permission">
        <EmptyState cause="no_permission" />
      </div>
    );
  }

  if (screen.kind === 'auth_expired') {
    return (
      <div data-testid="commit-detail" data-screen-state="auth_expired">
        <ErrorBanner
          tone="warning"
          title="세션이 만료되었습니다"
          impact="다시 로그인하면 보던 화면으로 돌아옵니다."
          action={
            <a href={`${screen.loginPath}?return_to=${encodeURIComponent(`/commit/${repository}/${commitSha}`)}`}>
              다시 로그인
            </a>
          }
        />
      </div>
    );
  }

  if (screen.kind === 'offline') {
    return (
      <div data-testid="commit-detail" data-screen-state="offline">
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
      <div data-testid="commit-detail" data-screen-state="error_other">
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

  const commit = outcome.detail ?? {};
  const sha = commit.commit_sha ?? commitSha;
  const repo = commit.repository ?? repository;
  const role = roleLabel(commit.role);
  const seqState = sequencePositionState(commit);
  const paths = changedPathModel(commit);

  return (
    <div data-testid="commit-detail" data-screen-state="ready">
      <EntityHeader
        kind="commit"
        /*
         * **표시명은 축약 SHA다** (CR-021, DEV-090). 소속 PR의 제목으로
         * 대체하지 않는다 — 한 PR의 원본 커밋 N건이 전부 같은 제목이 되고,
         * 체리픽·되돌림 조사가 정확히 반대의 결론에 이른다.
         */
        title={commitTitle(commit)}
        identifier={`${repo} · ${sha.slice(0, 12)}`}
        externalUrl={gheCommitUrl(gheBaseUrl, repo, sha)}
        badges={
          <>
            <Badge tone={role.known ? 'accent' : 'neutral'} data-testid="role-badge">
              {role.text}
            </Badge>
            <ShaChip commitSha={sha} />
          </>
        }
      />

      {commit.repository_archived === true ? (
        <Banner tone="warning" title="보관된 저장소">
          <p>이 저장소는 보관되어 더 이상 갱신되지 않습니다.</p>
        </Banner>
      ) : null}

      {/*
       * 커밋 자체의 메타데이터가 통째로 없다 (DEV-060). **비워 두지 않고
       * 왜 없는지 적는다** — 빈 자리는 버그로 읽힌다.
       */}
      {hasCommitMetadata(commit) ? (
        <Panel as="section" aria-labelledby="commit-meta-heading" data-testid="commit-meta">
          <h2 id="commit-meta-heading">커밋</h2>
          <dl>
            <dt>메시지</dt>
            <dd>{commit.message ?? '—'}</dd>
            <dt>작성자</dt>
            <dd>{commit.author ?? '—'}</dd>
            <dt>작성 시각</dt>
            <dd>{commit.authored_at ?? '—'}</dd>
          </dl>
        </Panel>
      ) : (
        <Panel as="section" aria-labelledby="commit-meta-heading" data-testid="commit-meta-missing">
          <h2 id="commit-meta-heading">
            커밋 <Badge tone="neutral">준비 중</Badge>
          </h2>
          <p>
            메시지·작성자·작성 시각은 아직 수집하지 않았습니다. 수집 이벤트가 커밋에 대해 SHA만
            나릅니다. 이 화면은 SHA를 이름으로 씁니다.
          </p>
          <p>
            <span className="cdt-sr-only">담당 작업 패키지: </span>
            WP-020 (미러 기반 커밋 보강)
          </p>
        </Panel>
      )}

      <LinkedPrList
        state={linkedPrState(commit)}
        pullRequests={commit.pull_requests ?? []}
        enrichmentPending={commit.enrichment_pending === true}
        onRefetch={refetch}
        refetching={loading}
      />

      <SequencePosition
        state={seqState}
        mergeSeq={commit.merge_seq ?? null}
        seqEpoch={commit.seq_epoch ?? null}
        sequenceSpace={commit.sequence_space ?? null}
        landedAs={landedAsCommitSha(commit)}
        repository={repo}
      />

      {/*
        * 앞뒤 인접 항목 (WP-027, CR-031 DEV-163). **앵커는 커밋 SHA다** — 직접
        * 푸시 커밋은 PR이 없어 PR 번호로 자기 위치를 물을 수 없다.
        *
        * 체인 밖(`off_chain`)과 미채번(`not_computed`)은 **역할로 이미 아는
        * 사실**이므로 조회하지 않는다 (DEV-092). 서버는 그 둘을 가릴 수 없다.
        */}
      <NeighborSection
        repository={repo}
        sectionId="commit-neighbors"
        anchor={{ kind: 'commit', commitSha: commit.commit_sha ?? commitSha }}
        baseBranch={commit.base_branch ?? null}
        documentEpoch={commit.seq_epoch ?? null}
        {...(seqState === 'assigned'
          ? {}
          : {
              skip:
                seqState === 'off_chain'
                  ? { reason: null, offChain: true }
                  : { reason: 'not_sequenced' as const },
            })}
      />

      <ChangedPathList {...paths} owner="WP-020 (미러 기반 커밋 보강)" />

      <ReleaseContainmentSection repository={repo} kind="commit" id={sha} sectionId="commit-releases" />
      <PendingSection
        id="commit-links"
        title="관계"
        reason="되돌림·체리픽·참조는 관계 파생이 서면 표시됩니다."
        owner="WP-029 (관계 파생), WP-031 (관계 조회)"
      />

      <p>
        <a href={backHref} data-testid="back-link">
          검색으로 돌아가기
        </a>
      </p>
    </div>
  );
}
