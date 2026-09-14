/**
 * W-010·W-021 화면 판정 시험 (WP-077 / FR-GH-003 AC-1·AC-8, FR-GH-012 AC-4·AC-5, CR-086).
 *
 * 여기서 거는 것은 **화면이 서버의 판정을 다시 만들지 않는다**는 성질이다 — 폼 검증은
 * `@prs/gh-cli`의 `evaluateInvocation`을 그대로 부르고, 결과의 사실 상태는 서버가 준 값에서만
 * 읽는다. 그리고 「같은 구성으로 다시 실행」이 invocation 말고는 아무것도 넘기지 않는다는 것.
 */

import { describe, expect, it } from 'vitest';
import { evaluateInvocation, PR_LIST_CAPABILITY } from '@prs/gh-cli';
import {
  canExecute,
  defaultFormState,
  describeApiError,
  describeError,
  encodePrefill,
  formFromInvocation,
  formatArgv,
  loginPathOf,
  newIdempotencyKey,
  parsePrefill,
  resultKind,
  toInvocation,
  validateForm,
} from './gh';
import { PREVIEW, PR_LIST_VIEW, execution } from './gh-test-fixtures';

describe('validateForm은 서버와 같은 함수다 (FR-GH-003 AC-8, QA-GH-03)', () => {
  it('기본값은 위반이 없다 — 저장소만 고르면 유효하다', () => {
    const form = defaultFormState(PR_LIST_VIEW, 'acme/payments');
    expect(validateForm(PR_LIST_VIEW, form)).toEqual([]);
  });

  it('저장소가 비면 context_required, 형식이 틀리면 repository_format', () => {
    expect(validateForm(PR_LIST_VIEW, defaultFormState(PR_LIST_VIEW)).map((v) => v.code)).toContain('context_required');
    expect(validateForm(PR_LIST_VIEW, defaultFormState(PR_LIST_VIEW, 'not a slug')).map((v) => v.code)).toContain('repository_format');
  });

  it.each([
    ['limit 0', { limit: '0' }, 'int_range'],
    ['limit 101', { limit: '101' }, 'int_range'],
    ['limit 소수', { limit: '1.5' }, 'int_format'],
    ['state 열거 밖', { state: 'draft' }, 'enum_value'],
    ['허용되지 않은 JSON 필드', { jsonFields: ['number', 'body'] }, 'json_field_not_allowed'],
  ] as const)('%s → %s', (_label, patch, code) => {
    const form = { ...defaultFormState(PR_LIST_VIEW, 'acme/payments'), ...patch };
    expect(validateForm(PR_LIST_VIEW, form).map((v) => v.code)).toContain(code);
  });

  it('폼 판정과 서버 판정이 같은 위반을 낸다 — 규칙이 두 벌이 아니다', () => {
    const form = { ...defaultFormState(PR_LIST_VIEW, 'acme/payments'), limit: '0', state: 'draft' };
    const fromForm = validateForm(PR_LIST_VIEW, form);
    const fromServer = evaluateInvocation(PR_LIST_CAPABILITY, toInvocation(PR_LIST_VIEW, form));
    expect(fromServer.ok).toBe(false);
    expect(fromForm).toEqual(fromServer.ok ? [] : fromServer.violations);
  });

  it('toInvocation은 서버가 받는 모양이다 — flag 이름은 정의에서 온다', () => {
    const invocation = toInvocation(PR_LIST_VIEW, { repository: 'acme/payments', state: 'closed', limit: '7', jsonFields: ['number', 'title'] });
    expect(invocation).toEqual({
      capability_id: 'pr.list',
      context: { repository: 'acme/payments' },
      flags: { '--state': 'closed', '--limit': '7' },
      output: { json_fields: ['number', 'title'] },
    });
  });
});

describe('실행 버튼은 두 조건이 함께 성립할 때만 열린다 (FR-GH-003 AC-4, QA-GH-02)', () => {
  it('위반이 있으면 미리보기가 있어도 닫힌다', () => {
    expect(canExecute([{ code: 'int_range', flag: '--limit', message: 'x' }], PREVIEW)).toBe(false);
  });
  it('미리보기가 없거나 서버가 실행 불가라 하면 닫힌다', () => {
    expect(canExecute([], null)).toBe(false);
    expect(canExecute([], { ...PREVIEW, executable: false, blockers: ['identity_not_connected'] })).toBe(false);
  });
  it('둘 다 성립하면 열린다', () => {
    expect(canExecute([], PREVIEW)).toBe(true);
  });
});

