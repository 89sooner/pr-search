'use client';

/**
 * C-041 DeadLetterTable — A-001의 실패 대기열 (WP-040 / FR-ING-007 AC-2·AC-3·AC-5, CR-055).
 *
 * ## 100건 초과는 재확인을 한 번 더 거친다 (AC-3, QA-A001-05)
 *
 * 일괄 재처리는 되돌릴 수 없는 조작이 아니지만 **범위가 크면 GHE 한도를 태우고
 * 실시간 수집을 밀어낸다.** 대상 건수를 확인 다이얼로그에 명시하고, 경계를
 * 넘으면 한 번 더 묻는다.
 *
 * **확인 전에는 서버로 요청이 나가지 않는다.** `disabled`는 시각 신호일 뿐이며,
 * 증명해야 하는 것은 네트워크 호출 수가 0이라는 사실이다.
 *
 * ## `payload`를 목록에 펼치지 않는다
 *
 * 원본 열람은 별도 조작이며 감사 대상이다 (THR-044). 목록이 그것을 자동으로
 * 펼치면 조회 한 번이 모든 원본의 열람이 된다.
 */

import { useState, type ReactNode } from 'react';
import { Badge, Button, Checkbox, Dialog, Table } from './ui';
import { BULK_REPROCESS_CONFIRM_THRESHOLD, needsBulkReconfirm } from '../lib/ops-jobs';
import { formatTimestamp } from '../lib/format';

export interface DeadLetterItemView {
  readonly dead_letter_id: number;
  readonly delivery_id: string;
  readonly stage: string;
  readonly repository_id: number | null;
  readonly error: string;
  readonly retry_count: number;
  readonly reprocess_count: number;
  readonly state: string;
  readonly created_at: string;
  readonly updated_at: string;
}

const STATE_TONE: Readonly<Record<string, 'neutral' | 'warning' | 'danger'>> = {
  pending: 'warning',
  reprocessing: 'neutral',
  held: 'danger',
  resolved: 'neutral',
};

export interface DeadLetterTableProps {
  readonly items: readonly DeadLetterItemView[];
  /** 확인이 끝난 뒤에만 불린다. 여기서 처음으로 서버 요청이 나간다. */
  readonly onReprocess: (ids: readonly number[]) => void;
  /** 원본 열람. 목록이 자동으로 펼치지 않는다 (THR-044). */
  readonly onOpenPayload?: (deliveryId: string) => void;
  readonly submitting?: boolean;
  /** 대기열 전체 건수. 경보 상태 판정에 쓴다 (AC-5). */
  readonly total?: number | null;
}

export function DeadLetterTable({
  items,
  onReprocess,
  onOpenPayload,
  submitting = false,
  total = null,
}: DeadLetterTableProps): ReactNode {
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  /** 확인 단계. `null`이면 닫혀 있고, `reconfirm`은 100건 초과의 두 번째 물음이다. */
  const [phase, setPhase] = useState<'confirm' | 'reconfirm' | null>(null);

  const ids = [...selected];
  const alerting = (total ?? items.length) > BULK_REPROCESS_CONFIRM_THRESHOLD;

  const toggle = (id: number): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const finish = (): void => {
    setPhase(null);
    const chosen = [...selected];
    setSelected(new Set());
    onReprocess(chosen);
  };

  return (
    <div data-testid="dead-letter-table" data-alerting={alerting ? 'true' : 'false'}>
      {alerting ? (
        <p data-testid="dead-letter-alert" role="status">
          The dead-letter queue exceeds {BULK_REPROCESS_CONFIRM_THRESHOLD} items (
          {(total ?? items.length).toLocaleString("en-US")} items). Investigate the cause first.
        </p>
      ) : null}

      <Table data-testid="dead-letter-list" caption="Failed ingestion events. Resolve the cause before replaying.">
        <thead>
          <tr>
            <th scope="col">Select</th>
            <th scope="col">Delivery ID</th>
            <th scope="col">Stage</th>
            <th scope="col">Status</th>
            <th scope="col">Failure reason</th>
            <th scope="col">Retry</th>
            <th scope="col">Replay</th>
            <th scope="col">Last updated</th>
            <th scope="col">Original</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.dead_letter_id} data-testid="dead-letter-row" data-state={item.state}>
              <td>
                <Checkbox
                  id={`dlq-select-${String(item.dead_letter_id)}`}
                  data-testid="dead-letter-select"
                  aria-label={`${item.delivery_id} Select`}
                  checked={selected.has(item.dead_letter_id)}
                  onCheckedChange={() => {
                    toggle(item.dead_letter_id);
                  }}
                />
              </td>
              <td data-testid="dead-letter-delivery">{item.delivery_id}</td>
              <td>{item.stage}</td>
              <td>
                <Badge tone={STATE_TONE[item.state] ?? 'neutral'}>{item.state}</Badge>
              </td>
              <td data-testid="dead-letter-error">{item.error}</td>
              <td data-testid="dead-letter-retry">{item.retry_count}</td>
              <td>{item.reprocess_count}</td>
              <td>{formatTimestamp(item.updated_at)}</td>
              <td>
                {onOpenPayload === undefined ? (
                  '—'
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid="dead-letter-open-payload"
                    onClick={() => {
                      onOpenPayload(item.delivery_id);
                    }}
                  >
                    View payload
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {items.length === 0 ? (
            <tr>
              <td colSpan={9} data-testid="dead-letter-empty">
                No failed events.
              </td>
            </tr>
          ) : null}
        </tbody>
      </Table>

      <Button
        disabled={ids.length === 0 || submitting}
        data-testid="dead-letter-reprocess-open"
        onClick={() => {
          setPhase('confirm');
        }}
      >
        Selected: {ids.length} events to replay
      </Button>

      <Dialog.Root
        open={phase !== null}
        onOpenChange={(open) => {
          if (!open) setPhase(null);
        }}
      >
        <Dialog.Content size="sm" data-testid="dead-letter-dialog" data-phase={phase ?? 'closed'}>
          <Dialog.Title>
            {phase === 'reconfirm' ? "Replay this many events?" : "Replay selected events"}
          </Dialog.Title>
          <Dialog.Description data-testid="dead-letter-dialog-count">
            {phase === 'reconfirm'
              ? `${String(ids.length)} items exceeds ${String(BULK_REPROCESS_CONFIRM_THRESHOLD)} items. This consumes GHE rate limits and may delay live ingestion.`
              : `Target ${String(ids.length)} events will be returned to the ingestion queue.`}
          </Dialog.Description>

          <div>
            <Button
              disabled={submitting}
              data-testid="dead-letter-reprocess-confirm"
              onClick={() => {
                /*
                 * **여기서만 서버로 나간다.** 경계를 넘으면 한 번 더 묻고,
                 * 그 두 번째 확인을 지나기 전에는 아무것도 보내지 않는다.
                 */
                if (submitting) return;
                if (phase === 'confirm' && needsBulkReconfirm(ids.length)) {
                  setPhase('reconfirm');
                  return;
                }
                finish();
              }}
            >
              {phase === 'reconfirm' ? "Replay anyway" : "Replay"}
            </Button>
            <Dialog.Close asChild>
              <Button variant="secondary" data-testid="dead-letter-reprocess-cancel">
                Cancel
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
