/**
 * 연동 경로의 엄격한 입력 해석 (CR-112 / 공통 계약 10장, PSI-F03~F05).
 *
 * ## 왜 Fastify의 해석을 그대로 쓰지 않나
 *
 * Fastify는 같은 key가 두 번 오면 배열을 준다. 기존 라우트는 배열을 "값 없음"으로 읽는다 — 예를 들어
 * `/search?q=a&q=b`는 `q`가 빈 질의가 되어 **범위 안 전체**를 돌려준다. PIPE BFF와 pr-search가 같은
 * URL을 서로 다르게 읽는 자리를 없애려고, 연동 경로는 원시 query 문자열을 직접 해석해
 *
 * - 같은 key의 중복, 목록에 없는 key, 깨진 percent-encoding, 제어 문자를 **거절하고**
 * - 통과한 값만 문자열 하나씩 기존 실행 함수에 넘긴다.
 *
 * 값의 뜻(빈 문자열·미지정·0)은 바꾸지 않는다 — 기존 실행 함수가 그대로 판정한다. `+`는 Fastify의
 * 기본 해석과 같게 공백으로 읽는다.
 *
 * ## 경로 파라미터
 *
 * `owner/repo`는 `%2F` 하나로 인코딩된 한 조각이다. Fastify가 한 번 푼 값에 `%`가 남아 있으면 이중
 * 인코딩이다 — 기존 상세 경로는 거기서 한 번 더 풀어 받아들이지만(DEV-730), 연동은 거절한다.
 */

import { PsiError } from './errors.js';

const REPOSITORY = /^([A-Za-z0-9._-]{1,100})\/([A-Za-z0-9._-]{1,100})$/;

function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function decodeComponent(raw: string): string {
  // `decodeURIComponent`는 잘못된 escape와 UTF-8이 아닌 바이트열에서 던진다 — 둘 다 거절 대상이다.
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    throw new PsiError('INVALID_REQUEST', 'query_malformed_encoding');
  }
}

/**
 * 원시 URL의 query를 엄격하게 해석한다.
 *
 * @param rawUrl `request.raw.url` — 경로와 query 원문.
 * @throws {PsiError} `INVALID_REQUEST`
 */
export function parseStrictQuery(rawUrl: string, allowed: readonly string[]): Record<string, string> {
  if (rawUrl.includes('#')) throw new PsiError('INVALID_REQUEST', 'fragment_in_target');
  const separator = rawUrl.indexOf('?');
  const out: Record<string, string> = {};
  if (separator < 0) return out;

  const allowedSet = new Set(allowed);
  const seen = new Set<string>();
  for (const part of rawUrl.slice(separator + 1).split('&')) {
    if (part === '') continue;
    const equals = part.indexOf('=');
    const key = decodeComponent(equals < 0 ? part : part.slice(0, equals));
    const value = equals < 0 ? '' : decodeComponent(part.slice(equals + 1));
    if (key === '' || hasControl(key) || hasControl(value)) throw new PsiError('INVALID_REQUEST', 'query_control_character');
    if (!allowedSet.has(key)) throw new PsiError('INVALID_REQUEST', 'query_unknown_parameter');
    if (seen.has(key)) throw new PsiError('INVALID_REQUEST', 'query_duplicate_parameter');
    seen.add(key);
    out[key] = value;
  }
  return out;
}

/**
 * `owner/repo` 경로 파라미터 (Fastify가 한 번 푼 값).
 *
 * @throws {PsiError} `INVALID_REQUEST` — 남은 `%`(이중 인코딩)·dot segment·역슬래시·제어 문자.
 */
export function strictRepositoryParam(decoded: string | undefined): string {
  const value = decoded ?? '';
  const match = REPOSITORY.exec(value);
  if (match === null) throw new PsiError('INVALID_REQUEST', 'path_repository_format');
  const [, owner, name] = match;
  if (owner === '.' || owner === '..' || name === '.' || name === '..') throw new PsiError('INVALID_REQUEST', 'path_dot_segment');
  return value;
}

/** 그 밖의 경로 조각 — `%`가 남았거나 제어 문자가 있으면 거절한다. 값의 형식은 기존 실행 함수가 본다. */
export function strictPlainParam(decoded: string | undefined): string {
  const value = decoded ?? '';
  if (value === '' || value.includes('%') || value.includes('/') || value.includes('\\') || hasControl(value)) {
    throw new PsiError('INVALID_REQUEST', 'path_segment_format');
  }
  return value;
}
