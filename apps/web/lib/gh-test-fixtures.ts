/**
 * W-010·W-021 시험 픽스처 (WP-077 / CR-086). **시험 전용이다** — 제품 코드가 가져오지 않는다.
 *
 * capability는 `@prs/gh-cli`의 실제 `pr.list` 정의에서 만든다. 손으로 옮겨 적으면 정의가 바뀔 때
 * 시험이 옛 모양을 지키고, 그 시험은 아무것도 증명하지 않는다.
 */

import { PR_LIST_CAPABILITY } from '@prs/gh-cli';
import type { CapabilitiesResponse, CapabilityView, ExecutionView, PreviewView } from './gh';

/** `API-GH-001`이 내는 모양(snake_case)으로 옮긴다 — 라우트의 변환과 같은 규칙이다. */
export const PR_LIST_VIEW: CapabilityView = {
  id: PR_LIST_CAPABILITY.id,
  path: PR_LIST_CAPABILITY.path,
  title: PR_LIST_CAPABILITY.title,
  risk: PR_LIST_CAPABILITY.risk,
  support: PR_LIST_CAPABILITY.support,
  execution: PR_LIST_CAPABILITY.execution,
  required_permissions: PR_LIST_CAPABILITY.requiredPermissions,
  options: PR_LIST_CAPABILITY.options,
  constraints: PR_LIST_CAPABILITY.constraints,
  result: PR_LIST_CAPABILITY.result,
  timeout_ms: PR_LIST_CAPABILITY.timeoutMs,
};

export const CAPABILITIES: CapabilitiesResponse = {
  gh_version: '2.97.0',
  manifest_version: 'r0.1',
  manifest_hash: 'ad00027d84b9915e5127867a778df29b1d164bb88b8e5e15d6be2c9ab820dab2',
  coverage: { leafCommands: 196, executableCommands: 1, unclassifiedLeafCommands: 195 },
  capabilities: [PR_LIST_VIEW],
  commands: [
    { id: 'pr.list', path: ['pr', 'list'], summary: 'List pull requests in a repository', section: 'CORE COMMANDS', alias_of: null, support: 'supported', execution: 'allowed', execution_reason: null, risk: 'R0' },
    { id: 'pr.ls', path: ['pr', 'ls'], summary: 'List pull requests in a repository', section: 'CORE COMMANDS', alias_of: ['pr', 'list'], support: 'supported', execution: 'not_implemented', execution_reason: '별칭은 정본 경로로만 연다', risk: 'R0' },
    { id: 'pr.merge', path: ['pr', 'merge'], summary: 'Merge a pull request', section: 'CORE COMMANDS', alias_of: null, support: 'unknown', execution: 'not_implemented', execution_reason: '이 판이 열지 않은 capability', risk: null },
    { id: 'pr.checkout', path: ['pr', 'checkout'], summary: 'Check out a pull request in git', section: 'CORE COMMANDS', alias_of: null, support: 'unsupported_by_host', execution: 'policy_blocked', execution_reason: '실행기에 작업 트리가 없다', risk: null },
  ],
};

export const PREVIEW: PreviewView = {
  capability_id: 'pr.list',
  risk: 'R0',
  argv: ['pr', 'list', '--repo', 'ghe.example.com/acme/payments', '--state', 'open', '--limit', '30', '--json', 'number,title,state,author,headRefName,baseRefName,isDraft,updatedAt,url'],
  env: [
    { key: 'GH_ENTERPRISE_TOKEN', value: '<redacted>' },
    { key: 'GH_HOST', value: 'ghe.example.com' },
    { key: 'GH_PROMPT_DISABLED', value: '1' },
  ],
  context: {
    host: 'ghe.example.com',
    repository: 'acme/payments',
    github_actor: 'alice',
    identity_status: 'connected',
    gh_version: '2.97.0',
    manifest_version: 'r0.1',
    manifest_hash: 'ad00027d84b9915e5127867a778df29b1d164bb88b8e5e15d6be2c9ab820dab2',
    required_permissions: ['pull_requests:read'],
    permission_check: 'delegated_token_intersection',
    policy: 'r0_immediate',
    timeout_ms: 30_000,
  },
  executable: true,
  blockers: [],
};

export function execution(overrides: Partial<ExecutionView> = {}): ExecutionView {
  return {
    execution_id: 7,
    state: 'succeeded',
    capability_id: 'pr.list',
    risk: 'R0',
    repository: 'acme/payments',
    host: 'ghe.example.com',
    github_actor: 'alice',
    argv: PREVIEW.argv,
    env_keys: PREVIEW.env.map((entry) => entry.key),
    gh_version: '2.97.0',
    manifest_version: 'r0.1',
    requested_at: '2026-09-13T05:00:00.000Z',
    started_at: '2026-09-13T05:00:01.000Z',
    finished_at: '2026-09-13T05:00:03.000Z',
    cancel_requested_at: null,
    exit_code: 0,
    error: null,
    result: {
      schema: 'pr_list_v1',
      rows: [
        { number: 12, title: 'Fix race <script>alert(1)</script> <img src=x onerror=alert(2)>', state: 'OPEN', url: 'https://ghe.example.com/acme/payments/pull/12', author: 'alice', headRefName: 'fix/<b>race</b>', baseRefName: 'main', isDraft: false, createdAt: null, updatedAt: '2026-09-12T00:00:00.000Z' },
        { number: 11, title: 'Add thing', state: 'OPEN', url: null, author: 'bob', headRefName: 'feat/thing', baseRefName: 'main', isDraft: true, createdAt: null, updatedAt: '2026-09-11T00:00:00.000Z' },
      ],
      row_count: 2,
      possibly_more: false,
      stdout_truncated: false,
    },
    stdout: { text: '[{"number":12}]', truncated: false },
    stderr: { text: null, truncated: false },
    output_binary: false,
    correlation_id: 'c-exec',
    invocation: { capability_id: 'pr.list', context: { repository: 'acme/payments' }, flags: { '--state': 'open', '--limit': '30' }, output: { json_fields: ['number', 'title'] } },
    ...overrides,
  };
}
