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
import { Badge, Button, Table } from '@conductor-by-89soone/react';
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
      <Table data-testid="gh-result-table" caption="gh pr list 결과. 이 목록은 실행 시점의 GHE 응답이며 검색 색인이 아닙니다.">
        <thead>
          <tr>
            <th scope="col">번호</th>
            <th scope="col">제목</th>
            <th scope="col">상태</th>
            <th scope="col">작성자</th>
            <th scope="col">브랜치</th>
            <th scope="col">갱신</th>
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
          요청한 건수만큼 받았습니다. 더 있을 수 있습니다 — 건수를 늘리거나 상태를 좁혀 다시 실행하세요.
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
        PR 참조 {String(references.refs.length)}개를 만들었습니다({execution.host} · {execution.repository ?? '—'}의 번호). 참조는 권한이 아니며, 다른 명령에 잇는 실행은 열리지 않았습니다.
      </p>
    );
  }
  return (
    <p data-testid="gh-result-references" data-status="unavailable">
      PR 번호(number) 필드를 고르지 않아 PR 참조를 만들지 않았습니다. 목록은 그대로 보입니다.
    </p>
  );
}

export function GhExecutionPanel({ execution, onCancel, cancelling = false }: GhExecutionPanelProps): ReactNode {
  const kind = resultKind(execution);
  const rows = execution.result?.rows ?? [];
  const cancellable = !isTerminal(execution.state) && execution.cancel_requested_at === null && onCancel !== undefined;

  return (
    <section aria-label="실행 결과" data-testid="gh-execution-panel" data-state={execution.state}>
      <div className="prs-gh-execution-head">
        <p role="status" aria-live="polite" data-testid="gh-execution-status">
          실행 {String(execution.execution_id)} · <Badge tone={STATE_TONE[execution.state] ?? 'neutral'}>{stateLabel(execution.state)}</Badge>
          {execution.cancel_requested_at !== null && !isTerminal(execution.state) ? ' · 취소 요청됨' : ''}
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
            취소
          </Button>
        ) : null}
      </div>

      <dl className="prs-gh-execution-meta">
        <dt>요청</dt>
        <dd>{formatTimestamp(execution.requested_at)}</dd>
        <dt>시작</dt>
        <dd>{formatTimestamp(execution.started_at)}</dd>
        <dt>종료</dt>
        <dd>{formatTimestamp(execution.finished_at)}</dd>
        <dt>종료 코드</dt>
        <dd data-testid="gh-exit-code">{execution.exit_code === null ? '-' : String(execution.exit_code)}</dd>
      </dl>

      {kind === 'pending' ? <p data-testid="gh-result-pending">아직 실행 중입니다. 결과는 끝난 뒤에 표시됩니다.</p> : null}
      {kind === 'failed' ? (
        <p data-testid="gh-result-failed" role="alert">
          실행이 실패했습니다. {describeError(execution.error)}
        </p>
      ) : null}
      {kind === 'cancelled' ? <p data-testid="gh-result-cancelled">실행이 취소됐습니다. 부분 결과는 표시하지 않습니다.</p> : null}
      {kind === 'timed_out' ? <p data-testid="gh-result-timed-out">시간 상한을 넘겨 실행을 종료했습니다. 부분 결과는 표시하지 않습니다.</p> : null}
      {kind === 'binary' ? <p data-testid="gh-result-binary">출력이 바이너리라 표시하지 않습니다.</p> : null}
      {kind === 'truncated' ? (
        <p data-testid="gh-result-truncated" role="alert">
          출력이 상한을 넘겨 잘렸습니다. 아래 표는 <strong>불완전한 목록</strong>이며 전체가 아닙니다.
        </p>
      ) : null}
      {kind === 'empty' ? <p data-testid="gh-result-empty">조건에 맞는 PR이 0건입니다.</p> : null}
      {(kind === 'rows' || kind === 'truncated') && rows.length > 0 ? (
        <PrRows rows={rows} possiblyMore={execution.result?.possibly_more === true} />
      ) : null}
      {kind === 'rows' || kind === 'empty' ? <ReferenceNote execution={execution} /> : null}

      {isTerminal(execution.state) ? (
        <details data-testid="gh-raw-output">
          <summary>표준 출력·오류 (무해화된 발췌)</summary>
          <SafeGhOutputViewer label="표준 출력" text={execution.stdout?.text ?? null} truncated={execution.stdout?.truncated ?? false} binary={execution.output_binary} testId="gh-stdout" />
          <SafeGhOutputViewer label="표준 오류" text={execution.stderr?.text ?? null} truncated={execution.stderr?.truncated ?? false} binary={false} testId="gh-stderr" />
        </details>
      ) : null}
    </section>
  );
}
