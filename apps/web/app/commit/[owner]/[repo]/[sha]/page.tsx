/**
 * W-003 커밋 상세 라우트 (WP-018).
 *
 * 딥링크 `/commit/:owner/:repo/:sha`. W-001의 결과 행·해석 후보와 W-002의
 * 커밋 목록이 **이미 이 경로를 가리키고 있다** — 서버가 `url`을 그 모양으로
 * 만들어 왔다(`search/service.ts`, `resolve/service.ts`, `resolve/detail.ts`).
 */

import type { ReactNode } from 'react';
import { CommitDetailView } from '../../../../../components/CommitDetailView';
import { EmptyState } from '../../../../../components/EmptyState';
import { searchBackHref } from '../../../../../lib/pr-detail';
import { resolveWebConfig } from '../../../../../lib/server/config';
import { GuardedPage } from '../../../../../lib/server/page-guard';

export const dynamic = 'force-dynamic';

/**
 * 커밋 SHA는 hex다. **전체 40자만 받는다.**
 *
 * 축약 SHA는 후보가 여럿일 수 있어 상세 화면의 주소가 될 수 없다 — 해석은
 * `/resolve`가 하고 W-001이 후보를 보여 준다 (ADR-012, FR-SRCH-004). 여기로
 * 축약을 받아 주면 어느 커밋을 그릴지 화면이 임의로 고르게 된다.
 */
const FULL_SHA = /^[0-9a-f]{40}$/i;

interface PageProps {
  readonly params: Promise<{ readonly owner: string; readonly repo: string; readonly sha: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CommitDetailPage({ params, searchParams }: PageProps): Promise<ReactNode> {
  const { owner, repo, sha } = await params;
  const search = await searchParams;
  const config = resolveWebConfig();
  const ghe = process.env['GHE_BASE_URL'];

  const repository = `${decodeURIComponent(owner)}/${decodeURIComponent(repo)}`;
  const rawFrom = search['from_q'];
  const fromQuery = typeof rawFrom === 'string' ? rawFrom : undefined;

  /*
   * SHA 모양이 틀리면 **조회하지 않고** 같은 화면을 보인다.
   *
   * 문구도 접근 범위 밖과 같아야 한다 — 여기서 "잘못된 SHA"라고 다르게 말하면
   * 그 차이가 존재 여부를 가르는 신호가 된다 (FR-AUTH-002 AC-4).
   */
  const valid = FULL_SHA.test(sha);

  const body = valid ? (
    <CommitDetailView
      repository={repository}
      // 서버가 소문자로 색인한다. 대문자 SHA로 들어와도 같은 문서를 찾게 한다.
      commitSha={sha.toLowerCase()}
      loginPath={config.session.loginPath}
      {...(ghe === undefined || ghe === '' ? {} : { gheBaseUrl: ghe })}
      {...(fromQuery === undefined ? {} : { fromQuery })}
    />
  ) : (
    <div data-testid="commit-detail" data-screen-state="not_found">
      <EmptyState
        cause="not_found"
        description="이 커밋을 찾을 수 없습니다. SHA가 정확한지 확인하세요."
        actions={
          <a href={searchBackHref(fromQuery)} data-testid="back-link">
            검색으로 돌아가기
          </a>
        }
      />
    </div>
  );

  return (
    <GuardedPage title="커밋 상세" returnTo={`/commit/${repository}/${sha}`}>
      {body}
    </GuardedPage>
  );
}
