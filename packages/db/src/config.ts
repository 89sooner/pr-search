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

/**
 * 보존 잡이 쓰는 관리 연결 (WP-039 / CR-054, DEV-411·416).
 *
 * ## 왜 별도인가
 *
 * 파티션 드롭에는 `prs_admin`의 권한이 필요한데, 애플리케이션 롤 `prs_app`에
 * `DROP`을 주면 **감사 기록 불변성의 마지막 방어선이 사라진다** (FR-AUTH-004
 * AC-3, 마이그레이션 005). 그래서 그 권한은 별도 연결로만 닿는다.
 *
 * ## `prs_admin`으로 직접 접속하지 않는다
 *
 * 마이그레이션 005는 `prs_app`·`prs_admin`을 둘 다 `NOLOGIN` **그룹 롤**로
 * 만든다 — 권한의 묶음이지 접속 주체가 아니다. 그래서 이 URL은 **로그인
 * 가능한 주체**로 접속하고, 그 주체가 `prs_admin` 멤버십을 가지며, 잡이
 * 연결 직후 `SET ROLE prs_admin`으로 권한을 집는다 (PR #83 리뷰, DEV-416).
 *
 * 소유자 계정(`prs`)을 그대로 쓰지 않는 이유는 그것이 모든 표에 전권을 갖기
 * 때문이다. `SET ROLE`은 **필요한 권한만 집는 경계**다.
 *
 * @returns 설정이 없으면 `null`. 그때 보존 잡만 기동하지 않고 나머지 배치
 * 역할은 정상 동작한다 — 설정 하나가 없어서 워커 전체가 뜨지 않으면 실시간
 * 경로까지 함께 죽는다.
 */
export function resolveAdminPoolConfig(env: DatabaseEnv = process.env): PoolConfig | null {
  const url = env['ADMIN_DATABASE_URL'];
  if (url === undefined || url === '') return null;
  return { connectionString: url };
}

/** 관리 연결이 집을 롤. `SET ROLE`의 인자이며 식별자라 바인딩할 수 없다. */
export const ADMIN_DB_ROLE = 'prs_admin';
