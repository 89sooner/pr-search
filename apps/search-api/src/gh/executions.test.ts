/**
 * 실행 요청의 순수 부분 (API-GH-002, FR-GH-003 AC-5·AC-8, FR-GH-012 AC-5).
 *
 * DB·버스가 필요한 흐름은 `integration/gh/routes.test.ts`가 본다. 여기서는 본문 파싱과
 * 뷰 변환 — 클라이언트가 보낸 모양을 어디까지 받고 무엇을 검증기에 넘기는가.
 */

import { describe, expect, it } from 'vitest';
import type { GhExecutionRow } from '@prs/db';
import { GhRejected, canSeeAll, parseIdempotencyKey, parseInvocationBody, toExecutionView } from './executions.js';

describe('본문 파싱 — 모양만 맞추고 값은 검증기에 넘긴다', () => {
  it('정상 본문', () => {
    const invocation = parseInvocationBody({
      capability_id: 'pr.list',
      context: { repository: 'acme/payments' },
      flags: { '--state': 'open', '--limit': 5 },
      output: { json_fields: ['number'] },
    });
    expect(invocation).toEqual({
      capability_id: 'pr.list',
      context: { repository: 'acme/payments' },
      flags: { '--state': 'open', '--limit': 5 },
      output: { json_fields: ['number'] },
    });
  });

  it('flags·output을 생략하면 빈 값이다 (기본값은 검증기의 몫)', () => {
    const invocation = parseInvocationBody({ capability_id: 'pr.list', context: { repository: 'a/b' } });
    expect(invocation.flags).toEqual({});
    expect(invocation.output.json_fields).toEqual([]);
  });

  it('positional·stdin·files·argv·command는 지우지 않고 넘긴다 — 거절의 주체는 검증기 하나다', () => {
    const invocation = parseInvocationBody({ capability_id: 'pr.list', context: { repository: 'a/b' }, argv: ['rm'] }) as unknown as Record<string, unknown>;
    expect(invocation['argv']).toEqual(['rm']);
  });

  it('필수 키가 없거나 모양이 다르면 INVALID_PARAMETER', () => {
    for (const body of [null, 'x', {}, { capability_id: '' }, { capability_id: 'pr.list' }, { capability_id: 'pr.list', context: { repository: 1 } }, { capability_id: 'pr.list', context: { repository: 'a/b' }, flags: [] }, { capability_id: 'pr.list', context: { repository: 'a/b' }, output: { json_fields: 'number' } }]) {
      expect(() => parseInvocationBody(body), JSON.stringify(body)).toThrow(GhRejected);
      try {
        parseInvocationBody(body);
      } catch (error) {
        expect((error as GhRejected).code).toBe('INVALID_PARAMETER');
      }
    }
  });
});

describe('FR-GH-012 AC-5: 중복 방지 키', () => {
  it('8~128자의 [A-Za-z0-9_-]만 받는다', () => {
    expect(parseIdempotencyKey('a'.repeat(8))).toBe('a'.repeat(8));
    expect(parseIdempotencyKey('7f0a9c2e-1b3d-4e5f-8a9b-0c1d2e3f4a5b')).toHaveLength(36);
    for (const bad of ['short', 'a'.repeat(129), 'has space', 'semi;colon', undefined, 42]) {
      expect(() => parseIdempotencyKey(bad), String(bad)).toThrow(GhRejected);
    }
  });
});

describe('실행 뷰', () => {
  const row: GhExecutionRow = {
    execution_id: 7,
    requested_at: new Date('2026-09-13T00:00:00Z'),
    user_id: 'u-alice',
    github_actor: 'alice',
    host: 'ghe.example.com',
    repository: 'acme/payments',
    repository_id: 4021,
    target: null,
    capability_id: 'pr.list',
    invocation: { capability_id: 'pr.list' },
    context: {},
    redacted_argv: ['pr', 'list'],
    env_keys: ['GH_HOST'],
    risk_level: 'R0',
    state: 'queued',
    gh_version: '2.97.0',
    manifest_version: 'r0.1',
    manifest_hash: 'h',
    idempotency_key: 'k'.repeat(8),
    authorization_result: 'delegated_token_intersection',
    confirmed_at: null,
    approval_id: null,
    executor_id: null,
    claimed_at: null,
    heartbeat_at: null,
    started_at: null,
    finished_at: null,
    cancel_requested_at: null,
    cancel_requested_by: null,
    exit_code: null,
    output_hash: null,
    error: null,
    result: null,
    stdout_excerpt: null,
    stderr_excerpt: null,
    stdout_truncated: false,
    stderr_truncated: false,
    output_binary: false,
    correlation_id: 'c',
  };

  it('끝나기 전에는 출력 발췌가 null이다 — 부분 출력을 완료처럼 보이지 않게 한다', () => {
    expect(toExecutionView(row).stdout).toBeNull();
    const finished = toExecutionView({ ...row, state: 'succeeded', finished_at: new Date(), stdout_excerpt: '[]', stdout_truncated: true });
    expect(finished.stdout).toEqual({ text: '[]', truncated: true });
  });

  it('중복 방지 키는 뷰에 싣지 않는다', () => {
    expect(JSON.stringify(toExecutionView(row))).not.toContain('kkkkkkkk');
  });

  it('보안 담당자만 전체를 본다 (FR-GH-012 AC-3)', () => {
    expect(canSeeAll({ userId: 'u', login: 'l', roles: ['developer', 'operator'] })).toBe(false);
    expect(canSeeAll({ userId: 'u', login: 'l', roles: ['security_officer'] })).toBe(true);
  });
});
