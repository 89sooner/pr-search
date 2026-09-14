/**
 * 레지스트리 검사(JOB-GH-003)의 시간 설정 — 검사 코드와 신선도 한도가 **같은 값**을 읽는 자리 (CR-090).
 *
 * 이 값들은 원래 `inventory.ts`·`registry-check.ts`의 지역 상수였다. 운영 승인의 신선도 한도
 * (`registryEvidenceMaxAgeMs`)가 「검사 주기 + 한 회차의 최악 소요」로 계산되므로, 검사가 실제로
 * 쓰는 시간 상한과 한도 계산이 서로 다른 숫자를 보면 한도가 조용히 틀린다. 그래서 여기 한 곳에 두고
 * 양쪽이 가져다 쓴다. 노드 전용 의존이 없어 브라우저 번들에서도 안전하다.
 */

/** `gh --version` 한 번의 시간 상한 (`readGhVersion`·`readGhVersionAsync`의 기본값). */
export const GH_VERSION_TIMEOUT_MS = 10_000;

/** 인벤토리 추출의 `--help` 한 번의 시간 상한 (`extractInventory`·`extractInventoryAsync`의 기본값). */
export const INVENTORY_HELP_TIMEOUT_MS = 20_000;

/** 비동기 인벤토리 추출이 동시에 띄우는 `--help` 프로세스 수. CPU 넷을 다 쓰지 않으면서 27초를 8초쯤으로 줄인다. */
export const INVENTORY_HELP_CONCURRENCY = 4;

/**
 * 드리프트 검사가 일시 오류(`error`)로 끝났을 때 다시 시도하기 전의 대기 (비동기 문서 9.1의 「재시도 3회」).
 * 길이가 곧 재시도 횟수다.
 */
export const REGISTRY_CHECK_RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000, 45_000];
