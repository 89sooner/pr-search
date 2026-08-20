import type { Client } from '@elastic/elasticsearch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMappings } from '../src/bootstrap.js';
import { applyMandatoryScopeFilter } from '../src/scoped-query.js';
import { search } from '../src/search.js';
import { createTestClient, waitForCluster } from './helpers.js';

describe('매핑 동작 (WP-003 DoD 3·5)', () => {
  let client: Client;

  beforeAll(async () => {
    client = createTestClient();
    await waitForCluster(client);
    await applyMappings(client);
  }, 90_000);

  afterAll(async () => {
    await client.close();
  });

  it('DoD 3 / THR-010: 매핑에 없는 필드를 색인하면 거부된다 (dynamic: strict)', async () => {
    // 웹훅 payload에서 예기치 않은 필드가 흘러들어 소스 코드나 개인정보가
    // 색인되는 것을 매핑 수준에서 차단한다 (NFR-005).
    await expect(
      client.index({
        index: 'prs-commits',
        id: 'strict-check',
        document: { commit_sha: 'abc1234', source_code_body: '이 필드는 매핑에 없다' },
        refresh: true,
      }),
    ).rejects.toThrow(/strict_dynamic_mapping_exception|mapping set to strict/i);
  });

  it('정의된 필드만 있으면 색인된다', async () => {
    const result = await client.index({
      index: 'prs-commits',
      id: 'valid-doc',
      document: {
        repository_id: 1001,
        commit_sha: 'ABC1234DEF5678',
        message: 'fix: 결제 반올림 오류',
        role: 'merge_commit',
        merge_seq: 42,
      },
      refresh: true,
    });
    expect(['created', 'updated']).toContain(result.result);
  });

  it('DoD 5 / FR-SRCH-004 AC-4: commit_sha가 대소문자 무관하게 매칭된다', async () => {
    // 사용자는 SHA를 대문자로 붙여넣기도 한다. lowercase_normalizer가 색인 시점과
    // 질의 시점 양쪽에 적용되므로 어느 쪽이든 같은 문서를 찾는다.
    const scope = { kind: 'explicit', repositoryIds: [1001] } as const;

    const lower = await search(
      client,
      'prs-commits',
      applyMandatoryScopeFilter({ term: { commit_sha: 'abc1234def5678' } }, scope),
    );
    const upper = await search(
      client,
      'prs-commits',
      applyMandatoryScopeFilter({ term: { commit_sha: 'ABC1234DEF5678' } }, scope),
    );

    expect(lower.hits.hits.length).toBe(1);
    expect(upper.hits.hits.length).toBe(1);
    expect(upper.hits.hits[0]?._id).toBe(lower.hits.hits[0]?._id);
  });

  it('ADR-012: 축약 SHA 접두 검색이 대소문자 무관하게 동작한다', async () => {
    const result = await search(
      client,
      'prs-commits',
      applyMandatoryScopeFilter({ prefix: { commit_sha: 'ABC1234' } }, { kind: 'explicit', repositoryIds: [1001] }),
    );
    expect(result.hits.hits.length).toBe(1);
  });

  it('접근 범위 밖 저장소의 문서는 조회되지 않는다 (ADR-008)', async () => {
    const result = await search(
      client,
      'prs-commits',
      applyMandatoryScopeFilter({ match_all: {} }, { kind: 'explicit', repositoryIds: [9999] }),
    );
    expect(result.hits.hits.length).toBe(0);
  });

  it('evidence는 색인되지 않는다 (prs-links, index: false)', async () => {
    await client.index({
      index: 'prs-links',
      id: 'link-1',
      document: {
        link_id: 'link-1',
        repository_id: 1001,
        from_type: 'commit',
        from_id: 'abc',
        to_type: 'commit',
        to_id: 'def',
        link_type: 'reverts',
        confidence: 'exact',
        evidence: 'Revert "fix: 결제 반올림 오류"',
        resolved: true,
      },
      refresh: true,
    });

    // 근거 텍스트는 화면 표시용이지 검색 대상이 아니다.
    await expect(
      client.search({ index: 'prs-links', query: { match: { evidence: '결제' } } }),
    ).rejects.toThrow();
  });
});
