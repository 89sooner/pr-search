/**
 * 검증기 (FR-GH-001 AC-4·AC-5·AC-11·AC-12, NFR-009, WP-045 DoD / CR-088 · CR-089).
 *
 * 커밋된 manifest 파일을 직접 읽어 검증한다 — `pnpm test`가 곧 게이트다. 그리고 검증기가
 * **실제 결함을 잡는지** 변이로 본다: command·flag·별칭 누락, 새 미분류 항목, 실행 허용 확장,
 * 중복 ID, 해시 변조, gh 버전 불일치, 민감도 누락, 정의 드리프트, 별칭 충돌. 변이마다 해시를
 * 다시 계산해 넣는다 — 해시 불일치 하나로 뭉뚱그려 잡히는 것이 아니라 **각각의 코드**로 잡혀야
 * 진단이 된다.
 *
 * CR-089: 결과 계약 차원(GATE-GH-01d)이 통과한다. 그래서 변이가 더 중요하다 — port를 지워 분모에서 빼기, 모두를
 * 비바인딩으로 적어 분모를 0으로 만들기, 비밀이 흐르게 적기, port·입력 자리·구현 adapter를 위조하기가 각각 잡혀야
 * 「통과」가 거짓이 아니다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PR_LIST_CAPABILITY } from './capabilities.js';
import { classifyCommand } from './classification/classify.js';
import { buildManifest, manifestHash } from './manifest.js';
import type { GhCapabilityManifest, GhInventoryCommand, GhManifestCommand, GhResultContract } from './types.js';
import { inventoryCommandOf, inventoryHash, inventoryOfManifest, reportHash, validateManifest } from './validate.js';

const committed = JSON.parse(readFileSync(fileURLToPath(new URL('../manifest/gh-2.97.0.json', import.meta.url)), 'utf8')) as GhCapabilityManifest;

/** 내용을 바꾼 뒤 해시를 다시 맞춘다 — 해시 불일치가 아니라 그 변이 자체가 잡혀야 한다. */
function rehash(manifest: GhCapabilityManifest): GhCapabilityManifest {
  return { ...manifest, hash: manifestHash(manifest) };
}

function withCommands(mutate: (commands: GhManifestCommand[]) => GhManifestCommand[]): GhCapabilityManifest {
  return rehash({ ...committed, commands: mutate([...committed.commands]) });
}

/** command 하나의 결과 계약만 바꾼다. `null`을 돌려주면 계약을 없앤다. */
function withResult(id: string, mutate: (result: GhResultContract) => GhResultContract | null): GhCapabilityManifest {
  return withCommands((commands) =>
    commands.map((command) =>
      command.id === id && command.classification?.result ? { ...command, classification: { ...command.classification, result: mutate(command.classification.result) } } : command,
    ),
  );
}

function codes(manifest: GhCapabilityManifest, options: Parameters<typeof validateManifest>[1] = {}): { readonly errors: string[]; readonly gaps: string[]; readonly status: string } {
  const report = validateManifest(manifest, options);
  return {
    errors: [...new Set(report.findings.filter((finding) => finding.severity === 'error').map((finding) => finding.code))].sort(),
    gaps: [...new Set(report.findings.filter((finding) => finding.severity === 'gap').map((finding) => finding.code))].sort(),
    status: report.status,
  };
}

const at = (path: string): GhManifestCommand => {
  const found = committed.commands.find((command) => command.path.join(' ') === path);
  if (found === undefined) throw new Error(`fixture: ${path} 없음`);
  return found;
};

