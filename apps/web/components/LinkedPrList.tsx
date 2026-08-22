'use client';

/**
 * W-003-PR 소속 PR (WP-018 / FR-SRCH-002 AC-1·2·4·5).
 *
 * ## 세 경우를 섞지 않는다 (CR-021, DEV-093)
 *
 * | 상태 | 뜻 | 문구 |
 * | --- | --- | --- |
 * | `linked` | PR을 찾았다 (둘 이상이면 `multi_pr`) | 목록 |
 * | `direct_push` | **PR을 거치지 않았다** | "PR 없음 (직접 푸시)" |
 * | `not_linked_yet` | 투영이 아직 PR 번호를 잇지 못했다 | "아직 PR 연결을 찾지 못했습니다" |
 *
 * 뒤의 둘을 섞는 것이 이 화면에서 가장 하기 쉬운 거짓말이다. 서버의
 * `reason_code: 'no_pull_request'`는 **"아직 못 이었다"**인데(`detail.ts`가
 * 주석으로 명시한다) 그것을 "직접 푸시"라고 쓰면, 사용자는 **PR 리뷰를 거치지
 * 않고 브랜치에 들어간 커밋**이라고 읽는다. 감사에서 그것은 지적 사항이 된다.
 *
 * `direct_push`는 WP-021 전까지 도달하지 않는다(DEV-061). 그래도 분기를 두는
 * 이유는 값이 오는 날 문구가 저절로 옳아지게 하기 위해서다.
 */

import type { ReactNode } from 'react';
import { Badge, Panel, Table } from '@conductor-by-89soone/react';
import type { LinkedPrState, LinkedPullRequest } from '../lib/commit-detail';

export interface LinkedPrListProps {
  readonly state: LinkedPrState;
  readonly pullRequests: readonly LinkedPullRequest[];
  /** PR 보강이 안 끝났다. **"PR 연결이 없다"와 다른 것이다** (DEV-095). */
  readonly enrichmentPending: boolean;
  readonly onRefetch: () => void;
  readonly refetching: boolean;
}

export function LinkedPrList({
  state,
  pullRequests,
  enrichmentPending,
  onRefetch,
  refetching,
}: LinkedPrListProps): ReactNode {
  return (
    <Panel as="section" aria-labelledby="linked-pr-heading" data-testid="linked-prs" data-pr-state={state}>
      <h2 id="linked-pr-heading">
        소속 PR{' '}
        {/* 둘 이상이면 그 사실 자체가 정보다 (`multi_pr`, AC-5). */}
        {pullRequests.length > 1 ? (
          <Badge tone="info" data-testid="multi-pr-badge">
            PR {pullRequests.length}건
          </Badge>
        ) : null}
      </h2>

      {/*
       * 보강 중임을 **목록과 별개로** 알린다 (DEV-095). 이미 이어진 PR은
       * 그대로 보이고, 다만 나중에 늘 수 있다 — 사용자가 기다릴지 판단할 수
       * 있어야 한다.
       */}
      {enrichmentPending ? (
        <div data-testid="pr-enrichment-pending">
          <Badge tone="warning">수집 중</Badge>
          <p>이 PR의 보강이 아직 끝나지 않았습니다. 목록이 나중에 늘 수 있습니다.</p>
          <button type="button" onClick={onRefetch} disabled={refetching} data-testid="pr-refetch">
            다시 조회
          </button>
        </div>
      ) : null}

      {state === 'direct_push' ? (
        <p data-testid="direct-push">
          PR 없음 (직접 푸시). 이 커밋은 PR을 거치지 않고 대상 브랜치에 직접 반영되었습니다.
        </p>
      ) : null}

      {state === 'not_linked_yet' ? (
        /*
         * **"직접 푸시"라고 쓰지 않는다.** 아직 못 이은 것과 거치지 않은 것은
         * 전혀 다른 사실이고, 사용자가 할 일도 다르다.
         */
        <p data-testid="not-linked-yet">
          아직 PR 연결을 찾지 못했습니다. 수집이 진행 중이거나, 이 커밋이 속한 PR이 아직 색인되지
          않았을 수 있습니다.
        </p>
      ) : null}

      {state === 'linked' ? (
        <Table caption="이 커밋이 속한 PR">
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell scope="col">PR</Table.HeaderCell>
              <Table.HeaderCell scope="col">제목</Table.HeaderCell>
              <Table.HeaderCell scope="col">작성자</Table.HeaderCell>
              <Table.HeaderCell scope="col">리뷰어</Table.HeaderCell>
              <Table.HeaderCell scope="col">머지 시각</Table.HeaderCell>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {pullRequests.map((pr) => (
              <Table.Row key={pr.pr_number ?? pr.url} data-testid="linked-pr-row">
                <Table.Cell>
                  {/* 진짜 링크다 — 새 탭·북마크·복사가 전부 성립해야 한다. */}
                  {pr.url === undefined ? (
                    <span>#{pr.pr_number === undefined ? '—' : String(pr.pr_number)}</span>
                  ) : (
                    <a href={pr.url} data-testid="linked-pr-link">
                      #{pr.pr_number === undefined ? '—' : String(pr.pr_number)}
                    </a>
                  )}
                </Table.Cell>
                <Table.Cell>{pr.title ?? '—'}</Table.Cell>
                <Table.Cell>{pr.author ?? '—'}</Table.Cell>
                {/* AC-4가 리뷰어 목록을 요구한다. 없으면 없다고 쓴다. */}
                <Table.Cell>{(pr.reviewers ?? []).length === 0 ? '—' : (pr.reviewers ?? []).join(', ')}</Table.Cell>
                <Table.Cell>
                  {pr.merged_at === undefined ? (
                    <span data-testid="not-merged">미머지</span>
                  ) : (
                    <time dateTime={pr.merged_at}>{pr.merged_at}</time>
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      ) : null}
    </Panel>
  );
}
