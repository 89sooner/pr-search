'use client';

/**
 * 앱 셸 (WP-015 / QA-COMMON, NFR-007 · CR-093 Conductor 0.4.1).
 *
 * Conductor 0.4.1 `AppShell`이 셸의 포커스 규율을 책임진다 — 라우트 전환(`routeKey`)에
 * 서랍을 닫고 `main`으로 포커스를 옮기며, 서랍이 닫히면 여는 버튼으로 되돌린다. 0.3.1에서
 * 제품이 대신 하던 것(라우트 전환 닫기·`main` 포커스·`requestAnimationFrame` 복귀)은
 * 그래서 사라졌다.
 *
 * 제품이 얹는 것은 둘이다:
 *
 * 1. **`aria-live`로 새 화면 제목을 알린다.** 포커스 이동만으로는 "무엇이 바뀌었는가"가
 *    전달되지 않는다. 디자인 시스템은 라우터를 모른다.
 * 2. **빠른 검색 해시로 들어오면 입력이 포커스를 갖는다** (WP-073). `AppShell`이 `main`으로
 *    옮긴 뒤 이 제품의 입력으로 되돌린다 — 디자인 시스템은 이 제품의 검색 입력을 모른다.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppShell } from '@conductor-by-89soone/react';
import type { Role } from '@prs/authz/roles';
import { activeNavId } from '../lib/nav';
import { AppTopBar, type UserSummary } from './AppTopBar';
import { LeftNavPanel } from './LeftNavPanel';

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
     * `AppShell`의 `routeKey` 효과가 **먼저** 돈다(자식 효과가 부모보다 앞선다) — 그것이
     * `main`을 잡은 뒤 여기서 입력으로 되돌린다. 순서가 뒤집히면 `main`이 입력의 포커스를
     * 빼앗아 빠른 검색이 검색창 아닌 본문에 떨어진다.
     */
    if (window.location.hash === '#omni-search-input') {
      document.querySelector<HTMLElement>('[data-omni-input]')?.focus({ preventScroll: true });
    }

    setAnnouncement(title);
  }, [pathname, title]);

  return (
    <AppShell
      className="prs-shell"
      navLabel="주요 화면"
      navCloseLabel="탐색 패널 닫기"
      skipLinkLabel="본문으로 건너뛰기"
      mainId={MAIN_ID}
      /*
       * 라우트가 바뀌면 `AppShell`이 서랍을 닫고 `main`에 포커스를 준다 (0.4.1). 제품이 같은
       * 일을 다시 하지 않는다 — 둘이 하면 포커스가 두 번 움직이고 서랍 닫힘의 복귀가 그 사이에
       * 끼어든다(README 「routeKey는 소비자의 기존 탐색 포커스 로직과 중복 사용하지 않는다」).
       */
      routeKey={pathname ?? ''}
      navOpen={navOpen}
      onNavOpenChange={setNavOpen}
      topBar={
        <AppTopBar
          user={user}
          title={title}
          navOpen={navOpen}
          {...(omniSearch === undefined ? {} : { omniSearch })}
        />
      }
      nav={<LeftNavPanel roles={roles} activeId={activeNavId(pathname)} />}
    >
      {/*
       * 알림 영역은 화면에 보이지 않되 DOM에는 있어야 한다. `display: none`이면
       * 스크린 리더도 읽지 않으므로 Conductor의 시각적 숨김 클래스를 쓴다.
       */}
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="route-announcement" className="cdt-sr-only">
        {announcement}
      </div>
      <div className="prs-page-content">{children}</div>
      <footer className="prs-statusbar" aria-label="작업 안내">
        <span>GitHub Enterprise · 변경 이력 탐색</span>
        <span>시퀀스는 저장소 · 대상 브랜치 기준</span>
      </footer>
    </AppShell>
  );
}
