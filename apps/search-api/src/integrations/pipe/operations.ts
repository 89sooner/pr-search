/**
 * PIPE 연동이 여는 고정 operation 목록 (CR-112 / API-INT-001~014).
 *
 * **이 목록 밖의 경로는 등록되지 않는다.** `/read/*`는 문서상의 묶음일 뿐 catch-all proxy가 아니며
 * (계약 3.2), 각 경로가 기존 조회 하나에 1:1로 대응한다. 라우트 등록·operation map·OpenAPI 대조
 * 시험이 모두 이 배열을 정본으로 읽는다 — 한쪽만 늘어나면 시험이 깨진다.
 */

export const INTEGRATION_PREFIX = '/internal/integrations/pipe/v1' as const;

export type IntegrationAuth = 'mtls+assertion' | 'mtls+grant' | 'mtls+grant-optional';

export interface IntegrationOperation {
  /** 이벤트 기록·지표 라벨에 쓰는 유한한 이름. */
  readonly id: string;
  readonly apiId: string;
  readonly method: 'GET' | 'POST';
  /** Fastify 경로 (접두 제외). */
  readonly path: string;
  readonly auth: IntegrationAuth;
  /** 받는 query key. 이 밖의 key·같은 key의 중복은 400이다. */
  readonly queryKeys: readonly string[];
  /** 이 operation이 그대로 실행하는 기존 조회. 연동 전용 operation이면 `null`. */
  readonly original: { readonly apiId: string; readonly method: 'GET'; readonly path: string } | null;
}

export const SEARCH_QUERY_KEYS = ['q', 'sort', 'order', 'size', 'cursor', 'facets', 'seq_epoch'] as const;

export const INTEGRATION_OPERATIONS: readonly IntegrationOperation[] = [
  { id: 'auth.exchange', apiId: 'API-INT-001', method: 'POST', path: '/auth/exchange', auth: 'mtls+assertion', queryKeys: [], original: null },
  { id: 'auth.revoke', apiId: 'API-INT-002', method: 'POST', path: '/auth/revoke', auth: 'mtls+grant-optional', queryKeys: [], original: null },
  { id: 'auth.revoke_context', apiId: 'API-INT-003', method: 'POST', path: '/auth/revoke-context', auth: 'mtls+assertion', queryKeys: [], original: null },
  { id: 'context', apiId: 'API-INT-004', method: 'GET', path: '/context', auth: 'mtls+grant', queryKeys: [], original: null },
  {
    id: 'read.repositories',
    apiId: 'API-INT-005',
    method: 'GET',
    path: '/read/repositories',
    auth: 'mtls+grant',
    queryKeys: ['limit', 'cursor', 'repository'],
    original: { apiId: 'API-ING-002', method: 'GET', path: '/api/v1/repositories' },
  },
  {
    id: 'read.search',
    apiId: 'API-INT-006',
    method: 'GET',
    path: '/read/search',
    auth: 'mtls+grant',
    queryKeys: SEARCH_QUERY_KEYS,
    original: { apiId: 'API-SRCH-004', method: 'GET', path: '/api/v1/search' },
  },
  {
    id: 'read.resolve',
    apiId: 'API-INT-007',
    method: 'GET',
    path: '/read/resolve',
    auth: 'mtls+grant',
    queryKeys: ['q', 'repository', 'limit'],
    original: { apiId: 'API-SRCH-001', method: 'GET', path: '/api/v1/resolve' },
  },
  {
    id: 'read.merge_numbers.resolve',
    apiId: 'API-INT-008',
    method: 'GET',
    path: '/read/merge-numbers/resolve',
    auth: 'mtls+grant',
    queryKeys: ['repository', 'base_branch', 'pr_number', 'merge_number', 'seq_epoch'],
    original: { apiId: 'API-SEQ-007', method: 'GET', path: '/api/v1/merge-numbers/resolve' },
  },
  {
    id: 'read.pull_request',
    apiId: 'API-INT-009',
    method: 'GET',
    path: '/read/pull-requests/:repository/:pr_number',
    auth: 'mtls+grant',
    queryKeys: [],
    original: { apiId: 'API-SRCH-003', method: 'GET', path: '/api/v1/pull-requests/:repository/:pr_number' },
  },
  {
    id: 'read.commit',
    apiId: 'API-INT-010',
    method: 'GET',
    path: '/read/commits/:repository/:commit_sha',
    auth: 'mtls+grant',
    queryKeys: [],
    original: { apiId: 'API-SRCH-002', method: 'GET', path: '/api/v1/commits/:repository/:commit_sha' },
  },
  {
    id: 'read.source.tree',
    apiId: 'API-INT-011',
    method: 'GET',
    path: '/read/source/:repository/tree',
    auth: 'mtls+grant',
    queryKeys: ['ref', 'path', 'revision', 'tree_sha'],
    original: { apiId: 'API-SRC-001', method: 'GET', path: '/api/v1/source/:repository/tree' },
  },
  {
    id: 'read.source.history',
    apiId: 'API-INT-012',
    method: 'GET',
    path: '/read/source/:repository/history',
    auth: 'mtls+grant',
    queryKeys: ['ref', 'path', 'page'],
    original: { apiId: 'API-SRC-002', method: 'GET', path: '/api/v1/source/:repository/history' },
  },
  {
    id: 'read.source.diff',
    apiId: 'API-INT-013',
    method: 'GET',
    path: '/read/source/:repository/diff',
    auth: 'mtls+grant',
    queryKeys: ['pr', 'commit', 'page'],
    original: { apiId: 'API-SRC-004', method: 'GET', path: '/api/v1/source/:repository/diff' },
  },
  {
    id: 'read.source.file',
    apiId: 'API-INT-014',
    method: 'GET',
    path: '/read/source/:repository/file',
    auth: 'mtls+grant',
    queryKeys: ['path', 'revision'],
    original: { apiId: 'API-SRC-003', method: 'GET', path: '/api/v1/source/:repository/file' },
  },
];

export function operationById(id: string): IntegrationOperation {
  const found = INTEGRATION_OPERATIONS.find((operation) => operation.id === id);
  if (found === undefined) throw new Error(`알 수 없는 연동 operation: ${id}`);
  return found;
}

/** 이 연동이 부여하는 능력. 역할(`operator` 등)과 무관하다 — assertion은 역할을 싣지 않는다. */
export const BASE_CAPABILITIES = ['search:read', 'source:read'] as const;
export const MERGE_NUMBER_CAPABILITY = 'merge_number:read' as const;
