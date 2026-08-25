'use client';

/**
 * C-019 NeighborSequenceList — W-002-NEIGHBORS / W-003-SEQPOS (WP-027, CR-031).
 *
 * **직접 푸시 커밋 행을 지우지 않는다** (DEV-161). 빼면 목록의 서수가 건너뛴 채
 * 보여 사용자가 누락으로 읽는다 — 이 제품이 지켜야 하는 것은 "서수가
 * `git log --first-parent`와 대조된다"는 사실이다. 그 행은 제목·작성자가 없고
 * **소속 PR의 값으로 대신 채우지 않는다** (DEV-090).
 *
 * **순서를 바꾸지 않는다** — 서버가 서수 오름차순을 보장하고 여기서 다시 정렬하지
 * 않는다 (`RangeResultTable`·C-020과 같은 규칙).
 *
 * `no_sequence`에서도 **컴포넌트를 숨기지 않는다.** 숨기면 사용자가 기능 부재로
 * 오인한다. 다만 "머지되지 않았다"(사실 주장)와 "아직 모른다"는 **다른 문구**여야
 * 한다 (C-014의 DEV-077).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Badge, Banner, Panel, Table } from '@conductor-by-89soone/react';
import {
  DEFAULT_NEIGHBOR_COUNT,
  NEIGHBOR_COUNT_OPTIONS,
  clampNeighborCount,
  judgeNeighborEpoch,
  judgeNeighbors,
  judgeNoSequence,
  neighborRangeHref,
  type NeighborRowView,
  type NeighborsView,
  type NoSequenceReason,
} from '../lib/neighbors';
import { formatTimestamp } from '../lib/format';

export interface NeighborSequenceListProps {
  readonly neighbors: readonly NeighborRowView[];
  readonly anchorSeq: number;
  readonly count: number;
  readonly onCountChange: (next: number) => void;
  readonly boundary: { readonly atStart: boolean; readonly atEnd: boolean };
}

function label(row: NeighborRowView): string {
  if (row.title !== null) return row.title;
  if (row.prNumber !== null) return `#${String(row.prNumber)}`;
  return row.commitSha.slice(0, 12);
}

export function NeighborSequenceList({
  neighbors,
  anchorSeq,
  count,
  onCountChange,
  boundary,
}: NeighborSequenceListProps): ReactNode {
  return (
    <div data-testid="neighbor-list">
      <label htmlFor="neighbor-count">앞뒤 표시 건수</label>
      <select
        id="neighbor-count"
        data-testid="neighbor-count"
        value={count}
        onChange={(event) => {
          onCountChange(Number(event.target.value));
        }}
      >
        {NEIGHBOR_COUNT_OPTIONS.map((option) => (
          <option key={option} value={option}>
            앞뒤 각 {option}건
          </option>
        ))}
      </select>

      {/* 경계는 오류가 아니라 사실이다 (AC-4) — 모자란 것이 아니라 더 없는 것이다. */}
      {boundary.atStart ? (
        <p data-testid="neighbor-at-start">이 앞에는 더 없습니다 — 시퀀스 공간의 시작입니다.</p>
      ) : null}

      <Table caption={`시퀀스 ${String(anchorSeq)} 기준 선행·후행 (서수 오름차순)`}>
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell scope="col">seq</Table.HeaderCell>
            <Table.HeaderCell scope="col">항목</Table.HeaderCell>
            <Table.HeaderCell scope="col">작성자</Table.HeaderCell>
            <Table.HeaderCell scope="col">머지 시각</Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {neighbors.map((row) => (
            <Table.Row
              key={`${String(row.mergeSeq)}-${row.commitSha}`}
              data-testid="neighbor-row"
              data-anchor={row.isAnchor ? 'true' : 'false'}
            >
              <Table.Cell>{row.mergeSeq}</Table.Cell>
              <Table.Cell>
                <Link href={row.url} data-testid="neighbor-link">
                  {label(row)}
                </Link>{' '}
                {row.isAnchor ? (
                  /* 기준 개체는 강조한다 (AC-3). 색만으로 말하지 않는다 — 배지 문자열이 근거다. */
                  <Badge tone="accent" data-testid="neighbor-anchor-badge">
                    이 항목
                  </Badge>
                ) : null}
                {row.kind === 'commit' ? (
                  <Badge tone="neutral" data-testid="neighbor-direct-push">
                    직접 푸시
                  </Badge>
                ) : null}
                {row.indexed ? null : (
                  <Badge tone="neutral" data-testid="neighbor-unindexed">
                    색인 대기
                  </Badge>
                )}
              </Table.Cell>
              <Table.Cell>{row.author ?? '—'}</Table.Cell>
              <Table.Cell>{formatTimestamp(row.mergedAt)}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>

      {boundary.atEnd ? (
        <p data-testid="neighbor-at-end">이 뒤에는 더 없습니다 — 시퀀스 공간의 끝입니다.</p>
      ) : null}
    </div>
  );
}

export interface NeighborUnavailableProps {
  readonly reason: NoSequenceReason | null;
  /** 커밋 화면은 역할로 "체인 밖"을 알 수 있다 — 서버는 가릴 수 없는 구분이다 (DEV-092). */
  readonly offChain?: boolean;
}

/**
 * 시퀀스가 없을 때의 자리. **섹션을 숨기지 않는다** (QA-W002-07).
 *
 * 세 문구가 서로 다르다: "머지되지 않았다"는 사실 주장이고, "체인 밖"은 정의상
 * 서수가 없는 것이며, "아직 모른다"는 채번을 기다리는 상태다. 하나로 묶으면
 * 화면이 근거 없는 주장을 하게 된다 (C-014, DEV-077).
 */
export function NeighborUnavailable({ reason, offChain = false }: NeighborUnavailableProps): ReactNode {
  if (offChain) {
    return (
      <p data-testid="neighbor-off-chain">
        이 커밋은 대상 브랜치의 first-parent 체인 밖이라 서수가 없습니다 — 앞뒤를 셀 기준이
        없습니다. 이 변경이 반영된 머지 커밋에서 확인하세요.
      </p>
    );
  }
  if (reason === 'not_merged') {
    return (
      <p data-testid="neighbor-not-merged">
        아직 머지되지 않아 머지 시퀀스가 없습니다. 머지되면 앞뒤가 표시됩니다.
      </p>
    );
  }
  if (reason === 'not_sequenced') {
    return (
      <p data-testid="neighbor-not-sequenced">
        머지 시퀀스를 아직 부여받지 못했습니다 — 채번이 끝나면 표시됩니다. 머지되지 않았다는
        뜻은 아닙니다.
      </p>
    );
  }
  return (
    <p data-testid="neighbor-unknown-reason">
      앞뒤를 표시할 수 없습니다. 사유를 확인하지 못했습니다.
    </p>
  );
}

/** 조회 상태. `skip`이면 이 기계는 아예 돌지 않는다. */
type SectionOutcome =
  | { readonly phase: 'idle' }
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly view: NeighborsView }
  | { readonly phase: 'no_sequence'; readonly reason: NoSequenceReason | null }
  | { readonly phase: 'error' };

