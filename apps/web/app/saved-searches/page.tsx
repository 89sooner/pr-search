/**
 * W-008 저장된 검색 라우트 (WP-033 / CR-049).
 *
 * `/search`와 같은 구조다 — 셸과 세션은 서버가 세우고 조회는 클라이언트가
 * 한다. 목록은 사용자의 소속과 소유에 따라 달라지므로 캐시하지 않는다.
 */

import type { ReactNode } from 'react';
import { SavedSearchesView } from '../../components/SavedSearchesView';
import { resolveWebConfig } from '../../lib/server/config';
import { GuardedPage } from '../../lib/server/page-guard';

export const dynamic = 'force-dynamic';

export default async function SavedSearchesPage(): Promise<ReactNode> {
  const config = resolveWebConfig();

  // 세션 관문은 `GuardedPage` 하나가 소유한다 (WP-018).
  return (
    <GuardedPage title="Saved searches" returnTo="/saved-searches">
      <h1>Saved searches</h1>
      <SavedSearchesView loginPath={config.session.loginPath} />
    </GuardedPage>
  );
}
