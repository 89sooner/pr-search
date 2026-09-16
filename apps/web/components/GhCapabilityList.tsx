'use client';

/**
 * W-010의 capability 목록 (WP-077 / FR-GH-001 AC-6, QA-GH-01).
 *
 * **미지원·미구현 항목을 숨기지 않는다.** 실행이 열린 것은 고를 수 있고, 나머지는
 * 비활성으로 사유와 함께 보인다 — 「없다」와 「아직 열지 않았다」를 사용자가 구분할 수
 * 있어야 한다. 사유는 서버(manifest)가 준 것이며 화면이 지어내지 않는다.
 */

import { useState, type ReactNode } from 'react';
import { Badge, TextField } from './ui';
import type { CapabilitiesResponse, CommandView } from '../lib/gh';

export interface GhCapabilityListProps {
  readonly capabilities: CapabilitiesResponse;
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}

const EXECUTION_LABEL: Readonly<Record<string, string>> = {
  allowed: "Available",
  not_implemented: "Not yet enabled",
  policy_blocked: "Blocked by policy",
};

export function GhCapabilityList({ capabilities, selectedId, onSelect }: GhCapabilityListProps): ReactNode {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const commands: readonly CommandView[] = needle === ''
    ? capabilities.commands
    : capabilities.commands.filter((command) => command.id.includes(needle) || command.summary.toLowerCase().includes(needle));
  const executable = commands.filter((command) => command.execution === 'allowed');
  const rest = commands.filter((command) => command.execution !== 'allowed');

  return (
    <nav aria-label="Capabilities" data-testid="gh-capability-list">
      <p data-testid="gh-capability-coverage">
        gh {capabilities.gh_version} · command {String(capabilities.coverage.leafCommands)} total; available: {String(capabilities.coverage.executableCommands)}· Unclassified: {String(capabilities.coverage.unclassifiedLeafCommands)} items
      </p>
      <TextField
        aria-label="Search capabilities"
        placeholder="e.g. pr list"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        data-testid="gh-capability-search"
      />
      <ul className="prs-gh-capabilities" data-testid="gh-capability-executable">
        {executable.map((command) => (
          <li key={command.id}>
            <button
              type="button"
              aria-pressed={command.id === selectedId}
              data-testid={`gh-capability-${command.id}`}
              onClick={() => {
                onSelect(command.id);
              }}
            >
              gh {command.path.join(' ')}
            </button>{' '}
            <Badge tone="accent">{command.risk ?? 'R?'}</Badge> <span>{command.summary}</span>
          </li>
        ))}
        {executable.length === 0 ? <li>No executable commands match your search.</li> : null}
      </ul>
      <details data-testid="gh-capability-others">
        <summary>Disabled commands: {String(rest.length)} with reasons</summary>
        <ul>
          {rest.slice(0, 250).map((command) => (
            <li key={command.id} data-execution={command.execution}>
              <span aria-disabled="true">
                gh {command.path.join(' ')}
                {command.alias_of === null ? '' : `(alias: gh${command.alias_of.join(' ')})`}
              </span>{' '}
              <Badge tone="neutral">{EXECUTION_LABEL[command.execution] ?? command.execution}</Badge>
              {command.execution_reason === null ? null : <small> — {command.execution_reason}</small>}
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}
