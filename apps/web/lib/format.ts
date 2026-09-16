/**
 * 표시 포맷 (WP-015 / 화면 공통).
 *
 * **순수 함수만 둔다.** 서버 컴포넌트와 클라이언트 컴포넌트가 같은 값을
 * 그려야 하므로 여기에는 `Date.now()`도 로케일 자동 판정도 없다 — 서버가
 * 그린 문자열과 클라이언트가 그린 문자열이 다르면 하이드레이션이 깨진다.
 */

/**
 * SHA 축약 길이 (12자).
 *
 * git 기본은 7자이지만 화면에는 12자를 쓴다. 7자는 검색 **입력**의 하한이고
 * (ADR-012), 표시에서는 사용자가 두 SHA를 눈으로 구분할 수 있어야 한다.
 */
export const SHORT_SHA_LENGTH = 12;

/** 40자 hex인지. 아니면 축약하지 않고 그대로 돌려준다. */
const FULL_SHA = /^[0-9a-fA-F]{40}$/;

/**
 * 커밋 SHA를 표시용으로 줄인다.
 *
 * 40자가 아니면 **손대지 않는다.** 이미 축약된 값을 다시 자르면 7자 입력이
 * 화면에서 더 짧아져 무엇을 검색했는지 알 수 없게 된다.
 */
export function shortSha(sha: string): string {
  const trimmed = sha.trim();
  if (!FULL_SHA.test(trimmed)) return trimmed;
  return trimmed.slice(0, SHORT_SHA_LENGTH).toLowerCase();
}

/**
 * 머지 시퀀스 표기 (FR-SEQ-001).
 *
 * **자릿수 구분 기호를 넣지 않는다.** `1,342`로 쓰면 사용자가 그것을 그대로
 * 복사해 검색창에 넣었을 때 숫자로 읽히지 않는다. 시퀀스는 세는 수가 아니라
 * **식별자**이므로 Perforce 체인지리스트 번호처럼 그대로 쓴다.
 */
export function formatSequence(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return String(Math.trunc(value));
}

/**
 * 시퀀스와 에폭을 함께 (ADR-007).
 *
 * 에폭이 다르면 같은 시퀀스 값이라도 **다른 커밋**을 가리킨다. 강제 푸시가
 * 에폭을 올리므로, 에폭 없이 시퀀스만 인용하면 그 인용이 조용히 다른 것을
 * 가리키게 된다.
 */
export function formatSequenceRef(value: number | null | undefined, epoch: number | null | undefined): string {
  const seq = formatSequence(value);
  if (seq === '—') return seq;
  if (epoch === null || epoch === undefined || !Number.isFinite(epoch)) return seq;
  return `${seq}@e${String(Math.trunc(epoch))}`;
}

/** 기간 표기의 단위. 큰 것부터 본다. */
const DURATION_UNITS: readonly (readonly [seconds: number, suffix: string])[] = [
  [86_400, 'd'],
  [3_600, 'h'],
  [60, 'm'],
];

/**
 * 초 단위 기간을 사람이 읽는 문자열로 (리드 타임·리뷰 대기).
 *
 * 두 단위까지만 쓴다 — `2일 3시간`이면 충분하고 `2일 3시간 14분 9초`는
 * 표에서 줄을 넘긴다. 음수는 데이터 오류이므로 `—`로 둔다: 0으로 보이면
 * "즉시 머지"와 구분되지 않는다.
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—';

  const total = Math.trunc(seconds);
  if (total < 60) return `${String(total)}s`;

  const parts: string[] = [];
  let rest = total;
  for (const [unit, suffix] of DURATION_UNITS) {
    const count = Math.floor(rest / unit);
    if (count > 0) {
      parts.push(`${String(count)}${suffix}`);
      rest -= count * unit;
    }
    if (parts.length === 2) break;
  }
  return parts.join(' ');
}

/**
 * ISO 시각을 표시용으로.
 *
 * **UTC로 고정한다.** 사용자의 시간대로 그리면 서버 렌더와 클라이언트 렌더가
 * 달라져 하이드레이션이 깨지고, 두 사람이 같은 화면을 보며 다른 시각을 읽는다.
 * 조사 도구에서 그것은 사고의 원인이 된다.
 */
export function formatTimestamp(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';

  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${String(at.getUTCFullYear())}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ` +
    `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`
  );
}

/** `owner/repo` → 표시용. 지금은 그대로지만 자를 자리를 한 곳에 둔다. */
export function formatRepository(repository: string | null | undefined): string {
  return repository === null || repository === undefined || repository === '' ? '—' : repository;
}
