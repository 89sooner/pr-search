'use client';

/**
 * C-042 ScanResultCard — A-001의 조정 스캔 (WP-040 / FR-ING-011 AC-7, FLOW-007, CR-055).
 *
 * ## 버튼을 누른 사실은 스캔 완료가 아니다 (QA-A003-15)
 *
 * 즉시 실행은 **잡을 만든다.** 그 잡의 `queued`·`running`·진행률·종료 상태를
 * 그대로 보이는 것이 이 카드의 일이며, "실행했습니다"라는 문구로 끝내면
 * 운영자는 스캔이 끝난 줄 알고 자리를 뜬다.
 *
 * ## 이미 돌고 있으면 그 잡을 가리킨다
 *
 * 주기 실행과 수동 실행은 같은 구현을 지나며 동시에 돌지 않는다 (AC-7).
 * 서버가 409와 실행 중 잡 식별자를 주면 그것을 보인다 — 두 번째 잡을
 * 만들려 하지 않는다.
 */

import type { ReactNode } from 'react';
import { Button, Card } from './ui';
import { JobStatusBadge } from './JobStatusBadge';
import { formatCount, progressView, type JobView } from '../lib/ops-jobs';
import { formatTimestamp } from '../lib/format';

/** 최근 조정 결과. `API-ADM-006`이 저장소 개요와 같은 값을 준다. */
export interface ScanResultView {
  readonly last_scanned_at: string | null;
  readonly missing_count: number | null;
  readonly repositories_scanned: number | null;
  readonly deferred_count: number | null;
}

export interface ScanResultCardProps {
  readonly result: ScanResultView | null;
  /** 지금 돌고 있거나 방금 끝난 조정 잡. 없으면 실행 전이다. */
  readonly job?: JobView | null;
  readonly onRun: () => void;
  readonly submitting?: boolean;
  /** 서버가 409로 알려 준 실행 중 잡. */
  readonly conflictJobId?: number | null;
}

export function ScanResultCard({
  result,
  job = null,
  onRun,
  submitting = false,
  conflictJobId = null,
}: ScanResultCardProps): ReactNode {
  const progress = job === null ? null : progressView(job);
  const active = job !== null && (job.state === 'queued' || job.state === 'running');

  return (
    <Card data-testid="scan-result-card" data-active={active ? 'true' : 'false'}>
      <h3>Reconciliation scan</h3>

      {result === null ? (
        <p data-testid="scan-no-result">No reconciliation scan results yet.</p>
      ) : (
        <dl data-testid="scan-result">
          <div>
            <dt>Last scan</dt>
            <dd>{formatTimestamp(result.last_scanned_at)}</dd>
          </div>
          <div>
            <dt>Missing items found</dt>
            <dd data-testid="scan-missing">{formatCount(result.missing_count)}</dd>
          </div>
          <div>
            <dt>Repositories scanned</dt>
            <dd>{formatCount(result.repositories_scanned)}</dd>
          </div>
          <div>
            <dt>Repositories deferred</dt>
            <dd>{formatCount(result.deferred_count)}</dd>
          </div>
        </dl>
      )}

      {/*
        **잡으로 지켜본다.** 상태와 진행률을 그대로 보이며, 버튼을 누른 사실을
        완료로 바꿔 적지 않는다.
      */}
      {job === null ? null : (
        <p data-testid="scan-job">
          Job {job.job_id} <JobStatusBadge state={job.state} />
          {progress?.done === null || progress === null
            ? ''
            : ` — ${progress.done.toLocaleString("en-US")}${progress.total === null ? "processed (total unknown)" : ` / ${progress.total.toLocaleString("en-US")}`}`}
          {job.finished_at === null ? '' : `· Finished ${formatTimestamp(job.finished_at)}`}
        </p>
      )}

      {conflictJobId === null ? null : (
        <p data-testid="scan-conflict" role="status">
          A reconciliation scan is already running (job {conflictJobId}). Scheduled and manual scans cannot run simultaneously.
        </p>
      )}

      <Button
        disabled={submitting || active}
        data-testid="scan-run"
        onClick={() => {
          if (submitting || active) return;
          onRun();
        }}
      >
        {submitting ? "Starting…" : active ? "Running" : "Run now"}
      </Button>
    </Card>
  );
}
