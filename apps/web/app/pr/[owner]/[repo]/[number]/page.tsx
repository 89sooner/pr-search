/**
 * W-002 PR 상세 라우트 (WP-017).
 *
 * 딥링크 `/pr/:owner/:repo/:number`. W-001의 결과 행과 해석 후보가 이미
 * 이 경로를 가리키고 `from_q`를 싣고 있다 (CR-019, DEV-078).
 */

import type { ReactNode } from 'react';
import { PrDetailView } from '../../../../../components/PrDetailView';
import { EmptyState } from '../../../../../components/EmptyState';
import { searchBackHref } from '../../../../../lib/pr-detail';
import { resolveWebConfig } from '../../../../../lib/server/config';
import { GuardedPage } from '../../../../../lib/server/page-guard';

export const dynamic = 'force-dynamic';

/** PR 번호는 양의 정수다. 그 밖은 조회하지 않는다. */
const PR_NUMBER = /^[1-9][0-9]{0,9}$/;

interface PageProps {
  readonly params: Promise<{ readonly owner: string; readonly repo: string; readonly number: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PrDetailPage({ params, searchParams }: PageProps): Promise<ReactNode> {
  const { owner, repo, number } = await params;
  const search = await searchParams;
  const config = resolveWebConfig();
  const ghe = process.env['GHE_BASE_URL'];

  const repository = `${decodeURIComponent(owner)}/${decodeURIComponent(repo)}`;
  const rawFrom = search['from_q'];
  const fromQuery = typeof rawFrom === 'string' ? rawFrom : undefined;

  /*
   * 번호가 모양부터 틀리면 **조회하지 않고** 같은 화면을 보인다.
   *
   * 서버를 부르면 어차피 404지만, 부르지 않는 편이 낫다 — 그리고 화면은
   * "찾을 수 없다"로 같아야 한다. 여기서 "잘못된 번호"라고 다르게 말하면
   * 존재 여부를 가르는 신호가 된다 (FR-AUTH-002 AC-4).
   */
  const valid = PR_NUMBER.test(number);

  const body = valid ? (
    <PrDetailView
      repository={repository}
      prNumber={Number(number)}
      loginPath={config.session.loginPath}
      {...(ghe === undefined || ghe === '' ? {} : { gheBaseUrl: ghe })}
      {...(fromQuery === undefined ? {} : { fromQuery })}
    />
  ) : (
    <div data-testid="pr-detail" data-screen-state="not_found">
      {/*
       * 문구도 되돌아가는 길도 `PrDetailView`의 `not_found`와 **같다.**
       * 여기만 막다른 골목이면 사용자는 브라우저 뒤로가기 말고 길이 없다.
       */}
      <EmptyState
        cause="not_found"
        description="This PR could not be found. Check the PR number."
        actions={
          <a href={searchBackHref(fromQuery)} data-testid="back-link">
            Back to search
          </a>
        }
      />
    </div>
  );

  // 세션 관문은 `GuardedPage` 하나가 소유한다 (WP-018).
  return (
    <GuardedPage title="PR details" returnTo={`/pr/${repository}/${number}`}>
      {body}
    </GuardedPage>
  );
}
