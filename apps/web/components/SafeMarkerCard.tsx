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
import { Badge, Button, Card, TextArea } from '@conductor-by-89soone/react';
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
      <h3>안전 구간 표식</h3>

      {state === 'marker_absent' ? (
        <p data-testid="safe-marker-absent">
          이 시퀀스 공간에는 아직 표식이 없습니다. 검증을 마친 지점을 기록하면 조직이 그것을 공유합니다.
        </p>
      ) : marker === null ? null : (
        <dl data-testid="safe-marker-current">
          <dt>시퀀스</dt>
          <dd data-testid="safe-marker-seq">seq {marker.merge_seq}</dd>
          <dt>등록자</dt>
          <dd data-testid="safe-marker-author">{marker.created_by}</dd>
          <dt>등록 시각</dt>
          <dd data-testid="safe-marker-time">{formatTime(marker.created_at)}</dd>
          <dt>에폭</dt>
          <dd data-testid="safe-marker-epoch">{marker.seq_epoch}</dd>
          <dt>메모</dt>
          <dd data-testid="safe-marker-note">{marker.note ?? '(없음)'}</dd>
        </dl>
      )}

      {/*
       * 무효를 **색만으로 말하지 않는다** — 배지 문구가 그 사실을 담고,
       * 그 옆 문장이 왜 무효인지와 무엇을 하면 되는지를 말한다.
       */}
      {state === 'marker_epoch_stale' && marker !== null ? (
        <p data-testid="safe-marker-stale" role="status">
          <Badge tone="warning">무효</Badge> 이 표식은 에폭 {marker.seq_epoch} 기준이고 현재 에폭은{' '}
          {currentEpoch}입니다. 그 서수가 다른 커밋을 가리킬 수 있어 자동으로 옮기지 않습니다 — 검증을
          다시 마친 뒤 현재 에폭으로 등록하세요.
        </p>
      ) : null}

      <label htmlFor={noteId}>
        메모 (선택, {MARKER_NOTE_LIMIT}자 이내)
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
        {MARKER_NOTE_LIMIT - note.length}자 남음
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
        {targetSeq === null ? '표식 등록' : `seq ${targetSeq}까지 안전으로 표시`}
      </Button>

      {blockedReason === null ? null : (
        <p id={reasonId} data-testid="safe-marker-blocked">
          {blockedReason}
        </p>
      )}

      {result === null ? null : (
        <p data-testid="safe-marker-result" role="alert">
          {result.kind === 'created'
            ? `표식을 seq ${result.marker.merge_seq}로 등록했습니다.${
                result.replaced === null ? '' : ` 이전 표식(seq ${result.replaced})은 이력으로 남았습니다.`
              }`
            : result.kind === 'unchanged'
              ? '이미 같은 표식이 등록되어 있어 아무것도 바꾸지 않았습니다.'
              : result.kind === 'conflict'
                ? `그 사이 다른 사람이 표식을 ${
                    result.currentSeq === null ? '지웠습니다' : `seq ${result.currentSeq}로 옮겼습니다`
                  }. 현재 값을 확인한 뒤 다시 결정하세요 — 자동으로 다시 보내지 않습니다.`
                : result.kind === 'epoch_stale'
                  ? `조회하는 사이에 에폭이 ${
                      result.currentEpoch ?? '다른 값'
                    }으로 바뀌었습니다. 현재 에폭으로 다시 조회한 뒤 등록하세요.`
                  : result.message}
        </p>
      )}
    </Card>
  );
}
