/**
 * 백필의 판정 (WP-019 / CR-022, FR-ING-006).
 *
 * I/O는 `backfill.ts`가 한다. 여기 있는 것은 **무엇을 주장하는가**뿐이다 —
 * 어떤 델리버리 ID를 쓰는가, 어떤 문서 버전을 다는가, 어디서 재개하는가.
 * 셋 다 틀리면 조용히 틀린다: 백필이 실시간을 덮어쓰거나, 재개가 엉뚱한
 * 지점을 이어받거나, 실패 대기열에 같은 PR이 쌓인다.
 */

/** `job.progress`의 단위. 진행률은 PR 수로 센다 (FR-ING-006 AC-2). */
export const PROGRESS_UNIT = 'pull_request' as const;

/** 한 페이지에 받을 PR 수. GitHub 상한이 100이다. */
export const BACKFILL_PAGE_SIZE = 100;

/**
 * 진행률 갱신 주기 (AC-2: 30초 이내).
 *
 * 페이지마다 쓰면 DB를 과하게 때리고, 너무 뜸하면 AC-2를 어긴다. 25초로 두어
 * **경계에 걸치지 않게** 한다 — 정확히 30초로 두면 스케줄 지터 한 번에 위반이다.
 */
export const PROGRESS_INTERVAL_MS = 25_000;

// ------------------------------------------------------------- 델리버리 ID

/** 웹훅 델리버리와 구별되는 접두. 실패 대기열에서 출처가 보여야 한다. */
export const BACKFILL_DELIVERY_PREFIX = 'backfill:' as const;

/**
 * 백필이 쓰는 합성 델리버리 ID (CR-022, DEV-100).
 *
 * ## 왜 결정론적인가
 *
 * 실패 대기열이 `(delivery_id, stage)` 유니크로 색인된다. 재시도할 때마다
 * 새 ID를 만들면 **같은 PR의 같은 실패가 행마다 쌓이고**, 운영자가 500건의
 * 대기열에서 실제로는 하나인 문제를 500개로 본다.
 *
 * ## 왜 `job_id`를 넣지 않는가
 *
 * 넣으면 잡을 다시 실행할 때 같은 PR이 다른 키를 갖는다 — 위의 성질이 그대로
 * 깨진다. 백필의 단위는 **잡이 아니라 PR**이다.
 */
export function backfillDeliveryId(repositoryId: number, prNumber: number): string {
  return `${BACKFILL_DELIVERY_PREFIX}${String(repositoryId)}:${String(prNumber)}`;
}

/** 이 델리버리가 백필에서 왔는가. 운영 조사와 지표 분류에 쓴다. */
export function isBackfillDelivery(deliveryId: string): boolean {
  return deliveryId.startsWith(BACKFILL_DELIVERY_PREFIX);
}

// -------------------------------------------------------------- 문서 버전

/**
 * 백필 문서의 버전 (CR-022, DEV-099 / FR-ING-006 AC-5).
 *
 * **엔티티의 `updated_at`이다. 지금 시각이 아니다.**
 *
 * 지금 시각을 쓰면 백필이 언제나 최신이 되어 실시간 문서를 덮어쓴다 — AC-5를
 * 정면으로 위반한다. 웹훅 수신은 언제나 그 엔티티가 갱신된 **뒤**이므로,
 * `updated_at`을 쓰면 같은 사실에 대해 실시간이 항상 이긴다.
 *
 * **AC-5가 분기가 아니라 수의 대소로 성립한다.** 백필에 "덮어쓰지 않기"
 * 분기를 따로 두지 않는다 — 이미 있는 조건부 업서트가 낮은 버전을 거절한다.
 * 분기를 두면 그 분기가 틀렸을 때 조용히 덮어쓴다.
 *
 * @returns 파싱할 수 없으면 `null`. **0이나 지금 시각으로 때우지 않는다** —
 * 0이면 어떤 갱신에도 지고(문서가 영영 안 생긴다), 지금 시각이면 전부 이긴다.
 * 호출 측이 그 PR을 건너뛰고 실패로 보고한다.
 */
export function backfillDocumentVersion(updatedAt: string | undefined | null): number | null {
  if (updatedAt === undefined || updatedAt === null) return null;
  /*
   * 빈 문자열·공백을 따로 거르지 않는다 — `Date.parse`가 둘 다 `NaN`으로
   * 준다(실측 확인). 따로 거르면 **결과를 바꾸지 못하는 검사**가 남는데,
   * 그런 줄은 읽는 사람에게 "여기에 무언가 있다"고 거짓말을 한다.
   */
  const ms = Date.parse(updatedAt);
  return Number.isNaN(ms) ? null : ms;
}

