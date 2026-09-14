/**
 * A-006 gh capability·버전 레지스트리 라우트 (WP-078 / FR-GH-001 AC-5·AC-6, FR-GH-011, NFR-009, CR-088).
 *
 * `/ops/jobs`와 같은 구조다 — 셸과 세션은 서버가 세우고 조회는 클라이언트가 한다.
 *
 * **역할을 여기서 판정하지 않는다.** `GuardedPage`는 "로그인했는가"까지만 보고(그 파일의 규율), 역할은
 * `API-GH-013`이 강제한다 — 화면이 그것을 흉내 내면 두 판정이 갈라진다. 자격이 없으면 조회가 403을
 * 내고 화면이 `no_permission`을 그린다. 배포가 GitHub 작업을 껐으면 404를 「열리지 않았다」로 그린다.
 */

import type { ReactNode } from 'react';
import { GhRegistryApprovalPanel } from '../../../components/GhRegistryApprovalPanel';
import { GhRegistryView } from '../../../components/GhRegistryView';
import { canChangePolicy } from '../../../lib/gh-policy';
import { GuardedPage } from '../../../lib/server/page-guard';

export const dynamic = 'force-dynamic';

export default async function GhRegistryPage(): Promise<ReactNode> {
  return (
    <GuardedPage title="gh capability 레지스트리" returnTo="/ops/gh-registry">
      {({ roles, authEnabled }) => (
        <>
          <h1>gh capability·버전 레지스트리</h1>
          {/* 운영 승인 (CR-090). 승인·철회 버튼은 operator에게만 그린다 — 변경 권한은 API-GH-008이 요청마다 다시 본다. */}
          <GhRegistryApprovalPanel canChange={canChangePolicy(roles, authEnabled)} />
          <GhRegistryView />
        </>
      )}
    </GuardedPage>
  );
}
