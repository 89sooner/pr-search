/**
 * A-006 픽스처 드리프트 가드 (CR-089).
 *
 * 픽스처는 손으로 적은 리터럴이지만 값은 커밋된 manifest(r0.3)의 실측이어야 한다 — 목이 응답을 지어내면 화면 시험이
 * 계약 버그를 숨긴다. manifest를 직접 읽어 제품과 같은 함수(검증기·그래프)로 다시 계산하고, 픽스처가 옮긴 값과 대조한다.
 * 픽스처가 일부만 싣는 자리(차원·간선)는 「부분집합이고 값이 같다」를 건다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeCapabilityGraph, validateManifest, type GhCapabilityManifest } from '@prs/gh-cli';
import { describe, expect, it } from 'vitest';
import { COMMAND_DETAIL_AUTH_TOKEN, COMMAND_DETAIL_PR_LIST, CONTRACTS, DIMENSIONS, registryStatus } from './gh-registry-fixtures';

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../../packages/gh-cli/manifest/gh-2.97.0.json', import.meta.url)), 'utf8')) as GhCapabilityManifest;
const report = validateManifest(manifest);
const graph = computeCapabilityGraph(manifest.commands);
const classificationOf = (id: string) => manifest.commands.find((command) => command.id === id)?.classification;

describe('A-006 픽스처는 커밋된 manifest의 실측이다 (CR-089)', () => {
  it('결과 계약·연결 요약은 검증기가 낸 contracts와 같다', () => {
    expect(CONTRACTS).toEqual(report.contracts);
  });

  it('차원은 검증기 차원의 부분집합이고 라벨·게이트·분모·분자·미분류 표본이 같다', () => {
    const byId = new Map(report.dimensions.map((dimension) => [dimension.id, dimension]));
    for (const dimension of DIMENSIONS) {
      const real = byId.get(dimension.id);
      expect(real, dimension.id).toBeDefined();
      expect([dimension.label, dimension.gate, dimension.total, dimension.classified, dimension.unclassified], dimension.id).toEqual([real?.label, real?.gate, real?.total, real?.classified, real?.unclassified]);
      for (const sample of dimension.unclassifiedSample) expect(real?.unclassifiedSample, dimension.id).toContain(sample);
    }
  });

  it('게이트 판정·01d 차원 목록·검증기 상태가 같다', () => {
    const status = registryStatus();
    expect(status.validator.status).toBe(report.status);
    expect(status.gates.map((gate) => [gate.id, gate.pass])).toEqual(report.gates.map((gate) => [gate.id, gate.pass]));
    expect(status.gates.find((gate) => gate.id === 'GATE-GH-01d')?.dimensions).toEqual(report.gates.find((gate) => gate.id === 'GATE-GH-01d')?.dimensions);
  });

  it('pr.list·auth.token의 결과 계약·출력 모드·주 종류·민감도는 manifest의 것과 같다', () => {
    for (const detail of [COMMAND_DETAIL_PR_LIST, COMMAND_DETAIL_AUTH_TOKEN]) {
      const real = classificationOf(detail.id);
      expect(detail.result_contract, detail.id).toEqual(real?.result);
      expect(detail.classification?.io.outputFormats, detail.id).toEqual(real?.io.outputFormats);
      expect(detail.classification?.resultKind, detail.id).toBe(real?.resultKind);
      expect(detail.classification?.sensitivity, detail.id).toBe(real?.sensitivity);
    }
  });

  it('픽스처의 간선·불가 짝은 그래프의 부분집합이고 값이 같다 — 실행 가능한 간선은 없다', () => {
    for (const detail of [COMMAND_DETAIL_PR_LIST, COMMAND_DETAIL_AUTH_TOKEN]) {
      for (const edge of [...(detail.graph?.outgoing ?? []), ...(detail.graph?.incoming ?? [])]) {
        expect(graph.edges, `${edge.from} → ${edge.to}`).toContainEqual(edge);
        expect(edge.execution.executable).toBe(false);
      }
      for (const pair of detail.graph?.blocked ?? []) expect(graph.blocked).toContainEqual(pair);
    }
    expect(COMMAND_DETAIL_PR_LIST.graph?.outgoing.length).toBeGreaterThan(0);
  });
});
