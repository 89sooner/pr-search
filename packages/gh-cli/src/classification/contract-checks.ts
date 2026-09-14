/**
 * 결과 계약·port의 완전성 검사 (NFR-009 GATE-GH-01d, FR-GH-001 AC-11·AC-12, CR-089).
 *
 * 검증기(`validate.ts`)와 차원 집계(`dimensions.ts`)가 **같은 검사**를 읽는다 — 차원의 「분류됨」은 그 차원의 문제가
 * 하나도 없다는 뜻이다. 저장된 계약만 보지 않고 인벤토리에서 다시 정한 사실(출력 모드·JSON 필드·대상 자원 자리)과
 * 대조한다.
 *
 * `gap`은 **미분류**다 — 이유·근거를 아직 적지 않았다. `error`는 **구조 오류**다 — 계약끼리 어긋나거나, 흐르면 안 되는
 * 값이 흐르게 적혔다.
 */

import { parseJsonPointer } from '../json-pointer.js';
import { IDENTIFIABLE_KINDS, REPOSITORY_SCOPED_KINDS, RESOURCE_KINDS } from '../resource-ref.js';
import type { GhManifestCommand, GhPort, GhPortConditionCode, GhResourceKind } from '../types.js';
import { PR_LIST_RESULT_SCHEMA, jsonSchemaName, subjectSlotsOf, type SubjectSlot } from './ports.js';
import { BINDABLE_COMPOSABILITY, COMPOSABILITY_VALUES, RESULT_ADAPTERS, RESULT_KINDS, RESULT_SENSITIVITIES } from './results.js';

export type ContractDimension = 'result_contract' | 'bindability' | 'resource_type' | 'secret_output' | 'output_port' | 'input_port';

export interface ContractProblem {
  readonly dimension: ContractDimension;
  readonly severity: 'error' | 'gap';
  readonly code: string;
  readonly subject: string;
  readonly message: string;
}

const CONDITION_CODES: ReadonlySet<GhPortConditionCode> = new Set([
  'output_mode',
  'json_fields_selected',
  'flag_absent',
  'same_repository',
  'repository_from_output',
  'url_matches_context',
  'explicit_selection',
  'single_value_as_list',
  'slot_alternative',
  'workspace_required',
]);

/** 자원 종류마다 식별 값이 들어가는 참조의 자리 (`resource-ref.ts`의 규칙과 같다). */
const IDENTITY_SLOT_OF: Readonly<Partial<Record<GhResourceKind, 'number' | 'id' | 'ref' | 'repository'>>> = {
  pull_request: 'number',
  issue: 'number',
  discussion: 'number',
  workflow_run: 'id',
  workflow: 'id',
  codespace: 'id',
  release: 'ref',
  branch: 'ref',
  commit: 'ref',
  repository: 'repository',
};

const URL_GRAMMAR_TYPE: Readonly<Record<string, GhResourceKind>> = { pull_request: 'pull_request', issue: 'issue', discussion: 'discussion', repository: 'repository' };

const slotKey = (slot: GhPort['slot'] | SubjectSlot['slot']): string =>
  slot === null ? 'none' : slot.kind === 'positional' ? `positional:${String(slot.index)}:${slot.placeholder}:${slot.alternative}` : `flag:${slot.flag}`;

