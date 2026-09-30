/**
 * 요청 수를 세는 Git smart HTTP 원격 (CR-139 / DEV-810 통합 시험).
 *
 * **`file://` 원격으로는 "원격을 불렀는가"를 셀 수 없다.** 미러가 promisor 원격에
 * 닿았는지를 증명하려면 원격이 받은 요청을 원격 쪽에서 세야 한다. 그래서 실제
 * `git upload-pack --stateless-rpc`를 HTTP로 서빙하고 요청마다 센다 — 워커 이미지에
 * `git-http-backend`가 없는 것과 같은 조건이다.
 *
 * **자격 증명 값을 남기지 않는다.** `Authorization` 헤더는 "있었는가"와 "기대한 값과
 * 같은가"만 센다. 값 자체는 어디에도 기록하지 않는다 (NFR-005).
 *
 * 127.0.0.1의 임시 포트에서만 듣는다.
 */

import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createGunzip } from 'node:zlib';

export type RemoteMode = 'serve' | 'reject';

export interface RemoteCounters {
  /** 받은 HTTP 요청 전부. */
  readonly total: number;
  readonly infoRefs: number;
  readonly uploadPack: number;
  /** `Authorization` 헤더가 붙은 요청 수. */
  readonly withAuth: number;
  /** 그 헤더가 기대한 값과 같았던 요청 수. */
  readonly authMatched: number;
  /** upload-pack 요청 본문의 `want <oid>`. 무엇을 받으려 했는지 가린다. */
  readonly wants: readonly string[];
}

export interface CountingRemote {
  /** `/<owner>/<repo>.git` 원격 URL. */
  url(owner: string, repo: string): string;
  counters(): RemoteCounters;
  reset(): void;
  /** `reject`면 모든 요청에 503을 준다 — "원격이 실패해도 결과가 나왔다"와 "원격을 부르지 않았다"를 가른다. */
  setMode(mode: RemoteMode): void;
  close(): Promise<void>;
}

export interface CountingRemoteOptions {
  /** `/<owner>/<repo>.git` → 서빙할 git 디렉터리. */
  readonly repos: Readonly<Record<string, string>>;
  /** 기대하는 `Authorization` 헤더 값. 없으면 일치 여부를 세지 않는다. */
  readonly expectedAuthorization?: string;
}

export async function startCountingRemote(options: CountingRemoteOptions): Promise<CountingRemote> {
  let mode: RemoteMode = 'serve';
  let total = 0;
  let infoRefs = 0;
  let uploadPack = 0;
  let withAuth = 0;
  let authMatched = 0;
  let wants: string[] = [];

  const handle = (request: IncomingMessage, response: ServerResponse): void => {
    total += 1;
    const authorization = request.headers['authorization'];
    if (authorization !== undefined) {
      withAuth += 1;
      if (options.expectedAuthorization !== undefined && authorization === options.expectedAuthorization) authMatched += 1;
    }
    if (mode === 'reject') {
      response.writeHead(503, { 'Content-Type': 'text/plain' });
      response.end('rejected by counting remote');
      return;
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const match = /^(\/[^/]+\/[^/]+\.git)\/(info\/refs|git-upload-pack)$/.exec(url.pathname);
    const gitDir = match === null ? undefined : options.repos[match[1] ?? ''];
    if (match === null || gitDir === undefined) {
      response.writeHead(404);
      response.end();
      return;
    }
    const protocol = request.headers['git-protocol'];
    const env = { ...process.env, ...(typeof protocol === 'string' ? { GIT_PROTOCOL: protocol } : {}) };

    if (match[2] === 'info/refs') {
      infoRefs += 1;
      if (url.searchParams.get('service') !== 'git-upload-pack') {
        response.writeHead(403);
        response.end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-advertisement', 'Cache-Control': 'no-cache' });
      // 프로토콜 v0/v1만 서비스 머리줄을 먼저 받는다. v2는 능력 광고가 곧 본문이다.
      if (!(typeof protocol === 'string' && protocol.includes('version=2'))) {
        response.write(`${pktLine('# service=git-upload-pack\n')}0000`);
      }
      const child = spawn('git', ['upload-pack', '--stateless-rpc', '--advertise-refs', gitDir], { env });
      child.stdout.pipe(response);
      child.stderr.resume();
      return;
    }

    uploadPack += 1;
    const chunks: Buffer[] = [];
    const body = request.headers['content-encoding'] === 'gzip' ? request.pipe(createGunzip()) : request;
    body.on('data', (chunk: Buffer) => chunks.push(chunk));
    body.on('end', () => {
      const payload = Buffer.concat(chunks);
      for (const found of payload.toString('latin1').matchAll(/want ([0-9a-f]{40})/g)) {
        if (found[1] !== undefined) wants.push(found[1]);
      }
      response.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-result', 'Cache-Control': 'no-cache' });
      const child = spawn('git', ['upload-pack', '--stateless-rpc', gitDir], { env });
      child.stdout.pipe(response);
      child.stderr.resume();
      child.stdin.end(payload);
    });
  };

  const server: Server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: (owner, repo) => `http://127.0.0.1:${String(port)}/${owner}/${repo}.git`,
    counters: () => ({ total, infoRefs, uploadPack, withAuth, authMatched, wants: [...wants] }),
    reset: () => {
      total = 0;
      infoRefs = 0;
      uploadPack = 0;
      withAuth = 0;
      authMatched = 0;
      wants = [];
    },
    setMode: (next) => {
      mode = next;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}

function pktLine(text: string): string {
  return `${(Buffer.byteLength(text) + 4).toString(16).padStart(4, '0')}${text}`;
}

/** `authArgs`가 만드는 것과 같은 헤더 값. 시험 전용 가짜 토큰에만 쓴다. */
export function basicAuthorization(token: string): string {
  return `Basic ${Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')}`;
}
