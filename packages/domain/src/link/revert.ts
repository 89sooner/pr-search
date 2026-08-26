/**
 * 되돌림 표현 추출 (WP-030 / CR-041, FR-REL-004).
 *
 * 순수 함수다 — 조회도, 판정도 하지 않는다. **무엇이 적혀 있는지**만 말하고
 * 그것이 무엇을 가리키는지는 호출 측이 정본에서 찾는다.
 *
 * ## 두 갈래는 확실성이 다르다
 *
 * `This reverts commit <sha>`는 git이 생성한 문장이고 대상을 **SHA로 직접 지목**
 * 한다 — 신뢰도 `exact`다 (AC-2). `Revert "<제목>"`은 제목 문자열일 뿐이라 같은
 * 제목을 가진 엔티티가 여럿일 수 있다 — `heuristic`이고, 후보가 2건 이상이면
 * **전부 저장한다** (예외 처리, DEV-237).
 *
 * ## 40자 SHA만 `exact`로 인정한다
 *
 * git의 `revert`는 언제나 40자를 적는다. 축약형을 여기서 받아 주면 접두 해석
 * 기계(유일성 판정·나중에 모호해지면 되돌리기)를 이 축에 한 벌 더 만들어야 하고,
 * 그것은 `references`가 `reference_key`로 이미 소유한 문제다 (DEV-217).
 * **손으로 적은 축약형은 정보가 사라지지 않는다** — 7~12자 hex는 WP-029의 참조
 * 패턴이 이미 잡아 `references` 간선으로 만든다. 되돌림으로 승격되지 않을 뿐이다.
 */

import { commitSubject, evidenceLine, maskExcluded } from './text.js';

/** 되돌림 대상. 커밋은 지목이고 제목은 대조 요청이다. */
export type RevertTarget =
  | { readonly kind: 'commit'; readonly sha: string }
  | { readonly kind: 'title'; readonly title: string };

export type RevertConfidence = 'exact' | 'heuristic';

export interface ExtractedRevert {
  readonly target: RevertTarget;
  readonly confidence: RevertConfidence;
  readonly evidence: string;
}

export interface RevertExtractOptions {
  /**
   * PR 제목인가. AC-1의 세 번째 패턴(**PR 제목 접두 `Revert`**)은 제목에만 적용한다.
   *
   * 커밋 메시지 본문의 "Revert ..."는 서술문일 수 있어 제목만큼 신뢰할 수 없다.
   */
  readonly isPullRequestTitle?: boolean;
}

/** `This reverts commit <40 hex>` — git이 생성하는 문장이다. */
const REVERT_TRAILER = /this\s+reverts\s+commit\s+([0-9a-f]{40})\b/gi;

/** `Revert "<제목>"` — git이 생성하는 제목 줄. 따옴표는 곧은 것과 굽은 것 모두. */
const REVERT_QUOTED = /\brevert\s*:?\s*["\u201c]([^"\u201d\n]{1,512})["\u201d]/gi;

/** PR 제목 접두 `Revert`. 따옴표 없는 형태까지 받는다. */
const REVERT_PREFIX = /^\s*revert\s*:?\s+(.+)$/i;

const TITLE_MAX = 512;

/**
 * 본문에서 되돌림 표현을 뽑는다.
 *
 * 중복은 대상 기준으로 제거하고 **신뢰도가 높은 쪽이 이긴다** — 같은 커밋을
 * 트레일러와 제목이 함께 가리키면 간선은 하나이고 `exact`다.
 */
export function extractReverts(
  text: string,
  options: RevertExtractOptions = {},
): readonly ExtractedRevert[] {
  if (text === '') return [];
  const masked = maskExcluded(text);
  const found = new Map<string, ExtractedRevert>();

  const add = (target: RevertTarget, confidence: RevertConfidence, offset: number): void => {
    const key = target.kind === 'commit' ? `c:${target.sha}` : `t:${target.title.toLowerCase()}`;
    const existing = found.get(key);
    // `exact`가 `heuristic`을 이긴다. 같은 신뢰도면 먼저 나온 것을 쓴다 (결정론).
    if (existing !== undefined && !(existing.confidence === 'heuristic' && confidence === 'exact')) return;
    found.set(key, { target, confidence, evidence: evidenceLine(text, offset) });
  };

  REVERT_TRAILER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REVERT_TRAILER.exec(masked)) !== null) {
    add({ kind: 'commit', sha: match[1]!.toLowerCase() }, 'exact', match.index);
  }

  REVERT_QUOTED.lastIndex = 0;
  while ((match = REVERT_QUOTED.exec(masked)) !== null) {
    const title = normalizeTitle(match[1]!);
    if (title !== null) add({ kind: 'title', title }, 'heuristic', match.index);
  }

  if (options.isPullRequestTitle === true) {
    const prefix = REVERT_PREFIX.exec(masked);
    if (prefix !== null) {
      const title = normalizeTitle(stripQuotes(prefix[1]!));
      if (title !== null) add({ kind: 'title', title }, 'heuristic', 0);
    }
  }

  return [...found.values()];
}

/**
 * 커밋 메시지에서 되돌림 표현을 뽑는다.
 *
 * 제목 줄은 `Revert "<원본 제목>"` 형태를 갖고 본문에 트레일러가 온다. 제목 줄을
 * PR 제목처럼 접두 규칙으로도 보는 이유는 git이 `-m` 없이 편집된 경우가 있어서다.
 */
export function extractCommitReverts(message: string): readonly ExtractedRevert[] {
  const subject = commitSubject(message);
  const body = extractReverts(message);
  if (body.some((entry) => entry.target.kind === 'title')) return body;

  // 제목 줄에서만 접두 형태를 다시 본다. 본문 서술문을 승격시키지 않는다.
  const fromSubject = extractReverts(subject, { isPullRequestTitle: true }).filter(
    (entry) => entry.target.kind === 'title',
  );
  if (fromSubject.length === 0) return body;
  return [...body, ...fromSubject];
}

function stripQuotes(raw: string): string {
  const trimmed = raw.trim();
  const first = trimmed.charAt(0);
  const last = trimmed.charAt(trimmed.length - 1);
  const quoted =
    (first === '"' && last === '"') || (first === '\u201c' && last === '\u201d');
  return quoted ? trimmed.slice(1, -1) : trimmed;
}

/** 제목은 대조 키다. 공백을 접고 길이를 제한한다 — 인덱스 식과 같은 정규화여야 한다. */
function normalizeTitle(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed === '' || collapsed.length > TITLE_MAX) return null;
  return collapsed;
}
