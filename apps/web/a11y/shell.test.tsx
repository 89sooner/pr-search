/**
 * 셸 접근성 (WP-015 DoD / NFR-007, QA-COMMON).
 *
 * **axe 위반 0건**이 DoD다. 다만 axe는 자동 검사라 잡는 것이 정해져 있으므로,
 * 이 파일은 axe 위에 **이 제품이 정한 것들**을 함께 건다 — 스킵 링크,
 * 랜드마크, `aria-current`, `⌘K`, 라우트 전환 알림.
 *
 * `Shell`은 `usePathname`을 쓰므로 라우터를 목으로 세운다. 그것 없이는
 * 컴포넌트가 렌더되지 않아 아무것도 검사할 수 없다.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const pathname = { current: '/search' };

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { Shell } = await import('../components/Shell');
const { EmptyState } = await import('../components/EmptyState');
const { ErrorBanner } = await import('../components/ErrorBanner');
const { SignedOutView } = await import('../components/SignedOutView');

/**
 * axe를 돌리고 위반 목록을 준다. 규칙은 WCAG 2.1 AA로 좁힌다 (NFR-007).
 *
 * **`color-contrast`는 끈다.** jsdom에는 레이아웃도 canvas도 없어 axe가 실제
 * 색을 계산할 수 없다 — 켜 두면 규칙이 조용히 아무것도 검사하지 않으면서
 * "통과"로 보인다. 대비는 **Conductor `checkContrast`가 두 테마 전부를
 * 검사한다**(`pnpm test:contrast`), 그것이 NFR-007이 지정한 계측기다.
 */
async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations;
}

