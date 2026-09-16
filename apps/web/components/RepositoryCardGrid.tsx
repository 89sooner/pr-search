'use client';

/**
 * C-038 RepositoryCardGrid — 저장소별 수집 진단 카드 (W-009-LIST / WP-034, CR-050).
 *
 * ## 판정을 여기서 하지 않는다
 *
 * 무엇을 어떤 문구로 그릴지는 `lib/repository-overview.ts`가 이미 정했다. 여기서
 * 다시 판정하면 같은 규칙이 두 곳에 살고 한쪽만 고쳐지는 자리가 생긴다.
 *
 * ## 세 값을 같은 문구로 그리지 않는다
 *
 * `null`(기록 없음) · `0`(확인된 영) · `unavailable`(조회 실패)은 서로 다른
 * 사실이다. `unavailable`을 0으로 그리면 사용자는 "수집이 안 됐다"는 **틀린
 * 진단**을 받는다.
 *
 * ## 실행 액션을 두지 않는다
 *
 * 등록·해제·백필·재채번 버튼은 이 카드에 없다 — A-002·A-003의 몫이고
 * `operator` 전용이다 (FR-ING-009 AC-8).
 */

import type { ReactNode } from 'react';
import { Badge, Button, Card, CardGrid, Meter } from './ui';
import { SequenceSpaceStatusList } from './SequenceSpaceStatusList';
import { formatTimestamp } from '../lib/format';
import {
  ARCHIVED_NOTE,
  REGISTRATION_LABEL,
  backfillLabel,
  backfillProgress,
  isAxisUnavailable,
  isBackfillActive,
  reconciliationSummary,
  valueKind,
  type RepositoryOverview,
} from '../lib/repository-overview';

/** 조회 실패·기록 없음·값 셋을 같은 자리에서 가른다. */
function AxisValue({
  item,
  axis,
  value,
  render,
  absent,
}: {
  readonly item: RepositoryOverview;
  readonly axis: string;
  readonly value: unknown;
  readonly render: () => ReactNode;
  readonly absent: string;
}): ReactNode {
  const kind = valueKind(item, axis, value);
  if (kind === 'unavailable') {
    return (
      <span data-testid={`${axis}-unavailable`} data-kind="unavailable">
        Unavailable
      </span>
    );
  }
  if (kind === 'absent') {
    return (
      <span data-testid={`${axis}-absent`} data-kind="absent">
        {absent}
      </span>
    );
  }
  return (
    <span data-testid={`${axis}-value`} data-kind="present">
      {render()}
    </span>
  );
}

export interface RepositoryCardGridProps {
  readonly repositories: readonly RepositoryOverview[];
  /** 카드 하나만 다시 조회한다. 자동 폴링하지 않는다. */
  readonly onRetry: (repository: string) => void;
}

export function RepositoryCardGrid({ repositories, onRetry }: RepositoryCardGridProps): ReactNode {
  return (
    <CardGrid data-testid="repository-cards">
      {repositories.map((item) => {
        const progress = backfillProgress(item.backfill);
        const countsUnavailable = isAxisUnavailable(item, 'document_counts');
        return (
          <Card key={item.repository_id} data-testid="repository-card" data-repository={item.repository}>
            <h3>{item.repository}</h3>

            <p>
              <Badge
                tone={item.registration_state === 'active' ? 'accent' : 'neutral'}
                data-testid="registration-state"
                data-state={item.registration_state}
              >
                {REGISTRATION_LABEL[item.registration_state]}
              </Badge>
            </p>
            {item.registration_state === 'archived' ? (
              <p data-testid="archived-note">{ARCHIVED_NOTE}</p>
            ) : null}

            <dl>
              <dt>Last ingested</dt>
              <dd>
                <AxisValue
                  item={item}
                  axis="last_ingested_at"
                  value={item.last_ingested_at}
                  absent="No ingestion records yet"
                  render={() => formatTimestamp(item.last_ingested_at as string)}
                />
              </dd>

              <dt>Searchable documents</dt>
              <dd>
                <AxisValue
                  item={item}
                  axis="document_counts"
                  value={countsUnavailable ? null : item.document_counts}
                  absent="No indexed documents yet"
                  render={() =>
                    `PR ${String(item.document_counts?.pull_requests ?? 0)} · Commits ${String(
                      item.document_counts?.commits ?? 0,
                    )} (total ${String(item.document_counts?.total ?? 0)})`
                  }
                />
              </dd>

              <dt>Backfill</dt>
              <dd data-testid="backfill">
                {isAxisUnavailable(item, 'backfill') ? (
                  <span data-kind="unavailable">Unavailable</span>
                ) : (
                  <>
                    <span data-testid="backfill-state">{backfillLabel(item.backfill)}</span>
                    {isBackfillActive(item.backfill) && progress !== null ? (
                      <Meter
                        value={progress.ratio * 100}
                        valueText={`${String(progress.processed)} / ${String(progress.total)}`}
                        aria-label={`${item.repository} Backfill progress`}
                        data-testid="backfill-progress"
                      />
                    ) : null}
                  </>
                )}
              </dd>

              <dt>Latest reconciliation scan</dt>
              <dd data-testid="reconciliation">
                {reconciliationSummary(item)}
                {item.reconciliation.last_completed_at === null ||
                isAxisUnavailable(item, 'reconciliation') ? null : (
                  <> ({formatTimestamp(item.reconciliation.last_completed_at)})</>
                )}
              </dd>
            </dl>

            {isAxisUnavailable(item, 'sequence_spaces') ? (
              <p data-testid="sequence_spaces-unavailable">Unable to check sequence space status</p>
            ) : (
              <SequenceSpaceStatusList spaces={item.sequence_spaces} />
            )}

            {item.unavailable.length > 0 ? (
              <Button
                variant="secondary"
                onClick={() => { onRetry(item.repository); }}
                data-testid="card-retry"
              >
                Refresh this repository
              </Button>
            ) : null}
          </Card>
        );
      })}
    </CardGrid>
  );
}
