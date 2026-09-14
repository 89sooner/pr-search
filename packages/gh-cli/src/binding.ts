/**
 * typed port 호환 판정과 제한된 바인딩 평가 (SRS 9.8 4항·5항, FR-GH-005 AC-8, ADR-020, CR-089).
 *
 * **둘 다 순수 함수다.** DB 쓰기·토큰·파일·네트워크·spawn이 없다. 결과는 판정일 뿐이며 실행 승인이 아니다 —
 * `evaluateBinding`이 성공해도 `executable: false`와 그 이유를 함께 돌려준다. 실행 허용은 `EXECUTABLE_CAPABILITIES`만
 * 정하고, 다단계 실행(Recipe)은 이 판에서 열리지 않았다.
 *
 * ## 자동으로 잇지 않는 것
 *
 * | 연결 | 판정 |
 * | --- | --- |
 * | 타입이 다르다 (`IssueRef` → `PullRequestRef`, 같은 번호라도) | `type_mismatch` — 불가 |
 * | 비밀 결과 → 어떤 입력이든 | `secret_source` — 불가 |
 * | 결과 계약이 바인딩 불가(opaque·terminal·artifact·정책 차단) | `source_not_bindable` — 불가 |
 * | 목록 → 목록 | `list_to_list` — 불가. 상한 있는 fan-out 규칙(FR-GH-005 AC-9)이 먼저다 |
 * | 목록 → 단일 | 조건부 — 원소 하나를 `/<index>`로 **명시적으로** 골라야 한다. 첫 원소 자동 선택 없음 |
 * | 다른 호스트·저장소의 참조 | 평가에서 거절 (`host_mismatch`·`repository_mismatch`) |
 * | 식별 필드가 빠진 결과 | 평가에서 거절 (`value_unavailable`) |
 */

import type { RepositorySlug } from './constraints.js';
import { evaluateJsonPointer } from './json-pointer.js';
import { REPOSITORY_SCOPED_KINDS, refTypeName, slugOf, validateResourceRef } from './resource-ref.js';
import type { GhPort, GhPortCondition, GhPortSlot, GhResourceRef, GhResultContract } from './types.js';

export type GhCompatibilityVerdict = 'direct' | 'conditional' | 'incompatible';

export type GhIncompatibilityCode = 'direction' | 'type_mismatch' | 'secret_source' | 'secret_target' | 'source_not_bindable' | 'list_to_list';

export interface GhIncompatibility {
  readonly code: GhIncompatibilityCode;
  readonly detail: string;
}

export interface GhPortCompatibility {
  readonly verdict: GhCompatibilityVerdict;
  /** 호환하려면 만족해야 하는 조건 전부 — 출력 쪽·입력 쪽·연결 자체의 조건. */
  readonly conditions: readonly GhPortCondition[];
  readonly reasons: readonly GhIncompatibility[];
}

export interface GhPortEndpoint {
  readonly capabilityId: string;
  readonly contract: GhResultContract;
  readonly port: GhPort;
}

function pushUnique(target: GhPortCondition[], condition: GhPortCondition): void {
  if (!target.some((one) => one.code === condition.code && one.detail === condition.detail)) target.push(condition);
}

/**
 * 출력 port → 입력 port가 타입상 이어지는가. 이름은 보지 않는다 — 같은 이름의 port라도 타입이 다르면 불가다.
 */
