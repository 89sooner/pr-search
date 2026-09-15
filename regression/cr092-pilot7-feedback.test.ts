/**
 * CR-092 — 사내 `0.1.0-pilot.7` 반입 피드백의 배선 회귀.
 *
 *   - DEV-697: `prsctl smoke`가 정상인 search-api를 `✗ /healthz → HTTP/1.1`로 실패시켰다. 본문과 헤더를 한 파이프에 싣고
 *     줄의 두 번째 필드를 읽었는데, `docker compose exec`가 stdout·stderr를 따로 날라 **도착 순서가 바뀌면** 한 줄이
 *     `{"status":"ok",…}  HTTP/1.1 200 OK`가 된다. pilot.7 이미지에 `docker exec`로 20회 걸어 8회 재현했다.
 *
 * 순서가 바뀌는 것은 간헐적이라 실제 컨테이너로는 결정적으로 시험할 수 없다. 그래서 **가짜 `compose`가 최악의 순서를
 * 늘 만든다** — 본문을 개행 없이 먼저 쓰고 헤더를 뒤에 쓴다. busybox wget이 실제로 내는 줄 모양(상태 줄 앞의 공백 둘,
 * 실패 때 덧붙는 `wget: server returned error: …` 줄, 연결 거부)은 pilot.7 이미지에서 실측한 그대로다.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const PRSCTL = read('deploy/single-host/prsctl');
const fn = (name: string): string => new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?\\r?\\n\\}`, 'm').exec(PRSCTL)?.[0] ?? '';

/**
 * `docker compose exec -T <svc> wget … <url>`를 흉내 낸다. 경로마다 busybox wget의 실측 출력을 내며, `-qO-`면 본문을
 * **헤더보다 먼저** stdout에 개행 없이 쓴다 — 스트림 도착 순서가 바뀐 최악의 경우다.
 */
const FAKE_COMPOSE = String.raw`
compose() {
  local url="" body_to_stdout=0 arg
  for arg in "$@"; do
    case "$arg" in
      -qO-) body_to_stdout=1 ;;
      http://*) url="$arg" ;;
    esac
  done
  case "$url" in
    */healthz)
      [ "$body_to_stdout" -eq 1 ] && printf '%s' '{"status":"ok","service":"search-api","version":"0.1.0"}'
      printf '  HTTP/1.1 200 OK\n  content-type: application/json\n  Connection: close\n  \n' >&2
      return 0 ;;
    */boom)
      printf '  HTTP/1.1 500 Internal Server Error\nwget: server returned error: HTTP/1.1 500 Internal Server Error\n' >&2
      return 1 ;;
    */redirect)
      printf '  HTTP/1.1 307 Temporary Redirect\n  location: /auth/login\n  HTTP/1.1 200 OK\n  content-type: text/html\n  \n' >&2
      return 0 ;;
    *)
      printf 'wget: can'"'"'t connect to remote host (127.0.0.1): Connection refused\n' >&2
      return 1 ;;
  esac
}
`;

/** prsctl과 같은 strict 모드에서 `http_status`를 가짜 compose와 함께 돌린다. */
function status(url: string, pick: 'first' | 'last'): string {
  const script = ['set -Eeuo pipefail', FAKE_COMPOSE, fn('http_status'), `printf '[%s]' "$(http_status search-api '${url}' ${pick})"`].join('\n');
  return execFileSync('bash', ['-c', script], { encoding: 'utf8' });
}

describe('DEV-697: prsctl smoke가 HTTP 상태 코드만 읽는다', () => {
  it('함수를 찾았다 — 추출이 비면 아래 시험이 전부 무의미하다', () => {
    expect(fn('http_status')).toContain('wget');
    expect(fn('cmd_smoke')).toContain('/healthz');
  });

  it('본문이 헤더보다 먼저 도착해도 200을 읽는다 — 사내 pilot.7의 `→ HTTP/1.1`', () => {
    expect(status('http://127.0.0.1:3002/healthz', 'last')).toBe('[200]');
    expect(status('http://127.0.0.1:3000/healthz', 'first')).toBe('[200]');
  });

  it('5xx에서는 500을 읽고, wget의 비영 종료가 strict 모드의 호출자를 죽이지 않는다', () => {
    expect(status('http://127.0.0.1:3000/boom', 'first')).toBe('[500]');
    // busybox가 덧붙이는 `wget: server returned error: HTTP/1.1 500 …` 줄에서 `server`를 읽지 않는다.
    expect(status('http://127.0.0.1:3000/boom', 'last')).toBe('[500]');
  });

  it('리다이렉트는 첫 응답과 마지막 응답을 구별한다 — 진입 화면은 자기 답(3xx)을 본다', () => {
    expect(status('http://127.0.0.1:3000/redirect', 'first')).toBe('[307]');
    expect(status('http://127.0.0.1:3000/redirect', 'last')).toBe('[200]');
  });

  it('응답이 없으면 빈 값이다 — 무응답을 숫자로 지어내지 않는다', () => {
    expect(status('http://127.0.0.1:3999/', 'last')).toBe('[]');
  });

  it('cmd_smoke의 두 헬스체크와 진입 화면이 모두 이 함수를 지난다 — 본문을 싣는 옛 파이프가 남지 않는다', () => {
    const smoke = fn('cmd_smoke');
    expect(smoke).toMatch(/http_status "\$svc" "http:\/\/127\.0\.0\.1:\$\{port\}\/healthz" last/);
    expect(smoke).toMatch(/http_status web 'http:\/\/127\.0\.0\.1:3000\/' first/);
    // 주석은 뺀다 — 옛 파이프를 인용해 이유를 적은 설명까지 잡으면 규칙을 설명할 수 없다.
    const code = PRSCTL.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join('\n');
    expect(code).not.toMatch(/wget -qO- --server-response/);
    expect(fn('http_status')).toContain('-qO/dev/null');
  });
});
