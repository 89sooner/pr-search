'use client';

/**
 * W-021 실행 이력 — R0 최소 (WP-077 / FR-GH-012 AC-1·AC-3·AC-4, CR-086).
 *
 * ## 본인 것만 보인다
 *
 * 목록은 서버가 사용자 기준으로 거른다 (FR-GH-012 AC-3, THR-004). `security_officer`만 `all=true`로
 * 전체를 볼 수 있고, 그 스위치는 **역할이 있을 때만 그린다** — 없는 사람에게 스위치를 보여 주면
 * 「여기에 전체 이력이 있다」를 알려 주는 셈이다. 역할은 관문(`GuardedPage`)이 넘긴다.
 *
 * ## 「같은 구성으로 다시 실행」은 새 실행이다 (AC-4)
 *
 * 과거 실행의 invocation을 W-010의 초기값으로 넘길 뿐이다. 그 화면이 **새 미리보기와 새 실행**을
 * 만들고, 과거 승인이나 결과는 아무것도 승계하지 않는다.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Badge, Button, Panel, Table } from './ui';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { GhExecutionPanel } from './GhExecutionPanel';
import { formatTimestamp } from '../lib/format';
import { describeApiError, encodePrefill, isTerminal, loginPathOf, stateLabel, type ExecutionListResponse, type ExecutionView } from '../lib/gh';

const EXECUTIONS_URL = '/api/gh/executions';
const PAGE_SIZE = 50;
const POLL_MS = 1_000;

export interface GhHistoryViewProps {
  /** `security_officer`인가. 전체 보기 스위치를 그릴지만 정한다 — 판정은 서버가 한다. */
  readonly canSeeAll: boolean;
}

type ScreenState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'unauthenticated'; readonly loginPath: string | null }
  | { readonly kind: 'failed'; readonly message: string; readonly correlationId: string | null };

function listUrl(all: boolean, before: number | null): string {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (all) query.set('all', 'true');
  if (before !== null) query.set('before', String(before));
  return `${EXECUTIONS_URL}?${query.toString()}`;
}

