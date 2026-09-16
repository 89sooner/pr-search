'use client';

/**
 * C-011 QueryTokenBar — 파싱된 토큰 칩과 오류 구간 (WP-016 / FR-SRCH-005 · CR-093).
 *
 * 칩 제거는 **문자열을 자르지 않고 AST를 고친다** (`lib/tokens.ts`). 이유는
 * 그 파일에 적었다.
 *
 * ## 칩은 Conductor `FilterChip`이다 (0.4.1)
 *
 * 0.3.1에는 제거 가능한 칩이 없어 `Badge`와 `IconButton`을 붙여 만들었다. `FilterChip`이
 * 그 조합(글자 + 이름 붙은 제거 버튼)을 주므로 그것을 쓴다. 제거 버튼의 접근 이름
 * (`author:kim 필터 제거`, 부정이면 `제외 조건 …`)은 `lib/tokens.ts`가 정하고 여기서는
 * 그대로 넘긴다. **부정은 기호가 아니라 글자로도 밝힌다** — `-`는 읽히지 않는다.
 *
 * ## 오류 구간을 왜 여기서 보여 주는가
 *
 * FR-SRCH-005의 예외 처리가 "화면은 입력창에 오류 구간을 강조 표시한다"를
 * 요구한다. 파서가 문자 오프셋을 주므로(`offset_start`/`offset_end`) 원문을
 * 세 조각으로 잘라 가운데를 강조한다 — 오류 위치를 말로만 알려 주면 긴 질의에서
 * 찾을 수 없다.
 */

import type { ReactNode } from 'react';
import { FilterChip, FilterToolbar } from '@conductor-by-89soone/react';
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

/**
 * 오류 구간 강조.
 *
 * 오프셋이 원문 범위를 벗어나면 **강조하지 않고 원문만 보여 준다.** 잘못된
 * 오프셋으로 자르면 문자열이 깨져 사용자가 자기 질의를 알아볼 수 없게 된다.
 */
function Highlighted({ raw, error }: { raw: string; error: QueryParseError }): ReactNode {
  const { offset_start: start, offset_end: end } = error.detail;
  if (start < 0 || end > raw.length || start >= end) {
    return <code className="cdt-mono" data-testid="query-echo">{raw}</code>;
  }

  return (
    <code className="cdt-mono" data-testid="query-echo">
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
      <div data-testid="query-token-bar" role="group" aria-label="질의 토큰" className="prs-query-error">
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
    /*
     * `FilterToolbar`는 flex-wrap div일 뿐이라 목록 의미는 여기서 준다 — 스크린 리더가
     * "적용된 필터, 2개 항목"으로 읽어야 몇 개가 걸려 있는지 안다.
     */
    <FilterToolbar role="list" data-testid="query-token-bar" aria-label="적용된 필터" className="prs-query-tokens">
      {chips.map((chip) => (
        <FilterChip
          key={`${chip.key}-${String(chip.index)}`}
          role="listitem"
          data-negated={chip.negated ? '' : undefined}
          removeLabel={chip.removeLabel}
          onRemove={() => {
            onRemove(chip.index);
          }}
        >
          {chip.negated ? <span className="prs-query-token__negation">제외</span> : null}
          <span className="prs-mono">{chip.key}: {chip.value}</span>
        </FilterChip>
      ))}
    </FilterToolbar>
  );
}
