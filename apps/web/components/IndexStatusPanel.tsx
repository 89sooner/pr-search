'use client';

/**
 * C-046 IndexStatusPanel — A-003의 인덱스 상태 (WP-040 / FR-ING-008 AC-2·AC-7, CR-055).
 *
 * ## 읽지 못한 값을 `0`으로 대신하지 않는다 (AC-7, QA-A003-14)
 *
 * **크기를 모르는 것과 인덱스가 빈 것은 다른 사실이다.** 후자로 적으면
 * 운영자가 재색인이 실패했다고 읽고, 멀쩡한 인덱스를 다시 만든다. 값 하나를
 * 읽지 못해도 나머지 행은 정상 표시한다 — 한 별칭의 통계 실패가 패널 전체를
 * 오류로 만들면 그 화면이 알려 줄 수 있었던 다른 사실까지 사라진다.
 *
 * ## 이중 쓰기는 상시 표시다 (AC-2, QA-A003-07)
 *
 * 재색인 중에는 두 인덱스가 함께 쓰인다. 그 사실이 화면에 없으면 운영자는
 * 문서 수의 차이를 결함으로 읽는다.
 *
 * ## 이력은 `job` 정본에서 온다
 *
 * 별도 이력 표를 만들지 않았다 (DEV-299의 판단) — `progress`가
 * `source_index`·`target_index`·`switched_at`을 이미 갖고 있고, 새 표를
 * 만들면 같은 사실이 두 곳에 살고 한쪽만 낡는다.
 */

import type { ReactNode } from 'react';
import { Badge, Panel, Table } from './ui';
import {
  UNAVAILABLE_LABEL,
  formatBytes,
  formatCount,
  isDualWriting,
  type AliasStatusView,
  type IndexStatusView,
} from '../lib/ops-jobs';
import { formatTimestamp } from '../lib/format';

function Unavailable(): ReactNode {
  return (
    <span data-testid="index-unavailable" aria-label="Unavailable">
      {UNAVAILABLE_LABEL}
    </span>
  );
}

function ReindexCell({ row }: { readonly row: AliasStatusView }): ReactNode {
  if (row.active_reindex !== null) {
    const dual = isDualWriting(row);
    return (
      <span data-testid="index-active-reindex" data-dual-write={dual ? 'true' : 'false'}>
        <Badge tone={dual ? 'warning' : 'info'}>{dual ? "Dual writing" : "Reindexing"}</Badge>{' '}
        Job {row.active_reindex.job_id}
        {row.active_reindex.target_index === null ? '' : ` → ${row.active_reindex.target_index}`}
        {dual && row.active_reindex.dual_write_since !== null
          ? ` (${formatTimestamp(row.active_reindex.dual_write_since)}since)`
          : ''}
      </span>
    );
  }

  if (row.last_reindex !== null) {
    return (
      <span data-testid="index-last-reindex">
        Last reindex job {row.last_reindex.job_id} — {row.last_reindex.state}
        {row.last_reindex.switched_at === null ? '' : `, switched ${formatTimestamp(row.last_reindex.switched_at)}`}
      </span>
    );
  }

  return (
    <span data-testid="index-no-reindex" aria-label="No reindex history">
      —
    </span>
  );
}

export interface IndexStatusPanelProps {
  readonly status: IndexStatusView | null;
  /** 조회 자체가 실패했다. 패널만 그 사실을 적고 다른 섹션은 계속 돈다. */
  readonly failed?: boolean;
}

export function IndexStatusPanel({ status, failed = false }: IndexStatusPanelProps): ReactNode {
  if (failed || status === null) {
    return (
      <Panel data-testid="index-status-panel" data-state="index_status_unavailable">
        <h3>Index status</h3>
        <p data-testid="index-status-failed">
          Unable to load alias status. Document count and size are <strong>{UNAVAILABLE_LABEL}</strong> rather than zero. The job list and execution form remain available.
        </p>
      </Panel>
    );
  }

  const dualWriting = status.aliases.some(isDualWriting);

  return (
    <Panel data-testid="index-status-panel" data-state={dualWriting ? 'reindex_dual_write' : 'ready'}>
      <h3>Index status</h3>
      <p data-testid="index-generated-at">Checked at {formatTimestamp(status.generated_at)}</p>

      {status.unavailable.length > 0 ? (
        <p data-testid="index-partial-unavailable" role="status">
          Some values could not be loaded: {status.unavailable.join(', ')}. Those values are shown as {UNAVAILABLE_LABEL}.
        </p>
      ) : null}

      <Table data-testid="index-status-table" caption="Index status by alias. Unavailable values are shown as unknown.">
        <thead>
          <tr>
            <th scope="col">Alias</th>
            <th scope="col">Physical index</th>
            <th scope="col">Documents</th>
            <th scope="col">Size</th>
            <th scope="col">Reindex</th>
          </tr>
        </thead>
        <tbody>
          {status.aliases.map((row) => (
            <tr key={row.alias} data-testid="index-row" data-alias={row.alias}>
              <td>{row.alias}</td>
              <td data-testid="index-current">{row.current_index ?? <Unavailable />}</td>
              <td data-testid="index-doc-count">
                {row.document_count === null ? <Unavailable /> : formatCount(row.document_count)}
              </td>
              <td data-testid="index-store-size">
                {row.store_size_bytes === null ? <Unavailable /> : formatBytes(row.store_size_bytes)}
              </td>
              <td>
                <ReindexCell row={row} />
              </td>
            </tr>
          ))}
          {status.aliases.length === 0 ? (
            <tr>
              <td colSpan={5} data-testid="index-status-empty">
                No aliases.
              </td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </Panel>
  );
}
