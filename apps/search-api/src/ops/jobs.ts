/**
 * API-ADM-002 잡 실행·중단·진행률 (WP-019 / CR-022, DEV-103).
 *
 * **실행 지시는 이벤트가 아니라 `job` 행이다.** 이 모듈은 행을 만들고 상태를
 * 전이시킬 뿐이고, 실제 실행은 배치 워커가 그 행을 원자적으로 claim해서 한다.
 *
 * 이 모듈이 하지 않는 것 하나: **동시 실행 상한을 여기서 막지 않는다.**
 * 상한은 *동시에 도는 수*의 제약이지 *요청받을 수 있는 수*의 제약이 아니다
 * (FR-ING-006 AC-6). 넷째 요청을 400으로 막으면 운영자가 앞의 셋이 끝나는
 * 것을 지켜보다 다시 눌러야 한다.
 */

import { jobRepo, repositoryRepo, type JobRow, type Pool } from '@prs/db';

/** `PATCH`가 받는 것. **이 셋뿐이다** (CR-022, DEV-103). */
export const JOB_ACTIONS = ['pause', 'resume', 'cancel'] as const;
export type JobAction = (typeof JOB_ACTIONS)[number];

export function isJobAction(value: unknown): value is JobAction {
  return typeof value === 'string' && (JOB_ACTIONS as readonly string[]).includes(value);
}

/**
 * 응답에 실을 모양.
 *
 * **`cursor`를 내보내지 않는다** (CR-022, DEV-103). 재개 지점은 워커의 내부
 * 상태이고, 운영자가 읽을 수 있으면 고치고 싶어진다 — 고치면 재개가 무엇을
 * 이어받는지 아무도 보장하지 못한다.
 */
export function toJobResponse(row: JobRow): Record<string, unknown> {
  return {
    job_id: row.job_id,
    type: row.type,
    target: row.target,
    state: row.state,
    progress: row.progress,
    requested_by: row.requested_by,
    started_at: row.started_at?.toISOString() ?? null,
    finished_at: row.finished_at?.toISOString() ?? null,
    error: row.error,
  };
}

export type CreateJobOutcome =
  | { readonly kind: 'created'; readonly job: JobRow }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'unknown_repository' };

/**
 * 잡을 큐에 넣는다.
 *
 * 같은 `(type, target)`에 활성 잡이 있으면 `conflict`다 — 부분 유니크 인덱스가
 * DB에서 강제하므로 **먼저 검사하지 않아도** 경합에서 둘이 뜨지 않는다.
 * 여기서 미리 보는 것은 409를 돌려주기 위한 것이지 정합성을 위한 것이 아니다.
 */
export async function createJob(
  pool: Pool,
  type: 'backfill',
  target: string,
  requestedBy: string,
): Promise<CreateJobOutcome> {
  const [owner, name] = splitTarget(target);
  /*
   * 등록되지 않은 저장소에 백필을 걸 수 없다. 걸어 두면 워커가 잡을 때마다
   * 실패하고, 운영자는 **저장소를 등록하지 않은 것**이 원인임을 알 수 없다.
   */
  const repository = await repositoryRepo.findRepositoryBySlug(pool, owner, name);
  if (repository === undefined) return { kind: 'unknown_repository' };

  const existing = await jobRepo.findActiveJob(pool, type, target);
  if (existing !== undefined) return { kind: 'conflict' };

  try {
    const jobId = await jobRepo.enqueueJob(pool, type, target, requestedBy);
    const job = await jobRepo.findJobById(pool, jobId);
    // 방금 넣은 행을 못 읽는 것은 있을 수 없다 — 있으면 그것이 진짜 오류다.
    if (job === undefined) throw new Error('생성한 잡을 다시 읽지 못했다');
    return { kind: 'created', job };
  } catch (error) {
    // 검사와 삽입 사이에 다른 요청이 넣었다. 유니크 위반이 그것을 말해 준다.
    if (isUniqueViolation(error)) return { kind: 'conflict' };
    throw error;
  }
}

export type TransitionOutcome =
  | { readonly kind: 'ok'; readonly job: JobRow }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'invalid_transition'; readonly state: JobRow['state'] };

/**
 * 상태를 전이한다.
 *
 * **불가능한 전이를 조용히 무시하지 않는다** — 운영자가 중단을 눌렀는데
 * 200이 돌아오면 멈춘 줄 알고 자리를 뜬다. 현재 상태를 함께 돌려주어
 * 왜 안 되는지 알 수 있게 한다.
 */
export async function applyJobAction(
  pool: Pool,
  jobId: number,
  action: JobAction,
): Promise<TransitionOutcome> {
  const updated = await jobRepo.transitionJob(pool, jobId, action);
  if (updated !== undefined) return { kind: 'ok', job: updated };

  const current = await jobRepo.findJobById(pool, jobId);
  if (current === undefined) return { kind: 'not_found' };
  return { kind: 'invalid_transition', state: current.state };
}

function splitTarget(target: string): readonly [string, string] {
  const slash = target.indexOf('/');
  if (slash < 0) return [target, ''];
  return [target.slice(0, slash), target.slice(slash + 1)];
}

/** PostgreSQL의 유니크 위반. `job_active_uk`가 걸렸다는 뜻이다. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === '23505';
}
