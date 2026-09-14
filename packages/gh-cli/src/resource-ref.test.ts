/**
 * 자원 참조의 식별 규칙과 출력 URL 해석 (SRS 9.8 3항, ADR-020, CR-089).
 *
 * 같은 숫자의 issue·PR·workflow run이 같은 참조로 읽히지 않는가, 출력 URL이 실행 컨텍스트를 덮지 않는가를 건다.
 * 기대값은 손으로 적었다.
 */

import { describe, expect, it } from 'vitest';
import { refFromOutputUrl, refTypeName, validateResourceRef } from './resource-ref.js';

const HOST = 'ghe.example.com';
const ref = (overrides: Record<string, unknown>) => ({ host: HOST, kind: 'pull_request', repository: 'acme/payments', id: null, number: 12, ref: null, ...overrides });
const CONTEXT = { host: HOST, repository: { owner: 'acme', name: 'payments' } } as const;

describe('validateResourceRef — 종류마다 채울 자리가 정해져 있다', () => {
  it('종류별 정상 참조', () => {
    expect(validateResourceRef(ref({})).ok).toBe(true);
    expect(validateResourceRef(ref({ kind: 'issue', number: 3 })).ok).toBe(true);
    expect(validateResourceRef(ref({ kind: 'discussion', number: 4 })).ok).toBe(true);
    expect(validateResourceRef(ref({ kind: 'workflow_run', number: null, id: '123456789' })).ok).toBe(true);
    expect(validateResourceRef(ref({ kind: 'workflow', number: null, id: '42' })).ok).toBe(true);
    expect(validateResourceRef(ref({ kind: 'release', number: null, ref: 'v1.2.3' })).ok).toBe(true);
    expect(validateResourceRef(ref({ kind: 'branch', number: null, ref: 'feature/x' })).ok).toBe(true);
    expect(validateResourceRef(ref({ kind: 'commit', number: null, ref: 'a'.repeat(40) })).ok).toBe(true);
    expect(validateResourceRef(ref({ kind: 'repository', number: null })).ok).toBe(true);
    expect(validateResourceRef(ref({ kind: 'codespace', repository: null, number: null, id: 'monalisa-app-abc123' })).ok).toBe(true);
    expect(validateResourceRef({ ...ref({}), host: '127.0.0.1:48443' }).ok).toBe(true);
  });

  it('모양이 틀리면 거절한다 — 키가 더 있거나 빠지거나 객체가 아니다', () => {
    expect(validateResourceRef({ ...ref({}), extra: 1 })).toEqual({ ok: false, problem: 'shape' });
    const { ref: _omitted, ...missing } = ref({});
    void _omitted;
    expect(validateResourceRef(missing)).toEqual({ ok: false, problem: 'shape' });
    expect(validateResourceRef([ref({})])).toEqual({ ok: false, problem: 'shape' });
    expect(validateResourceRef('acme/payments#12')).toEqual({ ok: false, problem: 'shape' });
  });

  it('같은 번호라도 종류가 다르면 다른 참조다 — 기대한 종류와 다르면 거절한다', () => {
    expect(validateResourceRef(ref({ kind: 'issue' }), 'pull_request')).toEqual({ ok: false, problem: 'kind_mismatch' });
    expect(validateResourceRef(ref({}), 'issue')).toEqual({ ok: false, problem: 'kind_mismatch' });
    expect(validateResourceRef(ref({ kind: 'check_run' }))).toEqual({ ok: false, problem: 'kind' });
  });

  it('식별 규칙이 없는 종류(project·gist·user·team·artifact)는 참조가 되지 않는다', () => {
    for (const kind of ['project', 'gist', 'user', 'team', 'artifact']) {
      expect(validateResourceRef(ref({ kind })), kind).toEqual({ ok: false, problem: 'kind_without_identity_rule' });
    }
  });

  it('식별 값이 규칙에 맞지 않으면 거절한다 — 0·음수·소수·문자열 번호, 선행 0 ID, 짧은 SHA, 하이픈·제어 문자 이름', () => {
    for (const number of [0, -1, 1.5, '12', null, 2 ** 53]) expect(validateResourceRef(ref({ number })), String(number)).toEqual({ ok: false, problem: 'number' });
    for (const id of ['012', '0', '1a', 7, null]) expect(validateResourceRef(ref({ kind: 'workflow_run', number: null, id })), String(id)).toEqual({ ok: false, problem: 'id' });
    for (const value of ['-rf', '', 'a b', 'bell\u0007', 'tab\t', 'del\u007f', 'x'.repeat(256)]) {
      expect(validateResourceRef(ref({ kind: 'release', number: null, ref: value })), JSON.stringify(value)).toEqual({ ok: false, problem: 'ref' });
    }
    expect(validateResourceRef(ref({ kind: 'commit', number: null, ref: 'abc1234' }))).toEqual({ ok: false, problem: 'ref' });
  });

  it('종류가 쓰지 않는 자리가 채워지면 거절한다 — PR 참조에 id를, run 참조에 number를 섞지 않는다', () => {
    expect(validateResourceRef(ref({ id: 'PR_kwDO' }))).toEqual({ ok: false, problem: 'unexpected_identity' });
    expect(validateResourceRef(ref({ kind: 'workflow_run', id: '5', number: 5 }))).toEqual({ ok: false, problem: 'unexpected_identity' });
  });

  it('저장소에 속한 자원은 저장소가 있어야 하고 호스트는 호스트 형식이어야 한다', () => {
    expect(validateResourceRef(ref({ repository: null }))).toEqual({ ok: false, problem: 'repository' });
    expect(validateResourceRef(ref({ repository: 'acme' }))).toEqual({ ok: false, problem: 'repository' });
    expect(validateResourceRef(ref({ repository: '-x/y' }))).toEqual({ ok: false, problem: 'repository' });
    for (const host of ['', 'ghe example.com', 'https://ghe.example.com', 'ghe.example.com/x']) {
      expect(validateResourceRef({ ...ref({}), host }), host).toEqual({ ok: false, problem: 'host' });
    }
  });

  it('타입 이름', () => {
    expect(refTypeName('pull_request')).toBe('PullRequestRef');
    expect(refTypeName('workflow_run')).toBe('WorkflowRunRef');
    expect(refTypeName('repository')).toBe('RepositoryRef');
  });
});

