'use client';

/**
 * C-031 SafeMarkerCard — 안전 구간 표식 (WP-041 / FR-SEQ-006, W-004-MARKER).
 *
 * ## 이 카드가 정하지 않는 것
 *
 * **등록할 서수를 스스로 고르지 않는다.** `targetSeq`를 받으며 그것은 조사
 * 구간의 끝 앵커다 (CR-057, DEV-462). 숫자 입력창을 두면 사용자가 조사하지
 * 않은 구간을 표식할 수 있고, 화면이 방금 보여 준 결과와 저장되는 사실이
 * 갈린다.
 *
 * ## 무효한 표식을 감추지 않는다
 *
 * `marker.epoch_stale`이면 **그대로 보이되 무효로 표시한다** (AC-4). 감추면
 * "표식이 없다"로 읽히고, 현재 에폭의 같은 서수로 옮겨 읽으면 그 서수가
 * 다른 커밋을 가리킬 수 있다 (ADR-007). 옮기는 것은 언제나 사용자가 현재
 * 에폭으로 다시 등록하는 행위다.
 */

import { useId, useState, type ReactNode } from 'react';
import { Badge, Button, Card, TextArea } from './ui';
import {
  MARKER_NOTE_LIMIT,
  markerBlockedReason,
  markerCardState,
  type MarkerSubmitOutcome,
  type MarkerView,
} from '../lib/safe-marker';

export interface SafeMarkerCardProps {
  readonly marker: MarkerView | null;
  readonly canWrite: boolean;
  /** 등록 대상 서수. 끝 앵커가 아직 해석되지 않았으면 `null`이다. */
  readonly targetSeq: number | null;
  /** 그 공간의 현재 에폭. 저장된 에폭과 비교해 무효를 판정한 결과가 `marker.epoch_stale`이다. */
  readonly currentEpoch: number;
  readonly onSubmit: (note: string | null) => Promise<MarkerSubmitOutcome>;
}

function formatTime(iso: string): string {
  // 표시 시간대 변환은 클라이언트 책임이다 (API 계약 공통 원칙 8).
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
}

export function SafeMarkerCard({
  marker,
  canWrite,
  targetSeq,
  currentEpoch,
  onSubmit,
}: SafeMarkerCardProps): ReactNode {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MarkerSubmitOutcome | null>(null);
  const noteId = useId();
  const reasonId = useId();



  const state = markerCardState(marker);
  const blockedReason = markerBlockedReason(canWrite, targetSeq);

  const submit = async (): Promise<void> => {
    if (blockedReason !== null || busy) return;
    /*
     * **제출 전에 이전 결과를 지운다** (DEV-473, PR #103 리뷰 P2).
     *
     * 표식이 바뀌면 결과를 버리는 `useEffect`를 두었더니, `onSubmit`이
     * **결과를 돌려주기 전에 표식을 다시 읽으므로** 그 effect가 방금 설정한
     * 성공·충돌 메시지를 즉시 지웠다. 성공은 보통 서수·에폭·메모 중 하나를
     * 바꾸고 충돌은 남이 옮긴 표식을 실어 오므로 **실제 응답에서는 거의
     * 언제나 지워졌고**, 정적 스텁을 쓰는 시험만 그것을 보지 못했다.
     *
     * 지우는 시점을 제출 앞으로 옮기면 "이전 행동의 결과"와 "방금 행동의
     * 결과"가 섞이지 않으면서 피드백이 남는다.
     */
    setResult(null);
    setBusy(true);
    try {
      const outcome = await onSubmit(note.trim() === '' ? null : note);
      setResult(outcome);
      if (outcome.kind === 'created' || outcome.kind === 'unchanged') setNote('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card as="div" data-testid="safe-marker-card">
      <h3>Verified boundary</h3>

      {state === 'marker_absent' ? (
        <p data-testid="safe-marker-absent">
          No marker exists in this sequence space. Record a verified point to share it with your organization.
        </p>
      ) : marker === null ? null : (
        <dl data-testid="safe-marker-current">
          <dt>Sequence</dt>
          <dd data-testid="safe-marker-seq">seq {marker.merge_seq}</dd>
          <dt>Registered by</dt>
          <dd data-testid="safe-marker-author">{marker.created_by}</dd>
          <dt>Registered at</dt>
          <dd data-testid="safe-marker-time">{formatTime(marker.created_at)}</dd>
          <dt>Epoch</dt>
          <dd data-testid="safe-marker-epoch">{marker.seq_epoch}</dd>
          <dt>Note</dt>
          <dd data-testid="safe-marker-note">{marker.note ?? "(none)"}</dd>
        </dl>
      )}

      {/*
       * 무효를 **색만으로 말하지 않는다** — 배지 문구가 그 사실을 담고,
       * 그 옆 문장이 왜 무효인지와 무엇을 하면 되는지를 말한다.
       */}
      {state === 'marker_epoch_stale' && marker !== null ? (
        <p data-testid="safe-marker-stale" role="status">
          <Badge tone="warning">Invalid</Badge> This marker uses epoch {marker.seq_epoch} ; the current epoch is {' '}
          {currentEpoch}. The ordinal may refer to another commit, so the marker will not move automatically. Verify again before setting it in the current epoch.
        </p>
      ) : null}

      <label htmlFor={noteId}>
        Note (optional, {MARKER_NOTE_LIMIT} characters maximum)
      </label>
      <TextArea
        id={noteId}
        data-testid="safe-marker-note-input"
        value={note}
        maxLength={MARKER_NOTE_LIMIT}
        disabled={blockedReason !== null}
        onChange={(event) => setNote(event.target.value)}
      />
      <p data-testid="safe-marker-note-remaining">
        {MARKER_NOTE_LIMIT - note.length} characters remaining
      </p>

      {/*
       * `blockedReason`은 Conductor가 "막혔지만 이유가 있다"를 표현하는
       * 방식이다. 맨 `disabled`는 왜 눌리지 않는지 말해 주지 않는다.
       */}
      <Button
        data-testid="safe-marker-submit"
        variant="primary"
        loading={busy}
        aria-describedby={blockedReason === null ? undefined : reasonId}
        {...(blockedReason === null ? {} : { blockedReason })}
        onClick={() => void submit()}
      >
        {targetSeq === null ? "Set marker" : `seq ${targetSeq} as verified`}
      </Button>

      {blockedReason === null ? null : (
        <p id={reasonId} data-testid="safe-marker-blocked">
          {blockedReason}
        </p>
      )}

      {result === null ? null : (
        <p data-testid="safe-marker-result" role="alert">
          {result.kind === 'created'
            ? `Marker set to seq ${result.marker.merge_seq}.${
                result.replaced === null ? '' : ` The previous marker (seq ${result.replaced}) remains in history.`
              }`
            : result.kind === 'unchanged'
              ? "The same marker already exists. No changes were made."
              : result.kind === 'conflict'
                ? `Another user changed the marker: ${
                    result.currentSeq === null ? "deleted" : `seq ${result.currentSeq} is its new position`
                  }. Review the current value before trying again. This request will not retry automatically.`
                : result.kind === 'epoch_stale'
                  ? `While loading, the epoch changed to ${
                      result.currentEpoch ?? "a different value"
                    }. Reload using the current epoch before setting the marker.`
                  : result.message}
        </p>
      )}
    </Card>
  );
}
