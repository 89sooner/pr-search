/**
 * 시퀀스 공간의 해석과 접근 통제 (WP-023 / FR-SEQ-002, FR-SEQ-003).
 *
 * 두 엔드포인트가 똑같이 먼저 하는 일을 여기 한 번만 둔다 — `acme/payments@main`이
 * 무슨 저장소이고, 이 사용자가 그것을 볼 수 있으며, 그 공간이 지금 어떤 상태인가.
 *
 * **접근 통제가 이 파일에 있는 것이 중요하다** (ADR-008, CR-027 DEV-130). 시퀀스
 * 조회는 멤버십을 PostgreSQL에서 읽으므로 `applyMandatoryScopeFilter`의 타입
 * 강제가 닿지 않는다. 그 자리를 `isRepositoryInScope`가 메우며, 두 엔드포인트가
 * 그것을 각자 부르는 대신 **이 함수를 지나야만** 저장소 ID를 얻게 해서 빠뜨릴
 * 자리를 없앤다.
 */

import { repositoryRepo, sequenceSpaceRepo } from '@prs/db';
import type { Pool, SequenceSpaceState } from '@prs/db';
import { isRepositoryInScope, type AccessScope } from '@prs/es';

/** `owner/name` 한 쌍. 요청이 문자열로 주는 것을 여기서 한 번만 가른다. */
export interface RepositorySlug {
  readonly owner: string;
  readonly name: string;
}

export function parseRepositorySlug(raw: unknown): RepositorySlug | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.trim().split('/');
  if (parts.length !== 2) return null;
  const [owner, name] = parts;
  if (owner === undefined || name === undefined || owner === '' || name === '') return null;
  return { owner, name };
}

/**
 * 해석된 시퀀스 공간.
 *
 * `sequenceSpace`는 **표시용 문자열**이다 (CR-025, DEV-119). 필터로 쓰지 않는다 —
 * 저장소 이름이 바뀌면 같은 공간이 두 문자열로 갈라진다.
 */
export interface ResolvedSpace {
  readonly repositoryId: number;
  readonly baseBranch: string;
  readonly seqEpoch: number;
  readonly state: SequenceSpaceState;
  readonly headSeq: number;
  readonly sequenceSpace: string;
}

export type SpaceLookup =
  | { readonly kind: 'ok'; readonly space: ResolvedSpace }
  /** 저장소가 없거나 그 브랜치가 채번된 적이 없다. 둘 다 404다 (CR-027, DEV-137). */
  | { readonly kind: 'not_found'; readonly message: string }
  /**
   * 볼 수 없는 저장소.
   *
   * **`not_found`와 같은 404로 내보낸다** — 403은 "그 저장소가 있다"는 사실을
   * 알려 주고, 비공개 저장소의 존재 자체가 알려지면 안 된다 (보안 문서 THR-006).
   */
  | { readonly kind: 'forbidden'; readonly message: string };

/**
 * `owner/name` + 브랜치 → 시퀀스 공간.
 *
 * 순서가 통제다: 저장소를 찾고 → **범위를 확인하고** → 공간을 읽는다. 범위 확인이
 * 마지막이면 그 사이의 실패 메시지가 저장소의 존재를 흘린다.
 */
export async function resolveSpace(
  pool: Pool,
  slug: RepositorySlug,
  baseBranch: string,
  scope: AccessScope,
): Promise<SpaceLookup> {
  const label = `${slug.owner}/${slug.name}@${baseBranch}`;
  const repository = await repositoryRepo.findRepositoryBySlug(pool, slug.owner, slug.name);
  if (repository === undefined) {
    return { kind: 'not_found', message: `등록되지 않은 저장소다: ${slug.owner}/${slug.name}` };
  }

  const visible = isRepositoryInScope(
    {
      repositoryId: repository.repository_id,
      orgId: repository.org_id,
      visibility: repository.visibility,
      // `repository.allowed_team_ids`는 아직 스키마에 없다 (WP-068, DEV-114).
    },
    scope,
  );
  if (!visible) {
    return { kind: 'forbidden', message: `등록되지 않은 저장소다: ${slug.owner}/${slug.name}` };
  }

  const space = await sequenceSpaceRepo.findSequenceSpace(pool, repository.repository_id, baseBranch);
  if (space === undefined) {
    /*
     * 채번된 적이 없는 브랜치다. 여기서 `unknown` 상태로 빈 구간을 200으로 내면
     * "그 구간에 아무것도 없다"로 읽힌다 (DEV-137) — **채번되지 않은 것과 비어
     * 있는 것은 다르다.** API-SEQ-001이 404를 제공하므로 그것을 쓴다.
     */
    return { kind: 'not_found', message: `채번된 적이 없는 시퀀스 공간이다: ${label}` };
  }

  return {
    kind: 'ok',
    space: {
      repositoryId: repository.repository_id,
      baseBranch,
      seqEpoch: space.seq_epoch,
      state: space.state,
      headSeq: Number(space.head_seq),
      sequenceSpace: label,
    },
  };
}

/**
 * 인용이 딛고 선 에폭이 아직 유효한가 (ADR-007, CR-027).
 *
 * `requested`가 없으면 검사할 것이 없다 — 현재 에폭으로 조회한다. 있고 다르면
 * **조용히 현재 에폭으로 옮기지 않는다**: 그것이 ADR-007이 막으려는 바로 그
 * 동작이다. 강제 푸시로 히스토리가 바뀌었는데 같은 번호가 다른 커밋을 가리키게
 * 되는 것보다, 인용이 무효라고 말하는 편이 낫다.
 */
export function isEpochStale(space: ResolvedSpace, requested: number | null): boolean {
  return requested !== null && requested !== space.seqEpoch;
}

/** 요청의 `seq_epoch`. 숫자가 아니면 `null`(지정 안 함)로 읽는다. */
export function parseEpochParam(raw: unknown): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : null;
}
