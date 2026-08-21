'use client';

/**
 * 앱 셸 (WP-015 / QA-COMMON, NFR-007).
 *
 * Conductor `AppShell` 위에 이 제품이 필요로 하는 둘을 얹는다:
 *
 * 1. **라우트 전환 시 `main`으로 포커스를 옮긴다.** SPA 라우팅은 문서를
 *    바꾸지 않으므로 스크린 리더 사용자의 포커스가 방금 누른 링크에 남는다.
 *    다음 탭이 새 화면의 처음이 아니라 이전 화면의 다음 항목으로 간다.
 * 2. **`aria-live`로 새 화면 제목을 알린다.** 포커스 이동만으로는 "무엇이
 *    바뀌었는가"가 전달되지 않는다.
 *
 * 둘 다 Conductor의 몫이 아니다 — 디자인 시스템은 라우터를 모른다.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppShell } from '@conductor-by-89soone/react';
import type { Role } from '@prs/authz/roles';
import { activeNavId } from '../lib/nav.js';
import { AppTopBar, type UserSummary } from './AppTopBar.js';
import { LeftNavPanel } from './LeftNavPanel.js';

export const MAIN_ID = 'main-content';

export interface ShellProps {
  readonly roles: readonly Role[];
  readonly user: UserSummary | null;
  readonly omniSearch?: ReactNode;
  /** 현재 화면 제목. 라우트 전환 시 이 값이 읽힌다. */
  readonly title: string;
  readonly children: ReactNode;
}

export function Shell({ roles, user, omniSearch, title, children }: ShellProps): ReactNode {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  // 첫 렌더에서는 알리지 않는다 — 페이지 로드는 브라우저가 이미 알린다.
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }

    /*
     * 좁은 화면에서 링크를 누르면 내비게이션을 닫는다.
     *
     * 열린 채로 두면 새 화면이 그 뒤에 가려지고, 포커스를 `main`으로 옮겨도
     * 사용자에게는 아무것도 바뀌지 않은 것처럼 보인다.
     */
    setNavOpen(false);

    /*
     * `AppShell`이 소유한 `<main>`을 id로 찾는다.
     *
     * 자식 쪽에 ref를 걸어 두면 그것은 `<main>` **안의** 요소라 스킵 링크가
     * 가리키는 대상과 달라진다 — 포커스가 두 곳으로 갈린다.
     */
    const target = document.getElementById(MAIN_ID);
    if (target !== null) {
      /*
       * `tabIndex = -1`을 먼저 준다. `main`은 원래 포커스를 받지 못하므로
       * 그냥 `focus()`를 부르면 아무 일도 일어나지 않는다.
       */
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }

    setAnnouncement(title);
  }, [pathname, title]);

  return (
    <AppShell
      skipLinkLabel="본문으로 건너뛰기"
      mainId={MAIN_ID}
      navOpen={navOpen}
      onNavOpenChange={setNavOpen}
      topBar={<AppTopBar user={user} {...(omniSearch === undefined ? {} : { omniSearch })} />}
      nav={<LeftNavPanel roles={roles} activeId={activeNavId(pathname)} />}
    >
      {/*
       * 알림 영역은 화면에 보이지 않되 DOM에는 있어야 한다. `display: none`이면
       * 스크린 리더도 읽지 않으므로 Conductor의 시각적 숨김 클래스를 쓴다.
       */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="route-announcement"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          margin: -1,
          padding: 0,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {announcement}
      </div>
      {children}
    </AppShell>
  );
}
