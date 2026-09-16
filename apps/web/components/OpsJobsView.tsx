'use client';

/**
 * A-003 인덱스·잡 운영 (WP-040 / FR-ADMIN-002·003, FR-ING-006·008, CR-055).
 *
 * ## 판정을 다시 만들지 않는다
 *
 * 제어 가능 여부는 서버의 `allowed_actions`가, 역할은 `API-ADM-*`가 강제한다.
 * 화면이 그것을 흉내 내면 두 판정이 갈라지고 **갈라진 쪽이 느슨하면 그것이 곧
 * 우회 경로다** (`AuditView`가 같은 자리에서 같은 판단을 했다).
 *
 * ## 폴링은 조작 중에 멈춘다 (QA-A001-09)
 *
 * 30초 주기로 갱신하되 표를 조작하는 중이면 보류한다 — 스크롤과 선택이
 * 초기화되면 운영자가 방금 본 행을 잃는다. **백그라운드 탭에서도 보류하고**,
 * 복귀하면 한 번 읽은 뒤 정상 주기로 잇는다. 타이머를 겹쳐 쌓지 않는 것이
 * 요점이다 — 겹치면 탭을 오갈수록 호출이 는다.
 *
 * ## 섹션 하나의 실패가 화면을 무너뜨리지 않는다
 *
 * 인덱스 상태를 읽지 못해도 잡 목록과 실행 폼은 계속 돈다 (`partial_failure`).
 * 값 하나를 못 읽었다고 나머지를 숨기면 그 화면이 알려 줄 수 있었던 사실까지
 * 사라진다.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Panel } from './ui';
import { JobTable } from './JobTable';
import { JobRunForm, type JobRunSubmission } from './JobRunForm';
import { IndexStatusPanel } from './IndexStatusPanel';
import { IntegrityReportCard, type IntegrityReportView, type ReassignImpactView } from './IntegrityReportCard';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { POLL_INTERVAL_MS, shouldPoll } from '../lib/ops-pipeline';
import type { IndexStatusView, JobControl, JobView } from '../lib/ops-jobs';

const JOBS_URL = '/api/admin/jobs';
const INDEX_STATUS_URL = '/api/admin/reindex';
const INTEGRITY_URL = '/api/admin/sequence-integrity';

interface Section<T> {
  readonly data: T | null;
  /** 이 섹션만의 실패. 다른 섹션은 계속 돈다. */
  readonly failed: boolean;
}

const EMPTY = { data: null, failed: false } as const;

interface IntegrityPayload {
  readonly reports: readonly IntegrityReportView[];
  readonly impacts: Readonly<Record<string, ReassignImpactView>>;
}

/** 응답에서 목록을 꺼낸다. 모양이 다르면 빈 목록이며 실패로 세지 않는다. */
function itemsOf<T>(body: unknown, key: string): readonly T[] {
  if (typeof body !== 'object' || body === null) return [];
  const value = (body as Record<string, unknown>)[key];
  return Array.isArray(value) ? (value as readonly T[]) : [];
}

