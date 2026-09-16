/**
 * 로그아웃 완료 (CR-092 / DEV-700, FR-AUTH-001 AC-5).
 *
 * `app/auth/*`는 화면 관문을 지나지 않는다(`lib/architecture.test.ts`) — 세션이 방금 끝났으므로 관문을 두면
 * 이 화면에 오는 모든 사람이 로그인으로 보내진다. 이 화면은 세션을 읽지도 쓰지도 않는다.
 */

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SignedOutView } from '../../../components/SignedOutView';
import { resolveWebConfig } from '../../../lib/server/config';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Signed out · PR Search' };

export default function SignedOutPage(): ReactNode {
  const config = resolveWebConfig();
  // 인증을 끈 배포에는 로그인 경로가 없다(503). 그때는 진입 화면으로 돌려보낸다.
  const loginHref = config.authEnabled ? `${config.session.loginPath}?return_to=${encodeURIComponent('/')}` : '/';
  return <SignedOutView loginHref={loginHref} />;
}
