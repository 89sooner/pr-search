/**
 * 저장소 등록 상태를 문서에 반영한다 (FR-ING-009 AC-3, CR-013 DEV-028).
 *
 * **문서를 지우지 않는다.** 조사 이력의 보존이 이 제품의 목적이므로 등록 해제는
 * 소프트 삭제다 (데이터 모델 9장). 이미 색인된 문서에 표식을 소급해 붙인다.
 *
 * `document_version`은 건드리지 않는다. 등록 상태는 웹훅이 나르는 엔티티
 * 상태가 아니라 이 시스템이 소유한 운영 상태라 버전 비교의 대상이 아니다 —
 * CR-011이 상태 필드와 누적 필드를 가른 것과 같은 원리다. 버전을 올리면
 * 뒤늦게 도착한 정상 웹훅이 "오래된 이벤트"로 밀려 사라진다.
 */

import type { Client } from '@elastic/elasticsearch';
import { ENTITY_ALIASES, type EntityAlias } from './indices.js';

/** 저장소 등록 상태 표식을 갖는 인덱스. 릴리스·관계 문서에는 이 필드가 없다. */
export const ARCHIVABLE_ALIASES: readonly EntityAlias[] = ['prs-pull-requests', 'prs-commits'];

/**
 * 접근 범위 필드를 갖는 인덱스 — **네 개 전부다** (WP-068 / CR-035).
 *
 * `ARCHIVABLE_ALIASES`와 다르다. 등록 상태 표식은 두 인덱스에만 있지만
 * `allowed_team_ids`는 네 매핑이 모두 선언하고 강제 필터가 넷 모두에서 그것을
 * 읽는다. 소급 적용을 두 인덱스에만 돌리면 **관계·릴리스 문서가 옛 권한을 그대로
 * 들고 남는다** — 팀에서 빠진 사용자가 그 문서를 계속 보게 되는 유출이다.
 */
export const TEAM_SCOPED_ALIASES: readonly EntityAlias[] = ENTITY_ALIASES;

export interface MarkArchivedResult {
  /** 별칭별로 갱신된 문서 수. */
  readonly updated: Readonly<Record<string, number>>;
  readonly total: number;
}

/**
 * 저장소의 기존 문서에 등록 상태를 표시한다.
 *
 * @param archived 해제면 `true`, 재등록이면 `false`.
 * @returns 갱신된 문서 수. 이미 같은 값인 문서는 세지 않는다.
 */
export async function markRepositoryArchived(
  client: Client,
  repositoryId: number,
  archived: boolean,
): Promise<MarkArchivedResult> {
  const updated: Record<string, number> = {};
  let total = 0;

  for (const alias of ARCHIVABLE_ALIASES) {
    const response = await client.updateByQuery({
      index: alias,
      routing: String(repositoryId),
      refresh: true,
      // 충돌은 넘긴다. 같은 문서를 투영이 동시에 갱신 중이면 다음 회차가 잡는다 —
      // 여기서 요청 전체를 실패시키면 나머지 문서까지 표식을 놓친다.
      conflicts: 'proceed',
      query: {
        bool: {
          filter: [{ term: { repository_id: repositoryId } }],
          // 이미 같은 값인 문서는 건드리지 않는다. 재실행이 싸진다.
          must_not: [{ term: { repository_archived: archived } }],
        },
      },
      script: {
        lang: 'painless',
        source: 'ctx._source.repository_archived = params.archived',
        params: { archived },
      },
    });

    const count = Number(response.updated ?? 0);
    updated[alias] = count;
    total += count;
  }

  return { updated, total };
}

/** 표식을 갖지 않는 별칭. 실수로 갱신 대상에 넣지 않도록 이름을 남겨 둔다. */
export const NON_ARCHIVABLE_ALIASES: readonly EntityAlias[] = ENTITY_ALIASES.filter(
  (alias) => !ARCHIVABLE_ALIASES.includes(alias),
);

/**
 * 저장소의 기존 문서에 팀 접근 범위를 소급 적용한다 (WP-068 / CR-035, DEV-114).
 *
 * ## `document_version`을 건드리지 않는다
 *
 * 스크립트가 `allowed_team_ids`만 쓴다. 팀 권한이 바뀐 것은 **저장소 접근
 * 상태**의 변화이지 PR·커밋 엔티티의 변화가 아니다 — 버전을 올리면 조건부
 * 업서트가 진행 중인 실시간 투영을 밀어내고, 권한 변경이 수집 순서를 흔든다.
 *
 * ## 왜 소급이 필요한가
 *
 * 강제 필터는 **문서에 박힌 값**을 본다. 팀에서 제거된 사용자가 과거에 색인된
 * 문서를 계속 보게 되는 것은 유출이고, 반대로 팀에 추가된 사용자가 과거 문서를
 * 못 보는 것은 승인된 기능이 죽어 있는 것이다. 둘 다 이 소급이 막는다.
 */
export async function applyRepositoryTeams(
  client: Client,
  repositoryId: number,
  teamIds: readonly number[],
): Promise<MarkArchivedResult> {
  const normalized = [...new Set(teamIds)].sort((a, b) => a - b);
  const updated: Record<string, number> = {};
  let total = 0;

  for (const alias of TEAM_SCOPED_ALIASES) {
    const response = await client.updateByQuery({
      index: alias,
      routing: String(repositoryId),
      refresh: true,
      // 투영이 같은 문서를 동시에 갱신 중이면 다음 회차가 잡는다.
      conflicts: 'proceed',
      query: { bool: { filter: [{ term: { repository_id: repositoryId } }] } },
      script: {
        lang: 'painless',
        /*
         * **`allowed_team_ids`만 쓴다.** `document_version`은 읽지도 쓰지도
         * 않는다 — 그것이 이 소급이 지켜야 할 불변식이다.
         */
        source: 'ctx._source.allowed_team_ids = params.teams',
        params: { teams: normalized },
      },
    });

    const count = Number(response.updated ?? 0);
    updated[alias] = count;
    total += count;
  }

  return { updated, total };
}
