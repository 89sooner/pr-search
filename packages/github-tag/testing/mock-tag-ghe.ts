/**
 * 태그 경로 전용 가짜 GHE (WP-100).
 *
 * 표기의 목(`packages/github-annotate/testing/mock-annotate-ghe.ts`)과 같은 규율이다 —
 * `fetch`를 가로채지 않고 실제 `node:http` 서버를 띄운다. 증명할 것이 HTTP 자체에 있다:
 * 메서드가 `POST`인가, 경로가 `/git/refs`인가, 본문이 `{ref, sha}` 둘뿐인가, `PATCH`·`DELETE`가
 * 한 번도 오지 않는가, 토큰이 헤더에만 있는가.
 *
 * 목은 ref 저장소(`refs/tags/<name>` → `{sha, type}`)를 갖고 실제 GitHub처럼 답한다:
 * 같은 이름을 다시 만들면 422, 모르는 SHA를 가리키면 422(`knownShas`를 준 경우), 없는
 * ref는 404, `matching-refs`는 100개씩 페이지.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
  readonly receivedAt: number;
}

export interface ScriptedResponse {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  /** 응답을 이만큼 늦춘다 — 시한 초과·중단을 만든다. */
  readonly delayMs?: number;
}

export interface MockRef {
  readonly sha: string;
  /** `commit`(lightweight) 또는 `tag`(annotated). */
  readonly type: 'commit' | 'tag';
}

export interface MockTagGheOptions {
  /** 처음부터 있는 태그. 키는 `refs/tags/` 뒤의 이름이다. */
  readonly initialRefs?: Readonly<Record<string, MockRef>>;
  /** 주면 이 밖의 SHA를 가리키는 생성 요청은 422(`Object does not exist`)다. */
  readonly knownShas?: readonly string[];
  /** `GET /git/ref/tags/…`에 순서대로 적용할 지시. */
  readonly getScript?: readonly ScriptedResponse[];
  /** `POST /git/refs`에 순서대로 적용할 지시. `body`가 없고 status가 2xx면 실제로 만들고 답한다. */
  readonly postScript?: readonly ScriptedResponse[];
  /** `GET /git/matching-refs/…`에 순서대로 적용할 지시. */
  readonly listScript?: readonly ScriptedResponse[];
  readonly tokenScript?: readonly ScriptedResponse[];
  readonly tokenTtlMs?: number;
  /** 요청을 기록한 직후, 응답을 만들기 전에 불린다. */
  readonly onRequest?: (request: RecordedRequest, control: MockControl) => void | Promise<void>;
}

export interface MockControl {
  readonly setRef: (name: string, ref: MockRef) => void;
  readonly deleteRef: (name: string) => void;
  readonly requestCount: () => number;
}

export interface MockTagGhe {
  readonly apiUrl: string;
  readonly requests: RecordedRequest[];
  /** 목이 지금 들고 있는 태그 전부. */
  readonly refs: () => ReadonlyMap<string, MockRef>;
  readonly setRef: (name: string, ref: MockRef) => void;
  readonly deleteRef: (name: string) => void;
  readonly tokenIssueCount: () => number;
  close(): Promise<void>;
}

export interface TestKeyPair {
  readonly privateKey: string;
  readonly publicKey: string;
}

export function generateTestKeyPair(): TestKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return { privateKey, publicKey };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function refBody(name: string, ref: MockRef): Record<string, unknown> {
  return { ref: `refs/tags/${name}`, node_id: `MDM6UmVm${name}`, url: `/git/refs/tags/${name}`, object: { type: ref.type, sha: ref.sha, url: `/git/${ref.type}s/${ref.sha}` } };
}

