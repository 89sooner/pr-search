/**
 * 타입 기반 capability 그래프 (SRS 9.8 5항, FR-GH-001 AC-12, CR-089).
 *
 * 그래프의 간선은 **판정기의 답과 정확히 같아야 한다** — 모든 출력 port와 입력 port의 짝을 판정기로 다시 판정해 간선
 * 집합과 대조한다. 특정 간선을 코드에 적은 것이 아님을 소스 검사로도 건다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { judgePortCompatibility } from './binding.js';
import { computeCapabilityGraph } from './graph.js';
import type { GhCapabilityManifest, GhManifestCommand } from './types.js';

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../manifest/gh-2.97.0.json', import.meta.url)), 'utf8')) as GhCapabilityManifest;
const graph = computeCapabilityGraph(manifest.commands);
const key = (edge: { from: string; fromPort: string; to: string; toPort: string }): string => `${edge.from}.${edge.fromPort}->${edge.to}.${edge.toPort}`;

describe('간선 = 판정기의 답', () => {
  it('모든 출력·입력 port 짝을 다시 판정하면 간선·불가 짝과 정확히 같다', () => {
    const leaves = manifest.commands.filter((command) => !command.group && command.aliasOf === null && command.classification?.result);
    const expectedEdges = new Set<string>();
    const expectedBlocked = new Set<string>();
    let pairs = 0;
    for (const source of leaves) {
      for (const outPort of source.classification?.result?.outputPorts ?? []) {
        for (const target of leaves) {
          for (const inPort of target.classification?.result?.inputPorts ?? []) {
            pairs += 1;
            const judged = judgePortCompatibility(
              { capabilityId: source.id, contract: source.classification!.result!, port: outPort },
              { capabilityId: target.id, contract: target.classification!.result!, port: inPort },
            );
            const id = key({ from: source.id, fromPort: outPort.id, to: target.id, toPort: inPort.id });
            if (judged.verdict !== 'incompatible') expectedEdges.add(id);
            else if (outPort.type === inPort.type) expectedBlocked.add(id);
            else expect(judged.reasons.map((reason) => reason.code), id).toContain('type_mismatch');
          }
        }
      }
    }
    expect(pairs).toBe(graph.summary.outputPorts * graph.summary.inputPorts);
    expect(new Set(graph.edges.map(key))).toEqual(expectedEdges);
    expect(new Set(graph.blocked.map(key))).toEqual(expectedBlocked);
  });

  it('요약은 간선에서 센 값과 같고, 모든 간선은 실행 불가이며 다단계 흐름은 0이다', () => {
    expect(graph.summary.edges).toBe(graph.edges.length);
    expect(graph.summary.conditional + graph.summary.direct).toBe(graph.edges.length);
    expect(graph.summary.byType.reduce((sum, entry) => sum + entry.edges, 0)).toBe(graph.edges.length);
    expect(graph.edges.every((edge) => edge.execution.executable === false)).toBe(true);
    expect(graph.summary.executableFlows).toBe(0);
    for (const edge of graph.edges) expect(edge.type, key(edge)).toBeTruthy();
  });

  it('pr list → pr view 간선이 조건과 함께 있고, 입력 쪽 실행이 열리지 않았다는 이유를 싣는다', () => {
    const edge = graph.edges.find((one) => one.from === 'pr.list' && one.to === 'pr.view');
    expect(edge).toMatchObject({ fromPort: 'pull_requests', toPort: 'pull_request', type: 'pull_request', verdict: 'conditional', execution: { from: 'allowed', to: 'not_implemented', executable: false } });
    expect(edge?.conditions.map((condition) => condition.code)).toContain('explicit_selection');
    expect(edge?.execution.reason).toContain('not_implemented');
  });

  it('pr checks에서 나가는 간선은 없고 run rerun으로 들어오는 간선은 run list·run view에서만 온다', () => {
    expect(graph.edges.filter((edge) => edge.from === 'pr.checks')).toEqual([]);
    expect(new Set(graph.edges.filter((edge) => edge.to === 'run.rerun').map((edge) => edge.from))).toEqual(new Set(['run.list', 'run.view']));
  });

  it('비밀·정책 차단·opaque·terminal 결과는 간선의 출발이 아니다', () => {
    const byId = new Map(manifest.commands.map((command) => [command.id, command] as const));
    for (const edge of graph.edges) {
      const contract = byId.get(edge.from)?.classification?.result;
      expect(contract?.composability, edge.from).toBe('partially_bindable');
      expect(contract?.sensitivity, edge.from).not.toBe('secret');
    }
  });

  it('결정적이다 — 다시 계산해도 같은 순서·같은 내용이다', () => {
    expect(JSON.stringify(computeCapabilityGraph(manifest.commands))).toBe(JSON.stringify(graph));
  });

  it('입력 port를 없애면 그 간선이 사라진다 — 간선은 계약에서 계산된다', () => {
    const without: GhManifestCommand[] = manifest.commands.map((command) =>
      command.id === 'pr.view' && command.classification?.result
        ? { ...command, classification: { ...command.classification, result: { ...command.classification.result, inputPorts: [] } } }
        : command,
    );
    const mutated = computeCapabilityGraph(without);
    expect(mutated.edges.some((edge) => edge.to === 'pr.view')).toBe(false);
    expect(mutated.edges.length).toBe(graph.edges.length - graph.edges.filter((edge) => edge.to === 'pr.view').length);
  });

  it('그래프 코드에 특정 command 간선이 적혀 있지 않다', () => {
    const source = readFileSync(fileURLToPath(new URL('./graph.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/'pr\.(list|view|checks)'|'run\.(list|rerun)'/);
  });
});
