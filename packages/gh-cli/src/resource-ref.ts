/**
 * 자원 참조의 식별 규칙과 출력 URL 해석 (SRS 9.8 3항 `GhResourceRef`, ADR-020, CR-089).
 *
 * ## 참조는 권한이 아니다
 *
 * 참조를 만들었다는 것은 「이 자원을 가리킨다」일 뿐이다. 그것을 입력으로 쓰는 실행은 그때의 접근 범위를 다시
 * 확인한다. 그래서 여기에는 DB·토큰·네트워크가 없다 — 순수 함수다.
 *
 * ## 호스트·저장소는 실행 컨텍스트에서 온다
 *
 * `pr list`의 행에는 `url`이 있지만 참조의 `host`·`repository`는 검증된 실행 컨텍스트(서버 설정의 호스트와
 * 재검증한 저장소)에서 온다. 출력 URL로 참조를 만드는 자리(`pr create`가 찍는 URL)도 **URL이 컨텍스트와 같을 때만**
 * 참조가 된다 — URL이 컨텍스트를 덮지 않는다. 이관·포크·새 저장소처럼 결과가 본래 다른 저장소에 생기는 command만
 * 저장소를 URL에서 읽고(`repository: 'url'`), 호스트는 그때도 대조한다.
 *
 * ## URL 문법의 근거
 *
 * 고정 gh 2.97.0이 **같은 자원 종류의 URL을 인자로 읽을 때 쓰는 문법**만 받는다. 출력 URL은 gh가 찍은 한 줄이므로
 * 꼬리(`/files`)·쿼리·조각(`#issuecomment-…`)이 없어야 한다 — 있으면 다른 것(comment)을 가리킨다.
 *
 * | 문법 | gh 근거 (v2.97.0) |
 * | --- | --- |
 * | `pull_request` `/{owner}/{repo}/pull/{number}` | `pkg/cmd/pr/shared/finder.go:301` `pullURLRE` |
 * | `issue` `/{owner}/{repo}/issues/{number}` | `pkg/cmd/issue/shared/lookup.go:19` `issueURLRE` (그 식은 `/pull/`도 받지만 issue 참조로는 `/issues/`만) |
 * | `discussion` `/{owner}/{repo}/discussions/{number}` | `pkg/cmd/discussion/shared/lookup.go:13` |
 * | `repository` `/{owner}/{repo}` | `internal/ghrepo/repo.go:61` `FromURL` (경로 조각 정확히 둘) |
 */

import { parseRepositorySlug, type RepositorySlug } from './constraints.js';
import type { GhResourceKind, GhResourceRef, GhUrlGrammar } from './types.js';

export const RESOURCE_KINDS: readonly GhResourceKind[] = [
  'repository',
  'pull_request',
  'issue',
  'discussion',
  'workflow',
  'workflow_run',
  'release',
  'project',
  'codespace',
  'artifact',
  'gist',
  'user',
  'team',
  'branch',
  'commit',
];

/** 저장소에 속하는 자원 — 참조에 저장소가 있어야 하고, 입력으로 쓸 때 실행 컨텍스트의 저장소와 같아야 한다. */
export const REPOSITORY_SCOPED_KINDS: ReadonlySet<GhResourceKind> = new Set(['pull_request', 'issue', 'discussion', 'workflow', 'workflow_run', 'release', 'branch', 'commit']);

/**
 * 이 판이 식별 규칙을 정한 자원 종류. project(소유자 자리가 없다)·user·team·artifact·gist는 종류로 분류하되
 * 참조를 만들지 않는다 — 규칙 없이 만든 참조는 검증할 수 없다.
 */
export const IDENTIFIABLE_KINDS: ReadonlySet<GhResourceKind> = new Set(['repository', 'pull_request', 'issue', 'discussion', 'workflow', 'workflow_run', 'release', 'codespace', 'branch', 'commit']);

