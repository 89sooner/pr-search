'use client';

/**
 * C-024 ShaChip — 축약 SHA 표시와 **전체 40자** 복사 (WP-018).
 *
 * ## 표시값을 복사하지 않는다
 *
 * 사용 규칙이 그렇게 못박는다. 화면에 12자가 보인다고 12자를 복사하면
 * 사용자는 그것을 붙여넣고 "커밋을 찾을 수 없다"를 만난다 — 그리고 왜인지
 * 알 수 없다.
 *
 * ## 조용히 실패하지 않는다 (CR-021, DEV-096)
 *
 * `navigator.clipboard`는 **보안 컨텍스트에서만 존재한다.** HTTP 배포,
 * 권한 거부, 구형 브라우저에서 없거나 던진다. 성공만 알리면 사용자는
 * "성공했거나, 아무 일도 없었거나"를 구분하지 못하고 **이전 클립보드 내용을
 * 붙여넣는다.** 조사 도구에서 잘못된 SHA는 조사 결과 전체를 틀리게 만든다.
 *
 * 그래서 실패도 같은 `aria-live` 영역에 알리고, 전체 40자를 **선택 가능한
 * 텍스트로** 남겨 손으로 복사할 길을 준다.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Badge, Button } from './ui';

/** 화면에 보이는 자릿수. 명세가 정한 12자다. */
const DEFAULT_ABBREVIATE = 12;

export interface ShaChipProps {
  readonly commitSha: string;
  readonly abbreviate?: number;
  /** 배지 톤. 역할 배지와 나란히 설 때 낮춘다. */
  readonly tone?: 'neutral' | 'accent';
}

type CopyOutcome = 'idle' | 'copied' | 'failed';

export function ShaChip({ commitSha, abbreviate = DEFAULT_ABBREVIATE, tone = 'neutral' }: ShaChipProps): ReactNode {
  const [outcome, setOutcome] = useState<CopyOutcome>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const copy = useCallback(() => {
    /*
     * `writeText`는 없을 수도, 거부될 수도 있다. 둘 다 같은 결과 —
     * **사용자에게 알린다.** `?.()`로 호출부가 없는 경우까지 한 번에 다룬다.
     */
    const write = navigator.clipboard?.writeText.bind(navigator.clipboard);
    const done = (next: CopyOutcome): void => {
      setOutcome(next);
      if (timer.current !== undefined) clearTimeout(timer.current);
      // 알림이 영영 남아 있으면 다음 복사의 결과와 구분되지 않는다.
      timer.current = setTimeout(() => {
        setOutcome('idle');
      }, 4000);
    };

    if (write === undefined) {
      done('failed');
      return;
    }
    write(commitSha).then(
      () => {
        done('copied');
      },
      () => {
        done('failed');
      },
    );
  }, [commitSha]);

  return (
    <span data-testid="sha-chip">
      {/*
       * 전체 SHA를 `title`로 둔다 — 클릭 없이도 확인할 수 있고, 복사가
       * 막힌 환경에서 손으로 옮겨 적을 근거가 된다.
       */}
      <Badge tone={tone}>
        {/*
         * 배지 **안**이라 `ui-mono`가 아니라 `ui-num`을 쓴다. `ui-mono`는
         * 글꼴과 함께 `--ui-text-mono-payload`로 색까지 강제하는데, 그 색은
         * 페이지 배경을 전제한 값이라 `tone="accent"` 배지 위에서 대비비가
         * 2.79:1(다크)·2.77:1(라이트)로 떨어져 WCAG AA에 미달한다(실측).
         * `ui-num`은 같은 모노 글꼴을 주면서 색은 배지가 정한 것을 물려받아
         * 5.39:1·5.16:1로 통과한다. 배지 글자 크기(12px)도 따른다.
         */}
        <code className="ui-num" title={commitSha} data-testid="sha-short">
          {commitSha.slice(0, abbreviate)}
        </code>
      </Badge>

      <Button variant="secondary" onClick={copy} data-testid="sha-copy">
        Copy full SHA
      </Button>

      {/*
       * 성공과 실패를 **같은 영역**에 알린다 (C-024 접근성, DEV-096).
       * 실패했을 때는 전체 SHA를 함께 내보내 손으로 복사할 수 있게 한다 —
       * `ui-sr-only`가 아니라 실제로 보이는 텍스트여야 옮겨 적을 수 있다.
       */}
      <span role="status" aria-live="polite" data-testid="sha-copy-status">
        {outcome === 'copied' ? 'Copied full SHA.' : null}
        {outcome === 'failed' ? (
          <>
            Could not copy. This browser does not allow clipboard access. Full SHA: {' '}
            <code className="ui-mono" data-testid="sha-full">{commitSha}</code>
          </>
        ) : null}
      </span>
    </span>
  );
}
