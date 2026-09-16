'use client';

/**
 * W-002 동시 변경 하위 섹션 (WP-031 / CR-042, API-REL-003, FR-REL-007).
 *
 * ## 관계 섹션과 **독립이다**
 *
 * 저장된 간선 조회와 동시 변경은 다른 계산이다. 한쪽이 실패했다고 다른 쪽이나
 * 상세 본체를 비우지 않는다 (상태 매트릭스 W-002 `partial_failure`).
 *
 * ## 계산 불가는 오류가 아니다 (DEV-254)
 *
 * 미머지·보강 미완료·변경 파일 200개 초과는 **정상 도메인 상태**다. 사유를
 * 밝히고, **결과 0건과 다르게 그린다** — 전자는 "물을 수 없다", 후자는
 * "물었고 없다"이다.
 *
 * ## PR 전용이다
 *
 * FR-REL-007이 PR의 변경 경로 집합을 대상으로 정한다. 커밋 화면은 이 섹션을
 * 두지 않는다.
 */

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, Panel, Table } from './ui';
import { coChangeReasonLabel, judgeCoChanges, type CoChangeView } from '../lib/relations';

export interface CoChangeSectionProps {
  readonly repository: string;
  readonly prNumber: number;
  readonly sectionId: string;
}

type Outcome =
  | { readonly phase: 'idle' }
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly view: CoChangeView }
  | { readonly phase: 'error' };

export function CoChangeSection({
  repository,
  prNumber,
  sectionId,
}: CoChangeSectionProps): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ phase: 'idle' });
  const requested = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return (): void => {
      alive.current = false;
    };
  }, []);

  const load = (): void => {
    setOutcome({ phase: 'loading' });
    const query = new URLSearchParams({ repository, pr_number: String(prNumber) });

    void (async (): Promise<void> => {
      try {
        const response = await fetch(`/api/co-changes?${query.toString()}`, { cache: 'no-store' });
        if (!alive.current) return;
        if (!response.ok) {
          setOutcome({ phase: 'error' });
          return;
        }
        const body: unknown = await response.json();
        if (!alive.current) return;
        const view = judgeCoChanges(body);
        setOutcome(view === null ? { phase: 'error' } : { phase: 'ready', view });
      } catch {
        if (alive.current) setOutcome({ phase: 'error' });
      }
    })();
  };

  return (
    <Panel as="section" aria-labelledby={`${sectionId}-heading`} data-testid={`section-${sectionId}`}>
      <h2 id={`${sectionId}-heading`}>Co-changes</h2>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={expanded}
        aria-controls={`${sectionId}-body`}
        data-testid={`toggle-${sectionId}`}
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          if (next && !requested.current) {
            requested.current = true;
            load();
          }
        }}
      >
        {expanded ? "Collapse" : "Expand"}
      </Button>

      <div id={`${sectionId}-body`} hidden={!expanded} data-testid={`body-${sectionId}`}>
        {outcome.phase === 'loading' ? <p data-testid="cochange-loading">Loading…</p> : null}

        {outcome.phase === 'error' ? (
          <p data-testid="cochange-error">
            Unable to load co-changes.{' '}
            <Button type="button" data-testid="cochange-retry" onClick={load}>
              Try again
            </Button>
          </p>
        ) : null}

        {outcome.phase === 'ready' && outcome.view.kind === 'unavailable' ? (
          <p data-testid="cochange-unavailable">
            <Badge tone="neutral">Cannot calculate</Badge> {coChangeReasonLabel(outcome.view.reason)}
          </p>
        ) : null}

        {outcome.phase === 'ready' && outcome.view.kind === 'ready' ? (
          outcome.view.items.length === 0 ? (
            <p data-testid="cochange-empty">No PRs share changed paths.</p>
          ) : (
            <Table caption="Co-change correlations (top 20, highest overlap first)">
              <Table.Head>
                <Table.Row>
                  <Table.HeaderCell scope="col">PR</Table.HeaderCell>
                  <Table.HeaderCell scope="col">Author</Table.HeaderCell>
                  <Table.HeaderCell scope="col">Overlap</Table.HeaderCell>
                  <Table.HeaderCell scope="col">Overlapping paths</Table.HeaderCell>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {outcome.view.items.map((item) => (
                  <Table.Row key={`${item.repository ?? ''}#${String(item.prNumber)}`} data-testid="cochange-row">
                    <Table.Cell>
                      {item.url === null ? (
                        <span>{item.title ?? `#${String(item.prNumber)}`}</span>
                      ) : (
                        <Link href={item.url} data-testid="cochange-link">
                          {`#${String(item.prNumber)}`} {item.title ?? ''}
                        </Link>
                      )}
                    </Table.Cell>
                    <Table.Cell>{item.author ?? '—'}</Table.Cell>
                    <Table.Cell>{item.similarity.toFixed(4)}</Table.Cell>
                    <Table.Cell>
                      <ul>
                        {item.overlappingPaths.map((path) => (
                          <li key={path}>{path}</li>
                        ))}
                      </ul>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )
        ) : null}
      </div>
    </Panel>
  );
}
