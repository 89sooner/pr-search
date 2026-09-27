/**
 * 달력 날짜와 시간대 (CR-127, FR-SRCH-005 AC-11, NFR-007).
 *
 * **표시의 하루와 검색의 하루를 같은 함수가 정한다.** 화면이 어떤 순간을 「9월 27일」로
 * 그리는 계산(`zonedParts`)과, 「9월 27일」 검색이 어디서 시작해 어디서 끝나는지 정하는
 * 계산(`startOfZonedDay`)이 다른 코드에 살면, 한쪽만 고쳐지는 날 화면에서 9월 27일로
 * 보이는 항목이 9월 27일 검색에서 빠진다. 파서·질의 변환·화면이 모두 이 모듈을 쓴다
 * (ADR-001 — 서버와 브라우저가 같은 코드).
 *
 * **시간대 규칙은 런타임의 `Intl`(ICU)이 안다.** 여기서 오프셋을 상수로 두지 않는다 —
 * `Asia/Seoul`도 1987·1988년에는 서머타임이 있었고, 통계 대시보드는 임의의 IANA 시간대를
 * 받는다. Elasticsearch(Java)의 버킷 계산과 같은 IANA 자료를 쓰므로, 서머타임으로 자정이
 * 없는 날과 두 번인 날의 「하루의 첫 순간」이 두 계산에서 같다(원장 6.118장 실측).
 *
 * 순수 함수만 둔다. 「지금」은 호출하는 쪽이 넘긴다.
 */

/** 그 시간대의 벽시계 부분. `month`는 1부터다. */
export interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
/**
 * IANA 이름의 모양. **문자로 시작해야 한다** — 런타임은 `+09:00` 같은 고정 오프셋도
 * 시간대로 받지만, 그것을 허용하면 `@+09:00`이 달력 날짜 범위인지 순간의 오프셋인지
 * 읽는 사람이 헷갈린다. 오프셋은 시각 끝에 적는다(`2026-09-27T00:00+09:00`).
 */
const ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
const DAY_MS = 86_400_000;
/** 벽시계와 UTC의 차이가 이보다 클 수는 없다(역사적 지방시 포함). 공백 탐색의 창이다. */
const SEARCH_WINDOW_MS = 26 * 3_600_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** 시간대마다 한 번 만든다. 모르는 시간대면 `RangeError`를 던진다. */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      /*
       * `hour12: false`가 아니라 `hourCycle: 'h23'`이다 — 앞의 것은 일부 엔진에서 자정을
       * `24`로 낸다. 문자열이 아니라 숫자 부분만 읽으므로 ICU 판마다 달라지는 구두점과
       * 공백(ICU 72의 좁은 공백)에 흔들리지 않는다.
       */
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * IANA 시간대 이름을 검증하고 정규 표기로 돌려준다. 모르면 `null`이다.
 *
 * 대소문자와 별칭을 런타임이 정규화한다(`asia/seoul` → `Asia/Seoul`,
 * `US/Pacific` → `America/Los_Angeles`). 같은 런타임 안에서 왕복이 안정되고,
 * 질의를 실행하는 서버의 판정이 권위다.
 */
export function canonicalTimeZone(name: string): string | null {
  if (!ZONE_NAME.test(name)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function utcWall(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number {
  // `Date.UTC`는 0~99년을 1900년대로 읽는다. 연도를 따로 넣어 그 함정을 피한다.
  const at = new Date(Date.UTC(2000, month - 1, day, hour, minute, second, ms));
  at.setUTCFullYear(year, month - 1, day);
  return at.getTime();
}

/** 순간(밀리초)을 그 시간대의 벽시계로 쪼갠다. */
export function zonedParts(epochMs: number, timeZone: string): ZonedParts {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(epochMs))) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day' || part.type === 'hour' || part.type === 'minute' || part.type === 'second') {
      values[part.type] = Number(part.value);
    }
  }
  const millisecond = ((epochMs % 1000) + 1000) % 1000;
  return {
    year: values['year'] ?? Number.NaN,
    month: values['month'] ?? Number.NaN,
    day: values['day'] ?? Number.NaN,
    // 방어: `h23`을 무시하는 엔진이 자정을 24로 내도 같은 날 0시로 읽는다.
    hour: (values['hour'] ?? Number.NaN) % 24,
    minute: values['minute'] ?? Number.NaN,
    second: values['second'] ?? Number.NaN,
    millisecond,
  };
}

