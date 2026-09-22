/**
 * 시간 예산과 변경 요청 간격 — 본체는 `@prs/github`의 `pacing.ts`다 (CR-115).
 *
 * 표기(WP-075)가 세운 규율을 태그(WP-100)도 그대로 쓰므로, 신원을 모르는 이 유틸리티를
 * 아래 계층으로 옮겼다. 이 파일은 기존 import 경로를 지키는 재수출이며 새 코드는
 * `@prs/github`에서 직접 가져온다.
 */

export { DeadlineExceededError, PassDeadline, WriteGate } from '@prs/github';