export function judgePortCompatibility(source: GhPortEndpoint, target: GhPortEndpoint): GhPortCompatibility {
  const reasons: GhIncompatibility[] = [];
  if (source.port.direction !== 'output' || target.port.direction !== 'input') {
    reasons.push({ code: 'direction', detail: '출력 port에서 입력 port로만 잇는다' });
  }
  if (source.port.type !== target.port.type) {
    reasons.push({ code: 'type_mismatch', detail: `${refTypeName(source.port.type)} → ${refTypeName(target.port.type)}` });
  }
  // `sensitive`(비밀이 아닌 민감)는 여기서 막지 않는다 — 참조는 식별자만 담고 값을 담지 않으며, 이 판의 sensitive 결과 7개에는
  // 출력 port가 없다. sensitive 결과에 port를 붙이는 판은 이 자리의 판정을 다시 정해야 한다 (독립 검토 A).
  if (source.contract.sensitivity === 'secret' || source.port.sensitivity === 'secret') {
    reasons.push({ code: 'secret_source', detail: '비밀 결과는 어떤 입력으로도 흐르지 않는다 (SRS 9.8 2항)' });
  }
  if (target.port.sensitivity === 'secret') {
    reasons.push({ code: 'secret_target', detail: '비밀 값을 받는 입력 자리는 참조로 채우지 않는다' });
  }
  if (!source.contract.bindable) {
    reasons.push({ code: 'source_not_bindable', detail: `출력 쪽 결과 계약이 ${source.contract.composability}다` });
  }
  if (source.port.cardinality === 'many' && target.port.cardinality === 'many') {
    reasons.push({ code: 'list_to_list', detail: '목록 전체를 한 번에 넘기는 연결은 정의하지 않는다 — 상한 있는 fan-out(FR-GH-005 AC-9)이 먼저다' });
  }

  const conditions: GhPortCondition[] = [];
  for (const condition of source.port.conditions) pushUnique(conditions, condition);
  for (const condition of target.port.conditions) pushUnique(conditions, condition);
  if (source.port.cardinality === 'many' && target.port.cardinality === 'one') {
    pushUnique(conditions, { code: 'explicit_selection', detail: '목록에서 원소 하나를 `/<index>`로 명시적으로 고른다 — 첫 원소를 자동으로 고르지 않는다' });
  }
  if (source.port.cardinality === 'one' && target.port.cardinality === 'many') {
    pushUnique(conditions, { code: 'single_value_as_list', detail: '참조 하나를 한 개짜리 목록으로 넘긴다' });
  }
  // 입력 port가 이미 같은 저장소 조건을 말했으면 되풀이하지 않는다 — 조건은 코드마다 하나다.
  if (REPOSITORY_SCOPED_KINDS.has(target.port.type) && !conditions.some((condition) => condition.code === 'same_repository')) {
    conditions.push({ code: 'same_repository', detail: '참조의 저장소가 입력 쪽 실행의 저장소와 같아야 한다' });
  }

  const verdict: GhCompatibilityVerdict = reasons.length > 0 ? 'incompatible' : conditions.length === 0 ? 'direct' : 'conditional';
  return { verdict, conditions, reasons };
}

/** 구조화된 연결 (ENT-GH-011). 표현식이 아니다 — 출발·도착과 명시적 선택뿐이다. */
export interface GhBinding {
  readonly source: { readonly capabilityId: string; readonly port: string };
  readonly target: { readonly capabilityId: string; readonly port: string };
  /** 출력 port 값에서 고르는 제한된 JSON Pointer. 목록 → 단일이면 `/<index>`가 필수다. */
  readonly select: string;
}

/** 결과 adapter가 만든 출력 port의 값. 원시 stdout이 아니다. */
export type GhPortValue =
  | { readonly status: 'available'; readonly port: string; readonly cardinality: 'many'; readonly items: readonly GhResourceRef[] }
  | { readonly status: 'available'; readonly port: string; readonly cardinality: 'one'; readonly item: GhResourceRef | null }
  | { readonly status: 'unavailable'; readonly port: string; readonly reason: string };

/** 입력 쪽 실행의 검증된 컨텍스트. */
export interface GhBindingTargetContext {
  readonly host: string;
  readonly repository: RepositorySlug | null;
}

export type GhBindingRejection =
  | 'endpoint_mismatch'
  | 'incompatible'
  | 'value_unavailable'
  | 'explicit_selection_required'
  | 'selection_invalid'
  | 'selection_not_a_reference'
  | 'null_value'
  | 'host_mismatch'
  | 'repository_missing'
  | 'repository_mismatch'
  | 'unsupported_slot';

export type GhBindingOutcome =
  | {
      readonly ok: true;
      readonly ref: GhResourceRef;
      /** 입력 자리에 들어갈 값. 실행하지 않으므로 argv에 붙지 않는다 — 판정의 재료다. */
      readonly argument: { readonly slot: GhPortSlot; readonly value: string };
      readonly conditions: readonly GhPortCondition[];
      readonly executable: false;
      readonly executionBlockedReason: string;
    }
  | { readonly ok: false; readonly reason: GhBindingRejection; readonly detail: string };

export const BINDING_EXECUTION_BLOCKED = '다단계 실행(Recipe)은 열리지 않았다 (FR-GH-005) — 호환 판정은 실행 승인이 아니다';

function argumentOf(ref: GhResourceRef, slot: GhPortSlot): string | null {
  switch (ref.kind) {
    case 'pull_request':
    case 'issue':
    case 'discussion':
      return ref.number === null ? null : String(ref.number);
    case 'workflow_run':
    case 'workflow':
    case 'codespace':
      return ref.id;
    case 'release':
    case 'branch':
    case 'commit':
      return ref.ref;
    case 'repository':
      return slot.kind === 'positional' ? ref.repository : null;
    default:
      return null;
  }
}

