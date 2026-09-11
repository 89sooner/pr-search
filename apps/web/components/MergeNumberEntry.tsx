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
import { Banner, Button } from '@conductor-by-89soone/react';
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
  [MERGE_NUMBER_PARAM.repository]: '저장소',
  [MERGE_NUMBER_PARAM.baseBranch]: '대상 브랜치',
  [MERGE_NUMBER_PARAM.seqEpoch]: '시퀀스 에폭',
  [MERGE_NUMBER_PARAM.number]: 'M 번호',
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
      검색으로 이동
    </Link>
  );

  if (entry.kind === 'partial') {
    return (
      <div data-testid="mnumber-entry" data-entry-state="partial">
        <Banner tone="warning" title="M 번호 링크가 불완전합니다">
          <p data-testid="mnumber-entry-missing">
            M 번호를 해석하려면 저장소·대상 브랜치·시퀀스 에폭·M 번호 넷이 모두 필요합니다. 이 링크에는{' '}
            {entry.missing.map((key) => `${KEY_LABEL[key] ?? key}(${key})`).join(', ')}이(가) 없습니다. 빠진 값을 임의로
            채우지 않습니다. 배지에서 링크를 다시 복사해 주세요.
          </p>
          {searchLink}
        </Banner>
      </div>
    );
  }

  const citation = `${entry.number} · ${entry.repository}@${entry.baseBranch} · 에폭 ${entry.seqEpoch}`;

  if (phase.kind === 'resolving') {
    return (
      <div data-testid="mnumber-entry" data-entry-state="resolving" aria-busy="true">
        <p>
          <span className="cdt-mono">{citation}</span>을(를) 해석하는 중…
        </p>
      </div>
    );
  }

  if (phase.kind === 'offline') {
    return (
      <div data-testid="mnumber-entry" data-entry-state="offline">
        <ErrorBanner
          tone="danger"
          title="서버에 연결하지 못했습니다"
          impact="네트워크 연결을 확인한 뒤 다시 시도하세요."
          recoverable
          action={
            <Button
              variant="secondary"
              onClick={() => {
                window.location.reload();
              }}
            >
              다시 시도
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
            <span className="cdt-mono">{outcome.mergeNumber}</span>은(는) PR #{outcome.prNumber}입니다. 상세로 이동합니다…
          </p>
          {assignedHref === null ? null : (
            <Link href={assignedHref} data-testid="mnumber-entry-target">
              {entry.repository} #{outcome.prNumber} 열기
            </Link>
          )}
        </div>
      );

    case 'pending':
      return (
        <div data-testid="mnumber-entry" data-entry-state="pending">
          <Banner tone="info" title="M 번호 대기">
            <p>
              <span className="cdt-mono">{citation}</span>은(는) 아직 M 번호가 부여되지 않았습니다. 잠정 번호를 만들지 않습니다.
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
          <Banner tone="warning" title="시퀀스 번호의 의미가 바뀌었습니다">
            <p data-testid="mnumber-epoch-stale-notice">
              이 M 번호 인용은 <strong>{outcome.sequenceSpace ?? `${entry.repository}@${entry.baseBranch}`}</strong>의 시퀀스 에폭{' '}
              {outcome.requestedEpoch ?? entry.seqEpoch}을 기준으로 만들어졌습니다. 현재 에폭은{' '}
              {outcome.currentEpoch ?? '알 수 없음'}입니다. 히스토리가 재작성되어 같은 M 번호가 다른 PR을 가리킬 수 있으므로
              해석하지 않았습니다.
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
                현재 에폭으로 다시 해석
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
              <span className="cdt-mono">{citation}</span> — {outcome.message}
            </p>
            {searchLink}
          </Banner>
        </div>
      );

    case 'feature_disabled':
      return (
        <div data-testid="mnumber-entry" data-entry-state="feature_disabled">
          <Banner tone="info" title="M 번호 기능이 꺼져 있습니다">
            <p data-testid="mnumber-feature-disabled">
              이 배포에서는 M 번호 해석을 제공하지 않습니다. 기존 검색으로 PR 번호나 커밋 SHA를 조회할 수 있습니다.
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
            description={`${citation}에 해당하는 PR을 찾을 수 없습니다. 저장소·브랜치·에폭이 정확한지 확인하세요.`}
            actions={searchLink}
          />
        </div>
      );

    case 'invalid':
      return (
        <div data-testid="mnumber-entry" data-entry-state="invalid">
          <ErrorBanner
            tone="warning"
            title="M 번호 링크를 해석할 수 없습니다"
            impact={`${outcome.message}${outcome.field === null ? '' : ` (필드: ${outcome.field})`}`}
            action={searchLink}
          />
        </div>
      );

    case 'auth_expired':
      return (
        <div data-testid="mnumber-entry" data-entry-state="auth_expired">
          <ErrorBanner
            tone="warning"
            title="세션이 만료되었습니다"
            impact="다시 로그인하면 보던 화면으로 돌아옵니다."
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
                다시 로그인
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
            title="M 번호를 해석하지 못했습니다"
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
                다시 시도
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
      return 'M 번호 대상 아님';
    case 'branch_not_tracked':
      return '채번 비대상 브랜치';
    case 'not_sequenced':
      return '시퀀스 채번 대기';
    default:
      return '시퀀스가 없습니다';
  }
}
