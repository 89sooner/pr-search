/**
 * typed 결과 파서 (FR-GH-002 AC-10, ADR-020, QA-GH-24, CR-089 `pr_list_v2`).
 *
 * 기대값은 손으로 적었다. v2가 v1과 다른 자리 — 식별 필드를 고르지 않은 정상 조회, gh가 GraphQL `null`을 0으로 찍는
 * 경우, 참조의 호스트·저장소가 행의 url이 아니라 컨텍스트에서 오는 것 — 을 각각 따로 건다.
 */

import { describe, expect, it } from 'vitest';
import { PR_LIST_DEFAULT_JSON_FIELDS, PR_LIST_JSON_FIELDS, parsePrListOutput, prListPortValue, safeHttpUrl } from './result.js';

const ESC = '\x1b';
const CONTEXT = { host: 'ghe.example.com', repository: { owner: 'acme', name: 'payments' } } as const;

const prRef = (number: number) => ({ host: 'ghe.example.com', kind: 'pull_request', repository: 'acme/payments', id: null, number, ref: null });

describe('pr_list_v2 결과 계약', () => {
  it('GitHub 필드에 토큰 모양이 있으면 argv와 같은 편집으로 가린다 (심층 방어)', () => {
    const stdout = JSON.stringify([{ number: 1, title: 'leak ghu_abcdefghijklmnop0123456789 here', author: { login: 'ghp_0123456789abcdefghijklmnop' } }]);
    const outcome = parsePrListOutput(stdout, ['number', 'title', 'author'], 30, CONTEXT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.rows[0]?.title).toBe('leak <redacted> here');
    expect(outcome.result.rows[0]?.author).toBe('<redacted>');
  });

  it('허용 필드만 읽고 모르는 키는 버린다', () => {
    const stdout = JSON.stringify([
      { number: 12, title: 't', state: 'OPEN', url: 'https://ghe/acme/x/pull/12', author: { login: 'alice', id: 'U_1' }, body: 'secret', extra: 1 },
    ]);
    const outcome = parsePrListOutput(stdout, ['number', 'title'], 30, CONTEXT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.schema).toBe('pr_list_v2');
    expect(outcome.result.rows[0]).toEqual({
      number: 12,
      title: 't',
      state: 'OPEN',
      url: 'https://ghe/acme/x/pull/12',
      author: 'alice',
      headRefName: null,
      baseRefName: null,
      isDraft: null,
      createdAt: null,
      updatedAt: null,
    });
    expect(JSON.stringify(outcome.result)).not.toContain('secret');
  });

  it('QA-GH-24: GitHub 필드의 escape·제어 문자가 행 값에서 걷힌다', () => {
    const stdout = JSON.stringify([{ number: 1, title: `Fix ${ESC}[31mred${ESC}[0m <b>x</b>`, headRefName: `${ESC}]8;;https://evil${ESC}\\br` }]);
    const outcome = parsePrListOutput(stdout, ['number', 'title', 'headRefName'], 30, CONTEXT);
    expect(outcome.ok && outcome.result.rows[0]?.title).toBe('Fix red <b>x</b>');
    expect(outcome.ok && outcome.result.rows[0]?.headRefName).toBe('br');
  });

  it('gh가 제어 문자를 이스케이프하지 않은 JSON도 무해화 뒤 읽는다', () => {
    const raw = `[{"number":3,"title":"a${ESC}[1mb"}]`;
    const outcome = parsePrListOutput(raw, ['number', 'title'], 30, CONTEXT);
    expect(outcome.ok && outcome.result.rows[0]?.title).toBe('ab');
  });

  it('배열이 아니거나 행 모양이 아니면 실패로 답한다 — 잘린 목록을 정상으로 꾸미지 않는다', () => {
    expect(parsePrListOutput('{"data":[]}', ['number'], 30, CONTEXT)).toEqual({ ok: false, reason: 'not_array' });
    expect(parsePrListOutput('[1]', ['title'], 30, CONTEXT)).toEqual({ ok: false, reason: 'row_shape' });
    expect(parsePrListOutput('[{"number":1,"title":"x"', ['number'], 30, CONTEXT)).toEqual({ ok: false, reason: 'not_json' });
  });

  it('건수가 상한에 닿으면 더 있을 수 있음을 알린다', () => {
    const rows = JSON.stringify([{ number: 1 }, { number: 2 }]);
    const atLimit = parsePrListOutput(rows, ['number'], 2, CONTEXT);
    const underLimit = parsePrListOutput(rows, ['number'], 5, CONTEXT);
    expect(atLimit.ok && atLimit.result.possiblyMore).toBe(true);
    expect(underLimit.ok && underLimit.result.possiblyMore).toBe(false);
  });

  it('URL은 http(s)만 링크다', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,x')).toBeNull();
    expect(safeHttpUrl('https://ghe/acme/x/pull/1')).toBe('https://ghe/acme/x/pull/1');
    expect(safeHttpUrl('not a url')).toBeNull();
  });

  it('기본 필드는 허용 목록 안이다', () => {
    for (const field of PR_LIST_DEFAULT_JSON_FIELDS) expect(PR_LIST_JSON_FIELDS).toContain(field);
  });
});

