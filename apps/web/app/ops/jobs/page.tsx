/**
 * A-003 인덱스·잡 운영 라우트 (WP-040 / FR-ADMIN-002, CR-055).
 *
 * `/ops/audit`와 같은 구조다 — 셸과 세션은 서버가 세우고 조회는 클라이언트가
 * 한다. 잡 상태는 30초마다 바뀌므로 캐시하지 않는다.
 *
 * **역할을 여기서 판정하지 않는다.** `GuardedPage`는 "로그인했는가"까지만
 * 보고(그 파일의 규율), 역할은 `API-ADM-002`가 강제한다 — 화면이 그것을
 * 흉내 내면 두 판정이 갈라진다. 자격이 없으면 조회가 403을 내고 화면이
 * `no_permission`을 그린다.
 */

import type { ReactNode } from 'react';
import { OpsJobsView } from '../../../components/OpsJobsView';
import { GuardedPage } from '../../../lib/server/page-guard';

export const dynamic = 'force-dynamic';

export default async function OpsJobsPage(): Promise<ReactNode> {
  return (
    <GuardedPage title="인덱스·잡 운영" returnTo="/ops/jobs">
      <h1>인덱스·잡 운영</h1>
      <OpsJobsView />
    </GuardedPage>
  );
}