describe('resultKind는 서버가 준 사실을 가른다 (지시서 12장, FR-GH-006 AC-5)', () => {
  it.each([
    ['queued', execution({ state: 'queued', finished_at: null, result: null, stdout: null }), 'pending'],
    ['running', execution({ state: 'running', finished_at: null, result: null, stdout: null }), 'pending'],
    ['cancelled', execution({ state: 'cancelled', error: 'cancelled' }), 'cancelled'],
    ['timed_out', execution({ state: 'timed_out', error: 'timed_out_after_30000ms' }), 'timed_out'],
    ['failed', execution({ state: 'failed', error: 'gh_exit_1', result: null }), 'failed'],
    ['binary', execution({ output_binary: true }), 'binary'],
    ['stdout 절삭', execution({ result: { ...execution().result, stdout_truncated: true }, stdout: { text: '[', truncated: true } }), 'truncated'],
    ['0건', execution({ result: { schema: 'pr_list_v1', rows: [], row_count: 0, possibly_more: false, stdout_truncated: false } }), 'empty'],
    ['행 있음', execution(), 'rows'],
    // CR-089: pr_list_v2는 number를 고르지 않은 정상 조회도 행이다 — 번호가 null이어도 0건이나 실패로 읽지 않는다.
    [
      'v2 — 번호를 고르지 않은 행',
      execution({
        result: {
          schema: 'pr_list_v2',
          rows: [{ number: null, title: 'Fix race', state: null, url: null, author: null, headRefName: null, baseRefName: null, isDraft: null, createdAt: null, updatedAt: null }],
          row_count: 1,
          possibly_more: false,
          stdout_truncated: false,
          references: { status: 'unavailable', reason: 'identity_field_not_selected', refs: [] },
        },
      }),
      'rows',
    ],
  ] as const)('%s → %s', (_label, view, kind) => {
    expect(resultKind(view)).toBe(kind);
  });

  it('잘린 목록은 succeeded여도 rows가 아니다 — 완전한 목록처럼 보이지 않게', () => {
    const view = execution({ stdout: { text: '[…', truncated: true } });
    expect(resultKind(view)).toBe('truncated');
  });
});

describe('describeError는 서버 사유 코드를 옮기기만 한다', () => {
  it.each([
    ['identity_required', '연결'],
    ['identity_expired', '연결'],
    ['registry_stale', 'manifest'],
    ['argv_mismatch', '명령이 달라졌습니다'],
    ['executor_lost', '회수'],
    ['gh_auth_required', '인증'],
    ['gh_exit_4', '종료 코드 4'],
    ['result_parse_failed: not_json (stdout truncated)', '결과 계약'],
    ['timed_out_after_30000ms', '시간 상한'],
  ])('%s', (code, fragment) => {
    expect(describeError(code)).toContain(fragment);
  });
  it('모르는 코드는 그대로 보인다 — 지어내지 않는다', () => {
    expect(describeError('something_else')).toBe('something_else');
    expect(describeError(null)).toBe('');
  });
});

