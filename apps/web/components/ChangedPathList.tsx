'use client';

/**
 * C-025 ChangedPathList — 변경 경로와 라인 수 (WP-018 / W-003-PATHS).
 *
 * ## 파일 내용을 다루지 않는다
 *
 * `QA-W003-08`이고 SRS 4.3이며 NFR-005다. 이 컴포넌트는 **경로 문자열과 숫자
 * 둘**만 받는다 — patch·diff·본문을 담을 prop이 아예 없다. 타입이 그것을
 * 막는 것이 이 설계의 요점이다: 나중에 누가 "미리보기를 붙이자"고 해도
 * 이 컴포넌트에는 붙일 자리가 없다.
 *
 * **금지 규칙이라 데이터 없이 지금 세운다** (CR-021, DEV-094). 데이터가 온
 * 뒤에 검사하면 이미 잘못 만든 뒤다 — WP-016의 `QA-W001-14`, WP-017의
 * `QA-W002-17`과 같은 판단이다.
 *
 * ## 세지 않은 것을 0으로 그리지 않는다
 *
 * `totalCount: null`은 "세지 않았다"이고 `0`은 "바꾼 파일이 없다"다. 후자로
 * 그리면 **빈 커밋**이라는 거짓이 된다 (DEV-094; C-018의 DEV-083과 같은 규칙).
 */

import type { ReactNode } from 'react';
import { Badge, Panel, Table } from './ui';
import { pathCountLabel, type ChangedPathModel } from '../lib/commit-detail';

export interface ChangedPathListProps extends ChangedPathModel {
  /** 데이터를 채울 WP. 운영·개발이 추적할 수 있게 남긴다. */
  readonly owner: string;
}

export function ChangedPathList({
  paths,
  totalCount,
  truncated,
  notCollected,
  owner,
}: ChangedPathListProps): ReactNode {
  const model = { paths, totalCount, truncated, notCollected };

  return (
    <Panel as="section" aria-labelledby="paths-heading" data-testid="changed-paths">
      <h2 id="paths-heading">
        Changed paths {notCollected ? <Badge tone="neutral">Not yet available</Badge> : null}
      </h2>

      {notCollected ? (
        /*
         * 섹션을 **숨기지 않는다** — 숨기면 "이 커밋은 아무것도 바꾸지
         * 않았다"로 읽힌다. W-002의 골격 섹션과 같은 원칙이다.
         */
        <>
          <p data-testid="paths-reason">
            Changed paths have not been collected yet. Ingestion events provide only the commit SHA.
          </p>
          <p>
            <span className="ui-sr-only">Work package: </span>
            {owner}
          </p>
        </>
      ) : (
        <>
          <Table caption="Paths changed by this commit">
            <Table.Head>
              <Table.Row>
                <Table.HeaderCell scope="col">Path</Table.HeaderCell>
                <Table.HeaderCell scope="col">Added</Table.HeaderCell>
              <Table.HeaderCell scope="col">Removed</Table.HeaderCell>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {paths.map((one) => (
                <Table.Row key={one.path} data-testid="path-row">
                  {/* 경로 문자열뿐이다. 내용을 여는 링크도 두지 않는다. */}
                  <Table.Cell>
                    <code className="ui-mono">{one.path}</code>
                  </Table.Cell>
                  <Table.Cell>{one.additions === undefined ? '—' : `+${String(one.additions)}`}</Table.Cell>
                  <Table.Cell>{one.deletions === undefined ? '—' : `-${String(one.deletions)}`}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
          <p data-testid="path-count">{pathCountLabel(model)}</p>
        </>
      )}
    </Panel>
  );
}
