'use client';

/**
 * W-001 통합 검색 (WP-016 / FLOW-001, 상태 매트릭스 W-001).
 *
 * ## URL이 단일 진실이다
 *
 * 질의·정렬·순서가 전부 URL에 있고 컴포넌트 상태에는 없다. 그래서:
 *   - 붙여넣은 링크가 같은 화면을 연다 (QA-COMMON-09)
 *   - 뒤로가기가 이전 조건으로 돌아간다
 *   - 필터를 다섯 번 만져도 히스토리가 한 칸만 늘어난다 (`replace`)
 *
 * 필터·정렬은 `router.replace`, 화면 이동은 `push`다 (WP-016 구현 범위).
 * `push`로 필터를 쌓으면 뒤로가기 한 번이 "이전 화면"이 아니라 "직전 필터"가
 * 되어, DoD의 "필터 5회 뒤 뒤로가기 1회로 이전 화면 복귀"가 깨진다.
 *
 * ## 상태 판정은 여기 없다
 *
 * 13종 상태는 `lib/search-state.ts`가 정한다. 이 파일은 그 태그로 분기해
 * 그리기만 한다.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SearchAggregationTab } from './SearchAggregationTab';
import { hasSequenceRangeFilter, serializeQuery } from '@prs/query';
import { Banner, Button, Collapsible, Skeleton, Tabs } from '@conductor-by-89soone/react';
import { CursorPager, toCursorFailure, type CursorFailure } from './CursorPager';
import Link from 'next/link';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { FacetRail } from './FacetRail';
import { OmniSearchInput } from './OmniSearchInput';
import { QueryTokenBar } from './QueryTokenBar';
import { ResolutionCandidateList, type ResolutionCandidate } from './ResolutionCandidateList';
import { SaveSearchDialog } from './SaveSearchDialog';
import { ExportDialog } from './ExportDialog';
import { ResultTable, type ResultRow, type SortState } from './ResultTable';
import {
  parseQueryState,
  readQueryState,
  toHref,
  withQuery,
  withAst,
  withFromQuery,
  type QueryState,
} from '../lib/query-url';
import { chooseRoute, resolveUrl, searchUrl } from '../lib/search-fetch';
import { resolveScreenState, type ApiErrorBody } from '../lib/search-state';
import { addEquality, removeChip, removeEquality, toChips } from '../lib/tokens';
import type { FacetSource } from '../lib/facets';
import { WorkbenchIcon } from './WorkbenchIcon';
import { SearchWelcome } from './SearchWelcome';
import { ResultWorkbench } from './ResultWorkbench';
import { MergeNumberEntry } from './MergeNumberEntry';
import { usePendingRevalidation } from './usePendingRevalidation';
import { hasPendingMergeNumber, readMergeNumberEntry } from '../lib/merge-number';

const SEARCH_PATH = '/search';

/** `/search` 응답 중 화면이 쓰는 부분. 서버가 더 보내도 무시한다. */
interface SearchResponse extends FacetSource {
  readonly total?: { readonly value: number; readonly relation: string };
  readonly sort?: SortState;
  readonly items?: readonly ResultRow[];
  readonly relaxation_hints?: readonly { readonly remove: string; readonly total: number }[];
  readonly unresolved_names?: readonly { readonly key: string; readonly value: string }[];
  readonly next_cursor?: string | null;
  /**
   * `seq:` 질의의 시퀀스 맥락 (CR-051). 다른 질의에는 키가 없다.
   */
  readonly sequence_context?: {
    readonly sequence_space: string;
    readonly repository: string;
    readonly base_branch: string;
    readonly seq_epoch: number;
    readonly sequence_state: string;
  };
  readonly epoch_stale?: boolean;
  readonly requested_seq_epoch?: number;
}

/**
 * 이어 보기 상태 (WP-032 / FR-SRCH-008).
 *
 * **URL에 싣지 않는다.** 커서는 발급자의 접근 범위와 색인 스냅숏으로 봉인돼
 * 있어(ADR-010 Amendment) 남에게 붙여넣어 봤자 `CURSOR_QUERY_MISMATCH`다.
 * URL이 나르는 것은 조건이고, 위치는 이 세션의 것이다.
 *
 * `q`·정렬·필터가 바뀌면 **커서와 패싯 상태를 함께 버린다** (DEV-280) — 그
 * 폐기는 `state`를 의존값으로 갖는 조회 효과가 한다.
 */
interface PageState {
  /** 이어 보기로 쌓은 앞 페이지들의 항목. 첫 페이지면 비어 있다. */
  readonly carried: readonly ResultRow[];
  /** 지금 요청에 실을 커서. `null`이면 첫 페이지다. */
  readonly cursor: string | null;
  /** 첫 페이지의 패싯. 이어 보기는 다시 세지 않고 이것을 그대로 쓴다. */
  readonly facets: FacetSource;
  /** 직전 요청이 커서 때문에 실패했는가. */
  readonly failure: CursorFailure | null;
  /**
   * 요청 세대 (PR #57 리뷰 P2).
   *
   * **커서만으로는 "다시 불러라"를 표현할 수 없다.** 첫 페이지에서 분포가
   * `failed`·`budget_omitted`로 온 뒤 "분포 다시 계산"을 누르면 커서는 이미
   * `null`이라 상태가 달라지지 않고, React가 갱신을 건너뛰어 조회 효과가 다시
   * 돌지 않는다 — 버튼이 아무 일도 하지 않는다.
   *
   * 세대를 올리면 같은 커서라도 새 요청이 된다.
   */
  readonly nonce: number;
}

const FIRST_PAGE: PageState = { carried: [], cursor: null, facets: {}, failure: null, nonce: 0 };

