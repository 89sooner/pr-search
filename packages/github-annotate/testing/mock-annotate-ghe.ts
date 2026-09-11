/**
 * 표기 경로 전용 가짜 GHE (WP-075).
 *
 * **함수 반환값을 주입하는 대역이 아니라 실제 `node:http` 서버다.** 이 판에서
 * 증명해야 하는 것 대부분이 HTTP 자체에 있다 — 메서드가 `PATCH`인가, 경로가
 * 맞는가, 본문에 `title` 말고 다른 것이 실리지 않는가, 토큰이 헤더에만 있는가.
 * `fetch`를 가로채면 그 경로를 통째로 건너뛰고 아무것도 증명하지 못한다
 * (`packages/github/testing/mock-ghe.ts`가 세운 규율).
 *
 * 조회용 목과 나누는 이유는 **관측하는 것이 다르기 때문이다.** 그쪽은 본문을
 * 기록하지 않는다. 여기서는 본문이 검사 대상 자체다.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  /** 원문 그대로. 파싱 전 바이트를 봐야 "무엇을 보냈는가"를 말할 수 있다. */
  readonly rawBody: string;
}

/** 한 번의 응답 지시. 목록의 앞에서부터 하나씩 소비한다. */
export interface ScriptedResponse {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface MockAnnotateGheOptions {
  /** PR의 처음 제목. 기본값은 접두가 없는 평범한 제목이다. */
  readonly initialTitle?: string;
  /** `GET /pulls/{n}`에 순서대로 적용할 지시. 다 쓰면 정상 응답으로 돌아간다. */
  readonly getScript?: readonly ScriptedResponse[];
  /** `PATCH /pulls/{n}`에 순서대로 적용할 지시. 다 쓰면 정상 갱신한다. */
  readonly patchScript?: readonly ScriptedResponse[];
  /** 토큰 발급에 순서대로 적용할 지시. */
  readonly tokenScript?: readonly ScriptedResponse[];
  readonly tokenTtlMs?: number;
}

export interface MockAnnotateGhe {
  readonly apiUrl: string;
  readonly requests: RecordedRequest[];
  /** 목이 지금 들고 있는 제목. PATCH가 실제로 반영됐는지 본다. */
  readonly currentTitle: () => string;
  readonly tokenIssueCount: () => number;
  readonly issuedTokens: () => readonly string[];
  close(): Promise<void>;
}

export interface TestKeyPair {
  readonly privateKey: string;
  readonly publicKey: string;
}

/** 시험용 RSA 키. 실제 App 키를 쓰지 않는다. */
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

export async function startMockAnnotateGhe(options: MockAnnotateGheOptions = {}): Promise<MockAnnotateGhe> {
  const requests: RecordedRequest[] = [];
  const issuedTokens: string[] = [];
  let tokenIssueCount = 0;
  let title = options.initialTitle ?? 'Fix device initialization race';
  const getScript = [...(options.getScript ?? [])];
  const patchScript = [...(options.patchScript ?? [])];
  const tokenScript = [...(options.tokenScript ?? [])];

  const server: Server = createServer((request, response) => {
    void (async (): Promise<void> => {
      const path = request.url ?? '/';
      const rawBody = await readBody(request);
      requests.push({
        method: request.method ?? 'GET',
        path,
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : (value ?? '')]),
        ),
        rawBody,
      });

      const send = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
        response.writeHead(status, { 'content-type': 'application/json', ...headers });
        response.end(JSON.stringify(body));
      };
      const scripted = (script: ScriptedResponse[]): boolean => {
        const next = script.shift();
        if (next === undefined) return false;
        send(next.status, next.body ?? { message: 'scripted' }, { ...next.headers });
        return true;
      };

      if (request.method === 'POST' && path.includes('/access_tokens')) {
        if (scripted(tokenScript)) return;
        tokenIssueCount += 1;
        const token = `ghs_annot${String(tokenIssueCount).padStart(4, '0')}${'x'.repeat(28)}`;
        issuedTokens.push(token);
        send(201, { token, expires_at: new Date(Date.now() + (options.tokenTtlMs ?? 3_600_000)).toISOString() });
        return;
      }

      if (request.method === 'GET' && /\/pulls\/\d+$/.test(path)) {
        if (scripted(getScript)) return;
        send(200, { number: 1234, title, state: 'closed', merged: true });
        return;
      }

      if (request.method === 'PATCH' && /\/pulls\/\d+$/.test(path)) {
        if (scripted(patchScript)) return;
        const parsed = JSON.parse(rawBody === '' ? '{}' : rawBody) as { title?: unknown };
        // 실제 GitHub처럼 준 필드만 반영한다. 준 적 없는 필드를 바꾸지 않는다.
        if (typeof parsed.title === 'string') title = parsed.title;
        send(200, { number: 1234, title, state: 'closed', merged: true });
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
    currentTitle: () => title,
    tokenIssueCount: () => tokenIssueCount,
    issuedTokens: () => issuedTokens,
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
