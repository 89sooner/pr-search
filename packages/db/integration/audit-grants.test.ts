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

  /*
   * **표를 열거하지 않고 전수로 묻는다** (CR-060, DEV-517).
   *
   * 마이그레이션 005는 `prs_app`에게 **표 이름을 열거해** 권한을 준다. 그 뒤에
   * 만들어진 표는 자기 마이그레이션이 `GRANT`를 함께 적지 않으면 아무 권한도 갖지
   * 못하는데, **그것을 묻는 시험이 없었다** — 이 파일도 특정 표 넷만 확인했다.
   * 그 사이 다섯 표가 권한 없이 서 있었고, `prs_app`으로 실제 접속하는 배포가
   * 처음 생기자(`WP-070` Profile A) 재색인이 `permission denied`로 죽었다.
   *
   * **통합 시험이 소유자 롤로 도는 것이 사각지대의 원인이다** — 마이그레이션을
   * 실행한 연결이 곧 소유자라 권한 제약을 만나지 않는다. `019`가 `prs_admin`에서
   * 겪은 것과 같은 모양이며, 그래서 카탈로그를 직접 읽어 묻는다.
   */
  const NO_APP_GRANT: ReadonlyMap<string, string> = new Map([
    // 스키마 이력은 마이그레이션 실행기(소유자)만 읽고 쓴다. 애플리케이션이
    // 자기 스키마 이력을 고칠 이유가 없다.
    ['schema_migration', '마이그레이션 실행기 전용'],
  ]);

  it('**모든 표가 애플리케이션 롤에 SELECT를 준다** — 제외는 사유와 함께 선언한다 (DEV-517)', async () => {
    const result = await pool.query<{ relname: string }>(`
      SELECT c.relname
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relispartition = false
       ORDER BY 1`);
    const tables = result.rows.map((row) => row.relname);
    expect(tables.length, '표를 하나도 찾지 못했다').toBeGreaterThan(10);

    const missing: string[] = [];
    for (const table of tables) {
      if (NO_APP_GRANT.has(table)) continue;
      if (!(await privilege('prs_app', table, 'SELECT'))) missing.push(table);
    }
    expect(
      missing,
      `애플리케이션 롤이 읽지 못하는 표가 있다 — 그 표를 만든 마이그레이션이 GRANT를 빠뜨렸거나, ` +
        `쓰지 않는 표라면 NO_APP_GRANT에 사유와 함께 올려라: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  /*
   * **시퀀스도 함께 묻는다** (CR-061, DEV-518).
   *
   * 005의 `GRANT ... ON ALL SEQUENCES`도 **그 시점에 존재하는 것**만 뜻한다.
   * 022가 같은 사각지대를 표에 대해 메우면서 **시퀀스는 세지 않았고**, 그래서
   * `repository_registration_request`의 `INSERT`가 표 권한을 통과한 뒤
   * `permission denied for sequence`로 막혔다 — **한 겹 더 아래에 같은 결함이
   * 있었던 것이며**, 표만 보는 검사는 그것을 잡지 못한다.
   */
  it('**모든 시퀀스가 애플리케이션 롤에 USAGE를 준다** (DEV-518)', async () => {
    const result = await pool.query<{ relname: string }>(`
      SELECT c.relname
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'S'
       ORDER BY 1`);
    const sequences = result.rows.map((row) => row.relname);
    expect(sequences.length, '시퀀스를 하나도 찾지 못했다').toBeGreaterThan(0);

    const missing: string[] = [];
    for (const sequence of sequences) {
      const granted = await pool.query<{ granted: boolean }>(
        'SELECT has_sequence_privilege($1, $2, $3) AS granted',
        ['prs_app', `public.${sequence}`, 'USAGE'],
      );
      if (granted.rows[0]?.granted !== true) missing.push(sequence);
    }
    expect(
      missing,
      `애플리케이션 롤이 쓰지 못하는 시퀀스가 있다 — 그 시퀀스를 만든 마이그레이션이 GRANT를 빠뜨렸다: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('제외 목록이 실재하지 않는 표를 담지 않는다', async () => {
    // 표가 사라졌는데 예외만 남으면 그 예외가 다음 표를 조용히 덮는다.
    for (const table of NO_APP_GRANT.keys()) {
      const found = await pool.query<{ oid: string | null }>('SELECT to_regclass($1) AS oid', [table]);
      expect(found.rows[0]?.oid, `제외 목록의 '${table}'이 실재하지 않는다`).not.toBeNull();
    }
  });
});
