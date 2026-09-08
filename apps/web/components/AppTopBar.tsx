'use client';

/**
 * C-001 AppTopBar (WP-015·WP-073).
 * 실제 C-010 입력 또는 주입된 슬롯에 검색 포커스를 연결하고,
 * 입력이 없는 화면에서는 검색 라우트의 입력 앵커로 이동한다.
 */

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton, Kbd, TopBar } from '@conductor-by-89soone/react';
import { WorkbenchIcon } from './WorkbenchIcon';

/** 슬롯 안에서 포커스를 받을 수 있는 것. 순서대로 첫째를 잡는다. */
const FOCUSABLE = 'input, textarea, select, button, [tabindex]:not([tabindex="-1"])';

export interface UserSummary {
  readonly login: string;
  readonly email: string | null;
}

export interface AppTopBarProps {
  readonly title?: string;
  /** C-010을 주입할 수 있는 기존 슬롯. 실제 화면에서는 본문 입력에 연결한다. */
  readonly omniSearch?: ReactNode;
  readonly user: UserSummary | null;
  /** 시험이 `mac`/`other`를 고정할 수 있게 열어 둔다. 기본은 실제 플랫폼. */
  readonly platform?: 'mac' | 'other';
  /** 좁은 화면의 내비게이션 서랍이 열려 있는가. `AppShell`이 소유한 상태다. */
  readonly navOpen: boolean;
  readonly onNavOpenChange: (open: boolean) => void;
}

/**
 * 햄버거 글리프.
 *
 * 아이콘 라이브러리를 들이지 않는다 (QA-COMMON-17). `currentColor`를 쓰므로
 * 색은 버튼의 토큰에서 온다 — 리터럴 색상값이 없다 (QA-COMMON-16).
 */
function MenuGlyph(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        d="M2 4.5h14M2 9h14M2 13.5h14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** 현재 플랫폼에서 `⌘`인지 `Ctrl`인지. SSR에서는 `other`로 그린다. */
function detectPlatform(): 'mac' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  return /Mac|iPhone|iPad/.test(navigator.platform ?? '') ? 'mac' : 'other';
}

export function AppTopBar({
  title = 'PR Search',
  omniSearch,
  user,
  platform,
  navOpen,
  onNavOpenChange,
}: AppTopBarProps): ReactNode {
  const slot = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  const searchLink = useRef<HTMLAnchorElement>(null);
  const [detectedPlatform, setDetectedPlatform] = useState<'mac' | 'other'>('other');
  useEffect(() => { setDetectedPlatform(detectPlatform()); }, []);

  function focusSearch(): boolean {
    const target = document.querySelector<HTMLElement>('[data-omni-input]')
      ?? slot.current?.querySelector<HTMLElement>(FOCUSABLE);
    if (target == null) return false;
    target.focus();
    return true;
  }

  /*
   * 서랍이 닫히면 포커스를 여는 버튼으로 되돌린다 (QA-COMMON-07).
   *
   * Conductor의 `AppShell`은 서랍을 `modal={false}`인 Radix Dialog로 띄운다.
   * 비모달 Dialog는 포커스를 가두지도, 닫을 때 트리거로 되돌리지도 않는다 —
   * 게다가 우리는 `Dialog.Trigger`를 쓰지 않으므로(그러려면 `@radix-ui`를
   * 직접 의존해야 하고 그것은 QA-COMMON-17 위반이다) Radix는 되돌릴 대상을
   * 아예 모른다. 실제로 `Escape`를 누르면 포커스가 `<body>`로 떨어진다 —
   * 키보드 사용자는 문서 처음으로 튕긴다.
   *
   * **포커스가 버려졌을 때만** 되돌린다. 라우트 전환도 서랍을 닫는데
   * (`Shell`이 `setNavOpen(false)`를 부른다), 그때는 `Shell`이 `main`으로
   * 포커스를 옮기는 것이 옳다. `body`인지 확인하지 않으면 여기서 그것을
   * 빼앗아 화면이 바뀌어도 포커스가 상단 버튼에 남는다.
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    const closing = wasOpen.current && !navOpen;
    wasOpen.current = navOpen;
    if (!closing) return undefined;

    /*
     * **다음 프레임에 확인한다.** Radix는 서랍을 걷어 내면서 포커스를 푸는데
     * 그것이 이 이펙트보다 늦다 — 지금 보면 아직 서랍이 잡고 있어서 "버려진
     * 포커스"를 놓친다. 실제로 그래서 한 번 틀렸다.
     */
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body) menu.current?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [navOpen]);

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

      event.preventDefault();
      if (!focusSearch()) searchLink.current?.click();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // SSR과 첫 렌더가 같아야 한다. `platform`이 없으면 서버에서 `other`로 그리고,
  // 실제 플랫폼은 마운트 후 반영한다 — 렌더 중 navigator를 읽지 않는다.
  const modifier = (platform ?? detectedPlatform) === 'mac' ? '⌘' : 'Ctrl';

  return (
    <TopBar
      className="prs-topbar"
      /*
       * **좁은 화면의 유일한 내비게이션 진입점이다.**
       *
       * Conductor는 800px 이하에서 사이드바(`.cdt-app-shell__nav:not([data-mobile])`)를
       * `display: none`으로 감추고 내비게이션을 서랍(Radix Dialog)으로만 연다.
       * 그런데 `AppShell`은 `navOpen`/`onNavOpenChange`만 주고 **여는 버튼은
       * 앱이 낸다.** 이것을 빠뜨리면 800px 이하에서 내비게이션에 **키보드로도
       * 마우스로도 닿을 수 없다** (QA-COMMON-06, NFR-007).
       *
       * `menuButton` 슬롯이 그 자리다 — Conductor가 `.cdt-topbar__menu-button`을
       * 기본 `display: none`, 800px 이하에서 `inline-flex`로 두므로 사이드바가
       * 사라지는 지점과 정확히 같은 곳에서 나타난다. 앱이 중단점을 다시
       * 적지 않는다.
       */
      menuButton={
        <IconButton
          ref={menu}
          variant="ghost"
          aria-label={navOpen ? '주요 화면 닫기' : '주요 화면 열기'}
          aria-expanded={navOpen}
          icon={<MenuGlyph />}
          onClick={() => {
            onNavOpenChange(!navOpen);
          }}
        />
      }
      eyebrow="GitHub Enterprise"
      title={
        <div ref={slot} data-testid="omni-search-slot">
          {omniSearch ?? <span className="prs-breadcrumb">작업대 <WorkbenchIcon name="chevron" /><strong>{title}</strong></span>}
        </div>
      }
      actions={
        <>
          <Link ref={searchLink} href="/search#omni-search-input" className="prs-quick-search"
            aria-label="빠른 검색" aria-keyshortcuts="Control+k Meta+k"
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              if (focusSearch()) event.preventDefault();
            }}>
            <WorkbenchIcon name="search" /><span>빠른 검색</span><Kbd>{modifier} K</Kbd>
          </Link>
          {user === null ? null : (
            <span className="prs-user" data-testid="user-summary" aria-label={`로그인: ${user.login}`}>
              <span className="prs-avatar" aria-hidden="true">{user.login.slice(0, 2).toUpperCase()}</span>
              <span>{user.login}</span>
            </span>
          )}
        </>
      }
    />
  );
}
