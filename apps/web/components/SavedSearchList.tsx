'use client';

/**
 * C-037 SavedSearchList — 저장된 검색 목록과 실행·편집·삭제 (WP-033, CR-049).
 *
 * ## 행이 보이는 액션은 소유 여부가 정한다
 *
 * 공유받은 항목에는 편집·삭제를 그리지 않는다. 그러나 **그리지 않는 것이
 * 통제가 아니다** — 서버가 같은 규칙을 다시 강제하며(`404`), 이 컴포넌트는 그
 * 사실을 화면에 옮길 뿐이다. 판정 자체는 `lib/saved-search.ts`에 있어 DOM 없이
 * 시험할 수 있다.
 *
 * ## 색만으로 구분하지 않는다
 *
 * 공개 범위와 질의 유효성은 각각 문자 레이블을 갖는다 (NFR-006). 배지 색은
 * 거드는 것이지 정보를 나르는 것이 아니다.
 */

import { useState, type ReactNode } from 'react';
import { Badge, Button, Dialog, Table } from './ui';
import {
  describeSequenceReference,
  rowActions,
  splitInvalidSpan,
  visibilityLabel,
  type SavedSearchView,
} from '../lib/saved-search';

export interface SavedSearchListProps {
  readonly items: readonly SavedSearchView[];
  readonly onRun: (item: SavedSearchView) => void;
  readonly onEdit: (item: SavedSearchView) => void;
  readonly onDelete: (item: SavedSearchView) => void;
  /**
   * 「현재 에폭으로 다시 연결」 (CR-051, AC-8).
   *
   * **목록을 여는 것만으로는 일어나지 않는다.** 이 콜백은 사용자가 버튼을
   * 눌렀을 때에만 불리며, 그것이 자동 재해석과 명시적 복구를 가르는 선이다.
   */
  readonly onRebindEpoch: (item: SavedSearchView) => void;
  /** 목록 구분용 접두. 두 목록이 같은 화면에 있으므로 testid가 겹치면 안 된다. */
  readonly testIdPrefix: string;
}

function formatTime(value: string | null): string {
  if (value === null) return "Never run";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en-US");
}

/**
 * 질의 칸.
 *
 * 무효한 질의는 **어디가 문제인지** 짚는다 (AC-6). 파서가 준 오프셋을 쓰며,
 * 오프셋이 없거나 범위를 벗어나면 가르지 않고 전체를 그대로 그린다.
 *
 * `<mark>`로 감싸되 **색만으로 말하지 않는다** — 그 아래 배지와 사유 문장이
 * 같은 사실을 글로 반복한다 (NFR-006).
 */
function QueryCell({ item, rowId }: { item: SavedSearchView; rowId: string }): ReactNode {
  const spans =
    item.query_status === 'invalid'
      ? splitInvalidSpan(item.query, item.query_error?.detail)
      : null;

  if (spans === null) return <code className="ui-mono" data-testid={`${rowId}-query`}>{item.query}</code>;

  return (
    <code className="ui-mono" data-testid={`${rowId}-query`}>
      {spans.before}
      <mark data-testid={`${rowId}-invalid-span`}>{spans.invalid}</mark>
      {spans.after}
    </code>
  );
}

export function SavedSearchList({
  items,
  onRun,
  onEdit,
  onDelete,
  onRebindEpoch,
  testIdPrefix,
}: SavedSearchListProps): ReactNode {
  /** 삭제 확인 대상. 되돌릴 수 없으므로 한 번 묻는다. */
  const [pendingDelete, setPendingDelete] = useState<SavedSearchView | null>(null);

  return (
    <>
      <Table data-testid={`${testIdPrefix}-table`}>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Query</th>
            <th scope="col">Visibility</th>
            <th scope="col">Owner</th>
            <th scope="col">Last run</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const actions = rowActions(item);
            const sequence = describeSequenceReference(item);
            const rowId = `${testIdPrefix}-row-${String(item.saved_search_id)}`;
            return (
              <tr key={item.saved_search_id} data-testid={rowId}>
                <td>{item.name}</td>
                <td>
                  <QueryCell item={item} rowId={rowId} />
                  {item.query_status === 'invalid' ? (
                    <>
                      {/* 유효성은 배지와 문장 둘 다로 말한다 — 색만으로 구분하지 않는다. */}
                      <Badge tone="danger" data-testid={`${rowId}-invalid`}>
                        Cannot resolve
                      </Badge>
                      <p data-testid={`${rowId}-blocked`}>{actions.blockedReason}</p>
                    </>
                  ) : null}

                  {/*
                    * 시퀀스 인용 상태 (CR-051, AC-8).
                    *
                    * **문자 레이블을 반드시 둔다** — 색이나 아이콘만으로
                    * 낡음을 말하지 않는다 (NFR-006). 판정은 뷰 모델이 끝냈고
                    * 여기서는 그리기만 한다.
                    */}
                  {sequence === null ? null : (
                    <>
                      <Badge
                        tone={sequence.blocksRun ? 'danger' : 'warning'}
                        data-testid={`${rowId}-sequence-status`}
                      >
                        {sequence.label}
                      </Badge>
                      {sequence.detail === null ? null : (
                        <p data-testid={`${rowId}-sequence-detail`}>{sequence.detail}</p>
                      )}
                      {actions.blockedReason !== null && item.query_status !== 'invalid' ? (
                        <p data-testid={`${rowId}-blocked`}>{actions.blockedReason}</p>
                      ) : null}
                    </>
                  )}
                </td>
                <td data-testid={`${rowId}-visibility`}>{visibilityLabel(item)}</td>
                <td>{item.is_owner ? "Me" : item.owner.login}</td>
                <td>{formatTime(item.last_run_at)}</td>
                <td>
                  <Button
                    onClick={() => {
                      onRun(item);
                    }}
                    disabled={!actions.canRun}
                    data-testid={`${rowId}-run`}
                  >
                    Run
                  </Button>

                  {/*
                   * 공유받은 항목에는 아예 그리지 않는다. 비활성으로 보여 주면
                   * "여기에 내가 못 하는 것이 있다"를 알려 주는 셈이고, 그것은
                   * 이 사람이 할 일이 아니다.
                   */}
                  {actions.canEdit ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        onEdit(item);
                      }}
                      data-testid={`${rowId}-edit`}
                    >
                      Edit
                    </Button>
                  ) : null}

                  {/*
                    * 저장자에게만 그린다 (CR-051, AC-2). 공유받은 사람에게는
                    * 사유 문장이 "저장자가 다시 연결해야 합니다"를 말한다.
                    */}
                  {actions.canRebindEpoch ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        onRebindEpoch(item);
                      }}
                      data-testid={`${rowId}-rebind-epoch`}
                    >
                      Reconnect to current epoch
                    </Button>
                  ) : null}

                  {actions.canDelete ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setPendingDelete(item);
                      }}
                      data-testid={`${rowId}-delete`}
                    >
                      Delete
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      <Dialog.Root
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <Dialog.Content size="sm" data-testid={`${testIdPrefix}-delete-dialog`}>
          <Dialog.Title>Delete saved search</Dialog.Title>
          <Dialog.Description>
            «{pendingDelete?.name ?? ''}» will be deleted permanently. If shared with a team, it will also disappear for that team.
          </Dialog.Description>
          <div>
            <Button
              onClick={() => {
                if (pendingDelete !== null) onDelete(pendingDelete);
                setPendingDelete(null);
              }}
              data-testid={`${testIdPrefix}-delete-confirm`}
            >
              Delete
            </Button>
            <Dialog.Close asChild>
              <Button variant="secondary">Cancel</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
