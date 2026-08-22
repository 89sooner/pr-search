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
import { serializeQuery } from '@prs/query';
import { Banner, Button, Spinner } from '@conductor-by-89soone/react';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { FacetRail } from './FacetRail';
import { OmniSearchInput } from './OmniSearchInput';
import { QueryTokenBar } from './QueryTokenBar';
import { ResolutionCandidateList, type ResolutionCandidate } from './ResolutionCandidateList';
import { ResultTable, type ResultRow, type SortState } from './ResultTable';
import {
  parseQueryState,
  readQueryState,
  toHref,
  withAst,
  withFromQuery,
  type QueryState,
} from '../lib/query-url';
import { chooseRoute, resolveUrl, searchUrl } from '../lib/search-fetch';
import { resolveScreenState, type ApiErrorBody } from '../lib/search-state';
import { addEquality, removeChip, removeEquality, toChips } from '../lib/tokens';
import type { FacetSource } from '../lib/facets';

const SEARCH_PATH = '/search';

/** `/search` 응답 중 화면이 쓰는 부분. 서버가 더 보내도 무시한다. */
interface SearchResponse extends FacetSource {
  readonly total?: { readonly value: number; readonly relation: string };
  readonly sort?: SortState;
  readonly items?: readonly ResultRow[];
  readonly relaxation_hints?: readonly { readonly remove: string; readonly total: number }[];
  readonly unresolved_names?: readonly { readonly key: string; readonly value: string }[];
  readonly next_cursor?: string | null;
}

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

  const [outcome, setOutcome] = useState<FetchOutcome>(IDLE);
  const [loading, setLoading] = useState(false);

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

  useEffect(() => {
    const route = chooseRoute(state, gheBaseUrl);

    if (route.kind === 'none' || parsed.error !== null) {
      setOutcome(IDLE);
      setLoading(false);
      return;
    }

    const mine = ++generation.current;
    const controller = new AbortController();
    setLoading(true);

    const url = route.kind === 'resolve' ? resolveUrl(route.input) : searchUrl(state);

    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        const body: unknown = await response.json();
        if (mine !== generation.current) return;

        if (!response.ok) {
          setOutcome({
            ...IDLE,
            errorBody: body as ApiErrorBody,
            status: response.status,
          });
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
  }, [state, parsed.error, gheBaseUrl]);

  const candidates = outcome.resolve?.candidates ?? null;
  const items = outcome.search?.items ?? null;

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
  });

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

  /** 조건 변경은 히스토리를 쌓지 않는다 — 뒤로가기 1회로 이전 화면이어야 한다. */
  const replaceState = useCallback(
    (next: QueryState) => {
      router.replace(toHref(SEARCH_PATH, next), { scroll: false });
    },
    [router],
  );

  const submit = useCallback(
    (value: string) => {
      // 제출은 새 조사다 — 히스토리에 남긴다 (화면 이동은 `push`).
      setSubmitCount((n) => n + 1);
      router.push(toHref(SEARCH_PATH, { ...state, q: value }));
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

  return (
    <div data-testid="search-view" data-screen-state={screen.kind}>
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

      <div>
        <FacetRail source={outcome.search ?? {}} ast={parsed.ast} onToggle={onToggleFacet} />
        <ScreenBody
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
      return (
        <EmptyState
          cause="no_query"
          description="예: seq:1200..1350 · 40자 커밋 SHA · merged:2026-08-10..2026-08-19"
        />
      );

    case 'error_prefix_too_short':
      // 안내는 입력창이 이미 띄웠다 (C-010). 여기서 또 말하지 않는다.
      return null;

    case 'error_query_syntax':
      // 오류 구간 강조는 토큰 바가 한다 (C-011).
      return null;

    case 'loading_initial':
      return (
        <div data-testid="loading-initial">
          <Spinner label="검색 중" />
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
        <ResultTable
          rows={items ?? []}
          sort={sort}
          onSortChange={onSortChange}
          fromQuery={fromQuery}
        />
      );

    case 'empty_no_result':
      return (
        <div data-testid="empty-no-result">
          <EmptyState cause="no_result" />
          {/*
           * 어떤 조건을 빼면 결과가 생기는지 (FR-SRCH-006 AC-3, QA-W001-11).
           * "결과 없음"만 보여 주면 사용자가 어느 조건이 과했는지 모른다.
           */}
          {relaxationHints === null || relaxationHints.length === 0 ? null : (
            <ul data-testid="relaxation-hints">
              {relaxationHints.map((hint) => (
                <li key={hint.remove}>
                  <code>{hint.remove}</code>을(를) 빼면 {hint.total}건
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
