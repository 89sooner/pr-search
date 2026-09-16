/**
 * A-003 인덱스·잡 운영의 화면 판정 (WP-040 / CR-055).
 *
 * **순수 모듈이다.** 컴포넌트 안에 판정을 흩뿌리지 않는다 — `repository-overview.ts`
 * ·`audit.ts`가 같은 이유로 이 자리에 있다. 판정이 렌더링 코드에 섞이면 시험이
 * DOM을 지나야 하고, 그러면 규칙 하나가 바뀔 때 무엇이 깨지는지 알기 어렵다.
 *
 * ## 이 모듈이 하지 않는 것
 *
 * **잡의 제어 가능 여부를 계산하지 않는다.** 서버가 `allowed_actions`를 주고
 * 화면은 그것을 그대로 그린다 (FR-ADMIN-002 AC-7) — 상태 문자열로 추론하면
 * 전이 규칙이 서버와 화면 두 곳에 살고, 잡 유형마다 러너가 실제로 지원하는
 * 범위가 다를 때 화면이 없는 능력을 제시한다.
 */

/** `API-ADM-002`가 내는 잡 하나. */
export interface JobView {
  readonly job_id: number;
  readonly type: string;
  readonly target: string;
  readonly state: string;
  readonly progress: Record<string, unknown> | null;
  readonly requested_by: string;
  readonly started_at: string | null;
  readonly finished_at: string | null;
  readonly error: string | null;
  readonly allowed_actions?: readonly string[];
}

export type JobControl = 'pause' | 'resume' | 'cancel';

const CONTROL_LABELS: Readonly<Record<JobControl, string>> = {
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Stop',
};

export function controlLabel(action: JobControl): string {
  return CONTROL_LABELS[action];
}

/**
 * 이 잡에 그릴 제어 버튼.
 *
 * **서버가 준 목록을 거르기만 한다.** 상태를 보고 더하지 않는다 — 목록이 비면
 * "지금 제어할 수 없다"는 뜻이고 버튼을 그리지 않는 것이 옳다.
 *
 * 서버가 아직 이 필드를 주지 않는 응답(옛 배포)에서는 **빈 목록**이다. 없는
 * 것을 있다고 가정해 버튼을 그리면 운영자가 눌렀을 때 400을 받는다.
 */
export function jobControls(job: JobView): readonly JobControl[] {
  const allowed = job.allowed_actions ?? [];
  return (['pause', 'resume', 'cancel'] as const).filter((action) =>
    (allowed as readonly string[]).includes(action),
  );
}

