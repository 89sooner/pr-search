/**
 * W-006 통계 대시보드 라우트 (WP-038 / FR-STAT-001~006).
 *
 * `/search`·`/repositories`와 같은 구조다: 셸과 세션은 서버가 세우고 패널 조회는
 * 클라이언트가 한다(패널별 독립 조회·실패 격리, 상태 매트릭스 W-006). 집계도
 * 접근 범위 조건이 강제 결합되므로(FR-AUTH-002 AC-5) 결과를 캐시하지 않는다.
 *
 * **경로 정본은 `/analytics`다** (프런트엔드 아키텍처 라우트 표, DEV-396). 옛
 * `nav.ts`가 가리키던 `/stats`는 문서에 없는 404였고 이 라우트로 바로잡았다.
 */

import { Suspense, type ReactNode } from 'react';
import { AnalyticsView } from '../../components/AnalyticsView';
import { resolveWebConfig } from '../../lib/server/config';
import { GuardedPage } from '../../lib/server/page-guard';

export const dynamic = 'force-dynamic';

export default function AnalyticsPage(): ReactNode {
  const config = resolveWebConfig();

  return (
    <GuardedPage title="통계" returnTo="/analytics">
      <h1>통계 대시보드</h1>
      {/* `useSearchParams`를 쓰는 클라이언트 컴포넌트는 Suspense 안에 있어야 한다. */}
      <Suspense fallback={<p>통계를 준비하는 중…</p>}>
        <AnalyticsView loginPath={config.session.loginPath} />
      </Suspense>
    </GuardedPage>
  );
}
