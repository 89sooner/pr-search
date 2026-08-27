/**
 * 시험용 커서 서명 (WP-032).
 *
 * 운영 코드는 `resolveSearchApiConfig`가 키를 정하고 `buildServerDeps`가
 * 서명자를 만든다. 시험이 서버를 손으로 세울 때도 **같은 타입**을 요구받게
 * 두는 것이 의도다 — 서명자를 선택 필드로 만들면 "커서가 조용히 발급되지
 * 않는" 배포를 시험이 통과시킨다.
 *
 * 값이 고정인 것은 시험 사이에서 커서가 재현 가능해야 하기 때문이다.
 * 32자 하한(`MIN_CURSOR_KEY_LENGTH`)을 넘긴다.
 */

import { createCursorSigner } from '../src/cursor/envelope.js';

export const TEST_CURSOR_KEY = 'test-cursor-key-0123456789abcdef-wp032';

export const TEST_CURSOR_SIGNER = createCursorSigner(TEST_CURSOR_KEY);
