/**
 * Operations Plane 시험용 가짜 GHE — **실제 HTTPS 서버**다 (WP-047 검증).
 *
 * gh는 GHES 호스트에 `https://`로만 나간다. 그래서 목은 TLS로 서야 하고, 실제
 * gh 바이너리가 그 목에 붙어 **GraphQL을 실제로 보내는가**를 관측하는 것이 이
 * 파일의 존재 이유다. `fetch`를 가로채면 gh 프로세스 자체를 건너뛴다.
 *
 * 인증서는 시험마다 `openssl`로 새로 만든다 — 개인 키를 저장소에 두지 않는다.
 * gh(Go)는 `SSL_CERT_FILE`로 신뢰 저장소를 받으므로 그 경로를 실행 환경에 준다.
 *
 * 관측하는 것:
 *   - GraphQL 요청의 메서드·경로·헤더·본문(원문)
 *   - 인가 코드 교환(`/login/oauth/access_token`)과 `/user`
 *   - 토큰이 **헤더에만** 있는가 (argv·URL에 없는가는 실행기 시험이 본다)
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
  readonly receivedAt: number;
}

export interface MockPullRequest {
  readonly number: number;
  readonly title: string;
  readonly state?: string;
  readonly author?: string;
  readonly headRefName?: string;
  readonly baseRefName?: string;
  readonly isDraft?: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface MockGheOptions {
  readonly pullRequests?: readonly MockPullRequest[];
  /**
   * GraphQL `nodes`를 **원문 그대로** 돌려준다. `pullRequests`의 정상 모양으로는 만들 수 없는 값
   * (`number: null`·문자열 번호·필드 누락)을 실제 gh에 흘려 결과 경계를 시험한다. 상태 필터는 적용하지
   * 않고 건수 상한만 적용한다.
   */
  readonly rawPullRequestNodes?: readonly Readonly<Record<string, unknown>>[];
  /** GraphQL 응답을 지연시킨다(ms). 시간 제한·취소 시험용. */
  readonly graphqlDelayMs?: number;
  /** GraphQL을 이 상태 코드로 거절한다. */
  readonly graphqlStatus?: number;
  /** 토큰 교환이 돌려줄 값. */
  readonly tokenResponse?: Record<string, unknown>;
  readonly tokenStatus?: number;
  readonly user?: { readonly id: number; readonly login: string };
  /** 인증 헤더의 토큰이 이 값과 다르면 401을 낸다. 생략하면 검사하지 않는다. */
  readonly expectedToken?: string;
}

export interface MockGhe {
  /** `127.0.0.1:포트` — gh의 `GH_HOST`·`--repo` 호스트 부분이다. */
  readonly host: string;
  /** `https://127.0.0.1:포트` */
  readonly baseUrl: string;
  readonly apiUrl: string;
  /** 자체 서명 CA. `SSL_CERT_FILE`로 준다. */
  readonly caFile: string;
  readonly requests: RecordedRequest[];
  readonly graphqlRequests: () => readonly RecordedRequest[];
  close(): Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function generateCertificate(dir: string): { key: Buffer; cert: Buffer } {
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  const result = spawnSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-keyout', keyPath, '-out', certPath, '-days', '2', '-subj', '/CN=127.0.0.1',
      '-addext', 'subjectAltName=IP:127.0.0.1',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`시험용 인증서를 만들지 못했다 (openssl 종료 코드 ${String(result.status)}): ${result.stderr}`);
  }
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

const ESC = '\x1b';

export async function startMockGhe(options: MockGheOptions = {}): Promise<MockGhe> {
  const dir = mkdtempSync(join(tmpdir(), 'prs-mock-ghe-'));
  const { key, cert } = generateCertificate(dir);
  const requests: RecordedRequest[] = [];
  const pullRequests = options.pullRequests ?? [
    { number: 12, title: `Fix ${ESC}[31mred${ESC}[0m race <script>x</script>`, author: 'alice', headRefName: 'fix/race', baseRefName: 'main' },
    { number: 11, title: 'Add thing', author: 'bob', headRefName: 'feat/thing', baseRefName: 'main', isDraft: true },
  ];

  const server: Server = createServer({ key, cert }, (request, response) => {
    void (async (): Promise<void> => {
      const rawBody = await readBody(request);
      const recorded: RecordedRequest = {
        method: request.method ?? 'GET',
        path: request.url ?? '/',
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(',') : (value ?? '')]),
        ),
        rawBody,
        receivedAt: Date.now(),
      };
      requests.push(recorded);

      const json = (status: number, body: unknown): void => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
      };

      if (recorded.path === '/login/oauth/access_token') {
        json(options.tokenStatus ?? 200, options.tokenResponse ?? {
          access_token: 'ghu_mockUserToken0000000000000001',
          expires_in: 28_800,
          refresh_token: 'ghr_mockRefreshToken00000000000001',
          refresh_token_expires_in: 15_897_600,
          scope: '',
          token_type: 'bearer',
        });
        return;
      }

      if (options.expectedToken !== undefined) {
        const auth = recorded.headers['authorization'] ?? '';
        if (!auth.endsWith(options.expectedToken)) {
          json(401, { message: 'Bad credentials' });
          return;
        }
      }

      if (recorded.path === '/api/v3/user') {
        json(200, { id: options.user?.id ?? 4242, login: options.user?.login ?? 'mock-user' });
        return;
      }

      if (recorded.path === '/api/graphql') {
        if (options.graphqlDelayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, options.graphqlDelayMs));
        if (options.graphqlStatus !== undefined && options.graphqlStatus !== 200) {
          json(options.graphqlStatus, { message: 'mock rejection' });
          return;
        }
        let parsed: { variables?: { limit?: number; state?: string[] } } = {};
        try {
          parsed = JSON.parse(rawBody) as typeof parsed;
        } catch {
          /* 본문이 JSON이 아니면 빈 목록이다 */
        }
        const limit = parsed.variables?.limit ?? 30;
        const states = parsed.variables?.state ?? ['OPEN'];
        const nodes = options.rawPullRequestNodes !== undefined ? options.rawPullRequestNodes.slice(0, limit) : pullRequests
          .filter((pr) => states.includes((pr.state ?? 'OPEN').toUpperCase()))
          .slice(0, limit)
          .map((pr) => ({
            number: pr.number,
            title: pr.title,
            state: (pr.state ?? 'OPEN').toUpperCase(),
            url: `https://127.0.0.1/acme/payments/pull/${String(pr.number)}`,
            author: { login: pr.author ?? 'alice', id: 'U_1', name: pr.author ?? 'alice' },
            headRefName: pr.headRefName ?? 'feature',
            baseRefName: pr.baseRefName ?? 'main',
            isDraft: pr.isDraft ?? false,
            createdAt: pr.createdAt ?? '2026-09-01T00:00:00Z',
            updatedAt: pr.updatedAt ?? '2026-09-02T00:00:00Z',
          }));
        json(200, {
          data: {
            repository: {
              pullRequests: { totalCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes },
            },
          },
        });
        return;
      }

      json(404, { message: 'mock: not found' });
    })().catch(() => {
      response.writeHead(500);
      response.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const host = `127.0.0.1:${String(port)}`;

  return {
    host,
    baseUrl: `https://${host}`,
    apiUrl: `https://${host}/api/v3`,
    caFile: join(dir, 'cert.pem'),
    requests,
    graphqlRequests: () => requests.filter((request) => request.path === '/api/graphql'),
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
