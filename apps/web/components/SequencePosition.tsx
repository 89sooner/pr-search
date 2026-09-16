'use client';

/**
 * W-003-SEQPOS 시퀀스 위치 (WP-018 / FR-SEQ-001).
 *
 * ## 세 갈래를 다르게 그린다 (CR-021, DEV-092)
 *
 * - `off_chain` — **대상 브랜치 first-parent 체인 밖**이다. 오류가 아니라
 *   원본 커밋에서 정상적으로 일어나는 일이고, 머지 커밋으로 가는 길을 준다
 * - `not_computed` — 체인 위에 있는데 **아직 채번하지 않았다** (WP-021)
 * - `assigned` — 채번됐다. 앞뒤 인접 커밋은 WP-027이다
 *
 * `off_chain`을 "시퀀스 없음"으로 뭉뚱그리면 사용자는 **데이터가 빠졌다**고
 * 읽는다. 실제로는 그 커밋이 브랜치에 직접 착지하지 않았다는 **사실**이고,
 * 그 사실이 바로 다음 조사 단계(머지 커밋)를 가리킨다.
 */

import type { ReactNode } from 'react';
import { Badge, Panel } from './ui';
import { shortSha } from '../lib/format';
import type { SequencePositionState } from '../lib/commit-detail';

export interface SequencePositionProps {
  readonly state: SequencePositionState;
  readonly mergeSeq: number | null;
  readonly seqEpoch: number | null;
  readonly sequenceSpace: string | null;
  /** 원본 커밋이 실제로 착지한 머지 커밋. 미머지 PR만 있으면 `null`이다. */
  readonly landedAs: string | null;
  readonly repository: string;
}

export function SequencePosition({
  state,
  mergeSeq,
  seqEpoch,
  sequenceSpace,
  landedAs,
  repository,
}: SequencePositionProps): ReactNode {
  return (
    <Panel as="section" aria-labelledby="seqpos-heading" data-testid="sequence-position" data-seq-state={state}>
      <h2 id="seqpos-heading">Sequence position</h2>

      {state === 'assigned' ? (
        <p data-testid="seq-assigned">
          <Badge tone="accent">
            seq {String(mergeSeq)}
            {seqEpoch === null ? '' : ` @e${String(seqEpoch)}`}
          </Badge>{' '}
          {sequenceSpace === null ? null : <span>Sequence space: {sequenceSpace}</span>}
        </p>
      ) : null}

      {state === 'off_chain' ? (
        <div data-testid="seq-off-chain">
          <Badge tone="neutral">Off chain</Badge>
          <p>
            This commit is not directly present on the base branch.
            {landedAs === null
              ? "The containing PR is not merged, so no merge commit is available."
              : "Introduced by the merge commit below."}
          </p>
          {landedAs === null ? null : (
            <p>
              {/*
               * 상태 매트릭스가 정한 복구 경로다 — "머지 커밋 이동".
               * 이 링크를 만들 재료가 CR-021 DEV-091로 응답에 더해졌다.
               */}
              <a href={`/commit/${repository}/${landedAs}`} data-testid="landed-as-link">
                Merge commit {shortSha(landedAs)}
              </a>
            </p>
          )}
        </div>
      ) : null}

      {state === 'not_computed' ? (
        <div data-testid="seq-not-computed">
          <Badge tone="neutral">Not numbered</Badge>
          {/*
           * **`off_chain`과 다른 문구다.** 이 커밋은 체인 위에 있고 번호만
           * 아직 없다 — 기다리면 생긴다. 체인 밖은 기다려도 생기지 않는다.
           */}
          <p>This commit is on the base branch but has not received a merge sequence number.</p>
        </div>
      ) : null}

      <p>
        <span className="ui-sr-only">Work package: </span>
        WP-021 (sequence numbering), WP-027 (neighboring commits)
      </p>
    </Panel>
  );
}
