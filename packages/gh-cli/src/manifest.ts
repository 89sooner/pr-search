/**
 * capability manifest 조립과 해시 (FR-GH-001 AC-5, ADR-015, ENT-GH-006).
 *
 * 인벤토리(자동 추출) + 의미 오버라이드(사람이 적은 정의) → 검증된 manifest.
 * **순수 함수다** — 파일과 바이너리는 `node.ts`가 다룬다. 해시는 내용의 정규 JSON에
 * 대한 SHA-256이며, 실행 기록마다 이 값이 남아 「그때 어떤 manifest였는가」에 답한다.
 *
 * 해시 계산은 브라우저에서도 되도록 `SubtleCrypto`가 아니라 **순수 SHA-256 구현**을
 * 쓴다 — 서버(Node)와 시험(jsdom)이 같은 함수로 같은 값을 내야 한다.
 */

import { sha256Hex } from './sha256.js';
import type {
  GhCapabilityDefinition,
  GhCapabilityManifest,
  GhInventory,
  GhManifestCommand,
  GhManifestCoverage,
} from './types.js';
import { capabilityIdOf } from './capabilities.js';
import { classifyCommand } from './classification/classify.js';
import { computeDimensions } from './classification/dimensions.js';

/**
 * manifest 스키마·오버라이드 판. 정의를 고치면 올린다. gh 버전과 별개다.
 *
 * `r0.1` → `r0.2` (CR-088): command마다 분류(`classification`)가 실리고 coverage에 NFR-009 차원별
 * 집계가 들어갔다. 정책 차단 command의 실행 차원이 `policy_blocked`로 적힌다.
 */
export const MANIFEST_VERSION = 'r0.2' as const;

export interface ManifestBuildInput {
  readonly inventory: GhInventory;
  readonly capabilities: readonly GhCapabilityDefinition[];
  readonly generatedAt: string;
}

const NOT_IMPLEMENTED_REASON = 'REL-007 첫 수직 판(R0 PR 목록 조회)이 이 command의 실행을 아직 열지 않았다';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

/** 키 순서에 무관한 정규 JSON. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** `hash`·`generatedAt`·`coverage`를 뺀 내용의 해시. coverage는 내용에서 파생되므로 넣지 않는다. */
export function manifestHash(manifest: Omit<GhCapabilityManifest, 'hash' | 'generatedAt' | 'coverage'>): string {
  return sha256Hex(
    canonicalJson({
      manifestVersion: manifest.manifestVersion,
      ghVersion: manifest.ghVersion,
      commands: manifest.commands,
      capabilities: manifest.capabilities,
      helpTopics: manifest.helpTopics,
    }),
  );
}

/**
 * command 하나를 manifest 항목으로 만든다 — 인벤토리 + 분류 + 실행 차원.
 *
 * 실행 차원은 **정의(`capabilities.ts`)만** 연다. 분류 표가 `supported`라고 적어도 정의가 없으면
 * `not_implemented`다. 분류 표가 `policy_blocked`인 command는 실행 차원도 `policy_blocked`다 —
 * 그것은 「아직 열지 않았다」가 아니라 「열지 않기로 했다」이며, 둘을 바꿔 적지 않는다.
 */
export function summarizeCommand(
  command: GhInventory['commands'][number],
  capability: GhCapabilityDefinition | undefined,
): GhManifestCommand {
  const classification = classifyCommand(command);
  if (capability !== undefined) {
    return {
      ...command,
      id: capability.id,
      support: capability.support,
      execution: capability.execution,
      executionReason: capability.execution === 'allowed' ? null : NOT_IMPLEMENTED_REASON,
      risk: capability.risk,
      classification,
    };
  }
  const blocked = classification?.support === 'policy_blocked';
  return {
    ...command,
    id: capabilityIdOf(command.path),
    support: classification?.support ?? 'unknown',
    execution: blocked ? 'policy_blocked' : 'not_implemented',
    executionReason: blocked ? `이 제품이 열지 않기로 정한 command다 — ${classification.basis.evidence}` : NOT_IMPLEMENTED_REASON,
    risk: classification?.risk ?? null,
    classification,
  };
}

