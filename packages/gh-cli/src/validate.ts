/**
 * capability manifest 검증기 (FR-GH-001 AC-4·AC-5, NFR-009, WP-045 `gh:validate-capabilities` / CR-088).
 *
 * **생성기의 결과를 다시 세어 성공하는 구조가 아니다.** 검증기는 manifest의 인벤토리 부분만 믿고
 * 나머지를 스스로 다시 만든다 — 분류를 규칙과 표로 다시 계산해 저장값과 대조하고, 커버리지를
 * 다시 세어 대조하고, 해시를 다시 계산한다. 어긋나면 손 편집이거나 생성기 드리프트다.
 *
 * ## 반드시 잡는 것
 *
 * command·flag·별칭의 누락·추가(드리프트는 `drift.ts`, 여기는 내부 일관성) · 인벤토리에 없는
 * 오버라이드 · 중복 ID와 충돌한 별칭 · 잘못된 열거값 · 필수 분류 비어 있음 · 결과 민감도 누락 ·
 * manifest 해시 변조 · gh 버전 불일치 · **분류 메타데이터 변경이 실행 허용을 넓힌 경우**.
 *
 * ## 세 가지 결말
 *
 * `failed`(구조 오류 — 신뢰할 수 없다) · `incomplete`(구조는 맞으나 게이트 차원에 미분류가 남음) ·
 * `passed`(게이트 차원 전부 100%). 진단 모드는 `incomplete`를 실패로 세지 않을 뿐, `failed`는
 * 언제나 실패다. 보고서에는 시각이 없다 — 같은 입력이면 같은 보고서·같은 해시다.
 */

import { classifyCommand } from './classification/classify.js';
import { computeDimensions } from './classification/dimensions.js';
import { RULES_VERSION } from './classification/rules.js';
import { EXECUTABLE_CAPABILITIES } from './capabilities.js';
import { MANIFEST_VERSION, canonicalJson, coverageOf, manifestHash } from './manifest.js';
import { GH_PINNED_VERSION } from './pin.js';
import { sha256Hex } from './sha256.js';
import type {
  GhCapabilityDefinition,
  GhCapabilityManifest,
  GhControlClass,
  GhCoverageDimension,
  GhInventory,
  GhInventoryCommand,
  GhInteractionMode,
  GhManifestCommand,
  GhSupportStatus,
} from './types.js';

export const VALIDATOR_VERSION = 'validator-2026-09-14.1' as const;
export const REPORT_VERSION = 'r1' as const;

export type GhFindingSeverity = 'error' | 'gap' | 'info';

export interface GhRegistryFinding {
  readonly code: string;
  readonly severity: GhFindingSeverity;
  readonly subject: string;
  readonly message: string;
}

export interface GhRegistryGate {
  readonly id: 'GATE-GH-01' | 'GATE-GH-01b' | 'GATE-GH-01d';
  readonly label: string;
  readonly pass: boolean;
  readonly dimensions: readonly string[];
  readonly detail: string;
}

export interface GhRegistryReport {
  readonly reportVersion: typeof REPORT_VERSION;
  readonly validatorVersion: string;
  readonly rulesVersion: string;
  readonly manifestVersion: string;
  readonly expectedManifestVersion: string;
  readonly ghVersion: string;
  readonly ghPinnedVersion: string;
  readonly manifestHash: string;
  readonly hashVerified: boolean;
  readonly inventoryHash: string;
  readonly dimensions: readonly GhCoverageDimension[];
  readonly gates: readonly GhRegistryGate[];
  readonly execution: {
    /** manifest의 command에서 `execution: allowed`인 id. */
    readonly allowed: readonly string[];
    /** 코드 표(`EXECUTABLE_CAPABILITIES`)가 여는 id. 둘은 같아야 한다. */
    readonly definitions: readonly string[];
  };
  readonly findings: readonly GhRegistryFinding[];
  readonly status: 'passed' | 'incomplete' | 'failed';
}