/** `ghe.example.com` 또는 `127.0.0.1:48443`. */
const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,252})(?::[0-9]{1,5})?$/;
/** REST `databaseId` — 선행 0 없는 양의 10진수. */
const POSITIVE_DECIMAL = /^[1-9][0-9]{0,15}$/;
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** 태그·브랜치·codespace 이름: 비어 있지 않고 제어 문자·공백 없이, argv에서 flag로 읽힐 선행 하이픈 없이(255자 이하). */
function isSafeName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255 || value.startsWith('-')) return false;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || /\s/u.test(char)) return false;
  }
  return true;
}

const REF_KEYS = ['host', 'id', 'kind', 'number', 'ref', 'repository'] as const;

export type GhRefProblem = 'shape' | 'host' | 'kind' | 'kind_mismatch' | 'kind_without_identity_rule' | 'repository' | 'number' | 'id' | 'ref' | 'unexpected_identity';

export type GhRefValidation = { readonly ok: true; readonly ref: GhResourceRef } | { readonly ok: false; readonly problem: GhRefProblem };

export function refTypeName(kind: GhResourceKind): string {
  return `${kind.split('_').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join('')}Ref`;
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * 값이 식별 규칙에 맞는 참조인가. 자리마다 종류가 정한 값만 채워져 있어야 하고 나머지는 `null`이다 —
 * 같은 숫자의 issue·PR·workflow run이 같은 참조로 읽히지 않게 종류와 자리가 함께 맞아야 한다.
 */
export function validateResourceRef(value: unknown, expected?: GhResourceKind): GhRefValidation {
  if (!isPlainRecord(value)) return { ok: false, problem: 'shape' };
  const keys = Object.keys(value).sort();
  if (keys.length !== REF_KEYS.length || keys.some((key, index) => key !== REF_KEYS[index])) return { ok: false, problem: 'shape' };
  const { host, kind, repository, id, number, ref } = value as Record<(typeof REF_KEYS)[number], unknown>;
  if (typeof host !== 'string' || !HOST.test(host)) return { ok: false, problem: 'host' };
  if (typeof kind !== 'string' || !(RESOURCE_KINDS as readonly string[]).includes(kind)) return { ok: false, problem: 'kind' };
  const resourceKind = kind as GhResourceKind;
  if (expected !== undefined && resourceKind !== expected) return { ok: false, problem: 'kind_mismatch' };
  if (!IDENTIFIABLE_KINDS.has(resourceKind)) return { ok: false, problem: 'kind_without_identity_rule' };

  const repositoryOk = typeof repository === 'string' && parseRepositorySlug(repository) !== null;
  const scoped = REPOSITORY_SCOPED_KINDS.has(resourceKind) || resourceKind === 'repository';
  if (scoped && !repositoryOk) return { ok: false, problem: 'repository' };
  if (!scoped && repository !== null && !repositoryOk) return { ok: false, problem: 'repository' };

  const positiveNumber = typeof number === 'number' && Number.isSafeInteger(number) && number > 0;
  switch (resourceKind) {
    case 'pull_request':
    case 'issue':
    case 'discussion':
      if (!positiveNumber) return { ok: false, problem: 'number' };
      if (id !== null || ref !== null) return { ok: false, problem: 'unexpected_identity' };
      break;
    case 'workflow_run':
    case 'workflow':
      if (typeof id !== 'string' || !POSITIVE_DECIMAL.test(id)) return { ok: false, problem: 'id' };
      if (number !== null || ref !== null) return { ok: false, problem: 'unexpected_identity' };
      break;
    case 'release':
    case 'branch':
      if (!isSafeName(ref)) return { ok: false, problem: 'ref' };
      if (number !== null || id !== null) return { ok: false, problem: 'unexpected_identity' };
      break;
    case 'commit':
      if (typeof ref !== 'string' || !COMMIT_SHA.test(ref)) return { ok: false, problem: 'ref' };
      if (number !== null || id !== null) return { ok: false, problem: 'unexpected_identity' };
      break;
    case 'repository':
      if (id !== null || number !== null || ref !== null) return { ok: false, problem: 'unexpected_identity' };
      break;
    case 'codespace':
      if (!isSafeName(id)) return { ok: false, problem: 'id' };
      if (number !== null || ref !== null) return { ok: false, problem: 'unexpected_identity' };
      break;
    default:
      return { ok: false, problem: 'kind_without_identity_rule' };
  }
  return { ok: true, ref: { host, kind: resourceKind, repository: (repository as string | null) ?? null, id: (id as string | null) ?? null, number: (number as number | null) ?? null, ref: (ref as string | null) ?? null } };
}

export interface GhRefContext {
  /** 서버 설정의 호스트 (`GHE_BASE_URL`의 host 부분). */
  readonly host: string;
  /** 재검증한 실행 저장소. 저장소가 없는 실행(검색)은 `null`. */
  readonly repository: RepositorySlug | null;
}

export const slugOf = (slug: RepositorySlug): string => `${slug.owner}/${slug.name}`;

function sameSlug(left: RepositorySlug, right: RepositorySlug): boolean {
  // GitHub의 소유자·저장소 이름은 대소문자를 가리지 않는다 (gh `ghrepo.IsSame`도 EqualFold).
  return left.owner.toLowerCase() === right.owner.toLowerCase() && left.name.toLowerCase() === right.name.toLowerCase();
}

export type GhUrlRefProblem = 'not_a_url' | 'scheme' | 'credentials' | 'query_or_fragment' | 'host_mismatch' | 'grammar' | 'repository_missing' | 'repository_mismatch';

export type GhUrlRefOutcome = { readonly ok: true; readonly ref: GhResourceRef } | { readonly ok: false; readonly problem: GhUrlRefProblem };

const URL_GRAMMARS: Readonly<Record<GhUrlGrammar, { readonly pattern: RegExp; readonly kind: GhResourceKind }>> = {
  pull_request: { pattern: /^\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]{0,15})$/, kind: 'pull_request' },
  issue: { pattern: /^\/([^/]+)\/([^/]+)\/issues\/([1-9][0-9]{0,15})$/, kind: 'issue' },
  discussion: { pattern: /^\/([^/]+)\/([^/]+)\/discussions\/([1-9][0-9]{0,15})$/, kind: 'discussion' },
  repository: { pattern: /^\/([^/]+)\/([^/]+)$/, kind: 'repository' },
};

