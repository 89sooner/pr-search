'use client';

/**
 * C-071 RegistrationRequestQueue — A-002의 등록 검토 요청 (WP-040 / FR-ING-009
 * AC-8·AC-11, CR-055).
 *
 * ## `C-013 ResultTable`을 쓰지 않는다
 *
 * `C-013`은 정렬 컨트롤을 갖고 행 타입이 `ResultRow`에 묶여 있어 이 목록의
 * `onPrefill`·`onDismiss` 계약을 담지 못한다. **재사용의 뜻은 같은 시각
 * 규칙이지 같은 컴포넌트가 아니다** — `C-035 AuditRecordTable`·
 * `C-029 RangeResultTable`이 같은 자리에서 같은 판단을 했다 (DEV-419).
 *
 * ## "등록" 버튼은 폼을 채우기만 한다 (AC-11)
 *
 * **이 조작만으로는 요청 상태가 바뀌지 않는다.** 승인은 성공한 등록 그
 * 자체이며, 등록되지 않은 채 승인된 행은 아무것도 보장하지 못한다 — 수집도
 * 채번도 시작되지 않았고 요청자에게 보이는 것도 달라지지 않는다.
 *
 * ## 현재 페이지의 행 수를 전체 수처럼 쓰지 않는다
 *
 * `API-ADM-009`는 `total`을 내지 않는다. 서버가 전체 수를 보장하지 않으면
 * 화면도 그것을 전체라고 말하지 않는다 — 커서가 "더 있는가"를 답한다.
 */

import { useState, type ReactNode } from 'react';
import { Badge, Button, Dialog, Field, Table, TextArea } from '@conductor-by-89soone/react';
import {
  MAX_RESOLUTION_NOTE,
  hasMoreRequests,
  noteTooLong,
  requestActionable,
  requestPrefill,
  requestStatusLabel,
  type RegistrationRequestView,
} from '../lib/ops-repositories';
import { formatTimestamp } from '../lib/format';

const STATUS_TONE: Readonly<Record<string, 'neutral' | 'info' | 'success' | 'warning'>> = {
  pending: 'warning',
  fulfilled: 'success',
  dismissed: 'neutral',
};

function Absent(): ReactNode {
  return (
    <span data-testid="request-absent" aria-label="값 없음">
      —
    </span>
  );
}

export interface RegistrationRequestQueueProps {
  readonly requests: readonly RegistrationRequestView[];
  /** 폼을 채운다. **요청 상태를 바꾸지 않는다.** */
  readonly onPrefill: (request: RegistrationRequestView) => void;
  /** 확인이 끝난 뒤에만 불린다. 여기서 처음으로 서버 요청이 나간다. */
  readonly onDismiss: (requestId: string, reason: string) => void;
  readonly nextCursor?: string | null;
  readonly onLoadMore?: (cursor: string) => void;
  readonly submitting?: boolean;
  readonly loading?: boolean;
}

