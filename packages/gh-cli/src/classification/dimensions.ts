/**
 * NFR-009 차원별 커버리지 (CR-008·CR-009의 게이트 표, WP-045 / CR-088 · CR-089).
 *
 * **분모를 적는다.** 같은 숫자라도 무엇을 셌는지가 다르면 다른 사실이다 — SRS의 「command node
 * 228」은 그룹 32 + leaf 196이고 여기 `commands` 배열은 별칭 전용 노드(`co`) 하나를 더해 229다.
 * 차원마다 `note`가 분모와 「분류됨」의 뜻을 말한다.
 *
 * 게이트는 넷이다: `GATE-GH-01`(NFR-009 본표의 열 차원), `GATE-GH-01b`(core/extension 분리 보고),
 * `GATE-GH-01d`(CR-009 결과 계약 차원), 그리고 게이트가 아닌 `informational`. 검증기가 이 함수를
 * 다시 불러 저장된 값과 대조하므로, 여기서 세는 방식이 곧 계약이다.
 *
 * ## GATE-GH-01d (CR-089)
 *
 * 차원 여섯의 분모를 섞지 않는다. 결과 계약·bindability·자원 타입·secret 출력은 **leaf** 단위이고, 출력·입력 port는
 * **port 수가 아니라 capability 수**다 — 출력은 composability가 bindable인 leaf, 입력은 대상 자원 자리를 가진 leaf다.
 * 「분류됨」은 `contract-checks.ts`의 그 차원 문제가 0건이라는 뜻이다. port 차원은 분모가 0이면 통과가 아니다
 * (`NONZERO_DENOMINATOR_DIMENSIONS`) — 모두를 비바인딩으로 적어 분모를 없애는 것은 분류가 아니다.
 */

import { IMPLEMENTED_RESULT_SCHEMAS } from '../capabilities.js';
import { computeCapabilityGraph } from '../graph.js';
import type { GhCapabilityDefinition, GhCoverageDimension, GhManifestCommand } from '../types.js';
import { contractProblems, type ContractDimension, type ContractProblem } from './contract-checks.js';
import { subjectSlotsOf } from './ports.js';
import { BINDABLE_COMPOSABILITY } from './results.js';
import { classifyFlag } from './rules.js';

const SAMPLE = 50;

