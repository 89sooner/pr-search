/**
 * 의미 오버라이드 — 실행을 여는 capability의 정의 (ADR-015, WP-045·WP-061·WP-066 일부).
 *
 * **이 판이 여는 것은 `pr list` 하나다** (REL-007 R0). 인벤토리 전체는 manifest에
 * 실리되 실행 차원은 `not_implemented`로 남는다 — 그 사유를 호스트 미지원이나
 * 정책 차단으로 위장하지 않는다.
 *
 * 옵션은 공식 `gh pr list --help`(2.97.0)와 대조했다. 열지 않은 flag는 그럴 이유가
 * 있다:
 *
 * | flag | 열지 않은 이유 |
 * | --- | --- |
 * | `--web` | 실행기에서 브라우저를 띄우지 않는다 (ADR-019). 웹 등가는 WP-063 |
 * | `--jq`·`--template` | 임의 표현식이다. 결과 계약이 typed 행을 주므로 필요도 없다 |
 * | `--search`·`--author`·`--label`… | 자유 문자열이 argv로 간다. 다음 판에서 제약 모델과 함께 연다 |
 * | `--limit` 상한 100 | gh 기본 30, 상한은 서버가 강제한다. 목록 화면 한 페이지 크기다 |
 */

import { PR_LIST_RESULT_SCHEMA } from './classification/ports.js';
import { PR_LIST_DEFAULT_JSON_FIELDS, PR_LIST_JSON_FIELDS } from './result.js';
import type { GhCapabilityDefinition } from './types.js';

export const PR_LIST_CAPABILITY_ID = 'pr.list' as const;

/** R0 읽기 명령의 시간 상한. NFR-011의 p95 5초에 여유를 두되 무제한은 아니다. */
export const R0_READ_TIMEOUT_MS = 30_000;

export const PR_LIST_CAPABILITY: GhCapabilityDefinition = {
  id: PR_LIST_CAPABILITY_ID,
  path: ['pr', 'list'],
  title: 'PR 목록 조회',
  risk: 'R0',
  support: 'supported',
  execution: 'allowed',
  interaction: 'web_native',
  // 공식 문서: `GET /repos/{owner}/{repo}/pulls`와 GraphQL `pullRequests`는 Pull requests: read.
  requiredPermissions: ['pull_requests:read'],
  options: [
    {
      kind: 'enum',
      flag: '--state',
      values: ['open', 'closed', 'merged', 'all'],
      defaultValue: 'open',
      label: 'PR 상태',
    },
    {
      kind: 'int',
      flag: '--limit',
      min: 1,
      max: 100,
      defaultValue: 30,
      label: '조회 건수',
    },
    {
      kind: 'json_fields',
      flag: '--json',
      allowed: PR_LIST_JSON_FIELDS,
      defaultValue: PR_LIST_DEFAULT_JSON_FIELDS,
      minItems: 1,
      maxItems: PR_LIST_JSON_FIELDS.length,
      label: 'JSON 필드',
    },
  ],
  constraints: [{ kind: 'context_required', context: 'repository' }],
  /*
   * 실행기가 **구현한** adapter뿐이다 (CR-089). 결과가 무엇이고 어디에 이을 수 있는지(종류·자원·port·composability)는
   * 분류의 결과 계약이 정본이며 여기에 복사하지 않는다 — 검증기가 스키마·port 이름이 계약과 같은지 건다.
   */
  resultAdapter: { mode: 'json', adapter: 'native_json', schema: PR_LIST_RESULT_SCHEMA, outputPort: 'pull_requests' },
  timeoutMs: R0_READ_TIMEOUT_MS,
};

/** 실행을 여는 capability 전부. 순서가 manifest 순서다. */
export const EXECUTABLE_CAPABILITIES: readonly GhCapabilityDefinition[] = [PR_LIST_CAPABILITY];

/** 실행기가 결과를 실제로 만드는 스키마. 결과 계약에 스키마가 정의돼 있다는 것과 다른 사실이다. */
export const IMPLEMENTED_RESULT_SCHEMAS: readonly string[] = [PR_LIST_RESULT_SCHEMA];

export function findCapability(id: string): GhCapabilityDefinition | undefined {
  return EXECUTABLE_CAPABILITIES.find((capability) => capability.id === id);
}

/** command path → capability id. `['pr','list']` → `pr.list`. */
export function capabilityIdOf(path: readonly string[]): string {
  return path.join('.');
}
