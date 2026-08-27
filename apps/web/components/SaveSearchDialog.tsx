'use client';

/**
 * W-001 저장 대화상자 (`search.save` / WP-033, CR-049).
 *
 * ## 질의를 다시 조립하지 않는다
 *
 * 저장하는 것은 **지금 URL에 있는 그 질의 문자열**이다. 대화상자가 토큰을 다시
 * 이어 붙이면 화면이 보여 준 것과 저장된 것이 달라질 수 있고, 그 차이는 나중에
 * 재실행할 때 드러난다 — "내가 저장한 게 이게 아닌데".
 *
 * ## 공유 대상은 열 때가 아니라 고를 때 부른다
 *
 * `private`으로 저장하는 사람에게 팀 목록 조회는 낭비다. `team`을 고르는 순간
 * 한 번만 부르고, 다시 고르면 이미 받은 것을 쓴다 — `RelationSection`이 지연
 * 섹션에서 세운 규율과 같다.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Banner, Button, Dialog, Field, Select, Spinner, TextField } from '@conductor-by-89soone/react';
import {
  createPayload,
  saveFailureMessage,
  shareTargetLabel,
  type SavedSearchVisibility,
  type ShareTargetTeam,
} from '../lib/saved-search';

export interface SaveSearchDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 저장할 정본 질의 문자열. 화면이 다시 만들지 않는다. */
  readonly query: string;
  /** 저장이 끝났을 때. 화면이 안내를 띄운다. */
  readonly onSaved?: (name: string) => void;
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'error'; readonly message: string };

type TeamsPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly teams: readonly ShareTargetTeam[] }
  | { readonly kind: 'error' };

