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
