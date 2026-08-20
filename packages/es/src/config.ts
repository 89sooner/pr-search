/**
 * Elasticsearch 접속 설정.
 *
 * 값은 환경 변수에서만 읽는다 (보안 문서 6장). 로컬 기본값은 저장소 루트의
 * `docker-compose.yml`과 `.env.example`에 맞춘다.
 */

import type { ClientOptions } from '@elastic/elasticsearch';

export interface ElasticsearchEnv {
  readonly [key: string]: string | undefined;
}

export function resolveClientOptions(env: ElasticsearchEnv = process.env): ClientOptions {
  const node = env['ELASTICSEARCH_NODE'] ?? 'http://localhost:9200';
  const apiKey = env['ELASTICSEARCH_API_KEY'];

  return apiKey === undefined || apiKey === '' ? { node } : { node, auth: { apiKey } };
}
