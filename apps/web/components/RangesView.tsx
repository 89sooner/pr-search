'use client';

/**
 * W-004 범위 조사 (WP-025 / FLOW-003, FR-SEQ-002·003).
 *
 * ## 흐름이 상태의 정본을 정한다
 *
 * - **URL이 조사 상태다** — 공간·앵커·에폭이 `/ranges?repo=&branch=&from=&to=&epoch=`에
 *   실리고, 조회가 성공하면 URL을 현재 에폭으로 갱신한다. 그 URL이 곧 인용이다 (ADR-007).
 * - **정규화는 사용자 행위(Enter·blur)로만** 일어난다 — 타이핑마다 부르지 않는다.
 * - **조회 버튼은 사전 판정이 지킨다** (QA-W004-07·08·09): 역전은 교환 제안,
 *   5만 초과는 축소 안내를 조회 전에 낸다. 서버(RANGE_INVERTED·RANGE_TOO_LARGE)가
 *   이중 방어다.
 * - **에폭 불일치는 경고이지 재조회가 아니다** (QA-W004-21) — URL의 에폭이 현재와
 *   다르면 무효 경고와 "현재 에폭으로 재조회" 액션을 내고, 클릭 전에는 아무것도
 *   다시 부르지 않는다.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge, Banner, Button, Panel } from '@conductor-by-89soone/react';
import { AnchorInput, type AnchorFieldState } from './AnchorInput';
import { SequenceSpaceSelector, type SequenceSpaceRef } from './SequenceSpaceSelector';
import { RangeSummaryCard } from './RangeSummaryCard';
import { RangeResultTable } from './RangeResultTable';
import { FacetRail } from './FacetRail';
import { CursorPager, toCursorFailure, type CursorFailure } from './CursorPager';
import { RANGE_FACET_FIELDS, type FacetSource } from '../lib/facets';
import { addEquality, removeEquality } from '../lib/tokens';
import { parseQuery, serializeQuery, type QueryAst } from '@prs/query';
import { ErrorBanner } from './ErrorBanner';
import { SafeMarkerCard } from './SafeMarkerCard';
import { BisectPanel } from './BisectPanel';
import {
  judgeMarkerSubmit,
  markerRequestUrl,
  mayWriteMarker,
  type MarkerResponse,
  type MarkerSubmitOutcome,
  type MarkerView,
} from '../lib/safe-marker';
import {
  formatRangeQuery,
  judgeAnchorFailure,
  judgeEpoch,
  judgeItems,
  judgeResolvedAnchors,
  judgeSpaces,
  judgeSummary,
  parseRangeParams,
  preflightRange,
  type RangeItemView,
  type RangeSummaryView,
  type ResolvedAnchorView,
  type SequenceSpaceOption,
} from '../lib/range';

interface RangeSuccess {
  readonly seqEpoch: number;
  readonly sequenceState: 'ok' | 'stale' | 'reassigning' | 'unknown';
  readonly summary: RangeSummaryView | null;
  readonly items: readonly RangeItemView[];
  readonly missingInIndex: number;
  /** 다음 페이지 커서. 구간 끝까지 검사했으면 `null`이다 (FR-SEQ-002 AC-6). */
  readonly nextCursor: string | null;
  /** 이 응답이 실어 온 패싯. 첫 페이지만 값이 있다. */
  readonly facets: FacetSource;
}

/**
 * 이어 보기 상태 (WP-032 / FR-SEQ-002 AC-6).
 *
 * W-001과 **같은 규칙**이다: 커서는 URL에 싣지 않고, 조건(`q`·경계·공간)이
 * 바뀌면 커서·쌓인 항목·패싯을 함께 버린다. 순회하는 정본은 다르지만
 * (여기는 PostgreSQL `merge_sequence`) 화면이 지켜야 할 규율은 같다.
 */
interface RangePageState {
  readonly carried: readonly RangeItemView[];
  readonly cursor: string | null;
  readonly facets: FacetSource;
  readonly failure: CursorFailure | null;
}

const RANGE_FIRST_PAGE: RangePageState = { carried: [], cursor: null, facets: {}, failure: null };

type QueryOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly result: RangeSuccess }
  | { readonly kind: 'epoch_stale'; readonly currentEpoch: number; readonly requestedEpoch: number }
  | { readonly kind: 'server_error'; readonly code: string; readonly message: string; readonly correlationId: string | null; readonly status: number }
  | { readonly kind: 'offline' };

