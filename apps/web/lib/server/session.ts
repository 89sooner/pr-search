import 'server-only';

/**
 * `web`의 세션 저장소 (WP-015 / CR-018 DEV-071).
 *
 * **`search-api`와 같은 Redis를 쓴다.** 그래야 `web`이 발급한 세션을
 * `search-api`가 그대로 해석한다 (DEV-047). 두 곳이 각자 세션을 가지면
 * 로그아웃이 한쪽에서만 성립한다.
 *
 * 이 접근은 CR-018 DEV-071이 인프라 허용 목록에 `web` → Redis를 더해
 * 열어 준 것이다 — 그 전에는 네트워크 정책이 막았다.
 */

import { createRedisClient, type Redis } from '@prs/bus';
import { SessionStore, type SessionRedis } from '@prs/authz';

let client: Redis | undefined;
let store: SessionStore | undefined;

function redisPort(redis: Redis): SessionRedis {
  return {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keys) => redis.del(...keys),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };
}

/**
 * 세션 저장소를 한 번만 만든다.
 *
 * Next.js 라우트 핸들러는 요청마다 모듈을 다시 평가하지 않으므로 모듈 수준
 * 캐시가 연결 하나를 유지한다 — 요청마다 새로 열면 Redis 연결이 금방 바닥난다.
 */
export function sessionStore(): SessionStore {
  if (store === undefined) {
    client ??= createRedisClient();
    store = new SessionStore({ redis: redisPort(client) });
  }
  return store;
}