export function RegistrationRequestQueue({
  requests,
  onPrefill,
  onDismiss,
  nextCursor = null,
  onLoadMore,
  submitting = false,
  loading = false,
}: RegistrationRequestQueueProps): ReactNode {
  const [target, setTarget] = useState<RegistrationRequestView | null>(null);
  const [reason, setReason] = useState('');

  const tooLong = noteTooLong(reason);
  const canDismiss = reason.trim() !== '' && !tooLong && !submitting;

  if (requests.length === 0) {
    return (
      <div data-testid="request-queue" data-state={loading ? 'loading_initial' : 'requests_empty'}>
        <p data-testid="request-queue-empty">
          {loading ? '등록 검토 요청을 불러오는 중입니다.' : '처리할 등록 검토 요청이 없습니다.'}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="request-queue" data-state={submitting ? 'submitting' : 'ready'}>
      <Table
        data-testid="request-table"
        caption="등록 검토 요청. 처리 메모는 운영자에게만 보이며 요청자에게 돌아가지 않습니다."
      >
        <thead>
          <tr>
            <th scope="col">저장소</th>
            <th scope="col">요청자</th>
            <th scope="col">요청 시각</th>
            <th scope="col">상태</th>
            <th scope="col">처리자</th>
            <th scope="col">처리 시각</th>
            <th scope="col">처리 메모</th>
            <th scope="col">조작</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => {
            const prefill = requestPrefill(request);
            const actionable = requestActionable(request);
            return (
              <tr key={request.request_id} data-testid="request-row" data-status={request.status}>
                <td data-testid="request-repository">{request.repository}</td>
                <td>{request.requested_by}</td>
                <td>{formatTimestamp(request.created_at)}</td>
                <td>
                  <Badge tone={STATUS_TONE[request.status] ?? 'neutral'}>{requestStatusLabel(request.status)}</Badge>
                </td>
                <td data-testid="request-resolved-by">{request.resolved_by ?? <Absent />}</td>
                <td>{request.resolved_at === null ? <Absent /> : formatTimestamp(request.resolved_at)}</td>
                <td data-testid="request-note">{request.resolution_note ?? <Absent />}</td>
                <td data-testid="request-actions">
                  {/*
                    종료된 요청에는 조작이 없다. 다시 여는 경로를 만들지 않았고
                    (AC-11), 재검토는 별도 요구사항이다.
                  */}
                  {!actionable ? (
                    <Absent />
                  ) : (
                    <>
                      {prefill === null ? null : (
                        <Button
                          size="sm"
                          variant="secondary"
                          data-testid="request-prefill"
                          onClick={() => {
                            onPrefill(request);
                          }}
                        >
                          등록 폼 채우기
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        data-testid="request-dismiss-open"
                        onClick={() => {
                          setReason('');
                          setTarget(request);
                        }}
                      >
                        종료
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      {/*
        **행 수를 전체 수처럼 적지 않는다.** "지금까지 N건"이라고만 쓰고,
        더 있는지는 커서가 답한다.
      */}
      <p data-testid="request-count">
        지금까지 {requests.length.toLocaleString('ko-KR')}건을 불러왔습니다.
        {hasMoreRequests(nextCursor) ? ' 더 남아 있습니다.' : ''}
      </p>

      {hasMoreRequests(nextCursor) && onLoadMore !== undefined ? (
        <Button
          variant="secondary"
          disabled={loading}
          data-testid="request-load-more"
          onClick={() => {
            if (nextCursor !== null) onLoadMore(nextCursor);
          }}
        >
          더 불러오기
        </Button>
      ) : null}

      <Dialog.Root
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTarget(null);
            setReason('');
          }
        }}
      >
        <Dialog.Content size="md" data-testid="request-dismiss-dialog">
          <Dialog.Title>등록 없이 이 요청을 종료합니다</Dialog.Title>
          <Dialog.Description>
            {target?.repository} 요청을 종료합니다. 사유는 <strong>운영자에게만</strong> 보이며 요청자에게 돌아가지
            않습니다. 종료한 요청을 다시 여는 경로는 없습니다.
          </Dialog.Description>

          <Field
            id="request-dismiss-reason"
            label="종료 사유"
            description={`${String(MAX_RESOLUTION_NOTE)}자 이내로 적습니다.`}
            {...(tooLong ? { error: `${String(MAX_RESOLUTION_NOTE)}자를 넘었습니다.` } : {})}
          >
            <TextArea
              id="request-dismiss-reason"
              data-testid="request-dismiss-reason"
              value={reason}
              invalid={tooLong}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </Field>

          <div>
            <Button
              variant="primary"
              tone="danger"
              disabled={!canDismiss}
              data-testid="request-dismiss-submit"
              onClick={() => {
                /*
                 * **여기가 첫 서버 요청이다.** 확인 전에는 아무것도 나가지
                 * 않는다 — `disabled`는 시각 신호이고 실제 방어선은 이 조건이다.
                 */
                if (!canDismiss || target === null) return;
                const requestId = target.request_id;
                const note = reason.trim();
                setTarget(null);
                setReason('');
                onDismiss(requestId, note);
              }}
            >
              종료
            </Button>
            <Dialog.Close asChild>
              <Button variant="secondary" data-testid="request-dismiss-cancel">
                취소
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