describe('CR-089: 식별자와 PR 참조', () => {
  it('number를 고르면 행과 같은 순서의 PR 참조가 생기고, host·repository는 행의 url이 아니라 컨텍스트다', () => {
    const stdout = JSON.stringify([{ number: 12, url: 'https://evil.example/other/repo/pull/99' }, { number: 11 }]);
    const outcome = parsePrListOutput(stdout, ['number', 'url'], 30, CONTEXT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.references).toEqual({ port: 'pull_requests', type: 'pull_request', status: 'available', reason: null, refs: [prRef(12), prRef(11)] });
    expect(prListPortValue(outcome.result)).toEqual({ status: 'available', port: 'pull_requests', cardinality: 'many', items: [prRef(12), prRef(11)] });
  });

  it('title만 고른 정상 조회는 성공하고 행을 보이되, 참조를 만들 수 없다는 사실과 이유를 따로 싣는다 — v1은 row_shape로 실패했다', () => {
    const outcome = parsePrListOutput('[{"title":"Fix race"},{"title":"Add thing"}]\n', ['title'], 30, CONTEXT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.rows.map((row) => [row.number, row.title])).toEqual([
      [null, 'Fix race'],
      [null, 'Add thing'],
    ]);
    expect(outcome.result.references).toEqual({ port: 'pull_requests', type: 'pull_request', status: 'unavailable', reason: 'identity_field_not_selected', refs: [] });
    expect(prListPortValue(outcome.result)).toEqual({ status: 'unavailable', port: 'pull_requests', reason: 'identity_field_not_selected' });
  });

  it('number를 고르지 않았으면 출력에 number가 섞여 있어도 읽지 않는다 — 참조를 만들지 않는다', () => {
    const outcome = parsePrListOutput('[{"title":"t","number":5}]', ['title'], 30, CONTEXT);
    expect(outcome.ok && outcome.result.rows[0]?.number).toBeNull();
    expect(outcome.ok && outcome.result.references.status).toBe('unavailable');
  });

  it('number를 골랐는데 양의 안전한 정수가 아니면 결과 전체를 거절한다 — gh는 GraphQL null을 0으로 찍는다(실측), 0으로 채우지 않는다', () => {
    for (const raw of ['[{"number":0}]', '[{"number":-3}]', '[{"number":1.5}]', '[{"number":"12"}]', '[{"number":null}]', '[{"title":"no number"}]', '[{"number":9007199254740993}]', '[{"number":12},{"number":0}]']) {
      expect(parsePrListOutput(raw, ['number', 'title'], 30, CONTEXT), raw).toEqual({ ok: false, reason: 'invalid_identifier' });
    }
  });

  it('빈 목록은 성공이고 참조 목록도 비어 있다 — 없는 원소를 고르면 바인딩에서 실패한다', () => {
    const outcome = parsePrListOutput('[]\n', PR_LIST_DEFAULT_JSON_FIELDS, 30, CONTEXT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.rows).toEqual([]);
    expect(outcome.result.references).toMatchObject({ status: 'available', refs: [] });
    expect(outcome.result.possiblyMore).toBe(false);
  });

  it('컨텍스트의 호스트가 참조 규칙에 맞지 않으면 참조를 만들지 않고 거절한다', () => {
    expect(parsePrListOutput('[{"number":1}]', ['number'], 30, { host: 'bad host', repository: { owner: 'acme', name: 'payments' } })).toEqual({ ok: false, reason: 'invalid_identifier' });
  });
});
