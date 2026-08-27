/**
 * 저장소 등록 검토 요청 (API-ING-003 / FR-ING-009 AC-8·9·10, WP-034 / CR-050).
 *
 * ## 이 경로가 하지 않는 일
 *
 * 저장소를 등록하지 않고, 수집·채번·백필을 시작하지 않으며, 시퀀스 대상
 * 브랜치·미러 사용 여부를 정하지 않는다. 실제 등록·해제는 `API-ADM-001`이
 * 하고 `operator` 전용이다.
 *
 * **GitHub Enterprise에 묻지 않는다.** 대상이 실제로 있는지도, 요청자가 그것을
 * 볼 수 있는지도 확인하지 않는다 — 확인하면 그 응답이 곧 **비공개 저장소의
 * 존재 신탁**이 된다 (AC-10, THR-004·THR-041). 그래서 이 모듈에는 GitHub
 * 클라이언트가 아예 주입되지 않는다: 부를 수 없으면 실수로 부를 일도 없다.
 *
 * ## 클라이언트가 주장하는 값을 믿지 않는다
 *
 * `repository_id`·`org_id`·`visibility`·`sequence_branches` 같은 값은 등록
 * 시점에 운영자가 정한다. 요청 본문에 그것이 섞여 와도 읽지 않는다 — 읽으면
 * 등록 계약이 클라이언트 입력으로 열린다.
 */

import { registrationRequestRepo, type Pool, type RegistrationRequestRow } from '@prs/db';

/**
 * 슬러그 각 조각의 상한.
 *
 * GitHub의 저장소·소유자 이름은 100자를 넘지 않는다. 상한이 없으면 이 표가
 * 임의 길이 문자열의 저장소가 된다 — 실재를 확인하지 않는 경로라서 더욱
 * 그렇다.
 */
export const MAX_SLUG_PART = 100;

export interface ParsedSlug {
  readonly owner: string;
  readonly name: string;
}

/**
 * `owner/name`을 가른다.
 *
 * 형식만 본다. **여기서 통과했다는 것이 그 저장소가 있다는 뜻이 아니다.**
 */
export function parseRequestSlug(raw: unknown): ParsedSlug | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.trim().split('/');
  if (parts.length !== 2) return null;
  const [owner, name] = parts;
  if (owner === undefined || name === undefined) return null;
  if (owner === '' || name === '') return null;
  if (owner.length > MAX_SLUG_PART || name.length > MAX_SLUG_PART) return null;
  return { owner, name };
}

export interface RegistrationRequestDeps {
  readonly pool: Pool;
}

export interface RegistrationRequestView {
  readonly request_id: string;
  readonly repository: string;
  readonly created_at: string;
}

export function toRequestView(row: RegistrationRequestRow): RegistrationRequestView {
  return {
    request_id: String(row.request_id),
    repository: `${row.repository_owner}/${row.repository_name}`,
    created_at: row.created_at.toISOString(),
  };
}

/**
 * 요청을 기록한다. 같은 사용자의 같은 식별자는 **자연 멱등**이다 (AC-9).
 *
 * 반복 요청이 실패가 아닌 이유는 사용자가 두 번 눌렀다는 것이 오류가 아니기
 * 때문이다 — 별도의 중복 오류 코드를 만들지 않는다.
 */
export async function recordRegistrationRequest(
  deps: RegistrationRequestDeps,
  userId: string,
  slug: ParsedSlug,
): Promise<RegistrationRequestView> {
  const row = await registrationRequestRepo.recordRequest(deps.pool, {
    requestedBy: userId,
    owner: slug.owner,
    name: slug.name,
  });
  return toRequestView(row);
}