export function OpsJobsView(): ReactNode {
  const [jobs, setJobs] = useState<Section<readonly JobView[]>>(EMPTY);
  const [indexStatus, setIndexStatus] = useState<Section<IndexStatusView>>(EMPTY);
  const [integrity, setIntegrity] = useState<Section<IntegrityPayload>>(EMPTY);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  /** 서버가 받고 있는 잡. 그 행의 버튼만 잠근다. */
  const [pendingJobId, setPendingJobId] = useState<number | null>(null);
  const [runSubmitting, setRunSubmitting] = useState(false);
  const [reassignSubmitting, setReassignSubmitting] = useState(false);
  const [conflictJobId, setConflictJobId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * 조작 중인가.
   *
   * `ref`인 것은 이 값이 **폴링 효과를 다시 세우면 안 되기** 때문이다 —
   * 상태로 두면 마우스가 표에 들어올 때마다 타이머가 새로 서고, 그러면
   * 30초 간격이 조작할 때마다 처음부터 다시 세어진다.
   */
  const interacting = useRef(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => {
    setNonce((current) => current + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const load = async <T,>(url: string, apply: (body: unknown) => T): Promise<Section<T>> => {
      try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (response.status === 403 || response.status === 401) {
          setDenied(true);
          return { data: null, failed: false };
        }
        if (!response.ok) return { data: null, failed: true };
        const body: unknown = await response.json().catch(() => null);
        return { data: apply(body), failed: false };
      } catch (error) {
        if (controller.signal.aborted) throw error;
        void error;
        return { data: null, failed: true };
      }
    };

    void (async () => {
      setLoading(true);
      try {
        /*
         * 셋을 **함께** 부른다. 순서대로 부르면 앞의 실패가 뒤를 막고, 그것은
         * "섹션 하나의 실패가 화면을 무너뜨리지 않는다"와 어긋난다.
         */
        const [jobsSection, indexSection, integritySection] = await Promise.all([
          load(JOBS_URL, (body) => itemsOf<JobView>(body, 'items')),
          load(INDEX_STATUS_URL, (body) => body as IndexStatusView),
          load(INTEGRITY_URL, (body) => {
            const reports = itemsOf<IntegrityReportView>(body, 'reports');
            const impacts =
              typeof body === 'object' && body !== null
                ? ((body as Record<string, unknown>)['impacts'] as IntegrityPayload['impacts'] | undefined)
                : undefined;
            return { reports, impacts: impacts ?? {} };
          }),
        ]);

        if (controller.signal.aborted) return;
        setJobs(jobsSection);
        setIndexStatus(indexSection);
        setIntegrity(integritySection);
      } catch (error) {
        if (!controller.signal.aborted) void error;
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [nonce]);

  /*
   * 30초 폴링. **타이머는 하나뿐이다.** 조작 중이거나 탭이 보이지 않으면
   * 그 회차를 건너뛴다 — 타이머를 멈췄다 다시 세우면 복귀할 때마다 간격이
   * 초기화되고, 겹쳐 세우면 탭을 오갈수록 호출이 는다.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const timer = window.setInterval(() => {
      const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
      if (!shouldPoll({ interacting: interacting.current, visible })) return;
      refresh();
    }, POLL_INTERVAL_MS);

    // 탭으로 돌아오면 한 번 읽고 정상 주기로 잇는다.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && !interacting.current) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const onAction = useCallback(
    (jobId: number, action: JobControl) => {
      setPendingJobId(jobId);
      setActionError(null);
      void (async () => {
        try {
          const response = await fetch(`${JOBS_URL}/${String(jobId)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action }),
          });
          if (!response.ok) {
            setActionError(`Job ${String(jobId)}:${action} request was rejected.`);
          }
        } catch (error) {
          void error;
          setActionError(`Job ${String(jobId)}:${action} request could not be sent.`);
        } finally {
          setPendingJobId(null);
          refresh();
        }
      })();
    },
    [refresh],
  );

  const onRun = useCallback(
    (submission: JobRunSubmission) => {
      setRunSubmitting(true);
      setConflictJobId(null);
      setActionError(null);
      void (async () => {
        try {
          const response = await fetch(submission.option.path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(submission.body),
          });
          if (response.status === 409) {
            const body: unknown = await response.json().catch(() => null);
            const detail =
              typeof body === 'object' && body !== null
                ? ((body as Record<string, unknown>)['error'] as Record<string, unknown> | undefined)
                : undefined;
            const existing = (detail?.['detail'] as Record<string, unknown> | undefined)?.['job_id'];
            setConflictJobId(typeof existing === 'number' ? existing : -1);
            return;
          }
          if (!response.ok) setActionError("Unable to create the job. Check the inputs.");
        } catch (error) {
          void error;
          setActionError("Unable to send the job request.");
        } finally {
          setRunSubmitting(false);
          refresh();
        }
      })();
    },
    [refresh],
  );

  const onReassign = useCallback(
    (report: IntegrityReportView) => {
      setReassignSubmitting(true);
      setActionError(null);
      void (async () => {
        try {
          const response = await fetch(INTEGRITY_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              action: 'reassign',
              repository: report.repository,
              base_branch: report.base_branch,
              confirm: report.repository,
            }),
          });
          if (!response.ok) {
            /*
             * **자동으로 다시 요청하지 않는다** (FLOW-008 예외 흐름). 재채번은
             * 비가역이므로 재시도는 운영자의 명시적 재실행이어야 한다.
             */
            setActionError("Renumbering was rejected. Check the result before trying again.");
          }
        } catch (error) {
          void error;
          setActionError("Unable to request renumbering. Check the result before trying again.");
        } finally {
          setReassignSubmitting(false);
          refresh();
        }
      })();
    },
    [refresh],
  );

  if (denied) {
    return (
      <div data-testid="ops-jobs-view" data-state="no_permission">
        <EmptyState
          cause="no_permission"
          title="The operator role is required"
          description="Only operators can view and control jobs."
        />
      </div>
    );
  }

  const jobList = jobs.data ?? [];
  const running = jobList.some((job) => job.state === 'running');
  const state = loading && jobs.data === null ? 'loading_initial' : running ? 'job_running' : 'ready';

  return (
    <div
      data-testid="ops-jobs-view"
      data-state={state}
      /*
       * 조작 중 표시. 포인터와 포커스 **둘 다** 본다 — 키보드만 쓰는 운영자의
       * 조작이 폴링에 지워지면 그 사람에게만 화면이 흔들린다.
       */
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
        <ErrorBanner
          tone="danger"
          title="Unable to process the request"
          impact={actionError}
          action={
            <Button variant="secondary" onClick={refresh} data-testid="ops-jobs-retry">
              Refresh
            </Button>
          }
        />
      )}

      <Panel as="section" aria-label="Jobs" data-testid="section-jobs">
        <h2>Jobs</h2>
        {jobs.failed ? (
          <ErrorBanner
            tone="warning"
            title="Unable to load jobs"
            impact="Other sections remain available. Please try again later."
          />
        ) : (
          <JobTable jobs={jobList} onAction={onAction} pendingJobId={pendingJobId} />
        )}
      </Panel>

      <Panel as="section" aria-label="Run job" data-testid="section-run">
        <h2>Run job</h2>
        <JobRunForm
          onSubmit={onRun}
          submitting={runSubmitting}
          conflictJobId={conflictJobId}
          aliases={(indexStatus.data?.aliases ?? []).map((row) => row.alias)}
        />
      </Panel>

      <section aria-label="Index status" data-testid="section-index">
        <IndexStatusPanel status={indexStatus.data} failed={indexStatus.failed} />
      </section>

      <Panel as="section" aria-label="Sequence integrity" data-testid="section-integrity">
        <h2>Sequence integrity</h2>
        {integrity.failed ? (
          <ErrorBanner
            tone="warning"
            title="Unable to load integrity check results"
            impact="Other sections remain available. Please try again later."
          />
        ) : (integrity.data?.reports ?? []).length === 0 ? (
          <p data-testid="integrity-empty">No check results. Start an integrity check using the job form.</p>
        ) : (
          (integrity.data?.reports ?? []).map((report) => (
            <IntegrityReportCard
              key={`${report.repository}@${report.base_branch}`}
              report={report}
              impact={integrity.data?.impacts[`${report.repository}@${report.base_branch}`] ?? null}
              onReassign={onReassign}
              submitting={reassignSubmitting}
            />
          ))
        )}
      </Panel>
    </div>
  );
}