export type NeighborAnchor =
  | { readonly kind: 'pull_request'; readonly prNumber: number }
  | { readonly kind: 'commit'; readonly commitSha: string };

export interface NeighborSectionProps {
  readonly repository: string;
  readonly sectionId: string;
  readonly anchor: NeighborAnchor;
  /** 범위 확장 링크가 쓸 공간. 응답이 알려 주기 전까지는 문서가 아는 값이다. */
  readonly baseBranch: string | null;
  /** 문서가 실어 온 에폭. 응답의 현재 에폭과 비교한다 (QA-W002-16). */
  readonly documentEpoch: number | null;
  /**
   * 화면이 **이미 아는** 사유. 있으면 조회하지 않는다 (CR-031, DEV-164).
   *
   * 미머지 PR의 409를 일부러 유발해 놓고 받아 내지 않는다 — PR 문서의 `state`로
   * 아는 사실이다. 커밋 화면은 역할로 "체인 밖"까지 안다 (DEV-092).
   */
  readonly skip?: { readonly reason: NoSequenceReason | null; readonly offChain?: boolean };
}

/**
 * `/sequence-neighbors`를 조회해 C-019를 채우는 컨테이너.
 *
 * **진입 시에는 부르지 않는다** (QA-W002-17, CR-031 DEV-162). 접힘이 기본이고
 * 펼칠 때 1회 부른다 — 상세 진입의 네트워크 요청은 문서 하나여야 하고, a11y
 * 계층이 그 수를 실제로 센다. 건수 변경은 **사용자의 조작**이므로 그때는 다시
 * 부른다 (`pr.neighbors_expand`).
 */
