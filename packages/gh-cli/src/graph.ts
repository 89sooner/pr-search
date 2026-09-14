/**
 * 타입 기반 capability 그래프 (SRS 9.8 5항 `GhCapabilityGraph`, FR-GH-001 AC-12, CR-089).
 *
 * node = leaf command, edge = 출력 port → **판정기가 호환이라고 답한** 입력 port. 특정 간선을 코드에 적지 않는다 —
 * 모든 출력 port와 입력 port의 짝을 `judgePortCompatibility`로 판정한 결과가 곧 그래프다.
 *
 * **정적 연결 후보이지 실행 가능한 Recipe DAG가 아니다.** 순환 후보(`pr view` → `pr view`)가 있어도 그것으로 실행이
 * 생기지 않는다. 간선마다 양쪽 command의 실행 상태와 `executable: false`를 싣는다 — 이 판에서 다단계 실행은 0이다.
 */

import { BINDING_EXECUTION_BLOCKED, judgePortCompatibility, type GhIncompatibility } from './binding.js';
import type { GhExecutionStatus, GhManifestCommand, GhPortCondition, GhResourceKind } from './types.js';

export interface GhGraphEdge {
  readonly from: string;
  readonly fromPort: string;
  readonly to: string;
  readonly toPort: string;
  readonly type: GhResourceKind;
  readonly verdict: 'direct' | 'conditional';
  readonly conditions: readonly GhPortCondition[];
  readonly execution: {
    readonly from: GhExecutionStatus;
    readonly to: GhExecutionStatus;
    readonly executable: false;
    readonly reason: string;
  };
}

/** 타입은 같지만 판정기가 불가라고 답한 짝 — 「왜 이어지지 않는가」를 화면이 말할 수 있게 둔다. */
export interface GhGraphBlockedPair {
  readonly from: string;
  readonly fromPort: string;
  readonly to: string;
  readonly toPort: string;
  readonly type: GhResourceKind;
  readonly reasons: readonly GhIncompatibility[];
}

export interface GhGraphSummary {
  readonly nodes: number;
  readonly outputPorts: number;
  readonly inputPorts: number;
  readonly edges: number;
  readonly direct: number;
  readonly conditional: number;
  readonly blockedSameType: number;
  readonly byType: readonly { readonly type: GhResourceKind; readonly edges: number }[];
  /** 실제로 실행 가능한 다단계 흐름 — 이 판은 0이다. */
  readonly executableFlows: 0;
}

export interface GhCapabilityGraph {
  readonly edges: readonly GhGraphEdge[];
  readonly blocked: readonly GhGraphBlockedPair[];
  readonly summary: GhGraphSummary;
}

export function computeCapabilityGraph(commands: readonly GhManifestCommand[]): GhCapabilityGraph {
  const leaves = commands.filter((command) => !command.group && command.aliasOf === null && command.classification?.result !== null && command.classification?.result !== undefined);
  const outputs = leaves.flatMap((command) => (command.classification?.result?.outputPorts ?? []).map((port) => ({ command, port })));
  const inputs = leaves.flatMap((command) => (command.classification?.result?.inputPorts ?? []).map((port) => ({ command, port })));

  const edges: GhGraphEdge[] = [];
  const blocked: GhGraphBlockedPair[] = [];
  for (const output of outputs) {
    const sourceContract = output.command.classification?.result;
    if (sourceContract === undefined || sourceContract === null) continue;
    for (const input of inputs) {
      const targetContract = input.command.classification?.result;
      if (targetContract === undefined || targetContract === null) continue;
      const judged = judgePortCompatibility(
        { capabilityId: output.command.id, contract: sourceContract, port: output.port },
        { capabilityId: input.command.id, contract: targetContract, port: input.port },
      );
      if (judged.verdict === 'incompatible') {
        if (output.port.type === input.port.type) {
          blocked.push({ from: output.command.id, fromPort: output.port.id, to: input.command.id, toPort: input.port.id, type: output.port.type, reasons: judged.reasons });
        }
        continue;
      }
      edges.push({
        from: output.command.id,
        fromPort: output.port.id,
        to: input.command.id,
        toPort: input.port.id,
        type: output.port.type,
        verdict: judged.verdict,
        conditions: judged.conditions,
        execution: {
          from: output.command.execution,
          to: input.command.execution,
          executable: false,
          reason: input.command.execution === 'allowed' ? BINDING_EXECUTION_BLOCKED : `입력 쪽 command의 실행이 열리지 않았다(${input.command.execution}) · ${BINDING_EXECUTION_BLOCKED}`,
        },
      });
    }
  }

  const byTypeCounts = new Map<GhResourceKind, number>();
  for (const edge of edges) byTypeCounts.set(edge.type, (byTypeCounts.get(edge.type) ?? 0) + 1);
  return {
    edges,
    blocked,
    summary: {
      nodes: leaves.length,
      outputPorts: outputs.length,
      inputPorts: inputs.length,
      edges: edges.length,
      direct: edges.filter((edge) => edge.verdict === 'direct').length,
      conditional: edges.filter((edge) => edge.verdict === 'conditional').length,
      blockedSameType: blocked.length,
      // 삽입 순서(manifest 순서)를 유지한다 — 로케일 정렬을 쓰지 않는다 (DEV-681).
      byType: [...byTypeCounts.entries()].map(([type, count]) => ({ type, edges: count })),
      executableFlows: 0,
    },
  };
}