interface ResolveResponse {
  readonly candidates?: readonly ResolutionCandidate[];
  readonly truncated?: boolean;
}

interface FetchOutcome {
  readonly search: SearchResponse | null;
  readonly resolve: ResolveResponse | null;
  readonly errorBody: ApiErrorBody | null;
  readonly status: number | null;
  readonly networkFailed: boolean;
}

const IDLE: FetchOutcome = {
  search: null,
  resolve: null,
  errorBody: null,
  status: null,
  networkFailed: false,
};

export interface SearchViewProps {
  readonly loginPath: string;
  /** GHE 기준 URL. URL 형태 식별자 판정에 쓴다 (DEV-064). */
  readonly gheBaseUrl?: string;
}

export function SearchView({ loginPath, gheBaseUrl }: SearchViewProps): ReactNode {
  const router = useRouter();
  const params = useSearchParams();

  const state: QueryState = useMemo(
    () => readQueryState(params?.toString() ?? ''),
    [params],
  );
  const parsed = useMemo(() => parseQueryState(state), [state]);

  /*
   * M 해석 진입 (WP-074 / 상세 설계 9절).
   *
   * 네 query key가 오면 이 화면은 **경유지**가 된다 — 보통의 검색을 부르지 않고
   * resolve를 한 번 부른 뒤 PR 상세로 옮긴다. 원래 `q`가 함께 와도 먼저 해석하고,
   * 그 `q`는 `from_q`로만 보존한다.
   */
  const mergeEntry = useMemo(
    () => readMergeNumberEntry(new URLSearchParams(params?.toString() ?? '')),
    [params],
  );

  /**
   * M 번호 대기 재검증 세대.
   *
   * `page.nonce`와 나누어 둔다 — 그쪽은 `ScreenBody`의 `key`에 들어 있어 값이
   * 바뀌면 본문이 통째로 다시 마운트되고 **키보드 포커스가 사라진다.** 재검증은
   * 같은 목록을 조용히 갱신하는 일이므로 포커스를 건드리면 안 된다.
   */
  const [revalidateNonce, setRevalidateNonce] = useState(0);

  const [outcome, setOutcome] = useState<FetchOutcome>(IDLE);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState<PageState>(FIRST_PAGE);
  const [filtersOpen, setFiltersOpen] = useState(true);

  /*
   * 진행 중인 요청을 세대(generation)로 센다.
   *
   * 사용자가 빠르게 조건을 바꾸면 먼저 보낸 요청이 나중에 도착할 수 있다.
   * 그 응답을 그리면 **화면이 URL과 다른 것을 보여 준다.** 세대가 다르면
   * 버린다 — `AbortController`만으로는 이미 도착한 응답을 막지 못한다.
   */
  const generation = useRef(0);
  /**
   * 제출 횟수 (FLOW-001 4단계, CR-021 DEV-097).
   *
   * ## 왜 제출에만 매다는가
   *
   * 자동 이동을 해석 결과에만 걸면 **뒤로가기가 막힌다.** `/search?q=<40자 SHA>`로
   * 돌아오는 순간 해석이 다시 후보 1건을 내고 화면이 곧바로 상세로 튕겨 나가,
   * 사용자는 검색 화면에 영영 닿지 못한다. 실제로 e2e가 그것을 잡았다.
   *
   * 흐름 명세의 1단계가 **"사용자가 제출한다"**이므로, 이동은 그 제출에 대한
   * 응답이다. 뒤로가기·붙여넣은 링크로 같은 URL에 도착한 경우에는 후보 카드를
   * 보이고 사용자가 고르게 한다 — **놀라게 하지 않는다.**
   *
   * ## 왜 `ref`가 아니라 세는가
   *
   * 불리언 `ref`로 두면 **같은 질의를 다시 제출했을 때 아무 일도 일어나지
   * 않는다** — URL이 그대로라 해석이 다시 돌지 않고, 효과의 의존값도 그대로라
   * 다시 실행되지 않기 때문이다. 사용자가 Enter를 눌렀는데 화면이 가만히 있는
   * 것은 고장으로 읽힌다. 세면 제출마다 값이 바뀌어 효과가 반드시 다시 돈다.
   */
  const [submitCount, setSubmitCount] = useState(0);

  /*
   * 저장 대화상자 (W-001-ACTIONS `search.save` / WP-033).
   *
   * **URL에 싣지 않는다.** 대화상자가 열려 있다는 것은 이 세션의 순간 상태이지
   * 조회 조건이 아니다 — 붙여넣은 링크가 남의 화면에서 대화상자를 열 이유가 없다.
   */
  const [saveOpen, setSaveOpen] = useState(false);
  // W-001-AGG: 결과 목록과 집계를 가르는 탭 (FR-STAT-006). 기본은 결과.
  const [activeTab, setActiveTab] = useState<'results' | 'aggregation'>('results');
  const [savedName, setSavedName] = useState<string | null>(null);

  /*
   * **조건이 바뀌면 페이징을 버린다** (CR-043, DEV-280).
   *
   * `state`는 URL에서 온 조건 전부다. 그것이 달라졌는데 커서를 들고 있으면
   * 서버가 `CURSOR_QUERY_MISMATCH`로 답하고, 사용자는 자기가 만들지 않은
   * 오류를 본다. 커서·쌓인 항목·패싯을 **함께** 버린다 — 셋이 같은 질의의
   * 산물이라 하나만 남기면 화면이 서로 다른 조건의 조각을 섞어 그린다.
   */
  useEffect(() => {
    setPage(FIRST_PAGE);
  }, [state]);

  useEffect(() => {
    const route = chooseRoute(state, gheBaseUrl);

    // M 해석 진입에서는 보통의 조회를 부르지 않는다 — resolve 한 번이 전부다.
    if (route.kind === 'none' || parsed.error !== null || mergeEntry.kind !== 'absent') {
      setOutcome(IDLE);
      setLoading(false);
      return;
    }

    const mine = ++generation.current;
    const controller = new AbortController();
    setLoading(true);

    const url =
      route.kind === 'resolve'
        ? resolveUrl(route.input)
        : /*
           * **첫 페이지만 패싯을 요청한다** (QA-W001-27, DEV-280).
           *
           * 이어 보기는 같은 질의의 같은 분포를 다시 세는 것이라 예산만 쓴다.
           * 첫 페이지가 센 것을 `page.facets`가 나른다.
           */
          searchUrl(state, { cursor: page.cursor, facets: page.cursor === null });

    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        const body: unknown = await response.json();
        if (mine !== generation.current) return;

        if (!response.ok) {
          const errorBody = body as ApiErrorBody;
          const failure = toCursorFailure(errorBody.error?.code);
          if (failure !== null) {
            /*
             * 커서 실패는 **화면 오류가 아니다** (C-016 사용 규칙, DEV-273).
             *
             * **아무것도 다시 부르지 않는다.** 여기서 `page.cursor`를 비우면
             * 이 효과의 의존값이 바뀌어 **첫 페이지가 자동으로 다시 조회된다** —
             * 그러면 사용자는 목록이 처음으로 돌아간 것만 보고 이유를 모른다.
             * e2e가 실제로 그 세 번째 요청을 잡았다.
             *
             * 그래서 `failure`만 세우고 나머지는 그대로 둔다. 지금까지 본
             * 목록이 남아 있어야 사용자가 자기 위치를 잃지 않는다. 첫 페이지로
             * 돌아가는 것은 그 버튼을 누를 때다.
             */
            setPage((current) => ({ ...current, failure }));
            return;
          }
          setOutcome({ ...IDLE, errorBody, status: response.status });
        } else if (route.kind === 'resolve') {
          setOutcome({ ...IDLE, resolve: body as ResolveResponse, status: response.status });
        } else {
          setOutcome({ ...IDLE, search: body as SearchResponse, status: response.status });
        }
      } catch (error) {
        // 취소는 실패가 아니다 — 다음 요청이 이어받는다.
        if (controller.signal.aborted || mine !== generation.current) return;
        void error;
        setOutcome({ ...IDLE, networkFailed: true });
      } finally {
        if (mine === generation.current) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [state, parsed.error, gheBaseUrl, page.cursor, page.nonce, revalidateNonce, mergeEntry.kind]);

  const candidates = outcome.resolve?.candidates ?? null;
  /*
   * **쌓아서 보여 준다** (C-016: "커서 기반 다음 페이지 로딩").
   *
   * 페이지를 갈아 끼우면 사용자는 앞 페이지에서 본 것을 다시 찾을 수 없다 —
   * 번호가 없어 돌아갈 길이 없기 때문이다. "첫 페이지로"가 그 되돌리기다.
   */
  const fetched = outcome.search?.items ?? null;
  const items = fetched === null ? null : [...page.carried, ...fetched];

  /** 첫 페이지가 센 분포를 이어 보기에도 쓴다 (QA-W001-27). */
  const facetSource: FacetSource =
    page.cursor === null ? (outcome.search ?? {}) : page.facets;

  /*
   * 실패한 커서를 다시 내주지 않는다.
   *
   * 직전 응답의 `next_cursor`는 방금 거절된 바로 그 값이다. 그대로 두면
   * "다음 페이지"가 같은 오류를 반복해서 만든다.
   */
  const nextCursor = page.failure === null ? (outcome.search?.next_cursor ?? null) : null;

  const loadMore = useCallback(
    (cursor: string) => {
      setPage((current) => ({
        carried: items ?? current.carried,
        cursor,
        facets: current.cursor === null ? (outcome.search ?? {}) : current.facets,
        failure: null,
        nonce: current.nonce + 1,
      }));
    },
    [items, outcome.search],
  );

  /** 첫 페이지를 **다시 연다.** 이미 첫 페이지여도 세대가 올라 조회가 다시 돈다. */
  const backToFirst = useCallback(() => {
    setPage((current) => ({ ...FIRST_PAGE, nonce: current.nonce + 1 }));
  }, []);

  /**
   * 지금 보고 있는 요청 하나를 그대로 다시 보낸다 (WP-074 / 상세 설계 9절).
   *
   * **커서도 쌓인 항목도 버리지 않는다** — 재검증은 "같은 것을 다시 본다"이지
   * "처음으로 돌아간다"가 아니다. 첫 페이지로 되돌리면 사용자가 자기 위치를 잃는다.
   */
  const revalidate = useCallback(() => {
    setRevalidateNonce((n) => n + 1);
  }, []);

  /*
   * 시퀀스 맥락 (CR-051). 서버가 바인딩한 결과이며 화면이 계산하지 않는다.
   */
  const sequenceContext = outcome.search?.sequence_context ?? null;
  const staleSequence =
    outcome.search?.epoch_stale === true &&
    sequenceContext !== null &&
    outcome.search.requested_seq_epoch !== undefined
      ? {
          sequenceSpace: sequenceContext.sequence_space,
          requestedEpoch: outcome.search.requested_seq_epoch,
          currentEpoch: sequenceContext.seq_epoch,
        }
      : null;

  const screen = resolveScreenState({
    rawQuery: state.q,
    parseError: parsed.error,
    loading,
    networkFailed: outcome.networkFailed,
    errorBody: outcome.errorBody,
    status: outcome.status,
    itemCount: items === null ? null : items.length,
    candidateCount: candidates === null ? null : candidates.length,
    candidatesTruncated: outcome.resolve?.truncated ?? false,
    loginPath,
    staleSequence,
  });

  /*
   * M 번호 대기 자동 재검증 (WP-074 / 상세 설계 9절).
   *
   * **행마다 부르지 않는다** — 지금 보고 있는 목록 요청 하나를 5초 간격으로
   * 최대 60초까지 다시 보낼 뿐이다. `enabled`가 `ready`에 매여 있으므로 낡은
   * 에폭·인증 만료·오류 화면에서는 돌지 않는다.
   */
  const listPending = hasPendingMergeNumber(items ?? []);
  const revalidation = usePendingRevalidation({
    sessionKey: `${state.q}|${page.cursor ?? ''}|${state.seqEpoch ?? ''}`,
    pending: listPending,
    enabled: screen.kind === 'ready',
    inFlight: loading,
    onRevalidate: revalidate,
  });

  /*
   * **첫 조회가 URL을 완성한다** (CR-051, ADR-007 규칙 5).
   *
   * `seq_epoch` 없이 보낸 요청에 서버가 현재 에폭을 실어 주면 그 값을
   * 주소에 새긴다. `push`가 아니라 `replace`인 이유는 에폭 고정이 새 조사
   * 단계가 아니라 **지금 보고 있는 조회의 정본 주소를 완성하는 일**이기
   * 때문이다 — `push`면 뒤로가기 한 번이 에폭 없는 같은 조회로 돌아가고
   * 사용자는 자기가 두 번 조회했다고 읽는다.
   *
   * 컴포넌트 상태에만 두면 사용자가 곧바로 복사한 주소가 다른 세대를
   * 가리키게 된다.
   */
  /**
   * 지금 URL의 질의가 `seq:` 범위를 담고 있는가.
   *
   * **응답이 아니라 현재 상태를 본다.** `sequenceContext`는 직전 조회의
   * 것이고, 사용자가 `seq:` 없는 질의를 제출한 직후에는 둘이 어긋난다 —
   * 그때 응답만 보고 주소를 고치면 **방금 지운 파라미터가 되살아난다**
   * (e2e가 잡았다).
   */
  const boundToSequence = useMemo(
    () => (parsed.ast === null ? false : hasSequenceRangeFilter(parsed.ast)),
    [parsed.ast],
  );

  useEffect(() => {
    if (loading) return;
    if (!boundToSequence) return;
    if (sequenceContext === null) return;
    if (state.seqEpoch === String(sequenceContext.seq_epoch)) return;
    // 낡음 응답의 에폭은 **현재 값**이라 그것으로 주소를 덮으면 자동 재해석이 된다.
    if (outcome.search?.epoch_stale === true) return;
    router.replace(
      toHref(SEARCH_PATH, { ...state, seqEpoch: String(sequenceContext.seq_epoch) }),
      { scroll: false },
    );
  }, [router, sequenceContext, state, outcome.search?.epoch_stale, boundToSequence, loading]);

  /** 「현재 에폭으로 다시 조회」 — 사용자의 명시적 행위로만 일어난다. */
  const rebindEpoch = useCallback(() => {
    if (staleSequence === null) return;
    router.replace(
      toHref(SEARCH_PATH, { ...state, seqEpoch: String(staleSequence.currentEpoch) }),
      { scroll: false },
    );
  }, [router, state, staleSequence]);

  /*
   * **후보가 1건이면 상세로 이동한다** (FLOW-001 4단계, CR-021 DEV-097).
   *
   * `push`이지 `replace`가 아니다 — 뒤로가기 한 번으로 검색 화면과 원래
   * 입력이 살아 돌아와야 한다. `from_q`가 그 입력을 나른다(DEV-078).
   *
   * 이동 자체는 효과에서 한다. 렌더 중에 `router.push`를 부르면 React가
   * 렌더 도중 다른 컴포넌트를 갱신한다고 경고하고, StrictMode에서 두 번 나간다.
   */
  const singleHref = screen.kind === 'resolved_single' ? withFromQuery(candidates?.[0]?.url ?? null, state.q) : null;

  useEffect(() => {
    if (singleHref === null || submitCount === 0) return;
    // 한 번만 떠난다. 소비하지 않으면 뒤로가기가 곧바로 튕겨 나간다.
    setSubmitCount(0);
    router.push(singleHref);
  }, [singleHref, submitCount, router]);

  /**
   * 조건 변경은 히스토리를 쌓지 않는다 — 뒤로가기 1회로 이전 화면이어야 한다.
   *
   * ## 왜 `router.replace`가 아닌가 (DEV-376)
   *
   * `/search`는 `force-dynamic` 서버 컴포넌트라 `router.replace`가 부를 때마다
   * **RSC 왕복을 일으킨다.** 패싯을 연달아 만지면 그 왕복이 겹치고, 겹친 내비게이션이
   * 히스토리 항목을 하나 더 남기는 경우가 생긴다 — 그러면 "다섯 번 만져도 뒤로가기
   * 한 번"이라는 이 화면의 계약이 깨진다. 서버가 바쁠수록 자주 깨지므로 전량 e2e에서만
   * 드러났고, 로그 한 줄을 넣으면 타이밍이 바뀌어 사라졌다 (6회 중 4회 실패).
   *
   * 네이티브 `history.replaceState`는 Next 14.1부터 라우터와 통합되어 `useSearchParams`를
   * 갱신하면서 **서버를 부르지 않는다.** 이 화면의 데이터는 클라이언트가 API로 가져오므로
   * 조건이 바뀔 때 서버 컴포넌트를 다시 그릴 이유가 없다 — 왕복이 없으면 겹칠 것도 없다.
   *
   * **화면 이동은 여전히 `router.push`다.** 그쪽은 실제로 다른 라우트로 가고 히스토리를
   * 쌓아야 하므로 라우터를 지나야 한다.
   */
  const replaceState = useCallback((next: QueryState) => {
    window.history.replaceState(null, '', toHref(SEARCH_PATH, next));
  }, []);

  const submit = useCallback(
    (value: string) => {
      // 제출은 새 조사다 — 히스토리에 남긴다 (화면 이동은 `push`).
      setSubmitCount((n) => n + 1);
      /*
       * **에폭을 물려주지 않는다** (CR-051). 새 질의는 다른 공간을 가리킬 수
       * 있고, `seq:`를 아예 잃었을 수도 있다. 옛 에폭을 그대로 보내면
       * 사용자는 방금 친 질의의 결과 대신 무효 경고를 받는다 —
       * `withQuery`가 그 규칙을 한 곳에 둔다.
       */
      router.push(toHref(SEARCH_PATH, withQuery(state, value)));
    },
    [router, state],
  );

  const chips = useMemo(() => toChips(parsed.ast), [parsed.ast]);

  const onRemoveChip = useCallback(
    (index: number) => {
      if (parsed.ast === null) return;
      replaceState(withAst(state, removeChip(parsed.ast, index)));
    },
    [parsed.ast, replaceState, state],
  );

  const onToggleFacet = useCallback(
    (key: string, value: string, next: boolean) => {
      const base = parsed.ast ?? { filters: [], text: null };
      const updated = next ? addEquality(base, key, value) : removeEquality(base, key, value);
      replaceState({ ...state, q: serializeQuery(updated) });
    },
    [parsed.ast, replaceState, state],
  );

  const onSortChange = useCallback(
    (field: string) => {
      // 같은 열을 다시 누르면 방향을 뒤집는다. 기본은 내림차순이다 (AC-2).
      const flip = state.sort === field && state.order !== 'asc';
      replaceState({ ...state, sort: field, order: flip ? 'asc' : 'desc' });
    },
    [replaceState, state],
  );

  const sort: SortState = {
    field: outcome.search?.sort?.field ?? state.sort ?? 'merge_seq',
    order: outcome.search?.sort?.order ?? state.order ?? 'desc',
  };

  const total = outcome.search?.total ?? null;
  const announcement =
    screen.kind === 'ready' && total !== null
      ? `결과 ${String(total.value)}${total.relation === 'gte' ? '건 이상' : '건'}`
      : screen.kind === 'ambiguous'
        ? `후보 ${String(candidates?.length ?? 0)}건`
        : '';

  /*
   * M 해석 진입은 **화면을 늘리지 않는다** (CR-079 — IA는 그대로다).
   *
   * 네 key가 오면 이 자리에서 resolve 한 번을 수행하고 결과에 따라 옮기거나
   * 알린다. 검색 입력·필터·탭을 함께 그리지 않는 이유는 여기가 머무는 곳이
   * 아니기 때문이다. 원래 `q`는 `from_q`로만 넘긴다.
   */
  if (mergeEntry.kind !== 'absent') {
    return (
      <div className="prs-search-view" data-testid="search-view" data-screen-state="merge_number_entry">
        <MergeNumberEntry entry={mergeEntry} fromQuery={state.q} loginPath={loginPath} />
      </div>
    );
  }

  return (
    <div className="prs-search-view" data-testid="search-view" data-screen-state={screen.kind}>
      <div className="prs-search-controls">
      <OmniSearchInput
        value={state.q}
        onSubmit={submit}
        busy={loading}
        resultAnnouncement={announcement}
      />

      <QueryTokenBar
        chips={chips}
        onRemove={onRemoveChip}
        error={parsed.error}
        raw={state.q}
      />

      {/*
        * W-001-ACTIONS — 저장 (FR-SRCH-010).
        *
        * **질의가 있을 때만 그린다.** 빈 질의를 저장하면 "모든 결과"라는 이름
        * 없는 조건이 남고, 그것은 사용자가 다시 열었을 때 아무것도 알려 주지
        * 않는다. 파싱 오류가 있으면 저장해도 서버가 거절하므로 여기서 막는다 —
        * 판정은 같은 파서가 이미 했다 (`parsed.error`).
        */}
      {state.q.trim() === '' ? null : (
        <div data-testid="search-actions">
          <Button
            variant="secondary"
            onClick={() => {
              setSaveOpen(true);
            }}
            /*
             * **낡은 인용은 저장할 수 없다** (CR-051, PR #64 리뷰 P1).
             *
             * 그 상태에서 응답의 `sequence_context.seq_epoch`은 사용자가 본 적
             * 없는 **현재** 세대(4)다. 그대로 저장하면 "본 것을 저장한다"는
             * 계약이 뒤집혀, 결과를 보지도 못한 세대에 묶인 검색이 조용히
             * 만들어진다. 먼저 「현재 에폭으로 다시 조회」를 눌러 그 세대를
             * 실제로 본 뒤에 저장한다.
             */
            disabled={parsed.error !== null || screen.kind === 'epoch_stale'}
            data-testid="search-save"
          >
            {/*
              * 레이블을 «검색»과 겹치지 않게 둔다. 제출 버튼이 «검색»이라
              * 접두가 같으면 사용자도, 접근성 이름으로 요소를 찾는 시험도
              * 둘을 구분하지 못한다 — 실제로 기존 e2e 하나가 모호해졌다.
              */}
            <WorkbenchIcon name="bookmark" />저장
          </Button>
        </div>
      )}
      </div>

      {savedName === null ? null : (
        <Banner tone="info" title="저장했습니다">
          <p data-testid="search-saved-notice">
            «{savedName}»를 저장했습니다. 저장된 검색 화면에서 다시 실행할 수 있습니다.
          </p>
        </Banner>
      )}

      <SaveSearchDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        query={state.q}
        /*
         * 지금 **보고 있는** 조회의 에폭이다 (CR-051). 낡은 인용에서는 본 것이
         * 없으므로 넘기지 않는다 — 위에서 저장 버튼도 막는다.
         */
        seqEpoch={screen.kind === 'epoch_stale' ? null : (sequenceContext?.seq_epoch ?? null)}
        onSaved={(name) => {
          setSavedName(name);
        }}
      />

      {/*
        * W-001-SEQCTX — 시퀀스 인용 배너 (CR-051, FR-SEQ-005 AC-4).
        *
        * **새 컴포넌트를 만들지 않는다.** 전할 것이 "무엇이 사실이고, 그래서
        * 무엇이 안 되며, 무엇을 누르면 되는가" 셋으로 `Banner`가 이미 하는
        * 일과 같다 (컴포넌트 명세 C-005).
        *
        * 액션은 **버튼 하나**이며 스스로 실행되지 않는다 — 타이머도 자동
        * 재시도도 두지 않는다. 그것이 ADR-007이 막으려는 자동 재해석이다.
        */}
      {screen.kind === 'epoch_stale' ? (
        <Banner tone="warning" title="시퀀스 번호의 의미가 바뀌었습니다">
          <p data-testid="epoch-stale-notice">
            이 검색은 <strong>{screen.sequenceSpace}</strong>의 시퀀스 에폭{' '}
            {screen.requestedEpoch}을 기준으로 만들어졌습니다. 현재 에폭은{' '}
            {screen.currentEpoch}입니다. 히스토리가 재작성되어 같은 seq 번호가 다른 커밋을
            가리킬 수 있으므로 결과를 조회하지 않았습니다.
          </p>
          <Button variant="secondary" onClick={rebindEpoch} data-testid="epoch-rebind">
            현재 에폭으로 다시 조회
          </Button>
        </Banner>
      ) : null}

      {/*
        * 인용이 유효할 때도 어느 공간·세대를 보고 있는지 적는다 — 공간 상태가
        * `ok`가 아니면 그 사실도 값과 함께 보인다. 숨기지 않는다.
        */}
      {screen.kind !== 'epoch_stale' && sequenceContext !== null ? (
        <p data-testid="sequence-context">
          시퀀스 공간 {sequenceContext.sequence_space} · 에폭 {sequenceContext.seq_epoch}
          {sequenceContext.sequence_state === 'ok'
            ? null
            : ` · 상태 ${sequenceContext.sequence_state}`}
        </p>
      ) : null}

      {/*
       * 레지스트리에서 못 찾은 이름을 알린다 (CR-016, DEV-052).
       * 조용히 0건을 내면 사용자가 오타를 영원히 못 찾는다.
       */}
      {outcome.search?.unresolved_names === undefined ? null : (
        <Banner tone="warning" title="찾을 수 없는 이름">
          <p data-testid="unresolved-names">
            {outcome.search.unresolved_names.map((n) => `${n.key}:${n.value}`).join(', ')} — 이 이름은
            등록된 조직·팀에 없습니다. 결과에 반영되지 않았습니다.
          </p>
        </Banner>
      )}

      {/*
        * 결과·집계 탭은 Conductor `Tabs`다 (0.4.1, CR-093). 0.3.1에는 탭이 없어 `Button`을
        * 조합해 WAI-ARIA 탭을 직접 만들었다(DEV-397) — 그 파일은 지웠다.
        *
        * - `activationMode="automatic"`: 화살표로 옮기면 그 자리에서 선택도 바뀐다. 0.3.1 구현과
        *   같은 동작이며 Conductor 기본(manual)과 다르므로 명시한다.
        * - 결과 패널은 `forceMount`: 집계로 갔다 와도 선택한 행과 미리보기가 남는다.
        * - 집계 패널도 `forceMount`이되 **내용은 활성일 때만** 마운트한다 (아래 주석).
        *
        * 필터 레일 접기는 Conductor `Collapsible`이다. `Root`가 트리거(도구 막대)와 내용(레일)을
        * 함께 감싸야 하므로 탭 바깥에 선다. 접힘은 조회도 URL도 바꾸지 않는 이 세션의 상태다.
        */}
      <Collapsible.Root
        open={filtersOpen && screen.kind !== 'epoch_stale'}
        onOpenChange={setFiltersOpen}
        className="prs-results"
      >
      <Tabs.Root
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value as 'results' | 'aggregation');
        }}
        activationMode="automatic"
        className="prs-results-tabs"
      >
      <div className="prs-results-toolbar">
        <Tabs.List aria-label="검색 결과 보기 방식">
          <Tabs.Trigger value="results">결과</Tabs.Trigger>
          <Tabs.Trigger value="aggregation">집계</Tabs.Trigger>
        </Tabs.List>
        {activeTab === 'results' ? <div className="prs-results-actions">
          <span className="prs-result-count" data-testid="result-count">{screen.kind === 'ready' && total !== null ? `${total.value.toLocaleString('ko-KR')}${total.relation === 'gte' ? '+' : ''}건` : loading ? '검색 중…' : '검색 결과'}</span>
          <ExportDialog state={state} disabled={loading || screen.kind !== 'ready'} />
          {/*
            * 낡은 인용이면 레일을 그리지 않으므로(CR-051) 접기 버튼도 두지 않는다 — 누를 수 없는
            * 버튼을 두면 사용자가 자기 조작이 무시됐다고 읽는다.
            */}
          {screen.kind === 'epoch_stale' ? null : (
            <Collapsible.Trigger asChild>
              <Button variant="ghost" size="sm"><WorkbenchIcon name="filter" />필터</Button>
            </Collapsible.Trigger>
          )}
          <Button variant="ghost" size="sm" disabled={loading || state.q.trim() === '' || parsed.error !== null || screen.kind === 'epoch_stale'}
            onClick={backToFirst} aria-label="결과 새로고침"><WorkbenchIcon name="refresh" />새로고침</Button>
        </div> : <span className="prs-result-count">현재 검색 조건의 PR 집계</span>}
      </div>

      {/*
        * 자동 재검증이 60초를 다 썼다 (상세 설계 9절).
        *
        * **잠정 번호를 대신 그리지 않는다.** 기다림을 멈췄다는 사실과 손으로
        * 다시 볼 길만 준다 — 새로고침은 지금 보고 있는 요청을 그대로 다시 보낸다.
        */}
      {revalidation.exhausted ? (
        <Banner tone="info" title="M 번호가 아직 확정되지 않았습니다">
          <p data-testid="mnumber-poll-exhausted">자동 확인을 멈췄습니다. 잠시 뒤 다시 확인해 주세요.</p>
          <Button
            variant="secondary"
            onClick={() => {
              revalidation.restart();
              revalidate();
            }}
          >
            다시 확인
          </Button>
        </Banner>
      ) : null}

      <Tabs.Content value="results" forceMount className="prs-results-panel">
      <div className="prs-search-layout" data-filters-open={filtersOpen && screen.kind !== 'epoch_stale' ? '' : undefined}>
        {/*
          * 낡은 인용이면 레일도 그리지 않는다 (CR-051). 세지 않은 분포를
          * "아직 세지 않음"으로 보이는 것은 사실이지만, 이 화면의 답은
          * 분포가 아니라 "번호의 뜻이 달라졌다"이고 그것은 배너가 말한다.
          */}
        {/* `id`를 주지 않는다 — 트리거의 `aria-controls`가 Radix가 만든 내용 id를 가리키므로 덮어쓰면 참조가 끊긴다. */}
        <Collapsible.Content className="prs-search-filters">
        {screen.kind === 'epoch_stale' ? null : (
          <FacetRail
            source={facetSource}
            ast={parsed.ast}
            onToggle={onToggleFacet}
            /* 분포를 다시 세는 길은 첫 페이지를 다시 여는 것이다 — `facets=true`가 거기 붙는다. */
            onRetry={backToFirst}
          />
        )}
        </Collapsible.Content>
        <div className="prs-results-body">
        <ScreenBody
          key={`${state.q}|${state.sort ?? ''}|${state.order ?? ''}|${state.seqEpoch ?? ''}|${page.nonce}`}
          screen={screen}
          items={items}
          candidates={candidates}
          sort={sort}
          onSortChange={onSortChange}
          relaxationHints={outcome.search?.relaxation_hints ?? null}
          fromQuery={state.q}
          loginPath={loginPath}
        />
        </div>
      </div>

      {/*
       * 이어 보기는 결과가 있을 때만 뜻이 있다. 커서 실패는 결과가 없어도
       * 알려야 하므로 그 조건을 따로 둔다.
       */}
      {screen.kind === 'ready' || page.failure !== null ? (
        <CursorPager
          nextCursor={nextCursor}
          resumed={page.cursor !== null || page.carried.length > 0}
          loadedCount={items?.length ?? 0}
          loading={loading}
          onLoadMore={loadMore}
          onFirst={backToFirst}
          failure={page.failure}
        />
      ) : null}
      {screen.kind === 'ready' ? <p id="result-keyboard-help" className="prs-keyboard-help"><WorkbenchIcon name="preview" />미리보기 버튼에서 ↑ ↓ 이동 · Enter 선택 · Esc 닫기<span>제목을 누르면 상세 화면으로 이동합니다.</span></p> : null}
      </Tabs.Content>

      {/*
        * 집계 패널도 `forceMount`다 — 탭 트리거의 `aria-controls`가 가리키는 패널 요소가 늘 있어야
        * 한다(없으면 참조가 끊긴 ARIA 속성이다, axe `aria-valid-attr-value`). 다만 **내용은 활성일
        * 때만** 마운트한다: 숨은 채로 조회하면 결과 탭의 "서버를 부르지 않는다" 계약을 깨고 경합을
        * 만든다 (FR-STAT-006은 요청 시 집계).
        */}
      <Tabs.Content value="aggregation" forceMount className="prs-aggregation-panel">
        {activeTab === 'aggregation' ? (
          <SearchAggregationTab
            q={state.q}
            seqEpoch={
              screen.kind === 'epoch_stale' || sequenceContext?.seq_epoch == null
                ? null
                : String(sequenceContext.seq_epoch)
            }
            loginPath={loginPath}
          />
        ) : null}
      </Tabs.Content>
      </Tabs.Root>
      </Collapsible.Root>
    </div>
  );
}