// ------------------------------------------------------------------ 커서

export interface BackfillCursor {
  /** 다음에 읽을 페이지 (1부터). */
  readonly page: number;
  /** 지금까지 처리한 PR 수. 진행률의 `done`이다. */
  readonly done: number;
}

const FIRST: BackfillCursor = { page: 1, done: 0 };

/**
 * 저장된 커서를 읽는다 (FR-ING-006 AC-4).
 *
 * **모양이 틀리면 처음부터 시작한다.** 중간을 추측하면 그 사이의 PR이
 * 영영 색인되지 않고, 백필은 **다시 하면 되는** 작업이라 처음부터가 안전하다.
 * 조용히 넘어가지 않도록 호출 측이 그 사실을 로그에 남긴다.
 */
export function readCursor(raw: Record<string, unknown> | null | undefined): BackfillCursor {
  if (raw === null || raw === undefined) return FIRST;
  const page = raw['page'];
  const done = raw['done'];
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) return FIRST;
  if (typeof done !== 'number' || !Number.isInteger(done) || done < 0) return FIRST;
  return { page, done };
}

/**
 * 한 페이지를 처리한 뒤의 커서.
 *
 * **페이지를 다 처리한 뒤에만 전진한다.** 페이지 중간에 저장하면 재개가
 * 처리하지 않은 PR을 건너뛴다 — `done`은 늘었는데 그 PR은 색인되지 않은 상태.
 */
export function advanceCursor(current: BackfillCursor, processed: number): BackfillCursor {
  return { page: current.page + 1, done: current.done + processed };
}

// ------------------------------------------------------------------ 진행률

export interface BackfillProgress {
  readonly done: number;
  /** 전체 PR 수. **모르면 `null`이다** — 목록을 끝까지 읽기 전에는 모른다. */
  readonly total: number | null;
  readonly unit: typeof PROGRESS_UNIT;
  /**
   * API 한도로 기다리는 중이면 회복 시각 (CR-022, DEV-104).
   *
   * **상태를 `paused`로 바꾸지 않는다.** `paused`는 운영자가 멈춘 것만
   * 뜻해야 자동 재개가 운영자의 중단을 되살리지 않는다.
   */
  readonly waiting_until?: string;
}

/**
 * 진행률 (AC-2: 처리 완료 PR 수 / 전체 PR 수).
 *
 * `total`을 모를 때 `done`을 그대로 넣지 않는다 — 그러면 언제나 100%로 보인다.
 */
export function buildProgress(
  cursor: BackfillCursor,
  total: number | null,
  waitingUntil?: Date,
): BackfillProgress {
  const base = { done: cursor.done, total, unit: PROGRESS_UNIT } as const;
  return waitingUntil === undefined ? base : { ...base, waiting_until: waitingUntil.toISOString() };
}

// ------------------------------------------------------------- 한도 대기

/**
 * GHE 한도로 기다려야 하는가 (WP-019 DoD 예외 처리).
 *
 * `@prs/github`의 `GitHubApiError`가 `retryAt`을 실어 준다. 그것이 있으면
 * **잡을 실패시키지 않고 기다린다** — 한도는 시간이 지나면 회복되는 것이고,
 * 실패로 끝내면 운영자가 손으로 다시 눌러야 한다.
 */
export function rateLimitRetryAt(error: unknown): Date | null {
  const kind = (error as { kind?: unknown } | null)?.kind;
  if (kind !== 'rate_limited' && kind !== 'secondary_rate_limited') return null;
  const retryAt = (error as { retryAt?: unknown }).retryAt;
  return retryAt instanceof Date ? retryAt : null;
}

/**
 * 기다릴 시간. **상한을 둔다.**
 *
 * 잘못된 `retryAt`(먼 미래)이 오면 워커가 영영 잠들고, 그 사이 운영자의
 * 중단 지시도 보지 못한다. 한 번에 최대 1분씩만 자고 다시 확인한다.
 */
export const MAX_SLEEP_MS = 60_000;

export function sleepMsUntil(retryAt: Date, now: Date): number {
  const delta = retryAt.getTime() - now.getTime();
  if (!Number.isFinite(delta) || delta <= 0) return 0;
  return Math.min(delta, MAX_SLEEP_MS);
}
