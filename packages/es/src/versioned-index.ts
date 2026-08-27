/**
 * 버전 인덱스와 원자 별칭 전환 (WP-035 / FR-ING-008, CR-045·046).
 *
 * ## 왜 `bootstrap.ts`로 부족한가
 *
 * `applyMappings`는 **하위 호환 변경**을 제자리에서 반영한다(필드 추가). 그것으로
 * 충분하지 않은 변경이 둘 있고, 둘 다 실제 Elasticsearch 8로 재어 확인했다
 * (CR-043, DEV-266·267).
 *
 *   1. `index.analysis`는 **비동적 설정**이라 열린 인덱스에 넣을 수 없다
 *   2. `putMapping`으로 더한 서브필드는 **기존 문서에서 비어 있다** —
 *      배포는 성공하고 검색만 과거 데이터에 조용히 적게 답한다
 *
 * 두 번째가 더 무겁다. 첫 번째는 배포가 터지므로 반드시 발견되지만, 두 번째는
 * 아무도 모른다. 그래서 새 버전 인덱스를 처음부터 만들고 정본에서 채운 뒤
 * 별칭을 옮긴다.
 *
 * ## 이 파일이 하지 않는 것
 *
 * 재색인 **절차**는 여기 없다 — 잡 상태·울타리·정본 스캔은 애플리케이션 계층이다.
 * 여기는 "버전 이름을 만들고, 세고, 만들고, 별칭을 옮긴다"는 기계뿐이다.
 */

import type { Client, estypes } from '@elastic/elasticsearch';
import { ENTITY_ALIASES, findIndexDefinition, type EntityAlias } from './indices.js';

/** 이 별칭의 `v<N>` 인덱스 이름. */
export function concreteIndexName(alias: string, version: number): string {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`버전은 1 이상의 정수여야 한다: ${String(version)}`);
  }
  return `${alias}-v${String(version)}`;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 구체 인덱스 이름에서 버전을 읽는다.
 *
 * **접두 포함 같은 느슨한 판정을 하지 않는다.** `prs-commits`의 버전을 세면서
 * `prs-commits-shadow-v2`를 같이 세면 다음 버전 계산이 틀린다. 정확히
 * `<별칭>-v<양의 정수>`만 인정하고 나머지는 `null`이다 — 무시하되 계산에
 * 섞지 않는다.
 *
 * `v01` 같은 앞자리 0도 받지 않는다. 받으면 `v1`과 `v01`이 같은 버전의 두 이름이
 * 되어 "아직 쓰이지 않은 다음 번호"가 성립하지 않는다.
 */