describe('refFromOutputUrl — 출력 URL은 컨텍스트와 같을 때만 참조가 된다', () => {
  it('pr create가 찍은 URL은 PR 참조가 되고, 저장소는 URL이 아니라 컨텍스트의 표기다', () => {
    expect(refFromOutputUrl('https://ghe.example.com/ACME/Payments/pull/77', 'pull_request', CONTEXT, 'execution_context')).toEqual({
      ok: true,
      ref: { host: HOST, kind: 'pull_request', repository: 'acme/payments', id: null, number: 77, ref: null },
    });
  });

  it('다른 호스트·다른 저장소의 URL은 참조가 되지 않는다 — URL이 컨텍스트를 덮지 않는다', () => {
    expect(refFromOutputUrl('https://github.com/acme/payments/pull/77', 'pull_request', CONTEXT, 'execution_context')).toEqual({ ok: false, problem: 'host_mismatch' });
    expect(refFromOutputUrl('https://ghe.example.com/acme/other/pull/77', 'pull_request', CONTEXT, 'execution_context')).toEqual({ ok: false, problem: 'repository_mismatch' });
    expect(refFromOutputUrl('https://ghe.example.com/acme/payments/pull/77', 'pull_request', { host: HOST, repository: null }, 'execution_context')).toEqual({ ok: false, problem: 'repository_missing' });
  });

  it('결과가 본래 다른 저장소에 생기는 command(이관·포크)는 저장소를 URL에서 읽되 호스트는 대조한다', () => {
    expect(refFromOutputUrl('https://ghe.example.com/acme/archive/issues/5', 'issue', CONTEXT, 'url')).toEqual({ ok: true, ref: { host: HOST, kind: 'issue', repository: 'acme/archive', id: null, number: 5, ref: null } });
    expect(refFromOutputUrl('https://ghe.example.com/alice/payments', 'repository', CONTEXT, 'url')).toEqual({ ok: true, ref: { host: HOST, kind: 'repository', repository: 'alice/payments', id: null, number: null, ref: null } });
    expect(refFromOutputUrl('https://other.example.com/alice/payments', 'repository', CONTEXT, 'url')).toEqual({ ok: false, problem: 'host_mismatch' });
  });

  it('comment 조각·쿼리·꼬리·다른 경로 문법은 참조가 아니다 — issue 참조를 /pull/ URL로 만들지 않는다', () => {
    expect(refFromOutputUrl('https://ghe.example.com/acme/payments/pull/77#issuecomment-1', 'pull_request', CONTEXT, 'execution_context')).toEqual({ ok: false, problem: 'query_or_fragment' });
    expect(refFromOutputUrl('https://ghe.example.com/acme/payments/discussions/3#discussioncomment-9', 'discussion', CONTEXT, 'execution_context')).toEqual({ ok: false, problem: 'query_or_fragment' });
    expect(refFromOutputUrl('https://ghe.example.com/acme/payments/pull/77?tab=files', 'pull_request', CONTEXT, 'execution_context')).toEqual({ ok: false, problem: 'query_or_fragment' });
    expect(refFromOutputUrl('https://ghe.example.com/acme/payments/pull/77/files', 'pull_request', CONTEXT, 'execution_context')).toEqual({ ok: false, problem: 'grammar' });
    expect(refFromOutputUrl('https://ghe.example.com/acme/payments/pull/77', 'issue', CONTEXT, 'execution_context')).toEqual({ ok: false, problem: 'grammar' });
    expect(refFromOutputUrl('https://ghe.example.com/acme/payments/pull/077', 'pull_request', CONTEXT, 'execution_context')).toEqual({ ok: false, problem: 'grammar' });
    expect(refFromOutputUrl('https://ghe.example.com/acme/payments/tree/main', 'repository', CONTEXT, 'url')).toEqual({ ok: false, problem: 'grammar' });
  });

  it('스킴·자격 정보·URL이 아닌 값은 거절한다', () => {
    expect(refFromOutputUrl('javascript:alert(1)', 'pull_request', CONTEXT, 'execution_context')).toEqual({ ok: false, problem: 'scheme' });
    expect(refFromOutputUrl('https://user:pw@ghe.example.com/acme/payments/pull/1', 'pull_request', CONTEXT, 'execution_context')).toEqual({ ok: false, problem: 'credentials' });
    expect(refFromOutputUrl('acme/payments#1', 'pull_request', CONTEXT, 'execution_context')).toEqual({ ok: false, problem: 'not_a_url' });
  });
});
