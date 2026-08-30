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
import { Badge, Button, Checkbox, Dialog, Table } from '@conductor-by-89soone/react';
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
          실패 대기열이 {BULK_REPROCESS_CONFIRM_THRESHOLD}건을 넘었습니다 (
          {(total ?? items.length).toLocaleString('ko-KR')}건). 원인을 먼저 확인하세요.
        </p>
      ) : null}

      <Table data-testid="dead-letter-list" caption="실패한 수집 이벤트. 원인을 해소한 뒤 재처리합니다.">
        <thead>
          <tr>
            <th scope="col">선택</th>
            <th scope="col">전달 식별자</th>
            <th scope="col">단계</th>
            <th scope="col">상태</th>
            <th scope="col">실패 사유</th>
            <th scope="col">재시도</th>
            <th scope="col">재처리</th>
            <th scope="col">마지막 갱신</th>
            <th scope="col">원본</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.dead_letter_id} data-testid="dead-letter-row" data-state={item.state}>
              <td>
                <Checkbox
                  id={`dlq-select-${String(item.dead_letter_id)}`}
                  data-testid="dead-letter-select"
                  aria-label={`${item.delivery_id} 선택`}
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
                    원본 열람
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {items.length === 0 ? (
            <tr>
              <td colSpan={9} data-testid="dead-letter-empty">
                실패한 이벤트가 없습니다.
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
        선택한 {ids.length}건 재처리
      </Button>

      <Dialog.Root
        open={phase !== null}
        onOpenChange={(open) => {
          if (!open) setPhase(null);
        }}
      >
        <Dialog.Content size="sm" data-testid="dead-letter-dialog" data-phase={phase ?? 'closed'}>
          <Dialog.Title>
            {phase === 'reconfirm' ? '정말 이 규모로 재처리합니까?' : '선택한 이벤트를 재처리합니다'}
          </Dialog.Title>
          <Dialog.Description data-testid="dead-letter-dialog-count">
            {phase === 'reconfirm'
              ? `${String(ids.length)}건은 ${String(BULK_REPROCESS_CONFIRM_THRESHOLD)}건을 넘습니다. GHE 한도를 소모하고 실시간 수집이 밀릴 수 있습니다.`
              : `대상 ${String(ids.length)}건을 다시 수집 대기열에 넣습니다.`}
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
              {phase === 'reconfirm' ? '그래도 재처리' : '재처리'}
            </Button>
            <Dialog.Close asChild>
              <Button variant="secondary" data-testid="dead-letter-reprocess-cancel">
                취소
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