/** 진행률에서 수를 하나 꺼낸다. 없거나 모양이 다르면 `null`이다. */
function progressNumber(progress: JobView['progress'], key: string): number | null {
  if (progress === null) return null;
  const value = progress[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export interface ProgressView {
  readonly done: number | null;
  readonly total: number | null;
  readonly unit: string | null;
  /** 0~1. 총계를 모르면 `null`이며 **0으로 대신하지 않는다.** */
  readonly ratio: number | null;
  /** API 한도 대기 회복 시각 (DEV-104). 상태는 `running`을 유지한다. */
  readonly waitingUntil: string | null;
}

/**
 * 진행률 표시값.
 *
 * **총계를 모르는 것과 0인 것을 구분한다.** 백필은 목록을 끝까지 읽어야 총계를
 * 알므로 그전에는 `null`이고, 그때 비율을 0으로 그리면 운영자가 "아무것도
 * 안 됐다"로 읽는다.
 */
export function progressView(job: JobView): ProgressView {
  const done = progressNumber(job.progress, 'done');
  const total = progressNumber(job.progress, 'total');
  const unitRaw = job.progress?.['unit'];
  const waitingRaw = job.progress?.['waiting_until'];
  return {
    done,
    total,
    unit: typeof unitRaw === 'string' && unitRaw !== '' ? unitRaw : null,
    ratio: done !== null && total !== null && total > 0 ? Math.min(done / total, 1) : null,
    waitingUntil: typeof waitingRaw === 'string' && waitingRaw !== '' ? waitingRaw : null,
  };
}

/**
 * 실행 폼이 제시하는 잡 유형 (FR-ADMIN-002 AC-1·AC-6).
 *
 * **러너가 있는 것만 있다.** 각 항목이 어느 API로 가는지도 여기서 정한다 —
 * 재색인은 `API-ADM-004`, 정합성 점검과 재채번은 `API-ADM-007`이 소유하며
 * 나머지가 `API-ADM-002`다. 한 엔드포인트에 억지로 몰지 않는다.
 */
export interface RunOption {
  readonly type: string;
  readonly label: string;
  /** 요청이 가는 프록시 경로. `/api/v1`을 적지 않는다 — 프록시가 붙인다. */
  readonly path: string;
  /** 이 유형이 받는 재료. 폼이 무엇을 물을지 정한다. */
  readonly input: 'repository' | 'sequence_space' | 'alias' | 'none';
}

export const RUN_OPTIONS: readonly RunOption[] = [
  { type: 'backfill', label: 'Repository backfill', path: '/api/admin/jobs', input: 'repository' },
  { type: 'link_rebuild', label: 'Rebuild all relationships', path: '/api/admin/jobs', input: 'repository' },
  { type: 'reconcile', label: 'Reconciliation scan', path: '/api/admin/jobs', input: 'none' },
  { type: 'sequence_assign', label: 'Sequence numbering', path: '/api/admin/jobs', input: 'sequence_space' },
  { type: 'reindex', label: 'Zero-downtime reindex', path: '/api/admin/reindex', input: 'alias' },
  {
    type: 'sequence_integrity',
    label: 'Sequence consistency check',
    path: '/api/admin/sequence-integrity',
    input: 'sequence_space',
  },
];

export function runOption(type: string): RunOption | undefined {
  return RUN_OPTIONS.find((option) => option.type === type);
}

/** `API-ADM-002`가 받을 본문. 유형마다 재료가 다르다 (CR-055). */
export function runBody(
  option: RunOption,
  input: { readonly repository?: string; readonly baseBranch?: string; readonly alias?: string },
): Record<string, unknown> {
  switch (option.input) {
    case 'none':
      // `reconcile`은 대상을 보내지 않는다 — 보내면 서버가 거절한다.
      return { type: option.type };
    case 'repository':
      return { type: option.type, target: input.repository ?? '' };
    case 'sequence_space':
      return { type: option.type, repository: input.repository ?? '', base_branch: input.baseBranch ?? '' };
    case 'alias':
      return { alias: input.alias ?? '' };
  }
}

/** 별칭 하나의 색인 상태 (`API-ADM-004` `GET`). */
export interface AliasStatusView {
  readonly alias: string;
  readonly current_index: string | null;
  readonly document_count: number | null;
  readonly store_size_bytes: number | null;
  readonly active_reindex: {
    readonly job_id: number;
    readonly phase: string | null;
    readonly target_index: string | null;
    readonly dual_write_since: string | null;
  } | null;
  readonly last_reindex: {
    readonly job_id: number;
    readonly state: string;
    readonly switched_at: string | null;
  } | null;
}

export interface IndexStatusView {
  readonly generated_at: string;
  readonly aliases: readonly AliasStatusView[];
  readonly unavailable: readonly string[];
}

/** 이 별칭이 지금 이중 쓰기 중인가 (QA-A003-07). */
export function isDualWriting(row: AliasStatusView): boolean {
  return row.active_reindex !== null && row.active_reindex.dual_write_since !== null;
}

/**
 * 값 하나의 표시.
 *
 * **읽지 못한 값을 `0`·`0B`로 대신하지 않는다** (FR-ING-008 AC-7). 크기를
 * 모르는 것과 인덱스가 빈 것은 다른 사실이고, 후자로 적으면 운영자가 재색인이
 * 실패했다고 읽는다.
 */
export const UNAVAILABLE_LABEL = 'Unknown';

export function formatCount(value: number | null): string {
  return value === null ? UNAVAILABLE_LABEL : value.toLocaleString('en-US');
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

export function formatBytes(value: number | null): string {
  if (value === null) return UNAVAILABLE_LABEL;
  if (value === 0) return '0 B';
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), SIZE_UNITS.length - 1);
  const scaled = value / 1024 ** exponent;
  const unit = SIZE_UNITS[exponent] ?? 'B';
  return `${scaled >= 100 || exponent === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${unit}`;
}

/**
 * 재채번 확인 문자열이 맞는가 (QA-A003-10 / FLOW-008).
 *
 * **관대하게 비교하지 않는다.** `trim`도 대소문자 무시도 하지 않는 이유는
 * 재채번이 비가역이기 때문이다 — 확인의 목적은 사용자가 대상을 **정확히**
 * 알고 있음을 증명하는 것이고, 관대한 비교는 그 증명을 약하게 만든다.
 * 서버도 같은 판정을 하며 화면이 그것을 흉내 내는 것이 아니라 **먼저** 막는다.
 */
export function reassignConfirmed(typed: string, repositorySlug: string): boolean {
  return typed === repositorySlug;
}

/** 일괄 재처리가 재확인을 요구하는 경계 (QA-A001-04). */
export const BULK_REPROCESS_CONFIRM_THRESHOLD = 100;

export function needsBulkReconfirm(count: number): boolean {
  return count > BULK_REPROCESS_CONFIRM_THRESHOLD;
}
