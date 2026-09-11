/**
 * 측정 CLI의 인자 계약 (WP-074 FR-SEQ-008 AC-14 / 측정 가이드 4절).
 *
 * **범위 검사가 곧 계약이다.** 잘못된 인자는 종료 코드 2이며 조용히 기본값으로
 * 돌지 않는다 — 운영자가 잰 값이 자기가 요청한 구간의 것이 아니면 그 보고는
 * 틀린 사실을 말한다.
 */

export type MeasureMode = 'baseline' | 'report' | 'watch';
export type OutputFormat = 'table' | 'json';
export const COHORTS = ['new_squash', 'backfill', 'retry', 'reassign', 'reconcile', 'all'] as const;
export type Cohort = (typeof COHORTS)[number];

export interface BaselineArgs {
  readonly mode: 'baseline';
  readonly windowMs: number;
  readonly format: OutputFormat;
  readonly detailed: boolean;
}

export interface ReportArgs {
  readonly mode: 'report';
  readonly windowMs: number;
  readonly cohort: Cohort;
  readonly format: OutputFormat;
  readonly detailed: boolean;
}

export interface WatchArgs {
  readonly mode: 'watch';
  readonly repository: string;
  readonly baseBranch: string;
  readonly prNumber: number;
  readonly timeoutMs: number;
  readonly pollMs: number;
  readonly format: OutputFormat;
  readonly detailed: boolean;
}

export type MeasureArgs = BaselineArgs | ReportArgs | WatchArgs;

/** 인자가 계약을 어겼다. 호출부가 종료 코드 2로 옮긴다. */
export class ArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgumentError';
  }
}

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
/** 가이드 4절: window 최대 30일. */
export const MAX_WINDOW_MS = 30 * DAY_MS;

/** `--window 7d` · `24h`. 양의 정수 + 단위 `h`|`d`만 받는다. */
export function parseWindow(raw: string): number {
  const match = /^([1-9][0-9]*)([hd])$/.exec(raw);
  if (match === null) throw new ArgumentError(`--window는 양의 정수와 h 또는 d여야 한다: ${raw}`);
  const value = Number(match[1]);
  const ms = match[2] === 'h' ? value * HOUR_MS : value * DAY_MS;
  if (ms > MAX_WINDOW_MS) throw new ArgumentError(`--window는 30d를 넘을 수 없다: ${raw}`);
  return ms;
}

/** `--timeout 120s` (1..600), `--poll 2s` (1..30). 단위는 초 고정이다. */
export function parseSeconds(raw: string, flag: string, min: number, max: number): number {
  const match = /^([1-9][0-9]*)s$/.exec(raw);
  if (match === null) throw new ArgumentError(`${flag}는 양의 정수와 s여야 한다: ${raw}`);
  const value = Number(match[1]);
  if (value < min || value > max) throw new ArgumentError(`${flag}는 ${String(min)}..${String(max)}초여야 한다: ${raw}`);
  return value * 1_000;
}

function readFlag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new ArgumentError(`${name}에 값이 필요하다`);
  // 같은 플래그를 두 번 준 요청은 어느 값을 썼는지 알 수 없다 — 거절한다.
  if (argv.indexOf(name, index + 1) >= 0) throw new ArgumentError(`${name}가 두 번 있다`);
  return value;
}

function readFormat(argv: readonly string[]): OutputFormat {
  const raw = readFlag(argv, '--format') ?? 'table';
  if (raw !== 'table' && raw !== 'json') throw new ArgumentError(`--format은 table 또는 json이어야 한다: ${raw}`);
  return raw;
}

/** `owner/name`. 사내 주소나 URL을 받지 않는다. */
export function parseRepository(raw: string): string {
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(raw)) {
    throw new ArgumentError(`--repository는 owner/name 형식이어야 한다: ${raw}`);
  }
  return raw;
}

export function parseArgs(argv: readonly string[]): MeasureArgs {
  const mode = argv[0];
  if (mode !== 'baseline' && mode !== 'report' && mode !== 'watch') {
    throw new ArgumentError(`모드는 baseline · report · watch 중 하나여야 한다: ${mode ?? '(없음)'}`);
  }
  const format = readFormat(argv);
  const detailed = argv.includes('--detailed');

  if (mode === 'baseline') {
    return { mode, windowMs: parseWindow(readFlag(argv, '--window') ?? '7d'), format, detailed };
  }
  if (mode === 'report') {
    const cohortRaw = readFlag(argv, '--cohort') ?? 'new_squash';
    if (!(COHORTS as readonly string[]).includes(cohortRaw)) {
      throw new ArgumentError(`--cohort는 ${COHORTS.join(' · ')} 중 하나여야 한다: ${cohortRaw}`);
    }
    return {
      mode,
      windowMs: parseWindow(readFlag(argv, '--window') ?? '24h'),
      cohort: cohortRaw as Cohort,
      format,
      detailed,
    };
  }

  const repository = readFlag(argv, '--repository');
  const baseBranch = readFlag(argv, '--base-branch');
  const prRaw = readFlag(argv, '--pr-number');
  if (repository === undefined || baseBranch === undefined || prRaw === undefined) {
    throw new ArgumentError('watch는 --repository · --base-branch · --pr-number가 필요하다');
  }
  if (!/^[1-9][0-9]{0,9}$/.test(prRaw) || Number(prRaw) > 2_147_483_647) {
    throw new ArgumentError(`--pr-number는 1..2147483647의 정수여야 한다: ${prRaw}`);
  }
  return {
    mode,
    repository: parseRepository(repository),
    baseBranch,
    prNumber: Number(prRaw),
    timeoutMs: parseSeconds(readFlag(argv, '--timeout') ?? '120s', '--timeout', 1, 600),
    pollMs: parseSeconds(readFlag(argv, '--poll') ?? '2s', '--poll', 1, 30),
    format,
    detailed,
  };
}

export const USAGE = `prs-measure-sequence-latency — 수신→미러·시퀀스·M·검색 지연 측정 (WP-074, 읽기 전용)

사용법:
  baseline --window 7d [--format table|json]
  report   --window 24h --cohort new_squash|backfill|retry|reassign|reconcile|all [--format table|json]
  watch    --repository <owner/name> --base-branch <branch> --pr-number <n> [--timeout 120s] [--poll 2s] [--format json]

환경 변수:
  MEASURE_DATABASE_URL   읽기 전용 DB 접속 (필수)
  MEASURE_API_BASE_URL   watch가 부를 검색 API 기준 주소
  MEASURE_SESSION_FILE   기존 로그인으로 얻은 읽기 세션 cookie 헤더 한 줄 (chmod 600)

종료 코드: 0 정상 · 1 조회·권한 실패 · 2 잘못된 인자 · 3 자료 부족·timeout·부분·시계 이상·에폭 이동
이 도구는 아무것도 쓰지 않는다. DSN·세션·헤더·원본 payload를 출력하지 않는다.`;
