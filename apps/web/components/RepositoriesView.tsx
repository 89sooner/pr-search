'use client';

/**
 * W-009 저장소 개요 (WP-034 / FR-ING-009 AC-6~10, CR-050).
 *
 * ## 이 화면이 답하는 물음
 *
 * "왜 이 저장소 결과가 없는가" — 권한이 없는가, 등록되지 않았는가, 수집이
 * 늦는가. 셋을 구분해 보여 주는 것이 목적이고, 그래서 `null`·`0`·`unavailable`을
 * 같은 문구로 그리지 않는다.
 *
 * ## 커서가 거절되면 자동으로 다시 부르지 않는다
 *
 * 사유를 구분해 알리고 사용자가 첫 페이지 버튼을 누르게 한다. 조용히 되돌리면
 * 목록이 처음으로 간 것만 보이고 이유를 모른다 (CR-043 DEV-273이 W-001에서
 * 세운 규율).
 *
 * ## 실행 액션이 없다
 *
 * 등록·해제·백필·재채번은 A-002·A-003의 몫이다. 여기서 할 수 있는 것은 조회와
 * 등록 검토 요청뿐이다.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Banner, Button, Panel, Spinner } from '@conductor-by-89soone/react';
import { CursorPager, toCursorFailure, type CursorFailure } from './CursorPager';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { RepositoryCardGrid } from './RepositoryCardGrid';
import { RegisterRequestDialog } from './RegisterRequestDialog';
import {
  EMPTY_NO_REPOSITORY_MESSAGE,
  resolveOverviewState,
  type RepositoryOverview,
} from '../lib/repository-overview';

/** `/api/v1`을 적으면 프록시가 `/api/v1/v1/...`을 만든다. */
const REPOSITORIES_API = '/api/repositories';

interface ListState {
  readonly items: readonly RepositoryOverview[] | null;
  readonly nextCursor: string | null;
  readonly cursor: string | null;
  readonly failure: CursorFailure | null;
  readonly loadFailed: boolean;
  /** 커서만으로는 "다시 불러라"를 표현할 수 없다 (WP-032 DEV-332). */
  readonly nonce: number;
}

const FIRST_PAGE: ListState = {
  items: null,
  nextCursor: null,
  cursor: null,
  failure: null,
  loadFailed: false,
  nonce: 0,
};

export interface RepositoriesViewProps {
  readonly loginPath: string;
  /** 딥링크가 실어 온 저장소. 목록을 좁히고 요청 폼을 미리 채운다. */
  readonly repositoryFilter?: string | null;
}

export function RepositoriesView({
  loginPath,
  repositoryFilter = null,
}: RepositoriesViewProps): ReactNode {
  const [state, setState] = useState<ListState>(FIRST_PAGE);
  const [loading, setLoading] = useState(true);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [recorded, setRecorded] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    const params = new URLSearchParams();
    if (state.cursor !== null) params.set('cursor', state.cursor);
    if (repositoryFilter !== null && repositoryFilter !== '') {
      params.set('repository', repositoryFilter);
    }

    void (async () => {
      try {
        const query = params.toString();
        const response = await fetch(query === '' ? REPOSITORIES_API : `${REPOSITORIES_API}?${query}`, {
          signal: controller.signal,
          cache: 'no-store',
        });

        if (response.status === 401) {
          setUnauthenticated(true);
          return;
        }

        const body = (await response.json()) as {
          items?: readonly RepositoryOverview[];
          next_cursor?: string | null;
          error?: { code?: string };
        };

        if (!response.ok) {
          const failure = toCursorFailure(body.error?.code);
          if (failure !== null) {
            // 여기서 커서를 비우면 첫 페이지가 자동으로 다시 조회된다.
            setState((current) => ({ ...current, failure }));
            return;
          }
          setState((current) => ({ ...current, loadFailed: true }));
          return;
        }

        setState((current) => ({
          ...current,
          items:
            current.cursor === null ? (body.items ?? []) : [...(current.items ?? []), ...(body.items ?? [])],
          nextCursor: body.next_cursor ?? null,
          failure: null,
          loadFailed: false,
        }));
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') return;
        setState((current) => ({ ...current, loadFailed: true }));
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [state.cursor, state.nonce, repositoryFilter]);

  const loadMore = useCallback((cursor: string) => {
    setState((current) => ({ ...current, cursor, failure: null }));
  }, []);

  const first = useCallback(() => {
    setState((current) => ({ ...FIRST_PAGE, nonce: current.nonce + 1 }));
  }, []);

  /**
   * 카드 하나만 다시 확인한다.
   *
   * 그 저장소로 좁힌 조회를 새 창에서 여는 대신 **같은 화면의 필터**로 보낸다 —
   * 계약이 `repository=` 완전 일치를 그 용도로 두었다.
   */
  const retry = useCallback((repository: string) => {
    window.location.href = `/repositories?repository=${encodeURIComponent(repository)}`;
  }, []);

  if (unauthenticated) {
    return (
      <Banner tone="warning" data-testid="repositories-auth-expired">
        세션이 만료되었습니다. <a href={loginPath}>다시 로그인</a>하세요.
      </Banner>
    );
  }

  const screen = resolveOverviewState({
    loading,
    resumed: state.cursor !== null,
    items: state.items,
    cursorFailed: state.failure !== null,
    loadFailed: state.loadFailed,
  });

  return (
    <Panel data-testid="repositories-view" data-state={screen}>
      {recorded === null ? null : (
        <Banner tone="info" data-testid="register-request-recorded">
          {recorded} 등록 검토 요청을 기록했습니다. 운영자가 검토합니다.
        </Banner>
      )}

      <Button
        onClick={() => {
          setRequestOpen(true);
        }}
        data-testid="open-register-request"
      >
        저장소 등록 요청
      </Button>

      {screen === 'error_load' ? (
        <ErrorBanner
          tone="warning"
          title="저장소 목록을 불러오지 못했습니다"
          impact="다시 시도하면 목록을 받을 수 있습니다."
          action={
            <Button variant="secondary" onClick={first} data-testid="repositories-retry">
              다시 시도
            </Button>
          }
          recoverable
        />
      ) : null}

      {screen === 'loading_initial' ? <Spinner label="저장소 목록을 불러오는 중" /> : null}

      {screen === 'empty_no_repository' ? (
        <EmptyState
          cause="not_indexed"
          title="표시할 등록 저장소가 없습니다"
          description={EMPTY_NO_REPOSITORY_MESSAGE}
          actions={
            <Button
              onClick={() => {
                setRequestOpen(true);
              }}
              data-testid="empty-register-request"
            >
              등록 검토 요청
            </Button>
          }
        />
      ) : null}

      {state.items !== null && state.items.length > 0 ? (
        <RepositoryCardGrid repositories={state.items} onRetry={retry} />
      ) : null}

      {state.items !== null && state.items.length > 0 ? (
        <CursorPager
          nextCursor={state.nextCursor}
          resumed={state.cursor !== null}
          loadedCount={state.items.length}
          loading={loading}
          onLoadMore={loadMore}
          onFirst={first}
          failure={state.failure}
        />
      ) : null}

      <RegisterRequestDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        initialRepository={repositoryFilter ?? ''}
        onRecorded={(repository) => {
          setRecorded(repository);
        }}
      />
    </Panel>
  );
}
