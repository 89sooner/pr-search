/**
 * PostgreSQL 타입 파서 (WP-005에서 발견).
 *
 * **node-postgres는 `BIGINT`(int8)를 기본으로 문자열로 준다.** JavaScript의
 * `number`가 2^53까지만 정확해서, 라이브러리가 임의로 정밀도를 버리지 않으려는
 * 선택이다. 그런데 이 저장소의 리포지터리 타입은 `repository_id: number`처럼
 * 숫자로 선언되어 있었다 — 타입은 숫자인데 런타임 값은 문자열이었다.
 *
 * 조용히 넘어가면 `repository_id`가 파티션 키나 이벤트 payload에 `"4021"`로
 * 실려 나가고, 소비자 쪽 `===` 비교가 전부 어긋난다. 실제로 WP-005의
 * 아웃박스 재적재 테스트가 이걸 잡았다.
 *
 * 그래서 int8을 숫자로 바꾸되, 안전 정수 범위를 넘으면 **던진다**. 조용히
 * 잘린 ID로 잘못된 저장소를 가리키는 것보다 즉시 실패하는 편이 낫다.
 * 이 시스템의 int8 컬럼은 GitHub 저장소·사용자 ID와 서수·일련번호라
 * 2^53 근처에 갈 일이 없다.
 */

import pg from 'pg';

/** `pg_type.oid` for int8. */
const INT8_OID = 20;

let installed = false;

export function installTypeParsers(): void {
  if (installed) return;
  installed = true;

  pg.types.setTypeParser(INT8_OID, (value: string): number => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error(
        `BIGINT 값이 안전 정수 범위를 벗어났다: ${value}. 조용히 자르지 않고 실패한다`,
      );
    }
    return parsed;
  });
}
