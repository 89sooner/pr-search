'use client';

/**
 * W-008 저장된 검색 (WP-033 / FR-SRCH-010, CR-049).
 *
 * ## 두 목록이 각자의 커서를 갖는다
 *
 * "내 검색"과 "팀 공유 검색"은 다른 집합이고 순회도 따로 간다. 한쪽의 더 보기가
 * 다른 쪽을 건드리면 사용자는 자기가 보던 위치를 잃는다 (C-016 사용 규칙).
 *
 * ## 커서가 거절되면 자동으로 다시 부르지 않는다
 *
 * 사유를 구분해 알리고 사용자가 첫 페이지 버튼을 누르게 한다. 조용히 첫
 * 페이지로 되돌리면 목록이 처음으로 돌아간 것만 보이고 이유를 모른다
 * (CR-043, DEV-273이 W-001에서 세운 규율과 같다).
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Panel, Spinner } from '@conductor-by-89soone/react';
import { CursorPager, toCursorFailure, type CursorFailure } from './CursorPager';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { SavedSearchList } from './SavedSearchList';
import { SaveSearchDialog, type SaveSearchEditTarget } from './SaveSearchDialog';
import {
  resolveSavedSearchState,
  type SavedSearchListView,
  type SavedSearchView,
} from '../lib/saved-search';

/**
 * 프록시 경로.
 *
 * **`/api/v1`이 아니다.** `app/api/[...path]/route.ts`가 세그먼트를 받아
 * `<upstream>/api/v1/<segments>`로 만든다 — 여기에 `v1`을 적으면
 * `/api/v1/v1/...`이 되어 404가 난다. `search-fetch.ts`가 `/api/search`를
 * 쓰는 것과 같은 규칙이다.
 */
const SAVED_SEARCHES_API = '/api/saved-searches';

