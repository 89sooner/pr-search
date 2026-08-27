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
import { Badge, Button, Dialog, Table } from '@conductor-by-89soone/react';
import { rowActions, splitInvalidSpan, visibilityLabel, type SavedSearchView } from '../lib/saved-search';

export interface SavedSearchListProps {
  readonly items: readonly SavedSearchView[];
  readonly onRun: (item: SavedSearchView) => void;
  readonly onEdit: (item: SavedSearchView) => void;
  readonly onDelete: (item: SavedSearchView) => void;
  /** 목록 구분용 접두. 두 목록이 같은 화면에 있으므로 testid가 겹치면 안 된다. */
  readonly testIdPrefix: string;
}

function formatTime(value: string | null): string {
  if (value === null) return '실행한 적 없음';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('ko-KR');
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

  if (spans === null) return <code data-testid={`${rowId}-query`}>{item.query}</code>;

  return (
    <code data-testid={`${rowId}-query`}>
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
  testIdPrefix,
}: SavedSearchListProps): ReactNode {
  /** 삭제 확인 대상. 되돌릴 수 없으므로 한 번 묻는다. */
  const [pendingDelete, setPendingDelete] = useState<SavedSearchView | null>(null);

  return (
    <>
      <Table data-testid={`${testIdPrefix}-table`}>
        <thead>
          <tr>
            <th scope="col">이름</th>
            <th scope="col">질의</th>
            <th scope="col">공개 범위</th>
            <th scope="col">소유자</th>
            <th scope="col">마지막 실행</th>
            <th scope="col">액션</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const actions = rowActions(item);
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
                        해석 불가
                      </Badge>
                      <p data-testid={`${rowId}-blocked`}>{actions.blockedReason}</p>
                    </>
                  ) : null}
                </td>
                <td data-testid={`${rowId}-visibility`}>{visibilityLabel(item)}</td>
                <td>{item.is_owner ? '나' : item.owner.login}</td>
                <td>{formatTime(item.last_run_at)}</td>
                <td>
                  <Button
                    onClick={() => {
                      onRun(item);
                    }}
                    disabled={!actions.canRun}
                    data-testid={`${rowId}-run`}
                  >
                    실행
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
                      편집
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
                      삭제
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
          <Dialog.Title>저장된 검색을 삭제합니다</Dialog.Title>
          <Dialog.Description>
            «{pendingDelete?.name ?? ''}»를 삭제합니다. 되돌릴 수 없으며, 팀에 공유했다면 그 팀에서도 사라집니다.
          </Dialog.Description>
          <div>
            <Button
              onClick={() => {
                if (pendingDelete !== null) onDelete(pendingDelete);
                setPendingDelete(null);
              }}
              data-testid={`${testIdPrefix}-delete-confirm`}
            >
              삭제
            </Button>
            <Dialog.Close asChild>
              <Button variant="secondary">취소</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
