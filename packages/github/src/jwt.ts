/**
 * GitHub App JWT (RS256).
 *
 * App 인증은 설치 토큰을 받아오기 위한 단계다. 이 JWT 자체가 자격 증명이므로
 * 로그·오류에 남기지 않는다 (THR-009).
 *
 * 의존성을 더하지 않고 `node:crypto`로 서명한다 — 서명 형식이 단순하고
 * (`RS256`), 라이브러리를 하나 더 들이는 것보다 검증하기 쉽다.
 */

import { createSign } from 'node:crypto';

/** GitHub이 허용하는 상한은 10분이다. 시계 오차를 감안해 조금 줄여 쓴다. */
const DEFAULT_TTL_SECONDS = 9 * 60;
/** 발급자 시계가 조금 빨라도 거부되지 않도록 뒤로 당긴다. */
const CLOCK_SKEW_SECONDS = 60;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export interface AppJwtOptions {
  readonly appId: string;
  readonly privateKey: string;
  readonly now?: Date;
  readonly ttlSeconds?: number;
}

export function createAppJwt(options: AppJwtOptions): string {
  if (options.appId === '') throw new Error('GitHub App ID가 설정되지 않았다');
  if (options.privateKey === '') throw new Error('GitHub App private key가 설정되지 않았다');

  const issuedAt = Math.floor((options.now ?? new Date()).getTime() / 1000) - CLOCK_SKEW_SECONDS;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iat: issuedAt,
      exp: issuedAt + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS),
      iss: options.appId,
    }),
  );

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${signer.sign(options.privateKey, 'base64url')}`;
}
