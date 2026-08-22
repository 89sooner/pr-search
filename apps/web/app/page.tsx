/**
 * 진입 화면 (WP-015).
 *
 * 개별 화면은 WP-016 이후다. 여기서는 **셸이 실제로 서는지**를 보인다 —
 * 세션에서 역할을 읽어 내비게이션을 거르고, 빈 상태를 그린다.
 */

import type { ReactNode } from 'react';
import { EmptyState } from '../components/EmptyState';
import { GuardedPage } from '../lib/server/page-guard';

export const dynamic = 'force-dynamic';

export default function HomePage(): ReactNode {
  // 세션 관문은 `GuardedPage` 하나가 소유한다 (WP-018).
  return (
    <GuardedPage
      title="PR Search"
      returnTo="/"
      whenAuthDisabled={<EmptyState cause="no_permission" title="인증이 구성되지 않았습니다" />}
    >
      <h1>PR Search</h1>
      <EmptyState cause="no_query" />
    </GuardedPage>
  );
}
