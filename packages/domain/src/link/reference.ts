/**
 * 참조 표현 추출과 **안정 참조 식별자** (WP-029 / CR-039, DEV-217).
 *
 * ## 왜 대상이 아니라 표현이 정체성인가
 *
 * FR-REL-003 AC-3은 "대상이 아직 색인되지 않았으면 미해결로 저장하고, 대상 색인
 * 시 해결 상태로 **갱신**한다"를 요구한다. 그런데 간선 ID를 대상(`to_id`)으로
 * 만들면 `Refs: abc1234`가 해결되는 순간 대상이 축약 SHA에서 40자 SHA로 바뀌고
 * **ID가 함께 바뀐다.** 그러면 갱신이 아니라 새 문서가 되고 미해결 간선이 그대로
 * 남는다 — AC-3·멱등·결정론적 ID 셋이 한 번에 깨진다.
 *
 * 그래서 `references` 간선의 정체성은 **본문에 적힌 참조 표현**이다. 표현은
 * 대상이 나중에 무엇으로 밝혀지든 바뀌지 않는다.
 *
 * ## `reference_key`는 원문이 아니라 정규화된 locator다
 *
 * 원문을 그대로 쓰면 `#20`과 `acme/a#20`(같은 저장소 안에서)이 다른 키가 되어
 * 같은 참조가 간선 둘이 된다. 반대로 저장소 **등록 상태**로 정규화하면 나중에
 * 등록되는 순간 키가 바뀐다. 그래서 정규화 기준은 **본문이 말한 것**뿐이다:
 * 소문자로 맞추고, source 저장소를 가리키면 저장소 구간을 생략한다.
 */

import { createHash } from 'node:crypto';

import { EVIDENCE_LIMIT, maskExcluded } from './text.js';

import {
  FULL_SHA_LENGTH,
  MAX_REFERENCE_SHA_PREFIX_LENGTH,
  MIN_SHA_PREFIX_LENGTH,
} from '../constants.js';

/** 한 source 문서가 만드는 **고유** 참조 간선의 상한 (FR-REL-003 AC-5). */
export const REFERENCE_LIMIT = 100;

/**
 * 본문에서 참조로 인정하는 축약 SHA 길이 (FR-REL-003 AC-1).
 *
 * 상수는 `constants.ts`가 소유한다 — 6자 이하는 ADR-012가 금지하고, 13~39자는
 * 축약도 전체도 아니므로 참조가 아니다.
 */
export const ABBREV_SHA_MIN = MIN_SHA_PREFIX_LENGTH;
export const ABBREV_SHA_MAX = MAX_REFERENCE_SHA_PREFIX_LENGTH;

/**
 * 근거 텍스트 상한.
 *
 * 근거는 화면에 "왜 이 간선이 있는가"를 보여 주기 위한 것이지 검색 대상이
 * 아니다(매핑이 `index: false`). 본문을 통째로 복제하면 그 순간 links 인덱스가
 * PR 본문의 두 번째 사본이 된다 (NFR-005).
 */
export { EVIDENCE_LIMIT } from './text.js';

export interface RepoSlug {
  readonly owner: string;
  readonly name: string;
}

/**
 * 참조가 가리키는 것.
 *
 * `repo`가 `null`이면 **source 저장소**다. 간선은 언제나 source 저장소 범위로
 * 저장되므로 생략이 모호하지 않다.
 */
export type ReferenceTarget =
  | { readonly kind: 'pull_request'; readonly repo: RepoSlug | null; readonly number: number }
  | { readonly kind: 'commit'; readonly repo: RepoSlug | null; readonly sha: string }
  | { readonly kind: 'commit_prefix'; readonly repo: RepoSlug | null; readonly prefix: string };

/** 트레일러는 구조 파생, 본문 언급은 텍스트 추정 (FR-REL-003 AC-2). */
export type ReferenceConfidence = 'derived' | 'heuristic';

export interface ExtractedReference {
  /** 해결 대상과 독립인 안정 식별자. */
  readonly reference_key: string;
  readonly target: ReferenceTarget;
  readonly confidence: ReferenceConfidence;
  readonly evidence: string;
}

export interface ExtractOptions {
  /** 이 본문을 소유한 저장소. 같은 저장소를 가리키는 참조의 정규화에 쓴다. */
  readonly sourceRepo: RepoSlug;
  /**
   * 승인된 GHE 호스트. **없으면 URL 참조를 추출하지 않는다** (THR-036).
   *
   * 검증할 근거가 없는 상태에서 URL을 내부 대상으로 해석하면, 외부가 심은
   * 문자열이 내부 조회를 유발한다. 모르면 하지 않는 것이 fail closed다.
   */
  readonly gheHost?: string | null;
  readonly limit?: number;
}