export function NeighborSection({
  repository,
  sectionId,
  anchor,
  baseBranch,
  documentEpoch,
  skip,
}: NeighborSectionProps): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const [count, setCount] = useState<number>(DEFAULT_NEIGHBOR_COUNT);
  const [outcome, setOutcome] = useState<SectionOutcome>({ phase: 'idle' });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return (): void => {
      alive.current = false;
    };
  }, []);

  /**
   * 조회하지 않는 자리. `skip`(화면이 이미 아는 사유)에 **공간 미상**을 더한다.
   *
   * 대상 브랜치를 모르면 어느 시퀀스 공간을 물을지 정할 수 없다 (CR-032, DEV-168).
   * 그때 `base_branch` 없이 물어 서버가 공간을 고르게 하거나 `main`으로 지어내지
   * 않는다 — 사유를 확인하지 못했다고 말한다.
   */
  const unavailable: NeighborSectionProps['skip'] | undefined =
    skip ?? (baseBranch === null ? { reason: null } : undefined);

  const load = useCallback(
    (next: number): void => {
      if (skip !== undefined || baseBranch === null) return;
      setOutcome({ phase: 'loading' });
      const query = new URLSearchParams({
        repository,
        // 공간을 요청이 지정한다 (CR-032, DEV-168). 화면이 이미 아는 값이다.
        base_branch: baseBranch,
        count: String(clampNeighborCount(next)),
      });
      if (anchor.kind === 'pull_request') query.set('pr_number', String(anchor.prNumber));
      else query.set('commit_sha', anchor.commitSha);

      void (async (): Promise<void> => {
        try {
          // 프록시가 `/api/<rest>`를 업스트림 `/api/v1/<rest>`로 옮긴다 (lib/proxy.ts).
          const response = await fetch(`/api/sequence-neighbors?${query.toString()}`, {
            cache: 'no-store',
          });
          const body: unknown = await response.json();
          if (!alive.current) return;
          if (response.status === 409) {
            setOutcome({ phase: 'no_sequence', reason: judgeNoSequence(body) });
            return;
          }
          if (!response.ok) {
            setOutcome({ phase: 'error' });
            return;
          }
          const view = judgeNeighbors(body);
          setOutcome(view === null ? { phase: 'error' } : { phase: 'ready', view });
        } catch {
          if (alive.current) setOutcome({ phase: 'error' });
        }
      })();
    },
    [repository, baseBranch, anchor, skip],
  );

  const view = outcome.phase === 'ready' ? outcome.view : null;
  const epoch = judgeNeighborEpoch(documentEpoch, view?.seqEpoch ?? null);
  const rangeHref =
    view === null || baseBranch === null
      ? null
      : neighborRangeHref(repository, baseBranch, view.items, view.seqEpoch);

  return (
    <Panel as="section" aria-labelledby={`${sectionId}-heading`} data-testid={`section-${sectionId}`}>
      <h2 id={`${sectionId}-heading`}>선행·후행</h2>

      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`${sectionId}-body`}
        data-testid={`toggle-${sectionId}`}
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          // 펼칠 때만, 그리고 아직 부른 적 없을 때만 (QA-W002-17).
          if (next && outcome.phase === 'idle') load(count);
        }}
      >
        {expanded ? '접기' : '펼치기'}
      </button>

      <div id={`${sectionId}-body`} hidden={!expanded} data-testid={`body-${sectionId}`}>
        {unavailable !== undefined ? (
          <NeighborUnavailable
            reason={unavailable.reason}
            {...(unavailable.offChain === undefined ? {} : { offChain: unavailable.offChain })}
          />
        ) : null}

        {outcome.phase === 'loading' ? <p data-testid="neighbors-loading">불러오는 중…</p> : null}
        {/*
          * 실패에서 **빠져나갈 길을 함께 낸다** (CR-032, DEV-170). 안내만 두면
          * 접었다 펴도 `phase`가 `idle`이 아니라 다시 부르지 않고, 건수 조절은
          * 결과가 있을 때만 그려지므로 상세 화면 전체를 새로 여는 것 말고는
          * 복구 수단이 없다 — 화면이 따를 수 없는 지시를 하지 않는다.
          */}
        {outcome.phase === 'error' ? (
          <>
            <p data-testid="neighbors-error">선행·후행을 불러오지 못했습니다.</p>
            <button type="button" data-testid="neighbors-retry" onClick={() => { load(count); }}>
              다시 시도
            </button>
          </>
        ) : null}
        {outcome.phase === 'no_sequence' ? <NeighborUnavailable reason={outcome.reason} /> : null}

        {view !== null ? (
          <>
            {/*
              * 에폭이 어긋나면 **경고만** 낸다 (QA-W002-16, FR-SEQ-005 AC-4).
              * 자동으로 다시 부르면 화면이 인용하던 번호가 조용히 다른 커밋을
              * 가리키게 된다 — W-004와 같은 규칙이다.
              */}
            {epoch === 'stale' ? (
              <Banner tone="warning" title="시퀀스가 재채번되었습니다" data-testid="neighbors-epoch-stale">
                <p>
                  이 화면이 표시한 시퀀스는 에폭 {String(documentEpoch)} 기준이고 지금은 에폭{' '}
                  {String(view.seqEpoch)}입니다. 이전에 인용한 범위는 무효이며, 아래 목록은 현재
                  에폭 기준입니다.
                </p>
              </Banner>
            ) : null}

            <NeighborSequenceList
              neighbors={view.items}
              anchorSeq={view.anchorSeq}
              count={count}
              onCountChange={(next) => {
                setCount(next);
                // 건수 변경은 사용자의 조작이다 — 그때는 다시 부른다.
                load(next);
              }}
              boundary={view.boundary}
            />

            {rangeHref === null ? null : (
              <Link href={rangeHref} data-testid="neighbors-range-expand">
                범위로 확장
              </Link>
            )}
          </>
        ) : null}
      </div>
    </Panel>
  );
}