interface ListState {
  /** 지금까지 쌓은 항목. `null`이면 아직 첫 응답이 없다. */
  readonly items: readonly SavedSearchView[] | null;
  readonly nextCursor: string | null;
  /** 지금 요청에 실을 커서. `null`이면 첫 페이지다. */
  readonly cursor: string | null;
  readonly failure: CursorFailure | null;
  readonly loadFailed: boolean;
  /**
   * 요청 세대.
   *
   * 커서만으로는 "다시 불러라"를 표현할 수 없다 — 이미 첫 페이지면 상태가
   * 달라지지 않아 조회 효과가 다시 돌지 않는다 (WP-032 PR #57 리뷰, DEV-332).
   */
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

const VIEW_LABEL: Readonly<Record<SavedSearchListView, string>> = {
  mine: '내 검색',
  team: '팀 공유 검색',
};

export interface SavedSearchesViewProps {
  readonly loginPath: string;
}

export function SavedSearchesView({ loginPath }: SavedSearchesViewProps): ReactNode {
  return (
    <div data-testid="saved-searches-view">
      <SavedSearchSection view="mine" loginPath={loginPath} />
      <SavedSearchSection view="team" loginPath={loginPath} />
    </div>
  );
}

interface SectionProps {
  readonly view: SavedSearchListView;
  readonly loginPath: string;
}

function SavedSearchSection({ view, loginPath }: SectionProps): ReactNode {
  const router = useRouter();
  const [state, setState] = useState<ListState>(FIRST_PAGE);
  const [loading, setLoading] = useState(true);
  const [unauthenticated, setUnauthenticated] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    const params = new URLSearchParams({ view });
    if (state.cursor !== null) params.set('cursor', state.cursor);

    void (async () => {
      try {
        const response = await fetch(`${SAVED_SEARCHES_API}?${params.toString()}`, {
          signal: controller.signal,
          cache: 'no-store',
        });

        if (response.status === 401) {
          setUnauthenticated(true);
          return;
        }

        const body = (await response.json()) as {
          items?: readonly SavedSearchView[];
          next_cursor?: string | null;
          error?: { code?: string };
        };

        if (!response.ok) {
          const failure = toCursorFailure(body.error?.code);
          if (failure !== null) {
            /*
             * **아무것도 다시 부르지 않는다.** 여기서 커서를 비우면 이 효과의
             * 의존값이 바뀌어 첫 페이지가 자동으로 다시 조회되고, 사용자는
             * 목록이 처음으로 돌아간 것만 보게 된다.
             */
            setState((current) => ({ ...current, failure }));
            return;
          }
          setState((current) => ({ ...current, loadFailed: true }));
          return;
        }

        const fetched = body.items ?? [];
        setState((current) => ({
          ...current,
          items: current.cursor === null ? fetched : [...(current.items ?? []), ...fetched],
          nextCursor: body.next_cursor ?? null,
          failure: null,
          loadFailed: false,
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        void error;
        setState((current) => ({ ...current, loadFailed: true }));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [view, state.cursor, state.nonce]);

  const loadMore = useCallback((cursor: string) => {
    setState((current) => ({ ...current, cursor, failure: null, nonce: current.nonce + 1 }));
  }, []);

  const backToFirst = useCallback(() => {
    setState((current) => ({ ...FIRST_PAGE, nonce: current.nonce + 1 }));
  }, []);

  const reload = useCallback(() => {
    setState((current) => ({ ...current, loadFailed: false, nonce: current.nonce + 1 }));
  }, []);

  const onRun = useCallback(
    async (item: SavedSearchView) => {
      const response = await fetch(
        `${SAVED_SEARCHES_API}/${String(item.saved_search_id)}/run`,
        { method: 'POST' },
      );
      if (!response.ok) {
        // 실행이 거절되면 목록을 다시 읽는다 — 그 사이에 무엇이 바뀌었을 수 있다.
        reload();
        return;
      }
      const body = (await response.json()) as { navigation_url?: string };
      /*
       * **서버가 준 주소로 간다.** 화면이 질의로 URL을 다시 만들면 부호화가
       * 어긋날 자리가 하나 늘어난다.
       */
      if (typeof body.navigation_url === 'string') router.push(body.navigation_url);
    },
    [reload, router],
  );

  const onDelete = useCallback(
    async (item: SavedSearchView) => {
      await fetch(`${SAVED_SEARCHES_API}/${String(item.saved_search_id)}`, { method: 'DELETE' });
      backToFirst();
    },
    [backToFirst],
  );

  /**
   * 「현재 에폭으로 다시 연결」 (CR-051, AC-8).
   *
   * **질의를 바꾸지 않고 에폭만 보낸다.** API 계약의 PATCH 다섯 경우 중
   * "질의는 그대로인데 `seq_epoch`이 왔다"에 해당하며, 서버가 그것을
   * 현재 값과 다시 대조한다 — 여기서 읽은 값과 쓰기 사이에 재채번이
   * 끼어들어도 안전한 이유다.
   *
   * `current_seq_epoch`이 없으면 부르지 않는다: `unavailable`이면 그 값이
   * 아예 응답에 없고, 그때 이 사람은 재연결할 수 있는 사람이 아니다.
   */
  const onRebindEpoch = useCallback(
    async (item: SavedSearchView) => {
      const current = item.sequence_reference?.current_seq_epoch;
      if (current === undefined) return;
      await fetch(`${SAVED_SEARCHES_API}/${String(item.saved_search_id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seq_epoch: current }),
      });
      backToFirst();
    },
    [backToFirst],
  );

  /**
   * 편집 대상 (PR #60 리뷰 P1).
   *
   * **W-001로 보내는 것은 편집이 아니었다.** 그 화면은 `POST`만 하므로 이름을
   * 바꿀 수도, 공개 범위를 고칠 수도, 무효가 된 질의를 되살릴 수도 없었다 —
   * 같은 이름으로 다시 저장하면 이름 충돌이 날 뿐이다. `W-008-EDIT`가 계약이
   * 정한 자리이며 `PATCH`가 그 경로다.
   */
  const [editTarget, setEditTarget] = useState<SaveSearchEditTarget | null>(null);

  const onEdit = useCallback((item: SavedSearchView) => {
    setEditTarget({
      saved_search_id: item.saved_search_id,
      name: item.name,
      query: item.query,
      visibility: item.visibility,
      team_id: item.target_team?.team_id ?? null,
      /*
       * 질의를 **실제로 고쳤을 때** 대화상자가 실을 에폭 (CR-051, PR #64 리뷰 P2).
       *
       * 없으면 `seq:` 검색에 필터 하나를 더하는 편집조차
       * `sequence_epoch_required`로 막힌다. 고친 질의는 **새로 바인딩**하는
       * 것이므로 대상은 현재 세대이며, 서버가 그 값을 다시 대조한다.
       * 저장소를 볼 수 없으면 값이 없고 그때는 서버가 404로 답한다 —
       * 그것이 정확한 답이다.
       */
      current_seq_epoch: item.sequence_reference?.current_seq_epoch ?? null,
    });
  }, []);

  const screen = resolveSavedSearchState({
    view,
    loading,
    resumed: state.cursor !== null,
    items: state.items,
    cursorFailed: state.failure !== null,
    loadFailed: state.loadFailed,
  });

  if (unauthenticated) {
    return (
      <Panel>
        <h2>{VIEW_LABEL[view]}</h2>
        <ErrorBanner
          tone="warning"
          title="다시 로그인해야 합니다"
          impact="세션이 만료되어 저장된 검색을 읽을 수 없습니다."
          action={<a href={loginPath}>로그인</a>}
        />
      </Panel>
    );
  }

  return (
    <Panel data-testid={`saved-${view}`}>
      <h2>{VIEW_LABEL[view]}</h2>
      <div data-testid={`saved-${view}-state`} data-screen-state={screen} />

      {screen === 'loading_initial' ? <Spinner label="저장된 검색을 불러오는 중" /> : null}

      {screen === 'error_load' ? (
        <ErrorBanner
          tone="danger"
          title="목록을 불러오지 못했습니다"
          impact="저장된 검색을 읽지 못했습니다. 지금까지 본 목록은 그대로 있습니다."
          action={
            <Button variant="secondary" onClick={reload} data-testid={`saved-${view}-retry`}>
              다시 시도
            </Button>
          }
        />
      ) : null}

      {screen === 'empty_no_saved' ? (
        <EmptyState
          cause="no_result"
          title="저장된 검색이 없습니다"
          description="통합 검색에서 조건을 만든 뒤 저장하면 여기에 나타납니다."
          actions={<a href="/search">통합 검색으로</a>}
        />
      ) : null}

      {screen === 'empty_no_shared' ? (
        <EmptyState
          cause="no_result"
          title="공유받은 검색이 없습니다"
          description="같은 팀 구성원이 팀 공유로 저장하면 여기에 나타납니다."
        />
      ) : null}

      {state.items !== null && state.items.length > 0 ? (
        <SavedSearchList
          items={state.items}
          onRun={(item) => {
            void onRun(item);
          }}
          onEdit={onEdit}
          onDelete={(item) => {
            void onDelete(item);
          }}
          onRebindEpoch={(item) => {
            void onRebindEpoch(item);
          }}
          testIdPrefix={`saved-${view}`}
        />
      ) : null}

      {screen === 'ready' || state.failure !== null ? (
        <CursorPager
          nextCursor={state.failure === null ? state.nextCursor : null}
          resumed={state.cursor !== null}
          loadedCount={state.items?.length ?? 0}
          loading={loading}
          onLoadMore={loadMore}
          onFirst={backToFirst}
          failure={state.failure}
        />
      ) : null}

      {screen === 'loading_more' ? (
        <Banner tone="info" title="이어 보는 중">
          <Spinner label="다음 페이지를 불러오는 중" />
        </Banner>
      ) : null}

      {editTarget === null ? null : (
        <SaveSearchDialog
          open
          onOpenChange={(next) => {
            if (!next) setEditTarget(null);
          }}
          query={editTarget.query}
          edit={editTarget}
          onSaved={() => {
            setEditTarget(null);
            // 고친 값이 목록에 보여야 한다 — 첫 페이지부터 다시 연다.
            backToFirst();
          }}
        />
      )}
    </Panel>
  );
}
