/**
 * A-001 수집 파이프라인 콘솔 라우트 (WP-040 / FR-ADMIN-001, FR-ING-010, CR-052·CR-055).
 *
 * `/ops/audit`와 같은 구조다 — 셸과 세션은 서버가 세우고 조회는 클라이언트가
 * 한다. 지표는 30초마다 바뀌므로 캐시하지 않는다.
 *
 * **역할을 관문에서 받아 넘긴다.** 다른 운영 화면과 달리 이 화면은 역할에 따라
 * **무엇을 요청할지**가 달라진다 — `security_officer`는 `A-001-ARCHIVE`만 보고
 * `operator` 전용 조회를 **보내지도 않는다** (CR-052, DEV-375). 403을 받아
 * 숨기는 방식은 권한 판정을 화면 뒤로 미루는 일이므로, 판정에 필요한 역할이
 * 첫 렌더에 있어야 한다. 라우트가 세션을 직접 읽지 않는 것은 그대로다.
 */

import type { ReactNode } from 'react';
import { OpsPipelineView } from '../../../components/OpsPipelineView';
import { GuardedPage } from '../../../lib/server/page-guard';

export const dynamic = 'force-dynamic';

export default async function OpsPipelinePage(): Promise<ReactNode> {
  return (
    <GuardedPage title="Collection pipeline" returnTo="/ops/pipeline">
      {({ roles, authEnabled }) => (
        <>
          <h1>Collection pipeline</h1>
          <OpsPipelineView roles={roles} authEnabled={authEnabled} />
        </>
      )}
    </GuardedPage>
  );
}
