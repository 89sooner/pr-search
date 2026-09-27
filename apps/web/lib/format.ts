/**
 * 표시 포맷 (WP-015 / 화면 공통).
 *
 * **순수 함수만 둔다.** 서버 컴포넌트와 클라이언트 컴포넌트가 같은 값을
 * 그려야 하므로 여기에는 `Date.now()`도 로케일 자동 판정도 없다 — 서버가
 * 그린 문자열과 클라이언트가 그린 문자열이 다르면 하이드레이션이 깨진다.
 */

import { zonedParts } from '@prs/query';

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
 * 표시 시간대 (CR-127, NFR-007 「시각 표시 기준」).
 *
 * **고정 시간대 하나를 명시한다.** 사용자의 PC나 서버의 기본 시간대로 그리면 서버
 * 렌더와 클라이언트 렌더가 달라져 하이드레이션이 깨지고, 두 사람이 같은 화면을 보며
 * 다른 시각을 읽는다 — 조사 도구에서 그것은 사고의 원인이 된다. 그래서 전에는 UTC로
 * 고정했고, 이제 사용자가 읽는 한국 시간으로 고정한다. 개인별 설정은 없다(`OD-018`).
 */
export const DISPLAY_TIME_ZONE = 'Asia/Seoul';
/** 값·열 제목에 붙이는 짧은 표지. */
export const DISPLAY_TIME_ZONE_LABEL = 'KST';
/**
 * 읽지 못한 시각(미확인). **`—`와 다르다** — `—`는 값이 없다는 사실(머지되지 않은 PR의
 * 머지 시각)이고, 이것은 값이 있는데 읽을 수 없다는 뜻이다.
 */
export const UNKNOWN_TIME = 'Unknown';
const ABSENT_TIME = '—';

const OFFSET_SUFFIX = /(Z|[+-]\d{2}:?\d{2})$/i;
const DATE_TIME_WITHOUT_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

type Instant = { readonly kind: 'absent' } | { readonly kind: 'invalid' } | { readonly kind: 'ok'; readonly ms: number };

/**
 * 표시할 값을 순간으로. **오프셋 없는 시각은 UTC로 읽는다** — API의 시각은 UTC이고,
 * `Date.parse`에 그대로 넘기면 브라우저 시간대로 읽혀 화면이 브라우저마다 달라진다.
 */