export function contractProblems(command: GhManifestCommand): readonly ContractProblem[] {
  const classification = command.classification;
  if (classification === null || classification === undefined || command.group || command.aliasOf !== null) return [];
  const key = command.path.join(' ');
  const problems: ContractProblem[] = [];
  const error = (dimension: ContractDimension, code: string, message: string, subject = key): void => {
    problems.push({ dimension, severity: 'error', code, subject, message });
  };
  const gap = (dimension: ContractDimension, code: string, message: string, subject = key): void => {
    problems.push({ dimension, severity: 'gap', code, subject, message });
  };
  const result = classification.result ?? null;
  const subjects = subjectSlotsOf(command);

  if (result === null) {
    for (const dimension of ['result_contract', 'bindability', 'resource_type', 'secret_output'] as const) gap(dimension, 'result_contract_missing', '결과 계약이 없다 — 분류 표에 행이 없는 미분류 leaf다');
    if (subjects.length > 0) gap('input_port', 'result_contract_missing', '결과 계약이 없어 입력 port를 판정할 수 없다');
    return problems;
  }

  /* ---- result_contract */
  if (!RESULT_KINDS.includes(result.kind)) error('result_contract', 'result_kind_invalid', `결과 종류가 열거 밖이다: ${String(result.kind)}`);
  if (classification.resultKind !== result.kind) error('result_contract', 'result_kind_desync', 'classification.resultKind와 결과 계약의 종류가 다르다');
  if (result.basis.evidence.trim() === '') gap('result_contract', 'result_basis_missing', '결과 계약의 근거가 비어 있다');
  const modes = result.outputs.map((output) => output.mode);
  const formats = classification.io.outputFormats;
  if (modes.length !== formats.length || new Set(modes).size !== modes.length || !modes.every((mode) => formats.includes(mode))) {
    error('result_contract', 'output_modes_mismatch', `출력 모드 계약(${modes.join(',')})이 분류의 출력 모드(${formats.join(',')})와 다르다`);
  }
  const structuredMode = formats.includes('json');
  if (structuredMode && !['json', 'resource', 'resource_list'].includes(result.kind)) error('result_contract', 'structured_kind_desync', '구조화 모드가 있는데 주 종류가 구조화 종류가 아니다');
  if (!structuredMode && (result.kind === 'json' || result.kind === 'resource_list') && !(result.kind === 'resource_list' && result.outputPorts.some((port) => port.source?.adapter === 'resource_url'))) {
    error('result_contract', 'structured_kind_without_mode', '구조화 모드가 없는데 주 종류가 json·resource_list다');
  }
  for (const output of result.outputs) {
    const subject = `${key} [${output.mode}]`;
    if (!RESULT_ADAPTERS.includes(output.adapter)) error('result_contract', 'output_adapter_invalid', `adapter가 열거 밖이다: ${String(output.adapter)}`, subject);
    if (!RESULT_KINDS.includes(output.kind)) error('result_contract', 'output_kind_invalid', `모드의 결과 종류가 열거 밖이다: ${String(output.kind)}`, subject);
    const reasonGiven = output.unstructuredReason !== null && output.unstructuredReason.trim() !== '';
    if (output.schema === null && !reasonGiven) gap('result_contract', 'output_structure_reason_missing', '스키마도 구조화 불가 사유도 없다', subject);
    if (output.schema !== null && output.unstructuredReason !== null) error('result_contract', 'output_schema_and_reason', '스키마가 있는데 구조화 불가 사유도 있다', subject);
    if (output.bindable && output.schema === null) error('result_contract', 'output_bindable_without_schema', '바인딩 가능한 모드에 스키마가 없다', subject);
    if (!output.bindable && (output.reason === null || output.reason.trim() === '')) gap('result_contract', 'output_reason_missing', '바인딩할 수 없는 이유가 없다', subject);
  }
  if (result.inputPorts.length === 0 && (result.inputPortsNote === null || result.inputPortsNote.trim() === '')) gap('result_contract', 'input_ports_note_missing', '입력 port가 없는 이유가 없다');
  if (result.inputPorts.length > 0 && result.inputPortsNote !== null) error('result_contract', 'input_ports_note_unexpected', '입력 port가 있는데 없는 이유가 적혀 있다');

  /* ---- bindability */
  if (!COMPOSABILITY_VALUES.includes(result.composability)) error('bindability', 'composability_invalid', `composability가 열거 밖이다: ${String(result.composability)}`);
  if (result.bindable !== BINDABLE_COMPOSABILITY.has(result.composability)) error('bindability', 'bindable_desync', 'bindable이 composability에서 파생한 값과 다르다');
  if (BINDABLE_COMPOSABILITY.has(result.composability) !== result.outputPorts.length > 0) error('bindability', 'bindable_port_desync', 'bindable이면 출력 port가 있어야 하고, 아니면 없어야 한다');
  if (result.outputs.some((output) => output.bindable) !== result.bindable) error('bindability', 'bindable_mode_desync', '바인딩 가능한 출력 모드의 유무가 bindable과 다르다');
  if (result.composability === 'unsupported_by_host' && classification.hostSupport !== 'verified') error('bindability', 'unsupported_without_host_evidence', '대상 GHES 확인 없이 unsupported_by_host로 적었다 (DEV-674)');
  if (classification.support === 'policy_blocked' && result.sensitivity !== 'secret' && result.composability !== 'policy_blocked') error('bindability', 'policy_blocked_desync', '정책 차단 command의 결과가 policy_blocked가 아니다');
  if (result.composability === 'artifact_result' && result.kind !== 'artifact') error('bindability', 'artifact_desync', 'artifact_result인데 주 종류가 artifact가 아니다');
  if (result.outputPorts.length === 0 && (result.outputPortsNote === null || result.outputPortsNote.trim() === '')) gap('bindability', 'output_ports_note_missing', '출력 port가 없는 이유가 없다');
  if (result.outputPorts.length > 0 && result.outputPortsNote !== null) error('bindability', 'output_ports_note_unexpected', '출력 port가 있는데 없는 이유가 적혀 있다');

  /* ---- resource_type */
  if (result.resourceKind !== null && !RESOURCE_KINDS.includes(result.resourceKind)) error('resource_type', 'resource_kind_invalid', `자원 종류가 열거 밖이다: ${String(result.resourceKind)}`);
  if (result.resourceBasis.trim() === '') gap('resource_type', 'resource_basis_missing', '자원 종류의 근거 또는 자원 결과가 아닌 이유가 없다');
  if ((result.kind === 'resource' || result.kind === 'resource_list') && result.resourceKind === null) error('resource_type', 'resource_result_without_kind', '자원 결과인데 자원 종류가 없다');
  if ((result.kind === 'resource' || result.kind === 'resource_list') && result.outputPorts.length === 0) error('resource_type', 'resource_result_without_port', '자원 결과는 제품이 정의한 문법(출력 port)으로 식별돼야 한다');
  for (const port of result.outputPorts) {
    if (port.type !== result.resourceKind) error('resource_type', 'resource_kind_port_desync', `출력 port 타입(${port.type})이 결과의 자원 종류(${String(result.resourceKind)})와 다르다`, `${key} → ${port.id}`);
  }

  /* ---- secret_output */
  if (!RESULT_SENSITIVITIES.includes(result.sensitivity)) error('secret_output', 'sensitivity_invalid', `민감도가 열거 밖이다: ${String(result.sensitivity)}`);
  if (classification.sensitivity !== result.sensitivity) error('secret_output', 'sensitivity_desync', 'classification.sensitivity와 결과 계약의 민감도가 다르다');
  if (result.sensitivity === 'secret') {
    if (result.composability !== 'secret_non_bindable' || result.outputPorts.length > 0 || result.outputs.some((output) => output.bindable || output.adapter !== 'secret_non_bindable')) {
      error('secret_output', 'secret_flows', '비밀 결과가 흐를 수 있게 적혔다 — secret_non_bindable·출력 port 0·모든 모드 secret_non_bindable이어야 한다');
    }
  }
  for (const port of result.outputPorts) {
    if (port.sensitivity !== result.sensitivity) error('secret_output', 'port_sensitivity_desync', '출력 port의 민감도가 결과와 다르다', `${key} → ${port.id}`);
  }

  /* ---- output_port */
  const outputIds = new Set<string>();
  for (const port of result.outputPorts) {
    const subject = `${key} → ${port.id}`;
    if (outputIds.has(port.id)) error('output_port', 'port_id_duplicate', '같은 ID의 출력 port가 둘 있다', subject);
    outputIds.add(port.id);
    if (port.direction !== 'output') error('output_port', 'port_direction_mismatch', '출력 port의 방향이 output이 아니다', subject);
    if (!RESOURCE_KINDS.includes(port.type)) error('output_port', 'port_type_invalid', `존재하지 않는 타입이다: ${String(port.type)}`, subject);
    else if (!IDENTIFIABLE_KINDS.has(port.type)) error('output_port', 'port_type_without_identity', '식별 규칙이 없는 종류는 출력 port가 될 수 없다', subject);
    if (port.cardinality !== 'one' && port.cardinality !== 'many') error('output_port', 'port_cardinality_invalid', 'cardinality가 one·many가 아니다', subject);
    if (port.nullable && port.required) error('output_port', 'port_nullable_required', 'null일 수 있는데 필수로 적혔다', subject);
    if (port.slot !== null) error('output_port', 'port_slot_on_output', '출력 port에 입력 자리가 있다', subject);
    if (port.basis.evidence.trim() === '') gap('output_port', 'port_basis_missing', '출력 port의 근거가 없다', subject);
    for (const condition of port.conditions) {
      if (!CONDITION_CODES.has(condition.code) || condition.detail.trim() === '') error('output_port', 'port_condition_invalid', `조건이 열거 밖이거나 비어 있다: ${String(condition.code)}`, subject);
    }
    const source = port.source;
    if (source === null) {
      error('output_port', 'port_source_absent', '출력 port에 결과에서 참조를 만드는 방법이 없다', subject);
      continue;
    }
    if (!formats.includes(source.mode)) error('output_port', 'port_source_mode_unavailable', `source 모드(${source.mode})가 이 command의 출력 모드에 없다`, subject);
    if (source.adapter === 'native_json') {
      const expectedSchema = key === 'pr list' ? PR_LIST_RESULT_SCHEMA : jsonSchemaName(key);
      if (source.schema !== expectedSchema) error('output_port', 'port_schema_mismatch', `스키마가 ${expectedSchema}가 아니다: ${source.schema}`, subject);
      if (!parseJsonPointer(source.pointer).ok) error('output_port', 'port_pointer_invalid', `포인터가 RFC 6901 부분집합이 아니다: ${source.pointer}`, subject);
      if (!command.jsonFields.includes(source.identity.field)) error('output_port', 'port_identity_field_unknown', `식별 필드 ${source.identity.field}가 JSON FIELDS에 없다`, subject);
      if (source.identity.repositoryPath !== null && !command.jsonFields.includes(source.identity.repositoryPath[0] ?? '')) error('output_port', 'port_repository_field_unknown', '저장소 필드가 JSON FIELDS에 없다', subject);
      if (IDENTITY_SLOT_OF[port.type] !== source.identity.slot) error('output_port', 'port_identity_slot_mismatch', `${port.type}의 식별 자리는 ${String(IDENTITY_SLOT_OF[port.type])}다`, subject);
      if (!port.conditions.some((condition) => condition.code === 'json_fields_selected')) error('output_port', 'port_condition_fields_absent', '식별 필드 선택 조건이 없다', subject);
    } else if (source.adapter === 'resource_url') {
      if (URL_GRAMMAR_TYPE[source.grammar] !== port.type) error('output_port', 'port_grammar_mismatch', `URL 문법 ${source.grammar}가 타입 ${port.type}와 다르다`, subject);
      if (!port.conditions.some((condition) => condition.code === 'url_matches_context')) error('output_port', 'port_condition_url_absent', 'URL 대조 조건이 없다', subject);
    } else {
      error('output_port', 'port_adapter_invalid', 'source adapter가 native_json·resource_url이 아니다', subject);
    }
  }

  /* ---- input_port */
  const expected = subjects.map((subject) => `${subject.id}|${subject.type}|${subject.cardinality}|${slotKey(subject.slot)}`).sort();
  const stored = result.inputPorts.map((port) => `${port.id}|${port.type}|${port.cardinality}|${slotKey(port.slot)}`).sort();
  if (expected.length !== stored.length || expected.some((one, index) => one !== stored[index])) {
    error('input_port', 'input_ports_recompute_mismatch', `입력 port가 대상 자원 자리 규칙과 다르다 (규칙 ${String(expected.length)} · 저장 ${String(stored.length)})`);
  }
  const inputIds = new Set<string>();
  for (const port of result.inputPorts) {
    const subject = `${key} ← ${port.id}`;
    if (inputIds.has(port.id)) error('input_port', 'port_id_duplicate', '같은 ID의 입력 port가 둘 있다', subject);
    inputIds.add(port.id);
    if (port.direction !== 'input') error('input_port', 'port_direction_mismatch', '입력 port의 방향이 input이 아니다', subject);
    if (!RESOURCE_KINDS.includes(port.type)) error('input_port', 'port_type_invalid', `존재하지 않는 타입이다: ${String(port.type)}`, subject);
    if (port.source !== null) error('input_port', 'port_source_on_input', '입력 port에 출력 source가 있다', subject);
    if (port.sensitivity === 'secret') error('input_port', 'port_secret_input', '대상 자원 자리는 비밀 값을 받지 않는다', subject);
    for (const condition of port.conditions) {
      if (!CONDITION_CODES.has(condition.code) || condition.detail.trim() === '') error('input_port', 'port_condition_invalid', `조건이 열거 밖이거나 비어 있다: ${String(condition.code)}`, subject);
    }
    if (REPOSITORY_SCOPED_KINDS.has(port.type) && !port.conditions.some((condition) => condition.code === 'same_repository')) error('input_port', 'port_condition_repository_absent', '저장소에 속한 자원의 입력인데 같은 저장소 조건이 없다', subject);
    const slot = port.slot;
    if (slot === null) {
      error('input_port', 'port_slot_absent', '입력 port에 자리가 없다', subject);
      continue;
    }
    if (slot.kind === 'positional') {
      if (classification.positionals[slot.index]?.placeholder !== slot.placeholder) error('input_port', 'port_slot_unknown', `positional ${String(slot.index)}(${slot.placeholder})가 분류에 없다`, subject);
    } else if (!command.flags.some((flag) => `--${flag.name}` === slot.flag)) {
      error('input_port', 'port_slot_unknown', `flag ${slot.flag}가 인벤토리에 없다`, subject);
    }
  }

  return problems;
}
