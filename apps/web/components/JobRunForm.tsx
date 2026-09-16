'use client';

/**
 * C-045 JobRunForm — A-003의 잡 실행 폼 (WP-040 / FR-ADMIN-002 AC-1·AC-6, CR-055).
 *
 * ## 제시하는 유형은 러너가 있는 것뿐이다 (AC-6, QA-A003-12)
 *
 * 목록은 `RUN_OPTIONS`가 정본이며 여기서 더하지 않는다. **잡 유형이 있다는
 * 것과 실행 가능한 잡이라는 것은 다르다** — `DEV-430`이 그 함정이었고,
 * 러너 없는 유형을 폼이 제시하면 운영자는 누른 뒤 영원히 `queued`를 본다.
 *
 * ## 한 엔드포인트에 몰지 않는다 (CR-045, DEV-301)
 *
 * 재색인은 `API-ADM-004`, 정합성 점검은 `API-ADM-007`이 소유한다. enqueue
 * seam이 하나여야 대상 버전을 고르는 자리도 하나다 — 두 진입점이 각자 고르면
 * 한쪽만 상한을 본다. 어느 경로로 가는지는 `RUN_OPTIONS`의 `path`가 정한다.
 *
 * ## 유형마다 재료가 다르다
 *
 * `reconcile`은 대상을 **보내지 않는다**(서버가 `all`을 쓴다). `sequence_assign`은
 * 저장소와 브랜치를 받아 **서버가 조립한다** — 문자열을 그대로 받으면 서로 다른
 * 공간이 같은 문자열로 충돌하거나 채번 대상이 아닌 브랜치가 큐에 들어간다.
 */

import { useState, type ReactNode } from 'react';
import { Button, Field, TextField } from './ui';
import { RUN_OPTIONS, runBody, runOption, type RunOption } from '../lib/ops-jobs';

export interface JobRunSubmission {
  readonly option: RunOption;
  readonly body: Record<string, unknown>;
}

export interface JobRunFormProps {
  readonly onSubmit: (submission: JobRunSubmission) => void;
  readonly submitting?: boolean;
  /** 직전 실행이 충돌했을 때 서버가 준 잡 식별자 (`error_job_conflict`). */
  readonly conflictJobId?: number | null;
  /** 별칭 후보. 인덱스 상태가 알려 준다. 비면 자유 입력이다. */
  readonly aliases?: readonly string[];
}

export function JobRunForm({
  onSubmit,
  submitting = false,
  conflictJobId = null,
  aliases = [],
}: JobRunFormProps): ReactNode {
  const [type, setType] = useState<string>(RUN_OPTIONS[0]?.type ?? '');
  const [repository, setRepository] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [alias, setAlias] = useState('');

  const option = runOption(type);

  /*
   * 재료가 채워졌는가. **서버 검증을 대신하지 않는다** — 여기서 막는 것은
   * 비어 있는 요청이 왕복하는 것뿐이고, 형식과 존재는 서버가 판정한다.
   */
  const ready = ((): boolean => {
    if (option === undefined) return false;
    switch (option.input) {
      case 'none':
        return true;
      case 'repository':
        return repository.trim() !== '';
      case 'sequence_space':
        return repository.trim() !== '' && baseBranch.trim() !== '';
      case 'alias':
        return alias.trim() !== '';
    }
  })();

  return (
    <form
      data-testid="job-run-form"
      aria-label="Run job"
      onSubmit={(event) => {
        event.preventDefault();
        if (option === undefined || !ready || submitting) return;
        onSubmit({
          option,
          body: runBody(option, {
            repository: repository.trim(),
            baseBranch: baseBranch.trim(),
            alias: alias.trim(),
          }),
        });
      }}
    >
      {/*
        **네이티브 `<select>`를 쓴다.** Conductor `Select`는 Radix 팝오버라
        옵션이 포털로 나가고, 이 폼이 필요로 하는 것은 목록에서 하나를 고르는
        일뿐이다. 포털은 e2e에서 "확인 전 요청 0건"을 재는 데 부담만 더한다 —
        `C-071`이 `C-013`을 쓰지 않기로 한 것과 같은 판단이며, 여기서 얻는
        접근성은 브라우저가 이미 준다.
      */}
      <Field id="job-run-type" label="Job type">
        <select
          id="job-run-type"
          data-testid="job-run-type"
          value={type}
          onChange={(event) => {
            setType(event.target.value);
          }}
        >
          {RUN_OPTIONS.map((item) => (
            <option key={item.type} value={item.type}>
              {item.label}
            </option>
          ))}
        </select>
      </Field>

      {option?.input === 'repository' || option?.input === 'sequence_space' ? (
        <Field id="job-run-repository" label="Repository" description="Use owner/name format.">
          <TextField
            id="job-run-repository"
            data-testid="job-run-repository"
            value={repository}
            onChange={(event) => {
              setRepository(event.target.value);
            }}
          />
        </Field>
      ) : null}

      {option?.input === 'sequence_space' ? (
        <Field
          id="job-run-branch"
          label="Base branch"
          description="Use a configured sequence base branch. The server rejects other branches."
        >
          <TextField
            id="job-run-branch"
            data-testid="job-run-branch"
            value={baseBranch}
            onChange={(event) => {
              setBaseBranch(event.target.value);
            }}
          />
        </Field>
      ) : null}

      {option?.input === 'alias' ? (
        <>
          <Field id="job-run-alias" label="Alias">
            <TextField
              id="job-run-alias"
              data-testid="job-run-alias"
              {...(aliases.length > 0 ? { list: 'job-run-alias-options' } : {})}
              value={alias}
              onChange={(event) => {
                setAlias(event.target.value);
              }}
            />
          </Field>
          {aliases.length > 0 ? (
            <datalist id="job-run-alias-options">
              {aliases.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          ) : null}
        </>
      ) : null}

      {/*
        `reconcile`은 재료가 없다. 빈 폼을 그대로 두면 운영자가 무엇을 빠뜨렸나
        찾게 되므로, 대상이 없다는 사실을 적는다.
      */}
      {option?.input === 'none' ? (
        <p data-testid="job-run-no-target">Reconciliation scans all registered repositories. No target selection is needed.</p>
      ) : null}

      {conflictJobId === null ? null : (
        <p data-testid="job-run-conflict" role="status">
          A job for this target is already running (job {conflictJobId}). Check that job first.
        </p>
      )}

      <Button type="submit" disabled={!ready || submitting} data-testid="job-run-submit">
        {submitting ? "Starting…" : "Run"}
      </Button>
    </form>
  );
}
