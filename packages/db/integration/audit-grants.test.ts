import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migratedPool } from './helpers.js';

/**
 * FR-AUTH-004 AC-3: 애플리케이션 롤은 감사 기록을 고치거나 지울 수 없다.
 *
 * 롤로 실제 로그인하는 대신 `has_table_privilege`로 권한 자체를 확인한다.
 * 권한 부재가 검증 대상이므로, 부여된 적 없는 권한을 시도해 오류를 보는 것보다
 * 카탈로그를 직접 읽는 편이 정확하다.
 */
describe('감사 기록 권한 (WP-002 DoD 6)', () => {
  let pool: Pool;

  const privilege = async (role: string, table: string, action: string): Promise<boolean> => {
    const result = await pool.query<{ granted: boolean }>(
      'SELECT has_table_privilege($1, $2, $3) AS granted',
      [role, table, action],
    );
    return result.rows[0]?.granted === true;
  };

  beforeAll(async () => {
    pool = await migratedPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('애플리케이션 롤이 존재한다', async () => {
    const result = await pool.query<{ rolname: string }>(
      "SELECT rolname FROM pg_roles WHERE rolname IN ('prs_app', 'prs_admin')",
    );
    expect(result.rows.map((row) => row.rolname).sort()).toEqual(['prs_admin', 'prs_app']);
  });

  it('애플리케이션 롤은 audit_record에 INSERT와 SELECT를 갖는다', async () => {
    expect(await privilege('prs_app', 'audit_record', 'INSERT')).toBe(true);
    expect(await privilege('prs_app', 'audit_record', 'SELECT')).toBe(true);
  });

  it('애플리케이션 롤은 audit_record에 UPDATE·DELETE를 갖지 않는다', async () => {
    expect(await privilege('prs_app', 'audit_record', 'UPDATE')).toBe(false);
    expect(await privilege('prs_app', 'audit_record', 'DELETE')).toBe(false);
  });

  it('감사 기록 외의 테이블에는 UPDATE·DELETE가 있다', async () => {
    expect(await privilege('prs_app', 'job', 'UPDATE')).toBe(true);
    expect(await privilege('prs_app', 'dead_letter', 'DELETE')).toBe(true);
  });
});
