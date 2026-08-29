'use client';

/**
 * A-004 감사 로그 (WP-039 / FR-AUTH-004, NFR-006, CR-054).
 *
 * ## 판정을 다시 만들지 않는다
 *
 * 역할은 서버가 강제하고(AC-5) 커서 실패는 서버가 두 코드로 가른다. 화면이
 * 그 판정을 흉내 내면 두 판정이 갈라지고, **갈라진 쪽이 느슨하면 그것이 곧
 * 우회 경로다.** 여기서 하는 것은 상태 하나를 고르고 그리는 일이다.
 *
 * ## 필터는 URL이 정본이다
 *
 * `A-004-FILTERS`의 다섯 축을 URL에 싣는다 (`readAuditFilter`). 조사 중이던
 * 조건을 붙여넣기 하나로 남에게 넘길 수 있어야 하고, 그것이 이 제품의
 * 나머지 화면이 지키는 규칙이다.
 *
 * **적용은 명시적이다.** 입력할 때마다 조회하면 타이핑 도중의 부분 문자열로
 * 감사 평면을 훑게 되고, 그 요청 하나하나가 `audit.view`로 남아 **감사 로그가
 * 자기 조사 과정으로 가득 찬다.**
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@conductor-by-89soone/react';
import { AuditRecordTable } from './AuditRecordTable';
import { CursorPager } from './CursorPager';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import {
  ACTION_OPTIONS,
  EMPTY_FILTER,
  buildAuditRequestUrl,
  readAuditFilter,
  readCursorFailure,
  resolveAuditState,
  toAuditPage,
  writeAuditFilter,
  type AuditCursorFailure,
  type AuditFilterState,
  type AuditRecordView,
} from '../lib/audit';

interface ListState {
  readonly items: readonly AuditRecordView[] | null;
  readonly nextCursor: string | null;
  /** 이번 요청에 실을 커서. `null`이면 첫 페이지다. */
  readonly cursor: string | null;
  readonly status: number | null;
  readonly cursorFailure: AuditCursorFailure | null;
  /**
   * 요청 세대.
   *
   * 커서만으로는 "다시 불러라"를 표현할 수 없다 — 이미 첫 페이지면 상태가
   * 달라지지 않아 조회 효과가 다시 돌지 않는다 (WP-032 PR #57 리뷰, DEV-332).
   */
  readonly nonce: number;
}

const FIRST_PAGE: ListState = {
  items: null,
  nextCursor: null,
  cursor: null,
  status: null,
  cursorFailure: null,
  nonce: 0,
};

