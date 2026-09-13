'use client';

/**
 * C-061 CapabilityConstraintForm의 첫 판 — `pr list`의 폼 (WP-077 / FR-GH-003 AC-1~AC-4, QA-GH-02).
 *
 * 컨트롤은 manifest의 옵션 정의에서 만든다: 열거 → `<select>`, 정수 → 숫자 입력(범위는
 * 정의의 min·max), JSON 필드 → 허용 목록의 체크박스. **규칙을 여기 쓰지 않는다** —
 * 위반은 서버와 같은 함수(`validateForm`)가 판정하고 이 폼은 그것을 보여 줄 뿐이다.
 * 위반이 있으면 실행 버튼이 열리지 않는다 (AC-4).
 */

import type { ReactNode } from 'react';
import { Field } from '@conductor-by-89soone/react';
import type { GhConstraintViolation } from '@prs/gh-cli';
import type { CapabilityView, PrListFormState, RepositoryContextView } from '../lib/gh';

export interface GhPrListFormProps {
  readonly capability: CapabilityView;
  readonly repositories: readonly RepositoryContextView[];
  readonly form: PrListFormState;
  readonly violations: readonly GhConstraintViolation[];
  readonly onChange: (next: PrListFormState) => void;
}

export function GhPrListForm({ capability, repositories, form, violations, onChange }: GhPrListFormProps): ReactNode {
  const enumOption = capability.options.find((option) => option.kind === 'enum');
  const intOption = capability.options.find((option) => option.kind === 'int');
  const jsonOption = capability.options.find((option) => option.kind === 'json_fields');
  const violationFor = (flag: string): GhConstraintViolation | undefined => violations.find((violation) => violation.flag === flag);
  const repositoryViolation = violations.find((violation) => violation.code === 'repository_format' || violation.code === 'context_required');

  return (
    <form
      data-testid="gh-pr-list-form"
      aria-label={`${capability.title} 입력`}
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <Field id="gh-repository" label="저장소" description="등록된 저장소 중 접근할 수 있는 것만 보입니다.">
        <select
          id="gh-repository"
          data-testid="gh-repository"
          value={form.repository}
          onChange={(event) => {
            onChange({ ...form, repository: event.target.value });
          }}
        >
          <option value="">저장소 선택</option>
          {repositories.map((repository) => (
            <option key={repository.repository_id} value={repository.repository}>
              {repository.repository} ({repository.visibility})
            </option>
          ))}
        </select>
      </Field>
      {repositoryViolation === undefined ? null : (
        <p role="alert" data-testid="gh-violation-repository">
          {repositoryViolation.message}
        </p>
      )}

      {enumOption?.kind === 'enum' ? (
        <Field id="gh-state" label={enumOption.label}>
          <select
            id="gh-state"
            data-testid="gh-state"
            value={form.state}
            onChange={(event) => {
              onChange({ ...form, state: event.target.value });
            }}
          >
            {enumOption.values.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {enumOption === undefined || violationFor(enumOption.flag) === undefined ? null : (
        <p role="alert" data-testid="gh-violation-state">
          {violationFor(enumOption.flag)?.message}
        </p>
      )}

      {intOption?.kind === 'int' ? (
        <Field id="gh-limit" label={intOption.label} description={`${String(intOption.min)}부터 ${String(intOption.max)}까지. 서버가 같은 상한을 강제합니다.`}>
          <input
            id="gh-limit"
            data-testid="gh-limit"
            type="number"
            inputMode="numeric"
            min={intOption.min}
            max={intOption.max}
            value={form.limit}
            onChange={(event) => {
              onChange({ ...form, limit: event.target.value });
            }}
          />
        </Field>
      ) : null}
      {intOption === undefined || violationFor(intOption.flag) === undefined ? null : (
        <p role="alert" data-testid="gh-violation-limit">
          {violationFor(intOption.flag)?.message}
        </p>
      )}

      {jsonOption?.kind === 'json_fields' ? (
        <fieldset data-testid="gh-json-fields">
          <legend>{jsonOption.label}</legend>
          {jsonOption.allowed.map((field) => {
            const checked = form.jsonFields.includes(field);
            const id = `gh-json-${field}`;
            return (
              <label key={field} htmlFor={id} className="prs-gh-json-field">
                <input
                  id={id}
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const next = event.target.checked ? [...form.jsonFields, field] : form.jsonFields.filter((item) => item !== field);
                    onChange({ ...form, jsonFields: next });
                  }}
                />
                {field}
              </label>
            );
          })}
        </fieldset>
      ) : null}
      {jsonOption === undefined || violationFor(jsonOption.flag) === undefined ? null : (
        <p role="alert" data-testid="gh-violation-json">
          {violationFor(jsonOption.flag)?.message}
        </p>
      )}
    </form>
  );
}
