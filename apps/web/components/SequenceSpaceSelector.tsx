'use client';

/**
 * C-027 SequenceSpaceSelector (WP-025 / W-004-SPACE, FR-SEQ-001·005).
 *
 * 저장소·대상 브랜치로 시퀀스 공간을 고르고 **현재 에폭과 상태를 함께**
 * 보여 준다. 스펙의 필수 표면(repositories·branches·value·epoch·state)은
 * API-SEQ-006의 `spaces` 목록 하나에서 전부 파생된다 — 목록의 정본이 서버
 * 응답 하나이면 다섯 조각이 서로 어긋날 방법이 없다.
 *
 * 상태 배지의 뜻 (WP-022가 정의한 집합):
 * `ok` 채번 최신 / `stale` 뒤처짐 / `reassigning` 재채번 중 / `unknown` 채번 이력 없음.
 */

import type { ReactNode } from 'react';
import { Badge, Select } from './ui';
import type { SequenceSpaceOption } from '../lib/range';

export interface SequenceSpaceRef {
  readonly repository: string;
  readonly baseBranch: string;
}

export interface SequenceSpaceSelectorProps {
  readonly spaces: readonly SequenceSpaceOption[];
  readonly value: SequenceSpaceRef | null;
  readonly onChange: (next: SequenceSpaceRef) => void;
}

const STATE_LABEL: Readonly<Record<SequenceSpaceOption['sequence_state'], string>> = {
  ok: "Sequence up to date",
  stale: "Sequence behind",
  reassigning: "Renumbering",
  unknown: "No sequence history",
};

const STATE_TONE: Readonly<Record<SequenceSpaceOption['sequence_state'], 'success' | 'warning' | 'neutral'>> = {
  ok: 'success',
  stale: 'warning',
  reassigning: 'warning',
  unknown: 'neutral',
};

export function SequenceSpaceSelector({ spaces, value, onChange }: SequenceSpaceSelectorProps): ReactNode {
  const repositories = [...new Set(spaces.map((space) => space.repository))];
  const branches = value === null ? [] : spaces.filter((space) => space.repository === value.repository);
  const selected =
    value === null
      ? undefined
      : spaces.find((space) => space.repository === value.repository && space.base_branch === value.baseBranch);

  return (
    <div data-testid="space-selector">
      <label id="space-repo-label">Repository</label>
      <Select.Root
        value={value?.repository ?? ''}
        onValueChange={(repository) => {
          // 저장소를 바꾸면 그 저장소의 첫 시퀀스 브랜치가 기본이다 — 빈 브랜치 상태를 만들지 않는다.
          const first = spaces.find((space) => space.repository === repository);
          if (first !== undefined) onChange({ repository, baseBranch: first.base_branch });
        }}
      >
        <Select.Trigger aria-labelledby="space-repo-label" data-testid="space-repo-trigger">
          <Select.Value placeholder="Select repository" />
        </Select.Trigger>
        <Select.Content>
          {repositories.map((repository) => (
            <Select.Item key={repository} value={repository}>
              {repository}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>

      <label id="space-branch-label">Base branch</label>
      <Select.Root
        value={value?.baseBranch ?? ''}
        onValueChange={(baseBranch) => {
          if (value !== null && baseBranch !== '') onChange({ repository: value.repository, baseBranch });
        }}
        disabled={value === null}
      >
        <Select.Trigger aria-labelledby="space-branch-label" data-testid="space-branch-trigger">
          <Select.Value placeholder="Branch" />
        </Select.Trigger>
        <Select.Content>
          {branches.map((space) => (
            <Select.Item key={space.base_branch} value={space.base_branch}>
              {space.base_branch}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>

      {selected === undefined ? null : (
        <span data-testid="space-meta">
          {/* 에폭은 인용의 유효 범위다 (ADR-007) — 없는 값을 0으로 그리지 않는다. */}
          {selected.seq_epoch === null ? (
            <Badge tone="neutral" data-testid="space-epoch-none">
              No epoch
            </Badge>
          ) : (
            <Badge tone="neutral" data-testid="space-epoch">
              Epoch {selected.seq_epoch}
            </Badge>
          )}{' '}
          <Badge tone={STATE_TONE[selected.sequence_state]} data-testid="space-state">
            {STATE_LABEL[selected.sequence_state]}
          </Badge>
        </span>
      )}
    </div>
  );
}
