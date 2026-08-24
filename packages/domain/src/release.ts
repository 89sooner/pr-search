/**
 * 릴리스 갱신 신호의 판정 (WP-024 / CR-028, DEV-145).
 *
 * **게이트웨이와 릴리스 워커가 공유한다** — `extractPushTarget`과 같은 이유다.
 * 어떤 웹훅이 "이 저장소의 태그가 바뀌었다"를 뜻하는지의 규칙이 두 곳에 따로
 * 있으면 언젠가 갈라진다.
 *
 * ## 신호는 신호일 뿐이다 (EVT-REL-001)
 *
 * 여기서 태그 이름이나 SHA를 **뽑지 않는다.** 정본은 미러의 refs/tags 스냅숏이고
 * (DEV-143), 갱신 잡은 항상 전량 diff로 돈다. payload의 태그를 신뢰하면 이벤트
 * 순서 역전이 스냅숏을 되돌린다 — 신호가 나르는 것은 "저장소 X를 다시 봐라"
 * 하나다.
 */

const TAG_PREFIX = 'refs/tags/';

/** 릴리스 갱신 신호. */
export interface ReleaseSignal {
  readonly repositoryId: number;
}

export type ReleaseSignalOutcome =
  | { readonly kind: 'signal'; readonly signal: ReleaseSignal }
  /** 릴리스와 무관한 이벤트다. 실패가 아니므로 실패 대기열로 보내지 않는다. */
  | { readonly kind: 'skip'; readonly reason: string };

function repositoryIdOf(payload: Record<string, unknown>): number | null {
  const repository = payload['repository'];
  if (typeof repository !== 'object' || repository === null) return null;
  const id = (repository as Record<string, unknown>)['id'];
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * 웹훅에서 릴리스 갱신 신호를 뽑는다.
 *
 * 네 유형이 신호다:
 *
 * | 이벤트 | 조건 | 왜 |
 * | --- | --- | --- |
 * | `push` | ref가 `refs/tags/*` | 태그 생성·강제 이동·삭제가 push로 온다. 채번은 이것을 "브랜치가 아니다"로 건너뛰지만(옳다), 릴리스에는 바로 이것이 본론이다 (DEV-145) |
 * | `create` | `ref_type: "tag"` | 태그 생성 |
 * | `delete` | `ref_type: "tag"` | 태그 삭제 — diff가 지울 수 있게 신호를 낸다 |
 * | `release` | 항상 | GitHub Release 발행·수정. `published_at` 덮어쓰기의 트리거다 (DEV-147) |
 *
 * `push`와 `create`가 같은 태그에 대해 겹쳐 와도 문제없다 — 갱신은 멱등 diff다.
 */
export function extractReleaseSignal(
  eventType: string,
  payload: Record<string, unknown>,
): ReleaseSignalOutcome {
  const repositoryId = repositoryIdOf(payload);
  if (repositoryId === null) {
    return { kind: 'skip', reason: 'repository.id가 없다' };
  }

  switch (eventType) {
    case 'push': {
      const ref = payload['ref'];
      if (typeof ref !== 'string' || !ref.startsWith(TAG_PREFIX)) {
        return { kind: 'skip', reason: '태그 push가 아니다' };
      }
      return { kind: 'signal', signal: { repositoryId } };
    }
    case 'create':
    case 'delete': {
      if (payload['ref_type'] !== 'tag') {
        return { kind: 'skip', reason: `태그 ${eventType}가 아니다` };
      }
      return { kind: 'signal', signal: { repositoryId } };
    }
    case 'release':
      return { kind: 'signal', signal: { repositoryId } };
    default:
      return { kind: 'skip', reason: `릴리스와 무관한 이벤트다: ${eventType}` };
  }
}
