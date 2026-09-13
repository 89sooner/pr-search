/**
 * NFR-009 차원별 커버리지 (CR-008·CR-009의 게이트 표, WP-045 / CR-088).
 *
 * **분모를 적는다.** 같은 숫자라도 무엇을 셌는지가 다르면 다른 사실이다 — SRS의 「command node
 * 228」은 그룹 32 + leaf 196이고 여기 `commands` 배열은 별칭 전용 노드(`co`) 하나를 더해 229다.
 * 차원마다 `note`가 분모와 「분류됨」의 뜻을 말한다.
 *
 * 게이트는 넷이다: `GATE-GH-01`(NFR-009 본표의 열 차원), `GATE-GH-01b`(core/extension 분리 보고),
 * `GATE-GH-01d`(CR-009 결과 계약 차원), 그리고 게이트가 아닌 `informational`. 검증기가 이 함수를
 * 다시 불러 저장된 값과 대조하므로, 여기서 세는 방식이 곧 계약이다.
 */

import type { GhCapabilityDefinition, GhCoverageDimension, GhManifestCommand } from '../types.js';
import { classifyFlag } from './rules.js';

const SAMPLE = 50;

interface Item {
  readonly id: string;
  readonly classified: boolean;
}

function dimension(
  id: string,
  label: string,
  gate: GhCoverageDimension['gate'],
  items: readonly Item[],
  note: string,
): GhCoverageDimension {
  const unclassified = items.filter((item) => !item.classified);
  return {
    id,
    label,
    gate,
    total: items.length,
    classified: items.length - unclassified.length,
    unclassified: unclassified.length,
    unclassifiedSample: unclassified.slice(0, SAMPLE).map((item) => item.id),
    note,
  };
}