export function coverageOf(
  commands: readonly GhManifestCommand[],
  helpTopics: readonly string[],
  capabilities: readonly GhCapabilityDefinition[],
): GhManifestCoverage {
  const leaves = commands.filter((command) => !command.group && command.aliasOf === null);
  return {
    leafCommands: leaves.length,
    groupCommands: commands.filter((command) => command.group).length,
    aliasOnlyCommands: commands.filter((command) => command.aliasOf !== null).length,
    helpTopics: helpTopics.length,
    commandFlags: commands.reduce((sum, command) => sum + command.flags.filter((flag) => !flag.inherited).length, 0),
    inheritedFlagOccurrences: commands.reduce(
      (sum, command) => sum + command.flags.filter((flag) => flag.inherited).length,
      0,
    ),
    jsonFieldCommands: commands.filter((command) => command.jsonFields.length > 0).length,
    jsonFields: commands.reduce((sum, command) => sum + command.jsonFields.length, 0),
    classifiedLeafCommands: leaves.filter((command) => command.support !== 'unknown').length,
    unclassifiedLeafCommands: leaves.filter((command) => command.support === 'unknown').length,
    executableCommands: leaves.filter((command) => command.execution === 'allowed').length,
    dimensions: computeDimensions(commands, capabilities),
  };
}

/**
 * manifest를 만든다.
 *
 * @throws 오버라이드의 `path`가 인벤토리에 없으면. 인벤토리에 없는 command를 실행
 * 가능으로 적을 수는 없다 — 그것이 「고정 바이너리에서 실제 inventory를 추출한다」의
 * 뜻이다.
 */
export function buildManifest(input: ManifestBuildInput): GhCapabilityManifest {
  const byPath = new Map(input.inventory.commands.map((command) => [command.path.join(' '), command]));
  for (const capability of input.capabilities) {
    const command = byPath.get(capability.path.join(' '));
    if (command === undefined) {
      throw new Error(`오버라이드 ${capability.id}의 path(${capability.path.join(' ')})가 인벤토리에 없다`);
    }
    if (command.group) throw new Error(`오버라이드 ${capability.id}는 그룹 command를 가리킨다`);
    // 실행을 여는 옵션이 실제 flag여야 한다. help에 없는 flag를 조립하면 gh가 거절하고, 그 실패는 실행기에서야 드러난다.
    for (const option of capability.options) {
      const name = option.flag.replace(/^--/, '');
      if (!command.flags.some((flag) => flag.name === name)) {
        throw new Error(`오버라이드 ${capability.id}의 ${option.flag}가 인벤토리 flag에 없다`);
      }
      if (option.kind === 'json_fields') {
        for (const field of option.allowed) {
          if (!command.jsonFields.includes(field)) {
            throw new Error(`오버라이드 ${capability.id}의 JSON 필드 ${field}가 인벤토리에 없다`);
          }
        }
      }
    }
  }

  const byCapabilityPath = new Map(input.capabilities.map((capability) => [capability.path.join(' '), capability]));
  const commands = input.inventory.commands.map((command) =>
    summarizeCommand(command, byCapabilityPath.get(command.path.join(' '))),
  );

  // 정의와 분류 표가 같은 command를 다르게 말하면 manifest를 만들지 않는다 — 두 정본이 생긴다.
  for (const command of commands) {
    const capability = byCapabilityPath.get(command.path.join(' '));
    const classification = command.classification;
    if (capability === undefined || classification === null) continue;
    if (classification.support !== capability.support || classification.risk !== capability.risk || classification.interaction !== capability.interaction) {
      throw new Error(
        `정의 ${capability.id}(${capability.support}/${capability.risk}/${capability.interaction})와 분류 표(${classification.support}/${String(classification.risk)}/${classification.interaction})가 다르다`,
      );
    }
  }

  const partial = {
    manifestVersion: MANIFEST_VERSION,
    ghVersion: input.inventory.ghVersion,
    commands,
    capabilities: input.capabilities,
    helpTopics: input.inventory.helpTopics,
  };

  return {
    ...partial,
    generatedAt: input.generatedAt,
    hash: manifestHash(partial),
    coverage: coverageOf(commands, input.inventory.helpTopics, input.capabilities),
  };
}

/** 저장된 manifest의 해시가 내용과 맞는지. 파일이 손으로 고쳐졌으면 어긋난다. */
export function verifyManifestHash(manifest: GhCapabilityManifest): boolean {
  return manifestHash(manifest) === manifest.hash;
}
