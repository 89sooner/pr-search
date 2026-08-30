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
import { Badge, Panel, Table } from '@conductor-by-89soone/react';
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
    <span data-testid="index-unavailable" aria-label="읽지 못한 값">
      {UNAVAILABLE_LABEL}
    </span>
  );
}

function ReindexCell({ row }: { readonly row: AliasStatusView }): ReactNode {
  if (row.active_reindex !== null) {
    const dual = isDualWriting(row);
    return (
      <span data-testid="index-active-reindex" data-dual-write={dual ? 'true' : 'false'}>
        <Badge tone={dual ? 'warning' : 'info'}>{dual ? '이중 쓰기 중' : '재색인 중'}</Badge>{' '}
        잡 {row.active_reindex.job_id}
        {row.active_reindex.target_index === null ? '' : ` → ${row.active_reindex.target_index}`}
        {dual && row.active_reindex.dual_write_since !== null
          ? ` (${formatTimestamp(row.active_reindex.dual_write_since)}부터)`
          : ''}
      </span>
    );
  }

  if (row.last_reindex !== null) {
    return (
      <span data-testid="index-last-reindex">
        마지막 재색인 잡 {row.last_reindex.job_id} — {row.last_reindex.state}
        {row.last_reindex.switched_at === null ? '' : `, 전환 ${formatTimestamp(row.last_reindex.switched_at)}`}
      </span>
    );
  }

  return (
    <span data-testid="index-no-reindex" aria-label="재색인 이력 없음">
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
        <h3>인덱스 상태</h3>
        <p data-testid="index-status-failed">
          별칭 상태를 읽지 못했습니다. 문서 수와 크기는 <strong>{UNAVAILABLE_LABEL}</strong>이며 0이 아닙니다. 잡 목록과
          실행 폼은 계속 사용할 수 있습니다.
        </p>
      </Panel>
    );
  }

  const dualWriting = status.aliases.some(isDualWriting);

  return (
    <Panel data-testid="index-status-panel" data-state={dualWriting ? 'reindex_dual_write' : 'ready'}>
      <h3>인덱스 상태</h3>
      <p data-testid="index-generated-at">조회 시각 {formatTimestamp(status.generated_at)}</p>

      {status.unavailable.length > 0 ? (
        <p data-testid="index-partial-unavailable" role="status">
          일부 값을 읽지 못했습니다: {status.unavailable.join(', ')}. 그 자리만 {UNAVAILABLE_LABEL}으로 표시합니다.
        </p>
      ) : null}

      <Table data-testid="index-status-table" caption="별칭별 인덱스 상태. 읽지 못한 값은 미확인으로 표시됩니다.">
        <thead>
          <tr>
            <th scope="col">별칭</th>
            <th scope="col">실제 인덱스</th>
            <th scope="col">문서 수</th>
            <th scope="col">크기</th>
            <th scope="col">재색인</th>
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
                별칭이 없습니다.
              </td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </Panel>
  );
}