const SUPPORT_VALUES: ReadonlySet<GhSupportStatus> = new Set([
  'supported',
  'unsupported_by_host',
  'preview',
  'policy_blocked',
  'terminal_only',
  'admin_only',
  'requires_extension',
  'requires_local_workspace',
  'unknown',
]);
const INTERACTION_VALUES: ReadonlySet<GhInteractionMode> = new Set([
  'web_native',
  'web_equivalent',
  'sandbox_terminal',
  'terminal_only',
  'policy_blocked',
  'unsupported_by_host',
  'unknown',
]);
const CONTROL_VALUES: ReadonlySet<GhControlClass> = new Set([
  'mapped_to_typed_control',
  'mapped_to_generic_control',
  'mapped_to_web_equivalent',
  'terminal_only',
  'policy_blocked',
  'unsupported_by_host',
  'requires_admin_approval',
  'unknown',
]);
const RESULT_KINDS: ReadonlySet<string> = new Set(['json', 'resource', 'resource_list', 'url', 'artifact', 'text', 'stream', 'exit_status', 'unknown']);
const SENSITIVITIES: ReadonlySet<string> = new Set(['public', 'internal', 'sensitive', 'secret', 'unknown']);

/** manifest command에서 인벤토리 부분만 — 분류·실행 차원을 뺀 것. 검증기와 드리프트가 이것만 믿는다. */
export function inventoryCommandOf(command: GhManifestCommand): GhInventoryCommand {
  return {
    path: command.path,
    aliases: command.aliases,
    summary: command.summary,
    usage: command.usage,
    group: command.group,
    section: command.section,
    flags: command.flags,
    jsonFields: command.jsonFields,
    aliasOf: command.aliasOf,
    helpStatus: command.helpStatus,
  };
}

export function inventoryOfManifest(manifest: Pick<GhCapabilityManifest, 'ghVersion' | 'commands' | 'helpTopics'>): GhInventory {
  return { ghVersion: manifest.ghVersion, commands: manifest.commands.map(inventoryCommandOf), helpTopics: manifest.helpTopics };
}

/**
 * 인벤토리의 의미 해시 — 바이너리에서 뽑은 것과 manifest에 실린 것이 같은 인벤토리인지 한 값으로 답한다.
 * 생성 시각·파일 경로가 없으므로 같은 바이너리는 같은 값을 낸다. 배열 순서는 뜻이 있다(추출기가 정렬한다).
 */
export function inventoryHash(inventory: GhInventory): string {
  return sha256Hex(canonicalJson({ ghVersion: inventory.ghVersion, commands: inventory.commands, helpTopics: inventory.helpTopics }));
}

export interface ValidateOptions {
  /** 코드 표. 기본은 `EXECUTABLE_CAPABILITIES` — manifest에 실린 사본이 이것과 같아야 한다. */
  readonly capabilities?: readonly GhCapabilityDefinition[];
  /** 고정 gh 버전. 기본은 `GH_PINNED_VERSION`. */
  readonly pinnedVersion?: string;
}