/**
 * gh가 stdout에 찍은 URL 한 줄을 참조로 읽는다.
 *
 * @param repositorySource `execution_context`면 URL의 저장소가 컨텍스트와 같아야 하고 참조의 저장소는 **컨텍스트의 값**이다.
 *   `url`이면 결과가 본래 다른 저장소에 생기는 command(이관·포크·생성)이며 저장소를 URL에서 읽는다. 호스트는 둘 다 대조한다.
 */
export function refFromOutputUrl(raw: string, grammar: GhUrlGrammar, context: GhRefContext, repositorySource: 'execution_context' | 'url'): GhUrlRefOutcome {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, problem: 'not_a_url' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, problem: 'scheme' };
  if (url.username !== '' || url.password !== '') return { ok: false, problem: 'credentials' };
  if (url.search !== '' || url.hash !== '' || raw.includes('#') || raw.includes('?')) return { ok: false, problem: 'query_or_fragment' };
  if (url.host.toLowerCase() !== context.host.toLowerCase()) return { ok: false, problem: 'host_mismatch' };
  const rule = URL_GRAMMARS[grammar];
  const match = rule.pattern.exec(url.pathname);
  if (match === null) return { ok: false, problem: 'grammar' };
  const fromUrl = parseRepositorySlug(`${match[1] ?? ''}/${match[2] ?? ''}`);
  if (fromUrl === null) return { ok: false, problem: 'grammar' };

  let repository: RepositorySlug;
  if (repositorySource === 'execution_context') {
    if (context.repository === null) return { ok: false, problem: 'repository_missing' };
    if (!sameSlug(fromUrl, context.repository)) return { ok: false, problem: 'repository_mismatch' };
    repository = context.repository;
  } else {
    repository = fromUrl;
  }
  const number = match[3] === undefined ? null : Number(match[3]);
  const candidate: GhResourceRef = { host: context.host, kind: rule.kind, repository: slugOf(repository), id: null, number, ref: null };
  const validated = validateResourceRef(candidate, rule.kind);
  return validated.ok ? { ok: true, ref: validated.ref } : { ok: false, problem: 'grammar' };
}
