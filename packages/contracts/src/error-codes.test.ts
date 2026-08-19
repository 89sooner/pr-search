import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_HTTP_STATUS, isErrorCode } from './error-codes.js';

/**
 * WP-001 DoD: "오류 코드 enum이 API 계약 6장의 모든 코드를 포함한다".
 *
 * 사람이 눈으로 대조하는 대신 문서를 직접 파싱해 비교한다. 문서에 코드가 추가되면
 * 이 테스트가 먼저 깨진다.
 */
const CONTRACTS_DOC = fileURLToPath(
  new URL('../../../docs/30_technical_architecture/pr_search_api_contracts.md', import.meta.url),
);

function readDocumentedCodes(): { code: string; status: number }[] {
  const doc = readFileSync(CONTRACTS_DOC, 'utf8');
  const chapter = doc.split('## 6. 오류 모델')[1]?.split('## 7.')[0];
  if (chapter === undefined) throw new Error('API 계약 문서에서 6장을 찾지 못했다');

  return [...chapter.matchAll(/^\|\s*`([A-Z_]+)`\s*\|\s*(\d+)/gm)].map((match) => ({
    code: match[1]!,
    status: Number(match[2]!),
  }));
}

describe('오류 코드 (API 계약 6장)', () => {
  const documented = readDocumentedCodes();

  it('문서에서 코드를 실제로 읽어 온다', () => {
    expect(documented.length).toBeGreaterThan(0);
  });

  it('enum이 문서의 코드를 모두 포함하고, 문서에 없는 코드를 만들지 않는다', () => {
    expect([...ERROR_CODES].sort()).toEqual(documented.map((entry) => entry.code).sort());
  });

  it('HTTP 상태 매핑이 문서와 일치한다', () => {
    for (const { code, status } of documented) {
      expect(ERROR_HTTP_STATUS[code as (typeof ERROR_CODES)[number]]).toBe(status);
    }
  });

  it('GRAPH_TIMEOUT은 부분 결과와 함께 200으로 응답한다', () => {
    expect(ERROR_HTTP_STATUS.GRAPH_TIMEOUT).toBe(200);
  });

  it('코드에 중복이 없다', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it('isErrorCode가 정의된 코드만 통과시킨다', () => {
    expect(isErrorCode('NOT_FOUND')).toBe(true);
    expect(isErrorCode('NOT_A_REAL_CODE')).toBe(false);
  });
});
