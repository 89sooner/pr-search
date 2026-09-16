/**
 * W-021 실행 이력 라우트 (WP-077 / FR-GH-012, CR-086).
 *
 * 역할은 관문이 넘긴다 — `security_officer`에게만 전체 보기 스위치를 그리기 위해서다 (A-001이
 * 같은 방법으로 아카이브 섹션을 연다). 판정 자체는 `API-GH-010`이 한다: 스위치를 켜도 역할이
 * 없으면 서버가 403을 낸다.
 */

import type { ReactNode } from 'react';
import { GhHistoryView } from '../../../components/GhHistoryView';
import { GuardedPage } from '../../../lib/server/page-guard';

export const dynamic = 'force-dynamic';

export default async function GhHistoryPage(): Promise<ReactNode> {
  return (
    <GuardedPage title="GitHub run history" returnTo="/gh/history">
      {({ roles }) => (
        <>
          <header className="prs-page-heading">
            <div>
              <p className="prs-eyebrow">GITHUB OPERATIONS</p>
              <h1>Run history</h1>
            </div>
            <p>View the status and results of your gh runs. Running again with the same configuration creates a new preview and a new run.</p>
          </header>
          <GhHistoryView canSeeAll={roles.includes('security_officer')} />
        </>
      )}
    </GuardedPage>
  );
}
