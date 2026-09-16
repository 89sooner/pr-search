'use client';

/**
 * `/search`의 M 해석 진입 (WP-074 / FR-SEQ-008, CR-079 — 상세 설계 9절).
 *
 * ## 새 화면이 아니다
 *
 * IA는 화면을 늘리지 않는다 (CR-079). M 배지 링크와 복사한 URL이 기존 `/search`에
 * 네 query key(`m_repository`·`m_base_branch`·`m_seq_epoch`·`m_number`)를 싣고
 * 오면, 이 컴포넌트가 BFF `/api/merge-numbers/resolve`를 **정확히 1회** 부르고
 * `assigned`면 기존 W-002 경로로 옮긴다. 일반 질의 문법에 M 토큰을 더하지 않는다.
 *
 * ## 이동은 `replace`다
 *
 * 이 진입은 목적지가 아니라 **경유지**다. `push`로 옮기면 뒤로가기가 이 경유지로
 * 돌아오고, 그 순간 다시 해석해 다시 앞으로 튕겨 나간다 — DEV-097이 잡았던
 * 바로 그 덫이다. `replace`면 뒤로가기가 사용자가 M 링크를 누른 화면으로 간다.
 *
 * ## 서버가 판정한다
 *
 * 값의 형식(에폭이 정수인가, 표기가 맞는가)은 여기서 보지 않는다. 화면이 먼저
 * 접으면 서버가 거절할 기회를 잃는다 (`seq_epoch`과 같은 규칙, PR #64 P1).
 * **일부 키만 있을 때만** 클라이언트가 막는다 — 임의 branch/epoch로 메우면
 * 사용자가 묻지 않은 공간의 답이 나온다 (API-SEQ-007이 그것을 금한다).
 */

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button } from './ui';
import { ErrorBanner } from './ErrorBanner';
import { EmptyState } from './EmptyState';
import {
  MERGE_NUMBER_PARAM,
  judgeMergeNumberResolve,
  mergeNumberEntryHref,
  mergeNumberResolveUrl,
  type MergeNumberEntry as Entry,
  type MergeNumberResolveOutcome,
} from '../lib/merge-number';
import { withFromQuery } from '../lib/query-url';

export interface MergeNumberEntryProps {
  readonly entry: Exclude<Entry, { kind: 'absent' }>;
  /**
   * 함께 온 원래 `q`. 있으면 상세로 갈 때 `from_q`로 보존한다 — 상세의
   * "검색으로 돌아가기"가 그 질의를 되살린다 (DEV-078).
   */
  readonly fromQuery: string;
  readonly loginPath: string;
}

type Phase =
  | { readonly kind: 'resolving' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'done'; readonly outcome: MergeNumberResolveOutcome };

const KEY_LABEL: Readonly<Record<string, string>> = {
  [MERGE_NUMBER_PARAM.repository]: "Repository",
  [MERGE_NUMBER_PARAM.baseBranch]: "Base branch",
  [MERGE_NUMBER_PARAM.seqEpoch]: "Sequence epoch",
  [MERGE_NUMBER_PARAM.number]: "M number",
};

