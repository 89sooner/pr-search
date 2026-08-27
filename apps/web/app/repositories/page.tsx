/**
 * W-009 저장소 개요 라우트 (WP-034 / CR-050).
 *
 * `/saved-searches`와 같은 구조다 — 셸과 세션은 서버가 세우고 조회는
 * 클라이언트가 한다. 목록은 사용자의 접근 범위에 따라 달라지므로 캐시하지
 * 않는다.
 *
 * `?repository=owner/name`은 목록을 한 저장소로 좁히고 등록 요청 폼을 미리
 * 채운다. **그 저장소가 실재한다는 주장이 아니다** — 미등록과 접근 범위 밖은
 * 같은 빈 결과다 (FR-ING-009 AC-10).
 */

import type { ReactNode } from 'react';
import { RepositoriesView } from '../../components/RepositoriesView';
import { resolveWebConfig } from '../../lib/server/config';
import { GuardedPage } from '../../lib/server/page-guard';

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RepositoriesPage({ searchParams }: PageProps): Promise<ReactNode> {
  const config = resolveWebConfig();
  const params = await searchParams;
  const raw = params['repository'];
  const repository = typeof raw === 'string' && raw !== '' ? raw : null;

  return (
    <GuardedPage title="저장소" returnTo="/repositories">
      <h1>저장소</h1>
      <RepositoriesView loginPath={config.session.loginPath} repositoryFilter={repository} />
    </GuardedPage>
  );
}