/** 순간의 벽시계를 「UTC였다면의 밀리초」로 적는다. 오프셋 = 이 값 − 순간. */
function wallClock(epochMs: number, timeZone: string): number {
  const p = zonedParts(epochMs, timeZone);
  return utcWall(p.year, p.month, p.day, p.hour, p.minute, p.second, p.millisecond);
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** 순간이 그 시간대에서 무슨 날짜인가 (`YYYY-MM-DD`). */
export function zonedDate(epochMs: number, timeZone: string): string {
  const p = zonedParts(epochMs, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** 그 시간대의 오늘. 「지금」은 부르는 쪽이 준다 — 서버 렌더와 시험이 같은 값을 쓰게. */
export function todayIn(timeZone: string, nowMs: number): string {
  return zonedDate(nowMs, timeZone);
}

function splitDate(value: string): [number, number, number] | null {
  const match = DATE_ONLY.exec(value);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * 실재하는 달력 날짜(`YYYY-MM-DD`)인가.
 *
 * `2026-02-30`은 형식이 맞아도 없는 날짜다. `Date`는 그것을 3월 2일로 넘기므로
 * 되돌려 읽어 같은 날짜인지 본다.
 */
export function isCalendarDate(value: string): boolean {
  const parts = splitDate(value);
  if (parts === null) return false;
  const [year, month, day] = parts;
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(utcWall(year, month, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() + 1 === month && probe.getUTCDate() === day;
}

function requireDate(value: string): [number, number, number] {
  const parts = splitDate(value);
  if (parts === null || !isCalendarDate(value)) throw new RangeError(`Invalid calendar date: '${value}'`);
  return parts;
}

/** 달력 날짜에 날 수를 더한다. 시간대와 무관하다. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = requireDate(date);
  const at = new Date(utcWall(year, month, day) + days * DAY_MS);
  return `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

/** 그 날짜가 속한 달의 마지막 날. */
export function endOfMonth(date: string): string {
  const [year, month] = requireDate(date);
  const next = month === 12 ? `${pad(year + 1, 4)}-01-01` : `${pad(year, 4)}-${pad(month + 1)}-01`;
  return addDays(next, -1);
}

/**
 * 그 시간대에서 날짜 `date`가 시작되는 **첫 순간**(밀리초).
 *
 * 보통은 그날 00:00이다. 다만 서머타임 전환이 자정에 걸리면 다르다 — 자정이 없는 날
 * (America/Santiago 2026-09-06은 00:00 → 01:00)은 전환 순간이 그날의 첫 순간이고,
 * 자정이 두 번인 날(America/Havana 2026-11-01은 01:00 → 00:00)은 **앞의** 자정이다.
 * 두 경우 모두 Elasticsearch 일 버킷의 키와 같다.
 */
export function startOfZonedDay(date: string, timeZone: string): number {
  const [year, month, day] = requireDate(date);
  formatterFor(timeZone); // 모르는 시간대면 여기서 던진다.
  const midnight = utcWall(year, month, day);

  // 주변의 오프셋으로 후보를 만든다. 전환은 자정 앞뒤 하루 안의 오프셋만 쓴다.
  const candidates = new Set<number>();
  for (const probe of [midnight - DAY_MS, midnight, midnight + DAY_MS]) {
    candidates.add(midnight - (wallClock(probe, timeZone) - probe));
  }
  const exact = [...candidates].filter((at) => wallClock(at, timeZone) === midnight).sort((a, b) => a - b);
  const [earliest] = exact;
  if (earliest !== undefined) return earliest;

  // 자정이 없다. 벽시계가 처음으로 그날 00:00 이상이 되는 순간을 찾는다.
  let before = midnight - SEARCH_WINDOW_MS;
  let after = midnight + SEARCH_WINDOW_MS;
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2);
    if (wallClock(middle, timeZone) >= midnight) after = middle;
    else before = middle;
  }
  return after;
}

/**
 * 달력 날짜 범위를 UTC 반열림 구간으로 옮긴다 (FR-SRCH-005 AC-11).
 *
 * 양끝 날짜를 모두 포함한다: `[시작일의 첫 순간, 종료일 다음 날의 첫 순간)`. 종료를
 * 23:59:59로 만들거나 1ms를 빼서 흉내 내지 않는다 — 그러면 밀리초 아래 정밀도와
 * 서머타임 날에서 경계가 새고, 무엇보다 다음 버킷의 시작과 같은 값을 공유하지 못한다.
 */
export function calendarRangeToUtc(from: string, to: string, timeZone: string): { readonly gte: string; readonly lt: string } {
  return {
    gte: new Date(startOfZonedDay(from, timeZone)).toISOString(),
    lt: new Date(startOfZonedDay(addDays(to, 1), timeZone)).toISOString(),
  };
}
