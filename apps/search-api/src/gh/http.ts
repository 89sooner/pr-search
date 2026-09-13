/**
 * Operations App 인가 왕복에 쓰는 HTTP (FR-GH-008).
 *
 * 전역 `fetch`를 `HttpJson` 모양으로 감싼다. 응답 본문은 JSON이면 파싱하고 아니면
 * 문자열이다. **오류 메시지에 본문을 싣지 않는다** — 토큰 응답이 섞일 수 있다.
 */

import type { HttpJson } from './identity.js';

const REQUEST_TIMEOUT_MS = 10_000;

export const fetchJson: HttpJson = async (url, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: init.body }),
      redirect: 'manual',
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown = text;
    if (text !== '') {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    } else {
      body = null;
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
};
