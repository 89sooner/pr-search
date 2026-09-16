'use client';

/**
 * A-001 수집 파이프라인 콘솔 (WP-040 / FR-ADMIN-001, FR-ING-007, FR-ING-010,
 * FR-ING-011, CR-052, CR-055).
 *
 * ## `archive_only`는 403을 숨기는 화면이 아니다 (DEV-375, QA-A001-14)
 *
 * `security_officer`이면서 `operator`가 아닌 사용자는 `A-001-ARCHIVE`만 본다.
 * **그 사용자를 위해 `operator` 전용 조회를 보내고 403을 숨기지 않는다** —
 * 역할을 먼저 판정해 요청 자체를 보내지 않는다. 403을 받아 숨기는 방식은
 * 권한 판정을 화면 뒤로 미루는 일이고, 감사 로그에 거절된 조회가 사용자
 * 수만큼 쌓인다.
 *
 * 그 판정은 `pipelineAccess`·`mayFetchOperatorData`가 소유한다 — 이 파일이
 * 역할 문자열을 직접 비교하지 않는 이유다.
 *
 * ## 폴링은 조작 중에 멈춘다 (QA-A001-09)
 *
 * `OpsJobsView`와 같은 규율이다. 타이머는 하나이고, 조작 중이거나 탭이 보이지
 * 않으면 그 회차를 건너뛴다.
 *
 * ## 아카이브 인덱스가 없어도 나머지는 돈다 (AC-3, QA-A001-13)
 *
 * 레인 B의 부재가 운영 콘솔을 막으면 두 레인의 독립이 조회 쪽에서 깨진다.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Panel, TextField } from './ui';
import { PipelineMetricGrid } from './PipelineMetricGrid';
import { DeadLetterTable, type DeadLetterItemView } from './DeadLetterTable';
import { ScanResultCard, type ScanResultView } from './ScanResultCard';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import {
  POLL_INTERVAL_MS,
  archiveState,
  mayFetchOperatorData,
  pipelineAccess,
  shouldPoll,
  type PipelineStatusView,
} from '../lib/ops-pipeline';
import type { JobView } from '../lib/ops-jobs';
import { formatTimestamp } from '../lib/format';

const STATUS_URL = '/api/admin/pipeline-status';
const DEAD_LETTER_URL = '/api/admin/dead-letters';
const REPROCESS_URL = '/api/admin/dead-letters/reprocess';
const JOBS_URL = '/api/admin/jobs';
const RAW_EVENTS_URL = '/api/admin/raw-events';

interface ArchiveResult {
  readonly items: readonly {
    readonly delivery_id: string;
    readonly event_type: string;
    readonly action: string | null;
    readonly repository: string | null;
    readonly received_at: string;
    readonly payload?: unknown;
  }[];
  readonly indexAvailable: boolean;
}

export interface OpsPipelineViewProps {
  /** 세션의 역할. 서버가 관문에서 넘긴다. 화면이 이 값을 다시 만들지 않는다. */
  readonly roles: readonly string[];
  /** 인증이 구성된 배포인가. 빈 역할의 뜻이 이 값에 달려 있다. */
  readonly authEnabled?: boolean;
}