describe('「같은 구성으로 다시 실행」은 invocation만 넘긴다 (FR-GH-012 AC-4)', () => {
  const invocation = { capability_id: 'pr.list', context: { repository: 'acme/payments' }, flags: { '--state': 'closed', '--limit': 7 }, output: { json_fields: ['number', 'title'] } };

  it('왕복한다', () => {
    const parsed = parsePrefill(decodeURIComponent(encodePrefill(invocation)));
    expect(parsed).toEqual({ capability_id: 'pr.list', context: { repository: 'acme/payments' }, flags: { '--state': 'closed', '--limit': '7' }, output: { json_fields: ['number', 'title'] } });
  });

  it('과거 실행의 승인·ID 같은 여분 키는 버린다', () => {
    const parsed = parsePrefill(JSON.stringify({ ...invocation, execution_id: 7, approval_id: 3, authorization_result: 'approved' }));
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed as object).sort()).toEqual(['capability_id', 'context', 'flags', 'output']);
  });

  it('모양이 다르면 null이다 — URL은 외부 입력이다', () => {
    expect(parsePrefill(null)).toBeNull();
    expect(parsePrefill('')).toBeNull();
    expect(parsePrefill('{not json')).toBeNull();
    expect(parsePrefill('[]')).toBeNull();
    expect(parsePrefill(JSON.stringify({ capability_id: 'pr.list' }))).toBeNull();
    expect(parsePrefill(JSON.stringify({ ...invocation, flags: ['--web'] }))).toBeNull();
    expect(parsePrefill(JSON.stringify({ ...invocation, output: { json_fields: [1] } }))).toBeNull();
  });

  it('flag 값은 문자열·숫자·불리언만 받고 나머지는 떨어뜨린다', () => {
    const parsed = parsePrefill(JSON.stringify({ ...invocation, flags: { '--state': 'open', '--limit': 5, '--web': true, '--jq': { expr: '.' } } }));
    expect(parsed?.flags).toEqual({ '--state': 'open', '--limit': '5', '--web': 'true' });
  });

  it('formFromInvocation은 정의의 flag만 폼에 옮기고, 그 값은 다시 같은 검증을 지난다', () => {
    const parsed = parsePrefill(JSON.stringify({ ...invocation, flags: { '--state': 'closed', '--limit': 7, '--web': 'true' } }));
    const form = formFromInvocation(PR_LIST_VIEW, parsed as NonNullable<typeof parsed>);
    expect(form).toEqual({ repository: 'acme/payments', state: 'closed', limit: '7', jsonFields: ['number', 'title'] });
    // `--web`은 폼에 자리가 없으므로 사라진다 — 초기값이 우회 경로가 되지 않는다.
    expect(validateForm(PR_LIST_VIEW, form)).toEqual([]);
  });

  it('json_fields가 비면 정의의 기본값을 쓴다', () => {
    const parsed = parsePrefill(JSON.stringify({ ...invocation, output: { json_fields: [] } }));
    const form = formFromInvocation(PR_LIST_VIEW, parsed as NonNullable<typeof parsed>);
    expect(form.jsonFields).toEqual(defaultFormState(PR_LIST_VIEW).jsonFields);
  });
});

describe('중복 방지 키 (FR-GH-012 AC-5, QA-GH-14)', () => {
  it('서버 형식(8~128자, [A-Za-z0-9_-])에 맞고 매번 다르다', () => {
    const first = newIdempotencyKey();
    const second = newIdempotencyKey();
    expect(first).toMatch(/^web-[0-9a-f]{32}$/);
    expect(first).not.toBe(second);
  });
});

describe('오류 DTO 읽기 — 프록시·서버가 정한 코드를 재해석하지 않는다', () => {
  it('login_path는 절대 경로일 때만 받는다', () => {
    expect(loginPathOf({ error: { code: 'UNAUTHENTICATED', detail: { login_path: '/auth/login' } } })).toBe('/auth/login');
    expect(loginPathOf({ error: { code: 'UNAUTHENTICATED', detail: { login_path: 'https://evil/login' } } })).toBeNull();
    expect(loginPathOf({ error: { code: 'UNAUTHENTICATED', detail: { login_path: '//evil.example/login' } } })).toBeNull();
    expect(loginPathOf({ error: { code: 'UNAUTHENTICATED', detail: { login_path: '/\\evil.example/login' } } })).toBeNull();
    expect(loginPathOf({ error: { code: 'UNAUTHENTICATED' } })).toBeNull();
    expect(loginPathOf(null)).toBeNull();
  });

  it('code·message·correlation_id를 그대로 옮기고 없으면 fallback이다', () => {
    expect(describeApiError({ error: { code: 'GH_DUPLICATE_REQUEST', message: '이미 있다' }, correlation_id: 'c-1' }, 'x')).toEqual({ message: '이미 있다', code: 'GH_DUPLICATE_REQUEST', correlationId: 'c-1' });
    expect(describeApiError({ message: 'Route not found' }, '기본')).toEqual({ message: '기본', code: null, correlationId: null });
    expect(describeApiError(null, '기본')).toEqual({ message: '기본', code: null, correlationId: null });
  });
});

describe('formatArgv는 표시용이다', () => {
  it('공백이 있는 항목만 따옴표로 감싼다', () => {
    expect(formatArgv(['pr', 'list', '--repo', 'h/o/r', '--json', 'a,b'])).toBe('gh pr list --repo h/o/r --json a,b');
    expect(formatArgv(['pr', 'list', '--search', 'is:open label:x'])).toBe('gh pr list --search "is:open label:x"');
  });
});
