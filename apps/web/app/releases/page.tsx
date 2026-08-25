/**
 * W-005 릴리스·빌드 라우트 (WP-026 / FLOW-003).
 *
 * 경로는 셸 내비게이션이 소유한 `/releases`다 (CR-030, DEV-157) — 문서가 적던
 * `/releases/[owner]/[repo]`로 두면 셸의 "릴리스" 항목이 404가 된다. 셸·세션은
 * 서버가 세우고 조회는 클라이언트가 한다 — W-004와 같은 구조.
 */

import { Suspense, type ReactNode } from 'react';
import { ReleasesView } from '../../components/ReleasesView';
import { resolveWebConfig } from '../../lib/server/config';
import { GuardedPage } from '../../lib/server/page-guard';

export const dynamic = 'force-dynamic';

export default async function ReleasesPage(): Promise<ReactNode> {
  const config = resolveWebConfig();

  return (
    <GuardedPage title="릴리스" returnTo="/releases">
      <h1>릴리스</h1>
      <Suspense fallback={<p>릴리스를 준비하는 중…</p>}>
        <ReleasesView loginPath={config.session.loginPath} />
      </Suspense>
    </GuardedPage>
  );
}
