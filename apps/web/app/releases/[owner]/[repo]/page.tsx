/**
 * W-005 릴리스 타임라인 라우트 (WP-026 / FLOW-003).
 *
 * 딥링크 `/releases/:owner/:repo?branch=&select=` (IA 4장, CR-030 DEV-158).
 * 셸·세션은 서버가 세우고 조회는 클라이언트가 한다 — W-004와 같은 구조.
 */

import { Suspense, type ReactNode } from 'react';
import { ReleasesView } from '../../../../components/ReleasesView';
import { resolveWebConfig } from '../../../../lib/server/config';
import { GuardedPage } from '../../../../lib/server/page-guard';

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly params: Promise<{ readonly owner: string; readonly repo: string }>;
}

export default async function ReleasesPage({ params }: PageProps): Promise<ReactNode> {
  const { owner, repo } = await params;
  const config = resolveWebConfig();
  const decodedOwner = decodeURIComponent(owner);
  const decodedRepo = decodeURIComponent(repo);

  return (
    <GuardedPage title="릴리스" returnTo={`/releases/${decodedOwner}/${decodedRepo}`}>
      <h1>릴리스</h1>
      <Suspense fallback={<p>릴리스 타임라인을 준비하는 중…</p>}>
        <ReleasesView owner={decodedOwner} repo={decodedRepo} loginPath={config.session.loginPath} />
      </Suspense>
    </GuardedPage>
  );
}