/** 위반을 사람이 읽을 수 있게. 실패했을 때 무엇이 틀렸는지 바로 보이게 한다. */
function describeViolations(list: axe.Result[]): string {
  return list.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)}곳)`).join('\n');
}

beforeEach(() => {
  pathname.current = '/search';
});

afterEach(() => {
  cleanup();
});

describe('axe 위반 0건 (NFR-007)', () => {
  it('셸 전체', async () => {
    const { container } = render(
      <Shell roles={['developer']} user={{ login: 'kim', email: null }} title="통합 검색">
        <h1>통합 검색</h1>
        <p>본문</p>
      </Shell>,
    );

    const found = await violations(container);
    expect(describeViolations(found)).toBe('');
  });

  it('운영 역할로 그려도 위반이 없다 — 항목이 늘어난다', async () => {
    const { container } = render(
      <Shell roles={['developer', 'operator']} user={{ login: 'kim', email: null }} title="파이프라인">
        <h1>파이프라인</h1>
      </Shell>,
    );

    expect(describeViolations(await violations(container))).toBe('');
  });

  it('C-004 EmptyState — 원인 5종 전부', async () => {
    for (const cause of ['no_query', 'no_result', 'not_indexed', 'no_permission', 'not_found'] as const) {
      const { container, unmount } = render(<EmptyState cause={cause} />);
      expect(describeViolations(await violations(container)), cause).toBe('');
      unmount();
    }
  });

  it('C-005 ErrorBanner — tone 3종 전부', async () => {
    for (const tone of ['info', 'warning', 'danger'] as const) {
      const { container, unmount } = render(
        <ErrorBanner
          tone={tone}
          title="조회 실패"
          impact="결과를 표시할 수 없습니다"
          correlationId="corr-1"
          /* `danger`에는 복구 액션이 필수다 — C-005와 Conductor가 함께 건다. */
          action={<button type="button">다시 시도</button>}
        />,
      );
      expect(describeViolations(await violations(container)), tone).toBe('');
      unmount();
    }
  });
});

describe('랜드마크와 스킵 링크 (QA-COMMON)', () => {
  it('banner·navigation·main이 각각 하나씩 있다', () => {
    render(
      <Shell roles={['developer']} user={null} title="통합 검색">
        <h1>통합 검색</h1>
      </Shell>,
    );

    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('스킵 링크가 첫 포커스 대상이고 `main`을 가리킨다', async () => {
    render(
      <Shell roles={['developer']} user={null} title="통합 검색">
        <h1>통합 검색</h1>
      </Shell>,
    );

    await userEvent.tab();
    const focused = document.activeElement as HTMLAnchorElement;

    expect(focused.tagName).toBe('A');
    expect(focused.getAttribute('href')).toBe('#main-content');
    expect(document.getElementById('main-content')).not.toBeNull();
  });

  it('내비게이션에 이름이 있다 — 랜드마크가 여럿일 때 구분된다', () => {
    render(
      <Shell roles={['developer']} user={null} title="통합 검색">
        <h1>x</h1>
      </Shell>,
    );
    expect(screen.getByRole('navigation')).toHaveAccessibleName('주요 화면');
  });
});

describe('QA-A001-10: 운영 항목이 DOM에 없다', () => {
  it('`developer`에게는 운영 링크가 렌더링되지 않는다', () => {
    render(
      <Shell roles={['developer']} user={null} title="통합 검색">
        <h1>x</h1>
      </Shell>,
    );

    // 비활성으로도 보이지 않는다 — 존재 자체를 노출하지 않는다 (C-002).
    expect(screen.queryByRole('link', { name: '파이프라인' })).toBeNull();
    expect(screen.queryByRole('link', { name: '저장소 등록' })).toBeNull();
    expect(screen.queryByRole('link', { name: '감사 기록' })).toBeNull();
  });

  /*
   * **역할마다 보이는 항목이 다르다** (CR-054, DEV-408).
   *
   * 이전 판은 `ops` 섹션을 통째로 두 역할에 열어 **권한 매트릭스와 어긋났다** —
   * `operator`에게 감사 화면이, `security_officer`에게 저장소 등록이 보였다.
   * 두 역할은 서로의 화면에서 403을 받으므로 **보이는 것 자체가 거짓 안내다.**
   */
  it('`operator`에게는 파이프라인·저장소 등록이 렌더링된다', () => {
    render(
      <Shell roles={['developer', 'operator']} user={null} title="파이프라인">
        <h1>x</h1>
      </Shell>,
    );
    expect(screen.getByRole('link', { name: '파이프라인' })).toHaveAttribute('href', '/ops/pipeline');
    expect(screen.getByRole('link', { name: '저장소 등록' })).toHaveAttribute(
      'href',
      '/ops/repositories',
    );
  });

  it('QA-A004-06: **`operator`에게 감사 기록은 렌더링되지 않는다**', () => {
    render(
      <Shell roles={['developer', 'operator']} user={null} title="파이프라인">
        <h1>x</h1>
      </Shell>,
    );
    expect(screen.queryByRole('link', { name: '감사 기록' })).toBeNull();
  });

  it('QA-A004-07: `security_officer`에게 감사 기록과 파이프라인만 보인다', () => {
    render(
      <Shell roles={['developer', 'security_officer']} user={null} title="감사 기록">
        <h1>x</h1>
      </Shell>,
    );
    expect(screen.getByRole('link', { name: '감사 기록' })).toHaveAttribute('href', '/ops/audit');
    // A-001은 CR-052가 연 아카이브 진입점이다 (DEV-375).
    expect(screen.getByRole('link', { name: '파이프라인' })).toHaveAttribute('href', '/ops/pipeline');
    // A-002는 `operator` 전용이다.
    expect(screen.queryByRole('link', { name: '저장소 등록' })).toBeNull();
  });
});

describe('현재 항목 표시', () => {
  it('현재 경로의 링크에 `aria-current="page"`가 붙는다', () => {
    pathname.current = '/search';
    render(
      <Shell roles={['developer']} user={null} title="통합 검색">
        <h1>x</h1>
      </Shell>,
    );

    expect(screen.getByRole('link', { name: '통합 검색' })).toHaveAttribute('aria-current', 'page');
  });

  it('다른 항목에는 붙지 않는다', () => {
    pathname.current = '/search';
    render(
      <Shell roles={['developer']} user={null} title="통합 검색">
        <h1>x</h1>
      </Shell>,
    );

    expect(screen.getByRole('link', { name: '릴리스' })).not.toHaveAttribute('aria-current');
  });
});

describe('⌘K로 옴니 검색에 포커스 (WP-015 DoD)', () => {
  it('`Ctrl+K`가 슬롯의 입력을 잡는다', async () => {
    render(
      <Shell
        roles={['developer']}
        user={null}
        title="통합 검색"
        omniSearch={<input aria-label="옴니 검색" />}
      >
        <h1>x</h1>
      </Shell>,
    );

    const input = screen.getByLabelText('옴니 검색');
    expect(document.activeElement).not.toBe(input);

    await userEvent.keyboard('{Control>}k{/Control}');
    expect(document.activeElement).toBe(input);
  });

  it('`⌘K`(Meta)도 같다 — mac 사용자를 위해', async () => {
    render(
      <Shell roles={['developer']} user={null} title="x" omniSearch={<input aria-label="옴니 검색" />}>
        <h1>x</h1>
      </Shell>,
    );

    await userEvent.keyboard('{Meta>}k{/Meta}');
    expect(document.activeElement).toBe(screen.getByLabelText('옴니 검색'));
  });

  it('수식 키 없는 `k`는 아무것도 하지 않는다 — 타이핑을 가로채지 않는다', async () => {
    render(
      <Shell roles={['developer']} user={null} title="x" omniSearch={<input aria-label="옴니 검색" />}>
        <h1>x</h1>
      </Shell>,
    );

    await userEvent.keyboard('k');
    expect(document.activeElement).not.toBe(screen.getByLabelText('옴니 검색'));
  });

  it('슬롯이 비어 있으면 던지지 않는다 — WP-016 전까지의 상태다', async () => {
    render(
      <Shell roles={['developer']} user={null} title="x">
        <h1>x</h1>
      </Shell>,
    );

    await expect(userEvent.keyboard('{Control>}k{/Control}')).resolves.not.toThrow();
  });
});

/*
 * 좁은 화면(≤800px)에서는 Conductor가 사이드바를 `display: none`으로 감추고
 * 내비게이션을 서랍으로만 연다. `AppShell`은 여는 버튼을 만들어 주지 않으므로
 * **그 버튼이 없으면 내비게이션에 닿을 방법이 아예 없다.** jsdom에는 뷰포트도
 * CSS도 없어 "800px 이하에서 보인다"는 여기서 걸 수 없다 — 그것은 Conductor의
 * `.cdt-topbar__menu-button` 규칙이 정한다. 여기서 거는 것은 **버튼이 존재하고,
 * 키보드로 닿고, 서랍을 실제로 여닫는가**다.
 */
describe('좁은 화면 내비게이션 (QA-COMMON-06, QA-COMMON-07)', () => {
  function toggle(): HTMLElement {
    return screen.getByRole('button', { name: /주요 화면/ });
  }

  it('여는 버튼이 있다 — 없으면 좁은 화면에서 내비게이션이 사라진다', () => {
    render(
      <Shell roles={['developer']} user={null} title="x">
        <h1>x</h1>
      </Shell>,
    );

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(toggle()).toHaveAccessibleName('주요 화면 열기');
  });

  it('키보드로 닿고 눌리면 서랍이 열린다', async () => {
    render(
      <Shell roles={['developer']} user={null} title="x">
        <h1>x</h1>
      </Shell>,
    );

    toggle().focus();
    await userEvent.keyboard('{Enter}');

    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(toggle()).toHaveAccessibleName('주요 화면 닫기');
    // 서랍이 실제로 떠야 한다 — 상태만 바뀌고 아무것도 안 뜨면 소용없다.
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('열려 있어도 내비게이션 랜드마크는 하나다 — 사이드바와 서랍이 겹치지 않는다', async () => {
    render(
      <Shell roles={['developer']} user={null} title="x">
        <h1>x</h1>
      </Shell>,
    );

    await userEvent.click(toggle());
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
  });

  it('`Escape`로 닫히고 포커스가 버튼으로 돌아온다 (QA-COMMON-07)', async () => {
    render(
      <Shell roles={['developer']} user={null} title="x">
        <h1>x</h1>
      </Shell>,
    );

    await userEvent.click(toggle());
    await userEvent.keyboard('{Escape}');

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    /*
     * 포커스가 돌아오지 않으면 키보드 사용자는 문서 처음으로 튕긴다.
     * 되돌리기는 한 프레임 뒤다 — Radix가 포커스를 푸는 것이 이펙트보다
     * 늦기 때문이다. 그래서 즉시 단언하지 않고 기다린다.
     */
    await waitFor(() => {
      expect(document.activeElement).toBe(toggle());
    });
  });

  it('**라우트 전환으로 닫힐 때는 포커스를 뺏지 않는다** — `main`이 이긴다', async () => {
    /*
     * 라우트 전환도 서랍을 닫는다(`Shell`이 `setNavOpen(false)`를 부른다).
     * 그때 포커스는 새 화면의 `main`으로 가야 한다 — 여기서 되돌리기가
     * 그것을 빼앗으면 화면이 바뀌어도 포커스가 상단 버튼에 남아, 다음 탭이
     * 새 본문이 아니라 상단 바 다음 항목으로 간다.
     */
    const { rerender } = render(
      <Shell roles={['developer']} user={null} title="통합 검색">
        <h1>x</h1>
      </Shell>,
    );

    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');

    pathname.current = '/releases';
    rerender(
      <Shell roles={['developer']} user={null} title="릴리스">
        <h1>y</h1>
      </Shell>,
    );

    // 한 프레임 뒤에 되돌리기가 돌아도 `main`을 유지해야 한다.
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve(null);
        });
      });
    });

    expect(document.activeElement).toBe(document.getElementById('main-content'));

    // 서랍은 닫혀 있어야 한다 — 열린 채로 두면 새 화면이 그 뒤에 가린다.
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('서랍을 연 채로도 axe 위반이 없다', async () => {
    render(
      <Shell roles={['developer', 'operator']} user={null} title="x">
        <h1>x</h1>
      </Shell>,
    );

    await userEvent.click(toggle());
    // 서랍은 포털로 나가므로 렌더 `container`가 아니라 `document.body`를 훑는다.
    expect(describeViolations(await violations(document.body))).toBe('');
  });
});

describe('라우트 전환 알림', () => {
  it('알림 영역이 `aria-live=polite`다', () => {
    render(
      <Shell roles={['developer']} user={null} title="통합 검색">
        <h1>x</h1>
      </Shell>,
    );

    const region = screen.getByTestId('route-announcement');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('role')).toBe('status');
  });

  it('첫 렌더에서는 알리지 않는다 — 페이지 로드는 브라우저가 이미 알린다', () => {
    render(
      <Shell roles={['developer']} user={null} title="통합 검색">
        <h1>x</h1>
      </Shell>,
    );
    expect(screen.getByTestId('route-announcement').textContent).toBe('');
  });

  it('경로가 바뀌면 새 제목을 알리고 `main`으로 포커스를 옮긴다', async () => {
    const { rerender } = render(
      <Shell roles={['developer']} user={null} title="통합 검색">
        <h1>x</h1>
      </Shell>,
    );

    pathname.current = '/releases';
    rerender(
      <Shell roles={['developer']} user={null} title="릴리스">
        <h1>y</h1>
      </Shell>,
    );

    expect(screen.getByTestId('route-announcement').textContent).toBe('릴리스');
    expect(document.activeElement).toBe(document.getElementById('main-content'));
  });
});

/**
 * C-001 사용자 메뉴와 로그아웃 (CR-092 / DEV-700, FR-AUTH-001 AC-5).
 *
 * 사내 `0.1.0-pilot.7`에는 화면에 로그아웃이 없었다. 로그인 이름이 메뉴의 트리거가 되고, 그 안의 「로그아웃」이
 * `POST /auth/logout` 폼을 제출한다 — 링크(`GET`)로 만들지 않는다.
 */
describe('사용자 메뉴 (CR-092 / DEV-700)', () => {
  const renderSignedIn = (): void => {
    render(
      <Shell roles={['developer']} user={{ login: 'kim', email: 'kim@corp.example' }} title="통합 검색">
        <h1>통합 검색</h1>
      </Shell>,
    );
  };
  const trigger = (): HTMLElement => screen.getByRole('button', { name: '사용자 메뉴: kim' });

  it('로그인 이름이 메뉴 버튼이고 닫혀 있다', () => {
    renderSignedIn();
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('키보드로 열면 신원과 로그아웃 항목이 보이고, 연 채로도 axe 위반이 없다', async () => {
    renderSignedIn();
    trigger().focus();
    await userEvent.keyboard('{Enter}');

    const menu = await screen.findByRole('menu');
    expect(menu).toHaveTextContent('kim@corp.example');
    expect(screen.getByRole('menuitem', { name: '로그아웃' })).toBeInTheDocument();
    // 메뉴는 포털로 나가므로 `document.body`를 훑는다.
    expect(describeViolations(await violations(document.body))).toBe('');
  });

  it('로그아웃을 고르면 로그아웃 폼을 POST로 제출한다 — 스크립트가 요청과 이동을 따로 잇지 않는다', async () => {
    renderSignedIn();
    const form = screen.getByTestId('logout-form') as HTMLFormElement;
    const submitted = vi.fn((event: Event) => {
      // jsdom은 제출에 따른 이동을 구현하지 않는다. 이동은 e2e가 본다.
      event.preventDefault();
    });
    form.addEventListener('submit', submitted);

    trigger().focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('menu');
    screen.getByRole('menuitem', { name: '로그아웃' }).focus();
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(submitted).toHaveBeenCalledTimes(1);
    });
    expect(form.method).toBe('post');
    expect(new URL(form.action).pathname).toBe('/auth/logout');
  });

  it('인증을 끈 배포에는 사용자 메뉴도 로그아웃 폼도 없다', () => {
    render(
      <Shell roles={[]} user={null} title="x">
        <h1>x</h1>
      </Shell>,
    );
    expect(screen.queryByTestId('user-summary')).toBeNull();
    expect(screen.queryByTestId('logout-form')).toBeNull();
  });
});

describe('로그아웃 완료 화면 (CR-092 / DEV-700)', () => {
  it('main 하나·제목 하나·다시 로그인 링크가 있고 axe 위반이 없다', async () => {
    const { container } = render(<SignedOutView loginHref="/auth/login?return_to=%2F" />);

    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: '로그아웃했습니다' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '다시 로그인' })).toHaveAttribute('href', '/auth/login?return_to=%2F');
    // PR Search 세션만 끝났다는 사실을 말한다 — 공용 PC에서 IdP 세션이 남는다.
    expect(container).toHaveTextContent('사내 로그인');
    expect(describeViolations(await violations(container))).toBe('');
  });
});
