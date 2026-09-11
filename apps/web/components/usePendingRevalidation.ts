'use client';

/**
 * M 번호 pending 자동 재검증 (WP-074 / FR-SEQ-008, 상세 설계 9절).
 *
 * ## 행별 poll이 아니다
 *
 * 이 훅은 **요청을 만들지 않는다.** 5초마다 `onRevalidate`를 한 번 부를 뿐이고,
 * 그것이 무엇을 다시 보내는지는 화면이 정한다 — 화면은 **지금 보고 있는 목록/
 * 상세 요청 하나**(같은 커서·같은 `from_q`)를 그대로 다시 보낸다. 행마다
 * resolve를 부르면 목록 한 화면이 N번의 왕복이 되고, 그것은 ADR-023이 막는다.
 *
 * ## 멈추는 조건
 *
 * - `pending`이 사라지면 (번호가 붙었으면) 곧바로
 * - 60초가 지나면 — `exhausted`를 세워 화면이 수동 새로고침을 제시한다
 * - 탭이 숨겨지면 타이머를 멈추고, 다시 보이면 (마감 전이면) 잇는다
 * - `enabled`가 `false`가 되면 — 401·epoch_stale·오류는 화면이 이 값으로 전한다
 * - 언마운트
 *
 * ## 겹치지 않는다
 *
 * 직전 요청이 돌아오지 않았으면(`inFlight`) 그 tick은 건너뛴다. 느린 서버에서
 * 요청이 쌓이면 뒤늦은 응답이 앞 응답을 덮어 화면이 과거로 돌아간다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MERGE_NUMBER_POLL_INTERVAL_MS, revalidationDecision } from '../lib/merge-number';

export interface PendingRevalidationOptions {
  /**
   * 재검증 대상 요청의 정체성 (질의·커서·공간 등). 바뀌면 60초 창을 새로 연다 —
   * 다른 목록의 남은 시간을 물려받지 않는다.
   */
  readonly sessionKey: string;
  /** 보이는 목록/상세에 `pending`이 있는가. */
  readonly pending: boolean;
  /** 화면이 결과를 보이고 있는가. 오류·낡은 에폭·인증 만료면 `false`다. */
  readonly enabled: boolean;
  /** 직전 재검증 요청이 아직 돌아오지 않았는가. */
  readonly inFlight: boolean;
  /** 같은 요청을 한 번 다시 보낸다. */
  readonly onRevalidate: () => void;
}

export interface PendingRevalidation {
  /** 60초가 지나 멈췄다. 화면이 수동 새로고침을 제시한다. */
  readonly exhausted: boolean;
  /** 수동 새로고침 뒤 60초 창을 다시 연다. */
  readonly restart: () => void;
}

export function usePendingRevalidation(options: PendingRevalidationOptions): PendingRevalidation {
  const { sessionKey, pending, enabled } = options;
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [exhausted, setExhausted] = useState(false);

  /*
   * 최신 값을 ref로 읽는다 — 콜백과 진행 여부는 렌더마다 바뀌는데, 그때마다
   * 타이머를 다시 세우면 tick이 밀려 5초 간격이 지켜지지 않는다.
   */
  const latest = useRef(options);
  latest.current = options;

  // 다른 요청이 되면 창을 새로 연다.
  useEffect(() => {
    setStartedAt(null);
    setExhausted(false);
  }, [sessionKey]);

  /*
   * pending이 사라지면 창을 닫고 **소진 표시도 함께 지운다** (DEV-609).
   *
   * 60초를 다 쓴 뒤 사용자가 수동으로 새로고침하거나 다른 경로로 번호가 붙으면
   * 대기가 끝난 것이다. 그런데 `exhausted`를 남겨 두면 **번호가 보이는 화면 옆에
   * "아직 확정되지 않았습니다" 배너가 그대로 서 있다** — 화면이 두 가지를 동시에
   * 말한다. 그리고 다음 pending이 오면 `active`가 `!exhausted`에 막혀 재검증이
   * 아예 시작되지 않는다.
   *
   * 대기가 끝났다는 사실이 곧 그 표시를 지울 근거다.
   */
  useEffect(() => {
    if (pending) return;
    setStartedAt(null);
    setExhausted(false);
  }, [pending]);

  const active = pending && enabled && !exhausted;

  useEffect(() => {
    if (!active) return;
    setStartedAt((current) => current ?? Date.now());
  }, [active]);

  useEffect(() => {
    if (!active || startedAt === null) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = (): void => {
      const decision = revalidationDecision({
        pending: latest.current.pending,
        enabled: latest.current.enabled,
        hidden: typeof document !== 'undefined' && document.hidden,
        inFlight: latest.current.inFlight,
        startedAt,
        now: Date.now(),
      });
      if (decision === 'stop_deadline') {
        stop();
        setExhausted(true);
        return;
      }
      if (decision === 'revalidate') latest.current.onRevalidate();
    };

    const start = (): void => {
      if (timer !== null) return;
      timer = setInterval(tick, MERGE_NUMBER_POLL_INTERVAL_MS);
    };
    const stop = (): void => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    /*
     * 숨은 탭은 타이머 자체를 멈춘다. 브라우저가 숨은 탭의 타이머를 늦추는
     * 것과 별개로, **보이지 않는 화면을 위해 요청을 보내지 않는다.** 다시
     * 보이면 마감 전일 때만 잇는다 — 마감 판정은 다음 tick이 한다.
     */
    const onVisibility = (): void => {
      if (document.hidden) stop();
      else start();
    };

    if (typeof document === 'undefined' || !document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, startedAt]);

  const restart = useCallback(() => {
    setExhausted(false);
    setStartedAt(Date.now());
  }, []);

  return { exhausted, restart };
}
