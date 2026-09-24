/** 워커 통합 테스트 공용 헬퍼. 실제 PostgreSQL과 실제 Redis에 붙는다. */

import { createPool, ensureAllPartitions, resolvePoolConfig, type Pool } from '@prs/db';
import { migrateUp } from '@prs/db/migrate';
import { createRedisClient, type Redis } from '@prs/bus';

/**
 * 고정 과거 날짜를 쓰는 시험이 넘기는 달 (`YYYY-MM`).
 *
 * **호출부가 적는다** (DEV-509). 헬퍼가 과거를 향해 롤링 창을 열면 그 픽스처는
 * **오늘 통과하고 몇 달 뒤에 깨진다** — `DEV-500`이 정확히 그렇게 났고, 창을
 * 3개월로 좁힌 정정은 그 시한을 늦춘 것이지 없앤 것이 아니었다. 달을 쓰는
 * 자리에서 달을 선언하면 빠뜨린 순간 **즉시** 실패하므로 시한폭탄이 생기지 않는다.
 */
export interface MigratedPoolOptions {
  readonly fixtureMonths?: readonly string[];
}

/** `2026-08` → 그 달 1일 0시(UTC). 파티션 경계 계산의 기준이다. */
function monthStart(month: string): Date {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`fixtureMonths는 YYYY-MM 형식이어야 한다: ${month}`);
  }
  return new Date(`${month}-01T00:00:00.000Z`);
}

export async function migratedPool(options: MigratedPoolOptions = {}): Promise<Pool> {
  const env = { ...process.env };
  if (env['DATABASE_URL'] === undefined || env['DATABASE_URL'] === '') {
    env['POSTGRES_DB'] = env['POSTGRES_TEST_DB'] ?? 'prs_test';
  }
  const pool = createPool(resolvePoolConfig(env));
  await migrateUp(pool);
  /*
   * 기본 창은 **현재 월부터 앞으로 3개월**이다. 과거로 열지 않는다 (DEV-509) —
   * 롤링 과거 창은 고정 날짜 픽스처의 실패를 **미래로 미룰 뿐**이고, 그 실패는
   * 개발자 DB에 지난달 파티션이 남아 있어 **CI에서만** 드러난다.
   *
   * 과거 달이 필요한 시험은 `fixtureMonths`로 직접 적는다. 그 파티션은 보존 잡의
   * 드롭 대상 구간에 들어갈 수 있으나 소유자가 `prs`라 `prs_admin`이 지우지 못하므로
   * 살아남는다 — `retention-role.test.ts`는 자기 몫만 세도록 좁혔다.
   */
  await ensureAllPartitions(pool, 3);
  for (const month of options.fixtureMonths ?? []) {
    await ensureAllPartitions(pool, 1, monthStart(month));
  }
  return pool;
}

/** 워커 테스트 전용 Redis DB. 버스 계약 테스트(15번)와 겹치지 않게 13번을 쓴다. */
export function createTestRedis(): Redis {
  const base = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  return createRedisClient({
    url: `${base.replace(/\/\d+$/, '')}/13`,
    maxRetriesPerRequest: 1,
    connectTimeoutMs: 2_000,
    commandTimeoutMs: 2_000,
  });
}

/**
 * `merge_sequence` 정리를 정본 헬퍼에서 그대로 쓴다 (WP-074 / DEV-590).
 *
 * 의존 표(`mnumber_evidence`)를 먼저 회수하는 순서가 한 곳에만 있어야 한다 —
 * 앱마다 다시 쓰면 한 곳이 빠진 날 CI가 그 파일에서만 깨진다.
 */
export { clearMergeSequence } from '../../../packages/db/integration/helpers.js';

/**
 * **주인 PR 스냅숏이 없는 관계 행**을 지운다 (CR-119, DEV-764).
 *
 * 재색인은 등록된 저장소 **전부**를 다시 만든다 — 시험이 자기 저장소만 심어도 판정은 DB 전체를
 * 본다. 재구축은 PR 스냅숏과 그 PR의 유효한 `source` 연결에서 원본 커밋 문서를 만드는데, 다른 시험
 * 파일이 PR 스냅숏은 지우고(또는 `truncate`하고) 관계 행은 남기면 그 커밋에는 문서를 만들 근거가
 * 없다. 관계 replay는 그것을 「재구축이 문서를 만들지 못했다」로 읽고 잡을 실패로 만든다(CR-116의
 * fail closed) — 어느 파일 뒤에 도느냐에 따라 재색인 시험이 갈리는 원인이었다(전량 실측:
 * `mnumber`·`assign`·`author-teams`·`link-refetch`·`snapshot-bootstrap` 시험 뒤에 남는다).
 *
 * 운영에는 이 모양이 없다 — PR 스냅숏을 지우는 경로가 없고, 관측이 불완전해 남은 `source` 연결은
 * 주인 PR 스냅숏이 있으므로 재구축이 그 문서를 만든다(CR-119). 이것은 재색인 시험이 판정 전에
 * 세우는 전제이지 제품 동작을 바꾸는 것이 아니다.
 */
export async function removeOrphanCommitLinks(pool: Pool): Promise<number> {
  const result = await pool.query(
    `DELETE FROM pull_request_commit_link l
      WHERE EXISTS (SELECT 1 FROM repository r WHERE r.repository_id = l.repository_id)
        AND NOT EXISTS (SELECT 1 FROM pull_request_snapshot p
                         WHERE p.repository_id = l.repository_id AND p.pr_number = l.pr_number)`,
  );
  return result.rowCount ?? 0;
}
