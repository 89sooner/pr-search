/**
 * 검증기 (FR-GH-001 AC-4·AC-5, NFR-009, WP-045 DoD / CR-088).
 *
 * 커밋된 manifest 파일을 직접 읽어 검증한다 — `pnpm test`가 곧 게이트다. 그리고 검증기가
 * **실제 결함을 잡는지** 변이로 본다: command·flag·별칭 누락, 새 미분류 항목, 실행 허용 확장,
 * 중복 ID, 해시 변조, gh 버전 불일치, 민감도 누락, 정의 드리프트, 별칭 충돌. 변이마다 해시를
 * 다시 계산해 넣는다 — 해시 불일치 하나로 뭉뚱그려 잡히는 것이 아니라 **각각의 코드**로 잡혀야
 * 진단이 된다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PR_LIST_CAPABILITY } from './capabilities.js';
import { classifyCommand } from './classification/classify.js';
import { manifestHash } from './manifest.js';
import type { GhCapabilityManifest, GhManifestCommand } from './types.js';
import { inventoryCommandOf, inventoryHash, inventoryOfManifest, reportHash, validateManifest } from './validate.js';

const committed = JSON.parse(readFileSync(fileURLToPath(new URL('../manifest/gh-2.97.0.json', import.meta.url)), 'utf8')) as GhCapabilityManifest;

/** 내용을 바꾼 뒤 해시를 다시 맞춘다 — 해시 불일치가 아니라 그 변이 자체가 잡혀야 한다. */
function rehash(manifest: GhCapabilityManifest): GhCapabilityManifest {
  return { ...manifest, hash: manifestHash(manifest) };
}

function withCommands(mutate: (commands: GhManifestCommand[]) => GhManifestCommand[]): GhCapabilityManifest {
  return rehash({ ...committed, commands: mutate([...committed.commands]) });
}

function codes(manifest: GhCapabilityManifest): { readonly errors: string[]; readonly gaps: string[]; readonly status: string } {
  const report = validateManifest(manifest);
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
  });

  it('실행 허용은 코드 표와 같고 pr.list 하나다 (R0 범위 유지)', () => {
    expect(report.execution).toEqual({ allowed: ['pr.list'], definitions: ['pr.list'] });
  });

  it('GATE-GH-01 차원은 전부 100%이고, GATE-GH-01d는 bindability·resource_type 때문에 미달이다 — 그래서 상태는 incomplete다', () => {
    const gate01 = report.gates.find((gate) => gate.id === 'GATE-GH-01');
    expect(gate01?.pass, gate01?.detail).toBe(true);
    const gate01d = report.gates.find((gate) => gate.id === 'GATE-GH-01d');
    expect(gate01d?.pass).toBe(false);
    expect(gate01d?.detail).toContain('bindability');
    expect(report.status).toBe('incomplete');
    for (const dimension of report.dimensions.filter((one) => one.gate === 'GATE-GH-01')) {
      expect(dimension.unclassified, `${dimension.id}: ${dimension.unclassifiedSample.join(', ')}`).toBe(0);
    }
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

  it('새 미분류 항목을 넣으면 strict가 실패한다 (gap: support_unknown)', () => {
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
    expect(result.gaps).toEqual(expect.arrayContaining(['support_unknown', 'interaction_unknown', 'positional_unknown']));
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

  it('분류 메타데이터를 allowed로 바꿔도 실행이 넓어지지 않는다 — execution_widened', () => {
    const mutated = withCommands((commands) =>
      commands.map((command) => (command.path.join(' ') === 'pr merge' ? { ...command, execution: 'allowed', executionReason: null } : command)),
    );
    const result = codes(mutated);
    expect(result.status).toBe('failed');
    expect(result.errors).toEqual(expect.arrayContaining(['execution_widened', 'executable_count_mismatch']));
    expect(validateManifest(mutated).execution.allowed).toEqual(['pr.list', 'pr.merge']);
  });

  it('중복 ID·경로를 잡는다', () => {
    const mutated = withCommands((commands) => [...commands, at('pr list')]);
    expect(codes(mutated).errors).toEqual(expect.arrayContaining(['duplicate_command_path', 'duplicate_command_id']));
  });

  it('해시 변조와 gh 버전 불일치를 잡는다', () => {
    expect(codes({ ...committed, hash: 'deadbeef' })).toMatchObject({ status: 'failed', errors: ['hash_mismatch'] });
    expect(codes(rehash({ ...committed, ghVersion: '2.96.0' })).errors).toContain('gh_version_mismatch');
    expect(codes(rehash({ ...committed, manifestVersion: 'r0.1' })).errors).toContain('manifest_version_mismatch');
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
    expect(result.errors).toContain('classification_recompute_mismatch');
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
