/**
 * A-005 gh 실행 정책 라우트 — 최소 부분 (WP-080 / FR-GH-009 AC-8, CR-090).
 *
 * `/ops/gh-registry`와 같은 구조다 — 셸과 세션은 서버가 세우고 조회·변경은 클라이언트가 한다.
 *
 * **역할로 버튼만 정한다.** 조회 권한은 `API-GH-008`이 `operator`·`security_officer`로 강제하고, 변경은 `operator`만이다.
 * 관문이 넘긴 역할로 버튼을 그릴지 정할 뿐이며, 조회 전용 사용자가 요청을 보내도 서버가 403으로 거절한다.
 */

import type { ReactNode } from 'react';
import { GhPolicyView } from '../../../components/GhPolicyView';
import { canChangePolicy } from '../../../lib/gh-policy';
import { GuardedPage } from '../../../lib/server/page-guard';

export const dynamic = 'force-dynamic';

export default async function GhPolicyPage(): Promise<ReactNode> {
  return (
    <GuardedPage title="gh execution policy" returnTo="/ops/gh-policy">
      {({ roles, authEnabled }) => (
        <>
          <h1>gh execution policy</h1>
          <GhPolicyView canChange={canChangePolicy(roles, authEnabled)} />
        </>
      )}
    </GuardedPage>
  );
}