const SEPARATOR = '';

/**
 * 참조 표현의 정규화 locator.
 *
 * **대상이 해결돼도 이 값을 바꾸지 않는다.** `to_id`·`to_repository_id`만 채운다.
 */
export function referenceKey(target: ReferenceTarget): string {
  const scope = target.repo === null ? '' : `x:${target.repo.owner}/${target.repo.name}:`;
  switch (target.kind) {
    case 'pull_request':
      return `${scope}pr:${String(target.number)}`;
    case 'commit':
      return `${scope}commit:${target.sha}`;
    case 'commit_prefix':
      return `${scope}commit-prefix:${target.prefix}`;
  }
}

/**
 * `references` 간선의 결정론적 ID.
 *
 * 재료는 `link_type` + source identity + `reference_key`다. **대상이 들어가지
 * 않는다** — 그것이 이 함수의 존재 이유다 (DEV-217).
 */
export function referenceLinkId(fromType: string, fromId: string, key: string): string {
  return createHash('sha256')
    .update(['references', fromType, fromId, key].join(SEPARATOR), 'utf8')
    .digest('hex');
}

const KEY_SHAPE = new RegExp(
  `^(?:x:(?<owner>${'[a-z0-9][a-z0-9._-]*'})\\/(?<name>${'[a-z0-9][a-z0-9._-]*'}):)?` +
    `(?:pr:(?<pr>\\d+)|commit:(?<sha>[0-9a-f]+)|commit-prefix:(?<prefix>[0-9a-f]+))$`,
);

/**
 * `reference_key`를 대상으로 되돌린다.
 *
 * JOB-REL-005가 미해결 간선을 찾은 뒤 **그 키가 무엇을 요구하는지** 알아야 한다 —
 * 특히 `commit-prefix`는 대상이 나타났다고 바로 해결하면 안 되고 **그 접두가 여전히
 * 유일한지** 다시 봐야 한다. 새 커밋이 생기면서 방금 모호해졌을 수 있다.
 *
 * 형식에 맞지 않으면 `null`이다 — 손으로 넣은 값이나 옛 형식을 조용히 해석하지 않는다.
 */
export function parseReferenceKey(key: string): ReferenceTarget | null {
  const parts = KEY_SHAPE.exec(key);
  if (parts === null) return null;
  const groups = parts.groups ?? {};
  const repo =
    groups['owner'] === undefined || groups['name'] === undefined
      ? null
      : { owner: groups['owner'], name: groups['name'] };

  if (groups['pr'] !== undefined) return { kind: 'pull_request', repo, number: Number(groups['pr']) };
  if (groups['sha'] !== undefined) return { kind: 'commit', repo, sha: groups['sha'] };
  if (groups['prefix'] !== undefined) return { kind: 'commit_prefix', repo, prefix: groups['prefix'] };
  return null;
}

/**
 * 커밋 하나를 가리킬 수 있는 모든 `reference_key` 후보 (JOB-REL-005 역방향 조회).
 *
 * 전체 SHA 하나와 길이 7~12의 접두 여섯, 합쳐 **일곱**이다. 상한이 있어
 * `terms` 질의 하나로 끝난다 — 미해결 간선 전량을 스캔하지 않는다.
 */
export function commitReferenceKeys(sha: string, repo: RepoSlug | null): readonly string[] {
  const full = sha.toLowerCase();
  const keys = [referenceKey({ kind: 'commit', repo, sha: full })];
  for (let length = ABBREV_SHA_MIN; length <= ABBREV_SHA_MAX; length += 1) {
    keys.push(referenceKey({ kind: 'commit_prefix', repo, prefix: full.slice(0, length) }));
  }
  return keys;
}

/** PR 하나를 가리킬 수 있는 `reference_key` 후보. 같은 저장소 형태 하나뿐이다. */
export function pullRequestReferenceKeys(prNumber: number, repo: RepoSlug | null): readonly string[] {
  return [referenceKey({ kind: 'pull_request', repo, number: prNumber })];
}

/* ------------------------------------------------------------------------- */
/* 제외 구간 마스킹                                                            */
/* ------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------- */
/* 추출                                                                        */
/* ------------------------------------------------------------------------- */

