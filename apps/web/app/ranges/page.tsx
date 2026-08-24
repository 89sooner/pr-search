/**
 * W-004 범위 조사 라우트 (WP-025 / FLOW-003).
 *
 * 경로는 셸 내비게이션이 소유한 `/ranges`다 (CR-029, DEV-153). 셸·세션은
 * 서버가 세우고 조회는 클라이언트가 한다 — W-001과 같은 구조.
 */

import { Suspense, type ReactNode } from 'react';
import { RangesView } from '../../components/RangesView';
import { resolveWebConfig } from '../../lib/server/config';
import { GuardedPage } from '../../lib/server/page-guard';

export const dynamic = 'force-dynamic';

export default async function RangesPage(): Promise<ReactNode> {
  const config = resolveWebConfig();

  return (
    <GuardedPage title="범위 조사" returnTo="/ranges">
      <h1>범위 조사</h1>
      <Suspense fallback={<p>범위 조사를 준비하는 중…</p>}>
        <RangesView loginPath={config.session.loginPath} />
      </Suspense>
    </GuardedPage>
  );
}
