/**
 * 저장소 등록 상태 표식 (WP-010 DoD, FR-ING-009 AC-3, CR-013 DEV-028).
 *
 * 실제 Elasticsearch에 붙는다. `dynamic: strict` 때문에 매핑에 없는 필드는
 * 거부되므로, 커밋 문서에 표식을 붙일 수 있는지는 **실제 클러스터에 써 봐야**
 * 알 수 있다 — 목으로는 이 결함을 못 찾는다.
 */

import type { Client } from '@elastic/elasticsearch';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMappings } from '../src/bootstrap.js';
import { ARCHIVABLE_ALIASES, markRepositoryArchived } from '../src/registry.js';
import { createTestClient, waitForCluster } from './helpers.js';

const REPOSITORY_ID = 90210;
const OTHER_REPOSITORY_ID = 90211;

describe('저장소 등록 상태 표식 (WP-010, FR-ING-009 AC-3)', () => {
  let client: Client;

  beforeAll(async () => {
    client = createTestClient();
    await waitForCluster(client);
    await applyMappings(client);
  }, 90_000);

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    for (const alias of ARCHIVABLE_ALIASES) {
      await client.deleteByQuery({
        index: alias,
        refresh: true,
        conflicts: 'proceed',
        query: { terms: { repository_id: [REPOSITORY_ID, OTHER_REPOSITORY_ID] } },
      });
    }
  });

  async function seed(repositoryId: number, archived: boolean): Promise<void> {
    await client.index({
      index: 'prs-pull-requests',
      id: `${String(repositoryId)}:1`,
      routing: String(repositoryId),
      document: {
        document_version: 100,
        repository_id: repositoryId,
        repository: 'acme/payments',
        pr_number: 1,
        repository_archived: archived,
      },
      refresh: true,
    });
    await client.index({
      index: 'prs-commits',
      id: `${String(repositoryId)}:abc1234`,
      routing: String(repositoryId),
      document: {
        document_version: 100,
        repository_id: repositoryId,
        repository: 'acme/payments',
        commit_sha: 'abc1234',
        role: 'source_commit',
        repository_archived: archived,
      },
      refresh: true,
    });
  }

  it('DEV-028: 커밋 문서도 표식을 받는다 — 매핑이 그 필드를 갖는다', async () => {
    // 매핑에 없었다면 `strict_dynamic_mapping_exception`으로 여기서 실패한다.
    await seed(REPOSITORY_ID, false);
    const result = await markRepositoryArchived(client, REPOSITORY_ID, true);

    expect(result.total).toBe(2);
    expect(result.updated['prs-commits']).toBe(1);
    expect(result.updated['prs-pull-requests']).toBe(1);

    const commit = await client.get<{ repository_archived: boolean }>({
      index: 'prs-commits',
      id: `${String(REPOSITORY_ID)}:abc1234`,
      routing: String(REPOSITORY_ID),
    });
    expect(commit._source?.repository_archived).toBe(true);
  });

  it('document_version을 올리지 않는다', async () => {
    // 올리면 뒤늦게 도착한 정상 웹훅이 "오래된 이벤트"로 밀려 사라진다.
    await seed(REPOSITORY_ID, false);
    await markRepositoryArchived(client, REPOSITORY_ID, true);

    const pr = await client.get<{ document_version: number }>({
      index: 'prs-pull-requests',
      id: `${String(REPOSITORY_ID)}:1`,
      routing: String(REPOSITORY_ID),
    });
    expect(pr._source?.document_version).toBe(100);
  });

  it('다른 저장소의 문서는 건드리지 않는다', async () => {
    await seed(REPOSITORY_ID, false);
    await seed(OTHER_REPOSITORY_ID, false);
    await markRepositoryArchived(client, REPOSITORY_ID, true);

    const other = await client.get<{ repository_archived: boolean }>({
      index: 'prs-commits',
      id: `${String(OTHER_REPOSITORY_ID)}:abc1234`,
      routing: String(OTHER_REPOSITORY_ID),
    });
    expect(other._source?.repository_archived).toBe(false);
  });

  it('이미 같은 값인 문서는 세지 않는다', async () => {
    await seed(REPOSITORY_ID, true);
    expect((await markRepositoryArchived(client, REPOSITORY_ID, true)).total).toBe(0);
  });

  it('재등록하면 표식이 풀린다', async () => {
    await seed(REPOSITORY_ID, true);
    expect((await markRepositoryArchived(client, REPOSITORY_ID, false)).total).toBe(2);

    const commit = await client.get<{ repository_archived: boolean }>({
      index: 'prs-commits',
      id: `${String(REPOSITORY_ID)}:abc1234`,
      routing: String(REPOSITORY_ID),
    });
    expect(commit._source?.repository_archived).toBe(false);
  });
});
