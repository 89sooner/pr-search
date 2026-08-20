/**
 * @prs/bus — EventBus 포트와 Redis Streams 어댑터 (ADR-002).
 *
 * WP-001은 워크스페이스 골격만 세운다. 이 패키지의 실제 구현은 WP-005가 채운다.
 * 지금 내보내는 것은 패키지 식별 정보뿐이며, 여기에 도메인 로직을 두지 않는다.
 */

export const PACKAGE_NAME = '@prs/bus' as const;

/** 이 패키지를 채우는 작업 패키지 ID. */
export const IMPLEMENTED_BY = 'WP-005' as const;
