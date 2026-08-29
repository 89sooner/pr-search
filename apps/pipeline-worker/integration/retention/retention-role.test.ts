/**
 * 보존 잡이 **실제 관리 롤로** 파티션을 만들고 지운다 — 실제 PostgreSQL
 * (WP-039 / CR-054, PR #84 리뷰 P1, DEV-421).
 *
 * ## 왜 별도 파일인가
 *
 * `partition-retention.test.ts`는 **마이그레이션 소유자 풀**로 돈다. 그 연결은
 * 이미 소유자라 두 제약(스키마 `CREATE`, 테이블 소유권)을 아예 만나지 않는다 —
 * 그래서 그 시험 전부가 초록인 동안 **운영에서는 `JOB-AUD-001`이 자기 일의
 * 어느 절반도 하지 못했다.**
 *
 * 여기서는 `ADMIN_DATABASE_URL`이 실제로 가리킬 모양 그대로 접속한다: 로그인
 * 가능한 주체가 `prs_admin` 멤버십을 갖고, `createAdminPool`이 연결마다
 * `SET ROLE prs_admin`을 건다. **권한 경계를 흉내 내지 않고 그대로 통과시킨다.**
 *
 * ## 시험 주체를 만들고 지운다
 *
 * 롤은 클러스터 전역이므로 이름에 이 파일 고유 접두를 쓰고 `afterAll`에서
 * 반드시 지운다. 남기면 다음 실행의 `CREATE ROLE`이 실패한다.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createAdminPool,
  createPool,
  listPartitionBounds,
  partitionName,
  resolvePoolConfig,
  runPartitionRetention,
  type Pool,
} from '@prs/db';
import { migrateUp } from '@prs/db/migrate';

const ROLE = 'prs_wp039_retention';
const PASSWORD = 'wp039-retention-test';
const NOW = new Date('2026-08-29T00:00:00.000Z');

let owner: Pool;
let admin: Pool | null;
const created: string[] = [];

function adminUrl(): string {
  const base = process.env['DATABASE_URL'];
  if (base !== undefined && base !== '') {
    const url = new URL(base);
    url.username = ROLE;
    url.password = PASSWORD;
    return url.toString();
  }
  const host = process.env['POSTGRES_HOST'] ?? 'localhost';
  const port = process.env['POSTGRES_PORT'] ?? '5432';
  const db = process.env['POSTGRES_TEST_DB'] ?? 'prs_test';
  return `postgres://${ROLE}:${PASSWORD}@${host}:${port}/${db}`;
}

async function makePartition(table: 'raw_event' | 'audit_record', month: string): Promise<string> {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const name = partitionName(table, start);
  await owner.query(
    `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF ${table}
     FOR VALUES FROM ('${start.toISOString().slice(0, 10)}') TO ('${end.toISOString().slice(0, 10)}')`,
  );
  // 소유권도 옮긴다 — 마이그레이션 019가 기존 자식에게 하는 것과 같다.
  await owner.query(`ALTER TABLE ${name} OWNER TO prs_admin`);
  created.push(name);
  return name;
}

beforeAll(async () => {
  const env = { ...process.env };
  if (env['DATABASE_URL'] === undefined || env['DATABASE_URL'] === '') {
    env['POSTGRES_DB'] = env['POSTGRES_TEST_DB'] ?? 'prs_test';
  }
  owner = createPool(resolvePoolConfig(env));
  await migrateUp(owner);

  await owner.query(`DROP ROLE IF EXISTS ${ROLE}`);
  await owner.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}'`);
  await owner.query(`GRANT prs_admin TO ${ROLE}`);

  admin = createAdminPool({ connectionString: adminUrl() });
}, 90_000);

afterEach(async () => {
  for (const name of created.splice(0)) {
    await owner.query(`DROP TABLE IF EXISTS ${name}`);
  }
});

afterAll(async () => {
  await admin?.end();
  // 롤은 클러스터 전역이다. 반드시 지운다.
  await owner?.query(`DROP ROLE IF EXISTS ${ROLE}`);
  await owner?.end();
});

describe('관리 연결이 실제로 선다', () => {
  it('`ADMIN_DATABASE_URL`이 없으면 `null`이다 — 잡만 서지 않는다', () => {
    expect(createAdminPool(null)).toBeNull();
  });

  it('로그인 주체로 접속해 `SET ROLE prs_admin`이 걸린다', async () => {
    const result = await (admin as Pool).query<{ role: string }>('SELECT current_user AS role');
    // `SET ROLE`이 걸렸으면 `current_user`가 그 롤이다.
    expect(result.rows[0]?.role).toBe('prs_admin');
  });
});

describe('관리 롤이 파티션을 만들고 지운다 (PR #84 리뷰 P1)', () => {
  it('**다가올 파티션을 만든다** — 스키마 `CREATE` 권한이 있다', async () => {
    const far = new Date('2027-06-15T00:00:00.000Z');
    const result = await runPartitionRetention(admin as Pool, far, 1);
    for (const name of result.created) created.push(name);

    expect(result.created.length).toBeGreaterThan(0);
    expect(result.failed).toHaveLength(0);
  });

  it('**만료 파티션을 지운다** — 소유권이 있다', async () => {
    const old = await makePartition('audit_record', '2023-02');
    const result = await runPartitionRetention(admin as Pool, NOW);
    for (const name of result.created) created.push(name);

    expect(result.dropped.map((d) => d.name)).toContain(old);
    expect(result.failed).toHaveLength(0);
    created.splice(created.indexOf(old), 1);

    const remaining = (await listPartitionBounds(owner, 'audit_record')).map((b) => b.name);
    expect(remaining).not.toContain(old);
  });

  it('원본 파티션도 같은 권한으로 지운다', async () => {
    const old = await makePartition('raw_event', '2021-02');
    const result = await runPartitionRetention(admin as Pool, NOW);
    for (const name of result.created) created.push(name);

    expect(result.dropped.map((d) => d.name)).toContain(old);
    created.splice(created.indexOf(old), 1);
  });
});

describe('감사 불변성은 그대로다 (FR-AUTH-004 AC-3)', () => {
  it('**`prs_app`은 여전히 `INSERT`·`SELECT`만 갖는다** — 소유권 이전이 그것을 바꾸지 않았다', async () => {
    const result = await owner.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'audit_record' AND grantee = 'prs_app'`,
    );
    const privileges = result.rows.map((row) => row.privilege_type).sort();
    expect(privileges).toEqual(['INSERT', 'SELECT']);
  });

  it('**`prs_app`은 소유자가 아니다** — 드롭도 할 수 없다', async () => {
    const result = await owner.query<{ owner: string }>(
      `SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname = 'audit_record'`,
    );
    expect(result.rows[0]?.owner).toBe('prs_admin');
    expect(result.rows[0]?.owner).not.toBe('prs_app');
  });
});
