/**
 * 파티션 키 → 파티션 번호.
 *
 * 요구는 두 가지뿐이다. **결정론적일 것** — 같은 키는 언제 어느 프로세스에서
 * 계산해도 같은 파티션이어야 순서가 유지된다. **고르게 퍼질 것** — 한 파티션에
 * 몰리면 그 저장소의 이벤트만 밀린다.
 *
 * `JSON.stringify` 해시나 `Math.random` 같은 것을 쓰지 않는다. 전자는 키 순서에
 * 흔들리고 후자는 결정론이 없다.
 */

/** FNV-1a 32비트. 짧은 문자열에 충분히 고르고, 구현이 한눈에 검증된다. */
export function hashPartitionKey(partitionKey: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < partitionKey.length; index += 1) {
    hash ^= partitionKey.charCodeAt(index);
    // 32비트 FNV 소수(16777619) 곱셈을 시프트 합으로 편다. JS 곱셈은 53비트를
    // 넘으면 정밀도를 잃어서 그냥 곱하면 해시가 플랫폼마다 달라질 수 있다.
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash >>> 0;
}

export function partitionFor(partitionKey: string, count: number): number {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`파티션 수는 1 이상의 정수여야 한다: ${String(count)}`);
  }
  if (partitionKey === '') {
    throw new Error('파티션 키가 비어 있다. 키가 없으면 순서를 보장할 수 없다');
  }
  return hashPartitionKey(partitionKey) % count;
}

/** 0부터 count-1까지의 파티션 목록. */
export function allPartitions(count: number): readonly number[] {
  return Array.from({ length: count }, (_value, index) => index);
}
