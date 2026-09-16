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
import { Banner, Button, Dialog, Field, Select, Spinner, TextField } from './ui';
import {
  createPayload,
  saveFailureMessage,
  shareTargetLabel,
  type SavedSearchVisibility,
  type ShareTargetTeam,
} from '../lib/saved-search';

/**
 * 편집 대상.
 *
 * **있으면 `PATCH`, 없으면 `POST`다.** 두 흐름이 같은 대화상자를 쓰는 이유는
 * 받는 것이 같기 때문이다 — 이름·공개 범위·대상 팀. 갈라 두면 한쪽에만
 * 고쳐지는 규칙이 생긴다.
 */
export interface SaveSearchEditTarget {
  readonly saved_search_id: number;
  readonly name: string;
  readonly query: string;
  readonly visibility: SavedSearchVisibility;
  readonly team_id: number | null;
  /**
   * 이 검색이 가리키는 공간의 **현재** 에폭 (CR-051). 없거나 `seq:`가 아니면 `null`.
   *
   * 질의를 고치면 그 인용은 새로 바인딩되므로 대상이 현재 세대다. 저장된
   * 값이 아니라 현재 값인 이유가 그것이다 — 저장된 값은 **바꾸지 않을 때**
   * 쓰이고, 그때는 대화상자가 에폭을 아예 보내지 않는다.
   */
  readonly current_seq_epoch?: number | null;
}