/** 다시 시도. 조회는 URL이 유발하므로 새로고침이 곧 재시도다. */
function RetryButton(): ReactNode {
  return (
    <Button
      variant="secondary"
      onClick={() => {
        window.location.reload();
      }}
    >
      다시 시도
    </Button>
  );
}

interface ScreenBodyProps {
  readonly screen: ReturnType<typeof resolveScreenState>;
  readonly items: readonly ResultRow[] | null;
  readonly candidates: readonly ResolutionCandidate[] | null;
  readonly sort: SortState;
  readonly onSortChange: (field: string) => void;
  readonly relaxationHints: readonly { readonly remove: string; readonly total: number }[] | null;
  readonly fromQuery: string;
  readonly loginPath: string;
}

/**
 * 상태 하나로 분기한다.
 *
 * **`switch`로 전부 덮는다.** 새 상태를 더하면 타입 검사가 여기서 실패하므로
 * 매트릭스에 있는데 그려지지 않는 상태가 생기지 않는다.
 */
function ScreenBody({
  screen,
  items,
  candidates,
  sort,
  onSortChange,
  relaxationHints,
  fromQuery,
  loginPath,
}: ScreenBodyProps): ReactNode {
  switch (screen.kind) {
    case 'empty_no_query':
      return <SearchWelcome />;

    case 'error_prefix_too_short':
      // 안내는 입력창이 이미 띄웠다 (C-010). 여기서 또 말하지 않는다.
      return null;

    case 'error_query_syntax':
      // 오류 구간 강조는 토큰 바가 한다 (C-011).
      return null;

    case 'loading_initial':
      return (
        <div data-testid="loading-initial">
          {/*
           * 상태는 Conductor `Skeleton` 하나가 알린다(`role="status"`, 0.4.1). 표 안의 자리표시
           * 행은 보조 기술에서 감춘다 — 스피너 하나를 가운데 두는 대신 결과가 놓일 자리를 보인다.
           */}
          <Skeleton label="검색 결과를 불러오는 중" className="prs-loading-status" />
          <ResultTable rows={[]} sort={sort} onSortChange={onSortChange} loading />
        </div>
      );

    case 'resolved_single':
      /*
       * 이동 중이다. **후보 카드를 함께 그린다** — 이동이 막히면(팝업 차단,
       * 라우터 실패) 사용자가 손으로 누를 길이 남아야 한다. 빈 화면을 두면
       * 그때 아무 데도 갈 수 없다.
       */
      return (
        <div data-testid="resolved-single">
          <p>해석한 대상으로 이동합니다…</p>
          <ResolutionCandidateList candidates={candidates ?? []} truncated={false} fromQuery={fromQuery} />
        </div>
      );

    case 'ambiguous':
      return (
        <ResolutionCandidateList
          candidates={candidates ?? []}
          truncated={screen.truncated}
          fromQuery={fromQuery}
        />
      );

    case 'ready':
      return (
        <ResultWorkbench
          rows={items ?? []}
          sort={sort}
          onSortChange={onSortChange}
          fromQuery={fromQuery}
        />
      );

    case 'epoch_stale':
      /*
       * **아무것도 그리지 않는다** (CR-051, FR-SEQ-005 AC-4).
       *
       * 서버가 조회를 실행하지 않았으므로 목록도 요약도 없다. 사실과 액션은
       * 위의 `W-001-SEQCTX` 배너가 말하며, 여기서 `EmptyState`를 그리면
       * 그것이 "결과가 없다"로 읽힌다 — 계산하지 않은 것을 없는 것으로
       * 표현하지 않는다는 규율이 화면에서도 같다.
       */
      return null;

    case 'empty_no_result':
      return (
        <div data-testid="empty-no-result">
          <EmptyState
            cause="no_result"
            actions={
              /*
               * 원인 후보 셋 중 둘(미수집 저장소 / 접근 권한 없음)은 이 화면이
               * 판별할 수 없다 — 서버가 접근 범위 밖을 결과 없음과 같게 답하기
               * 때문이다 (THR-004). 저장소 개요에서 사용자가 직접 확인한다
               * (FLOW-002, CR-050).
               */
              <Link href="/repositories" data-testid="search-open-repository-overview">
                저장소 수집 상태 확인
              </Link>
            }
          />
          {/*
           * 어떤 조건을 빼면 결과가 생기는지 (FR-SRCH-006 AC-3, QA-W001-11).
           * "결과 없음"만 보여 주면 사용자가 어느 조건이 과했는지 모른다.
           */}
          {relaxationHints === null || relaxationHints.length === 0 ? null : (
            <ul data-testid="relaxation-hints">
              {relaxationHints.map((hint) => (
                <li key={hint.remove}>
                  <code className="cdt-mono">{hint.remove}</code>을(를) 빼면 {hint.total}건
                </li>
              ))}
            </ul>
          )}
        </div>
      );

    case 'error_search_timeout':
      return (
        <ErrorBanner
          tone="warning"
          title="검색이 시간 안에 끝나지 않았습니다"
          impact="조건이 넓어 색인 전체를 훑어야 했습니다."
          action={<span>저장소 조건(`repo:`)을 더해 범위를 좁혀 보세요.</span>}
        />
      );

    case 'no_permission':
      return <EmptyState cause="no_permission" />;

    case 'auth_expired':
      return (
        <ErrorBanner
          tone="warning"
          title="세션이 만료되었습니다"
          impact="다시 로그인하면 보던 화면으로 돌아옵니다."
          action={
            /* 원래 경로를 담아 보낸다 — 로그인 후 여기로 돌아온다 (FLOW-000). */
            <a href={`${loginPath}?return_to=${encodeURIComponent('/search')}`}>다시 로그인</a>
          }
        />
      );

    case 'offline':
      return (
        <ErrorBanner
          tone="danger"
          title="서버에 연결하지 못했습니다"
          impact="네트워크 연결을 확인한 뒤 다시 시도하세요."
          recoverable
          /* danger 배너에는 나갈 길이 있어야 한다 (Conductor 규칙). */
          action={<RetryButton />}
        />
      );

    case 'error_other':
      return (
        <ErrorBanner
          tone="danger"
          title="조회에 실패했습니다"
          impact={screen.message}
          /*
           * 서버가 상관 ID를 줬으면 그것을 싣는다 (C-005). 없으면 사용자가
           * 운영자에게 전달할 것이 없으므로 `recoverable`을 낮추지 않는다 —
           * 없는 ID로 "문의하세요"라고 하면 막다른 길이다.
           */
          recoverable={screen.correlationId === null}
          correlationId={screen.correlationId}
          action={<RetryButton />}
        />
      );
  }
}
