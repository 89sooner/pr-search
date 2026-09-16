/**
 * W-001 통합 검색 라우트 (WP-016).
 *
 * **셸과 세션은 서버가 세우고 조회는 클라이언트가 한다.** 역할 필터링에
 * 필요한 세션은 서버에서만 읽을 수 있고(`server-only` 경계), 조회는 URL이
 * 바뀔 때마다 일어나므로 클라이언트여야 한다.
 */

import { Suspense, type ReactNode } from 'react';
import { SearchView } from '../../components/SearchView';
import { resolveWebConfig } from '../../lib/server/config';
import { GuardedPage } from '../../lib/server/page-guard';
import { RepositoryWorkspace } from '../../components/RepositoryWorkspace';

export const dynamic = 'force-dynamic';

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<ReactNode> {
  const config = resolveWebConfig();
  const ghe = process.env['GHE_BASE_URL'];
  const legacy = (await searchParams)['legacy'] === '1';

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

  // 세션 관문은 `GuardedPage` 하나가 소유한다 (WP-018) — 라우트마다 복제하면
  // `redirect` 한 줄을 빠뜨린 라우트가 인증 구멍이 된다.
  return (
    <GuardedPage title="통합 검색" returnTo="/search">
      {({ roles, login }) => (process.env['PRS_LEGACY_SEARCH'] === '1' || (roles.includes('operator') && legacy)) ? <>
      <header className="prs-page-heading">
        <div><p className="prs-eyebrow">SEARCH WORKSPACE</p><h1>통합 검색</h1></div>
        <p>PR · 커밋 · 머지 시퀀스를 한곳에서 탐색합니다.</p>
      </header>
      {view}
      </> : <Suspense fallback={<p>저장소를 준비하는 중…</p>}><RepositoryWorkspace loginPath={config.session.loginPath} {...(login ? { login } : {})} {...(ghe ? { gheBaseUrl: ghe } : {})} /></Suspense>}
    </GuardedPage>
  );
}
