'use client';

/**
 * C-043 RepositoryRegistrationForm — A-002의 등록·편집 폼 (WP-040 / FR-ING-009
 * AC-1·AC-2·AC-3·AC-12, CR-055).
 *
 * ## "삭제"라는 낱말을 쓰지 않는다 (AC-3, QA-A002-03)
 *
 * 해제는 **신규 수집을 멈출 뿐 문서를 지우지 않는다.** 사용자가 데이터 손실로
 * 오해하면 해제를 회피하고, 그러면 수집이 멈춰야 할 저장소가 계속 돈다.
 * 확인 다이얼로그가 그 사실을 그대로 적는다 (`UNREGISTER_CONFIRM_MESSAGE`).
 *
 * ## 예상 소요를 지어내지 않는다 (DEV-435)
 *
 * 브랜치를 더하면 그 브랜치의 채번 잡이 생긴다 (AC-12). 채번 시간은 커밋 수와
 * 미러 상태에 달려 있어 폼이 알 수 없고, **근거 없는 예상치는 빗나가는 만큼
 * 운영자의 판단을 망친다.** 생성된 잡과 그 진행률을 보이는 것으로 바꾼다 —
 * 그것은 실측값이고 `A-003`이 이미 같은 값을 보인다.
 *
 * ## `prefill`이 요청 상태를 바꾸지 않는다 (AC-11)
 *
 * `C-071`이 넘긴 `owner/name`은 폼을 채울 뿐이다. 요청은 등록이 **성공해야**
 * 종료된다.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Button, Checkbox, Dialog, Field, Switch, TextArea, TextField } from './ui';
import {
  MAX_SEQUENCE_BRANCHES,
  UNREGISTER_CONFIRM_MESSAGE,
  addedBranches,
  normalizeBranchInput,
} from '../lib/ops-repositories';

export interface RegistrationSubmission {
  readonly owner: string;
  readonly name: string;
  readonly sequence_branches: readonly string[];
  readonly mirror_enabled: boolean;
  readonly backfill: boolean;
}

/** 편집 대상. 없으면 신규 등록이다. */
export interface RegistrationEditTarget {
  readonly repository_id: number;
  readonly owner: string;
  readonly name: string;
  readonly sequence_branches: readonly string[];
  readonly mirror_enabled: boolean;
}

export interface RepositoryRegistrationFormProps {
  /** `C-071`이 넘긴 식별자. 폼을 채울 뿐 요청 상태를 바꾸지 않는다. */
  readonly prefill?: { readonly owner: string; readonly name: string } | null;
  readonly edit?: RegistrationEditTarget | null;
  readonly onSubmit: (submission: RegistrationSubmission) => void;
  /** 확인이 끝난 뒤에만 불린다. */
  readonly onUnregister?: (target: RegistrationEditTarget) => void;
  readonly submitting?: boolean;
  /** 서버가 접근을 거절했을 때 필요한 권한. */
  readonly requiredPermissions?: readonly string[] | null;
  /** 이번 등록·편집이 만든 채번 잡. 예상 시간이 아니라 실측 대상이다. */
  readonly sequenceJobIds?: readonly number[];
}

