/**
 * 결과 계약 분류 (FR-GH-001 AC-11·AC-12, SRS 9.8, ADR-020, CR-089).
 *
 * 커밋된 manifest(r0.3)를 직접 읽는다. 여기서 거는 것은 **의미**다 — 비밀·정책 차단·표현식·브라우저·파일 모드가 흐르지
 * 않는가, 식별 필드가 없는 결과에 port를 만들지 않았는가, 자원 결과가 아닌 것에 가짜 자원 종류를 채우지 않았는가, 비TTY
 * 관측으로 정정한 주 종류가 그대로인가. 기대값은 손으로 적었다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GhCapabilityManifest, GhResultContract } from '../types.js';
import { COMMAND_ROWS } from './commands.js';
import { JSON_OUTPUT_PORTS, URL_OUTPUT_PORTS } from './ports.js';
import { OPAQUE_JSON, OUTPUT_PORT_NOTES, PORTLESS_RESOURCE, RESULT_KIND_EVIDENCE, composabilityOf } from './results.js';

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../manifest/gh-2.97.0.json', import.meta.url)), 'utf8')) as GhCapabilityManifest;
const leaves = manifest.commands.filter((command) => !command.group && command.aliasOf === null);

function contract(id: string): GhResultContract {
  const found = leaves.find((command) => command.id === id)?.classification?.result;
  if (found === null || found === undefined) throw new Error(`fixture: ${id}에 결과 계약이 없다`);
  return found;
}

const formats = (id: string): readonly string[] => leaves.find((command) => command.id === id)?.classification?.io.outputFormats ?? [];

describe('표의 완결성', () => {
  it('leaf 196개 전부에 결과 계약이 있고, 출력 모드마다 계약이 정확히 하나다', () => {
    expect(leaves).toHaveLength(196);
    for (const command of leaves) {
      const result = command.classification?.result;
      expect(result, command.id).toBeTruthy();
      expect(result?.outputs.map((output) => output.mode), command.id).toEqual(command.classification?.io.outputFormats);
    }
  });

  it('보조 표의 키는 전부 분류 표의 leaf다 — 오타로 빠진 행이 기본값으로 숨지 않는다', () => {
    for (const table of [RESULT_KIND_EVIDENCE, OUTPUT_PORT_NOTES, PORTLESS_RESOURCE, JSON_OUTPUT_PORTS, URL_OUTPUT_PORTS, OPAQUE_JSON]) {
      for (const key of Object.keys(table)) expect(key in COMMAND_ROWS, key).toBe(true);
    }
  });

  it('구조화·링크 결과인데 출력 port가 없으면 command마다 적은 이유가 있다 — 종류 기본 문구로 뭉개지 않는다', () => {
    for (const command of leaves) {
      const result = contract(command.id);
      const key = command.path.join(' ');
      if (result.outputPorts.length > 0 || result.sensitivity === 'secret' || command.classification?.support === 'policy_blocked') continue;
      if (['json', 'url', 'resource', 'resource_list'].includes(result.kind)) {
        expect(key in OUTPUT_PORT_NOTES || key in OPAQUE_JSON, key).toBe(true);
      }
      expect(result.outputPortsNote?.trim().length ?? 0, key).toBeGreaterThan(10);
    }
  });
});

describe('흐르지 않는 결과 — 비밀·정책 차단·표현식·브라우저·파일', () => {
  it('비밀 결과 넷은 secret_non_bindable이고 port·바인딩 가능한 모드가 없다', () => {
    const secrets = leaves.filter((command) => contract(command.id).sensitivity === 'secret').map((command) => command.id).sort();
    expect(secrets).toEqual(['auth.login', 'auth.refresh', 'auth.token', 'secret.set']);
    for (const id of secrets) {
      const result = contract(id);
      expect(result.composability, id).toBe('secret_non_bindable');
      expect(result.outputPorts, id).toEqual([]);
      expect(result.outputs.every((output) => output.adapter === 'secret_non_bindable' && !output.bindable), id).toBe(true);
    }
  });

  it('정책 차단 command(비밀 제외)는 policy_blocked이고 출력 port가 없다', () => {
    const blocked = leaves.filter((command) => command.classification?.support === 'policy_blocked' && contract(command.id).sensitivity !== 'secret');
    expect(blocked).toHaveLength(12);
    for (const command of blocked) {
      expect(contract(command.id).composability, command.id).toBe('policy_blocked');
      expect(contract(command.id).outputPorts, command.id).toEqual([]);
    }
  });

  it('--jq·--template 모드는 어느 command든 텍스트이고 바인딩 source가 아니다', () => {
    let seen = 0;
    for (const command of leaves) {
      for (const output of contract(command.id).outputs.filter((one) => one.mode === 'jq' || one.mode === 'template')) {
        seen += 1;
        expect(output, `${command.id} ${output.mode}`).toMatchObject({ adapter: expect.stringMatching(/^(opaque_text|secret_non_bindable)$/) as unknown, bindable: false, schema: null });
      }
    }
    expect(seen).toBeGreaterThan(80);
  });

  it('--web 모드는 결과가 없고, 파일 모드는 artifact이며, 스트림 모드는 바인딩 source가 아니다 (비밀 command는 모든 모드가 비밀이다)', () => {
    for (const command of leaves) {
      const result = contract(command.id);
      if (result.sensitivity === 'secret') {
        expect(result.outputs.every((output) => output.adapter === 'secret_non_bindable' && !output.bindable), command.id).toBe(true);
        continue;
      }
      for (const output of result.outputs) {
        if (output.mode === 'web') expect(output, command.id).toMatchObject({ adapter: 'exit_status', bindable: false });
        if (output.mode === 'file') expect(output, command.id).toMatchObject({ kind: 'artifact', adapter: 'artifact', bindable: false });
        if (output.mode === 'stream') expect(output, command.id).toMatchObject({ adapter: 'stream', bindable: false });
      }
    }
    const artifacts = leaves.filter((command) => contract(command.id).composability === 'artifact_result').map((command) => command.id).sort();
    expect(artifacts).toEqual(['attestation.download', 'release.download', 'run.download']);
    for (const id of artifacts) expect(contract(id).resourceKind, id).toBe('artifact');
  });

  it('workflow run의 --json은 입력 flag라 출력 모드가 아니고, create 계열의 --template도 출력 모드가 아니다 — JSON 출력 command는 40개다', () => {
    expect(formats('workflow.run')).not.toContain('json');
    for (const id of ['pr.create', 'issue.create', 'repo.create']) expect(formats(id), id).not.toContain('template');
    expect(manifest.coverage.jsonFieldCommands).toBe(40);
    expect(manifest.commands.filter((command) => command.flags.some((flag) => flag.name === 'json' && !flag.inherited))).toHaveLength(41);
  });
});

describe('자원 식별과 port — 대표 사례', () => {
  it('pr list: PR 목록 port 하나, 식별은 number, 저장소는 실행 컨텍스트, 스키마는 실행기가 구현한 pr_list_v2', () => {
    const result = contract('pr.list');
    expect(result).toMatchObject({ kind: 'resource_list', composability: 'partially_bindable', bindable: true, resourceKind: 'pull_request' });
    expect(result.outputPorts).toHaveLength(1);
    expect(result.outputPorts[0]).toMatchObject({
      id: 'pull_requests',
      type: 'pull_request',
      cardinality: 'many',
      source: { adapter: 'native_json', mode: 'json', schema: 'pr_list_v2', pointer: '', identity: { slot: 'number', field: 'number', repositoryPath: null } },
    });
    expect(result.outputs.find((output) => output.mode === 'text')).toMatchObject({ adapter: 'opaque_text', bindable: false });
  });

  it('pr view 입력은 `<number>` 대안으로만 받는다 — URL 대안은 gh가 --repo를 덮는다', () => {
    const [input] = contract('pr.view').inputPorts;
    expect(input).toMatchObject({ id: 'pull_request', type: 'pull_request', cardinality: 'one', required: false, slot: { kind: 'positional', index: 0, alternative: 'number' } });
    const alternative = input?.conditions.find((condition) => condition.code === 'slot_alternative');
    expect(alternative?.detail).toContain('finder.go:117-120');
    expect(alternative?.detail).toContain('<branch>는 PullRequestRef의 식별자가 아니라');
    expect(input?.conditions.map((condition) => condition.code)).toContain('same_repository');
  });

  it('대안 사유는 그 자리의 실제 대안만 말하고, PR에서 확인한 URL 근거를 다른 무리에 빌려 쓰지 않는다', () => {
    const detailOf = (id: string): string => contract(id).inputPorts[0]?.conditions.find((condition) => condition.code === 'slot_alternative')?.detail ?? '';
    expect(detailOf('issue.view')).toContain('<url>는 gh가 URL을 직접 해석해');
    expect(detailOf('issue.view')).not.toMatch(/finder\.go|식별자가 아니라/);
    expect(detailOf('workflow.view')).toContain('<workflow-name> · <filename>는 WorkflowRef의 식별자가 아니라');
    expect(detailOf('workflow.view')).not.toContain('URL');
    let cited = 0;
    for (const command of leaves) {
      for (const port of command.classification?.result?.inputPorts ?? []) {
        const detail = port.conditions.find((condition) => condition.code === 'slot_alternative')?.detail ?? '';
        const expected = command.path[0] === 'pr' && detail.includes('<url>');
        expect(detail.includes('finder.go'), `${command.id} ← ${port.id}`).toBe(expected);
        if (expected) cited += 1;
      }
    }
    expect(cited).toBe(15);
  });

  it('search prs·search issues는 저장소를 출력 필드에서 읽고, search issues는 --include-prs가 없을 때만 IssueRef다', () => {
    expect(contract('search.prs').outputPorts[0]?.conditions.map((condition) => condition.code)).toEqual(expect.arrayContaining(['repository_from_output']));
    const issues = contract('search.issues').outputPorts[0];
    expect(issues?.conditions).toEqual(expect.arrayContaining([{ code: 'flag_absent', detail: '--include-prs' }]));
  });

  it('pr checks는 식별자가 없어 출력 port가 없고, project는 소유자 자리가 없어 참조가 없다 — 자원 종류는 적되 port를 지어내지 않는다', () => {
    expect(contract('pr.checks')).toMatchObject({ composability: 'terminal_result', resourceKind: null, outputPorts: [] });
    expect(contract('project.view')).toMatchObject({ composability: 'terminal_result', resourceKind: 'project', outputPorts: [], inputPorts: [] });
    expect(contract('project.view').inputPortsNote).toContain('소유자');
  });

  it('출력 URL 참조는 gh 파서 문법이 있는 종류만이다 — release·run·gist URL은 링크일 뿐이다', () => {
    expect(contract('pr.create').outputPorts[0]?.source).toEqual({ adapter: 'resource_url', mode: 'text', grammar: 'pull_request', repository: 'execution_context' });
    expect(contract('issue.transfer').outputPorts[0]?.source).toMatchObject({ repository: 'url' });
    for (const id of ['release.create', 'workflow.run', 'gist.create']) expect(contract(id), id).toMatchObject({ kind: 'url', outputPorts: [], composability: 'terminal_result' });
  });

  it('텍스트·종료 코드·스트림 결과에는 자원 종류를 채우지 않는다 — 표에 근거를 적은 것만 예외다', () => {
    for (const command of leaves) {
      const result = contract(command.id);
      if (!['text', 'exit_status', 'stream'].includes(result.kind)) continue;
      const allowed = command.path.join(' ') in PORTLESS_RESOURCE;
      if (!allowed) expect(result.resourceKind, command.id).toBeNull();
    }
  });

  it('비TTY 관측으로 정정한 주 종류 — 확인 문구가 stderr·TTY에만 있으면 exit_status, comment는 URL이다', () => {
    for (const id of ['pr.close', 'pr.merge', 'pr.ready', 'pr.reopen', 'pr.review', 'issue.close', 'issue.reopen', 'label.create', 'repo.edit']) {
      expect(contract(id).kind, id).toBe('exit_status');
      expect(contract(id).basis.evidence, id).toContain('주 종류:');
    }
    for (const id of ['pr.comment', 'issue.comment', 'discussion.comment']) expect(contract(id), id).toMatchObject({ kind: 'url', resourceKind: null, outputPorts: [] });
  });

  it('이 판에는 fully_bindable·unsupported_by_host가 없다 — gh 결과에는 늘 조건이 있고, 대상 GHES는 확인하지 않았다', () => {
    for (const command of leaves) expect(['fully_bindable', 'unsupported_by_host'], command.id).not.toContain(contract(command.id).composability);
  });
});

describe('composabilityOf — 순서가 규칙이다', () => {
  it('secret > policy_blocked > 출력 port > artifact > text·stream·opaque > terminal', () => {
    const port = contract('pr.list').outputPorts;
    expect(composabilityOf({ sensitivity: 'secret', blocked: true, outputPorts: port, kind: 'json', opaque: false })).toBe('secret_non_bindable');
    expect(composabilityOf({ sensitivity: 'internal', blocked: true, outputPorts: port, kind: 'json', opaque: false })).toBe('policy_blocked');
    expect(composabilityOf({ sensitivity: 'internal', blocked: false, outputPorts: port, kind: 'artifact', opaque: true })).toBe('partially_bindable');
    expect(composabilityOf({ sensitivity: 'internal', blocked: false, outputPorts: [], kind: 'artifact', opaque: true })).toBe('artifact_result');
    expect(composabilityOf({ sensitivity: 'internal', blocked: false, outputPorts: [], kind: 'json', opaque: true })).toBe('opaque_result');
    expect(composabilityOf({ sensitivity: 'internal', blocked: false, outputPorts: [], kind: 'stream', opaque: false })).toBe('opaque_result');
    expect(composabilityOf({ sensitivity: 'sensitive', blocked: false, outputPorts: [], kind: 'json', opaque: false })).toBe('terminal_result');
  });
});
