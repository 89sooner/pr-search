/**
 * 접속 설정.
 *
 * 값은 환경 변수에서만 읽는다. 시크릿을 코드에 두지 않는다 (보안 문서 6장).
 * 로컬 기본값은 저장소 루트의 `docker-compose.yml`과 `.env.example`에 맞춘다.
 */

import type { PoolConfig } from 'pg';

export interface DatabaseEnv {
  readonly [key: string]: string | undefined;
}

/**
 * 우선순위: `DATABASE_URL` → 개별 `POSTGRES_*` 변수 → 로컬 기본값.
 *
 * 단일 URL을 먼저 보는 이유는 관리형 PostgreSQL과 CI 서비스 컨테이너가 대개
 * URL 하나만 주기 때문이다.
 */
export function resolvePoolConfig(env: DatabaseEnv = process.env): PoolConfig {
  const url = env['DATABASE_URL'];
  if (url !== undefined && url !== '') {
    return { connectionString: url };
  }

  return {
    host: env['POSTGRES_HOST'] ?? 'localhost',
    port: Number(env['POSTGRES_PORT'] ?? '5432'),
    database: env['POSTGRES_DB'] ?? 'prs',
    user: env['POSTGRES_USER'] ?? 'prs',
    password: env['POSTGRES_PASSWORD'] ?? 'prs',
  };
}