export function MergeNumberEntry({ entry, fromQuery, loginPath }: MergeNumberEntryProps): ReactNode {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'resolving' });
  const generation = useRef(0);

  // 네 값이 곧 요청의 정체성이다. 같은 값이면 다시 부르지 않는다.
  const entryKey =
    entry.kind === 'complete' ? JSON.stringify([entry.repository, entry.baseBranch, entry.seqEpoch, entry.number]) : null;

  useEffect(() => {
    if (entry.kind !== 'complete') return;
    const mine = ++generation.current;
    const controller = new AbortController();
    setPhase({ kind: 'resolving' });

    void (async () => {
      try {
        const response = await fetch(mergeNumberResolveUrl(entry), { signal: controller.signal, cache: 'no-store' });
        const body: unknown = await response.json().catch(() => null);
        if (mine !== generation.current) return;
        setPhase({ kind: 'done', outcome: judgeMergeNumberResolve(response.status, body, entry.repository) });
      } catch {
        if (controller.signal.aborted || mine !== generation.current) return;
        setPhase({ kind: 'offline' });
      }
    })();

    return () => {
      controller.abort();
    };
    // `entryKey`가 네 값을 대표한다 — `entry` 객체 정체성이 바뀌어도 값이 같으면 다시 부르지 않는다.
  }, [entryKey]);

  const assignedHref =
    phase.kind === 'done' && phase.outcome.kind === 'assigned' ? withFromQuery(phase.outcome.href, fromQuery) : null;

  /*
   * 이동은 효과에서 한다 — 렌더 중 `router.replace`는 React가 경고하고
   * StrictMode에서 두 번 나간다. 링크 카드는 함께 그린다: 이동이 막히면
   * 사용자가 손으로 누를 길이 남아야 한다 (W-001 `resolved_single`과 같다).
   */
  useEffect(() => {
    if (assignedHref === null) return;
    router.replace(assignedHref);
  }, [assignedHref, router]);

  const searchLink = (
    <Link href="/search" data-testid="mnumber-entry-search-link">
      Go to search
    </Link>
  );

  if (entry.kind === 'duplicated') {
    return (
      <div data-testid="mnumber-entry" data-entry-state="duplicated">
        <Banner tone="warning" title="The M-number link contains duplicate values">
          <p data-testid="mnumber-entry-duplicated">
            {entry.keys.map((key) => `${KEY_LABEL[key] ?? key}(${key})`).join(', ')} appears more than once. The intended value is ambiguous, so the link was not resolved. Copy the link again from the badge.
          </p>
          {searchLink}
        </Banner>
      </div>
    );
  }

  if (entry.kind === 'partial') {
    return (
      <div data-testid="mnumber-entry" data-entry-state="partial">
        <Banner tone="warning" title="The M-number link is incomplete">
          <p data-testid="mnumber-entry-missing">
            Resolving an M number requires a repository, base branch, sequence epoch, and M number. Missing: {' '}
            {entry.missing.map((key) => `${KEY_LABEL[key] ?? key}(${key})`).join(', ')}. Missing values cannot be inferred. Copy the link again from the badge.
          </p>
          {searchLink}
        </Banner>
      </div>
    );
  }

  const citation = `${entry.number} · ${entry.repository}@${entry.baseBranch} · Epoch ${entry.seqEpoch}`;

  if (phase.kind === 'resolving') {
    return (
      <div data-testid="mnumber-entry" data-entry-state="resolving" aria-busy="true">
        <p>
          <span className="ui-mono">{citation}</span> is being resolved…
        </p>
      </div>
    );
  }

  if (phase.kind === 'offline') {
    return (
      <div data-testid="mnumber-entry" data-entry-state="offline">
        <ErrorBanner
          tone="danger"
          title="Unable to connect to the server"
          impact="Check your network connection and try again."
          recoverable
          action={
            <Button
              variant="secondary"
              onClick={() => {
                window.location.reload();
              }}
            >
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const { outcome } = phase;
  switch (outcome.kind) {
    case 'assigned':
      return (
        <div data-testid="mnumber-entry" data-entry-state="assigned">
          <p>
            <span className="ui-mono">{outcome.mergeNumber}</span> resolves to PR #{outcome.prNumber}. Opening details…
          </p>
          {assignedHref === null ? null : (
            <Link href={assignedHref} data-testid="mnumber-entry-target">
              {entry.repository} #{outcome.prNumber} Open
            </Link>
          )}
        </div>
      );

    case 'pending':
      return (
        <div data-testid="mnumber-entry" data-entry-state="pending">
          <Banner tone="info" title="M number pending">
            <p>
              <span className="ui-mono">{citation}</span> has not received an M number. No provisional number is assigned.
            </p>
            {searchLink}
          </Banner>
        </div>
      );

    case 'epoch_stale':
      /*
       * 기존 무효 배너 규칙 (CR-051, ADR-007 규칙 5): 계산하지 않았음을 말하고
       * **자동으로 현재 에폭으로 옮기지 않는다.** 재채번 뒤 같은 번호가 다른
       * PR을 가리킬 수 있으므로 M 링크 복사도 만들지 않는다. 현재 에폭으로
       * 다시 해석하는 것은 사용자의 명시적 행위다.
       */
      return (
        <div data-testid="mnumber-entry" data-entry-state="epoch_stale">
          <Banner tone="warning" title="Sequence numbering has changed">
            <p data-testid="mnumber-epoch-stale-notice">
              This M-number reference uses <strong>{outcome.sequenceSpace ?? `${entry.repository}@${entry.baseBranch}`}</strong> sequence epoch {' '}
              {outcome.requestedEpoch ?? entry.seqEpoch}. The current epoch is {' '}
              {outcome.currentEpoch ?? "Unknown"}. History was rewritten, so the same M number may point to another PR. This reference was not resolved.
            </p>
            {outcome.currentEpoch === null ? null : (
              <Button
                variant="secondary"
                data-testid="mnumber-epoch-rebind"
                onClick={() => {
                  router.replace(
                    mergeNumberEntryHref({
                      repository: entry.repository,
                      baseBranch: entry.baseBranch,
                      seqEpoch: outcome.currentEpoch as number,
                      number: entry.number,
                    }),
                  );
                }}
              >
                Resolve using current epoch
              </Button>
            )}{' '}
            {searchLink}
          </Banner>
        </div>
      );

    case 'no_sequence':
      return (
        <div data-testid="mnumber-entry" data-entry-state="no_sequence">
          <Banner tone="info" title={noSequenceTitle(outcome.reason)}>
            <p data-testid="mnumber-no-sequence">
              <span className="ui-mono">{citation}</span> — {outcome.message}
            </p>
            {searchLink}
          </Banner>
        </div>
      );

    case 'feature_disabled':
      return (
        <div data-testid="mnumber-entry" data-entry-state="feature_disabled">
          <Banner tone="info" title="M numbers are disabled">
            <p data-testid="mnumber-feature-disabled">
              This deployment does not support M-number resolution. Search by PR number or commit SHA instead.
            </p>
            {searchLink}
          </Banner>
        </div>
      );

    case 'not_found':
      /* 미등록·권한 밖·없는 번호를 가르지 않는다 — 존재 여부를 드러내지 않는다 (THR-004). */
      return (
        <div data-testid="mnumber-entry" data-entry-state="not_found">
          <EmptyState
            cause="not_found"
            description={`${citation} has no matching PR. Check the repository, branch, and epoch.`}
            actions={searchLink}
          />
        </div>
      );

    case 'invalid':
      return (
        <div data-testid="mnumber-entry" data-entry-state="invalid">
          <ErrorBanner
            tone="warning"
            title="Cannot resolve M-number link"
            impact={`${outcome.message}${outcome.field === null ? '' : `(field:${outcome.field})`}`}
            action={searchLink}
          />
        </div>
      );

    case 'auth_expired':
      return (
        <div data-testid="mnumber-entry" data-entry-state="auth_expired">
          <ErrorBanner
            tone="warning"
            title="Your session has expired"
            impact="Sign in again to return to this page."
            action={
              <a
                href={`${outcome.loginPath ?? loginPath}?return_to=${encodeURIComponent(
                  mergeNumberEntryHref({
                    repository: entry.repository,
                    baseBranch: entry.baseBranch,
                    seqEpoch: entry.seqEpoch,
                    number: entry.number,
                  }),
                )}`}
              >
                Sign in again
              </a>
            }
          />
        </div>
      );

    case 'error':
      return (
        <div data-testid="mnumber-entry" data-entry-state="error">
          <ErrorBanner
            tone="danger"
            title="Unable to resolve M number"
            impact={outcome.message}
            recoverable={outcome.correlationId === null}
            correlationId={outcome.correlationId}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  window.location.reload();
                }}
              >
                Try again
              </Button>
            }
          />
        </div>
      );
  }
}

function noSequenceTitle(reason: string | null): string {
  switch (reason) {
    case 'not_merged':
      return "Not eligible for an M number";
    case 'branch_not_tracked':
      return "Branch not configured for numbering";
    case 'not_sequenced':
      return "Sequence numbering pending";
    default:
      return "No sequence available";
  }
}
