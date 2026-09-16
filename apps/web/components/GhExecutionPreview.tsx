'use client';

/**
 * C-062 EffectiveExecutionContext + 실행 미리보기 (WP-077 / FR-GH-002 AC-3·AC-7, FR-GH-009 AC-7, QA-GH-21).
 *
 * 서버가 **실행과 같은 함수**로 만든 argv·환경 키·컨텍스트를 그대로 그린다. 화면이
 * argv를 조립하지 않는다 — 조립기는 하나뿐이다 (ADR-017). 비밀 값은 서버가 이미
 * `<redacted>`로 바꿔 보냈다 (QA-GH-04).
 */

import type { ReactNode } from 'react';
import { Badge } from './ui';
import { formatArgv, identityLabel, type PreviewView } from '../lib/gh';
import { blockerLabel } from '../lib/gh-policy';

export interface GhExecutionPreviewProps {
  readonly preview: PreviewView | null;
  readonly loading: boolean;
}

export function GhExecutionPreview({ preview, loading }: GhExecutionPreviewProps): ReactNode {
  if (preview === null) {
    return (
      <section aria-label="Execution preview" data-testid="gh-preview" data-ready="false">
        <p>{loading ? "Generating preview…" : "Complete the inputs to preview the command that will run."}</p>
      </section>
    );
  }
  const { context } = preview;
  return (
    <section aria-label="Execution preview" data-testid="gh-preview" data-ready="true" aria-busy={loading}>
      <p>
        <strong>Command to execute</strong> <Badge tone="neutral">{preview.risk} · Read only</Badge>
      </p>
      <pre data-testid="gh-preview-argv">{formatArgv(preview.argv)}</pre>

      <dl className="prs-gh-context" data-testid="gh-effective-context">
        <dt>GitHub host</dt>
        <dd>{context.host}</dd>
        <dt>Repository</dt>
        <dd>{context.repository}</dd>
        <dt>GitHub identity</dt>
        <dd data-testid="gh-context-actor">
          {context.github_actor === null ? "Not connected" : `@${context.github_actor}`} · {identityLabel(context.identity_status as never)}
        </dd>
        <dt>gh version</dt>
        <dd>{context.gh_version}</dd>
        <dt>manifest</dt>
        <dd>
          {context.manifest_version} · <code>{context.manifest_hash.slice(0, 12)}</code>
        </dd>
        <dt>Required permissions</dt>
        <dd>{context.required_permissions.join(', ')}</dd>
        <dt>Permission evaluation</dt>
        <dd>
          Delegated token — GitHub enforces the intersection of app and user permissions (<code>{context.permission_check}</code>)
        </dd>
        <dt>Policy</dt>
        <dd>R0 immediate execution · Time limit: {String(Math.round(context.timeout_ms / 1000))} seconds</dd>
        <dt>Runner environment</dt>
        <dd>
          <ul data-testid="gh-preview-env">
            {preview.env.map((entry) => (
              <li key={entry.key}>
                <code>{entry.key}</code>={entry.value === '' ? '""' : entry.value}
              </li>
            ))}
          </ul>
        </dd>
      </dl>
      {preview.blockers.length > 0 ? (
        <p role="status" data-testid="gh-preview-blockers">
          Cannot execute: {preview.blockers.map(blockerLabel).join(', ')}
        </p>
      ) : null}
    </section>
  );
}
