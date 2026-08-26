/**
 * 체리픽 표현 추출 (WP-030 / CR-041, FR-REL-005 AC-1).
 *
 * 트레일러만 다룬다. `patch_id` 기반 `derived` 판정은 텍스트가 아니라 정본의
 * 값 비교이므로 파서의 일이 아니다.
 *
 * **이 경로는 `patch_id` 가용성과 무관하다.** `no_mirror`·`blob_fetch_disabled`·
 * `compute_failed` 어느 상태에서도 트레일러가 있으면 `exact` 간선이 된다 (AC-1) —
 * AC-2가 조건부인 것과 별개다 (CR-024, DEV-111).
 */

import { evidenceLine, maskExcluded } from './text.js';

export interface ExtractedCherryPick {
  /** 원본 커밋 SHA. 소문자 40자다. */
  readonly sha: string;
  readonly evidence: string;
}

/** `(cherry picked from commit <40 hex>)` — git `cherry-pick -x`가 생성한다. */
const CHERRY_TRAILER = /\(\s*cherry\s+picked\s+from\s+commit\s+([0-9a-f]{40})\s*\)/gi;

/**
 * 체리픽 트레일러를 뽑는다.
 *
 * 같은 SHA가 여러 번 나와도 간선은 하나다. 순서는 등장 순서를 보존한다 — 결정론이
 * 필요하고, 상한 판정을 호출 측이 같은 순서로 하게 하려면 여기서 흔들리면 안 된다.
 */
export function extractCherryPicks(message: string): readonly ExtractedCherryPick[] {
  if (message === '') return [];
  const masked = maskExcluded(message);
  const seen = new Map<string, ExtractedCherryPick>();

  CHERRY_TRAILER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CHERRY_TRAILER.exec(masked)) !== null) {
    const sha = match[1]!.toLowerCase();
    if (seen.has(sha)) continue;
    seen.set(sha, { sha, evidence: evidenceLine(message, match.index) });
  }
  return [...seen.values()];
}