export interface RangesViewProps {
  readonly loginPath: string;
  /**
   * 세션의 역할. 관문(`GuardedPage`)이 넘긴다 (WP-041).
   *
   * 이 화면이 역할을 받는 이유는 **표식 등록이 자격에 따라 막히는 것을
   * 사용자에게 미리 말해 주기 위해서**다 (`FR-SEQ-006` AC-3). 조회는 역할과
   * 무관하며, 쓰기 판정은 서버가 독립적으로 한다.
   */
  readonly roles?: readonly string[];
  /** 이 배포에 인증이 구성되어 있는가. `false`면 빈 역할을 "자격 없음"으로 읽지 않는다. */
  readonly authEnabled?: boolean;
}

export function RangesView({ loginPath, roles = [], authEnabled = true }: RangesViewProps): ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = useRef(parseRangeParams(new URLSearchParams(searchParams.toString())));

  const [spaces, setSpaces] = useState<readonly SequenceSpaceOption[] | null>(null);
  const [spacesFailed, setSpacesFailed] = useState(false);
  const [space, setSpace] = useState<SequenceSpaceRef | null>(
    initial.current.repo !== null && initial.current.branch !== null
      ? { repository: initial.current.repo, baseBranch: initial.current.branch }
      : null,
  );
  const [fromText, setFromText] = useState(initial.current.from ?? '');
  const [toText, setToText] = useState(initial.current.to ?? '');
  const [fromState, setFromState] = useState<AnchorFieldState>({ kind: 'idle' });
  const [toState, setToState] = useState<AnchorFieldState>({ kind: 'idle' });
  const [resolveEpoch, setResolveEpoch] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<QueryOutcome>({ kind: 'idle' });
  /** 구간을 좁히는 질의. 패싯 클릭이 이것을 갱신한다 (WP-032). */
  const [rangeQuery, setRangeQuery] = useState(initial.current.q ?? '');
  const [pageState, setPageState] = useState<RangePageState>(RANGE_FIRST_PAGE);
  const generation = useRef(0);

  // 공간 목록은 이 화면의 자기 데이터다 (API-SEQ-006) — 진입 시 한 번 부른다.
  useEffect(() => {
    let alive = true;
    void (async (): Promise<void> => {
      try {
        const response = await fetch('/api/sequence-spaces', { cache: 'no-store' });
        if (!alive) return;
        if (!response.ok) {
          setSpacesFailed(true);
          return;
        }
        setSpaces(judgeSpaces(await response.json()));
      } catch {
        if (alive) setSpacesFailed(true);
      }
    })();
    return (): void => {
      alive = false;
    };
  }, []);

  const resolveAnchor = useCallback(
    async (position: 'from' | 'to', expression: string): Promise<void> => {
      if (space === null || expression.trim() === '') return;
      const set = position === 'from' ? setFromState : setToState;
      set({ kind: 'resolving' });
      try {
        const response = await fetch('/api/sequence-anchors/resolve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            repository: space.repository,
            base_branch: space.baseBranch,
            anchors: [{ position, expression: expression.trim() }],
          }),
          cache: 'no-store',
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          const failure = judgeAnchorFailure(body);
          const message =
            (body as { error?: { message?: string } }).error?.message ?? '앵커를 해석하지 못했습니다.';
          set({ kind: 'failed', failure, message });
          return;
        }
        const resolved = judgeResolvedAnchors(body).find((anchor) => anchor.position === position);
        const epoch = (body as { seq_epoch?: number }).seq_epoch;
        if (typeof epoch === 'number') setResolveEpoch(epoch);
        if (resolved === undefined) {
          set({ kind: 'failed', failure: null, message: '응답에 해석 결과가 없습니다.' });
          return;
        }
        set({ kind: 'resolved', anchor: resolved });
      } catch {
        set({ kind: 'failed', failure: null, message: '네트워크 오류로 해석하지 못했습니다.' });
      }
    },
    [space],
  );

  const fromAnchor: ResolvedAnchorView | null = fromState.kind === 'resolved' ? fromState.anchor : null;
  const toAnchor: ResolvedAnchorView | null = toState.kind === 'resolved' ? toState.anchor : null;
  const preflight = preflightRange(fromAnchor, toAnchor);

  const runQuery = useCallback(
    async (options: {
      readonly pinEpoch: number | null;
      /** 이어 보기 커서. 없으면 첫 페이지이고 그때만 패싯을 요청한다. */
      readonly cursor?: string | null;
      /** 이어 보기가 쌓아 온 앞 페이지들. 첫 페이지면 비어 있다. */
      readonly carried?: readonly RangeItemView[];
      readonly carriedFacets?: FacetSource;
      readonly q?: string;
    }): Promise<void> => {
      if (space === null || fromAnchor === null || toAnchor === null) return;
      const mine = (generation.current += 1);
      const cursor = options.cursor ?? null;
      const carried = options.carried ?? [];
      const effectiveQuery = (options.q ?? rangeQuery).trim();
      setOutcome({ kind: 'loading' });
      const query = new URLSearchParams({
        repository: space.repository,
        base_branch: space.baseBranch,
        from_seq: String(fromAnchor.mergeSeq),
        to_seq: String(toAnchor.mergeSeq),
      });
      if (options.pinEpoch !== null) query.set('seq_epoch', String(options.pinEpoch));
      if (effectiveQuery !== '') query.set('q', effectiveQuery);
      if (cursor !== null) query.set('cursor', cursor);
      /*
       * **첫 페이지만 분포를 센다** (QA-W001-27과 같은 규칙).
       *
       * 패싯의 계산 대상은 페이지가 아니라 **구간 전체**이므로(AC-8) 이어 보기가
       * 다시 세도 같은 값이 나온다 — 예산만 쓴다.
       */
      if (cursor === null) query.set('facets', 'true');
      try {
        const response = await fetch(`/api/sequence-ranges?${query.toString()}`, { cache: 'no-store' });
        const body: unknown = await response.json();
        if (generation.current !== mine) return;
        const record = body as Record<string, unknown>;

        if (response.ok && record['epoch_stale'] === true) {
          // 서버가 "인용 에폭이 낡았다"고 답했다 — 결과 없이 경고만 낸다 (QA-W004-21).
          setOutcome({
            kind: 'epoch_stale',
            currentEpoch: typeof record['seq_epoch'] === 'number' ? record['seq_epoch'] : 0,
            requestedEpoch:
              typeof record['requested_seq_epoch'] === 'number' ? record['requested_seq_epoch'] : 0,
          });
          return;
        }
        if (!response.ok) {
          const error = (record['error'] ?? {}) as { code?: string; message?: string };
          const failure = toCursorFailure(error.code);
          if (failure !== null) {
            /*
             * 커서 실패는 화면 오류가 아니다 — 구간 조건은 멀쩡하다.
             *
             * 특히 여기서는 **에폭이 바뀐 경우**가 이 갈래로 온다 (ADR-007).
             * 자동으로 첫 페이지를 다시 부르지 않는다: 재채번이 일어났다는
             * 사실 자체를 사용자가 알아야 한다.
             *
             * **직전 결과를 지우지 않는다.** 지우면 사용자는 자기 위치를 잃고,
             * 무엇을 보고 있었는지 모른 채 경고만 남는다 (W-001과 같은 규율).
             */
            setPageState((current) => ({ ...current, failure }));
            return;
          }
          setOutcome({
            kind: 'server_error',
            code: error.code ?? 'UNKNOWN',
            message: error.message ?? '조회에 실패했습니다.',
            correlationId: typeof record['correlation_id'] === 'string' ? record['correlation_id'] : null,
            status: response.status,
          });
          return;
        }

        const seqEpoch = typeof record['seq_epoch'] === 'number' ? record['seq_epoch'] : 0;
        const stateRaw = record['sequence_state'];
        /** 첫 페이지가 센 분포를 이어 보기가 물려받는다. */
        const facets: FacetSource = cursor === null ? (record as FacetSource) : (options.carriedFacets ?? {});
        setOutcome({
          kind: 'ready',
          result: {
            seqEpoch,
            sequenceState:
              stateRaw === 'ok' || stateRaw === 'stale' || stateRaw === 'reassigning' ? stateRaw : 'unknown',
            summary: judgeSummary(body),
            // **쌓아서 보여 준다** — 번호가 없어 앞 페이지로 돌아갈 길이 없다.
            items: [...carried, ...judgeItems(body)],
            missingInIndex:
              typeof record['items_missing_in_index'] === 'number' ? record['items_missing_in_index'] : 0,
            nextCursor: typeof record['next_cursor'] === 'string' ? record['next_cursor'] : null,
            facets,
          },
        });
        setPageState({ carried, cursor, facets, failure: null });
        /*
         * 성공한 조회의 URL이 곧 인용이다 — 현재 에폭을 URL에 남긴다. 다음에
         * 이 링크로 들어온 사람은 에폭 비교(QA-W004-21)의 보호를 받는다.
         */
        router.replace(
          `/ranges?${formatRangeQuery({
            repo: space.repository,
            branch: space.baseBranch,
            from: fromText,
            to: toText,
            epoch: seqEpoch,
            ...(effectiveQuery === '' ? {} : { q: effectiveQuery }),
          })}`,
        );
      } catch {
        if (generation.current === mine) setOutcome({ kind: 'offline' });
      }
    },
    [space, fromAnchor, toAnchor, fromText, toText, router, rangeQuery],
  );

  /*
   * 딥링크 자동 흐름: 앵커가 URL에 실려 온 첫 진입이면 정규화까지는 자동으로
   * 진행한다 — 사용자가 이미 링크로 의사를 밝혔다. **조회는 에폭 판정을 지나야
   * 한다**: URL 에폭이 현재와 다르면 여기서 멈추고 경고만 낸다 (QA-W004-21).
   */
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current || spaces === null || space === null) return;
    bootstrapped.current = true;
    if (initial.current.from !== null) void resolveAnchor('from', initial.current.from);
    if (initial.current.to !== null) void resolveAnchor('to', initial.current.to);
  }, [spaces, space, resolveAnchor]);

  const selectedSpace =
    space === null || spaces === null
      ? undefined
      : spaces.find(
          (option) => option.repository === space.repository && option.base_branch === space.baseBranch,
        );
  const urlEpochJudgement =
    selectedSpace?.seq_epoch != null ? judgeEpoch(initial.current.epoch, selectedSpace.seq_epoch) : 'unpinned';

  const canQuery = preflight.kind === 'ok';

  /*
   * 안전 구간 표식 (WP-041 / FR-SEQ-006).
   *
   * **공간이 정해지면 읽는다** — 구간을 조회하기 전에도 그 공간의 현재
   * 표식은 사실이며, "여기까지 검증됐다"를 먼저 보고 조사 범위를 정하는
   * 것이 이 화면의 쓰임이다.
   */
  const [marker, setMarker] = useState<MarkerView | null>(null);
  const [markerEpoch, setMarkerEpoch] = useState<number | null>(null);
  const markerGeneration = useRef(0);

  /*
   * **공간이 바뀌면 즉시 비운다** (DEV-472, PR #103 리뷰 P2).
   *
   * 옛 값을 남긴 채 새 조회를 시작하면 카드가 잠시 **이전 저장소의 검증
   * 경계를 새 저장소의 것으로 보인다.** 더 나쁜 것은 쓰기다 — 느린 조회
   * 중에 새 끝 앵커가 먼저 해석되면 `PUT` 본문이 새 저장소에 **옛 에폭과
   * 옛 `expected_marker_seq`**를 실어 보낸다. `markerEpoch`가 `null`인
   * 동안은 카드가 서지 않고 `submitMarker`도 막히므로, 비우는 것이 그
   * 조합을 원천에서 없앤다.
   *
   * **`loadMarker` 안에서 비우지 않는다.** 등록 직후에도 그것을 부르므로,
   * 거기서 비우면 **방금 등록한 결과를 보여 줄 카드가 사라진다** — 공간이
   * 바뀐 것과 같은 값을 다시 읽는 것은 다른 일이다.
   */
  useEffect(() => {
    setMarker(null);
    setMarkerEpoch(null);
  }, [space?.repository, space?.baseBranch]);

  const loadMarker = useCallback(async (): Promise<void> => {
    if (space === null) return;
    const generation = (markerGeneration.current += 1);
    try {
      const response = await fetch(markerRequestUrl(space.repository, space.baseBranch), {
        cache: 'no-store',
      });
      if (generation !== markerGeneration.current) return;
      if (!response.ok) {
        // 표식을 못 읽는 것이 구간 조회를 막지 않는다 — 카드만 비운다.
        setMarker(null);
        setMarkerEpoch(null);
        return;
      }
      const body = (await response.json()) as MarkerResponse;
      if (generation !== markerGeneration.current) return;
      setMarker(body.marker ?? null);
      setMarkerEpoch(body.seq_epoch ?? null);
    } catch {
      if (generation !== markerGeneration.current) return;
      setMarker(null);
      setMarkerEpoch(null);
    }
  }, [space]);

  useEffect(() => {
    void loadMarker();
  }, [loadMarker]);

  /**
   * 등록 대상은 **끝 앵커**다 (CR-057, DEV-462).
   *
   * 이 화면의 목적이 "검증 완료 지점을 기록한다"이고 구간이 반개구간
   * `(from, to]`이므로, 검증을 마친 마지막 지점이 곧 끝 앵커다. 숫자를
   * 따로 받는 입력창을 두지 않는다.
   */
  const markerTargetSeq = toAnchor?.mergeSeq ?? null;

  const submitMarker = useCallback(
    async (note: string | null): Promise<MarkerSubmitOutcome> => {
      if (space === null || markerTargetSeq === null || markerEpoch === null) {
        return { kind: 'error', code: 'INVALID_PARAMETER', message: '표식 대상을 확인할 수 없습니다.' };
      }
      try {
        const response = await fetch('/api/safe-markers', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({
            repository: space.repository,
            base_branch: space.baseBranch,
            merge_seq: markerTargetSeq,
            seq_epoch: markerEpoch,
            note,
            /*
             * **본 값을 함께 보낸다** (DEV-464). 이것이 없으면 응답을 잃은
             * 재시도가 그 사이의 갱신을 조용히 되돌린다.
             */
            expected_marker_seq: marker?.merge_seq ?? null,
          }),
        });
        const body = (await response.json()) as MarkerResponse;
        const outcome = judgeMarkerSubmit(response.status, body);
        // 성공이든 충돌이든 현재 값을 다시 읽는다 — 화면이 남의 판정을 덮어 보이지 않는다.
        await loadMarker();
        return outcome;
      } catch {
        return { kind: 'error', code: 'OFFLINE', message: '네트워크 오류로 등록하지 못했습니다.' };
      }
    },
    [space, markerTargetSeq, markerEpoch, marker, loadMarker],
  );

  /** 패싯 체크 상태의 유일한 출처. 파싱 실패는 "필터 없음"으로 읽는다. */
  const rangeAst: QueryAst | null = (() => {
    if (rangeQuery.trim() === '') return null;
    try {
      return parseQuery(rangeQuery);
    } catch {
      return null;
    }
  })();

  /**
   * 패싯 클릭 — 질의를 고치고 **첫 페이지부터 다시 연다.**
   *
   * 커서를 들고 조건을 바꾸면 서버가 `CURSOR_QUERY_MISMATCH`로 답한다. 그것은
   * 사용자가 만든 오류가 아니라 화면이 만든 것이므로 여기서 버린다 (DEV-280).
   */
  const onToggleRangeFacet = useCallback(
    (queryKey: string, value: string, next: boolean) => {
      const base = rangeAst ?? { filters: [], text: null };
      const updated = next ? addEquality(base, queryKey, value) : removeEquality(base, queryKey, value);
      const serialized = serializeQuery(updated);
      setRangeQuery(serialized);
      setPageState(RANGE_FIRST_PAGE);
      void runQuery({ pinEpoch: null, q: serialized });
    },
    [rangeAst, runQuery],
  );

  const loadMoreRange = useCallback(
    (cursor: string) => {
      const current = outcome.kind === 'ready' ? outcome.result : null;
      void runQuery({
        pinEpoch: null,
        cursor,
        carried: current?.items ?? [],
        carriedFacets: current?.facets ?? pageState.facets,
      });
    },
    [outcome, pageState.facets, runQuery],
  );

  const backToFirstRange = useCallback(() => {
    setPageState(RANGE_FIRST_PAGE);
    void runQuery({ pinEpoch: null });
  }, [runQuery]);

  return (
    <div data-testid="ranges-view">
      <Panel as="section" aria-label="시퀀스 공간과 앵커">
        {spacesFailed ? (
          <p data-testid="spaces-error">시퀀스 공간 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.</p>
        ) : null}
        {spaces === null && !spacesFailed ? <p data-testid="spaces-loading">공간 목록을 불러오는 중…</p> : null}
        {spaces !== null ? (
          <SequenceSpaceSelector
            spaces={spaces}
            value={space}
            onChange={(next) => {
              setSpace(next);
              // 공간이 바뀌면 이전 공간의 해석은 무효다 — 상태를 비운다.
              setFromState({ kind: 'idle' });
              setToState({ kind: 'idle' });
              setOutcome({ kind: 'idle' });
            }}
          />
        ) : null}

        {/* 반개구간 규칙 상시 표기 (QA-W004-01) — 앵커 라벨의 제외/포함과 짝이다. */}
        <p data-testid="range-boundary-rule">
          구간 규칙: <code className="cdt-mono">(시작, 끝]</code> — 시작 앵커는 <Badge tone="neutral">제외</Badge>, 끝 앵커는{' '}
          <Badge tone="neutral">포함</Badge>됩니다.
        </p>

        <AnchorInput
          id="from"
          label="시작 앵커"
          boundary="exclusive"
          value={fromText}
          state={fromState}
          epoch={resolveEpoch}
          onChange={(value) => {
            setFromText(value);
            setFromState({ kind: 'idle' });
          }}
          onCommit={() => void resolveAnchor('from', fromText)}
        />
        <AnchorInput
          id="to"
          label="끝 앵커"
          boundary="inclusive"
          value={toText}
          state={toState}
          epoch={resolveEpoch}
          onChange={(value) => {
            setToText(value);
            setToState({ kind: 'idle' });
          }}
          onCommit={() => void resolveAnchor('to', toText)}
        />

        {preflight.kind === 'inverted' ? (
          <p data-testid="range-inverted" role="alert">
            시작(seq {preflight.fromSeq})이 끝(seq {preflight.toSeq})보다 뒤입니다.{' '}
            <Button
              data-testid="range-swap"
              onClick={() => {
                // 교환 제안 (QA-W004-07) — 값을 서로 바꾸고 해석 상태도 함께 바꾼다.
                setFromText(toText);
                setToText(fromText);
                const previousFrom = fromState;
                setFromState(toState);
                setToState(previousFrom);
              }}
            >
              두 앵커 교환
            </Button>
          </p>
        ) : null}
        {preflight.kind === 'too_large' ? (
          <p data-testid="range-too-large" role="alert">
            예상 {preflight.expected.toLocaleString()}건 — 5만 건을 넘습니다. 앵커를 좁혀 주세요.
          </p>
        ) : null}

        {urlEpochJudgement === 'stale' && outcome.kind === 'idle' ? (
          <Banner tone="warning" title="에폭 불일치" data-testid="epoch-stale-banner">
            이 링크는 에폭 {initial.current.epoch ?? 0} 기준 인용인데 현재 에폭은{' '}
            {selectedSpace?.seq_epoch ?? 0}입니다. 서수가 다른 커밋을 가리킬 수 있어 자동으로 재조회하지
            않습니다.
          </Banner>
        ) : null}

        <Button
          data-testid="range-query"
          disabled={!canQuery}
          onClick={() =>
            void runQuery({
              // 링크의 에폭 인용은 첫 조회에만 싣는다 — 서버가 낡음을 판정한다.
              pinEpoch: outcome.kind === 'idle' ? initial.current.epoch : null,
            })
          }
        >
          조회
        </Button>
      </Panel>

      {/*
       * `W-004-MARKER` (FR-SEQ-006). **공간이 정해지면 보인다** — 구간을
       * 조회하기 전에도 "여기까지 검증됐다"는 사실은 유효하고, 그것을 보고
       * 조사 범위를 정하는 것이 이 화면의 쓰임이다.
       */}
      {space === null || markerEpoch === null ? null : (
        <SafeMarkerCard
          marker={marker}
          canWrite={mayWriteMarker(roles, authEnabled)}
          targetSeq={markerTargetSeq}
          currentEpoch={markerEpoch}
          onSubmit={submitMarker}
        />
      )}

      {space === null ? null : <BisectPanel
        key={`${space.repository}@${space.baseBranch}`}
        repository={space.repository}
        baseBranch={space.baseBranch}
        range={outcome.kind === 'ready' && outcome.result.sequenceState === 'ok' && fromAnchor !== null && toAnchor !== null
          ? { from: fromAnchor.mergeSeq, to: toAnchor.mergeSeq, epoch: outcome.result.seqEpoch } : null}
      />}

      {outcome.kind === 'idle' && fromAnchor === null && toAnchor === null ? (
        <p data-testid="range-empty">앵커 두 개를 지정하면 구간을 조회합니다.</p>
      ) : null}
      {outcome.kind === 'loading' ? <p data-testid="range-loading">구간을 조회하는 중…</p> : null}

      {outcome.kind === 'epoch_stale' ? (
        <Banner tone="warning" title="인용 에폭이 낡았습니다" data-testid="epoch-stale-result">
          에폭 {outcome.requestedEpoch} 인용은 현재 에폭 {outcome.currentEpoch}에서 무효입니다.{' '}
          <Button data-testid="requery-current-epoch" onClick={() => void runQuery({ pinEpoch: null })}>
            현재 에폭으로 재조회
          </Button>
        </Banner>
      ) : null}

      {outcome.kind === 'server_error' ? (
        <ErrorBanner
          tone={outcome.status >= 500 ? 'danger' : 'warning'}
          title={`조회 실패 (${outcome.code})`}
          impact={outcome.message}
          correlationId={outcome.correlationId}
          recoverable={outcome.status < 500}
        />
      ) : null}
      {outcome.kind === 'offline' ? (
        <p data-testid="range-offline" role="alert">
          네트워크 오류로 조회하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.
        </p>
      ) : null}

      {outcome.kind === 'ready' ? (
        <>
          {outcome.result.sequenceState === 'reassigning' ? (
            <Banner tone="warning" title="재채번 진행 중" data-testid="reassigning-banner">
              마지막 확정 값으로 표시 중입니다 — 재채번이 끝나면 서수가 달라질 수 있습니다 (QA-W004-22).
            </Banner>
          ) : null}
          {outcome.result.sequenceState === 'stale' ? (
            <Banner tone="warning" title="채번이 뒤처져 있습니다" data-testid="stale-banner">
              최근 머지가 아직 서수를 받지 않았습니다. 구간 끝이 실제보다 짧을 수 있습니다.
            </Banner>
          ) : null}
          {outcome.result.summary === null ? null : <RangeSummaryCard summary={outcome.result.summary} />}
          <div data-testid="range-body">
            {/*
             * **넷이다** (FR-SEQ-002 AC-8): 작성자·팀·라벨·경로. 저장소와 대상
             * 브랜치는 시퀀스 공간이 이미 고정하므로 패싯으로 다시 묻지 않는다.
             */}
            <FacetRail
              source={outcome.result.facets}
              ast={rangeAst}
              onToggle={onToggleRangeFacet}
              fields={RANGE_FACET_FIELDS}
              onRetry={backToFirstRange}
            />
            {space === null ? null : (
              <RangeResultTable
                repository={space.repository}
                baseBranch={space.baseBranch}
                items={outcome.result.items}
                missingInIndex={outcome.result.missingInIndex}
              />
            )}
          </div>
          <CursorPager
            /* 실패한 커서를 다시 내주지 않는다 — 같은 오류가 반복된다. */
            nextCursor={pageState.failure === null ? outcome.result.nextCursor : null}
            resumed={pageState.cursor !== null || pageState.carried.length > 0}
            loadedCount={outcome.result.items.length}
            loading={false}
            onLoadMore={loadMoreRange}
            onFirst={backToFirstRange}
            failure={pageState.failure}
          />
        </>
      ) : null}

      {/*
       * 커서 실패는 결과가 없을 때도 알려야 한다 — 특히 **에폭이 바뀐 경우**가
       * 이리로 온다 (ADR-007). 조용히 첫 페이지로 되돌리면 재채번이 일어났다는
       * 사실이 사라진다.
       */}
      {pageState.failure === null || outcome.kind === 'ready' ? null : (
        <CursorPager
          nextCursor={null}
          resumed
          loadedCount={0}
          loading={outcome.kind === 'loading'}
          onLoadMore={loadMoreRange}
          onFirst={backToFirstRange}
          failure={pageState.failure}
        />
      )}
      <span data-testid="login-path" hidden>
        {loginPath}
      </span>
    </div>
  );
}
