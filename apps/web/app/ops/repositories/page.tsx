/**
 * A-002 저장소 등록 관리 라우트 (WP-040 / FR-ING-009, CR-055).
 *
 * `/ops/audit`와 같은 구조다 — 셸과 세션은 서버가 세우고 조회는 클라이언트가
 * 한다. 등록 상태와 대기열은 조작할 때마다 바뀌므로 캐시하지 않는다.
 *
 * **역할을 여기서 판정하지 않는다.** `GuardedPage`는 "로그인했는가"까지만
 * 보고, 역할은 `API-ADM-001`·`API-ADM-009`가 강제한다.
 */

import type { ReactNode } from 'react';
import { OpsRepositoriesView } from '../../../components/OpsRepositoriesView';
import { GuardedPage } from '../../../lib/server/page-guard';

export const dynamic = 'force-dynamic';

export default async function OpsRepositoriesPage(): Promise<ReactNode> {
  return (
    <GuardedPage title="Repository registration management" returnTo="/ops/repositories">
      <h1>Repository registration management</h1>
      <OpsRepositoriesView />
    </GuardedPage>
  );
}
