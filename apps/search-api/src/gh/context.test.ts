/**
 * 접근 범위 ∩ 등록 저장소 (API-GH-003, ADR-008).
 */

import { describe, expect, it } from 'vitest';
import type { RepositoryRow } from '@prs/db';
import { scopeAllowsRepository } from './context.js';

const repo = (overrides: Partial<RepositoryRow> = {}): RepositoryRow => ({
  repository_id: 4021,
  owner: 'acme',
  name: 'payments',
  org_id: 10,
  visibility: 'internal',
  sequence_branches: ['main'],
  mirror_enabled: false,
  status: 'active',
  registered_at: new Date(),
  allowed_team_ids: [77],
  snapshot_bootstrapped_at: null,
  ...overrides,
} as RepositoryRow);

const scope = (overrides: Partial<{ repositoryIds: number[]; orgIds: number[]; teamIds: number[] }> = {}) => ({
  repositoryIds: [],
  orgIds: [],
  teamIds: [],
  visibilities: [],
  refreshedAt: 0,
  version: 1,
  ...overrides,
});

describe('scopeAllowsRepository', () => {
  it('explicit 범위는 저장소 ID로 판정한다', () => {
    expect(scopeAllowsRepository(scope({ repositoryIds: [4021] }), repo())).toBe(true);
    expect(scopeAllowsRepository(scope({ repositoryIds: [1] }), repo())).toBe(false);
    // 빈 범위는 아무것도 못 본다 — org/team 모드로 떨어지지 않는다.
    expect(scopeAllowsRepository(scope(), repo())).toBe(false);
  });

  it('org_team 모드(500개 초과)는 조직·팀으로 판정한다', () => {
    const many = Array.from({ length: 501 }, (_, index) => index + 1);
    expect(scopeAllowsRepository(scope({ repositoryIds: many, orgIds: [10] }), repo())).toBe(true);
    expect(scopeAllowsRepository(scope({ repositoryIds: many, teamIds: [77] }), repo())).toBe(true);
    expect(scopeAllowsRepository(scope({ repositoryIds: many, orgIds: [11], teamIds: [1] }), repo())).toBe(false);
  });
});
