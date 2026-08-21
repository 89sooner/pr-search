'use client';

/**
 * C-001 AppTopBar — 제품명, 옴니 검색, 사용자 메뉴 (WP-015).
 *
 * ## 옴니 검색은 슬롯이다 (CR-018, DEV-070)
 *
 * C-010 `OmniSearchInput`은 W-001의 컴포넌트라 WP-016 소관이다. 그런데
 * WP-015의 DoD가 "`⌘K`로 옴니 검색에 포커스"를 요구한다. 그래서 **셸이
 * 단축키와 슬롯 계약을 소유하고** 슬롯 안의 첫 포커스 가능 요소를 잡는다 —
 * WP-016이 C-010을 슬롯에 넣으면 단축키가 저절로 그것을 가리킨다. 셸을
 * 다시 고치지 않는다.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Kbd, TopBar } from '@conductor-by-89soone/react';

/** 슬롯 안에서 포커스를 받을 수 있는 것. 순서대로 첫째를 잡는다. */
const FOCUSABLE = 'input, textarea, select, button, [tabindex]:not([tabindex="-1"])';

export interface UserSummary {
  readonly login: string;
  readonly email: string | null;
}

export interface AppTopBarProps {
  /** C-010이 들어올 자리. 없으면 단축키는 아무것도 잡지 않는다. */
  readonly omniSearch?: ReactNode;
  readonly user: UserSummary | null;
  /** 시험이 `mac`/`other`를 고정할 수 있게 열어 둔다. 기본은 실제 플랫폼. */
  readonly platform?: 'mac' | 'other';
}

/** 현재 플랫폼에서 `⌘`인지 `Ctrl`인지. SSR에서는 `other`로 그린다. */
function detectPlatform(): 'mac' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  return /Mac|iPhone|iPad/.test(navigator.platform ?? '') ? 'mac' : 'other';
}

export function AppTopBar({ omniSearch, user, platform }: AppTopBarProps): ReactNode {
  const slot = useRef<HTMLDivElement>(null);

  /*
   * `⌘K`/`Ctrl+K`로 옴니 검색에 포커스한다 (WP-015 DoD).
   *
   * `document`에 건다 — 사용자가 결과 표 어디에 있든 동작해야 한다.
   * `preventDefault`가 필요한 이유는 Firefox가 `Ctrl+K`를 주소창 검색에
   * 쓰기 때문이다.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'k' && event.key !== 'K') return;
      if (!event.metaKey && !event.ctrlKey) return;

      const target = slot.current?.querySelector<HTMLElement>(FOCUSABLE);
      if (target === null || target === undefined) return;

      event.preventDefault();
      target.focus();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // SSR과 첫 렌더가 같아야 한다. `platform`이 없으면 서버에서 `other`로 그리고,
  // 실제 판정은 프로퍼티로 주입한다 — 렌더 중에 `navigator`를 읽으면 하이드레이션이 깨진다.
  const modifier = (platform ?? detectPlatform()) === 'mac' ? '⌘' : 'Ctrl';

  return (
    <TopBar
      eyebrow="PR Search"
      title={
        <div ref={slot} data-testid="omni-search-slot">
          {omniSearch}
        </div>
      }
      actions={
        <>
          <Kbd>{modifier}</Kbd>
          <Kbd>K</Kbd>
          {user === null ? null : (
            <span data-testid="user-summary" aria-label={`로그인: ${user.login}`}>
              {user.login}
            </span>
          )}
        </>
      }
    />
  );
}
