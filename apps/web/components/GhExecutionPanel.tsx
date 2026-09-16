'use client';

/**
 * C-058 ExecutionPanel — 실행 상태·결과·출력·취소 (WP-077 / FR-GH-006, FR-GH-002 AC-10).
 *
 * ## 사실을 가르는 것이 이 패널의 일이다 (지시서 12장)
 *
 * 「0건」·「잘린 부분 출력」·「실행 실패」·「취소」·「시간 초과」는 다른 사실이다. 서버가
 * 준 `result`·`stdout.truncated`·`state`로 그것을 가르고(`resultKind`), 잘린 출력을
 * 완전한 목록처럼 그리지 않는다.
 *
 * 상태 변화는 `role="status"` live region으로 스크린 리더에 전달된다 (QA-GH-18).
 */

import type { ReactNode } from 'react';
import { Badge, Button, Table } from './ui';
import { formatTimestamp } from '../lib/format';
import { describeError, isTerminal, resultKind, stateLabel, type ExecutionView, type PrRowView } from '../lib/gh';
import { SafeGhOutputViewer } from './SafeGhOutputViewer';

const STATE_TONE: Readonly<Record<string, 'neutral' | 'info' | 'accent' | 'warning' | 'danger'>> = {
  queued: 'info',
  running: 'accent',
  succeeded: 'accent',
  failed: 'danger',
  cancelled: 'warning',
  timed_out: 'danger',
  policy_blocked: 'danger',
};

export interface GhExecutionPanelProps {
  readonly execution: ExecutionView;
  readonly onCancel?: (executionId: number) => void;
  readonly cancelling?: boolean;
}

function PrRows({ rows, possiblyMore }: { readonly rows: readonly PrRowView[]; readonly possiblyMore: boolean }): ReactNode {
  return (
    <>
      <Table data-testid="gh-result-table" caption="gh pr list results from GHE at execution time, separate from the search index.">
        <thead>
          <tr>
            <th scope="col">Number</th>
            <th scope="col">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Author</th>
            <th scope="col">Branch</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.number === null ? `row-${String(index)}` : `pr-${String(row.number)}`} data-testid="gh-result-row">
              <td>
                {row.number === null ? (
                  '—'
                ) : row.url === null ? (
                  `#${String(row.number)}`
                ) : (
                  <a href={row.url} target="_blank" rel="noopener noreferrer">
                    #{String(row.number)}
                  </a>
                )}
              </td>
              <td data-testid="gh-result-title">{row.title ?? ''}</td>
              <td>
                {row.state ?? ''}
                {row.isDraft === true ? (
                  <>
                    {' '}
                    <Badge tone="neutral">draft</Badge>
                  </>
                ) : null}
              </td>
              <td>{row.author ?? ''}</td>
              <td>
                {row.headRefName ?? ''}
                {row.baseRefName === null ? '' : ` → ${row.baseRefName}`}
              </td>
              <td>{formatTimestamp(row.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      {possiblyMore ? (
        <p data-testid="gh-result-possibly-more">
          The requested limit was reached. More results may exist. Increase the limit or narrow the status filter and run again.
        </p>
      ) : null}
    </>
  );
}

/**
 * 결과에서 PR 참조를 만들었는가 (CR-089). `pr_list_v1` 기록에는 이 사실이 없어 아무것도 그리지 않는다 — 옛 기록을
 * 새 규칙으로 다시 해석하지 않는다. 참조는 권한이 아니고, 다른 명령에 잇는 실행은 열리지 않았다는 사실을 함께 말한다.
 */
function ReferenceNote({ execution }: { readonly execution: ExecutionView }): ReactNode {
  const references = execution.result?.references;
  if (references === undefined) return null;
  if (references.status === 'available') {
    return (
      <p data-testid="gh-result-references" data-status="available">
        PR references: {String(references.refs.length)} created ({execution.host} · {execution.repository ?? '—'} numbers). References do not grant permissions. Chaining execution to other commands is not enabled.
      </p>
    );
  }
  return (
    <p data-testid="gh-result-references" data-status="unavailable">
      No PR references were created because the number field was not selected. The list is still shown.
    </p>
  );
}

export function GhExecutionPanel({ execution, onCancel, cancelling = false }: GhExecutionPanelProps): ReactNode {
  const kind = resultKind(execution);
  const rows = execution.result?.rows ?? [];
  const cancellable = !isTerminal(execution.state) && execution.cancel_requested_at === null && onCancel !== undefined;

  return (
    <section aria-label="Execution results" data-testid="gh-execution-panel" data-state={execution.state}>
      <div className="prs-gh-execution-head">
        <p role="status" aria-live="polite" data-testid="gh-execution-status">
          Run {String(execution.execution_id)} · <Badge tone={STATE_TONE[execution.state] ?? 'neutral'}>{stateLabel(execution.state)}</Badge>
          {execution.cancel_requested_at !== null && !isTerminal(execution.state) ? "· Cancellation requested" : ''}
        </p>
        {cancellable ? (
          <Button
            variant="secondary"
            data-testid="gh-cancel"
            disabled={cancelling}
            onClick={() => {
              onCancel(execution.execution_id);
            }}
          >
            Cancel
          </Button>
        ) : null}
      </div>

      <dl className="prs-gh-execution-meta">
        <dt>Requested</dt>
        <dd>{formatTimestamp(execution.requested_at)}</dd>
        <dt>Start</dt>
        <dd>{formatTimestamp(execution.started_at)}</dd>
        <dt>Finished</dt>
        <dd>{formatTimestamp(execution.finished_at)}</dd>
        <dt>Exit code</dt>
        <dd data-testid="gh-exit-code">{execution.exit_code === null ? '-' : String(execution.exit_code)}</dd>
      </dl>

      {kind === 'pending' ? <p data-testid="gh-result-pending">Still running. Results will appear when execution finishes.</p> : null}
      {kind === 'failed' ? (
        <p data-testid="gh-result-failed" role="alert">
          Execution failed. {describeError(execution.error)}
        </p>
      ) : null}
      {kind === 'cancelled' ? <p data-testid="gh-result-cancelled">Execution was canceled. Partial results are not shown.</p> : null}
      {kind === 'timed_out' ? <p data-testid="gh-result-timed-out">Execution exceeded the time limit and was stopped. Partial results are not shown.</p> : null}
      {kind === 'binary' ? <p data-testid="gh-result-binary">Binary output cannot be displayed.</p> : null}
      {kind === 'truncated' ? (
        <p data-testid="gh-result-truncated" role="alert">
          Output exceeded the limit and was truncated. The table below is <strong>incomplete</strong> and does not include all results.
        </p>
      ) : null}
      {kind === 'empty' ? <p data-testid="gh-result-empty">No PRs match these filters.</p> : null}
      {(kind === 'rows' || kind === 'truncated') && rows.length > 0 ? (
        <PrRows rows={rows} possiblyMore={execution.result?.possibly_more === true} />
      ) : null}
      {kind === 'rows' || kind === 'empty' ? <ReferenceNote execution={execution} /> : null}

      {isTerminal(execution.state) ? (
        <details data-testid="gh-raw-output">
          <summary>Standard output and error (sanitized excerpts)</summary>
          <SafeGhOutputViewer label="Standard output" text={execution.stdout?.text ?? null} truncated={execution.stdout?.truncated ?? false} binary={execution.output_binary} testId="gh-stdout" />
          <SafeGhOutputViewer label="Standard error" text={execution.stderr?.text ?? null} truncated={execution.stderr?.truncated ?? false} binary={false} testId="gh-stderr" />
        </details>
      ) : null}
    </section>
  );
}
