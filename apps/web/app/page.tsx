/**
 * 진입 화면 (WP-015).
 *
 * 개별 화면은 WP-016 이후다. 여기서는 **셸이 실제로 서는지**를 보인다 —
 * 세션에서 역할을 읽어 내비게이션을 거르고, 빈 상태를 그린다.
 */

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { SESSION_COOKIE_NAME } from '@prs/authz';
import type { Role } from '@prs/authz/roles';
import { Shell } from '../components/Shell';
import { EmptyState } from '../components/EmptyState';
import { resolveWebConfig } from '../lib/server/config';
import { sessionStore } from '../lib/server/session';

export const dynamic = 'force-dynamic';

export default async function HomePage(): Promise<ReactNode> {
  const config = resolveWebConfig();

  /*
   * 인증이 구성되지 않은 배포에서는 셸만 보인다.
   *
   * 로그인 경로가 없는데 리다이렉트하면 무한 루프가 된다 — WP-012가
   * `search-api`에서 같은 판단을 한 것과 같은 이유다.
   */
  if (!config.authEnabled) {
    return (
      <Shell roles={[]} user={null} title="PR Search">
        <EmptyState cause="no_permission" title="인증이 구성되지 않았습니다" />
      </Shell>
    );
  }

  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const loaded = sessionId === undefined ? null : await sessionStore().load(sessionId);

  if (loaded === null) {
    // FLOW-000 3단계: 현재 경로를 담아 로그인으로 보낸다.
    redirect(`${config.session.loginPath}?return_to=${encodeURIComponent('/')}`);
  }

  const { session } = loaded;
  return (
    <Shell
      roles={session.roles as readonly Role[]}
      user={{ login: session.login, email: session.email }}
      title="PR Search"
    >
      <h1>PR Search</h1>
      <EmptyState cause="no_query" />
    </Shell>
  );
}
