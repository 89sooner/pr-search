/**
 * ES 통합 테스트 공용 헬퍼.
 *
 * 실제 Elasticsearch에 붙는다. 접속 정보는 `ELASTICSEARCH_NODE`에서 읽고,
 * 없으면 로컬 기본값(`http://localhost:9200`)을 쓴다.
 */

import type { Client } from '@elastic/elasticsearch';
import { createEsClient } from '../src/client.js';
import { resolveClientOptions } from '../src/config.js';

export function createTestClient(): Client {
  return createEsClient(resolveClientOptions());
}

/** 클러스터가 뜰 때까지 기다린다. CI 서비스 컨테이너가 준비되기 전에 붙을 수 있다. */
export async function waitForCluster(client: Client, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await client.cluster.health({ wait_for_status: 'yellow', timeout: '5s' });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error(`Elasticsearch가 준비되지 않았다: ${String(lastError)}`);
}
