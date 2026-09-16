/**
 * A-006 순수 판정 (WP-078 / FR-GH-011 AC-3, NFR-009, CR-088).
 *
 * 화면이 수치를 다시 세지 않는다는 것이 규율이므로 여기서 거는 것은 **상태의 뜻**이다 — 기록 없음·
 * 실행기 미검사·지남·드리프트·적재 불일치가 서로 다른 답이어야 한다. 기대값은 손으로 적었다.
 */

import { RESOURCE_KINDS, refTypeName } from '@prs/gh-cli';
import { describe, expect, it } from 'vitest';
import {
  contractVerificationState,
  countBy,
  describeConditions,
  filterCommands,
  isOverdue,
  label,
  percentOf,
  refTypeLabel,
  registryHeadline,
  shortHash,
  statusTone,
  SUPPORT_LABEL,
  type VerificationView,
} from './gh-registry';
import { REGISTRY_STATUS_DRIFT, REGISTRY_STATUS_EMPTY, registryStatus, verification } from './gh-registry-fixtures';
import { CAPABILITIES } from './gh-test-fixtures';

const NOW = new Date('2026-09-14T04:00:00.000Z');

describe('registryHeadline — 없음·미검사·실행기 기록을 가른다', () => {
  it('기록이 없으면 no_records다 — 검증기가 passed여도 0개 정상이 아니다', () => {
    expect(registryHeadline(REGISTRY_STATUS_EMPTY, NOW)).toEqual({ kind: 'no_records', validatorStatus: 'passed' });
  });

  it('실행기 기록이 없고 CI 기록만 있으면 executor_unchecked다', () => {
    const view = registryStatus({ verification: { check_interval_ms: 86_400_000, latest_by_source: [verification({ checked_by: 'ci', status: 'passed' })], recent: [], executor_matches_served_manifest: null } });
    const headline = registryHeadline(view, NOW);
    expect(headline.kind).toBe('executor_unchecked');
    if (headline.kind === 'executor_unchecked') expect(headline.other.checked_by).toBe('ci');
  });

  it('실행기 기록이 있으면 그 상태이며, 주기의 두 배를 넘기면 overdue이고 해시가 다르면 servedMismatch다', () => {
    const fresh = registryHeadline(registryStatus(), NOW);
    expect(fresh).toMatchObject({ kind: 'executor', overdue: false, servedMismatch: false });

    const old = registryStatus({ verification: { check_interval_ms: 86_400_000, latest_by_source: [verification({ checked_at: '2026-09-11T00:00:00.000Z' })], recent: [], executor_matches_served_manifest: true } });
    expect(registryHeadline(old, NOW)).toMatchObject({ kind: 'executor', overdue: true });

    const mismatch = registryStatus({ verification: { check_interval_ms: 86_400_000, latest_by_source: [verification({ matches_served_manifest: false })], recent: [], executor_matches_served_manifest: false } });
    expect(registryHeadline(mismatch, NOW)).toMatchObject({ kind: 'executor', servedMismatch: true });

    const drift = registryHeadline(REGISTRY_STATUS_DRIFT, NOW);
    expect(drift.kind).toBe('executor');
    if (drift.kind === 'executor') expect(drift.latest.status).toBe('drift');
  });
});

