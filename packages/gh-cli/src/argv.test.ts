/**
 * 유일한 argv 빌더 (FR-GH-002 AC-1·AC-2·AC-3·AC-9, NFR-010).
 */

import { describe, expect, it } from 'vitest';
import { REDACTED, argvEquals, buildArgv, redactArgv, redactString } from './argv.js';
import { PR_LIST_CAPABILITY } from './capabilities.js';
import { evaluateInvocation } from './constraints.js';
import type { GhExecutionContext, GhNormalizedInvocation } from './types.js';

const CONTEXT: GhExecutionContext = { host: 'ghe.example.com', repository: { owner: 'acme', name: 'payments' } };

function normalized(flags: Record<string, string | number> = {}, json: string[] = ['number', 'title']): GhNormalizedInvocation {
  const result = evaluateInvocation(PR_LIST_CAPABILITY, {
    capability_id: 'pr.list',
    context: { repository: 'acme/payments' },
    flags,
    output: { json_fields: json },
  });
  if (!result.ok) throw new Error(JSON.stringify(result.violations));
  return result.invocation;
}

describe('FR-GH-002 AC-2: argv는 manifest와 검증된 값에서만 조립된다', () => {
  it('golden argv — 고정 invocation은 고정 argv다', () => {
    expect(buildArgv(PR_LIST_CAPABILITY, normalized({ '--state': 'merged', '--limit': 5 }), CONTEXT)).toEqual([
      'pr', 'list', '--repo', 'ghe.example.com/acme/payments', '--state', 'merged', '--limit', '5', '--json', 'number,title',
    ]);
  });

  it('AC-9: 같은 입력은 같은 배열이다', () => {
    const a = buildArgv(PR_LIST_CAPABILITY, normalized({ '--limit': '7' }), CONTEXT);
    const b = buildArgv(PR_LIST_CAPABILITY, normalized({ '--limit': 7 }), CONTEXT);
    expect(argvEquals(a, b)).toBe(true);
  });

  it('호스트는 사용자 입력이 아니라 컨텍스트에서 온다 — 포트가 있는 호스트도 그대로', () => {
    const argv = buildArgv(PR_LIST_CAPABILITY, normalized(), { ...CONTEXT, host: '127.0.0.1:48443' });
    expect(argv[3]).toBe('127.0.0.1:48443/acme/payments');
  });

  it('command path는 사용자 입력으로 바뀔 수 없다 — 정의와 invocation의 capability가 다르면 던진다', () => {
    expect(() => buildArgv(PR_LIST_CAPABILITY, { ...normalized(), capabilityId: 'repo.delete' }, CONTEXT)).toThrow(/불일치/);
  });

  it('컨텍스트의 저장소가 invocation과 다르면 던진다 — 변조된 컨텍스트로 다른 저장소를 조회하지 않는다', () => {
    expect(() =>
      buildArgv(PR_LIST_CAPABILITY, normalized(), { ...CONTEXT, repository: { owner: 'acme', name: 'secrets' } }),
    ).toThrow(/저장소/);
  });

  it('제어 문자가 섞인 값은 조립을 거부한다 — 검증기가 뚫려도 마지막 방어선이 있다', () => {
    const tampered: GhNormalizedInvocation = {
      ...normalized(),
      options: [{ flag: '--state', value: 'open\nmalicious' }],
    };
    expect(() => buildArgv(PR_LIST_CAPABILITY, tampered, CONTEXT)).toThrow(/제어 문자/);
  });
});

describe('FR-GH-002 AC-3 / FR-GH-008 AC-7: 표시용 argv에 비밀이 없다', () => {
  it('토큰 모양은 가린다', () => {
    expect(redactArgv(['--token', 'ghu_' + 'A'.repeat(30)])).toEqual(['--token', REDACTED]);
    expect(redactString('Bearer ghr_' + 'b'.repeat(20) + ' done')).toBe(`Bearer ${REDACTED} done`);
    expect(redactString('eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij')).toBe(REDACTED);
  });

  it('정상 argv는 그대로다', () => {
    const argv = buildArgv(PR_LIST_CAPABILITY, normalized(), CONTEXT);
    expect(redactArgv(argv)).toEqual(argv);
  });
});
