'use client';

/**
 * W-010 헤더의 GitHub 신원과 연결 관리 (WP-077 / FR-GH-008, QA-GH-12).
 *
 * PR Search 로그인과 **다른 자격**이다. 연결이 없으면 실행이 시작되지 않고, 여기서
 * Operations App 인가를 시작한다. 인가 URL은 서버가 만든다 — 화면은 그리로 보낼 뿐이다.
 */

import type { ReactNode } from 'react';
import { Badge, Button } from './ui';
import { identityLabel, type IdentityView } from '../lib/gh';

export interface GhIdentityBannerProps {
  readonly identity: IdentityView | null;
  readonly connecting: boolean;
  readonly onConnect: () => void;
  readonly onDisconnect: () => void;
}

export function GhIdentityBanner({ identity, connecting, onConnect, onDisconnect }: GhIdentityBannerProps): ReactNode {
  if (identity === null) return <p data-testid="gh-identity-loading">Checking GitHub identity…</p>;
  const connected = identity.status === 'connected';
  return (
    <div className="prs-gh-identity" data-testid="gh-identity" data-status={identity.status}>
      <span>
        GitHub identity: {connected && identity.github_login !== null ? <strong>@{identity.github_login}</strong> : null}{' '}
        <Badge tone={connected ? 'accent' : 'warning'}>{identityLabel(identity.status)}</Badge>
        {identity.host === null ? null : <small> · {identity.host}</small>}
      </span>
      {connected ? (
        <Button variant="secondary" data-testid="gh-identity-disconnect" onClick={onDisconnect} disabled={connecting}>
          Disconnect
        </Button>
      ) : (
        <Button data-testid="gh-identity-connect" onClick={onConnect} disabled={connecting}>
          {connecting ? "Redirecting…" : "Connect GitHub account"}
        </Button>
      )}
      {connected ? null : (
        <p data-testid="gh-identity-hint">
          In addition to signing in to PR Search, authorize the Operations App to run commands on your behalf. Execution permissions are the intersection of app and user permissions.
        </p>
      )}
    </div>
  );
}
