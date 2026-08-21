'use client';

/**
 * C-011 QueryTokenBar — 파싱된 토큰 칩과 오류 구간 (WP-016 / FR-SRCH-005).
 *
 * 칩 제거는 **문자열을 자르지 않고 AST를 고친다** (`lib/tokens.ts`). 이유는
 * 그 파일에 적었다.
 *
 * ## 오류 구간을 왜 여기서 보여 주는가
 *
 * FR-SRCH-005의 예외 처리가 "화면은 입력창에 오류 구간을 강조 표시한다"를
 * 요구한다. 파서가 문자 오프셋을 주므로(`offset_start`/`offset_end`) 원문을
 * 세 조각으로 잘라 가운데를 강조한다 — 오류 위치를 말로만 알려 주면 긴 질의에서
 * 찾을 수 없다.
 */

import type { ReactNode } from 'react';
import { Badge, IconButton } from '@conductor-by-89soone/react';
import type { QueryParseError } from '@prs/query';
import type { QueryChip } from '../lib/tokens';

export interface QueryTokenBarProps {
  readonly chips: readonly QueryChip[];
  readonly onRemove: (index: number) => void;
  /** 파서가 준 오류. 있으면 원문의 오류 구간을 강조한다. */
  readonly error?: QueryParseError | null;
  /** 오류 구간을 강조할 원문. `error`가 있을 때만 쓰인다. */
  readonly raw?: string;
}

/** 작은 × 글리프. 아이콘 라이브러리를 들이지 않는다 (QA-COMMON-17). */
function CloseGlyph(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/**
 * 오류 구간 강조.
 *
 * 오프셋이 원문 범위를 벗어나면 **강조하지 않고 원문만 보여 준다.** 잘못된
 * 오프셋으로 자르면 문자열이 깨져 사용자가 자기 질의를 알아볼 수 없게 된다.
 */
function Highlighted({ raw, error }: { raw: string; error: QueryParseError }): ReactNode {
  const { offset_start: start, offset_end: end } = error.detail;
  if (start < 0 || end > raw.length || start >= end) {
    return <code data-testid="query-echo">{raw}</code>;
  }

  return (
    <code data-testid="query-echo">
      {raw.slice(0, start)}
      <mark data-testid="query-error-range">{raw.slice(start, end)}</mark>
      {raw.slice(end)}
    </code>
  );
}

export function QueryTokenBar({ chips, onRemove, error, raw }: QueryTokenBarProps): ReactNode {
  if (error != null && raw !== undefined) {
    const supported = error.detail.supported_keys;
    const allowed = error.detail.allowed_values;

    return (
      <div data-testid="query-token-bar" role="group" aria-label="질의 토큰">
        <p role="alert">{error.message}</p>
        <Highlighted raw={raw} error={error} />
        {/*
         * 지원 키·허용 값을 **함께 보여 준다** (FR-SRCH-005 AC-4).
         * "지원하지 않는 키"만 말하면 사용자가 무엇을 쓸 수 있는지 모른다.
         */}
        {supported === undefined ? null : (
          <p data-testid="supported-keys">사용할 수 있는 키: {supported.join(', ')}</p>
        )}
        {allowed === undefined ? null : (
          <p data-testid="allowed-values">사용할 수 있는 값: {allowed.join(', ')}</p>
        )}
      </div>
    );
  }

  if (chips.length === 0) return null;

  return (
    <ul data-testid="query-token-bar" aria-label="적용된 필터">
      {chips.map((chip) => (
        <li key={`${chip.key}-${String(chip.index)}`}>
          <Badge tone={chip.negated ? 'warning' : 'neutral'} data-negated={chip.negated ? '' : undefined}>
            {/* 부정을 기호가 아니라 글자로도 밝힌다 — `-`는 읽히지 않는다. */}
            {chip.negated ? '제외 ' : ''}
            {chip.key}: {chip.value}
          </Badge>
          <IconButton
            aria-label={chip.removeLabel}
            icon={<CloseGlyph />}
            variant="ghost"
            size="sm"
            onClick={() => {
              onRemove(chip.index);
            }}
          />
        </li>
      ))}
    </ul>
  );
}
