/**
 * 접근성 시험 준비 (WP-015).
 *
 * `@testing-library/jest-dom`의 매처를 켠다 — `toHaveAttribute`,
 * `toHaveAccessibleName` 같은 것들이 DOM 단언을 읽을 수 있게 만든다.
 */

import '@testing-library/jest-dom/vitest';

/*
 * Radix 기반 컴포넌트(Select 등)가 jsdom에 없는 포인터 API를 부른다 (WP-025).
 * 없으면 열기 상호작용이 TypeError로 죽는다 — 실제 브라우저 동작은 e2e가 본다.
 */
if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.setPointerCapture ??= () => undefined;
  window.HTMLElement.prototype.releasePointerCapture ??= () => undefined;
  window.HTMLElement.prototype.scrollIntoView ??= () => undefined;
}
