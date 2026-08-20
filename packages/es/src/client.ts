/**
 * Elasticsearch 클라이언트 팩토리.
 */

import { Client } from '@elastic/elasticsearch';
import type { ClientOptions } from '@elastic/elasticsearch';
import { resolveClientOptions } from './config.js';

export function createEsClient(options: ClientOptions = resolveClientOptions()): Client {
  return new Client(options);
}
