'use client';

/**
 * C-016 CursorPager — 커서 기반 이어 보기 (WP-032 / FR-SRCH-008, ADR-010).
 *
 * ## 페이지 번호가 없다
 *
 * ADR-010이 "커서 전용, 오프셋 없음"을 정했다. 번호를 그리려면 전체 건수와
 * 위치를 알아야 하는데 `track_total_hits` 상한(1만) 위에서 그 수는 근사다 —
 * 근사한 수로 "3 / 7페이지"를 그리면 사용자는 그것을 사실로 읽는다.
 *
 * 그래서 이 컴포넌트가 주는 것은 셋뿐이다: **다음 페이지**, **첫 페이지로**,
 * 그리고 지금까지 몇 건을 봤는가.
 *
 * ## 커서 오류는 여기서 안내한다
 *
 * `CURSOR_QUERY_MISMATCH`와 `CURSOR_INVALID`는 **다른 사실**을 말한다 —
 * 하나는 "조건이 바뀌었다"이고 다른 하나는 "이 커서를 쓸 수 없다"이다. 둘 다
 * 첫 페이지로 되돌리지만 같은 원인인 척하지 않는다 (CR-043, DEV-273).
 *
 * **자동으로 다시 부르지 않는다.** 실패한 커서를 화면이 조용히 첫 페이지로
 * 바꿔 재조회하면 사용자는 자기가 어디에 있었는지 모른 채 목록이 처음으로
 * 돌아간 것만 본다. 무엇이 일어났는지 말하고 사용자가 누르게 한다.
 */

import type { ReactNode } from 'react';
import { Banner, Button, Spinner } from './ui';
import { CURSOR_FAILURE_TEXT, toCursorFailure, type CursorFailure } from '../lib/cursor-failure';

/**
 * 커서 실패의 갈래와 판정은 `lib/cursor-failure.ts`에 있다 — 순수 함수라 단위 시험이 닿는다.
 * 서버 오류 코드를 그대로 쓰되, `CURSOR_INVALID`의 옛 판 사유만 따로 안내한다 (CR-125, DEV-777).
 * 기존 화면이 이 파일에서 들여오므로 그대로 다시 내보낸다.
 */
export { toCursorFailure, type CursorFailure };

export interface CursorPagerProps {
  /** 다음 페이지 커서. `null`이면 마지막 페이지다 (AC-1). */
  readonly nextCursor: string | null;
  /** 첫 페이지가 아닌가. 참이면 "첫 페이지로"를 그린다. */
  readonly resumed: boolean;
  /** 지금까지 그린 항목 수. 누적이지 전체 건수가 아니다. */
  readonly loadedCount: number;
  readonly loading: boolean;
  /**
   * 다음 페이지를 잇는다.
   *
   * **커서를 해석하지 않는다** — 서버가 준 문자열을 그대로 되돌려 보낸다.
   * 봉투는 서명돼 있고 화면이 그 안을 읽을 이유가 없다 (ADR-010 Amendment).
   */
  readonly onLoadMore: (cursor: string) => void;
  readonly onFirst: () => void;
  /** 직전 요청이 커서 때문에 실패했다면 그 갈래. */
  readonly failure?: CursorFailure | null;
}

const FAILURE_TEXT = CURSOR_FAILURE_TEXT;

export function CursorPager({
  nextCursor,
  resumed,
  loadedCount,
  loading,
  onLoadMore,
  onFirst,
  failure = null,
}: CursorPagerProps): ReactNode {
  /*
   * 첫 페이지이고 다음도 없고 실패도 없으면 그릴 것이 없다.
   *
   * 빈 도구 막대를 남기면 "여기 뭔가 있었는데 비었다"로 읽힌다.
   */
  if (failure === null && !resumed && nextCursor === null) return null;

  return (
    <nav data-testid="cursor-pager" aria-label="Pagination">
      {failure === null ? null : (
        <Banner tone="warning" title={FAILURE_TEXT[failure].title}>
          <p data-testid="cursor-failure" data-cursor-failure={failure}>
            {FAILURE_TEXT[failure].impact}
          </p>
        </Banner>
      )}

      <p data-testid="cursor-loaded" aria-live="polite">
        {`Loaded ${String(loadedCount)} items so far.`}
      </p>

      {resumed ? (
        <Button
          variant="secondary"
          data-testid="cursor-first"
          disabled={loading}
          onClick={onFirst}
        >
          First page
        </Button>
      ) : null}

      {nextCursor === null ? (
        /*
         * 마지막 페이지임을 **말한다** (AC-1).
         *
         * 버튼만 사라지면 사용자는 "더 있는데 안 나오는 것"과 "여기가 끝"을
         * 구분할 수 없다 — 이 제품에서 그 차이는 조사 결과의 신뢰다.
         */
        resumed ? <p data-testid="cursor-end">This is the last page.</p> : null
      ) : (
        <Button
          data-testid="cursor-next"
          /* 연타로 같은 커서를 두 번 보내지 않는다. */
          disabled={loading}
          onClick={() => {
            onLoadMore(nextCursor);
          }}
        >
          {loading ? <Spinner label="Loading next page" /> : "Next page"}
        </Button>
      )}
    </nav>
  );
}

