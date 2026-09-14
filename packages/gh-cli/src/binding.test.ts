/**
 * typed port 호환 판정과 바인딩 평가 (SRS 9.8 4항, FR-GH-005 AC-8, WP-066 DoD, CR-089).
 *
 * port는 **커밋된 manifest의 결과 계약**에서 꺼낸다 — 손으로 지은 port로는 계약이 실제로 그렇게 적혔는지 증명하지 못한다.
 * 위조가 필요한 음성 사례(비밀·opaque 결과에 port를 붙이기)만 계약을 복사해 바꾼다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BINDING_EXECUTION_BLOCKED, evaluateBinding, judgePortCompatibility, type GhPortEndpoint, type GhPortValue } from './binding.js';
import type { GhCapabilityManifest, GhResourceRef } from './types.js';

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../manifest/gh-2.97.0.json', import.meta.url)), 'utf8')) as GhCapabilityManifest;

function endpoint(id: string, direction: 'input' | 'output', portId: string): GhPortEndpoint {
  const contract = manifest.commands.find((command) => command.id === id)?.classification?.result;
  if (contract === null || contract === undefined) throw new Error(`fixture: ${id}에 결과 계약이 없다`);
  const port = (direction === 'output' ? contract.outputPorts : contract.inputPorts).find((one) => one.id === portId);
  if (port === undefined) throw new Error(`fixture: ${id}의 ${direction} port ${portId}가 없다`);
  return { capabilityId: id, contract, port };
}

const HOST = 'ghe.example.com';
const pr = (number: number, repository = 'acme/payments'): GhResourceRef => ({ host: HOST, kind: 'pull_request', repository, id: null, number, ref: null });
const TARGET = { host: HOST, repository: { owner: 'acme', name: 'payments' } } as const;
const listValue = (items: readonly GhResourceRef[]): GhPortValue => ({ status: 'available', port: 'pull_requests', cardinality: 'many', items });
const bind = (select: string, overrides: Partial<{ target: string; targetPort: string }> = {}) => ({
  source: { capabilityId: 'pr.list', port: 'pull_requests' },
  target: { capabilityId: overrides.target ?? 'pr.view', port: overrides.targetPort ?? 'pull_request' },
  select,
});

describe('judgePortCompatibility — 이름이 아니라 타입으로 잇는다', () => {
  it('pr list의 PR 목록 → pr view의 PR 입력은 조건부다: 명시적 선택·JSON 모드·number 선택·같은 저장소·대안 하나', () => {
    const judged = judgePortCompatibility(endpoint('pr.list', 'output', 'pull_requests'), endpoint('pr.view', 'input', 'pull_request'));
    expect(judged.verdict).toBe('conditional');
    expect(judged.reasons).toEqual([]);
    expect(judged.conditions.map((condition) => condition.code).sort()).toEqual(['explicit_selection', 'json_fields_selected', 'output_mode', 'same_repository', 'slot_alternative']);
    expect(judged.conditions.find((condition) => condition.code === 'json_fields_selected')?.detail).toBe('number');
  });

  it('단일 → 단일은 명시적 선택 조건이 없다 (pr view → pr checks)', () => {
    const judged = judgePortCompatibility(endpoint('pr.view', 'output', 'pull_request'), endpoint('pr.checks', 'input', 'pull_request'));
    expect(judged.verdict).toBe('conditional');
    expect(judged.conditions.map((condition) => condition.code)).not.toContain('explicit_selection');
  });

  it('IssueRef → PullRequestRef는 같은 번호 공간이어도 불가다 (issue view는 issueOrPullRequest로 찾는다)', () => {
    const judged = judgePortCompatibility(endpoint('issue.view', 'output', 'issue'), endpoint('pr.view', 'input', 'pull_request'));
    expect(judged).toMatchObject({ verdict: 'incompatible', reasons: [{ code: 'type_mismatch', detail: 'IssueRef → PullRequestRef' }] });
  });

  it('SRS 9.8 예시의 정정 — run list의 WorkflowRunRef 목록은 run rerun에 이어지고, pr checks에는 출력 port가 없다', () => {
    expect(judgePortCompatibility(endpoint('run.list', 'output', 'workflow_runs'), endpoint('run.rerun', 'input', 'workflow_run')).verdict).toBe('conditional');
    const checks = manifest.commands.find((command) => command.id === 'pr.checks')?.classification?.result;
    expect(checks?.outputPorts).toEqual([]);
    expect(checks?.outputPortsNote).toContain('식별자가 없다');
  });

  it('목록 → 목록은 불가다 — 묵시적 fan-out을 만들지 않는다 (issue list → issue edit)', () => {
    const judged = judgePortCompatibility(endpoint('issue.list', 'output', 'issues'), endpoint('issue.edit', 'input', 'issues'));
    expect(judged).toMatchObject({ verdict: 'incompatible', reasons: [{ code: 'list_to_list' }] });
  });

  it('단일 → 목록은 한 개짜리 목록 조건이 붙는다 (issue view → issue edit)', () => {
    const judged = judgePortCompatibility(endpoint('issue.view', 'output', 'issue'), endpoint('issue.edit', 'input', 'issues'));
    expect(judged.verdict).toBe('conditional');
    expect(judged.conditions.map((condition) => condition.code)).toContain('single_value_as_list');
  });

  it('비밀·opaque 결과에 port를 붙여도(위조) 불가다', () => {
    const view = endpoint('pr.view', 'output', 'pull_request');
    const token = manifest.commands.find((command) => command.id === 'auth.token')?.classification?.result;
    const api = manifest.commands.find((command) => command.id === 'api')?.classification?.result;
    if (token === null || token === undefined || api === null || api === undefined) throw new Error('fixture');
    const forgedSecret: GhPortEndpoint = { capabilityId: 'auth.token', contract: { ...token, outputPorts: [view.port] }, port: { ...view.port, sensitivity: 'secret' } };
    expect(judgePortCompatibility(forgedSecret, endpoint('pr.checks', 'input', 'pull_request')).reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(['secret_source', 'source_not_bindable']));
    const forgedOpaque: GhPortEndpoint = { capabilityId: 'api', contract: { ...api, outputPorts: [view.port] }, port: view.port };
    expect(judgePortCompatibility(forgedOpaque, endpoint('pr.checks', 'input', 'pull_request')).reasons.map((reason) => reason.code)).toEqual(['source_not_bindable']);
  });

  it('입력 port를 출력으로 쓰면 불가다', () => {
    expect(judgePortCompatibility(endpoint('pr.view', 'input', 'pull_request'), endpoint('pr.checks', 'input', 'pull_request')).reasons.map((reason) => reason.code)).toContain('direction');
  });
});

describe('evaluateBinding — 명시적 선택만, 보정 없음', () => {
  const source = endpoint('pr.list', 'output', 'pull_requests');
  const target = endpoint('pr.view', 'input', 'pull_request');

  it('PR 목록에서 `/1`로 고르면 두 번째 PR이 pr view의 number 자리에 들어간다 — 그래도 실행은 열리지 않는다', () => {
    const outcome = evaluateBinding({ binding: bind('/1'), source, target, value: listValue([pr(12), pr(11)]), targetContext: TARGET });
    expect(outcome).toEqual({
      ok: true,
      ref: pr(11),
      argument: { slot: { kind: 'positional', index: 0, placeholder: '<number> | <url> | <branch>', alternative: 'number' }, value: '11' },
      conditions: expect.any(Array) as unknown,
      executable: false,
      executionBlockedReason: BINDING_EXECUTION_BLOCKED,
    });
  });

  it('선택 없이 목록을 단일 입력에 이으면 거절한다 — 첫 원소를 자동으로 고르지 않는다', () => {
    expect(evaluateBinding({ binding: bind(''), source, target, value: listValue([pr(12)]), targetContext: TARGET })).toMatchObject({ ok: false, reason: 'explicit_selection_required' });
  });

  it('없는·틀린 포인터와 참조가 아닌 값은 거절한다', () => {
    const value = listValue([pr(12), pr(11)]);
    expect(evaluateBinding({ binding: bind('/2'), source, target, value, targetContext: TARGET })).toMatchObject({ ok: false, reason: 'selection_invalid', detail: 'index_out_of_range (2)' });
    expect(evaluateBinding({ binding: bind('/-'), source, target, value, targetContext: TARGET })).toMatchObject({ ok: false, reason: 'selection_invalid' });
    expect(evaluateBinding({ binding: bind('/01'), source, target, value, targetContext: TARGET })).toMatchObject({ ok: false, reason: 'selection_invalid' });
    expect(evaluateBinding({ binding: bind('/0/__proto__'), source, target, value, targetContext: TARGET })).toMatchObject({ ok: false, reason: 'selection_invalid' });
    expect(evaluateBinding({ binding: bind('/0/number'), source, target, value, targetContext: TARGET })).toMatchObject({ ok: false, reason: 'selection_not_a_reference' });
  });

  it('식별 필드를 고르지 않은 결과는 참조가 없다 — 바인딩이 실패한다', () => {
    const value: GhPortValue = { status: 'unavailable', port: 'pull_requests', reason: 'identity_field_not_selected' };
    expect(evaluateBinding({ binding: bind('/0'), source, target, value, targetContext: TARGET })).toEqual({ ok: false, reason: 'value_unavailable', detail: 'identity_field_not_selected' });
  });

  it('목록에 섞인 issue 참조는 PR 입력에 들어가지 않는다 — 같은 번호라도 종류가 다르다', () => {
    const issue: GhResourceRef = { ...pr(12), kind: 'issue' };
    expect(evaluateBinding({ binding: bind('/0'), source, target, value: listValue([issue]), targetContext: TARGET })).toMatchObject({ ok: false, reason: 'selection_not_a_reference', detail: expect.stringContaining('kind_mismatch') as unknown });
  });

  it('다른 호스트·다른 저장소의 참조는 거절한다', () => {
    expect(evaluateBinding({ binding: bind('/0'), source, target, value: listValue([pr(12)]), targetContext: { host: 'other.example.com', repository: TARGET.repository } })).toMatchObject({ ok: false, reason: 'host_mismatch' });
    expect(evaluateBinding({ binding: bind('/0'), source, target, value: listValue([pr(12, 'acme/other')]), targetContext: TARGET })).toMatchObject({ ok: false, reason: 'repository_mismatch' });
    expect(evaluateBinding({ binding: bind('/0'), source, target, value: listValue([pr(12)]), targetContext: { host: HOST, repository: null } })).toMatchObject({ ok: false, reason: 'repository_missing' });
  });

  it('연결이 가리키는 도착과 넘겨준 endpoint가 다르면 거절한다', () => {
    expect(evaluateBinding({ binding: bind('/0', { target: 'pr.checks' }), source, target, value: listValue([pr(12)]), targetContext: TARGET })).toMatchObject({ ok: false, reason: 'endpoint_mismatch' });
  });

  it('값의 개수가 출력 port 계약과 다르면 거절한다 — 단일 port(pr view)의 값을 목록으로 넘겨 선택을 끼워 넣지 못한다', () => {
    const view = endpoint('pr.view', 'output', 'pull_request');
    const checks = endpoint('pr.checks', 'input', 'pull_request');
    // 판정기는 단일 → 단일이라 명시적 선택 조건을 붙이지 않는다. 값만 목록으로 바꿔 `/1`을 끼워 넣는 위조다.
    expect(judgePortCompatibility(view, checks).conditions.map((condition) => condition.code)).not.toContain('explicit_selection');
    const forged: GhPortValue = { status: 'available', port: 'pull_request', cardinality: 'many', items: [pr(12), pr(11)] };
    const binding = { source: { capabilityId: 'pr.view', port: 'pull_request' }, target: { capabilityId: 'pr.checks', port: 'pull_request' }, select: '/1' };
    expect(evaluateBinding({ binding, source: view, target: checks, value: forged, targetContext: TARGET })).toMatchObject({ ok: false, reason: 'endpoint_mismatch', detail: expect.stringContaining('many') as unknown });
  });

  it('null인 단일 값은 거절한다 (pr status의 currentBranch — 실행기에는 작업 트리가 없다)', () => {
    const current = endpoint('pr.status', 'output', 'current_branch');
    const value: GhPortValue = { status: 'available', port: 'current_branch', cardinality: 'one', item: null };
    const binding = { source: { capabilityId: 'pr.status', port: 'current_branch' }, target: { capabilityId: 'pr.view', port: 'pull_request' }, select: '' };
    expect(evaluateBinding({ binding, source: current, target, value, targetContext: TARGET })).toMatchObject({ ok: false, reason: 'null_value' });
  });

  it('타입이 다르면 값이 맞아도 평가 전에 거절한다', () => {
    const issueView = endpoint('issue.view', 'output', 'issue');
    const value: GhPortValue = { status: 'available', port: 'issue', cardinality: 'one', item: { ...pr(12), kind: 'issue' } };
    const binding = { source: { capabilityId: 'issue.view', port: 'issue' }, target: { capabilityId: 'pr.view', port: 'pull_request' }, select: '' };
    expect(evaluateBinding({ binding, source: issueView, target, value, targetContext: TARGET })).toMatchObject({ ok: false, reason: 'incompatible' });
  });
});

describe('표현식 해석기·부작용 없음 (WP-066 DoD 코드 검사)', () => {
  it('바인딩·포인터·참조·그래프 모듈에 eval·Function·임의 표현식 엔진·I/O import가 없다', () => {
    for (const file of ['binding.ts', 'json-pointer.ts', 'resource-ref.ts', 'graph.ts']) {
      const source = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(source, file).not.toMatch(/\beval\s*\(/);
      expect(source, file).not.toMatch(/\bnew\s+Function\b|\bFunction\s*\(/);
      expect(source, file).not.toMatch(/from\s+'node:|require\(|\bfetch\s*\(|jsonpath|jmespath|\bjq\b/i);
    }
  });
});
