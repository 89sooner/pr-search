'use client';

/**
 * C-012 FacetRail — 필드별 분포와 선택 UI (WP-016 + WP-032 / FR-SRCH-006, FR-SRCH-009).
 *
 * ## 레일은 자기 상태를 갖지 않는다
 *
 * 와이어프레임 구현 메모: "필터 레일 조작은 **질의 문자열을 갱신하고**, 질의
 * 문자열 변경이 조회를 유발한다. 두 방향의 상태를 따로 두지 않는다." 그래서
 * 체크 여부는 질의 AST에서 읽고, 클릭은 AST를 고쳐 위로 올린다.
 *
 * ## 조용히 비우지 않는다
 *
 * 네 경우가 서로 다른 뜻이고 사용자가 할 수 있는 일도 다르다 (CR-019 DEV-076,
 * CR-043 DEV-277). 판정은 `lib/facets.ts`가 하고 여기서는 그 사유를 반드시
 * 보여 준다. **생략과 실패를 같은 문구로 그리지 않는다** — 예산 초과는 조건을
 * 좁히면 풀리고 계산 실패는 그렇지 않다.
 *
 * ## 축은 화면이 정한다
 *
 * W-001은 여섯, W-004는 넷이다 (FR-SRCH-009 AC-1, FR-SEQ-002 AC-8). 같은
 * 컴포넌트가 둘을 그리되 어느 축인지는 부르는 쪽이 넘긴다 — 여기서 분기하면
 * 화면이 늘 때마다 이 파일이 그것을 알아야 한다.
 */

import type { ReactNode } from 'react';
import { Button, Checkbox, Panel } from './ui';
import type { QueryAst } from '@prs/query';
import {
  SEARCH_FACET_FIELDS,
  facetNotice,
  facetRailState,
  type FacetField,
  type FacetSource,
} from '../lib/facets';
import { hasEquality } from '../lib/tokens';

export interface FacetRailProps {
  /** 응답에서 온 패싯. 세 키가 함께 나타나거나 함께 빠진다. */
  readonly source: FacetSource;
  /** 현재 질의. 체크 상태의 **유일한** 출처다. */
  readonly ast: QueryAst | null;
  readonly onToggle: (queryKey: string, value: string, next: boolean) => void;
  /** 이 화면의 축. 기본은 W-001의 여섯이다. */
  readonly fields?: readonly FacetField[];
  /**
   * 분포를 다시 세는 길 (`failed`·`budget_omitted` 상태에서만 그린다).
   *
   * 없으면 재시도 버튼을 그리지 않는다 — 누를 수 없는 버튼을 두면 사용자가
   * 자기 조작이 무시됐다고 읽는다.
   */
  readonly onRetry?: () => void;
}

export function FacetRail({
  source,
  ast,
  onToggle,
  fields = SEARCH_FACET_FIELDS,
  onRetry,
}: FacetRailProps): ReactNode {
  const state = facetRailState(source);
  const notice = facetNotice(state);
  const retryable = state.kind === 'omitted' || state.kind === 'failed';

  return (
    <Panel as="aside" aria-label="Filters" className="prs-facet-rail">
      <h2>Filters</h2>

      {/*
       * 사유를 **먼저** 보여 준다. 아래 목록이 비어 있는 이유를 모른 채
       * 빈 레일을 보면 사용자는 "필터할 것이 없다"로 읽는다.
       */}
      {notice === null ? null : (
        <p data-testid="facet-notice" data-facet-state={state.kind}>
          {notice}
        </p>
      )}

      {retryable && onRetry !== undefined ? (
        <Button variant="secondary" data-testid="facet-retry" onClick={onRetry}>
          Recalculate distribution
        </Button>
      ) : null}

      {state.kind !== 'ready'
        ? null
        : fields.map((field) => {
            const values = state.facets[field.key] ?? [];
            if (values.length === 0) return null;

            return (
              <fieldset key={field.key} data-testid={`facet-${field.queryKey}`}>
                <legend>{field.label}</legend>
                {values.map((entry) => {
                  const checked = hasEquality(ast, field.queryKey, entry.value);
                  const id = `facet-${field.queryKey}-${entry.value}`;
                  return (
                    <div key={entry.value} className="prs-facet-option">
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={(next) => {
                          onToggle(field.queryKey, entry.value, next === true);
                        }}
                      />
                      {/*
                       * 건수를 이름에 포함시킨다 — 체크박스만 읽으면 "kim"만
                       * 들리고 그것이 18건인지 1건인지 알 수 없다.
                       */}
                      <label htmlFor={id} title={entry.value}>
                        <span>{entry.value}</span><span className="prs-facet-count"> ({entry.count})</span>
                      </label>
                    </div>
                  );
                })}
              </fieldset>
            );
          })}
    </Panel>
  );
}
