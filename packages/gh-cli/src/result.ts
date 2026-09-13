/**
 * typed 결과 (FR-GH-002 AC-10, ADR-020, WP-066 일부).
 *
 * `pr list --json`의 stdout을 `pr_list_v1` 스키마의 행으로 옮긴다. **허용 목록에 있는
 * 필드만 읽고, 모르는 키는 버린다.** 문자열 값은 전부 무해화 경계를 지난다 — gh가
 * JSON 안의 제어 문자를 이스케이프하더라도, 그것을 풀어낸 뒤의 문자열이 화면에
 * 닿는 것은 우리이므로 우리가 걷어 낸다. 토큰 모양(`gh*_…`·PAT·JWT)은 argv와 **같은 편집**
 * (`redactString`)을 지난다 — GitHub 필드에 누가 토큰을 적어 두었더라도 이력에 남기지 않는다.
 */

import { redactString } from './argv.js';
import { sanitizeText } from './safe-output.js';
import type { GhPrListResult, GhPrListRow } from './types.js';

/** 이 판이 여는 `--json` 필드. 결과 계약이 아는 것만 허용한다. */
export const PR_LIST_JSON_FIELDS = [
  'number',
  'title',
  'state',
  'url',
  'author',
  'headRefName',
  'baseRefName',
  'isDraft',
  'createdAt',
  'updatedAt',
] as const;

export type PrListJsonField = (typeof PR_LIST_JSON_FIELDS)[number];

export const PR_LIST_DEFAULT_JSON_FIELDS: readonly PrListJsonField[] = [
  'number',
  'title',
  'state',
  'author',
  'headRefName',
  'baseRefName',
  'isDraft',
  'updatedAt',
  'url',
];

export type ParsePrListOutcome =
  | { readonly ok: true; readonly result: GhPrListResult }
  | { readonly ok: false; readonly reason: 'not_json' | 'not_array' | 'row_shape' };

const MAX_STRING_BYTES = 4096;

function str(value: unknown): string | null {
  return typeof value === 'string' ? redactString(sanitizeText(value, MAX_STRING_BYTES)) : null;
}

/** `https://`·`http://`만 링크로 인정한다 (프런트엔드 문서 11장 — 승인된 스킴). */
export function safeHttpUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function toRow(raw: unknown): GhPrListRow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const number = record['number'];
  if (typeof number !== 'number' || !Number.isSafeInteger(number)) return null;

  const author = record['author'];
  const authorLogin =
    typeof author === 'object' && author !== null ? str((author as Record<string, unknown>)['login']) : null;

  return {
    number,
    title: str(record['title']),
    state: str(record['state']),
    url: safeHttpUrl(str(record['url'])),
    author: authorLogin,
    headRefName: str(record['headRefName']),
    baseRefName: str(record['baseRefName']),
    isDraft: typeof record['isDraft'] === 'boolean' ? record['isDraft'] : null,
    createdAt: str(record['createdAt']),
    updatedAt: str(record['updatedAt']),
  };
}

export function parsePrListOutput(
  stdout: string,
  fields: readonly string[],
  limit: number,
): ParsePrListOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // gh가 제어 문자를 이스케이프하지 않은 경우를 위한 두 번째 시도.
    try {
      parsed = JSON.parse(sanitizeText(stdout, Number.MAX_SAFE_INTEGER));
    } catch {
      return { ok: false, reason: 'not_json' };
    }
  }
  if (!Array.isArray(parsed)) return { ok: false, reason: 'not_array' };

  const rows: GhPrListRow[] = [];
  for (const item of parsed) {
    const row = toRow(item);
    if (row === null) return { ok: false, reason: 'row_shape' };
    rows.push(row);
  }

  return {
    ok: true,
    result: {
      schema: 'pr_list_v1',
      rows,
      fields: [...fields],
      possiblyMore: rows.length >= limit,
    },
  };
}
