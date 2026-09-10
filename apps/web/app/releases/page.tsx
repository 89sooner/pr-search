/**
 * W-005 진입 라우트 (WP-026 / CR-030).
 *
 * 내비게이션 `릴리스`가 여기로 온다. 저장소가 정해지지 않았으므로 시퀀스 공간
 * 선택(C-027)을 먼저 제시하고, 고르면 `/releases/:owner/:repo?branch=`로
 * 이동한다 — W-004의 진입 구조와 같다.
 */

import { Suspense, type ReactNode } from 'react';
import { ReleaseSpacePicker } from '../../components/ReleasesView';
import { GuardedPage } from '../../lib/server/page-guard';

export const dynamic = 'force-dynamic';

export default function ReleasesEntryPage(): ReactNode {
  return (
    <GuardedPage title="릴리스" returnTo="/releases">
      <h1>릴리스</h1>
      <Suspense fallback={<p>릴리스 화면을 준비하는 중…</p>}>
        <ReleaseSpacePicker />
      </Suspense>
    </GuardedPage>
  );
}
