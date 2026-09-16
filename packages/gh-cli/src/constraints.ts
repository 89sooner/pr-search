/**
 * 의미 제약 평가기 (FR-GH-003, ADR-017, WP-061).
 *
 * **폼·서버·argv 빌더·시험 생성기가 이것 하나를 읽는다.** 클라이언트가 폼 검증을
 * 우회해 API를 직접 불러도 서버가 같은 함수로 같은 판정을 내린다 (AC-5·AC-8).
 * 순수 함수이며 브라우저에서도 돈다.
 *
 * 판정 순서: 저장소 형식 → 모르는 flag → positional·stdin·파일 거절 → 옵션 값
 * (열거·범위·형식·필드 허용 목록) → 옵션 사이 제약 → 컨텍스트 요구. 값이 틀린
 * 옵션은 관계 판정에 넣지 않는다 — 틀린 값을 「있다」로 세면 위반 메시지가 둘이
 * 되고 사용자는 무엇을 고칠지 알 수 없다.
 */

import type {
  GhCapabilityDefinition,
  GhConstraint,
  GhConstraintViolation,
  GhInvocation,
  GhNormalizedInvocation,
  GhOption,
} from './types.js';

/** GitHub의 owner·repo 이름 규칙. 슬래시·공백·선행 하이픈이 argv로 새지 않게 한다. */
const SLUG_PART = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;

export interface RepositorySlug {
  readonly owner: string;
  readonly name: string;
}

/**
 * `owner/name` 슬러그를 나눈다. 형식이 틀리면 `null`.
 *
 * 선행 하이픈을 막는 것이 요점이다 — `-R`이 아니라 `--repo` 뒤의 값이라 gh가 flag로
 * 읽을 자리는 아니지만, **값이 어디로 가든 하이픈으로 시작하는 문자열은 argv에
 * 두지 않는다**는 규칙을 한 곳에서 지킨다.
 */
export function parseRepositorySlug(raw: unknown): RepositorySlug | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split('/');
  if (parts.length !== 2) return null;
  const [owner, name] = parts;
  if (owner === undefined || name === undefined) return null;
  if (!SLUG_PART.test(owner) || !SLUG_PART.test(name)) return null;
  return { owner, name };
}

export type EvaluationResult =
  | { readonly ok: true; readonly invocation: GhNormalizedInvocation }
  | { readonly ok: false; readonly violations: readonly GhConstraintViolation[] };

type OptionValue = string | number | boolean | readonly string[];

function optionByFlag(definition: GhCapabilityDefinition, flag: string): GhOption | undefined {
  return definition.options.find((option) => option.flag === flag);
}

/**
 * 옵션 하나의 값을 검증하고 정규화한다. 없으면 기본값이다.
 *
 * @returns 위반이면 `violation`, 아니면 `value`(bool `false`는 argv에 실리지 않으므로 `null`).
 */
function evaluateOption(
  option: GhOption,
  raw: OptionValue | undefined,
): { readonly value: OptionValue | null } | { readonly violation: GhConstraintViolation } {
  switch (option.kind) {
    case 'enum': {
      if (raw === undefined) return { value: option.defaultValue };
      if (typeof raw !== 'string' || !option.values.includes(raw)) {
        return {
          violation: {
            code: 'enum_value',
            flag: option.flag,
            message: `${option.flag} must be one of: ${option.values.join(', ')}`,
          },
        };
      }
      return { value: raw };
    }
    case 'int': {
      if (raw === undefined) return { value: option.defaultValue };
      const numeric = typeof raw === 'string' && /^-?\d+$/.test(raw) ? Number(raw) : raw;
      if (typeof numeric !== 'number' || !Number.isSafeInteger(numeric)) {
        return { violation: { code: 'int_format', flag: option.flag, message: `${option.flag} must be an integer` } };
      }
      if (numeric < option.min || numeric > option.max) {
        return {
          violation: {
            code: 'int_range',
            flag: option.flag,
            message: `${option.flag} must be between ${String(option.min)} and ${String(option.max)}`,
          },
        };
      }
      return { value: numeric };
    }
    case 'bool': {
      if (raw === undefined) return { value: option.defaultValue ? true : null };
      if (typeof raw !== 'boolean') {
        return { violation: { code: 'bool_format', flag: option.flag, message: `${option.flag} must be true or false` } };
      }
      return { value: raw ? true : null };
    }
    case 'json_fields': {
      // `--json`은 `output.json_fields`가 나른다. flags에 오면 모르는 flag다.
      return { violation: { code: 'unknown_flag', flag: option.flag, message: `Pass ${option.flag} through output.json_fields` } };
    }
  }
}

