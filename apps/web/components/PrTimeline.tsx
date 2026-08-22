'use client';

/**
 * C-022 PrTimeline — 생성 → 첫 리뷰 → 승인 → 머지 → 릴리스 (WP-017).
 *
 * ## 네 상태를 다르게 그린다 (CR-020, DEV-084)
 *
 * | 상태 | 뜻 | 그리는 법 |
 * | --- | --- | --- |
 * | `done` | 일어났고 시각을 안다 | 시각 표시 |
 * | `done_at_unknown` | **일어났으나 시각을 모른다** | 일어났다고 표시하고 **왜 시각이 없는지** 밝힌다 |
 * | `pending` | 아직 일어나지 않았다 | 대기로 표시 |
 * | `out_of_scope` | 이 릴리스 범위 밖 | 사유와 함께 흐리게 |
 *
 * 승인이 `done_at_unknown`인 것이 이 컴포넌트의 존재 이유다 — `approved_by`는
 * 있는데 `approved_at`이 매핑에 없다. `pending`으로 그리면 **승인된 PR을
 * "승인 대기"로 표시하게 된다.**
 */

import type { ReactNode } from 'react';
import { Badge, Timeline } from '@conductor-by-89soone/react';
import type { TimelineStatus, TimelineStep } from '../lib/pr-detail';

export interface PrTimelineProps {
  readonly steps: readonly TimelineStep[];
}

/** 상태별 표식. **색만으로 구분하지 않는다** — 글자를 함께 둔다. */
const MARK: Readonly<Record<TimelineStatus, { readonly tone: 'accent' | 'neutral' | 'info'; readonly text: string }>> = {
  done: { tone: 'accent', text: '완료' },
  done_at_unknown: { tone: 'info', text: '완료 (시각 미상)' },
  pending: { tone: 'neutral', text: '대기' },
  out_of_scope: { tone: 'neutral', text: '미지원' },
};

export function PrTimeline({ steps }: PrTimelineProps): ReactNode {
  return (
    <section aria-labelledby="timeline-heading" data-testid="pr-timeline">
      <h2 id="timeline-heading">타임라인</h2>
      <Timeline>
        {steps.map((step) => {
          const mark = MARK[step.status];
          return (
            <Timeline.Step key={step.key} data-testid={`timeline-${step.key}`} data-status={step.status}>
              <strong>{step.label}</strong>
              <Badge tone={mark.tone}>{mark.text}</Badge>
              {step.at === null ? null : <time dateTime={step.at}>{step.at}</time>}
              {/*
               * 사유를 반드시 보여 준다. "완료 (시각 미상)"만 보면 사용자는
               * 버그로 읽는다 — 왜 모르는지 말해야 납득한다.
               */}
              {step.note === null ? null : <p data-testid={`timeline-note-${step.key}`}>{step.note}</p>}
            </Timeline.Step>
          );
        })}
      </Timeline>
    </section>
  );
}