export function parseIndexVersion(alias: string, index: string): number | null {
  const pattern = new RegExp(`^${escapeForRegExp(alias)}-v([1-9][0-9]*)$`);
  const matched = pattern.exec(index);
  if (matched === null) return null;
  const parsed = Number(matched[1]);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** 클러스터에 실재하는 이 별칭의 버전 목록. 오름차순. */
export async function listIndexVersions(client: Client, alias: string): Promise<readonly number[]> {
  const found = await client.indices.get({
    index: `${alias}-v*`,
    // 하나도 없는 것은 정상이다 — 첫 부트스트랩 전이거나 이름이 전부 형식 밖이다.
    ignore_unavailable: true,
    expand_wildcards: 'all',
  });

  const versions: number[] = [];
  for (const name of Object.keys(found)) {
    const version = parseIndexVersion(alias, name);
    if (version !== null) versions.push(version);
  }
  return versions.sort((a, b) => a - b);
}

/**
 * 별칭이 지금 가리키는 구체 인덱스.
 *
 * 별칭이 정확히 하나를 가리킨다는 것이 이 제품의 전제다(ADR-003). 둘 이상이면
 * 쓰기 대상이 모호해지고 원자 전환의 뜻도 사라지므로 던진다.
 */
export async function resolveServingIndex(client: Client, alias: string): Promise<string> {
  const response = await client.indices.getAlias({ name: alias });
  const names = Object.keys(response);
  if (names.length === 0) throw new Error(`별칭이 없다: ${alias}`);
  if (names.length > 1) {
    throw new Error(`별칭 ${alias}가 인덱스 ${String(names.length)}개를 가리킨다: ${names.join(', ')}`);
  }
  return names[0] as string;
}

/**
 * 다음 대상 버전 — **아직 쓰이지 않은 번호**다 (CR-046, DEV-309).
 *
 * `현재 + 1`을 그대로 쓰지 않는다. 재색인이 `v2`를 만든 뒤 전환 전에 실패하면
 * 그 shadow는 유계 정리 대상으로 남고 별칭은 여전히 `v1`을 가리킨다. 그 상태에서
 * 다시 시도하면 `v2`를 또 계산해 **인덱스 생성에서 실패**하고, 정리가 돌 때까지
 * 복구 자체가 막힌다 — 실패한 재색인이 다음 재색인을 막는 것은 이 계약이 만들려는
 * 상태가 아니다.
 *
 * 그래서 실재하는 최대 버전보다 하나 큰 값을 고른다. 비어 있는 중간 번호를
 * 재사용하지 않는 이유는 그 번호가 방금 실패한 회차의 것일 수 있어서다 —
 * 정리 스윕과 경주하게 된다.
 */
export async function nextUnusedVersion(client: Client, alias: string): Promise<number> {
  const versions = await listIndexVersions(client, alias);
  const highest = versions.length === 0 ? 0 : (versions[versions.length - 1] as number);
  return highest + 1;
}

/** 새 인덱스를 만들 때 쓰는 스키마. 기본은 `ENTITY_INDICES`의 정의다. */
export interface VersionedIndexSchema {
  readonly settings: estypes.IndicesIndexSettings;
  readonly mappings: estypes.MappingTypeMapping;
  readonly shards: number;
}

/** 이 별칭의 현재 정의를 스키마로. 재색인 기본값이다. */
export function schemaOf(alias: EntityAlias): VersionedIndexSchema {
  const definition = findIndexDefinition(alias);
  return { settings: definition.settings, mappings: definition.mappings, shards: definition.shards };
}

/**
 * 버전 인덱스를 **처음부터** 만든다.
 *
 * 별칭을 붙이지 않는다 — 붙이면 그 순간 읽기가 반쯤 새 인덱스로 간다. 별칭은
 * 완전해진 뒤 `switchAlias`가 한 번에 옮긴다 (AC-3·AC-5).
 *
 * 이미 있으면 던진다. 있는 인덱스를 재사용하면 앞선 실패 회차가 남긴 부분
 * 데이터를 완전한 것으로 오인한다.
 */
export async function createVersionedIndex(
  client: Client,
  alias: string,
  version: number,
  schema: VersionedIndexSchema,
): Promise<string> {
  const index = concreteIndexName(alias, version);
  const exists = await client.indices.exists({ index });
  if (exists) throw new Error(`대상 인덱스가 이미 있다: ${index}`);

  await client.indices.create({
    index,
    settings: { ...schema.settings, number_of_shards: schema.shards },
    mappings: schema.mappings,
  });
  return index;
}

/**
 * 별칭을 **한 요청으로** 옮긴다 (FR-ING-008 AC-3).
 *
 * `remove` → `add` 두 호출로 나누면 그 사이에 별칭이 존재하지 않는 창이 생기고,
 * 그 창의 모든 읽기·쓰기가 `index_not_found_exception`으로 실패한다. 무중단이
 * 이 WP의 목적이므로 그 창은 실패가 아니라 **계약 위반**이다.
 */
export async function switchAlias(
  client: Client,
  alias: string,
  fromIndex: string,
  toIndex: string,
): Promise<void> {
  await client.indices.updateAliases({
    actions: [
      { remove: { index: fromIndex, alias } },
      { add: { index: toIndex, alias } },
    ],
  });
}

/**
 * 보관 기한이 지난 옛 인덱스를 지운다 (FR-ING-008 AC-4).
 *
 * **현재 별칭이 가리키는 인덱스는 어떤 경우에도 지우지 않는다.** 정본이 잡
 * `progress`라 그 값이 낡았을 수 있고(전환이 두 번 일어났다든지), 그때 낡은
 * 값을 그대로 믿으면 서비스 중인 인덱스를 지운다. 지우기 직전에 다시 묻는다.
 *
 * ## 세 결과를 가른다 (PR #52 리뷰 P2)
 *
 * `serving`과 `absent`를 하나로 뭉치면 호출부가 둘을 같게 다룬다. 그러면
 * **운영자가 별칭을 이 인덱스로 되돌려 둔 동안**(롤백) 스윕이 "처리했다"고
 * 표시해 버리고, 나중에 별칭이 다시 옮겨져도 그 인덱스는 영영 지워지지 않는다.
 * 지금 서비스 중인 것은 **다음 주기에 다시 볼 대상**이지 끝난 대상이 아니다.
 */
export type RetiredIndexOutcome = 'deleted' | 'serving' | 'absent';

export async function deleteRetiredIndex(
  client: Client,
  alias: string,
  index: string,
): Promise<RetiredIndexOutcome> {
  if (parseIndexVersion(alias, index) === null) {
    throw new Error(`이 별칭의 버전 인덱스가 아니다: ${alias} / ${index}`);
  }

  const serving = await client.indices.getAlias({ name: alias });
  if (Object.keys(serving).includes(index)) return 'serving';

  const exists = await client.indices.exists({ index });
  if (!exists) return 'absent';

  await client.indices.delete({ index });
  return 'deleted';
}

/** 안정 별칭인지. API가 구체 인덱스 지정을 거절하는 근거다 (DEV-294). */
export function isEntityAlias(value: string): value is EntityAlias {
  return (ENTITY_ALIASES as readonly string[]).includes(value);
}

/**
 * 재색인 대상 이름을 정하는 포트 (WP-035, DEV-302).
 *
 * `@prs/db`의 `ReindexIndexPort`와 **구조적으로 같다** — 그래서 어댑터 없이
 * `enqueueReindex`에 그대로 넘어가고, `@prs/db`는 Elasticsearch를 의존하지
 * 않는다.
 *
 * **API와 CLI가 같은 것을 쓴다.** 앱끼리는 서로를 가져올 수 없으므로 두 진입점이
 * 같은 구현을 공유하려면 패키지가 유일한 자리다 — 각자 만들면 한쪽만 "아직
 * 쓰이지 않은 다음 번호"를 다르게 고른다.
 */
export function reindexIndexPort(client: Client): {
  resolveServingIndex(alias: string): Promise<string>;
  nextTargetIndex(alias: string): Promise<string>;
  isAlias(value: string): boolean;
} {
  return {
    resolveServingIndex: (alias) => resolveServingIndex(client, alias),
    async nextTargetIndex(alias) {
      return concreteIndexName(alias, await nextUnusedVersion(client, alias));
    },
    isAlias: (value) => isEntityAlias(value),
  };
}