function evaluateJsonFields(
  option: GhJsonFieldsOptionLike | undefined,
  raw: unknown,
): { readonly fields: readonly string[] } | { readonly violation: GhConstraintViolation } {
  if (option === undefined) return { fields: [] };
  if (raw === undefined || (Array.isArray(raw) && raw.length === 0)) {
    return { fields: option.defaultValue };
  }
  if (!Array.isArray(raw) || raw.some((field) => typeof field !== 'string')) {
    return { violation: { code: 'json_field_not_allowed', flag: option.flag, message: 'json_fields must be an array of strings' } };
  }
  const fields = raw as string[];
  const seen = new Set<string>();
  for (const field of fields) {
    if (!option.allowed.includes(field)) {
      return {
        violation: { code: 'json_field_not_allowed', flag: option.flag, message: `JSON field is not allowed: ${field}` },
      };
    }
    if (seen.has(field)) {
      return { violation: { code: 'json_fields_duplicate', flag: option.flag, message: `Duplicate JSON field: ${field}` } };
    }
    seen.add(field);
  }
  if (fields.length < option.minItems) {
    return { violation: { code: 'json_fields_min', flag: option.flag, message: `Select at least ${String(option.minItems)} JSON fields` } };
  }
  if (fields.length > option.maxItems) {
    return { violation: { code: 'json_fields_max', flag: option.flag, message: `Select at most ${String(option.maxItems)} JSON fields` } };
  }
  // 허용 목록 순서로 정렬한다 — 같은 집합이면 같은 argv여야 한다 (FR-GH-002 AC-9).
  return { fields: option.allowed.filter((field) => seen.has(field)) };
}

type GhJsonFieldsOptionLike = Extract<GhOption, { kind: 'json_fields' }>;

/** 옵션 사이 제약을 「존재하는 flag 집합」에 대해 판정한다. */
export function evaluateRelations(
  constraints: readonly GhConstraint[],
  present: ReadonlyMap<string, OptionValue>,
  context: { readonly repository: boolean; readonly host: boolean },
): GhConstraintViolation[] {
  const violations: GhConstraintViolation[] = [];
  const has = (flag: string): boolean => present.has(flag);

  for (const constraint of constraints) {
    switch (constraint.kind) {
      case 'requires': {
        if (!has(constraint.flag)) break;
        for (const required of constraint.requires) {
          if (!has(required)) {
            violations.push({ code: 'requires', flag: constraint.flag, message: `${constraint.flag} requires ${required}` });
          }
        }
        break;
      }
      case 'conflicts':
      case 'one_of': {
        const found = constraint.flags.filter(has);
        if (found.length > 1) {
          violations.push({
            code: constraint.kind,
            flag: found[0] ?? null,
            message: `These flags cannot be used together: ${found.join(', ')}`,
          });
        }
        break;
      }
      case 'exactly_one': {
        const found = constraint.flags.filter(has);
        if (found.length !== 1) {
          violations.push({
            code: 'exactly_one',
            flag: found[0] ?? null,
            message: `Exactly one of these flags is required: ${constraint.flags.join(', ')}`,
          });
        }
        break;
      }
      case 'at_least_one': {
        if (!constraint.flags.some(has)) {
          violations.push({
            code: 'at_least_one',
            flag: null,
            message: `At least one of these flags is required: ${constraint.flags.join(', ')}`,
          });
        }
        break;
      }
      case 'implies': {
        if (!has(constraint.flag)) break;
        if (constraint.whenValue !== undefined && present.get(constraint.flag) !== constraint.whenValue) break;
        if (!has(constraint.implies)) {
          violations.push({ code: 'implies', flag: constraint.flag, message: `${constraint.flag} also requires ${constraint.implies}` });
        }
        break;
      }
      case 'required_if': {
        if (present.get(constraint.when.flag) === constraint.when.value && !has(constraint.flag)) {
          violations.push({
            code: 'required_if',
            flag: constraint.flag,
            message: `${constraint.flag} is required when ${constraint.when.flag}=${constraint.when.value}`,
          });
        }
        break;
      }
      case 'input_source_exclusive': {
        const found = constraint.sources.filter(has);
        if (found.length > 1) {
          violations.push({
            code: 'input_source_exclusive',
            flag: found[0] ?? null,
            message: `Use only one input source: ${found.join(', ')}`,
          });
        }
        break;
      }
      case 'context_required': {
        const satisfied = constraint.context === 'repository' ? context.repository : context.host;
        if (!satisfied) {
          violations.push({ code: 'context_required', flag: null, message: `${constraint.context} context is required` });
        }
        break;
      }
    }
  }
  return violations;
}

