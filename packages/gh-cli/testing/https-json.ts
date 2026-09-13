/**
 * 시험용 HTTPS JSON 클라이언트 — 자체 서명 CA를 신뢰한다.
 *
 * 운영의 `fetchJson`(전역 `fetch`)은 `NODE_EXTRA_CA_CERTS`를 **프로세스 시작 시** 읽으므로
 * 시험 안에서 만든 인증서를 신뢰시킬 수 없다. 그래서 시험은 `node:https`로 같은 모양
 * (`HttpJson`)을 만들어 주입한다. 요청·응답의 해석은 운영과 같다 — JSON이면 파싱, 아니면 문자열.
 */

import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';

export type HttpJsonLike = (
  url: string,
  init: { readonly method: 'GET' | 'POST' | 'DELETE'; readonly headers: Readonly<Record<string, string>>; readonly body?: string },
) => Promise<{ readonly status: number; readonly body: unknown }>;

export function httpsJson(caFile: string): HttpJsonLike {
  const ca = readFileSync(caFile);
  return (url, init) =>
    new Promise((resolve, reject) => {
      const target = new URL(url);
      const req = httpsRequest(
        target,
        { method: init.method, headers: { ...init.headers }, ca, rejectUnauthorized: true },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let body: unknown = text === '' ? null : text;
            if (text !== '') {
              try {
                body = JSON.parse(text);
              } catch {
                body = text;
              }
            }
            resolve({ status: res.statusCode ?? 0, body });
          });
        },
      );
      req.on('error', reject);
      if (init.body !== undefined) req.write(init.body);
      req.end();
    });
}
