/**
 * 승인된 PIPE subject → 기존 pr-search 사용자 (CR-112 / 공통 계약 4장, PSI-B01~B08).
 *
 * ## 연결만 하고 만들지 않는다
 *
 * binding은 운영자가 CLI로 검증해 넣은 것만 쓴다. `app_user`가 없거나 GHE 숫자 ID가 비었거나
 * 다르면 **거절한다** — PIPE `sub`나 이메일로 사용자를 지어내지 않는다. 기존 로그인 경로의
 * `RegisteringSessionStore`는 세션을 읽을 때 정본을 등록했지만, 이 연동은 세션이 없으므로 그 등록을
 * 우회해 새 사용자를 만들지 않는다 (지시서 6절). 새 사용자는 먼저 pr-search에 한 번 로그인해야 한다.
 *
 * ## login은 신원이 아니다
 *
 * 접근 범위는 `app_user.login`으로 GHE 권한을 조회한다(`AccessScopeResolver`). PIPE만 쓰는 사용자는
 * pr-search 로그인이 없으니 그 login이 낡을 수 있고, 옛 이름을 다른 사람이 가져가면 **다른 사람의
 * 권한**이 조회된다. 그래서 발급 때 GHE에서 그 login의 현재 숫자 ID를 확인해 binding과 맞는지 본다
 * (PSI-B05). 맞지 않으면 사람이 정리할 때까지 거절한다.
 */

import { authRepo, pipeIntegrationRepo, type AppUserRow, type IdentityBindingRow, type Pool } from '@prs/db';
import type { VerifiedAssertion } from './assertion.js';
import { PsiError } from './errors.js';

/** GHE 사용자 조회 포트 — 발급 때 login의 현재 숫자 ID를 확인한다. */
export interface GheUserDirectory {
  /** @returns 없는 login이면 `null`. 조회 자체가 실패하면 던진다. */
  findUserByLogin(login: string): Promise<{ readonly id: number; readonly login: string } | null>;
}

export interface CanonicalIdentity {
  readonly binding: IdentityBindingRow;
  readonly user: AppUserRow;
}

/** GHE 사용자 조회의 동시 실행 상한. PIPE가 재기동해 문맥마다 한꺼번에 발급을 청해도 GHE를 몰아치지 않는다. */
export const DEFAULT_DIRECTORY_CONCURRENCY = 8;

/**
 * 조회 포트에 동시 실행 상한을 씌운다 (`AccessScopeResolver`의 `maxConcurrentRefresh`와 같은 이유).
 *
 * 캐시하지 않는다 — 발급마다 현재 login의 숫자 ID를 확인하는 것이 이 검사의 뜻이다.
 */
export function boundedDirectory(directory: GheUserDirectory, max = DEFAULT_DIRECTORY_CONCURRENCY): GheUserDirectory {
  let running = 0;
  const waiting: (() => void)[] = [];
  return {
    async findUserByLogin(login) {
      // 자리가 없으면 기다린다. 끝나는 쪽이 자리를 **직접 넘겨주므로** 깨어난 뒤 다시 세지 않는다 —
      // 넘겨주는 사이에 새 호출이 끼어들어 상한을 넘는 일이 없다.
      if (running >= max) await new Promise<void>((resolve) => waiting.push(resolve));
      else running += 1;
      try {
        return await directory.findUserByLogin(login);
      } finally {
        const next = waiting.shift();
        if (next === undefined) running -= 1;
        else next();
      }
    },
  };
}

/**
 * assertion의 (issuer, subject)를 canonical 사용자로 옮긴다.
 *
 * @throws {PsiError} `IDENTITY_BINDING_REQUIRED` · `IDENTITY_DISABLED` · `IDENTITY_BINDING_CONFLICT` ·
 *   `PERMISSION_UNAVAILABLE`(GHE 확인 불가) · `AUTH_STORE_UNAVAILABLE`(정본 불가)
 */
export async function resolveCanonicalIdentity(
  deps: { readonly pool: Pool; readonly directory: GheUserDirectory; readonly gheHost: string },
  assertion: Pick<VerifiedAssertion, 'issuer' | 'subject'>,
): Promise<CanonicalIdentity> {
  let binding: IdentityBindingRow | null;
  let user: AppUserRow | null = null;
  try {
    binding = await pipeIntegrationRepo.findBindingBySubject(deps.pool, assertion.issuer, assertion.subject);
    if (binding !== null) user = await authRepo.findUserById(deps.pool, binding.prs_user_id);
  } catch {
    throw new PsiError('AUTH_STORE_UNAVAILABLE', 'binding_store_unavailable');
  }

  if (binding === null) throw new PsiError('IDENTITY_BINDING_REQUIRED', 'binding_missing');
  if (binding.status === 'disabled') throw new PsiError('IDENTITY_DISABLED', 'binding_disabled');
  if (binding.status === 'conflict') throw new PsiError('IDENTITY_BINDING_CONFLICT', 'binding_conflict');
  // `pending`은 아직 사람이 검증하지 않은 것이다.
  if (binding.status !== 'active') throw new PsiError('IDENTITY_BINDING_REQUIRED', 'binding_pending');

  // 같은 숫자 ID라도 다른 GHE 호스트의 계정이면 같은 사람이 아니다 (PSI-B06).
  if (binding.ghe_host !== deps.gheHost) throw new PsiError('IDENTITY_BINDING_CONFLICT', 'ghe_host_mismatch');

  // 외래 키가 있어 보통은 없을 수 없다. 그래도 없으면 0건 검색으로 바꾸지 않고 연결 필요로 답한다 (PSI-B07).
  if (user === null) throw new PsiError('IDENTITY_BINDING_REQUIRED', 'canonical_user_missing');
  if (user.github_user_id === null || user.github_user_id !== binding.ghe_user_id) {
    throw new PsiError('IDENTITY_BINDING_CONFLICT', 'canonical_ghe_id_mismatch');
  }

  let current: { readonly id: number; readonly login: string } | null;
  try {
    current = await deps.directory.findUserByLogin(user.login);
  } catch {
    // 신원을 확인하지 못했다 — 권한 조회 실패와 같은 503이다. 실패를 통과로 바꾸지 않는다.
    throw new PsiError('PERMISSION_UNAVAILABLE', 'ghe_user_lookup_failed');
  }
  if (current === null || current.id !== binding.ghe_user_id) {
    throw new PsiError('IDENTITY_BINDING_CONFLICT', 'ghe_login_reassigned');
  }

  return { binding, user };
}