export function GhHistoryView({ canSeeAll }: GhHistoryViewProps): ReactNode {
  const [screen, setScreen] = useState<ScreenState>({ kind: 'loading' });
  const [items, setItems] = useState<readonly ExecutionView[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const [selected, setSelected] = useState<ExecutionView | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<{ readonly message: string; readonly correlationId: string | null } | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => {
    setNonce((current) => current + 1);
  }, []);

  /* 첫 페이지. `all`이 바뀌면 처음부터 다시 읽는다. */
  useEffect(() => {
    const controller = new AbortController();
    setScreen({ kind: 'loading' });
    void (async () => {
      try {
        const response = await fetch(listUrl(all, null), { signal: controller.signal, cache: 'no-store' });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (response.status === 404) {
          setScreen({ kind: 'unavailable' });
          return;
        }
        if (response.status === 401) {
          setScreen({ kind: 'unauthenticated', loginPath: loginPathOf(body) });
          return;
        }
        if (!response.ok) {
          const shaped = describeApiError(body, "Unable to load history.");
          setScreen({ kind: 'failed', message: shaped.message, correlationId: shaped.correlationId });
          return;
        }
        const page = body as ExecutionListResponse;
        setItems(page.items);
        setNextBefore(page.next_before);
        setScreen({ kind: 'ready' });
      } catch (error) {
        if (controller.signal.aborted) return;
        void error;
        setScreen({ kind: 'failed', message: "Unable to connect to the server.", correlationId: null });
      }
    })();
    return () => {
      controller.abort();
    };
  }, [all, nonce]);

  const loadMore = useCallback(() => {
    if (nextBefore === null || loadingMore) return;
    setLoadingMore(true);
    void (async () => {
      try {
        const response = await fetch(listUrl(all, nextBefore), { cache: 'no-store' });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const shaped = describeApiError(body, "Unable to load the next page.");
          setActionError({ message: shaped.message, correlationId: shaped.correlationId });
          return;
        }
        const page = body as ExecutionListResponse;
        setItems((current) => [...current, ...page.items]);
        setNextBefore(page.next_before);
      } catch (error) {
        void error;
        setActionError({ message: "Unable to request the next page.", correlationId: null });
      } finally {
        setLoadingMore(false);
      }
    })();
  }, [all, nextBefore, loadingMore]);

  /* 고른 실행이 아직 끝나지 않았으면 끝날 때까지 상세를 폴링한다. */
  const selectedId = selected?.execution_id ?? null;
  const selectedDone = selected !== null && isTerminal(selected.state);
  useEffect(() => {
    if (selectedId === null || selectedDone) return;
    let closed = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(`${EXECUTIONS_URL}/${String(selectedId)}`, { cache: 'no-store' });
          if (!response.ok || closed) return;
          const view = (await response.json()) as ExecutionView;
          if (closed || view.execution_id !== selectedId) return;
          setSelected(view);
          setItems((current) => current.map((item) => (item.execution_id === view.execution_id ? view : item)));
        } catch (error) {
          void error;
        }
      })();
    }, POLL_MS);
    return () => {
      closed = true;
      window.clearInterval(timer);
    };
  }, [selectedId, selectedDone]);

  const onCancel = useCallback((id: number) => {
    setCancelling(true);
    setActionError(null);
    void (async () => {
      try {
        const response = await fetch(`${EXECUTIONS_URL}/${String(id)}/cancel`, { method: 'POST' });
        const body: unknown = await response.json().catch(() => null);
        if (response.status === 202) {
          const view = body as ExecutionView;
          setSelected(view);
          setItems((current) => current.map((item) => (item.execution_id === view.execution_id ? view : item)));
        } else {
          const shaped = describeApiError(body, "The cancellation request was rejected.");
          setActionError({ message: shaped.message, correlationId: shaped.correlationId });
        }
      } catch (error) {
        void error;
        setActionError({ message: "Unable to send the cancellation request.", correlationId: null });
      } finally {
        setCancelling(false);
      }
    })();
  }, []);

  if (screen.kind === 'unavailable') {
    return (
      <div data-testid="gh-history" data-state="unavailable">
        <EmptyState cause="not_found" title="GitHub operations are not enabled in this deployment" description="Execution history will appear here once an operator enables GH_OPERATIONS_ENABLED." />
      </div>
    );
  }
  if (screen.kind === 'unauthenticated') {
    const loginHref = screen.loginPath === null ? null : `${screen.loginPath}?return_to=${encodeURIComponent('/gh/history')}`;
    return (
      <div data-testid="gh-history" data-state="unauthenticated">
        <EmptyState cause="no_permission" title="Sign in required" description="You can view only your own execution history." actions={loginHref === null ? undefined : <Link href={loginHref}>Sign in</Link>} />
      </div>
    );
  }
  if (screen.kind === 'failed') {
    return (
      <div data-testid="gh-history" data-state="failed">
        <ErrorBanner
          tone="danger"
          title="Unable to load execution history"
          impact={screen.message}
          correlationId={screen.correlationId}
          action={
            <Button variant="secondary" onClick={refresh} data-testid="gh-history-retry">
              Refresh
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div data-testid="gh-history" data-state={screen.kind} className="prs-gh-history">
      {actionError === null ? null : (
        <ErrorBanner
          tone="danger"
          title="Unable to process the request"
          impact={actionError.message}
          correlationId={actionError.correlationId}
          action={
            <Button variant="secondary" onClick={() => setActionError(null)} data-testid="gh-history-dismiss-error">
              Close
            </Button>
          }
        />
      )}

      <Panel as="section" aria-label="Execution history" data-testid="section-history">
        <div className="prs-gh-execution-head">
          <h2>Execution history</h2>
          <div className="prs-gh-actions">
            {canSeeAll ? (
              <label className="prs-gh-json-field" htmlFor="gh-history-all">
                <input
                  id="gh-history-all"
                  type="checkbox"
                  data-testid="gh-history-all"
                  checked={all}
                  onChange={(event) => {
                    setSelected(null);
                    setAll(event.target.checked);
                  }}
                />
                Show executions for all users
              </label>
            ) : null}
            <Button variant="secondary" onClick={refresh} data-testid="gh-history-refresh">
              Refresh
            </Button>
          </div>
        </div>

        {screen.kind === 'loading' ? <p data-testid="gh-history-loading">Loading history…</p> : null}
        {screen.kind === 'ready' && items.length === 0 ? (
          <EmptyState cause="no_result" title="No commands have been run" description="Commands run from GitHub operations appear here." actions={<Link href="/gh">Go to GitHub operations</Link>} />
        ) : null}
        {items.length === 0 ? null : (
          <Table data-testid="gh-history-table" caption="Your execution history. Each result reflects the GHE response at execution time.">
            <thead>
              <tr>
                <th scope="col">Run</th>
                <th scope="col">capability</th>
                <th scope="col">Repository</th>
                <th scope="col">Status</th>
                <th scope="col">Requested</th>
                <th scope="col">Finished</th>
                <th scope="col">
                  <span className="ui-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.execution_id} data-testid="gh-history-row" data-state={item.state} aria-selected={selected?.execution_id === item.execution_id}>
                  <td>
                    <button
                      type="button"
                      data-testid="gh-history-select"
                      aria-pressed={selected?.execution_id === item.execution_id}
                      onClick={() => {
                        setSelected(item);
                      }}
                    >
                      #{String(item.execution_id)}
                    </button>
                  </td>
                  <td>
                    <code>{item.capability_id}</code>
                  </td>
                  <td>{item.repository ?? '—'}</td>
                  <td>
                    <Badge tone={item.state === 'succeeded' ? 'accent' : isTerminal(item.state) ? 'warning' : 'info'}>{stateLabel(item.state)}</Badge>
                  </td>
                  <td>{formatTimestamp(item.requested_at)}</td>
                  <td>{formatTimestamp(item.finished_at)}</td>
                  <td>
                    {item.invocation === undefined ? null : (
                      <Link href={`/gh?prefill=${encodePrefill(item.invocation)}`} data-testid="gh-history-rerun">
                        Run again with these settings
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {nextBefore === null ? null : (
          <Button variant="secondary" onClick={loadMore} disabled={loadingMore} data-testid="gh-history-more">
            {loadingMore ? "Loading…" : "Load earlier executions"}
          </Button>
        )}
      </Panel>

      {selected === null ? null : <GhExecutionPanel execution={selected} onCancel={onCancel} cancelling={cancelling} />}
    </div>
  );
}
