/**
 * W-010 GitHub Command Center 라우트 (WP-077 / REL-007 R0, CR-086).
 *
 * `/ops/jobs`와 같은 구조다 — 셸과 세션은 서버가 세우고 조회는 클라이언트가 한다.
 *
 * **역할을 여기서 판정하지 않는다.** 실행 자격은 역할이 아니라 **위임 신원**(Operations App
 * 연결)이 정하고, 그 판정은 `search-api`가 한다 (FR-GH-008). `GuardedPage`는 "로그인했는가"까지만
 * 본다 (그 파일의 규율).
 */

import { Suspense, type ReactNode } from 'react';
import { GhCommandCenterView } from '../../components/GhCommandCenterView';
import { GuardedPage } from '../../lib/server/page-guard';

export const dynamic = 'force-dynamic';

export default async function GhCommandCenterPage(): Promise<ReactNode> {
  return (
    <GuardedPage title="GitHub operations" returnTo="/gh">
      <header className="prs-page-heading">
        <div>
          <p className="prs-eyebrow">GITHUB OPERATIONS</p>
          <h1>GitHub operations</h1>
        </div>
        <p>Run isolated gh commands with your delegated permissions and review the results. Results are live GHE responses from the time of execution, not search index data.</p>
      </header>
      {/*
       * `useSearchParams`(`?prefill=`·`?identity=`)를 쓰는 컴포넌트는 `Suspense` 안에 있어야 한다 —
       * 없으면 빌드가 전체 라우트를 클라이언트 렌더로 떨어뜨린다 (W-001과 같은 자리).
       */}
      <Suspense fallback={<p>Loading GitHub operations…</p>}>
        <GhCommandCenterView />
      </Suspense>
    </GuardedPage>
  );
}