/** 트레일러 줄. 여기서 나온 참조는 `derived`다 (AC-2). */
const TRAILER_LINE = /^[ \t]*(?:refs|closes|fixes|resolves)[ \t]*:/i;

const SEGMENT = '[A-Za-z0-9][A-Za-z0-9._-]*';

/**
 * 한 번의 좌→우 주사로 모든 패턴을 잡는다.
 *
 * **교차 배열 순서가 곧 우선순위다.** URL이 먼저여야 URL 안의 `owner/repo`와
 * SHA를 따로 잡지 않고, 40자가 축약보다 먼저여야 전체 SHA가 12자로 잘리지 않는다.
 * `\b`가 13~39자 hex를 자동으로 걸러 낸다 — 어느 길이로 끊어도 경계가 아니다.
 */
const SCAN = new RegExp(
  [
    `(?<url>https?:\\/\\/[^\\s<>()\\[\\]"']+)`,
    `(?<xowner>${SEGMENT})\\/(?<xname>${SEGMENT})#(?<xnum>\\d+)`,
    `#(?<num>\\d+)`,
    `\\b(?<full>[0-9a-fA-F]{${String(FULL_SHA_LENGTH)}})\\b`,
    `\\b(?<abbrev>[0-9a-fA-F]{${String(ABBREV_SHA_MIN)},${String(ABBREV_SHA_MAX)}})\\b`,
  ].join('|'),
  'g',
);

const URL_TARGET = new RegExp(`^\\/(${SEGMENT})\\/(${SEGMENT})\\/(pull|commit)\\/([^/?#]+)\\/?$`);

/**
 * 본문에서 참조를 뽑는다.
 *
 * 중복은 `reference_key` 기준으로 제거하고 신뢰도는 `derived`가 이긴다 —
 * 같은 참조가 본문과 트레일러에 모두 있으면 간선은 하나다. 상한은 **중복 제거된
 * 고유 참조**에 적용하며, 등장 순서를 보존하므로 다시 돌려도 같은 집합이 나온다.
 */
export function extractReferences(
  text: string | null | undefined,
  options: ExtractOptions,
): readonly ExtractedReference[] {
  if (text === null || text === undefined || text === '') return [];

  const limit = options.limit ?? REFERENCE_LIMIT;
  const source = normalizeSlug(options.sourceRepo);
  const host = normalizeHost(options.gheHost);
  const masked = maskExcluded(text);
  const lines = lineIndex(masked);

  const order: string[] = [];
  const found = new Map<string, ExtractedReference>();

  SCAN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SCAN.exec(masked)) !== null) {
    // 길이 0 매치는 없지만, 방어적으로 무한 루프를 막는다.
    if (match[0] === '') {
      SCAN.lastIndex += 1;
      continue;
    }
    const target = toTarget(match.groups ?? {}, source, host);
    if (target === null) continue;

    const key = referenceKey(target);
    const confidence: ReferenceConfidence = inTrailer(lines, match.index) ? 'derived' : 'heuristic';
    const evidence = evidenceAt(text, lines, match.index);

    const existing = found.get(key);
    if (existing === undefined) {
      if (order.length >= limit) continue;
      order.push(key);
      found.set(key, { reference_key: key, target, confidence, evidence });
      continue;
    }
    // 이미 있는 참조는 **더 강한 근거로만** 바뀐다. 자리는 첫 등장 그대로다.
    if (existing.confidence === 'heuristic' && confidence === 'derived') {
      found.set(key, { ...existing, confidence, evidence });
    }
  }

  return order.map((key) => found.get(key)!);
}

function toTarget(
  groups: Readonly<Record<string, string | undefined>>,
  source: RepoSlug,
  host: string | null,
): ReferenceTarget | null {
  if (groups['url'] !== undefined) return fromUrl(groups['url'], source, host);

  if (groups['xnum'] !== undefined) {
    const repo = scopeOf({ owner: groups['xowner']!, name: groups['xname']! }, source);
    return { kind: 'pull_request', repo, number: Number(groups['xnum']) };
  }
  if (groups['num'] !== undefined) {
    return { kind: 'pull_request', repo: null, number: Number(groups['num']) };
  }
  if (groups['full'] !== undefined) {
    return { kind: 'commit', repo: null, sha: groups['full'].toLowerCase() };
  }
  if (groups['abbrev'] !== undefined) {
    return { kind: 'commit_prefix', repo: null, prefix: groups['abbrev'].toLowerCase() };
  }
  return null;
}