/** 분모가 0이면 「정의되지 않음」이라 게이트를 통과시키지 않는 차원. */
export const NONZERO_DENOMINATOR_DIMENSIONS: ReadonlySet<string> = new Set(['output_port', 'input_port']);

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

  const problems = new Map<GhManifestCommand, readonly ContractProblem[]>(leaves.map((command) => [command, contractProblems(command)]));
  const clean = (command: GhManifestCommand, of: ContractDimension): boolean =>
    command.classification?.result !== null && command.classification?.result !== undefined && !(problems.get(command) ?? []).some((problem) => problem.dimension === of);
  const bindableLeaves = leaves.filter((command) => {
    const result = command.classification?.result;
    return result !== null && result !== undefined && BINDABLE_COMPOSABILITY.has(result.composability);
  });
  const subjectLeaves = leaves.filter((command) => subjectSlotsOf(command).length > 0);
  const outputPortCount = bindableLeaves.reduce((sum, command) => sum + (command.classification?.result?.outputPorts.length ?? 0), 0);
  const inputPortCount = subjectLeaves.reduce((sum, command) => sum + (command.classification?.result?.inputPorts.length ?? 0), 0);
  const graph = computeCapabilityGraph(commands);

  const extensionLeaves = leaves.filter((command) => command.classification?.support === 'requires_extension');
  const secretOutputs = leaves.filter((command) => command.classification?.sensitivity === 'secret');
  const opaque = leaves.filter((command) => command.classification?.result?.composability === 'opaque_result');
  // 옛 판(r0.2)의 정의에는 resultAdapter가 없다 — 그 manifest도 검증기가 읽어 판 불일치로 답해야 한다.
  const implemented = capabilities.filter((capability) => {
    const schema = (capability as Partial<GhCapabilityDefinition>).resultAdapter?.schema;
    return schema !== undefined && IMPLEMENTED_RESULT_SCHEMAS.includes(schema);
  });

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
    dimension('json_field', '`--json` 필드 분류율', 'GATE-GH-01', jsonFieldItems, `JSON FIELDS 절의 필드(그룹 포함). 분류됨 = 이름이 식별자 형식으로 읽혔음. 필드를 가진 command는 ${String(commands.filter((command) => command.jsonFields.length > 0).length)}개다 — \`workflow run --json\`은 입력 flag라 세지 않는다`),
    dimension('result_contract', '결과 계약 분류율', 'GATE-GH-01d', leafItems((command) => clean(command, 'result_contract')), `분모는 leaf ${String(leaves.length)}개. 분류됨 = 결과 계약이 있고 출력 모드(io.outputFormats)마다 adapter와 스키마 또는 구조화 불가 사유가 있으며, 주 종류가 분류·구조화 모드와 맞고 입력 port가 없으면 이유가 있다 (FR-GH-001 AC-11)`),
    dimension('bindability', 'bindability 분류율', 'GATE-GH-01d', leafItems((command) => clean(command, 'bindability')), `분모는 leaf ${String(leaves.length)}개. 분류됨 = composability 8종 중 하나이고 bindable·출력 port·출력 모드와 어긋나지 않으며, 출력 port가 없으면 이유가 있다. partially_bindable ${String(bindableLeaves.length)}개`),
    dimension('resource_type', '자원 타입 분류율', 'GATE-GH-01d', leafItems((command) => clean(command, 'resource_type')), `분모는 leaf ${String(leaves.length)}개. 분류됨 = GhResourceRef.kind 하나와 근거, 또는 자원 결과가 아닌 이유가 있다 — 자원이 아닌 결과에 가짜 종류를 채우지 않는다`),
    dimension('secret_output', 'secret 출력 분류율', 'GATE-GH-01d', leafItems((command) => clean(command, 'secret_output')), `분모는 leaf ${String(leaves.length)}개. 분류됨 = 민감도 4종 중 하나이고, secret이면 secret_non_bindable·출력 port 0·모든 모드 secret_non_bindable이다. secret ${String(secretOutputs.length)}개: ${secretOutputs.map(leafId).join(', ') || '없음'}`),
    dimension('output_port', '출력 port 분류율', 'GATE-GH-01d', bindableLeaves.map((command) => ({ id: leafId(command), classified: clean(command, 'output_port') && (command.classification?.result?.outputPorts.length ?? 0) > 0 })), `분모는 port 수가 아니라 composability가 fully·partially_bindable인 leaf ${String(bindableLeaves.length)}개(출력 port ${String(outputPortCount)}개). 분류됨 = 출력 port가 하나 이상이고 식별 필드·URL 문법·스키마·조건이 인벤토리와 맞다. 분모 0은 통과가 아니다`),
    dimension('input_port', '입력 port 분류율', 'GATE-GH-01d', subjectLeaves.map((command) => ({ id: leafId(command), classified: clean(command, 'input_port') })), `분모는 port 수가 아니라 대상 자원 자리(positional 대안·--codespace)를 가진 leaf ${String(subjectLeaves.length)}개(입력 port ${String(inputPortCount)}개). 분류됨 = 자리마다 port가 있고 타입·cardinality·조건이 규칙과 맞다. 분모 0은 통과가 아니다`),
    dimension('extension_split', 'core / extension coverage 분리', 'GATE-GH-01b', extensionLeaves.map((command) => ({ id: leafId(command), classified: true })), `core leaf ${String(leaves.length - extensionLeaves.length)}개와 extension plane command ${String(extensionLeaves.length)}개를 따로 센다 (FR-GH-001 AC-10). 여기 항목은 extension plane 쪽이다`),
    dimension('host_support', '대상 GHES 지원 확인', 'informational', leafItems((command) => command.classification?.hostSupport === 'verified'), '사내 GHES에서 실제로 확인한 command 수. 이 판은 0이며 unsupported_by_host로 적은 것도 0이다 — 확인하지 않은 것을 미지원으로 적지 않는다 (FR-GH-011 AC-4·AC-5)'),
    dimension('graph_edges', 'capability 그래프 간선 수', 'informational', graph.edges.map((edge) => ({ id: `${edge.from}.${edge.fromPort} → ${edge.to}.${edge.toPort}`, classified: true })), `판정기(judgePortCompatibility)가 호환이라고 답한 출력→입력 짝. 조건부 ${String(graph.summary.conditional)} · 직접 ${String(graph.summary.direct)} · 타입은 같지만 불가 ${String(graph.summary.blockedSameType)}. 간선은 실행 승인이 아니다 — 실행 가능한 간선 0`),
    dimension('opaque_text', '`opaque_text` 결과 수', 'informational', opaque.map((command) => ({ id: leafId(command), classified: true })), 'composability가 opaque_result인 leaf — 구조를 신뢰할 수 없는 결과이며 줄여야 할 부채다. 숨기지 않는다'),
    dimension('adapter_implemented', '구현된 결과 adapter 수', 'informational', implemented.map((capability) => ({ id: `${capability.id}:${capability.resultAdapter.schema}`, classified: true })), '실행기가 결과를 실제로 만드는 스키마. 결과 계약에 스키마가 정의된 것과 다른 사실이다'),
    dimension('executable_flows', '실행 가능한 다단계 흐름 수', 'informational', [], '다단계 실행(Recipe)은 열리지 않았다 — 0이다 (FR-GH-005)'),
  ];
}