export function SaveSearchDialog({
  open,
  onOpenChange,
  query,
  onSaved,
}: SaveSearchDialogProps): ReactNode {
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<SavedSearchVisibility>('private');
  const [teamId, setTeamId] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [teams, setTeams] = useState<TeamsPhase>({ kind: 'idle' });

  // 열 때마다 처음부터 시작한다 — 앞선 시도의 오류가 남아 있으면 혼란스럽다.
  useEffect(() => {
    if (!open) return;
    setName('');
    setVisibility('private');
    setTeamId(null);
    setPhase({ kind: 'idle' });
  }, [open]);

  const loadTeams = useCallback(async () => {
    setTeams({ kind: 'loading' });
    try {
      // 프록시가 `/api/v1`을 붙인다 — 여기에 적으면 `/api/v1/v1/...`이 된다.
      const response = await fetch('/api/saved-searches/share-targets', { cache: 'no-store' });
      if (!response.ok) {
        setTeams({ kind: 'error' });
        return;
      }
      const body = (await response.json()) as { teams?: readonly ShareTargetTeam[] };
      const list = body.teams ?? [];
      setTeams({ kind: 'ready', teams: list });
      /*
       * 팀이 하나뿐이면 미리 고른다. 둘 이상이면 **고르지 않는다** — 공유
       * 대상을 시스템이 추론하지 않는다는 것이 이 계약의 요점이다 (AC-1).
       */
      if (list.length === 1) setTeamId(list[0]?.team_id ?? null);
    } catch {
      setTeams({ kind: 'error' });
    }
  }, []);

  const onVisibilityChange = useCallback(
    (next: string) => {
      const value: SavedSearchVisibility = next === 'team' ? 'team' : 'private';
      setVisibility(value);
      if (value === 'private') {
        setTeamId(null);
        return;
      }
      if (teams.kind === 'idle' || teams.kind === 'error') void loadTeams();
    },
    [loadTeams, teams.kind],
  );

  const save = useCallback(async () => {
    setPhase({ kind: 'saving' });
    try {
      const response = await fetch('/api/saved-searches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(createPayload({ name, query, visibility, teamId })),
      });

      if (response.ok) {
        onSaved?.(name.trim());
        onOpenChange(false);
        return;
      }

      const body = (await response.json()) as { error?: { code?: string } };
      setPhase({ kind: 'error', message: saveFailureMessage(body.error?.code) });
    } catch {
      setPhase({ kind: 'error', message: saveFailureMessage(undefined) });
    }
  }, [name, onOpenChange, onSaved, query, teamId, visibility]);

  const noTeams = teams.kind === 'ready' && teams.teams.length === 0;
  const teamMissing = visibility === 'team' && teamId === null;
  const canSave = name.trim() !== '' && !teamMissing && phase.kind !== 'saving';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="md" data-testid="save-search-dialog">
        <Dialog.Title>검색 저장</Dialog.Title>
        <Dialog.Description>
          지금 조건을 이름과 함께 저장합니다. 저장하는 것은 질의 문자열이며 결과는 실행할 때마다 다시 계산됩니다.
        </Dialog.Description>

        {phase.kind === 'error' ? (
          <Banner tone="danger" title="저장하지 못했습니다">
            <p data-testid="save-search-error">{phase.message}</p>
          </Banner>
        ) : null}

        <Field label="이름" required>
          <TextField
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            data-testid="save-search-name"
            placeholder="예: 결제 월간 리뷰"
          />
        </Field>

        <Field label="저장할 질의">
          {/* 읽기 전용이다 — 여기서 고치면 화면이 보여 준 결과와 어긋난다. */}
          <TextField value={query} readOnly data-testid="save-search-query" />
        </Field>

        <label id="save-search-visibility-label">공개 범위</label>
        <Select.Root value={visibility} onValueChange={onVisibilityChange}>
          <Select.Trigger
            aria-labelledby="save-search-visibility-label"
            data-testid="save-search-visibility"
          >
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="private">비공개 — 나만 봅니다</Select.Item>
            <Select.Item value="team">팀 공유 — 한 팀에 공유합니다</Select.Item>
          </Select.Content>
        </Select.Root>

        {visibility === 'team' ? (
          <div data-testid="save-search-team-section">
            {teams.kind === 'loading' ? <Spinner label="팀 목록을 불러오는 중" /> : null}

            {teams.kind === 'error' ? (
              <Banner tone="warning" title="팀 목록을 불러오지 못했습니다">
                <Button
                  variant="secondary"
                  onClick={() => {
                    void loadTeams();
                  }}
                >
                  다시 시도
                </Button>
              </Banner>
            ) : null}

            {noTeams ? (
              <Banner tone="warning" title="공유할 팀이 없습니다">
                <p data-testid="save-search-no-teams">
                  현재 구성원인 팀이 없어 팀 공유를 선택할 수 없습니다. 비공개로 저장하세요.
                </p>
              </Banner>
            ) : null}

            {teams.kind === 'ready' && teams.teams.length > 0 ? (
              <>
                <label id="save-search-team-label">공유 대상 팀</label>
                <Select.Root
                  value={teamId === null ? '' : String(teamId)}
                  onValueChange={(next) => {
                    setTeamId(next === '' ? null : Number(next));
                  }}
                >
                  <Select.Trigger
                    aria-labelledby="save-search-team-label"
                    data-testid="save-search-team"
                  >
                    <Select.Value placeholder="팀 선택" />
                  </Select.Trigger>
                  <Select.Content>
                    {teams.teams.map((team) => (
                      // 값은 언제나 `team_id`다 — slug은 조직 안에서만 유일하다.
                      <Select.Item key={team.team_id} value={String(team.team_id)}>
                        {shareTargetLabel(team, teams.teams)}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </>
            ) : null}
          </div>
        ) : null}

        <div>
          <Button
            onClick={() => {
              void save();
            }}
            disabled={!canSave}
            data-testid="save-search-submit"
          >
            {phase.kind === 'saving' ? '저장하는 중…' : '저장'}
          </Button>
          <Dialog.Close asChild>
            <Button variant="secondary">취소</Button>
          </Dialog.Close>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