/** 필터 한 칸. 다섯이 같은 모양을 쓴다. */
function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  list,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly type?: string;
  readonly list?: string;
}): ReactNode {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        {...(list === undefined ? {} : { list })}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

export interface AuditViewProps {
  /** 첫 렌더의 필터. 서버가 URL에서 읽어 넘긴다. */
  readonly initialSearch?: string;
}

export function AuditView({ initialSearch = '' }: AuditViewProps): ReactNode {
  const [applied, setApplied] = useState<AuditFilterState>(() =>
    readAuditFilter(new URLSearchParams(initialSearch)),
  );
  const [draft, setDraft] = useState<AuditFilterState>(applied);
  const [state, setState] = useState<ListState>(FIRST_PAGE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    void (async () => {
      try {
        const response = await fetch(buildAuditRequestUrl(applied, state.cursor), {
          signal: controller.signal,
          cache: 'no-store',
        });
        const body: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          const failure = readCursorFailure(body);
          /*
           * **아무것도 다시 부르지 않는다.** 여기서 커서를 비우면 이 효과의
           * 의존값이 바뀌어 첫 페이지가 자동으로 조회되고, 사용자는 목록이
           * 처음으로 돌아간 것만 보게 된다 (WP-033의 선례).
           */
          setState((current) => ({ ...current, status: response.status, cursorFailure: failure }));
          return;
        }

        const page = toAuditPage(body);
        setState((current) => ({
          ...current,
          // 커서가 없으면 첫 페이지다 — 쌓지 않고 갈아 끼운다.
          items: current.cursor === null ? page.items : [...(current.items ?? []), ...page.items],
          nextCursor: page.nextCursor,
          status: response.status,
          cursorFailure: null,
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        void error;
        setState((current) => ({ ...current, status: 500 }));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [applied, state.cursor, state.nonce]);

  const apply = useCallback(() => {
    setApplied(draft);
    setState((current) => ({ ...FIRST_PAGE, nonce: current.nonce + 1 }));
    // URL을 조건과 맞춘다. 딥링크가 이 화면의 재현 경로다.
    if (typeof window !== 'undefined') {
      const search = writeAuditFilter(draft).toString();
      window.history.replaceState(null, '', search === '' ? window.location.pathname : `?${search}`);
    }
  }, [draft]);

  const reset = useCallback(() => {
    setDraft(EMPTY_FILTER);
  }, []);

  const loadMore = useCallback((cursor: string) => {
    setState((current) => ({ ...current, cursor, cursorFailure: null, nonce: current.nonce + 1 }));
  }, []);

  const backToFirst = useCallback(() => {
    setState((current) => ({ ...FIRST_PAGE, nonce: current.nonce + 1 }));
  }, []);

  const view = resolveAuditState({
    items: state.items,
    loading,
    status: state.status,
    cursorFailure: state.cursorFailure,
  });

  if (view === 'no_permission') {
    return (
      <div data-testid="audit-view" data-state="no_permission">
        <EmptyState
          cause="no_permission"
          title="이 화면은 보안 담당자(security_officer) 역할이 필요합니다"
          description="필요한 역할을 그대로 적습니다. 운영자(operator) 역할로는 감사 기록을 조회할 수 없습니다."
        />
      </div>
    );
  }

  const items = state.items ?? [];

  return (
    <div data-testid="audit-view" data-state={view}>
      <section aria-label="감사 기록 필터" data-testid="audit-filters">
        <datalist id="audit-action-options">
          {ACTION_OPTIONS.map((action) => (
            <option key={action} value={action} />
          ))}
        </datalist>
        <Field
          id="audit-user"
          label="사용자"
          value={draft.userId}
          onChange={(next) => {
            setDraft((current) => ({ ...current, userId: next }));
          }}
        />
        {/*
          자유 입력을 막지 않는다 (AC-7). `datalist`는 제안일 뿐이며, 정본
          표에 없는 과거 값(`sequence_integrity.reassign`)도 조회할 수 있어야
          한다 — 감사의 목적이 과거를 조사하는 것이다.
        */}
        <Field
          id="audit-action"
          label="행위 유형"
          value={draft.action}
          list="audit-action-options"
          onChange={(next) => {
            setDraft((current) => ({ ...current, action: next }));
          }}
        />
        <Field
          id="audit-target"
          label="대상"
          value={draft.target}
          onChange={(next) => {
            setDraft((current) => ({ ...current, target: next }));
          }}
        />
        <Field
          id="audit-from"
          label="시작"
          type="datetime-local"
          value={draft.from}
          onChange={(next) => {
            setDraft((current) => ({ ...current, from: next }));
          }}
        />
        <Field
          id="audit-to"
          label="끝"
          type="datetime-local"
          value={draft.to}
          onChange={(next) => {
            setDraft((current) => ({ ...current, to: next }));
          }}
        />
        <Field
          id="audit-result"
          label="결과 코드"
          value={draft.resultCode}
          onChange={(next) => {
            setDraft((current) => ({ ...current, resultCode: next }));
          }}
        />
        <Button onClick={apply} data-testid="audit-apply">
          조회
        </Button>
        <Button variant="secondary" onClick={reset} data-testid="audit-reset">
          조건 지우기
        </Button>
      </section>

      {view === 'cursor_invalid' ? (
        <ErrorBanner
          tone="warning"
          title={
            state.cursorFailure === 'CURSOR_QUERY_MISMATCH'
              ? '조회 조건이 바뀌었습니다'
              : '이 페이지 위치를 더 쓸 수 없습니다'
          }
          impact={
            state.cursorFailure === 'CURSOR_QUERY_MISMATCH'
              ? '조건을 바꾼 뒤에는 이전 위치를 이어 볼 수 없습니다. 첫 페이지부터 다시 봅니다.'
              : '위치 정보가 만료되었거나 손상되었습니다. 첫 페이지부터 다시 봅니다.'
          }
        />
      ) : null}

      {view === 'error' ? (
        <ErrorBanner
          tone="danger"
          title="감사 기록을 가져오지 못했습니다"
          impact="조사 중이던 조건은 그대로 남아 있습니다. 잠시 뒤 다시 조회해 주세요."
        />
      ) : null}

      {view === 'empty_no_result' ? (
        <EmptyState
          cause="no_result"
          title="이 조건에 맞는 감사 기록이 없습니다"
          description="기간을 넓히거나 행위 유형 조건을 지우면 더 많은 기록이 표시됩니다."
        />
      ) : (
        <AuditRecordTable items={items} />
      )}

      <CursorPager
        nextCursor={state.nextCursor}
        resumed={state.cursor !== null}
        loadedCount={items.length}
        loading={loading}
        onLoadMore={loadMore}
        onFirst={backToFirst}
        failure={state.cursorFailure}
      />
    </div>
  );
}
