/**
 * A-004 감사 로그 라우트 (WP-039 / FR-AUTH-004, CR-054).
 *
 * `/saved-searches`와 같은 구조다 — 셸과 세션은 서버가 세우고 조회는
 * 클라이언트가 한다. 감사 기록은 조사자마다 다르므로 캐시하지 않는다.
 *
 * **역할을 여기서 판정하지 않는다.** `GuardedPage`는 "로그인했는가"까지만
 * 보고(그 파일의 규율), 역할은 `API-ADM-005`가 강제한다 — 화면이 그것을
 * 흉내 내면 두 판정이 갈라진다. 자격이 없으면 조회가 403을 내고 화면이
 * `no_permission`을 그린다.
 */

import type { ReactNode } from 'react';
import { AuditView } from '../../../components/AuditView';
import { GuardedPage } from '../../../lib/server/page-guard';

export const dynamic = 'force-dynamic';

export default async function AuditPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') search.set(key, value);
  }

  return (
    <GuardedPage title="Audit log" returnTo="/ops/audit">
      <h1>Audit log</h1>
      <AuditView initialSearch={search.toString()} />
    </GuardedPage>
  );
}
