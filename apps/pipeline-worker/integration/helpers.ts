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
 * 문서를 만들 근거 없이 **관계만 남은 커밋**의 관계 정본을 지운다 (CR-119, DEV-763).
 *
 * 재색인은 등록된 저장소 **전부**를 다시 만든다 — 시험이 자기 저장소만 심어도 판정은 DB
 * 전체를 본다. 다른 시험 파일이 PR 스냅숏은 지우고(또는 `truncate`하고) 관계 행은 남기면,
 * 관계 replay가 그 커밋을 「재구축이 문서를 만들지 못했다」로 읽고 잡을 실패로 만든다
 * (CR-116의 fail closed). 운영에서는 PR 스냅숏을 지우지 않으므로 생기지 않는 모양이고, 어느
 * 파일 뒤에 도느냐에 따라 재색인 시험이 갈리는 원인이었다(전량 실측: `mnumber`·`assign`·
 * `author-teams`·`link-refetch`·`snapshot-bootstrap` 시험 뒤에 남는다).
 *
 * 근거는 재구축의 생성 정책과 같다: 스냅숏과 체인 행이 함께 있는 커밋, PR 스냅숏의 원본 목록에
 * 있는 커밋, 병합된 PR의 머지 커밋. 셋 다 아닌 커밋의 관계 행만 지운다 — 재색인 시험이 판정 전에
 * 세우는 전제이지 제품 동작을 바꾸는 것이 아니다.
 */
export async function removeOrphanCommitLinks(pool: Pool): Promise<number> {
  const orphans = `
    SELECT c.repository_id, c.commit_sha
      FROM commit_link_state c
      JOIN repository r ON r.repository_id = c.repository_id
     WHERE NOT EXISTS (SELECT 1 FROM commit_snapshot s
                         JOIN merge_sequence m ON m.repository_id = s.repository_id AND m.commit_sha = s.commit_sha
                        WHERE s.repository_id = c.repository_id AND s.commit_sha = c.commit_sha)
       AND NOT EXISTS (SELECT 1 FROM pull_request_snapshot p
                        WHERE p.repository_id = c.repository_id
                          AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(
                                        CASE WHEN jsonb_typeof(p.document -> 'source_commit_shas') = 'array'
                                             THEN p.document -> 'source_commit_shas' ELSE '[]'::jsonb END) AS sha
                                       WHERE lower(sha) = c.commit_sha))
       AND NOT EXISTS (SELECT 1 FROM pull_request_snapshot p
                        WHERE p.repository_id = c.repository_id
                          AND p.document ->> 'state' = 'merged'
                          AND lower(p.document ->> 'merge_commit_sha') = c.commit_sha)`;
  // 관계 행을 먼저 지운다 — 고아 판정의 열거가 `commit_link_state`에서 나오기 때문이다.
  const links = await pool.query(
    `DELETE FROM pull_request_commit_link t USING (${orphans}) o
      WHERE t.repository_id = o.repository_id AND t.commit_sha = o.commit_sha`,
  );
  const states = await pool.query(
    `DELETE FROM commit_link_state t USING (${orphans}) o
      WHERE t.repository_id = o.repository_id AND t.commit_sha = o.commit_sha`,
  );
  return (links.rowCount ?? 0) + (states.rowCount ?? 0);
}
