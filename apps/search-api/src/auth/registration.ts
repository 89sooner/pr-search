/**
 * 로그인한 사용자를 정본에 등록한다 (CR-083 / DEV-613).
 *
 * ## 무엇이 비어 있었나
 *
 * `AccessScopeResolver`는 `app_user` 행이 없으면 던진다. 그 자리의 주석이
 * 설계 의도를 적고 있다 — **「세션이 있는데 사용자 행이 없다. 로그인이
 * 만들었어야 하므로 정합성 문제다」**. 그런데 `upsertUserOnLogin`을 부르는
 * 프로덕션 코드가 **어디에도 없었다.** 시험 픽스처만 그 함수를 썼다.
 *
 * 그래서 로그인은 성공하고 세션도 만들어지는데 **첫 조회가 503
 * `permission_unavailable`이 된다.** 사내가 아직 OIDC를 켜 본 적이 없어
 * 드러나지 않았고, `CR-083`이 GHE 로그인을 여는 순간 처음 밟게 되는 자리다.
 *
 * ## 왜 `web`이 아니라 여기인가
 *
 * 설계 의도대로라면 로그인 콜백이 등록해야 한다. 그런데 `web`은 `@prs/db`에
 * 의존하지 않는다 — 화면은 `search-api`를 거쳐서만 정본에 닿는다. 그 경계를
 * 열어 `web`에 DB 연결을 주는 것은 이 결함을 고치는 대가로 너무 크다.
 *
 * 대신 **세션을 읽는 자리**에서 등록한다. 세션 레코드에 정본이 필요로 하는
 * 것(`userId`·`login`·`email`·`githubUserId`)이 이미 전부 들어 있으므로,
 * 읽는 김에 정본을 맞춘다.
 *
 * ## 왜 `SessionStore`를 감싸는가
 *
 * `authenticateSession`을 부르는 자리가 서른 곳이 넘는다. 거기에 등록을 끼우면
 * **빠뜨린 경로가 생기고, 빠뜨린 경로만 503이 된다.** 이 저장소가 「규칙이 한
 * 곳에만 적혀 있으면 다른 곳에서 되살아난다」로 여러 번 겪은 모양이다.
 *
 * 저장소를 감싸면 세션을 읽는 **모든** 경로가 한 자리를 지난다. 시그니처도
 * 바뀌지 않으므로 호출부를 건드리지 않는다.
 */

import { SessionStore, type SessionRecord, type SessionRedis, type LoadedSession } from '@prs/authz';
import { authRepo, type Pool } from '@prs/db';

export interface RegisteringSessionStoreOptions {
  readonly redis: SessionRedis;
  readonly pool: Pool;
  /** 등록 실패를 남길 곳. 없으면 조용히 넘어간다. */
  readonly log?: ((message: string, detail: Record<string, unknown>) => void) | undefined;
}

export class RegisteringSessionStore extends SessionStore {
  readonly #pool: Pool;
  readonly #log: ((message: string, detail: Record<string, unknown>) => void) | undefined;

  /**
   * 이미 등록한 사용자.
   *
   * **요청마다 DB를 치지 않기 위한 것이지 정합성 장치가 아니다.** 프로세스가
   * 다시 서면 비고, 그때 한 번 더 upsert가 돌 뿐이다. 그 upsert는 멱등하다.
   */
  readonly #registered = new Set<string>();

  constructor(options: RegisteringSessionStoreOptions) {
    super({ redis: options.redis });
    this.#pool = options.pool;
    this.#log = options.log;
  }

  override async load(sessionId: string): Promise<LoadedSession | null> {
    const loaded = await super.load(sessionId);
    if (loaded === null) return null;
    await this.#ensureRegistered(loaded.session);
    return loaded;
  }

  /**
   * 정본에 행이 있게 한다.
   *
   * **실패해도 던지지 않는다.** 세션 자체는 유효하고, 정본이 비어 있다는 사실은
   * 접근 범위 해석이 이미 `503 permission_unavailable`로 정확하게 말한다. 여기서
   * 던지면 그 증상이 **인증 실패**로 둔갑해 운영자가 엉뚱한 곳을 본다.
   *
   * 실패한 사용자는 캐시에 넣지 않으므로 다음 요청이 다시 시도한다.
   */
  async #ensureRegistered(session: SessionRecord): Promise<void> {
    if (this.#registered.has(session.userId)) return;

    try {
      await authRepo.upsertUserOnLogin(this.#pool, {
        user_id: session.userId,
        login: session.login,
        github_user_id: session.githubUserId ?? null,
        email: session.email,
      });
      this.#registered.add(session.userId);
    } catch (error) {
      /*
       * 가장 그럴듯한 원인은 `app_user.login`의 UNIQUE 충돌이다 — 누군가
       * GHE에서 개명해 그 이름이 다른 `user_id`에 이미 붙어 있는 경우다.
       * 값을 지어내 덮지 않는다. 사람이 정본을 정리해야 하는 상황이다.
       *
       * **로그에 신원 외의 값을 싣지 않는다** (NFR-005).
       */
      this.#log?.('로그인 사용자를 정본에 등록하지 못했다 (DEV-613)', {
        user_id: session.userId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
