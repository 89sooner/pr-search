/**
 * 기동 시점 구성 검증 (`DEV-577` / `CR-078`).
 *
 * ## 왜 이 파일이 생겼는가
 *
 * `resolveSessionReaderConfig`는 운영에서 `SESSION_COOKIE_SECURE=false`를
 * 거부한다. 그 계약의 주석은 「**기동을 막는다**」고 적고, `playwright.config.ts`의
 * 주석도 「**기동을 거부한다**」고 적는다. **그런데 실제로는 막지 않았다.**
 *
 * `web`에서 그 함수를 부르는 자리는 화면과 라우트 핸들러 안, 즉 요청 처리
 * 경로다. 그래서 잘못된 구성으로 띄우면 이렇게 된다:
 *
 *   프로세스는 기동한다          → 컨테이너가 살아 있다
 *   `/healthz`는 200을 낸다      → Docker가 `healthy`로 보고한다
 *   사람이 여는 화면은 전부 500  → 아무도 그 이유를 모른다
 *
 * 사내 반입(`0.1.0-pilot.3`)에서 정확히 그렇게 막혔다. 운영자는 컨테이너가
 * 전부 정상이고 검색 API도 응답하는데 웹 화면만 죽는 것을 보고 원인을 웹
 * 런타임의 모듈 해석 문제로 오진했다. `search-api`는 compose가 이 변수를 web
 * 에만 넘기므로 영향을 받지 않아 그 오진을 더 그럴듯하게 만들었다.
 *
 * ## 무엇을 하는가
 *
 * Next.js가 서버 인스턴스마다 한 번 부르는 `register()`에서 구성을 **미리**
 * 편다. 성립하지 않으면 이유를 적고 프로세스를 종료한다 — 적혀 있던 의도를
 * 실제로 이행하는 자리다. 종료하면 컨테이너가 재기동을 반복하므로
 * `docker compose ps`와 `docker logs`가 사람에게 사실을 말한다.
 *
 * **`throw`가 아니라 종료다.** 던지기만 하면 그 예외를 누가 삼키는지에 이
 * 계약이 걸린다. 걸리면 안 되는 계약이라 종료로 못 박는다.
 *
 * ## 무엇을 하지 않는가
 *
 * **백킹 서비스를 확인하지 않는다.** PostgreSQL·Redis·Elasticsearch·GHE는
 * 기동 순서가 정해져 있지 않고 늦게 올라올 수 있다 — 그것을 여기서 막으면
 * 정상 배포가 기동 순서 때문에 죽는다. 여기서 보는 것은 **환경 변수만으로
 * 판정되는 것**, 즉 네트워크 없이도 참·거짓이 정해지는 계약뿐이다.
 *
 * **개발에서는 종료하지 않는다.** 이것은 운영 계약이며, 계약 자체가
 * `NODE_ENV=production`에서만 던진다. 개발에서 종료하면 개발 루프가 죽는다.
 */

/** Next.js가 서버 인스턴스마다 한 번 부른다. */
export async function register(): Promise<void> {
  /*
   * Edge 런타임에는 `process.exit`도 없고 이 배포가 쓰지도 않는다.
   * Node 런타임에서만 판정한다.
   */
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;

  /*
   * **동적 import다.** 이 모듈은 `server-only`를 가져오므로 최상단에서
   * 정적으로 끌면 Edge 런타임의 계측 그래프에도 올라간다. Node 런타임에
   * 들어온 뒤에 가져오면 그 자리가 생기지 않는다.
   */
  const { webConfigFailure } = await import('./lib/server/config');

  const failure = webConfigFailure();
  if (failure === null) return;

  const production = process.env['NODE_ENV'] === 'production';
  console.error(
    [
      '',
      '  web 구성이 성립하지 않아 기동할 수 없다:',
      `    ${failure}`,
      '',
      '  이 값들은 환경 변수에서만 온다. `.env`를 고치고 다시 올린다.',
      '  절차는 deploy/single-host/RUNBOOK.md 2.B다.',
      '',
    ].join('\n'),
  );

  if (!production) return;

  /*
   * **초록으로 서 있느니 죽는다.** 이 상태로 서면 헬스체크는 200을 내고
   * 사람이 여는 화면만 500이 된다 — 그것이 이 결함의 재발 경로다.
   *
   * **`throw`로는 안 된다.** 재 보았다: Next가 그 예외를 잡아
   * `Failed to prepare server`를 적고도 **프로세스를 살려 둔다.** 그러면
   * 컨테이너는 계속 서 있고 모든 요청이 500인 상태로 돌아간다 — 고치려던
   * 바로 그 모양이다. 종료만이 이 계약을 이행한다.
   *
   * **`globalThis`를 거쳐 잡는다.** `process.exit`를 직접 쓰면 Turbopack이
   * 이 파일을 Edge 런타임용으로도 컴파일하면서 "지원하지 않는 Node API"
   * 경고를 낸다 — 위의 `NEXT_RUNTIME` 판정 때문에 Edge에서는 여기 닿지
   * 않는데도 그렇다. 릴리스 빌드 출력에 거짓 오류 줄이 남으면 다음 사람이
   * 진짜 오류와 구별하지 못한다.
   */
  const nodeProcess = globalThis.process as { exit?: (code: number) => never } | undefined;
  nodeProcess?.exit?.(1);
}
