'use client';

/**
 * C-026 AnchorInput (WP-025 / W-004-ANCHORS, FR-SEQ-003).
 *
 * **`boundary` 라벨이 상시다** (QA-W004-01). 반개구간 `(from, to]` 규칙이
 * 화면에 보이지 않으면 사용자는 경계 1건 차이로 잘못된 결론에 도달한다 —
 * 조건부로 그리면 안 되는 이유가 그것이다.
 *
 * 정규화 결과는 AC-5의 넷을 다 보여 준다: 원본 표현·서수·대상 커밋 SHA·에폭.
 * (에폭은 응답 공통값이라 부모가 `epoch` prop으로 넘긴다.)
 */

import type { ReactNode } from 'react';
import { Badge, TextField } from '@conductor-by-89soone/react';
import type { AnchorFailureView, ResolvedAnchorView } from '../lib/range';

export type AnchorFieldState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'resolving' }
  | { readonly kind: 'resolved'; readonly anchor: ResolvedAnchorView }
  | { readonly kind: 'failed'; readonly failure: AnchorFailureView | null; readonly message: string };

export interface AnchorInputProps {
  readonly id: string;
  readonly label: string;
  readonly boundary: 'exclusive' | 'inclusive';
  readonly value: string;
  readonly state: AnchorFieldState;
  /** 정규화 응답의 에폭. AC-5의 네 번째 값이다. */
  readonly epoch: number | null;
  readonly onChange: (value: string) => void;
  /** Enter — 정규화를 확정하는 사용자 행위다. 타이핑마다 서버를 부르지 않는다. */
  readonly onCommit: () => void;
}

function failureText(failure: AnchorFailureView | null, message: string): string {
  if (failure === null) return message;
  switch (failure.kind) {
    case 'not_on_branch':
      return '이 커밋은 대상 브랜치의 first-parent 체인에 없습니다.';
    case 'not_merged':
      return '아직 머지되지 않은 PR입니다 — 머지되면 서수를 받습니다.';
    case 'space_mismatch':
      return failure.releaseBranch === null
        ? '다른 시퀀스 공간의 앵커입니다. 브랜치를 바꿔 주세요.'
        : `이 앵커는 ${failure.releaseBranch} 브랜치의 것입니다. 브랜치를 바꿔 주세요.`;
    case 'unresolvable':
      return failure.ambiguous
        ? '여러 커밋에 걸리는 접두입니다 — 더 길게 입력해 주세요.'
        : message;
  }
}

export function AnchorInput({
  id,
  label,
  boundary,
  value,
  state,
  epoch,
  onChange,
  onCommit,
}: AnchorInputProps): ReactNode {
  const describedBy = `${id}-status`;
  return (
    <div data-testid={`anchor-${id}`}>
      <label htmlFor={`${id}-input`}>{label}</label>{' '}
      {/* 반개구간 규칙의 절반 — 상시 표기다 (QA-W004-01). */}
      <Badge tone="neutral" data-testid={`anchor-${id}-boundary`}>
        {boundary === 'exclusive' ? '제외' : '포함'}
      </Badge>
      <TextField
        id={`${id}-input`}
        data-testid={`anchor-${id}-input`}
        value={value}
        aria-describedby={describedBy}
        aria-invalid={state.kind === 'failed'}
        placeholder="태그 · SHA · #PR · 시각 · seq:N"
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onCommit();
        }}
        onBlur={() => {
          /*
           * blur 확정은 **미확정 텍스트(idle)일 때만**이다. 이미 해석·실패한
           * 값을 blur마다 다시 확정하면, 화면의 버튼(제안·교환·조회)을 누르는
           * 순간의 blur가 상태를 resolving으로 되돌려 그 버튼을 비활성·언마운트
           * 시킨다 — 클릭이 허공에 떨어진다.
           */
          if (state.kind === 'idle' && value.trim() !== '') onCommit();
        }}
      />
      <p id={describedBy} data-testid={`anchor-${id}-status`}>
        {state.kind === 'idle' ? '앵커를 입력하세요.' : null}
        {state.kind === 'resolving' ? '정규화하는 중…' : null}
        {state.kind === 'resolved' ? (
          <span data-testid={`anchor-${id}-resolved`}>
            {/* AC-5: 원본 표현 → 서수 · SHA(12자) · 에폭 */}
            {state.anchor.expression} → seq {state.anchor.mergeSeq} ·{' '}
            <code>{state.anchor.commitSha.slice(0, 12)}</code>
            {epoch === null ? '' : ` · 에폭 ${String(epoch)}`}
          </span>
        ) : null}
        {state.kind === 'failed' ? (
          <span data-testid={`anchor-${id}-error`} role="alert">
            {failureText(state.failure, state.message)}
            {state.failure?.kind === 'not_on_branch' && state.failure.suggestedSha !== null ? (
              <>
                {' '}
                제안:{' '}
                <button
                  type="button"
                  data-testid={`anchor-${id}-suggested`}
                  onClick={() => {
                    // 제안은 체인에 실재하는 머지 커밋이다 (QA-W004-05) — 넣고 곧장 재정규화한다.
                    onChange(state.failure !== null && state.failure.kind === 'not_on_branch' && state.failure.suggestedSha !== null ? state.failure.suggestedSha : value);
                  }}
                >
                  머지 커밋 사용
                </button>
              </>
            ) : null}
          </span>
        ) : null}
      </p>
    </div>
  );
}