describe('커밋된 manifest', () => {
  const report = validateManifest(committed);

  it('구조 오류 0건이며 해시·버전·판이 맞는다', () => {
    expect(report.findings.filter((finding) => finding.severity === 'error')).toEqual([]);
    expect(report.hashVerified).toBe(true);
    expect(report.ghVersion).toBe(report.ghPinnedVersion);
    expect(report.manifestVersion).toBe(report.expectedManifestVersion);
    expect(report.reportVersion).toBe('r2');
  });

  it('실행 허용은 코드 표와 같고 pr.list 하나다 (R0 범위 유지) — 결과 계약이 생겨도 넓어지지 않는다', () => {
    expect(report.execution).toEqual({ allowed: ['pr.list'], definitions: ['pr.list'] });
    expect(report.contracts.executableCommands).toEqual(['pr.list']);
    expect(report.contracts.adaptersImplemented).toEqual(['pr.list:pr_list_v2']);
  });

  it('GATE-GH-01·01b·01d 전부 통과이고 상태는 passed다 — 01d 여섯 차원은 분모를 따로 센다', () => {
    expect(report.gates.map((gate) => [gate.id, gate.pass])).toEqual([
      ['GATE-GH-01', true],
      ['GATE-GH-01b', true],
      ['GATE-GH-01d', true],
    ]);
    expect(report.status).toBe('passed');
    const by = new Map(report.dimensions.map((dimension) => [dimension.id, dimension]));
    for (const id of ['result_contract', 'bindability', 'resource_type', 'secret_output']) expect(by.get(id), id).toMatchObject({ gate: 'GATE-GH-01d', total: 196, classified: 196 });
    // port 차원의 분모는 port 수가 아니라 capability 수다 — 출력은 bindable leaf, 입력은 대상 자원 자리를 가진 leaf.
    expect(by.get('output_port')).toMatchObject({ gate: 'GATE-GH-01d', total: 32, classified: 32 });
    expect(by.get('input_port')).toMatchObject({ gate: 'GATE-GH-01d', total: 80, classified: 80 });
    for (const dimension of report.dimensions.filter((one) => one.gate !== 'informational')) {
      expect(dimension.unclassified, `${dimension.id}: ${dimension.unclassifiedSample.join(', ')}`).toBe(0);
    }
  });

  it('결과 계약·연결 수치를 합치지 않고 따로 낸다 — 간선은 있어도 실행 가능한 다단계 흐름은 0이다', () => {
    expect(report.contracts).toMatchObject({
      resultContracts: { classified: 196, total: 196 },
      outputPorts: { commands: 32, ports: 36 },
      inputPorts: { commands: 80, ports: 81 },
      executableFlows: 0,
      hostVerified: 0,
    });
    expect(report.contracts.graph).toMatchObject({ nodes: 196, edges: 398, direct: 0, conditional: 398, blockedSameType: 6, executableFlows: 0 });
    expect(Object.fromEntries(report.contracts.composability.map((entry) => [entry.value, entry.count]))).toEqual({
      fully_bindable: 0,
      partially_bindable: 32,
      terminal_result: 115,
      artifact_result: 3,
      opaque_result: 30,
      secret_non_bindable: 4,
      policy_blocked: 12,
      unsupported_by_host: 0,
    });
    const informational = new Map(report.dimensions.filter((dimension) => dimension.gate === 'informational').map((dimension) => [dimension.id, dimension.total]));
    expect(Object.fromEntries(informational)).toMatchObject({ graph_edges: 398, adapter_implemented: 1, executable_flows: 0, host_support: 196 });
  });

  /*
   * **지우지 말 것.** 검증기의 coverage 재계산은 생성기와 같은 함수를 쓰므로 분모 논리의 버그는 양쪽에 같이
   * 있다. 이 상수들(SRS NFR-009 실측 기준)과 `integration/drift.test.ts`의 실제 바이너리가 검증기 밖의
   * 유일한 독립 앵커다 (독립 검토 나).
   */
  it('분모가 SRS의 실측 기준과 같은 뜻으로 읽힌다 — leaf 196 · flag 1,034 · inherited 312 · short 625 · repeatable 37 · json 707', () => {
    const by = new Map(report.dimensions.map((dimension) => [dimension.id, dimension]));
    expect(by.get('command_path')?.total).toBe(196);
    expect(by.get('command_flag')?.total).toBe(1034);
    expect(by.get('inherited_flag')?.total).toBe(312);
    expect(by.get('short_alias')?.total).toBe(625);
    expect(by.get('repeatable_flag')?.total).toBe(37);
    expect(by.get('json_field')?.total).toBe(707);
    expect(by.get('host_support')).toMatchObject({ total: 196, classified: 0 });
  });

  it('보고서는 결정적이다 — 같은 입력이면 같은 해시이고 JSON 왕복도 같다', () => {
    const again = validateManifest(JSON.parse(JSON.stringify(committed)) as GhCapabilityManifest);
    expect(reportHash(again)).toBe(reportHash(report));
    expect(JSON.stringify(report)).not.toMatch(/"20\d\d-\d\d-\d\dT/); // 시각이 없다
    expect(inventoryHash(inventoryOfManifest(committed))).toBe(report.inventoryHash);
  });
});

describe('변이 — 검증기가 실제 결함을 각각의 코드로 잡는다', () => {
  it('command 하나를 지우면 잡힌다 (coverage·별칭 대상)', () => {
    const mutated = withCommands((commands) => commands.filter((command) => command.path.join(' ') !== 'pr checkout'));
    const result = codes(mutated);
    expect(result.status).toBe('failed');
    expect(result.errors).toEqual(expect.arrayContaining(['coverage_mismatch', 'alias_target_missing']));
  });

  it('flag 하나를 지우면 잡힌다 (분류 재계산·정의 옵션)', () => {
    const mutated = withCommands((commands) =>
      commands.map((command) => (command.path.join(' ') === 'pr list' ? { ...command, flags: command.flags.filter((flag) => flag.name !== 'state') } : command)),
    );
    const result = codes(mutated);
    expect(result.status).toBe('failed');
    expect(result.errors).toEqual(expect.arrayContaining(['flag_classification_count', 'classification_recompute_mismatch', 'definition_option_missing']));
  });

  it('별칭을 지우거나 충돌시키면 잡힌다', () => {
    // 별칭은 분류 입력이 아니라 커버리지 분모다 — 지우면 별칭 차원의 재계산이 저장값과 어긋난다.
    const removed = withCommands((commands) => commands.map((command) => (command.path.join(' ') === 'pr list' ? { ...command, aliases: [] } : command)));
    expect(codes(removed).errors).toContain('coverage_mismatch');
    const conflicting = withCommands((commands) =>
      commands.map((command) => (command.path.join(' ') === 'pr view' ? { ...command, aliases: [...command.aliases, ...at('pr list').aliases] } : command)),
    );
    expect(codes(conflicting).errors).toContain('alias_conflict');
  });

  it('새 미분류 항목을 넣으면 strict가 실패한다 (gap: support_unknown·result_contract_missing)', () => {
    const fresh: GhManifestCommand = {
      ...inventoryCommandOf(at('pr list')),
      path: ['zz', 'frobnicate'],
      usage: 'gh zz frobnicate <zorblax> [flags]',
      aliases: [],
      id: 'zz.frobnicate',
      support: 'unknown',
      execution: 'not_implemented',
      executionReason: 'x',
      risk: null,
      classification: null,
    };
    const classification = classifyCommand(inventoryCommandOf(fresh));
    const mutated = rehash({ ...committed, commands: [...committed.commands, { ...fresh, classification }] });
    const result = codes(mutated);
    expect(result.errors).toEqual(['coverage_mismatch']); // 저장된 coverage는 옛것이라 어긋난다 — 그것도 잡힌다
    expect(result.gaps).toEqual(expect.arrayContaining(['support_unknown', 'interaction_unknown', 'positional_unknown', 'result_contract_missing']));
  });

  it('정책 차단을 미구현으로(또는 그 반대로) 뒤바꾸면 잡힌다 — execution_derivation_mismatch (독립 검토 나)', () => {
    const disguised = withCommands((commands) =>
      commands.map((command) => (command.path.join(' ') === 'auth token' ? { ...command, execution: 'not_implemented' } : command)),
    );
    expect(codes(disguised).errors).toContain('execution_derivation_mismatch');
    const escalated = withCommands((commands) =>
      commands.map((command) => (command.path.join(' ') === 'pr merge' ? { ...command, execution: 'policy_blocked' } : command)),
    );
    expect(codes(escalated).errors).toContain('execution_derivation_mismatch');
    const noReason = withCommands((commands) =>
      commands.map((command) => (command.path.join(' ') === 'pr merge' ? { ...command, executionReason: null } : command)),
    );
    expect(codes(noReason).errors).toContain('execution_reason_mismatch');
  });

  it('분류 메타데이터를 allowed로 바꿔도 실행이 넓어지지 않는다 — execution_widened (결과 계약·port가 있는 pr view도 같다)', () => {
    for (const path of ['pr merge', 'pr view']) {
      const mutated = withCommands((commands) =>
        commands.map((command) => (command.path.join(' ') === path ? { ...command, execution: 'allowed', executionReason: null } : command)),
      );
      const result = codes(mutated);
      expect(result.status, path).toBe('failed');
      expect(result.errors, path).toEqual(expect.arrayContaining(['execution_widened', 'executable_count_mismatch']));
    }
  });

  it('중복 ID·경로를 잡는다', () => {
    const mutated = withCommands((commands) => [...commands, at('pr list')]);
    expect(codes(mutated).errors).toEqual(expect.arrayContaining(['duplicate_command_path', 'duplicate_command_id']));
  });

  it('해시 변조와 gh 버전 불일치를 잡는다', () => {
    expect(codes({ ...committed, hash: 'deadbeef' })).toMatchObject({ status: 'failed', errors: ['hash_mismatch'] });
    expect(codes(rehash({ ...committed, ghVersion: '2.96.0' })).errors).toContain('gh_version_mismatch');
    expect(codes(rehash({ ...committed, manifestVersion: 'r0.2' })).errors).toContain('manifest_version_mismatch');
  });

  it('민감도·결과 종류 누락을 잡는다', () => {
    const mutated = withCommands((commands) =>
      commands.map((command) =>
        command.path.join(' ') === 'variable list' && command.classification !== null
          ? { ...command, classification: { ...command.classification, sensitivity: 'unknown' as const, resultKind: 'unknown' as const } }
          : command,
      ),
    );
    const result = codes(mutated);
    expect(result.errors).toEqual(expect.arrayContaining(['classification_recompute_mismatch', 'result_kind_desync', 'sensitivity_desync']));
    expect(result.gaps).toEqual(expect.arrayContaining(['sensitivity_unknown', 'result_kind_unknown']));
  });

  it('manifest에 실린 정의가 코드 표와 다르면 잡힌다 — definition_drift', () => {
    const mutated = rehash({ ...committed, capabilities: [{ ...PR_LIST_CAPABILITY, timeoutMs: 1 }] });
    expect(codes(mutated).errors).toContain('definition_drift');
    const dropped = rehash({ ...committed, capabilities: [] });
    expect(codes(dropped).errors).toContain('definition_missing');
  });

  it('flag 컨트롤 값이 열거 밖이면 잡힌다', () => {
    const mutated = withCommands((commands) =>
      commands.map((command) =>
        command.path.join(' ') === 'pr list' && command.classification !== null
          ? { ...command, classification: { ...command.classification, flags: command.classification.flags.map((flag, index) => (index === 0 ? { ...flag, control: 'bogus' as never } : flag)) } }
          : command,
      ),
    );
    expect(codes(mutated).errors).toContain('flag_control_invalid');
  });
});

describe('변이 — CR-089 결과 계약·port', () => {
  it('출력 port를 지우면 잡힌다 — bindable인데 port가 없고, 구현 adapter가 가리킬 port도 없다', () => {
    const result = codes(withResult('pr.list', (contract) => ({ ...contract, outputPorts: [] })));
    expect(result.status).toBe('failed');
    expect(result.errors).toEqual(expect.arrayContaining(['bindable_port_desync', 'classification_recompute_mismatch', 'definition_adapter_port_missing']));
  });

  it('모두를 비바인딩으로 적어 출력 port 분모를 0으로 만들면 01d가 통과하지 않는다', () => {
    const mutated = withCommands((commands) =>
      commands.map((command) => {
        const contract = command.classification?.result;
        if (command.classification === null || contract === null || contract === undefined || !contract.bindable) return command;
        const demoted: GhResultContract = {
          ...contract,
          composability: 'terminal_result',
          bindable: false,
          outputPorts: [],
          outputPortsNote: '분모를 줄이려는 위조',
          outputs: contract.outputs.map((output) => ({ ...output, bindable: false, reason: output.reason ?? '위조' })),
        };
        return { ...command, classification: { ...command.classification, result: demoted } };
      }),
    );
    const report = validateManifest(mutated);
    expect(report.dimensions.find((dimension) => dimension.id === 'output_port')).toMatchObject({ total: 0 });
    expect(report.gates.find((gate) => gate.id === 'GATE-GH-01d')).toMatchObject({ pass: false });
    expect(report.status).toBe('failed');
    expect(codes(mutated).errors).toContain('classification_recompute_mismatch');
  });

  it('재계산이 맞는 manifest라도 port 분모가 0이면 통과가 아니다 — 판정 규칙 자체를 건다', () => {
    const inventory: GhInventoryCommand[] = [
      { path: ['pr'], aliases: [], summary: 'pr', usage: 'gh pr <command>', group: true, section: 'CORE COMMANDS', flags: [], jsonFields: [], aliasOf: null, helpStatus: 'ok' },
      { path: ['pr', 'merge'], aliases: [], summary: 'Merge', usage: 'gh pr merge [<number> | <url> | <branch>] [flags]', group: false, section: 'CORE COMMANDS', flags: [], jsonFields: [], aliasOf: null, helpStatus: 'ok' },
      { path: ['pr', 'close'], aliases: [], summary: 'Close', usage: 'gh pr close {<number> | <url> | <branch>} [flags]', group: false, section: 'CORE COMMANDS', flags: [], jsonFields: [], aliasOf: null, helpStatus: 'ok' },
    ];
    const manifest = buildManifest({ inventory: { ghVersion: '2.97.0', commands: inventory, helpTopics: [] }, capabilities: [], generatedAt: 'x' });
    const report = validateManifest(manifest, { capabilities: [] });
    expect(report.findings.filter((finding) => finding.severity === 'error')).toEqual([]);
    expect(report.dimensions.find((dimension) => dimension.id === 'output_port')).toMatchObject({ total: 0, unclassified: 0 });
    expect(report.dimensions.find((dimension) => dimension.id === 'input_port')).toMatchObject({ total: 2, classified: 2 });
    expect(report.gates.find((gate) => gate.id === 'GATE-GH-01d')).toMatchObject({ pass: false, detail: expect.stringContaining('output_port 0/0') as unknown });
    expect(report.status).toBe('incomplete');
  });

  it('비밀 결과가 흐르게 적으면 잡힌다 — secret_flows', () => {
    const result = codes(withResult('auth.token', (contract) => ({ ...contract, outputs: contract.outputs.map((output) => ({ ...output, adapter: 'opaque_text' as const })) })));
    expect(result.errors).toEqual(expect.arrayContaining(['secret_flows', 'classification_recompute_mismatch']));
  });

  it('port의 중복 ID·없는 타입·JSON에 없는 식별 필드·방향 위조를 각각의 코드로 잡는다', () => {
    const duplicate = codes(withResult('pr.view', (contract) => ({ ...contract, outputPorts: [contract.outputPorts[0]!, contract.outputPorts[0]!] })));
    expect(duplicate.errors).toContain('port_id_duplicate');
    const badType = codes(withResult('pr.view', (contract) => ({ ...contract, outputPorts: [{ ...contract.outputPorts[0]!, type: 'check_run' as never }] })));
    expect(badType.errors).toContain('port_type_invalid');
    const badField = codes(
      withResult('pr.view', (contract) => {
        const port = contract.outputPorts[0]!;
        const source = port.source?.adapter === 'native_json' ? { ...port.source, identity: { ...port.source.identity, field: 'nope' } } : port.source;
        return { ...contract, outputPorts: [{ ...port, source }] };
      }),
    );
    expect(badField.errors).toContain('port_identity_field_unknown');
    const direction = codes(withResult('pr.view', (contract) => ({ ...contract, outputPorts: [{ ...contract.outputPorts[0]!, direction: 'input' as const }] })));
    expect(direction.errors).toContain('port_direction_mismatch');
  });

  it('입력 port를 규칙과 다르게 적으면 잡힌다 — input_ports_recompute_mismatch', () => {
    const result = codes(withResult('pr.view', (contract) => ({ ...contract, inputPorts: [] })));
    expect(result.errors).toEqual(expect.arrayContaining(['input_ports_recompute_mismatch']));
    expect(result.gaps).toContain('input_ports_note_missing');
  });

  it('대상 GHES 확인 없이 unsupported_by_host로 적으면 잡힌다', () => {
    expect(codes(withResult('pr.merge', (contract) => ({ ...contract, composability: 'unsupported_by_host' }))).errors).toContain('unsupported_without_host_evidence');
  });

  it('구현 adapter를 옛 스키마로 바꾸면 잡힌다 — 실행 정의가 결과의 뜻을 따로 말하지 못한다', () => {
    const forged = { ...PR_LIST_CAPABILITY, resultAdapter: { ...PR_LIST_CAPABILITY.resultAdapter, schema: 'pr_list_v1' } };
    // manifest에 실린 사본만 바꾸면 코드 표와의 드리프트다 — 검증기는 코드 표의 정의로 adapter를 대조한다.
    expect(codes(rehash({ ...committed, capabilities: [forged] })).errors).toEqual(expect.arrayContaining(['definition_drift']));
    // 코드 표 자체가 옛 스키마를 가리키면 구현되지 않은 스키마이고 계약의 port와도 다르다.
    expect(codes(committed, { capabilities: [forged] }).errors).toEqual(expect.arrayContaining(['definition_drift', 'definition_adapter_unimplemented', 'definition_adapter_mismatch']));
    const wrongPort = { ...PR_LIST_CAPABILITY, resultAdapter: { ...PR_LIST_CAPABILITY.resultAdapter, outputPort: 'pull_request' } };
    expect(codes(committed, { capabilities: [wrongPort] }).errors).toEqual(expect.arrayContaining(['definition_adapter_port_missing']));
  });

  it('결과 계약이 없는 leaf는 미분류다', () => {
    const result = codes(withResult('pr.merge', () => null));
    expect(result.gaps).toContain('result_contract_missing');
    expect(result.errors).toContain('classification_recompute_mismatch');
  });
});
