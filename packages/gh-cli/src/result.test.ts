/**
 * typed 결과 파서 (FR-GH-002 AC-10, ADR-020, QA-GH-24).
 */

import { describe, expect, it } from 'vitest';
import { PR_LIST_DEFAULT_JSON_FIELDS, PR_LIST_JSON_FIELDS, parsePrListOutput, safeHttpUrl } from './result.js';

const ESC = '\x1b';

describe('pr_list_v1 결과 계약', () => {
  it('GitHub 필드에 토큰 모양이 있으면 argv와 같은 편집으로 가린다 (심층 방어)', () => {
    const stdout = JSON.stringify([{ number: 1, title: 'leak ghu_abcdefghijklmnop0123456789 here', author: { login: 'ghp_0123456789abcdefghijklmnop' } }]);
    const outcome = parsePrListOutput(stdout, ['number', 'title', 'author'], 30);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.rows[0]?.title).toBe('leak <redacted> here');
    expect(outcome.result.rows[0]?.author).toBe('<redacted>');
  });

  it('허용 필드만 읽고 모르는 키는 버린다', () => {
    const stdout = JSON.stringify([
      { number: 12, title: 't', state: 'OPEN', url: 'https://ghe/acme/x/pull/12', author: { login: 'alice', id: 'U_1' }, body: 'secret', extra: 1 },
    ]);
    const outcome = parsePrListOutput(stdout, ['number', 'title'], 30);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
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
    const outcome = parsePrListOutput(stdout, ['number', 'title', 'headRefName'], 30);
    expect(outcome.ok && outcome.result.rows[0]?.title).toBe('Fix red <b>x</b>');
    expect(outcome.ok && outcome.result.rows[0]?.headRefName).toBe('br');
  });

  it('gh가 제어 문자를 이스케이프하지 않은 JSON도 무해화 뒤 읽는다', () => {
    const raw = `[{"number":3,"title":"a${ESC}[1mb"}]`;
    const outcome = parsePrListOutput(raw, ['number', 'title'], 30);
    expect(outcome.ok && outcome.result.rows[0]?.title).toBe('ab');
  });

  it('배열이 아니거나 행 모양이 아니면 실패로 답한다 — 잘린 목록을 정상으로 꾸미지 않는다', () => {
    expect(parsePrListOutput('{"data":[]}', [], 30)).toEqual({ ok: false, reason: 'not_array' });
    expect(parsePrListOutput('[{"title":"no number"}]', [], 30)).toEqual({ ok: false, reason: 'row_shape' });
    expect(parsePrListOutput('[{"number":1,"title":"x"', [], 30)).toEqual({ ok: false, reason: 'not_json' });
  });

  it('건수가 상한에 닿으면 더 있을 수 있음을 알린다', () => {
    const rows = JSON.stringify([{ number: 1 }, { number: 2 }]);
    expect(parsePrListOutput(rows, ['number'], 2).ok && (parsePrListOutput(rows, ['number'], 2) as { result: { possiblyMore: boolean } }).result.possiblyMore).toBe(true);
    expect((parsePrListOutput(rows, ['number'], 5) as { result: { possiblyMore: boolean } }).result.possiblyMore).toBe(false);
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
