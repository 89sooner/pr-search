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

  /*
   * Radix `Switch`가 `use-size`를 지나며 `ResizeObserver`를 만든다 (WP-040).
   * jsdom에는 없어 렌더 자체가 죽는다 — 위의 포인터 API와 같은 자리이며,
   * **크기를 재는 동작을 흉내 내지 않는다**: 이 대역은 아무것도 관찰하지 않고,
   * 실제 크기 반응은 e2e가 본다.
   */
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