/**
 * 문장 부호로 끝나는 URL을 다듬는다.
 *
 * `See https://ghe/acme/b/pull/77.` 처럼 산문 끝에 붙은 마침표·쉼표·괄호가
 * 경로의 일부로 딸려 오면 `URL_TARGET`이 거부해 **참조가 통째로 사라진다**.
 * URL에 실제로 쓰일 수 있는 문자이므로 정규식에서 뺄 수는 없고, 여기서 뒤에서부터
 * 벗긴다. 벗긴 뒤에도 해석되지 않으면 그때가 참조가 아닌 것이다.
 */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"»]+$/;

/**
 * URL 참조.
 *
 * **승인된 GHE 호스트만 인정한다** (THR-036). 호스트가 구성되지 않았거나 다르면
 * 참조가 아니다 — GitHub.com URL을 내부 대상으로 해석하지 않는다.
 */
function fromUrl(raw: string, source: RepoSlug, host: string | null): ReferenceTarget | null {
  if (host === null) return null;
  let url: URL;
  try {
    url = new URL(raw.replace(TRAILING_PUNCTUATION, ''));
  } catch {
    return null;
  }
  if (url.host.toLowerCase() !== host) return null;

  const parts = URL_TARGET.exec(url.pathname);
  if (parts === null) return null;

  const repo = scopeOf({ owner: parts[1]!, name: parts[2]! }, source);
  if (parts[3] === 'pull') {
    if (!/^\d+$/.test(parts[4]!)) return null;
    return { kind: 'pull_request', repo, number: Number(parts[4]) };
  }
  const sha = parts[4]!.toLowerCase();
  if (new RegExp(`^[0-9a-f]{${String(FULL_SHA_LENGTH)}}$`).test(sha)) {
    return { kind: 'commit', repo, sha };
  }
  if (new RegExp(`^[0-9a-f]{${String(ABBREV_SHA_MIN)},${String(ABBREV_SHA_MAX)}}$`).test(sha)) {
    return { kind: 'commit_prefix', repo, prefix: sha };
  }
  return null;
}

/** source 저장소를 가리키는 명시 slug는 **생략형으로 접는다.** 그래야 `#N`과 겹친다. */
function scopeOf(slug: RepoSlug, source: RepoSlug): RepoSlug | null {
  const normalized = normalizeSlug(slug);
  return normalized.owner === source.owner && normalized.name === source.name ? null : normalized;
}

function normalizeSlug(slug: RepoSlug): RepoSlug {
  return { owner: slug.owner.toLowerCase(), name: slug.name.toLowerCase() };
}

function normalizeHost(host: string | null | undefined): string | null {
  if (host === null || host === undefined || host === '') return null;
  try {
    return new URL(host.includes('://') ? host : `https://${host}`).host.toLowerCase();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------- */
/* 줄 위치 계산                                                                */
/* ------------------------------------------------------------------------- */

interface LineSpan {
  readonly start: number;
  readonly end: number;
  /** 트레일러 줄이면 콜론 **뒤** 오프셋. 아니면 `null`. */
  readonly trailerFrom: number | null;
}

function lineIndex(text: string): readonly LineSpan[] {
  const spans: LineSpan[] = [];
  let start = 0;
  for (const line of text.split('\n')) {
    const trailer = TRAILER_LINE.exec(line);
    spans.push({
      start,
      end: start + line.length,
      trailerFrom: trailer === null ? null : start + trailer[0].length,
    });
    start += line.length + 1;
  }
  return spans;
}

function lineAt(lines: readonly LineSpan[], offset: number): LineSpan | undefined {
  let low = 0;
  let high = lines.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const span = lines[mid]!;
    if (offset < span.start) high = mid - 1;
    else if (offset > span.end) low = mid + 1;
    else return span;
  }
  return undefined;
}

/** 트레일러의 **콜론 뒤**에서 나온 참조만 `derived`다. 키워드 자체는 근거가 아니다. */
function inTrailer(lines: readonly LineSpan[], offset: number): boolean {
  const span = lineAt(lines, offset);
  return span?.trailerFrom !== null && span !== undefined && offset >= span.trailerFrom;
}

/** 근거는 참조가 나온 줄이다. 길면 자른다 — 본문을 복제하지 않는다. */
function evidenceAt(original: string, lines: readonly LineSpan[], offset: number): string {
  const span = lineAt(lines, offset);
  if (span === undefined) return '';
  const line = original.slice(span.start, span.end).trim();
  return line.length <= EVIDENCE_LIMIT ? line : `${line.slice(0, EVIDENCE_LIMIT - 1)}…`;
}
