/**
 * 감사 액션 어휘 (WP-039 / FR-AUTH-004 AC-1·AC-7, CR-054).
 *
 * ## 왜 여기인가
 *
 * 이 값을 쓰는 곳이 셋이다 — 기록하는 서버(`search-api`), 보존 잡을 도는
 * 워커(`pipeline-worker`), 필터를 제시하는 화면(`apps/web`). `@prs/domain`은
 * 워크스페이스 내부 의존이 없어 셋 모두가 안전하게 가져올 수 있다.
 *
 * ## 쓰기 어휘와 읽기 이력 어휘는 다르다 (AC-7)
 *
 * **신규 기록은 이 목록의 값만 쓴다.** 그러나 `FR-AUTH-004` AC-3이 과거 기록의
 * 갱신을 금지하므로 저장소에는 이 목록에 없는 값이 남아 있다 —
 * `sequence_integrity.reassign`이 그것이다(WP-028이 기록했다). 그래서 **조회
 * 필터는 이 유니온으로 좁히지 않는다.** 쓰기 어휘를 좁히는 일이 읽기 이력을
 * 잘라 내는 일이 되어서는 안 된다. 감사의 목적이 과거를 조사하는 것이기
 * 때문이다.
 *
 * ## 개수를 세지 않는다 (DEV-400)
 *
 * 이전 계약은 "감사 대상 액션 13종"이라 적었고 보안 문서의 표는 14행이었으며
 * 그 행들이 담은 문자열은 18개였다. 셋 중 어느 것도 틀리지 않았고 **셋이 서로
 * 다른 것을 세고 있었다.** 정본은 목록이며 개수는 필요할 때 이 배열에서 센다.
 */

/** 지금 배선되어 있고 기록되어야 하는 액션 (SRS FR-AUTH-004 AC-1, `상태 = 활성`). */
export const ACTIVE_AUDIT_ACTIONS = [
  'search.execute',
  'entity.view',
  'saved_search.create',
  'saved_search.update',
  'saved_search.delete',
  'repository.register',
  'repository.update',
  'repository.unregister',
  /*
   * 등록 검토 요청을 **등록 없이** 종료한 것 (WP-040 / CR-055, FR-ING-009 AC-11).
   *
   * 성공한 등록에 의한 종료는 이 액션을 쓰지 않는다 — 그 자리는
   * `repository.register`가 이미 기록하고, 같은 행위를 두 번 세면 감사
   * 로그에서 실제 등록 횟수를 알 수 없게 된다.
   */
  'repository_registration_request.dismiss',
  'job.run',
  'job.pause',
  'job.resume',
  'job.cancel',
  'dead_letter.reprocess',
  'reindex.start',
  'sequence_integrity.check',
  'sequence.reassign',
  'raw_event.view_payload',
  'audit.view',
  'retention.purge',
  /**
   * 안전 구간 표식 등록 (WP-041 / FR-SEQ-006 AC-5, CR-057).
   *
   * **거절도 기록한다.** `result_code`가 성공(`created`)과 사유를 가르며,
   * 멱등 재시도(`unchanged`)는 **아무것도 바꾸지 않았으므로 기록하지
   * 않는다** — 남기면 재시도 횟수가 등록 횟수로 보인다.
   */
  'safe_marker.set',
] as const;

/**
 * 계약이 승인했으나 그 기능을 만드는 WP가 아직 오지 않은 액션.
 *
 * **누락이 아니다.** `export.create`는 `WP-044`가 소유하며 `REL-006`이다.
 * 합성 경로를 만들어 기록만 남기지 않는다 — 없는 기능을 있다고 말하는
 * 일이기 때문이다 (DEV-403).
 *
 * `safe_marker.set`은 **`WP-041`이 실제로 세우면서 활성으로 옮겼다** — 이
 * 목록은 "계약이 승인했으나 기능이 아직 없다"를 뜻하므로, 기능이 서는
 * 순간 그 사실이 거짓이 된다.
 */
export const NOT_ACTIVATED_AUDIT_ACTIONS = ['export.create'] as const;

/**
 * 과거에 기록되어 저장소에 남아 있으나 신규 쓰기에는 쓰지 않는 값.
 *
 * `WP-028`이 수동 재채번 경로에서 이것을 썼고 자동 경로는 `sequence.reassign`을
 * 썼다 — 같은 사실이 두 이름으로 남았다(DEV-405). 신규 쓰기는 후자로 통일했고
 * **이미 저장된 행은 고치지 않는다** (AC-3).
 */
export const LEGACY_AUDIT_ACTIONS = ['sequence_integrity.reassign'] as const;

export type ActiveAuditAction = (typeof ACTIVE_AUDIT_ACTIONS)[number];
export type NotActivatedAuditAction = (typeof NOT_ACTIVATED_AUDIT_ACTIONS)[number];
export type LegacyAuditAction = (typeof LEGACY_AUDIT_ACTIONS)[number];

/** 신규 기록이 쓸 수 있는 값. 저장 타입은 이것으로 좁히지 않는다. */
export type AuditAction = ActiveAuditAction;

/**
 * 화면이 제시할 수 있는 값 — 활성 + legacy.
 *
 * `미활성`은 넣지 않는다: 그 액션의 기록은 아직 하나도 없으므로 필터에 두면
 * 언제나 0건이고, 사용자는 "없다"와 "아직 만들지 않았다"를 구분할 수 없다.
 */
export const SELECTABLE_AUDIT_ACTIONS: readonly string[] = [
  ...ACTIVE_AUDIT_ACTIONS,
  ...LEGACY_AUDIT_ACTIONS,
];

export function isActiveAuditAction(value: unknown): value is ActiveAuditAction {
  return typeof value === 'string' && (ACTIVE_AUDIT_ACTIONS as readonly string[]).includes(value);
}

/**
 * 보존 만료 삭제를 수행하는 시스템 주체.
 *
 * 사람이 누른 것이 아니므로 사용자 ID를 지어내지 않는다. `system:` 접두는
 * `pipeline-worker`의 재채번 기록(`system:sequence`)이 이미 쓰는 관례다.
 */
export const AUDIT_RETENTION_PRINCIPAL = 'system:audit-retention';