export function RepositoryRegistrationForm({
  prefill = null,
  edit = null,
  onSubmit,
  onUnregister,
  submitting = false,
  requiredPermissions = null,
  sequenceJobIds = [],
}: RepositoryRegistrationFormProps): ReactNode {
  const [owner, setOwner] = useState(edit?.owner ?? '');
  const [name, setName] = useState(edit?.name ?? '');
  const [branchText, setBranchText] = useState((edit?.sequence_branches ?? []).join('\n'));
  const [mirror, setMirror] = useState(edit?.mirror_enabled ?? true);
  const [backfill, setBackfill] = useState(false);
  const [confirmingUnregister, setConfirmingUnregister] = useState(false);

  /*
   * `prefill`이 바뀌면 폼을 채운다. **편집 중이면 덮지 않는다** — 운영자가
   * 고치던 값을 요청 목록의 클릭 하나가 지우면 그 입력이 사라진다.
   */
  useEffect(() => {
    if (prefill === null || edit !== null) return;
    setOwner(prefill.owner);
    setName(prefill.name);
  }, [prefill, edit]);

  useEffect(() => {
    if (edit === null) return;
    setOwner(edit.owner);
    setName(edit.name);
    setBranchText(edit.sequence_branches.join('\n'));
    setMirror(edit.mirror_enabled);
  }, [edit]);

  const outcome = normalizeBranchInput(branchText);
  const overLimit = outcome.kind === 'limit_exceeded';
  const branches = outcome.kind === 'ok' ? outcome.branches : [];
  const ready = owner.trim() !== '' && name.trim() !== '' && !overLimit && !submitting;

  /** 이번 제출로 새로 대상이 되는 브랜치. 채번 잡이 생기는 것들이다 (AC-12). */
  const added = addedBranches(edit?.sequence_branches ?? [], branches);

  return (
    <div
      data-testid="registration-form-wrapper"
      data-state={overLimit ? 'error_branch_limit' : requiredPermissions !== null ? 'error_no_access' : 'ready'}
    >
      <form
        data-testid="registration-form"
        aria-label={edit === null ? "Register repository" : "Edit repository"}
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          onSubmit({
            owner: owner.trim(),
            name: name.trim(),
            sequence_branches: branches,
            mirror_enabled: mirror,
            backfill,
          });
        }}
      >
        <Field id="registration-owner" label="Owner">
          <TextField
            id="registration-owner"
            data-testid="registration-owner"
            value={owner}
            readOnly={edit !== null}
            onChange={(event) => {
              setOwner(event.target.value);
            }}
          />
        </Field>

        <Field id="registration-name" label="Repository name">
          <TextField
            id="registration-name"
            data-testid="registration-name"
            value={name}
            readOnly={edit !== null}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>

        <Field
          id="registration-branches"
          label="Sequence base branches"
          description={`Separate with newlines or commas. Maximum: ${String(MAX_SEQUENCE_BRANCHES)} items.`}
          {...(overLimit
            ? { error: `${String(outcome.given)} entered. Maximum: ${String(MAX_SEQUENCE_BRANCHES)} items.` }
            : {})}
        >
          <TextArea
            id="registration-branches"
            data-testid="registration-branches"
            value={branchText}
            invalid={overLimit}
            onChange={(event) => {
              setBranchText(event.target.value);
            }}
          />
        </Field>

        {added.length === 0 ? null : (
          <p data-testid="registration-added-branches">
            New sequence branches: {added.length}({added.join(', ')}). Numbering jobs will be created. Track progress in job operations.
          </p>
        )}

        <Field id="registration-mirror" label="Enable mirror">
          <Switch
            id="registration-mirror"
            data-testid="registration-mirror"
            checked={mirror}
            onCheckedChange={(next) => {
              setMirror(next === true);
            }}
          />
        </Field>

        {edit === null ? (
          <Field id="registration-backfill" label="Run backfill after registration">
            <Checkbox
              id="registration-backfill"
              data-testid="registration-backfill"
              checked={backfill}
              onCheckedChange={(next) => {
                setBackfill(next === true);
              }}
            />
          </Field>
        ) : null}

        {requiredPermissions === null ? null : (
          <p data-testid="registration-no-access" role="status">
            Cannot access this repository. Required permissions: {requiredPermissions.join(', ')}
          </p>
        )}

        {sequenceJobIds.length === 0 ? null : (
          <p data-testid="registration-sequence-jobs">
            Numbering job {sequenceJobIds.join(', ')} created. Track progress in job operations.
          </p>
        )}

        <Button type="submit" disabled={!ready} data-testid="registration-submit">
          {submitting ? "Submitting…" : edit === null ? "Register" : "Save changes"}
        </Button>
      </form>

      {edit === null || onUnregister === undefined ? null : (
        <>
          <Button
            variant="ghost"
            tone="danger"
            data-testid="registration-unregister-open"
            onClick={() => {
              setConfirmingUnregister(true);
            }}
          >
            Unregister
          </Button>

          <Dialog.Root open={confirmingUnregister} onOpenChange={setConfirmingUnregister}>
            <Dialog.Content size="sm" data-testid="unregister-dialog">
              <Dialog.Title>
                {edit.owner}/{edit.name} will be unregistered from ingestion
              </Dialog.Title>
              {/*
                **"삭제"라고 부르지 않는다.** 문구는 `ops-repositories.ts`가
                소유한다 — 화면마다 다르게 적으면 같은 조작이 다른 뜻으로 읽힌다.
              */}
              <Dialog.Description data-testid="unregister-message">{UNREGISTER_CONFIRM_MESSAGE}</Dialog.Description>
              <div>
                <Button
                  variant="primary"
                  tone="danger"
                  disabled={submitting}
                  data-testid="unregister-confirm"
                  onClick={() => {
                    if (submitting) return;
                    setConfirmingUnregister(false);
                    onUnregister(edit);
                  }}
                >
                  Unregister
                </Button>
                <Dialog.Close asChild>
                  <Button variant="secondary" data-testid="unregister-cancel">
                    Cancel
                  </Button>
                </Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Root>
        </>
      )}
    </div>
  );
}