export interface SaveSearchDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * 저장할 정본 질의 문자열. 화면이 다시 만들지 않는다.
   *
   * 편집 모드에서는 `edit.query`가 초기값이 되고 이 값은 쓰이지 않는다.
   */
  readonly query: string;
  /**
   * 지금 보고 있는 조회의 시퀀스 에폭 (CR-051).
   *
   * `seq:` 질의가 아니면 `null`이다. 편집 모드에서는 **질의를 실제로
   * 바꿨거나 명시적으로 다시 연결할 때만** 보낸다 — 이름만 고치는 저장이
   * 낡은 에폭을 현재 값으로 옮기면 그것이 자동 재해석이다.
   */
  readonly seqEpoch?: number | null;
  /** 있으면 편집 모드다. 없으면 새로 저장한다. */
  readonly edit?: SaveSearchEditTarget;
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
  seqEpoch,
  edit,
  onSaved,
}: SaveSearchDialogProps): ReactNode {
  const editing = edit !== undefined;
  const [name, setName] = useState('');
  const [draftQuery, setDraftQuery] = useState('');
  const [visibility, setVisibility] = useState<SavedSearchVisibility>('private');
  const [teamId, setTeamId] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [teams, setTeams] = useState<TeamsPhase>({ kind: 'idle' });

  // 열 때마다 처음부터 시작한다 — 앞선 시도의 오류가 남아 있으면 혼란스럽다.
  useEffect(() => {
    if (!open) return;
    setName(edit?.name ?? '');
    setDraftQuery(edit?.query ?? query);
    setVisibility(edit?.visibility ?? 'private');
    setTeamId(edit?.team_id ?? null);
    setPhase({ kind: 'idle' });
    /*
     * **팀 목록을 다시 읽게 한다** (PR #60 리뷰 P2).
     *
     * 한 번 받아 두고 세션 내내 재사용하면, 그 사이에 소속이 바뀌어도 회수된
     * 팀이 계속 선택지에 남고 새로 들어간 팀은 나타나지 않는다. 서버가 거절해
     * 유출은 없지만 사용자는 고칠 길이 없다 — 대화상자를 다시 열어도 같은
     * 목록이기 때문이다. 여는 것이 곧 갱신 시점이다.
     */
    setTeams({ kind: 'idle' });
  }, [open, edit, query]);

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

  /*
   * **`team`인 상태로 열리면 대상 목록이 곧바로 필요하다.**
   *
   * 편집 모드에서 팀 공유 항목을 열면 선택기가 그려져야 하는데, 목록을
   * 「공개 범위를 고를 때」만 불러오면 그 선택기가 빈 채로 뜬다 — 사용자는
   * 자기 대상 팀이 사라진 것으로 읽는다. 여는 것이 곧 그 시점이다.
   */
  useEffect(() => {
    if (!open || visibility !== 'team') return;
    if (teams.kind !== 'idle') return;
    void loadTeams();
  }, [open, visibility, teams.kind, loadTeams]);

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
      /*
       * 편집에서는 **질의가 실제로 바뀌었을 때만** 에폭을 싣는다 (CR-051).
       *
       * 본문에 `query`가 들어 있다는 사실만으로 재연결 의도를 판정하지
       * 않는다 — 이 대화상자는 전체 폼을 보내므로 이름 한 글자 수정도
       * `query`를 담아 온다. 서버도 같은 규칙으로 판정하지만, 여기서
       * 보내지 않는 것이 첫 번째 방어다.
       */
      const queryChanged = editing ? draftQuery !== edit.query : true;
      /*
       * 새 저장은 **지금 보고 있는** 에폭, 편집은 **현재** 에폭이다.
       *
       * 편집에서 질의를 고치면 그 인용은 새로 바인딩되므로 대상이 현재
       * 세대다. 어느 쪽이든 서버가 다시 대조하며, 값이 없으면 `seq:` 질의를
       * 저장하려 할 때 서버가 거절한다.
       */
      const epochToSend = editing ? (edit.current_seq_epoch ?? null) : (seqEpoch ?? null);
      const payload = createPayload({
        name,
        query: draftQuery,
        visibility,
        teamId,
        ...(queryChanged ? { seqEpoch: epochToSend } : {}),
      });
      const response = await fetch(
        editing ? `/api/saved-searches/${String(edit.saved_search_id)}` : '/api/saved-searches',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      if (response.ok) {
        onSaved?.(name.trim());
        onOpenChange(false);
        return;
      }

      const body = (await response.json()) as { error?: { code?: string } };
      /*
       * 대상 팀이 거절됐으면 목록이 낡은 것이다 — 다시 읽어 사용자가 고칠 수
       * 있게 한다. 안내만 하고 같은 선택지를 두면 같은 실패를 반복한다.
       */
      if (body.error?.code === 'INVALID_PARAMETER') setTeams({ kind: 'idle' });
      setPhase({ kind: 'error', message: saveFailureMessage(body.error?.code) });
    } catch {
      setPhase({ kind: 'error', message: saveFailureMessage(undefined) });
    }
  }, [draftQuery, edit, editing, name, onOpenChange, onSaved, teamId, visibility]);

  const noTeams = teams.kind === 'ready' && teams.teams.length === 0;
  const teamMissing = visibility === 'team' && teamId === null;
  const canSave = name.trim() !== '' && !teamMissing && phase.kind !== 'saving';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="md" data-testid="save-search-dialog">
        <Dialog.Title>{editing ? "Edit saved search" : "Save search"}</Dialog.Title>
        <Dialog.Description>
          {editing
            ? "Edit the name, query, and visibility. Results are recalculated each time you run the search."
            : "Save your current query with a name. Results are recalculated each time you run the search."}
        </Dialog.Description>

        {phase.kind === 'error' ? (
          <Banner tone="danger" title="Unable to save">
            <p data-testid="save-search-error">{phase.message}</p>
          </Banner>
        ) : null}

        <Field label="Name" required>
          <TextField
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            data-testid="save-search-name"
            placeholder="e.g. Monthly payments review"
          />
        </Field>

        <Field label={editing ? "Query" : "Query to save"}>
          {/*
            * 저장할 때는 읽기 전용이다 — 여기서 고치면 화면이 보여 준 결과와
            * 어긋난다. **편집할 때는 고칠 수 있어야 한다**: 문법이 바뀌어 무효가
            * 된 질의를 되살릴 길이 이것뿐이고, AC-6이 그 경로를 요구한다.
            */}
          <TextField
            value={draftQuery}
            readOnly={!editing}
            onChange={(event) => {
              if (editing) setDraftQuery(event.target.value);
            }}
            data-testid="save-search-query"
          />
        </Field>

        <label id="save-search-visibility-label">Visibility</label>
        <Select.Root value={visibility} onValueChange={onVisibilityChange}>
          <Select.Trigger
            aria-labelledby="save-search-visibility-label"
            data-testid="save-search-visibility"
          >
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="private">Private — only me</Select.Item>
            <Select.Item value="team">Team — share with one team</Select.Item>
          </Select.Content>
        </Select.Root>

        {visibility === 'team' ? (
          <div data-testid="save-search-team-section">
            {teams.kind === 'loading' ? <Spinner label="Loading teams" /> : null}

            {teams.kind === 'error' ? (
              <Banner tone="warning" title="Unable to load teams">
                <Button
                  variant="secondary"
                  onClick={() => {
                    void loadTeams();
                  }}
                >
                  Try again
                </Button>
              </Banner>
            ) : null}

            {noTeams ? (
              <Banner tone="warning" title="No teams available">
                <p data-testid="save-search-no-teams">
                  You are not a member of any team. Save this search privately.
                </p>
              </Banner>
            ) : null}

            {teams.kind === 'ready' && teams.teams.length > 0 ? (
              <>
                <label id="save-search-team-label">Team to share with</label>
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
                    <Select.Value placeholder="Select team" />
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
            {phase.kind === 'saving' ? "Saving…" : "Save"}
          </Button>
          <Dialog.Close asChild>
            <Button variant="secondary">Cancel</Button>
          </Dialog.Close>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
