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
 *
 * **배열도 같다 (CR-015, DEV-050).** `BIGINT[]`은 다른 OID(`_int8` = 1016)이고,
 * 스칼라 파서를 등록해도 배열은 문자열 배열로 남는다. WP-012의
 * `permission_cache.repository_ids`가 이 저장소의 첫 `BIGINT[]` 열이라
 * 여기서 드러났다 — 접근 범위가 `["101"]`이면 필수 접근 범위 필터의
 * `terms` 절이 문자열을 싣고, `/me`의 요약도 문자열을 내보낸다.
 */

import pg from 'pg';

/** `pg_type.oid` for int8. */
const INT8_OID = 20;
/**
 * `pg_type.oid` for int8[] (`_int8`).
 *
 * `pg`의 `TypeId` 열거에는 배열 OID가 없어 캐스팅한다. 값은
 * `select oid from pg_type where typname = '_int8'`로 확인했다.
 */
const INT8_ARRAY_OID = 1016 as Parameters<typeof pg.types.getTypeParser>[0];

let installed = false;

function toSafeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`BIGINT 값이 안전 정수 범위를 벗어났다: ${value}. 조용히 자르지 않고 실패한다`);
  }
  return parsed;
}

export function installTypeParsers(): void {
  if (installed) return;
  installed = true;

  // 배열 리터럴(`{1,2,3}`) 해석은 pg의 기본 파서에 맡기고 원소만 바꾼다.
  // **등록 전에** 잡아 두어야 한다 — 등록 후에 가져오면 자기 자신을 부른다.
  const parseInt8Array = pg.types.getTypeParser(INT8_ARRAY_OID, 'text') as (
    value: string,
  ) => (string | null)[];

  pg.types.setTypeParser(INT8_OID, toSafeInteger);
  pg.types.setTypeParser(INT8_ARRAY_OID, (value: string): (number | null)[] =>
    parseInt8Array(value).map((element) => (element === null ? null : toSafeInteger(element))),
  );
}