function toInstant(value: string | null | undefined): Instant {
  if (value === null || value === undefined || value === '') return { kind: 'absent' };
  const normalized = DATE_TIME_WITHOUT_OFFSET.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? { kind: 'invalid' } : { kind: 'ok', ms };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(ms: number, timeZone: string): string {
  const p = zonedParts(ms, timeZone);
  return `${String(p.year).padStart(4, '0')}-${pad2(p.month)}-${pad2(p.day)}`;
}

function hm(ms: number, timeZone: string, seconds: boolean): string {
  const p = zonedParts(ms, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}${seconds ? `:${pad2(p.second)}` : ''}`;
}

/**
 * ISO 시각을 표시용으로 — `2026-09-27 12:00 KST`.
 *
 * `Intl`의 숫자 부분만 이어 붙인다(`@prs/query`의 `zonedParts`). `format()`의 문자열은
 * ICU 판마다 구두점과 공백이 달라 서버와 브라우저가 다른 글자를 낼 수 있다. 날짜 필터의
 * 하루 경계도 같은 함수에서 나오므로, 화면에서 9월 27일로 보이는 순간은 9월 27일 검색에
 * 들어간다(FR-SRCH-005 AC-11).
 *
 * 값이 없으면 `—`, 읽지 못하면 `Unknown`이다. 부재를 달리 적는 자리(`Never run` 등)는
 * 부르는 쪽이 먼저 가른다.
 */
export function formatTimestamp(iso: string | null | undefined, options: { readonly seconds?: boolean } = {}): string {
  const at = toInstant(iso);
  if (at.kind === 'absent') return ABSENT_TIME;
  if (at.kind === 'invalid') return UNKNOWN_TIME;
  return `${ymd(at.ms, DISPLAY_TIME_ZONE)} ${hm(at.ms, DISPLAY_TIME_ZONE, options.seconds === true)} ${DISPLAY_TIME_ZONE_LABEL}`;
}

/**
 * ISO 시각의 **KST 날짜**만 — `2026-09-27`.
 *
 * 날짜만 그리는 열은 열 제목에 `(KST)`를 붙인다. 열 제목이 없는 자리(문장 속)는
 * `{ label: true }`로 값에 붙인다.
 */
export function formatDate(iso: string | null | undefined, options: { readonly label?: boolean } = {}): string {
  const at = toInstant(iso);
  if (at.kind === 'absent') return ABSENT_TIME;
  if (at.kind === 'invalid') return UNKNOWN_TIME;
  const date = ymd(at.ms, DISPLAY_TIME_ZONE);
  return options.label === true ? `${date} ${DISPLAY_TIME_ZONE_LABEL}` : date;
}

/** KST 월·일·시각 — `09-27 12:00`. 좁은 축 이름(Regression 통합 시각)이 쓴다. 표지는 부르는 쪽이 붙인다. */
export function formatMonthDayTime(iso: string | null | undefined): string {
  const at = toInstant(iso);
  if (at.kind === 'absent') return ABSENT_TIME;
  if (at.kind === 'invalid') return UNKNOWN_TIME;
  return `${ymd(at.ms, DISPLAY_TIME_ZONE).slice(5)} ${hm(at.ms, DISPLAY_TIME_ZONE, false)}`;
}

/** KST 시각만 — `12:00`. 날짜를 따로 보이는 자리(Regression 실행 카드)가 쓴다. */
export function formatTimeOfDay(iso: string | null | undefined): string {
  const at = toInstant(iso);
  if (at.kind === 'absent') return ABSENT_TIME;
  if (at.kind === 'invalid') return UNKNOWN_TIME;
  return hm(at.ms, DISPLAY_TIME_ZONE, false);
}

/**
 * 원본 UTC 값 — 툴팁(`title`)에 쓴다. 읽지 못하면 `undefined`다.
 *
 * `Z`로 끝나는 값은 **받은 그대로** 보인다(마이크로초를 `Date`로 잘라 내지 않는다).
 * 다른 오프셋이면 같은 순간의 UTC로 옮긴다.
 */
export function formatUtcTitle(iso: string | null | undefined): string | undefined {
  const at = toInstant(iso);
  if (at.kind !== 'ok' || iso === null || iso === undefined) return undefined;
  const utc = /Z$/i.test(iso) ? iso : new Date(at.ms).toISOString();
  return `${utc} (UTC)`;
}

/** 시간대 표지 — `Asia/Seoul`은 `KST`, 나머지는 이름 그대로. */
export function timeZoneLabel(timeZone: string): string {
  return timeZone === DISPLAY_TIME_ZONE ? DISPLAY_TIME_ZONE_LABEL : timeZone;
}

/**
 * 다른 시간대로 그린다 — 통계 대시보드의 버킷 이름처럼 **그 화면이 시간대를 명시한** 자리만
 * 쓴다(FR-STAT-002 AC-2). 나머지 화면은 `formatTimestamp`다.
 */
export function formatInTimeZone(
  iso: string | null | undefined,
  timeZone: string,
  precision: 'minute' | 'date' | 'month',
): string {
  const at = toInstant(iso);
  if (at.kind === 'absent') return ABSENT_TIME;
  if (at.kind === 'invalid') return UNKNOWN_TIME;
  const date = ymd(at.ms, timeZone);
  if (precision === 'month') return date.slice(0, 7);
  if (precision === 'date') return date;
  return `${date} ${hm(at.ms, timeZone, false)}`;
}

/** 오프셋이 붙은 값인가 — 순간을 이미 정했는지 가를 때 쓴다. */
export function hasExplicitOffset(value: string): boolean {
  return OFFSET_SUFFIX.test(value) && !/^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** `owner/repo` → 표시용. 지금은 그대로지만 자를 자리를 한 곳에 둔다. */
export function formatRepository(repository: string | null | undefined): string {
  return repository === null || repository === undefined || repository === '' ? '—' : repository;
}