export async function startMockTagGhe(options: MockTagGheOptions = {}): Promise<MockTagGhe> {
  const requests: RecordedRequest[] = [];
  const refs = new Map<string, MockRef>(Object.entries(options.initialRefs ?? {}));
  const knownShas = options.knownShas === undefined ? undefined : new Set(options.knownShas.map((one) => one.toLowerCase()));
  let tokenIssueCount = 0;
  const getScript = [...(options.getScript ?? [])];
  const postScript = [...(options.postScript ?? [])];
  const listScript = [...(options.listScript ?? [])];
  const tokenScript = [...(options.tokenScript ?? [])];

  const server: Server = createServer((request, response) => {
    void (async (): Promise<void> => {
      const path = request.url ?? '/';
      const rawBody = await readBody(request);
      const recorded: RecordedRequest = {
        method: request.method ?? 'GET',
        path,
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : (value ?? '')]),
        ),
        rawBody,
        receivedAt: Date.now(),
      };
      requests.push(recorded);
      await options.onRequest?.(recorded, {
        setRef: (name, ref) => {
          refs.set(name, ref);
        },
        deleteRef: (name) => {
          refs.delete(name);
        },
        requestCount: () => requests.length,
      });

      const send = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
        response.writeHead(status, { 'content-type': 'application/json', ...headers });
        response.end(JSON.stringify(body));
      };
      const scripted = async (script: ScriptedResponse[]): Promise<ScriptedResponse | undefined> => {
        const next = script.shift();
        if (next === undefined) return undefined;
        if (next.delayMs !== undefined) await new Promise<void>((resolve) => setTimeout(resolve, next.delayMs));
        return next;
      };
      const pathname = new URL(path, 'http://mock').pathname;
      const search = new URL(path, 'http://mock').searchParams;

      if (request.method === 'POST' && pathname.includes('/access_tokens')) {
        const next = await scripted(tokenScript);
        if (next !== undefined) { send(next.status, next.body ?? { message: 'scripted' }, { ...next.headers }); return; }
        tokenIssueCount += 1;
        send(201, { token: `ghs_tag${String(tokenIssueCount).padStart(4, '0')}${'x'.repeat(30)}`, expires_at: new Date(Date.now() + (options.tokenTtlMs ?? 3_600_000)).toISOString() });
        return;
      }

      const single = /\/git\/ref\/tags\/([^/?]+)$/.exec(pathname);
      if (request.method === 'GET' && single !== null) {
        const next = await scripted(getScript);
        if (next !== undefined) { send(next.status, next.body ?? { message: 'scripted' }, { ...next.headers }); return; }
        const name = decodeURIComponent(single[1] as string);
        const ref = refs.get(name);
        if (ref === undefined) { send(404, { message: 'Not Found' }); return; }
        send(200, refBody(name, ref));
        return;
      }

      const listing = /\/git\/matching-refs\/tags\/([^/?]*)$/.exec(pathname);
      if (request.method === 'GET' && listing !== null) {
        const next = await scripted(listScript);
        if (next !== undefined) { send(next.status, next.body ?? { message: 'scripted' }, { ...next.headers }); return; }
        const prefix = decodeURIComponent(listing[1] as string);
        const perPage = Number(search.get('per_page') ?? '30');
        const page = Number(search.get('page') ?? '1');
        const all = [...refs.entries()].filter(([name]) => name.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        const slice = all.slice((page - 1) * perPage, page * perPage);
        send(200, slice.map(([name, ref]) => refBody(name, ref)));
        return;
      }

      if (request.method === 'POST' && pathname.endsWith('/git/refs')) {
        const next = await scripted(postScript);
        if (next !== undefined && next.body !== undefined) { send(next.status, next.body, { ...next.headers }); return; }
        if (next !== undefined && next.status >= 300) { send(next.status, { message: 'scripted' }, { ...next.headers }); return; }
        const parsed = JSON.parse(rawBody === '' ? '{}' : rawBody) as { ref?: unknown; sha?: unknown };
        if (typeof parsed.ref !== 'string' || !parsed.ref.startsWith('refs/tags/') || typeof parsed.sha !== 'string') {
          send(422, { message: 'Validation Failed' });
          return;
        }
        const name = parsed.ref.slice('refs/tags/'.length);
        if (refs.has(name)) { send(422, { message: 'Reference already exists' }); return; }
        if (knownShas !== undefined && !knownShas.has(parsed.sha.toLowerCase())) { send(422, { message: 'Object does not exist' }); return; }
        const ref: MockRef = { sha: parsed.sha.toLowerCase(), type: 'commit' };
        refs.set(name, ref);
        send(201, refBody(name, ref));
        return;
      }

      // 이동·삭제는 **있어서는 안 되는 요청**이다. 기록은 남기고(시험이 0건을 단언한다) 405로 거절한다.
      if (request.method === 'PATCH' || request.method === 'DELETE') {
        send(405, { message: 'mock: refs are immutable in this test double' });
        return;
      }

      send(404, { message: 'Not Found' });
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;

  return {
    apiUrl: `http://127.0.0.1:${String(address.port)}/api/v3`,
    requests,
    refs: () => refs,
    setRef: (name, ref) => {
      refs.set(name, ref);
    },
    deleteRef: (name) => {
      refs.delete(name);
    },
    tokenIssueCount: () => tokenIssueCount,
    close: async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      });
    },
  };
}
