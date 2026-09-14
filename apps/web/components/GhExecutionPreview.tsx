'use client';

/**
 * C-062 EffectiveExecutionContext + 실행 미리보기 (WP-077 / FR-GH-002 AC-3·AC-7, FR-GH-009 AC-7, QA-GH-21).
 *
 * 서버가 **실행과 같은 함수**로 만든 argv·환경 키·컨텍스트를 그대로 그린다. 화면이
 * argv를 조립하지 않는다 — 조립기는 하나뿐이다 (ADR-017). 비밀 값은 서버가 이미
 * `<redacted>`로 바꿔 보냈다 (QA-GH-04).
 */

import type { ReactNode } from 'react';
import { Badge } from '@conductor-by-89soone/react';
import { formatArgv, identityLabel, type PreviewView } from '../lib/gh';
import { blockerLabel } from '../lib/gh-policy';

export interface GhExecutionPreviewProps {
  readonly preview: PreviewView | null;
  readonly loading: boolean;
}

export function GhExecutionPreview({ preview, loading }: GhExecutionPreviewProps): ReactNode {
  if (preview === null) {
    return (
      <section aria-label="실행 미리보기" data-testid="gh-preview" data-ready="false">
        <p>{loading ? '미리보기를 만드는 중…' : '입력을 채우면 실제 실행될 명령이 여기 표시됩니다.'}</p>
      </section>
    );
  }
  const { context } = preview;
  return (
    <section aria-label="실행 미리보기" data-testid="gh-preview" data-ready="true" aria-busy={loading}>
      <p>
        <strong>실행될 명령</strong> <Badge tone="neutral">{preview.risk} · 읽기 전용</Badge>
      </p>
      <pre data-testid="gh-preview-argv">{formatArgv(preview.argv)}</pre>

      <dl className="prs-gh-context" data-testid="gh-effective-context">
        <dt>GitHub 호스트</dt>
        <dd>{context.host}</dd>
        <dt>저장소</dt>
        <dd>{context.repository}</dd>
        <dt>GitHub 신원</dt>
        <dd data-testid="gh-context-actor">
          {context.github_actor === null ? '연결되지 않음' : `@${context.github_actor}`} · {identityLabel(context.identity_status as never)}
        </dd>
        <dt>gh 버전</dt>
        <dd>{context.gh_version}</dd>
        <dt>manifest</dt>
        <dd>
          {context.manifest_version} · <code>{context.manifest_hash.slice(0, 12)}</code>
        </dd>
        <dt>필요 권한</dt>
        <dd>{context.required_permissions.join(', ')}</dd>
        <dt>권한 판정</dt>
        <dd>
          위임 토큰 — GitHub이 App 권한과 사용자 권한의 교집합을 강제합니다 (<code>{context.permission_check}</code>)
        </dd>
        <dt>정책</dt>
        <dd>R0 즉시 실행 · 시간 상한 {String(Math.round(context.timeout_ms / 1000))}초</dd>
        <dt>실행기 환경</dt>
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
          실행할 수 없습니다: {preview.blockers.map(blockerLabel).join(', ')}
        </p>
      ) : null}
    </section>
  );
}
