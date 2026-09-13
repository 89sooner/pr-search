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
    <GuardedPage title="GitHub 실행 이력" returnTo="/gh/history">
      {({ roles }) => (
        <>
          <header className="prs-page-heading">
            <div>
              <p className="prs-eyebrow">GITHUB OPERATIONS</p>
              <h1>실행 이력</h1>
            </div>
            <p>내가 요청한 gh 실행의 상태와 결과입니다. 「같은 구성으로 다시 실행」은 새 미리보기와 새 실행을 만듭니다.</p>
          </header>
          <GhHistoryView canSeeAll={roles.includes('security_officer')} />
        </>
      )}
    </GuardedPage>
  );
}
