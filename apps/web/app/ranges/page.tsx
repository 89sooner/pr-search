/**
 * W-004 범위 조사 라우트 (WP-025 / FLOW-003).
 *
 * 경로는 셸 내비게이션이 소유한 `/ranges`다 (CR-029, DEV-153). 셸·세션은
 * 서버가 세우고 조회는 클라이언트가 한다 — W-001과 같은 구조.
 *
 * **역할을 관문에서 받아 넘긴다** (WP-041 / FR-SEQ-006 AC-3). 안전 구간
 * 표식 등록이 `release_manager`에게만 열리므로 그 사실을 첫 렌더에 말해
 * 주어야 한다 — 눌러 보고 403을 받아 알게 하는 방식은 사용자가 자기 자격을
 * 요청으로 시험하게 만든다. **라우트가 세션을 직접 읽지 않는 것은 그대로다**:
 * 관문이 하나여야 빠뜨릴 자리가 없다 (`/ops/pipeline`과 같은 구조).
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
      {({ roles, authEnabled }) => (
        <>
          <h1>범위 조사</h1>
          <Suspense fallback={<p>범위 조사를 준비하는 중…</p>}>
            <RangesView
              loginPath={config.session.loginPath}
              roles={roles}
              authEnabled={authEnabled}
            />
          </Suspense>
        </>
      )}
    </GuardedPage>
  );
}