describe('보조 판정', () => {
  it('isOverdue는 주기의 두 배가 기준이고 읽을 수 없는 시각은 지난 것으로 본다', () => {
    expect(isOverdue('2026-09-14T03:00:00.000Z', 86_400_000, NOW)).toBe(false);
    expect(isOverdue('2026-09-11T03:00:00.000Z', 86_400_000, NOW)).toBe(true);
    expect(isOverdue('not-a-date', 86_400_000, NOW)).toBe(true);
  });

  it('statusTone은 서버 상태를 옮기기만 한다', () => {
    expect(statusTone('passed')).toBe('success');
    expect(statusTone('incomplete')).toBe('warning');
    for (const status of ['drift', 'failed', 'error']) expect(statusTone(status), status).toBe('danger');
    expect(statusTone('unchecked')).toBe('neutral');
  });

  it('percentOf는 분모 0을 백분율로 그리지 않는다', () => {
    expect(percentOf({ total: 196, classified: 196 })).toBe('100%');
    expect(percentOf({ total: 196, classified: 1 })).toBe('0.5%');
    expect(percentOf({ total: 0, classified: 0 })).toBe('n/a');
  });

  it('label은 모르는 값을 그대로 보이고 null은 대시다', () => {
    expect(label(SUPPORT_LABEL, 'supported')).toBe("Supported");
    expect(label(SUPPORT_LABEL, 'mystery')).toBe('mystery');
    expect(label(SUPPORT_LABEL, null)).toBe('—');
    expect(shortHash('abcdef0123456789abcdef')).toBe('abcdef012345…');
    expect(shortHash(null)).toBe('—');
  });
});

describe('command 탐색', () => {
  it('검색어·지원 상태·실행 상태로 거른다', () => {
    const all = CAPABILITIES.commands;
    expect(filterCommands(all, { query: '', support: 'all', execution: 'all' })).toHaveLength(all.length);
    expect(filterCommands(all, { query: 'merge', support: 'all', execution: 'all' }).map((one) => one.id)).toEqual(['pr.merge']);
    expect(filterCommands(all, { query: '', support: 'all', execution: 'allowed' }).map((one) => one.id)).toEqual(['pr.list']);
    expect(filterCommands(all, { query: '', support: 'unknown', execution: 'all' }).map((one) => one.id)).toEqual(['pr.merge']);
    expect(filterCommands(all, { query: 'Check out', support: 'all', execution: 'all' }).map((one) => one.id)).toEqual(['pr.checkout']);
  });

  it('countBy는 많은 순으로 센다', () => {
    const counts = countBy(CAPABILITIES.commands, (command) => command.support);
    expect(counts[0]).toEqual({ value: 'supported', count: 2 });
    expect(counts.map((one) => one.value)).toEqual(['supported', 'unknown', 'unsupported_by_host']);
  });
});

describe('결과 계약 표시 (CR-089)', () => {
  it('refTypeLabel은 자원 종류 15개 전부에서 서버의 refTypeName과 같고, 자원 결과가 아니면 그렇게 말한다', () => {
    const kinds = [...RESOURCE_KINDS];
    expect(kinds).toHaveLength(15);
    for (const kind of kinds) expect(refTypeLabel(kind), kind).toBe(refTypeName(kind));
    expect(refTypeLabel('pull_request')).toBe('PullRequestRef');
    expect(refTypeLabel('workflow_run')).toBe('WorkflowRunRef');
    expect(refTypeLabel(null)).toBe("Not a resource result");
  });

  it('검증 기록의 보고서 판: r2는 verified, r1은 legacy, 판을 모르는 옛 응답은 unknown이다 — 옛 기록을 통과로 다시 읽지 않는다', () => {
    expect(contractVerificationState(verification())).toBe('verified');
    expect(contractVerificationState(verification({ status: 'passed', report_version: 'r1', contract_dimensions: 'not_in_report_version' }))).toBe('legacy');
    const old: { -readonly [K in keyof VerificationView]?: VerificationView[K] } = verification();
    delete old.report_version;
    delete old.contract_dimensions;
    expect(contractVerificationState(old as VerificationView)).toBe('unknown');
  });

  it('describeConditions: 조건이 없으면 「없음」(직접 호환)이고, 있으면 라벨과 세부를 순서대로 잇는다 — 모르는 코드는 그대로 보인다', () => {
    expect(describeConditions([])).toBe("None");
    expect(
      describeConditions([
        { code: 'explicit_selection', detail: '/0' },
        { code: 'mystery', detail: 'x' },
      ]),
    ).toBe("Explicit item selection: /0 · mystery: x");
  });
});
