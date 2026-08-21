/**
 * W-001 통합 검색 라우트 (WP-016).
 *
 * **셸과 세션은 서버가 세우고 조회는 클라이언트가 한다.** 역할 필터링에
 * 필요한 세션은 서버에서만 읽을 수 있고(`server-only` 경계), 조회는 URL이
 * 바뀔 때마다 일어나므로 클라이언트여야 한다.
 */

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { Suspense, type ReactNode } from 'react';
import { SESSION_COOKIE_NAME } from '@prs/authz';
import type { Role } from '@prs/authz/roles';
import { Shell } from '../../components/Shell';
import { SearchView } from '../../components/SearchView';
import { resolveWebConfig } from '../../lib/server/config';
import { sessionStore } from '../../lib/server/session';

export const dynamic = 'force-dynamic';

export default async function SearchPage(): Promise<ReactNode> {
  const config = resolveWebConfig();
  const ghe = process.env['GHE_BASE_URL'];

  const view = (
    /*
     * `useSearchParams`를 쓰는 컴포넌트는 `Suspense` 안에 있어야 한다 —
     * 없으면 빌드가 전체 라우트를 클라이언트 렌더로 떨어뜨린다.
     */
    <Suspense fallback={<p>검색을 준비하는 중…</p>}>
      <SearchView
        loginPath={config.session.loginPath}
        {...(ghe === undefined || ghe === '' ? {} : { gheBaseUrl: ghe })}
      />
    </Suspense>
  );

  if (!config.authEnabled) {
    // 인증이 구성되지 않은 배포에서도 화면은 선다. 조회는 프록시가 401을 낸다.
    return (
      <Shell roles={[]} user={null} title="통합 검색">
        <h1>통합 검색</h1>
        {view}
      </Shell>
    );
  }

  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const loaded = sessionId === undefined ? null : await sessionStore().load(sessionId);

  if (loaded === null) {
    // FLOW-000 3단계: 현재 경로를 담아 로그인으로 (QA-COMMON-18).
    redirect(`${config.session.loginPath}?return_to=${encodeURIComponent('/search')}`);
  }

  const { session } = loaded;
  return (
    <Shell
      roles={session.roles as readonly Role[]}
      user={{ login: session.login, email: session.email }}
      title="통합 검색"
    >
      <h1>통합 검색</h1>
      {view}
    </Shell>
  );
}
