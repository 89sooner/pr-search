'use client';

/**
 * C-044 JobTable — A-003의 잡 목록 (WP-040 / FR-ADMIN-002 AC-2·AC-3·AC-7, CR-055).
 *
 * ## 상태로 동작을 추론하지 않는다
 *
 * 각 행의 제어 버튼은 **서버가 준 `allowed_actions`를 그대로** 그린다 (AC-7).
 * 상태 문자열로 추론하면 전이 규칙이 서버와 화면 두 곳에 살고, 잡 유형마다
 * 러너가 실제로 지원하는 범위가 다를 때 화면이 **없는 능력을 제시한다** —
 * 운영자가 눌러 놓고 멈추기를 기다린다. 목록이 비면 그 잡은 제어할 수 없다는
 * 뜻이며 버튼을 그리지 않는다.
 *
 * ## `C-013 ResultTable`을 쓰지 않는다
 *
 * `C-013`은 정렬 컨트롤을 갖고 행 타입이 `ResultRow`(PR·커밋)에 묶여 있다.
 * `C-035 AuditRecordTable`·`C-029 RangeResultTable`이 같은 자리에서 같은
 * 판단을 했다 — 재사용의 뜻은 같은 시각 규칙이지 같은 컴포넌트가 아니다.
 *
 * ## 진행률의 0과 미확인을 가르지 않으면 거짓말이 된다
 *
 * 백필은 목록을 끝까지 읽어야 총계를 안다. 그전의 비율을 0으로 그리면
 * 운영자가 "아무것도 안 됐다"로 읽는다 (`progressView`의 규율).
 */

import type { ReactNode } from 'react';
import { Button, Meter, Table } from './ui';
import { JobStatusBadge } from './JobStatusBadge';
import { controlLabel, jobControls, progressView, type JobControl, type JobView } from '../lib/ops-jobs';
import { formatTimestamp } from '../lib/format';

/** 값이 없음을 그리는 한 자리. 여러 칸이 같은 모양을 쓴다. */
function Absent(): ReactNode {
  return (
    <span data-testid="job-absent" aria-label="No value">
      —
    </span>
  );
}

function Progress({ job }: { readonly job: JobView }): ReactNode {
  const view = progressView(job);

  if (view.waitingUntil !== null) {
    return <span data-testid="job-progress-waiting">Waiting for rate limit reset — {formatTimestamp(view.waitingUntil)}</span>;
  }

  if (view.done === null) return <Absent />;

  const unit = view.unit === null ? '' : ` ${view.unit}`;

  /*
   * **총계를 모르면 게이지를 그리지 않는다.** `Meter`에 0을 넘기면 빈 채로
   * 서고 그것이 "진행이 없다"로 읽힌다 — 처리한 건수만 적는다.
   */
  if (view.ratio === null || view.total === null) {
    return (
      <span data-testid="job-progress-count">
        {view.done.toLocaleString("en-US")}
        {unit} processed (total unknown)
      </span>
    );
  }

  const percent = Math.round(view.ratio * 100);
  return (
    <span data-testid="job-progress-meter">
      <Meter
        value={percent}
        valueText={`${view.done.toLocaleString("en-US")} / ${view.total.toLocaleString("en-US")}${unit}`}
        aria-label={`Job ${String(job.job_id)} Progress`}
      />
    </span>
  );
}

export interface JobTableProps {
  readonly jobs: readonly JobView[];
  readonly onAction: (jobId: number, action: JobControl) => void;
  /** 지금 서버가 받고 있는 잡. 그 행의 버튼만 잠근다. */
  readonly pendingJobId?: number | null;
}

export function JobTable({ jobs, onAction, pendingJobId = null }: JobTableProps): ReactNode {
  return (
    <Table data-testid="job-table" caption="Running and recently completed jobs. Only server-authorized controls are shown.">
      <thead>
        <tr>
          <th scope="col">Type</th>
          <th scope="col">Target</th>
          <th scope="col">Status</th>
          <th scope="col">Progress</th>
          <th scope="col">Start</th>
          <th scope="col">Finished</th>
          <th scope="col">Requested by</th>
          <th scope="col">Controls</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => {
          const controls = jobControls(job);
          return (
            <tr key={job.job_id} data-testid="job-row" data-job-id={job.job_id} data-state={job.state}>
              <td data-testid="job-type">{job.type}</td>
              <td data-testid="job-target">{job.target}</td>
              <td>
                <JobStatusBadge state={job.state} />
              </td>
              <td>
                <Progress job={job} />
              </td>
              <td>{job.started_at === null ? <Absent /> : formatTimestamp(job.started_at)}</td>
              <td>{job.finished_at === null ? <Absent /> : formatTimestamp(job.finished_at)}</td>
              <td>{job.requested_by}</td>
              <td data-testid="job-controls">
                {/*
                  **목록이 비면 아무것도 그리지 않는다.** 비활성 버튼을 그리면
                  "여기서 할 수 있는 일이 있다"를 알려 주는 셈이고, 종료된 잡에
                  대해 그것은 거짓이다.
                */}
                {controls.length === 0 ? (
                  <Absent />
                ) : (
                  controls.map((action) => (
                    <Button
                      key={action}
                      size="sm"
                      variant="secondary"
                      disabled={pendingJobId === job.job_id}
                      data-testid={`job-action-${action}`}
                      onClick={() => {
                        onAction(job.job_id, action);
                      }}
                    >
                      {controlLabel(action)}
                    </Button>
                  ))
                )}
              </td>
            </tr>
          );
        })}
        {jobs.length === 0 ? (
          <tr>
            <td colSpan={8} data-testid="job-table-empty">
              No running or recently completed jobs.
            </td>
          </tr>
        ) : null}
      </tbody>
      {jobs.some((job) => job.error !== null) ? (
        <tfoot>
          {jobs
            .filter((job) => job.error !== null)
            .map((job) => (
              <tr key={`error-${String(job.job_id)}`} data-testid="job-error-row">
                <td colSpan={8}>
                  Job {job.job_id} Failure reason: {job.error}
                </td>
              </tr>
            ))}
        </tfoot>
      ) : null}
    </Table>
  );
}
