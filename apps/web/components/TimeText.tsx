import type { ReactNode } from 'react';
import { formatDate, formatTimestamp, formatUtcTitle } from '../lib/format';

/**
 * 화면의 시각 한 개 (CR-127, NFR-007 「시각 표시 기준」).
 *
 * 한국 시간 문자열을 그리고, `dateTime`에는 받은 원본을, `title`에는 원본 UTC를 둔다 —
 * 조사자가 값을 옮겨 적거나 다른 시스템과 대조할 때 원본을 볼 수 있어야 한다. 표시
 * 문자열은 어디로도 되돌아가지 않는다(API 값·커서·URL은 원본을 쓴다).
 *
 * 값이 없을 때(`null`)의 표기는 자리마다 다르다(`—`·`Never run`·`Not merged`) — `absent`로
 * 넘긴다. 읽지 못한 값은 `Unknown`이며 툴팁을 달지 않는다.
 */
export function TimeText({
  value,
  seconds = false,
  dateOnly = false,
  absent,
  className,
  testId,
}: {
  value: string | null | undefined;
  seconds?: boolean;
  dateOnly?: boolean;
  absent?: ReactNode;
  className?: string;
  testId?: string;
}): ReactNode {
  if ((value === null || value === undefined || value === '') && absent !== undefined) return absent;
  const text = dateOnly ? formatDate(value) : formatTimestamp(value, { seconds });
  const title = formatUtcTitle(value);
  if (title === undefined || value === null || value === undefined) {
    return <span className={className} data-testid={testId}>{text}</span>;
  }
  return (
    <time className={className} dateTime={value} title={title} data-testid={testId}>
      {text}
    </time>
  );
}