export function OpsPipelineView({ roles, authEnabled = true }: OpsPipelineViewProps): ReactNode {
  const access = pipelineAccess(roles, authEnabled);
  const mayFetch = mayFetchOperatorData(access);

  const [status, setStatus] = useState<PipelineStatusView | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [deadLetters, setDeadLetters] = useState<readonly DeadLetterItemView[] | null>(null);
  const [deadLetterTotal, setDeadLetterTotal] = useState<number | null>(null);
  const [deadLetterFailed, setDeadLetterFailed] = useState(false);
  const [scanJob, setScanJob] = useState<JobView | null>(null);
  const [archive, setArchive] = useState<ArchiveResult | null>(null);
  const [archiveQuery, setArchiveQuery] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [conflictJobId, setConflictJobId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const interacting = useRef(false);
  const refresh = useCallback(() => {
    setNonce((current) => current + 1);
  }, []);

  useEffect(() => {
    if (access === 'none') {
      setLoading(false);
      return;
    }
    const controller = new AbortController();

    void (async () => {
      setLoading(true);
      try {
        /*
         * **역할을 먼저 본다.** `archive_only`에서는 아래 세 요청이 아예
         * 만들어지지 않는다 — 403을 받아 숨기는 것이 아니라 보내지 않는다.
         */
        if (!mayFetch) return;

        const [statusResponse, dlqResponse, jobsResponse] = await Promise.all([
          fetch(STATUS_URL, { signal: controller.signal, cache: 'no-store' }),
          fetch(DEAD_LETTER_URL, { signal: controller.signal, cache: 'no-store' }),
          fetch(JOBS_URL, { signal: controller.signal, cache: 'no-store' }),
        ]);

        if (statusResponse.ok) {
          setStatus((await statusResponse.json().catch(() => null)) as PipelineStatusView | null);
          setStatusFailed(false);
        } else {
          setStatusFailed(true);
        }

        if (dlqResponse.ok) {
          const body = (await dlqResponse.json().catch(() => null)) as {
            items?: readonly DeadLetterItemView[];
            total?: number;
          } | null;
          setDeadLetters(body?.items ?? []);
          setDeadLetterTotal(body?.total ?? null);
          setDeadLetterFailed(false);
        } else {
          setDeadLetterFailed(true);
        }

        if (jobsResponse.ok) {
          const body = (await jobsResponse.json().catch(() => null)) as { items?: readonly JobView[] } | null;
          const latest = (body?.items ?? []).find((job) => job.type === 'reconcile');
          setScanJob(latest ?? null);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          void error;
          setStatusFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [nonce, access, mayFetch]);

  useEffect(() => {
    if (typeof window === 'undefined' || !mayFetch) return;

    const timer = window.setInterval(() => {
      const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
      if (!shouldPoll({ interacting: interacting.current, visible })) return;
      refresh();
    }, POLL_INTERVAL_MS);

    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && !interacting.current) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, mayFetch]);

  const onReprocess = useCallback(
    (ids: readonly number[]) => {
      if (ids.length === 0) return;
      setSubmitting(true);
      setActionError(null);
      void (async () => {
        try {
          const response = await fetch(REPROCESS_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ dead_letter_ids: [...ids] }),
          });
          if (!response.ok) setActionError("The replay request was rejected.");
        } catch (error) {
          void error;
          setActionError("Unable to send the replay request.");
        } finally {
          setSubmitting(false);
          refresh();
        }
      })();
    },
    [refresh],
  );

  const onRunScan = useCallback(() => {
    setSubmitting(true);
    setConflictJobId(null);
    setActionError(null);
    void (async () => {
      try {
        const response = await fetch(JOBS_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // `reconcile`은 대상을 보내지 않는다 — 서버가 `all`을 쓴다.
          body: JSON.stringify({ type: 'reconcile' }),
        });
        if (response.status === 409) {
          const body = (await response.json().catch(() => null)) as {
            error?: { detail?: Record<string, unknown> };
          } | null;
          const existing = body?.error?.detail?.['job_id'];
          setConflictJobId(typeof existing === 'number' ? existing : -1);
          return;
        }
        if (!response.ok) setActionError("Unable to start the reconciliation scan.");
      } catch (error) {
        void error;
        setActionError("Unable to request a reconciliation scan.");
      } finally {
        setSubmitting(false);
        refresh();
      }
    })();
  }, [refresh]);

  const onArchiveSearch = useCallback(() => {
    setActionError(null);
    void (async () => {
      try {
        const params = new URLSearchParams();
        if (archiveQuery.trim() !== '') params.set('delivery_id', archiveQuery.trim());
        const response = await fetch(`${RAW_EVENTS_URL}?${params.toString()}`, { cache: 'no-store' });
        if (!response.ok) {
          setActionError("Unable to load the payload archive.");
          return;
        }
        const body = (await response.json().catch(() => null)) as {
          items?: ArchiveResult['items'];
          index_available?: boolean;
        } | null;
        setArchive({ items: body?.items ?? [], indexAvailable: body?.index_available !== false });
        setExpanded(new Set());
      } catch (error) {
        void error;
        setActionError("Unable to query the payload archive.");
      }
    })();
  }, [archiveQuery]);

  if (access === 'none') {
    return (
      <div data-testid="ops-pipeline-view" data-state="no_permission">
        <EmptyState
          cause="no_permission"
          title="The operator or security_officer role is required"
          description="Security officers can access only the payload archive section."
        />
      </div>
    );
  }

  const archiveView =
    archive === null
      ? null
      : archiveState({ indexMissing: !archive.indexAvailable, itemCount: archive.items.length });

  return (
    <div
      data-testid="ops-pipeline-view"
      data-state={access === 'archive_only' ? 'archive_only' : loading && status === null ? 'loading_initial' : 'ready'}
      data-access={access}
      onPointerEnter={() => {
        interacting.current = true;
      }}
      onPointerLeave={() => {
        interacting.current = false;
      }}
      onFocusCapture={() => {
        interacting.current = true;
      }}
      onBlurCapture={() => {
        interacting.current = false;
      }}
    >
      {actionError === null ? null : (
        <ErrorBanner tone="danger" title="Unable to process the request" impact={actionError} />
      )}

      {/*
        **`archive_only`에서는 이 세 섹션이 렌더링되지 않는다.** 숨기는 것이
        아니라 만들지 않는다 — 위의 조회 효과도 같은 판정으로 요청을 보내지
        않으므로, 두 판정이 한 함수(`mayFetchOperatorData`)에서 나온다.
      */}
      {mayFetch ? (
        <>
          <Panel as="section" aria-label="Stage metrics" data-testid="section-metrics">
            <h2>Stage metrics</h2>
            <PipelineMetricGrid metrics={status} failed={statusFailed} />
          </Panel>

          <Panel as="section" aria-label="Dead-letter queue" data-testid="section-dlq">
            <h2>Dead-letter queue</h2>
            {deadLetterFailed ? (
              <ErrorBanner
                tone="warning"
                title="Unable to load the dead-letter queue"
                impact="Other sections remain available."
              />
            ) : (
              <DeadLetterTable
                items={deadLetters ?? []}
                total={deadLetterTotal}
                onReprocess={onReprocess}
                submitting={submitting}
              />
            )}
          </Panel>

          <section aria-label="Reconciliation scan" data-testid="section-scan">
            <ScanResultCard
              result={
                status === null
                  ? null
                  : ({
                      last_scanned_at: null,
                      missing_count: null,
                      repositories_scanned: null,
                      deferred_count: null,
                    } satisfies ScanResultView)
              }
              job={scanJob}
              onRun={onRunScan}
              submitting={submitting}
              conflictJobId={conflictJobId}
            />
          </section>
        </>
      ) : null}

      <Panel as="section" aria-label="Payload archive" data-testid="section-archive">
        <h2>Payload archive</h2>
        <div>
          <TextField
            aria-label="Delivery ID"
            data-testid="archive-query"
            value={archiveQuery}
            placeholder="Delivery ID"
            onChange={(event) => {
              setArchiveQuery(event.target.value);
            }}
          />
          <Button data-testid="archive-search" onClick={onArchiveSearch}>
            Load
          </Button>
        </div>

        {archiveView === 'archive_unavailable' ? (
          <p data-testid="archive-unavailable">
            The payload archive index is unavailable. There may be no events yet, or retention has expired. Other sections remain available.
          </p>
        ) : archiveView === 'archive_scope_empty' ? (
          <p data-testid="archive-empty">No payloads match these filters.</p>
        ) : archive === null ? (
          <p data-testid="archive-idle">Look up an original event by delivery ID.</p>
        ) : (
          <ul data-testid="archive-items">
            {archive.items.map((item) => (
              <li key={item.delivery_id} data-testid="archive-row">
                <p>
                  {item.delivery_id} · {item.event_type}
                  {item.action === null ? '' : `.${item.action}`} · {formatTimestamp(item.received_at)}
                </p>
                {/*
                  **`payload`는 기본으로 접혀 있다** (THR-044). 펼치는 것이
                  명시적 열람이며 감사 기록에 남는다 — 목록 조회가 자동으로
                  펼치면 조회 한 번이 모든 원본의 열람이 된다.
                */}
                {expanded.has(item.delivery_id) ? (
                  <pre data-testid="archive-payload">{JSON.stringify(item.payload ?? null, null, 2)}</pre>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid="archive-expand"
                    onClick={() => {
                      setExpanded((current) => new Set(current).add(item.delivery_id));
                    }}
                  >
                    Expand payload
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
