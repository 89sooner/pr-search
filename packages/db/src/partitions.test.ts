/**
 * 파티션 수명 판정 (WP-039 / JOB-AUD-001, FR-ING-003 AC-4, NFR-006, CR-054).
 *
 * **실제 DB 없이 거는 것은 판정뿐이다** — 드롭 자체는 통합 시험이 실제
 * PostgreSQL에서 확인한다. 여기서 묻는 것은 "무엇을 지울 대상으로 보는가"이며,
 * 그것이 되돌릴 수 없는 동작을 정하는 재료다.
 */

import { describe, expect, it } from 'vitest';
import { PARTITIONED_TABLES, RETENTION_MONTHS, partitionName, retentionCutoff } from './partitions.js';

const NOW = new Date('2026-08-29T00:00:00.000Z');

describe('보존 기간', () => {
  it('승인된 값이다 — `raw_event` 3년, `audit_record` 1년', () => {
    // OD-003(CR-004)과 NFR-006. 이 수가 바뀌면 데이터가 사라지므로 시험이 건다.
    expect(RETENTION_MONTHS.raw_event).toBe(36);
    expect(RETENTION_MONTHS.audit_record).toBe(12);
    // NFR-012 「실행 기록 보존 1년」 (REL-007 R0 / WP-077).
    expect(RETENTION_MONTHS.gh_execution).toBe(12);
  });

  it('두 표 모두 값을 갖는다', () => {
    for (const table of PARTITIONED_TABLES) {
      expect(RETENTION_MONTHS[table], table).toBeGreaterThan(0);
    }
  });
});

describe('보존 기준 시각', () => {
  it('`audit_record`는 1년 전 월초다', () => {
    expect(retentionCutoff('audit_record', NOW).toISOString()).toBe('2025-08-01T00:00:00.000Z');
  });

  it('`raw_event`는 3년 전 월초다', () => {
    expect(retentionCutoff('raw_event', NOW).toISOString()).toBe('2023-08-01T00:00:00.000Z');
  });

  it('월 경계를 넘어도 월초로 정렬된다', () => {
    const eom = new Date('2026-01-31T23:59:59.000Z');
    expect(retentionCutoff('audit_record', eom).toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });
});

/**
 * 드롭 조건은 `파티션 상한 <= 기준 시각`이다.
 *
 * **경계에 걸친 값을 직접 묻는다** — 픽스처가 경계를 비켜 가면 그 규칙은
 * 코드에만 있고 시험에는 없다 (WP-037 세션의 M7이 그렇게 살아남았다).
 */
describe('드롭 판정 경계', () => {
  const cutoff = retentionCutoff('audit_record', NOW);
  const shouldDrop = (upper: string): boolean =>
    new Date(upper).getTime() <= cutoff.getTime();

  it('기준과 **같은** 상한은 지운다 — 그 파티션의 마지막 순간이 기준이다', () => {
    expect(shouldDrop('2025-08-01T00:00:00.000Z')).toBe(true);
  });

  it('기준보다 하루 뒤 상한은 남긴다 — 보존 기간 안의 행이 있다', () => {
    expect(shouldDrop('2025-08-02T00:00:00.000Z')).toBe(false);
  });

  it('기준보다 한 달 앞선 상한은 지운다', () => {
    expect(shouldDrop('2025-07-01T00:00:00.000Z')).toBe(true);
  });

  it('현재 월 파티션은 남는다', () => {
    expect(shouldDrop('2026-09-01T00:00:00.000Z')).toBe(false);
  });

  it('미래 파티션은 남는다', () => {
    expect(shouldDrop('2026-12-01T00:00:00.000Z')).toBe(false);
  });
});

describe('파티션 이름', () => {
  it('표와 연월로 만든다', () => {
    expect(partitionName('audit_record', new Date('2026-08-01T00:00:00Z'))).toBe('audit_record_2026_08');
  });

  it('한 자리 월을 0으로 채운다 — 이름 정렬이 시간 순서와 같아야 한다', () => {
    expect(partitionName('raw_event', new Date('2026-01-01T00:00:00Z'))).toBe('raw_event_2026_01');
  });

  /*
   * **이름은 판정의 근거가 아니다** (CR-054 §41). 이 시험이 확인하는 것은
   * 생성 규칙뿐이며, 드롭은 시스템 카탈로그의 실제 경계를 읽는다
   * (`listPartitionBounds`). 손으로 만든 파티션이나 다른 규칙으로 붙은 이름이
   * 하나라도 있으면 이름 기반 판정은 살아 있는 데이터를 지운다.
   */
  it('식별자 형태다 — 조립되는 SQL에 들어간다', () => {
    for (const table of PARTITIONED_TABLES) {
      expect(partitionName(table, NOW), table).toMatch(/^[a-z_][a-z0-9_]*$/);
    }
  });
});
