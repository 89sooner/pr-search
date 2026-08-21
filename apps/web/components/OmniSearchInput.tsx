'use client';

/**
 * C-010 OmniSearchInput — 식별자·질의 통합 입력 (WP-016 / FR-SRCH-001, FR-SRCH-004).
 *
 * ## 클라이언트가 먼저 거절한다
 *
 * 7자 미만 hex는 **서버를 부르지 않고** 즉시 안내한다 (FR-SRCH-004 AC-2,
 * QA-W001-04). 판정은 `lib/search-state.ts`가 하고 여기서는 제출을 막는다 —
 * 네트워크 왕복 없이 거절되는 것이 이 항목의 요구다.
 *
 * ## `recentQueries`가 선택인 이유
 *
 * 명세는 필수 prop이라 적었으나 **저장 위치가 어디에도 정해져 있지 않다**
 * (CR-019, DEV-079). 서버 저장을 임의로 넣으면 사용자의 조사 이력이 서버
 * 기록이 되는데 그것을 요구한 문서가 없다. 비면 최근 목록을 그리지 않는다.
 */

import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Button, TextField } from '@conductor-by-89soone/react';
import { isTooShortShaPrefix } from '../lib/search-state';
import { MIN_SHA_PREFIX_LENGTH } from '@prs/query';

export interface OmniSearchInputProps {
  readonly value: string;
  readonly onSubmit: (value: string) => void;
  /** 저장 위치 미정이라 선택이다 (CR-019, DEV-079). */
  readonly recentQueries?: readonly string[];
  /** 해석·조회가 진행 중인가. */
  readonly busy?: boolean;
  /** 결과 건수를 알린다 (C-010 접근성: `aria-live="polite"`). */
  readonly resultAnnouncement?: string;
}

export function OmniSearchInput({
  value,
  onSubmit,
  recentQueries = [],
  busy = false,
  resultAnnouncement,
}: OmniSearchInputProps): ReactNode {
  const [draft, setDraft] = useState(value);
  const inputId = useId();
  const errorId = useId();

  // URL이 단일 진실이므로 바깥이 바뀌면 입력도 따라간다 — 뒤로가기가 성립한다.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const tooShort = isTooShortShaPrefix(draft);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    // **너무 짧으면 제출 자체를 하지 않는다.** 서버 호출이 없어야 한다.
    if (tooShort) return;
    onSubmit(draft);
  }

  return (
    <form onSubmit={handleSubmit} role="search" aria-label="통합 검색">
      <TextField
        id={inputId}
        /*
         * 이름을 `aria-label`로 준다.
         *
         * 처음에는 시각적으로 숨긴 `<label for>`를 썼다. axe는 통과했지만
         * **Conductor가 경고했다** — 이 디자인 시스템은 `Field`·`aria-label`·
         * `aria-labelledby` 셋만 이름으로 인정한다. 검색 바에는 눈에 보이는
         * 라벨을 두지 않으므로(`Field`는 라벨을 그린다) `aria-label`이 맞다.
         */
        aria-label="커밋 SHA, PR 번호, URL 또는 질의"
        // `searchbox`는 명세가 지정한 역할이다 (C-010 접근성).
        role="searchbox"
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        invalid={tooShort}
        aria-invalid={tooShort}
        aria-describedby={tooShort ? errorId : undefined}
        placeholder="SHA, #1234, owner/repo#1234, GHE URL 또는 repo:acme/a author:kim"
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        {...(recentQueries.length === 0 ? {} : { list: `${inputId}-recent` })}
      />

      {recentQueries.length === 0 ? null : (
        <datalist id={`${inputId}-recent`} data-testid="recent-queries">
          {recentQueries.map((q) => (
            <option key={q} value={q} />
          ))}
        </datalist>
      )}

      <Button type="submit" variant="primary" loading={busy} disabled={tooShort}>
        검색
      </Button>

      {/*
       * 클라이언트 즉시 안내 (QA-W001-04). `role="alert"`로 즉시 읽힌다 —
       * 제출이 막힌 이유를 사용자가 바로 알아야 한다.
       */}
      {tooShort ? (
        <p id={errorId} role="alert" data-testid="prefix-too-short">
          축약 SHA는 최소 {MIN_SHA_PREFIX_LENGTH}자가 필요합니다. {draft.trim().length}자를
          입력했습니다 — 검색을 실행하지 않았습니다.
        </p>
      ) : null}

      {/* 건수 알림. 결과가 바뀔 때만 문구가 생긴다 (C-010 접근성). */}
      <p aria-live="polite" data-testid="result-announcement" className="cdt-sr-only">
        {resultAnnouncement ?? ''}
      </p>
    </form>
  );
}
