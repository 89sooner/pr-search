'use client';

/**
 * C-001 AppTopBar (WP-015·WP-073·CR-093).
 * 실제 C-010 입력 또는 주입된 슬롯에 검색 포커스를 연결하고,
 * 입력이 없는 화면에서는 검색 라우트의 입력 앵커로 이동한다.
 */

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppShellNavTrigger, Breadcrumb, IconButton, Kbd, TopBar } from '@conductor-by-89soone/react';
import { UserMenu } from './UserMenu';
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
  /** 좁은 화면의 내비게이션 서랍이 열려 있는가. `AppShell`이 소유한 상태이며 여기서는 버튼 이름에만 쓴다. */
  readonly navOpen: boolean;
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
}: AppTopBarProps): ReactNode {
  const slot = useRef<HTMLDivElement>(null);
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
       * Conductor는 800px 이하에서 사이드바를 감추고 내비게이션을 서랍(Radix Dialog)으로만
       * 연다. 여는 버튼은 앱이 낸다 — 빠뜨리면 800px 이하에서 내비게이션에 키보드로도
       * 마우스로도 닿을 수 없다 (QA-COMMON-06, NFR-007). `menuButton` 슬롯이 그 자리다.
       *
       * 버튼을 `AppShellNavTrigger`로 감싼다 (Conductor 0.4.1, CR-093). 그것이 서랍 Dialog의
       * 트리거이므로 `aria-expanded`·`aria-controls`·열림 상태를 Radix가 붙이고, 서랍이
       * 닫힐 때 이 버튼으로 포커스를 되돌리는 것도 `AppShell`이 한다. 0.3.1에서 제품이
       * 다음 프레임에 `document.body`를 확인해 되돌리던 보완은 그래서 없어졌다.
       */
      menuButton={
        <AppShellNavTrigger asChild>
          <IconButton
            variant="ghost"
            aria-label={navOpen ? '주요 화면 닫기' : '주요 화면 열기'}
            icon={<WorkbenchIcon name="menu" />}
          />
        </AppShellNavTrigger>
      }
      eyebrow="GitHub Enterprise"
      title={
        <div ref={slot} data-testid="omni-search-slot">
          {omniSearch ?? (
            /*
             * 현재 위치를 Conductor `Breadcrumb`(`nav[aria-label="경로"]`)으로 적는다 — 0.3.1에서는
             * 글자와 chevron을 늘어놓은 span이었다. 랜드마크가 하나 늘어나므로 이름으로 구분된다.
             */
            <Breadcrumb className="prs-breadcrumb">
              <ol>
                <li><Link href="/">작업대</Link></li>
                <li aria-current="page"><WorkbenchIcon name="chevron" /><strong>{title}</strong></li>
              </ol>
            </Breadcrumb>
          )}
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
          {/* 로그인 이름이 사용자 메뉴의 트리거다 — 로그아웃이 그 안에 있다 (CR-092 / DEV-700). */}
          {user === null ? null : <UserMenu login={user.login} email={user.email} />}
        </>
      }
    />
  );
}
