/**
 * 화면 라우트의 세션 관문 (WP-018 / FR-AUTH-001, FLOW-000).
 *
 * ## 왜 지금 묶는가
 *
 * WP-015·WP-016·WP-017이 세운 라우트 셋이 **같은 다섯 줄을 각자 갖고 있었다** —
 * 쿠키를 읽고, 세션을 싣고, 없으면 `return_to`를 담아 로그인으로 보낸다.
 * WP-017은 그것을 묶는 대신 `architecture.test.ts`로 **빠뜨릴 수 없게** 만들고
 * 네 번째 화면과 함께 묶기로 미뤘다. 그 네 번째가 W-003이다.
 *
 * 복제가 위험한 이유는 문법이 아니라 **빠뜨림**이다. 다섯 줄 중 `redirect(`
 * 한 줄만 없어도 미인증 사용자가 화면을 보게 되고, 그것은 리뷰에서 눈에 띄지
 * 않는다. 관문이 하나면 빠뜨릴 자리가 없다.
 *
 * ## 무엇을 하지 않는가
 *
 * **접근 범위를 판정하지 않는다.** 이 관문은 "로그인했는가"까지만 본다 —
 * 어느 저장소를 볼 수 있는가는 서버(`search-api`)가 모든 조회에 강제하고
 * (ADR-008), 화면이 그것을 흉내 내면 두 판정이 갈라진다.
 */

import 'server-only';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { SESSION_COOKIE_NAME } from '@prs/authz';
import type { Role } from '@prs/authz/roles';
import { Shell } from '../../components/Shell';
import { resolveWebConfig } from './config';
import { sessionStore } from './session';

/** 관문이 화면에 넘기는 세션 정보. */
export interface GuardedPageContext {
  readonly roles: readonly Role[];
  /**
   * 이 배포에 인증이 구성되어 있는가.
   *
   * **`false`일 때 빈 `roles`를 "권한 없음"으로 읽으면 안 된다** — 그것은
   * 역할을 알 수 없다는 뜻이지 자격이 없다는 뜻이 아니다. 이 저장소의 관행은
   * "인증 없이도 화면은 서고 조회만 프록시가 401로 막는다"이며, 역할로 요청
   * 여부를 가르는 화면(`A-001`)이 그 관행에서 혼자 벗어나지 않게 한다.
   */
  readonly authEnabled: boolean;
}

export interface GuardedPageProps {
  /** 셸의 제목. 라우트 전환 알림이 이 값을 읽는다 (QA-COMMON-14). */
  readonly title: string;
  /**
   * 로그인 뒤 돌아올 경로. **현재 경로 그대로**여야 한다 — 다른 곳으로
   * 보내면 사용자가 하던 조사를 잃는다 (FLOW-000 3단계, QA-COMMON-18).
   */
  readonly returnTo: string;
  /**
   * 화면 본문.
   *
   * **함수로 주면 세션의 역할을 받는다** (WP-040 / CR-052 DEV-375). `A-001`은
   * `security_officer`에게 아카이브 섹션만 열고 `operator` 전용 조회를
   * **보내지도 않아야** 하는데, 그 판정을 클라이언트에서 하려면 역할을 알아야
   * 한다. 라우트가 세션을 직접 읽으면 관문이 둘이 되므로 관문이 넘긴다 —
   * 세션에 관한 결정은 여기 하나에 모여 있다.
   */
  readonly children: ReactNode | ((context: GuardedPageContext) => ReactNode);
  /**
   * 인증이 **구성되지 않은** 배포에서 대신 그릴 것.
   *
   * 없으면 `children`을 그대로 그린다. 진입 화면(`/`)만 이것을 쓴다 —
   * 그 화면의 목적이 "무엇을 할 수 있는가"를 보이는 것이라, 인증이 없으면
   * 그 사실 자체가 답이기 때문이다. 다른 화면은 인증 없이도 화면이 서고
   * 조회만 프록시가 401로 막는다.
   */
  readonly whenAuthDisabled?: ReactNode;
}

/**
 * 세션을 확인하고 셸 안에 화면을 세운다.
 *
 * @returns 인증이 구성되지 않은 배포에서는 역할 없이 셸을 세운다 — 화면은
 * 서되 조회는 프록시가 401을 낸다. 세션이 없으면 `redirect()`가 던지므로
 * 이 함수는 반환하지 않는다.
 */
export async function GuardedPage({
  title,
  returnTo,
  children,
  whenAuthDisabled,
}: GuardedPageProps): Promise<ReactNode> {
  const config = resolveWebConfig();

  /** 본문을 편다. 함수면 세션 정보를 넘긴다. */
  const render = (roles: readonly Role[]): ReactNode =>
    typeof children === 'function' ? children({ roles, authEnabled: config.authEnabled }) : children;

  /*
   * 로그인 경로가 없는데 리다이렉트하면 **무한 루프**가 된다 — WP-012가
   * `search-api`에서 같은 판단을 한 것과 같은 이유다.
   */
  if (!config.authEnabled) {
    return (
      <Shell roles={[]} user={null} title={title}>
        {whenAuthDisabled ?? render([])}
      </Shell>
    );
  }

  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const loaded = sessionId === undefined ? null : await sessionStore().load(sessionId);

  if (loaded === null) {
    redirect(`${config.session.loginPath}?return_to=${encodeURIComponent(returnTo)}`);
  }

  const { session } = loaded;
  const roles = session.roles as readonly Role[];
  return (
    <Shell roles={roles} user={{ login: session.login, email: session.email }} title={title}>
      {render(roles)}
    </Shell>
  );
}
