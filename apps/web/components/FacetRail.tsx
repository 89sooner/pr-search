'use client';

/**
 * C-012 FacetRail — 필드별 선택 UI (WP-016 / FR-SRCH-006).
 *
 * ## 레일은 자기 상태를 갖지 않는다
 *
 * 와이어프레임 구현 메모: "필터 레일 조작은 **질의 문자열을 갱신하고**, 질의
 * 문자열 변경이 조회를 유발한다. 두 방향의 상태를 따로 두지 않는다." 그래서
 * 체크 여부는 질의 AST에서 읽고, 클릭은 AST를 고쳐 위로 올린다.
 *
 * ## 조용히 비우지 않는다
 *
 * 세 경우가 서로 다른 뜻이고 사용자가 할 수 있는 일도 다르다 (CR-019,
 * DEV-076). 판정은 `lib/facets.ts`가 하고 여기서는 그 사유를 반드시 보여 준다.
 */

import type { ReactNode } from 'react';
import { Checkbox, Panel } from '@conductor-by-89soone/react';
import type { QueryAst } from '@prs/query';
import { FACET_FIELDS, facetNotice, facetRailState, type FacetSource } from '../lib/facets';
import { hasEquality } from '../lib/tokens';

export interface FacetRailProps {
  /** 응답에서 온 패싯. WP-032 전까지 두 키가 모두 없다. */
  readonly source: FacetSource;
  /** 현재 질의. 체크 상태의 **유일한** 출처다. */
  readonly ast: QueryAst | null;
  readonly onToggle: (key: string, value: string, next: boolean) => void;
}

export function FacetRail({ source, ast, onToggle }: FacetRailProps): ReactNode {
  const state = facetRailState(source);
  const notice = facetNotice(state);

  return (
    <Panel as="aside" aria-label="필터">
      <h2>필터</h2>

      {/*
       * 사유를 **먼저** 보여 준다. 아래 목록이 비어 있는 이유를 모른 채
       * 빈 레일을 보면 사용자는 "필터할 것이 없다"로 읽는다.
       */}
      {notice === null ? null : (
        <p data-testid="facet-notice" data-facet-state={state.kind}>
          {notice}
        </p>
      )}

      {state.kind !== 'ready'
        ? null
        : FACET_FIELDS.map((field) => {
            const values = state.facets[field.key] ?? [];
            if (values.length === 0) return null;

            return (
              <fieldset key={field.key} data-testid={`facet-${field.key}`}>
                <legend>{field.label}</legend>
                {values.map((entry) => {
                  const checked = hasEquality(ast, field.key, entry.value);
                  const id = `facet-${field.key}-${entry.value}`;
                  return (
                    <div key={entry.value}>
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={(next) => {
                          onToggle(field.key, entry.value, next === true);
                        }}
                      />
                      {/*
                       * 건수를 이름에 포함시킨다 — 체크박스만 읽으면 "kim"만
                       * 들리고 그것이 18건인지 1건인지 알 수 없다.
                       */}
                      <label htmlFor={id}>
                        {entry.value} ({entry.count})
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
