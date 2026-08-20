/**
 * 지원 이벤트 유형 화이트리스트 (API-ING-001, FR-ING-001 AC-5).
 *
 * 화이트리스트는 "저장 여부"가 아니라 "처리 대상 여부"를 가른다. 검증을 통과한
 * payload는 유형과 무관하게 전부 `raw_event`에 남는다 (FR-ING-003 AC-1) —
 * 나중에 지원 유형이 늘어도 원본만으로 재구성할 수 있어야 하기 때문이다.
 *
 * 목록은 두 갈래로 나뉜다.
 *   - 앞의 6종: 파이프라인이 문서로 투영하는 유형 (FR-ING-001 AC-5)
 *   - 뒤의 3종: 권한 캐시를 무효화하는 유형 (FR-AUTH-003 AC-2)
 * API 계약 API-ING-001과 SRS 외부 인터페이스 표가 둘을 합쳐 9종으로 적고 있다.
 */

export const SUPPORTED_EVENT_TYPES = [
  'pull_request',
  'pull_request_review',
  'push',
  'create',
  'delete',
  'release',
  'member',
  'team',
  'repository',
] as const;

export type SupportedEventType = (typeof SUPPORTED_EVENT_TYPES)[number];

const SUPPORTED = new Set<string>(SUPPORTED_EVENT_TYPES);

export function isSupportedEventType(eventType: string): eventType is SupportedEventType {
  return SUPPORTED.has(eventType);
}

/**
 * 지표 라벨용 이벤트 유형.
 *
 * 지원하지 않는 유형을 그대로 라벨에 쓰면 GHE가 보내는 유형 수만큼 시계열이
 * 늘어난다. 화이트리스트 밖은 `other` 하나로 접는다.
 */
export function eventTypeLabel(eventType: string | undefined): string {
  if (eventType === undefined || eventType === '') return 'unknown';
  return isSupportedEventType(eventType) ? eventType : 'other';
}