/**
 * invocation 전체를 판정한다 (FR-GH-003 AC-5·AC-8).
 *
 * 같은 입력은 같은 답을 낸다 — 시간·난수·환경을 읽지 않는다.
 */
export function evaluateInvocation(definition: GhCapabilityDefinition, invocation: GhInvocation): EvaluationResult {
  const violations: GhConstraintViolation[] = [];

  const repository = parseRepositorySlug(invocation.context?.repository);
  if (repository === null) {
    violations.push({ code: 'repository_format', flag: null, message: 'Repository must use the owner/name format' });
  }

  const rawFlags = invocation.flags ?? {};
  const extra = (invocation as unknown as Record<string, unknown>);
  for (const forbidden of ['positional', 'stdin', 'files', 'argv', 'command']) {
    if (forbidden in extra && extra[forbidden] !== undefined) {
      violations.push({ code: 'positional_not_allowed', flag: null, message: `This capability does not accept ${forbidden}` });
    }
  }

  for (const flag of Object.keys(rawFlags)) {
    const option = optionByFlag(definition, flag);
    if (option === undefined || option.kind === 'json_fields') {
      violations.push({ code: 'unknown_flag', flag, message: `Unknown flag: ${flag}` });
    }
  }

  const present = new Map<string, OptionValue>();
  const ordered: { flag: string; value: OptionValue }[] = [];
  for (const option of definition.options) {
    if (option.kind === 'json_fields') continue;
    const outcome = evaluateOption(option, rawFlags[option.flag]);
    if ('violation' in outcome) {
      violations.push(outcome.violation);
      continue;
    }
    if (outcome.value === null) continue;
    present.set(option.flag, outcome.value);
    ordered.push({ flag: option.flag, value: outcome.value });
  }

  const jsonOption = definition.options.find((option): option is GhJsonFieldsOptionLike => option.kind === 'json_fields');
  const jsonOutcome = evaluateJsonFields(jsonOption, invocation.output?.json_fields);
  let jsonFields: readonly string[] = [];
  if ('violation' in jsonOutcome) violations.push(jsonOutcome.violation);
  else jsonFields = jsonOutcome.fields;
  if (jsonOption !== undefined && jsonFields.length > 0) present.set(jsonOption.flag, jsonFields);

  violations.push(...evaluateRelations(definition.constraints, present, { repository: repository !== null, host: true }));

  if (violations.length > 0 || repository === null) return { ok: false, violations };

  return {
    ok: true,
    invocation: { capabilityId: definition.id, repository, options: ordered, jsonFields },
  };
}
