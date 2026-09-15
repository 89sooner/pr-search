'use client';

/**
 * 로그아웃 완료 화면의 본문 (CR-092 / DEV-700, FR-AUTH-001 AC-5).
 *
 * **셸을 세우지 않는다.** 셸의 내비게이션은 전부 세션을 요구하는 화면이라, 누르는 순간 로그인으로 이어지고
 * IdP 세션이 살아 있으면 곧바로 다시 로그인된다. 이 화면의 일은 "끝났다"를 말하고 멈추는 것이다.
 *
 * **IdP 세션은 끝내지 않았다고 말한다.** PR Search가 지운 것은 자기 세션뿐이다 — 공용 PC에서 그 차이를 모르면
 * 다음 사람이 「다시 로그인」 한 번으로 앞사람의 계정에 들어간다.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { EmptyState } from '@conductor-by-89soone/react';

export interface SignedOutViewProps {
  /** 「다시 로그인」이 여는 곳. 인증을 켠 배포는 로그인 경로, 끈 배포는 진입 화면이다. */
  readonly loginHref: string;
}

export function SignedOutView({ loginHref }: SignedOutViewProps): ReactNode {
  return (
    <main id="main-content" className="prs-signed-out" data-testid="signed-out">
      <EmptyState
        // Conductor의 제목 자리는 `div`다. 이 화면의 유일한 제목이므로 문서 개요에 남게 `h1`을 넣는다.
        title={<h1 className="prs-signed-out__title">로그아웃했습니다</h1>}
        description="PR Search 세션을 종료했습니다. 사내 로그인(GitHub Enterprise·IdP) 세션은 남아 있을 수 있으니, 공용 컴퓨터라면 그쪽에서도 로그아웃하세요."
        action={<Link href={loginHref} className="prs-signed-out__login">다시 로그인</Link>}
      />
    </main>
  );
}