/**
 * 출력 port 값에서 명시적으로 고른 참조가 입력 port와 입력 쪽 컨텍스트에 맞는가.
 *
 * 순서: 출발·도착 대조(값의 개수 포함) → 타입 호환 → 값이 있는가 → 명시적 선택 → 포인터 평가 → 참조 규칙 → 호스트·저장소.
 * 어느 단계에서든 실패하면 그 자리에서 멈춘다 — 기본값·첫 원소·URL 재해석으로 보정하지 않는다.
 */
export function evaluateBinding(input: {
  readonly binding: GhBinding;
  readonly source: GhPortEndpoint;
  readonly target: GhPortEndpoint;
  readonly value: GhPortValue;
  readonly targetContext: GhBindingTargetContext;
}): GhBindingOutcome {
  const { binding, source, target, value, targetContext } = input;
  if (
    binding.source.capabilityId !== source.capabilityId ||
    binding.source.port !== source.port.id ||
    binding.target.capabilityId !== target.capabilityId ||
    binding.target.port !== target.port.id ||
    value.port !== source.port.id
  ) {
    return { ok: false, reason: 'endpoint_mismatch', detail: '연결이 가리키는 출발·도착 port와 넘겨준 port·값이 다르다' };
  }
  // 값의 개수는 출력 port 계약을 따라야 한다 — 단일 port의 값을 목록으로 넘기면 판정에 없던 선택이 끼어든다.
  if (value.status === 'available' && value.cardinality !== source.port.cardinality) {
    return { ok: false, reason: 'endpoint_mismatch', detail: `값의 개수(${value.cardinality})가 출력 port 계약(${source.port.cardinality})과 다르다` };
  }

  const compatibility = judgePortCompatibility(source, target);
  if (compatibility.verdict === 'incompatible') {
    return { ok: false, reason: 'incompatible', detail: compatibility.reasons.map((one) => `${one.code}: ${one.detail}`).join(' · ') };
  }
  if (value.status === 'unavailable') return { ok: false, reason: 'value_unavailable', detail: value.reason };

  let document: unknown;
  if (value.cardinality === 'many') {
    if (target.port.cardinality === 'one' && binding.select === '') {
      return { ok: false, reason: 'explicit_selection_required', detail: '목록 결과를 단일 입력에 이으려면 원소 하나를 `/<index>`로 골라야 한다' };
    }
    document = value.items;
  } else {
    if (value.item === null) return { ok: false, reason: 'null_value', detail: '출력 port의 값이 null이다' };
    document = value.item;
  }

  const selected = evaluateJsonPointer(document, binding.select);
  if (!selected.ok) return { ok: false, reason: 'selection_invalid', detail: `${selected.error}${selected.token === null ? '' : ` (${selected.token})`}` };
  const validated = validateResourceRef(selected.value, target.port.type);
  if (!validated.ok) return { ok: false, reason: 'selection_not_a_reference', detail: `고른 값이 ${refTypeName(target.port.type)}가 아니다 (${validated.problem})` };
  const ref = validated.ref;

  if (ref.host.toLowerCase() !== targetContext.host.toLowerCase()) {
    return { ok: false, reason: 'host_mismatch', detail: `참조의 호스트(${ref.host})가 입력 쪽 실행의 호스트와 다르다` };
  }
  if (REPOSITORY_SCOPED_KINDS.has(ref.kind)) {
    if (targetContext.repository === null) return { ok: false, reason: 'repository_missing', detail: '입력 쪽 실행에 저장소 컨텍스트가 없다' };
    if (ref.repository?.toLowerCase() !== slugOf(targetContext.repository).toLowerCase()) {
      return { ok: false, reason: 'repository_mismatch', detail: `참조의 저장소(${String(ref.repository)})가 입력 쪽 실행의 저장소와 다르다` };
    }
  }
  const slot = target.port.slot;
  const argument = slot === null ? null : argumentOf(ref, slot);
  if (slot === null || argument === null) return { ok: false, reason: 'unsupported_slot', detail: '입력 port에 참조를 넣을 자리가 없다' };

  return { ok: true, ref, argument: { slot, value: argument }, conditions: compatibility.conditions, executable: false, executionBlockedReason: BINDING_EXECUTION_BLOCKED };
}
