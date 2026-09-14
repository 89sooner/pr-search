/**
 * typed 결과 (FR-GH-002 AC-10, ADR-020, WP-066 일부 / CR-089).
 *
 * `pr list --json`의 stdout을 `pr_list_v2` 스키마의 행과 PR 참조로 옮긴다. **허용 목록에 있는 필드만 읽고, 모르는
 * 키는 버린다.** 문자열 값은 전부 무해화 경계를 지난다 — gh가 JSON 안의 제어 문자를 이스케이프하더라도, 그것을
 * 풀어낸 뒤의 문자열이 화면에 닿는 것은 우리이므로 우리가 걷어 낸다. 토큰 모양(`gh*_…`·PAT·JWT)은 argv와 **같은
 * 편집**(`redactString`)을 지난다 — GitHub 필드에 누가 토큰을 적어 두었더라도 이력에 남기지 않는다.
 *
 * ## v1 → v2 (CR-089)
 *
 * `pr_list_v1`은 `number`를 필수로 읽었다. 그런데 실행 정의는 JSON 필드를 하나만 골라도 되게 열어 두었고, gh는
 * **선택한 필드만** 찍는다(실측 `--json title` → `[{"title":…}]`) — 그래서 `title`만 고른 정상 조회가
 * `result_parse_failed: row_shape`로 실패했다. v2는 허용한 선택을 줄이지 않는다:
 *
 * - `number`를 고르지 않았으면 행의 `number`는 `null`이고, 참조는 만들지 않으며 그 사실과 이유를 `references`에 싣는다.
 * - `number`를 골랐는데 양의 안전한 정수가 아니면 결과 전체를 거절한다(`invalid_identifier`). gh는 GraphQL의 `null`을
 *   Go zero value `0`으로 찍는다(실측) — 0을 번호로 받아 참조를 만들지 않는다.
 * - 참조의 `host`·`repository`는 호출자가 넘기는 **검증된 실행 컨텍스트**에서 온다. 행의 `url`은 링크로만 쓴다.
 *
 * 과거 이력의 `pr_list_v1` 결과는 다시 해석하지 않는다 — 그 기록에는 참조가 없다.
 */

import { redactString } from './argv.js';
import type { GhPortValue } from './binding.js';
import { PR_LIST_RESULT_SCHEMA } from './classification/ports.js';
import type { RepositorySlug } from './constraints.js';
import { slugOf, validateResourceRef } from './resource-ref.js';
import { sanitizeText } from './safe-output.js';
import type { GhPrListReferences, GhPrListResult, GhPrListRow, GhResourceRef } from './types.js';

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
  | { readonly ok: false; readonly reason: 'not_json' | 'not_array' | 'row_shape' | 'invalid_identifier' };

/** 참조를 만들 검증된 실행 컨텍스트 — 서버 설정의 호스트와 재검증한 저장소. */
export interface PrListResultContext {
  readonly host: string;
  readonly repository: RepositorySlug;
}

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

function toRow(raw: unknown, numberSelected: boolean): GhPrListRow | 'row_shape' | 'invalid_identifier' {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'row_shape';
  const record = raw as Record<string, unknown>;
  let number: number | null = null;
  if (numberSelected) {
    const value = record['number'];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return 'invalid_identifier';
    number = value;
  }

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
  context: PrListResultContext,
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

  const numberSelected = fields.includes('number');
  const rows: GhPrListRow[] = [];
  for (const item of parsed) {
    const row = toRow(item, numberSelected);
    if (typeof row === 'string') return { ok: false, reason: row };
    rows.push(row);
  }

  let references: GhPrListReferences;
  if (numberSelected) {
    const refs: GhResourceRef[] = [];
    for (const row of rows) {
      const validated = validateResourceRef({ host: context.host, kind: 'pull_request', repository: slugOf(context.repository), id: null, number: row.number, ref: null }, 'pull_request');
      if (!validated.ok) return { ok: false, reason: 'invalid_identifier' };
      refs.push(validated.ref);
    }
    references = { port: 'pull_requests', type: 'pull_request', status: 'available', reason: null, refs };
  } else {
    references = { port: 'pull_requests', type: 'pull_request', status: 'unavailable', reason: 'identity_field_not_selected', refs: [] };
  }

  return {
    ok: true,
    result: {
      schema: PR_LIST_RESULT_SCHEMA,
      rows,
      fields: [...fields],
      possiblyMore: rows.length >= limit,
      references,
    },
  };
}

/** 결과의 참조를 출력 port 값으로 옮긴다 — 바인딩 판정(`evaluateBinding`)의 입력이다. */
export function prListPortValue(result: GhPrListResult): GhPortValue {
  if (result.references.status === 'unavailable') {
    return { status: 'unavailable', port: 'pull_requests', reason: result.references.reason ?? 'identity_field_not_selected' };
  }
  return { status: 'available', port: 'pull_requests', cardinality: 'many', items: result.references.refs };
}