export function computeDimensions(
  commands: readonly GhManifestCommand[],
  capabilities: readonly GhCapabilityDefinition[],
): readonly GhCoverageDimension[] {
  const leaves = commands.filter((command) => !command.group && command.aliasOf === null);
  const byPath = new Map(commands.map((command) => [command.path.join(' '), command]));
  const definedIds = new Set(capabilities.map((capability) => capability.id));
  const leafId = (command: GhManifestCommand): string => command.path.join(' ');

  const aliasItems: Item[] = [];
  for (const command of commands) {
    if (command.aliasOf !== null) {
      aliasItems.push({ id: `${leafId(command)} → ${command.aliasOf.join(' ')}`, classified: byPath.has(command.aliasOf.join(' ')) });
      continue;
    }
    if (command.aliases.length === 0) continue;
    // 그룹의 별칭(`gh cs` → codespace)은 탐색용이라 그룹 자체가 분류다. leaf의 별칭은 그 leaf의 분류를 따른다.
    const classified = command.group ? true : command.classification !== null && command.classification.support !== 'unknown';
    aliasItems.push({ id: `${leafId(command)} (${command.aliases.join(', ')})`, classified });
  }

  /*
   * flag 차원의 분모는 **모든 command의 flag**다 — 그룹(`codespace ports`처럼 실행 가능한 그룹 포함)의
   * flag도 help에 있고 SRS의 1,034도 그렇게 셌다. 그룹에는 저장된 분류가 없으므로 같은 규칙을 그 자리에서
   * 적용한다(결정적이라 저장하지 않아도 같은 답이다).
   */
  const flagItems = (predicate: (flag: GhManifestCommand['flags'][number]) => boolean): Item[] =>
    commands.flatMap((command) =>
      command.flags
        .map((flag, index) => ({ flag, control: command.classification?.flags[index]?.control ?? classifyFlag(flag, command.path).control }))
        .filter(({ flag }) => predicate(flag))
        .map(({ flag, control }) => ({ id: `${leafId(command)} --${flag.name}`, classified: control !== 'unknown' })),
    );

  const positionalItems: Item[] = leaves.flatMap((command) =>
    (command.classification?.positionals ?? []).map((positional) => ({
      id: `${leafId(command)} ${positional.placeholder}`,
      classified: positional.control !== 'unknown',
    })),
  );

  const jsonFieldItems: Item[] = commands.flatMap((command) =>
    command.jsonFields.map((field) => ({ id: `${leafId(command)} --json ${field}`, classified: /^[A-Za-z][A-Za-z0-9]*$/.test(field) })),
  );

  const leafItems = (predicate: (command: GhManifestCommand) => boolean): Item[] =>
    leaves.map((command) => ({ id: leafId(command), classified: predicate(command) }));

  const extensionLeaves = leaves.filter((command) => command.classification?.support === 'requires_extension');
  const secretOutputs = leaves.filter((command) => command.classification?.sensitivity === 'secret');
  const opaqueText = leaves.filter((command) => command.classification?.resultKind === 'text');
  const bindable = capabilities.filter((capability) => capability.result.bindable);

  return [
    dimension('command_path', 'core command path 분류율', 'GATE-GH-01', leafItems((command) => command.classification !== null && command.classification.support !== 'unknown'), `분모는 그룹·별칭 전용 노드를 뺀 leaf ${String(leaves.length)}개(그룹 ${String(commands.filter((command) => command.group).length)}·별칭 전용 ${String(commands.filter((command) => command.aliasOf !== null).length)}은 실행 대상이 아니다). 분류됨 = support가 unknown이 아님 (FR-GH-001 AC-2)`),
    dimension('command_alias', 'command alias 분류율', 'GATE-GH-01', aliasItems, '분모는 별칭을 가진 command(그룹 포함)와 별칭 전용 노드. 분류됨 = 별칭이 가리키는 command가 존재하고(별칭 전용) 또는 그 command가 분류됨(leaf) 또는 그룹(탐색용)'),
    dimension('positional', 'positional argument 분류율', 'GATE-GH-01', positionalItems, 'USAGE 줄의 최상위 괄호 묶음 하나가 자리 하나다(`[flags]` 제외, `-- <gitflags>` 통과 인자는 포함). 분류됨 = control이 unknown이 아님 (FR-GH-001 AC-3)'),
    dimension('command_flag', 'command 고유 flag 분류율', 'GATE-GH-01', flagItems((flag) => !flag.inherited), '모든 command(실행 가능한 그룹 포함)의 FLAGS 절 항목 — SRS의 1,034와 같은 분모. 분류됨 = control이 unknown이 아님 (FR-GH-001 AC-3·AC-7)'),
    dimension('inherited_flag', 'inherited/global flag 분류율', 'GATE-GH-01', flagItems((flag) => flag.inherited), '모든 command의 INHERITED FLAGS 절 항목(출현 기준, SRS의 312). 고유 종류는 help·repo·codespace·repo-owner 넷이다'),
    dimension('short_alias', 'short/long alias 분류율', 'GATE-GH-01', flagItems((flag) => flag.short !== null), 'short alias가 있는 flag(고유·inherited 출현 모두). 분류됨 = 그 flag의 control이 unknown이 아님'),
    dimension('repeatable_flag', '반복 가능 flag 분류율', 'GATE-GH-01', flagItems((flag) => !flag.inherited && flag.repeatable), 'cobra `strings`·`stringArray`·`stringSlice`·`stringToString` 타입의 고유 flag'),
    dimension('interaction', 'interaction 모드 분류율', 'GATE-GH-01', leafItems((command) => command.classification !== null && command.classification.interaction !== 'unknown'), 'leaf마다 web_native·web_equivalent·sandbox_terminal·terminal_only·policy_blocked·unsupported_by_host 중 하나 (FR-GH-001 AC-8, ADR-019)'),
    dimension('io_mode', '입출력 모드 분류율', 'GATE-GH-01', leafItems((command) => command.classification !== null && command.classification.io.outputFormats.length > 0 && command.classification.io.contexts.length > 0), 'leaf마다 stdin·파일 입력 flag·파일 출력 flag·출력 형식·컨텍스트 요구가 적혀 있음 (FR-GH-001 AC-9)'),
    dimension('json_field', '`--json` 필드 분류율', 'GATE-GH-01', jsonFieldItems, 'JSON FIELDS 절의 필드(그룹 포함). 분류됨 = 이름이 식별자 형식으로 읽혔음. typed 결과 열로의 사상은 실행을 여는 capability(pr.list 10필드)에만 있다'),
    dimension('result_kind', '결과 계약 분류율', 'GATE-GH-01d', leafItems((command) => command.classification !== null && command.classification.resultKind !== 'unknown'), 'leaf마다 결과 종류(json·resource·resource_list·url·artifact·text·stream·exit_status) 하나 (FR-GH-001 AC-11)'),
    dimension('sensitivity', 'secret 출력 분류율', 'GATE-GH-01d', leafItems((command) => command.classification !== null && command.classification.sensitivity !== 'unknown'), `leaf마다 결과 민감도(public·internal·sensitive·secret) 하나. secret으로 분류된 것 ${String(secretOutputs.length)}개: ${secretOutputs.map(leafId).join(', ') || '없음'}`),
    dimension('bindability', 'bindability 분류율', 'GATE-GH-01d', leafItems((command) => definedIds.has(command.id)), `composability 상태는 실행을 여는 capability 정의(GhResultContract)에만 있다 — ${String(definedIds.size)}개. 나머지 leaf는 WP-066이 정의한다`),
    dimension('resource_type', '자원 타입 분류율', 'GATE-GH-01d', leafItems((command) => definedIds.has(command.id)), 'GhResourceRef.kind는 capability 정의에만 있다 — 위와 같은 분모·분자'),
    dimension('io_port', '입력·출력 port 분류율', 'GATE-GH-01d', bindable.map((capability) => ({ id: capability.id, classified: false })), `분모는 bindable=true인 capability ${String(bindable.length)}개. 이 판은 bindable capability가 없어 분모가 0이며, 그것은 통과가 아니라 「정의되지 않음」이다 (WP-066)`),
    dimension('extension_split', 'core / extension coverage 분리', 'GATE-GH-01b', extensionLeaves.map((command) => ({ id: leafId(command), classified: true })), `core leaf ${String(leaves.length - extensionLeaves.length)}개와 extension plane command ${String(extensionLeaves.length)}개를 따로 센다 (FR-GH-001 AC-10). 여기 항목은 extension plane 쪽이다`),
    dimension('host_support', '대상 GHES 지원 확인', 'informational', leafItems((command) => command.classification?.hostSupport === 'verified'), '사내 GHES에서 실제로 확인한 command 수. 이 판은 0이며 unsupported_by_host로 적은 것도 0이다 — 확인하지 않은 것을 미지원으로 적지 않는다 (FR-GH-011 AC-4·AC-5)'),
    dimension('graph_edges', 'capability 그래프 간선 수', 'informational', [], 'bindable 결과가 없어 간선 0. 0은 조합이 하나도 성립하지 않는다는 뜻이다 (WP-066)'),
    dimension('opaque_text', '`opaque_text` 결과 수', 'informational', opaqueText.map((command) => ({ id: leafId(command), classified: true })), '결과 종류가 text인 leaf — 줄여야 할 부채이며 숨기지 않는다'),
  ];
}