export function validateManifest(manifest: GhCapabilityManifest, options: ValidateOptions = {}): GhRegistryReport {
  const definitions = options.capabilities ?? EXECUTABLE_CAPABILITIES;
  const pinned = options.pinnedVersion ?? GH_PINNED_VERSION;
  const findings: GhRegistryFinding[] = [];
  const error = (code: string, subject: string, message: string): void => {
    findings.push({ code, severity: 'error', subject, message });
  };
  const gap = (code: string, subject: string, message: string): void => {
    findings.push({ code, severity: 'gap', subject, message });
  };
  const info = (code: string, subject: string, message: string): void => {
    findings.push({ code, severity: 'info', subject, message });
  };

  // 1. 판·버전·해시.
  if (manifest.manifestVersion !== MANIFEST_VERSION) error('manifest_version_mismatch', manifest.manifestVersion, `manifest 판이 ${MANIFEST_VERSION}이 아니다`);
  if (manifest.ghVersion !== pinned) error('gh_version_mismatch', manifest.ghVersion, `manifest의 gh 버전이 고정 버전 ${pinned}과 다르다`);
  const recomputedHash = manifestHash(manifest);
  const hashVerified = recomputedHash === manifest.hash;
  if (!hashVerified) error('hash_mismatch', manifest.hash, '저장된 해시가 내용의 해시와 다르다 — 손으로 고쳐졌거나 손상됐다');

  // 2. command 식별자·별칭·참조.
  const byPath = new Map<string, GhManifestCommand>();
  const ids = new Map<string, number>();
  for (const command of manifest.commands) {
    const key = command.path.join(' ');
    if (byPath.has(key)) error('duplicate_command_path', key, 'command path가 두 번 있다');
    byPath.set(key, command);
    ids.set(command.id, (ids.get(command.id) ?? 0) + 1);
    if (command.id !== command.path.join('.')) error('command_id_mismatch', key, `id(${command.id})가 path에서 파생한 값과 다르다`);
  }
  for (const [id, count] of ids) if (count > 1) error('duplicate_command_id', id, `id가 ${String(count)}번 있다`);
  const aliasOwners = new Map<string, string>();
  for (const command of manifest.commands) {
    const key = command.path.join(' ');
    if (command.aliasOf !== null && !byPath.has(command.aliasOf.join(' '))) error('alias_target_missing', key, `별칭 전용 노드가 가리키는 ${command.aliasOf.join(' ')}가 없다`);
    for (const alias of command.aliases) {
      const owner = aliasOwners.get(alias);
      if (owner !== undefined && owner !== key) error('alias_conflict', alias, `별칭이 ${owner}와 ${key} 둘 다에 있다`);
      aliasOwners.set(alias, key);
      if (byPath.has(alias) && alias !== key) error('alias_shadows_command', alias, `별칭이 실제 command path ${alias}와 같다`);
    }
  }

  // 3. 실행 차원 — 분류가 실행을 넓히지 못한다.
  const allowedIds = manifest.commands.filter((command) => command.execution === 'allowed').map((command) => command.id).sort();
  const definitionIds = definitions.filter((capability) => capability.execution === 'allowed').map((capability) => capability.id).sort();
  for (const id of allowedIds) {
    if (!definitionIds.includes(id)) error('execution_widened', id, 'manifest가 allowed로 적었지만 코드 표(EXECUTABLE_CAPABILITIES)에 정의가 없다 — 분류 변경이 실행을 넓혔다');
  }
  for (const id of definitionIds) {
    if (!allowedIds.includes(id)) error('execution_missing', id, '코드 표는 여는데 manifest command가 allowed가 아니다');
  }
  const manifestDefinitions = new Map(manifest.capabilities.map((capability) => [capability.id, capability]));
  for (const capability of definitions) {
    const stored = manifestDefinitions.get(capability.id);
    if (stored === undefined) {
      error('definition_missing', capability.id, 'manifest의 capabilities에 코드 표의 정의가 없다');
      continue;
    }
    if (canonicalJson(stored) !== canonicalJson(capability)) error('definition_drift', capability.id, 'manifest에 실린 정의가 코드 표와 다르다 — manifest를 다시 만들어야 한다');
    const command = byPath.get(capability.path.join(' '));
    if (command === undefined) {
      error('definition_path_missing', capability.id, `정의의 path(${capability.path.join(' ')})가 인벤토리에 없다`);
      continue;
    }
    if (command.group) error('definition_targets_group', capability.id, '정의가 그룹 command를 가리킨다');
    for (const option of capability.options) {
      const name = option.flag.replace(/^--/, '');
      if (!command.flags.some((flag) => flag.name === name)) error('definition_option_missing', `${capability.id} ${option.flag}`, '정의의 옵션이 인벤토리 flag에 없다');
      if (option.kind === 'json_fields') {
        for (const field of option.allowed) if (!command.jsonFields.includes(field)) error('definition_json_field_missing', `${capability.id} ${field}`, '정의의 JSON 필드가 인벤토리에 없다');
      }
    }
    if (!RESULT_KINDS.has(capability.result.kind)) error('definition_result_invalid', capability.id, '정의의 결과 종류가 없다');
    if (!SENSITIVITIES.has(capability.result.sensitivity)) error('definition_sensitivity_invalid', capability.id, '정의의 결과 민감도가 없다');
  }
  for (const id of manifestDefinitions.keys()) {
    if (!definitions.some((capability) => capability.id === id)) error('definition_unknown', id, 'manifest에 코드 표에 없는 정의가 있다');
  }
  if (manifest.coverage.executableCommands !== allowedIds.length) error('executable_count_mismatch', String(manifest.coverage.executableCommands), `coverage.executableCommands가 allowed 수(${String(allowedIds.length)})와 다르다`);

  // 4. 분류 — 값 검사, 재계산 대조, 미분류.
  for (const command of manifest.commands) {
    const key = command.path.join(' ');
    const leaf = !command.group && command.aliasOf === null;
    const stored = command.classification;
    if (!leaf) {
      if (stored !== null) error('classification_on_non_leaf', key, '그룹·별칭 전용 노드에 분류가 있다');
      continue;
    }
    if (stored === null) {
      error('classification_missing', key, 'leaf에 분류가 없다');
      continue;
    }
    if (!SUPPORT_VALUES.has(stored.support)) error('support_invalid', key, `support 값이 열거 밖이다: ${String(stored.support)}`);
    if (!INTERACTION_VALUES.has(stored.interaction)) error('interaction_invalid', key, `interaction 값이 열거 밖이다: ${String(stored.interaction)}`);
    if (!RESULT_KINDS.has(stored.resultKind)) error('result_kind_invalid', key, `결과 종류가 열거 밖이다: ${String(stored.resultKind)}`);
    if (!SENSITIVITIES.has(stored.sensitivity)) error('sensitivity_invalid', key, `민감도가 열거 밖이다: ${String(stored.sensitivity)}`);
    if (stored.basis.evidence.trim() === '') error('basis_missing', key, '분류 근거가 비어 있다');
    if (stored.support !== command.support) error('support_desync', key, 'command.support와 classification.support가 다르다');
    if (stored.risk !== command.risk) error('risk_desync', key, 'command.risk와 classification.risk가 다르다');
    if (command.execution === 'allowed' && stored.risk === null) error('risk_missing_for_allowed', key, '실행을 여는 command에 위험도가 없다');
    /*
     * 실행 차원의 **파생**을 다시 계산한다 (독립 검토 나): 정의가 있으면 그 정의의 값, 없으면 분류가
     * 정책 차단일 때만 `policy_blocked`, 아니면 `not_implemented`. 저장값이 다르면 「열지 않기로 함」과
     * 「아직 열지 않음」이 뒤바뀐 것이다 — 실행은 넓어지지 않지만 사유가 거짓이 된다.
     */
    const definition = definitions.find((capability) => capability.id === command.id);
    const expectedExecution = definition !== undefined ? definition.execution : stored.support === 'policy_blocked' ? 'policy_blocked' : 'not_implemented';
    if (command.execution !== expectedExecution) error('execution_derivation_mismatch', key, `execution이 ${command.execution}인데 정의·분류에서 파생하면 ${expectedExecution}이다`);
    if ((command.executionReason === null) !== (command.execution === 'allowed')) error('execution_reason_mismatch', key, 'executionReason은 allowed일 때만 null이어야 한다');
    if (stored.flags.length !== command.flags.length) error('flag_classification_count', key, `flag 분류 수(${String(stored.flags.length)})가 flag 수(${String(command.flags.length)})와 다르다`);
    for (const flag of stored.flags) if (!CONTROL_VALUES.has(flag.control)) error('flag_control_invalid', `${key} --${flag.name}`, `control 값이 열거 밖이다: ${String(flag.control)}`);
    for (const positional of stored.positionals) if (!CONTROL_VALUES.has(positional.control)) error('positional_control_invalid', `${key} ${positional.placeholder}`, `control 값이 열거 밖이다: ${String(positional.control)}`);

    const recomputed = classifyCommand(inventoryCommandOf(command));
    if (recomputed === null || canonicalJson(recomputed) !== canonicalJson(stored)) {
      error('classification_recompute_mismatch', key, '인벤토리에서 규칙·표로 다시 만든 분류가 저장된 분류와 다르다 — 손 편집이거나 규칙이 바뀐 뒤 manifest를 다시 만들지 않았다');
    }

    if (stored.support === 'unknown') gap('support_unknown', key, '지원 상태가 unknown이다 (FR-GH-001 AC-2)');
    if (stored.interaction === 'unknown') gap('interaction_unknown', key, 'interaction 모드가 unknown이다 (AC-8)');
    if (stored.resultKind === 'unknown') gap('result_kind_unknown', key, '결과 종류가 unknown이다 (AC-11)');
    if (stored.sensitivity === 'unknown') gap('sensitivity_unknown', key, '결과 민감도가 unknown이다 (AC-11)');
    for (const flag of stored.flags) if (flag.control === 'unknown') gap('flag_unknown', `${key} --${flag.name}`, `flag에 맞는 규칙이 없다: ${flag.basis.evidence}`);
    for (const positional of stored.positionals) if (positional.control === 'unknown') gap('positional_unknown', `${key} ${positional.placeholder}`, 'positional에 맞는 규칙이 없다');
    if (command.helpStatus === 'auth_required') info('help_auth_required', key, '--help가 인증을 요구해 flag·positional을 뽑지 못했다 (DEV-653)');
  }

  // 5. 커버리지 재계산 대조.
  const recomputedCoverage = coverageOf(manifest.commands, manifest.helpTopics, manifest.capabilities);
  if (canonicalJson(recomputedCoverage) !== canonicalJson(manifest.coverage)) {
    error('coverage_mismatch', 'coverage', '저장된 coverage가 commands에서 다시 센 값과 다르다');
  }
  const dimensions = computeDimensions(manifest.commands, manifest.capabilities);

  // 6. 게이트.
  const gateOf = (id: GhRegistryGate['id'], label: string): GhRegistryGate => {
    const owned = dimensions.filter((dimension) => dimension.gate === id);
    const failing = owned.filter((dimension) => dimension.unclassified > 0 || (dimension.total === 0 && dimension.id === 'io_port'));
    return {
      id,
      label,
      pass: failing.length === 0 && owned.length > 0,
      dimensions: owned.map((dimension) => dimension.id),
      detail: failing.length === 0 ? '차원 전부 100%' : `미달 ${String(failing.length)}개: ${failing.map((dimension) => `${dimension.id} ${String(dimension.classified)}/${String(dimension.total)}`).join(', ')}`,
    };
  };
  const gates: GhRegistryGate[] = [
    gateOf('GATE-GH-01', 'capability 커버리지 (NFR-009 본표)'),
    gateOf('GATE-GH-01b', 'core / extension 분리 보고'),
    gateOf('GATE-GH-01d', '결과 계약 커버리지 (CR-009)'),
  ];

  const hasError = findings.some((finding) => finding.severity === 'error');
  const hasGap = findings.some((finding) => finding.severity === 'gap') || gates.some((gate) => !gate.pass);

  return {
    reportVersion: REPORT_VERSION,
    validatorVersion: VALIDATOR_VERSION,
    rulesVersion: RULES_VERSION,
    manifestVersion: manifest.manifestVersion,
    expectedManifestVersion: MANIFEST_VERSION,
    ghVersion: manifest.ghVersion,
    ghPinnedVersion: pinned,
    manifestHash: manifest.hash,
    hashVerified,
    inventoryHash: inventoryHash(inventoryOfManifest(manifest)),
    dimensions,
    gates,
    execution: { allowed: allowedIds, definitions: definitionIds },
    findings,
    status: hasError ? 'failed' : hasGap ? 'incomplete' : 'passed',
  };
}

/** 보고서의 내용 해시. 보고서에 시각이 없으므로 같은 입력은 같은 값이다. */
export function reportHash(report: GhRegistryReport): string {
  return sha256Hex(canonicalJson(report));
}
