'use client';

/**
 * C-047 IntegrityReportCard — A-003의 정합성 점검과 재채번 (WP-040 / FR-ADMIN-003,
 * FR-SEQ-005, FLOW-008, CR-055).
 *
 * ## 확인 전에는 요청이 나가지 않는다 (QA-A003-10)
 *
 * 재채번은 **비가역**이며 기존 범위 인용을 전부 무효화한다. 그래서 확인
 * 다이얼로그가 영향 범위를 보이고 저장소 이름 직접 입력을 요구한다.
 * **버튼을 비활성으로 두는 것으로는 부족하다** — 증명해야 하는 것은 "확인
 * 전에 서버로 요청이 한 번도 나가지 않았다"이고, 그것은 네트워크 호출 수로만
 * 잴 수 있다. 이 컴포넌트는 `onReassign`을 확인이 끝난 뒤에만 부른다.
 *
 * ## 영향 범위를 화면이 계산하지 않는다
 *
 * 무효화되는 안전 구간 표식 수, 영향받는 저장된 검색 수, 대상 커밋 수는
 * 서버가 산출해 준다. 화면이 다시 세면 두 수가 갈라지고, **작은 쪽이 보이면
 * 운영자가 영향을 과소평가한다.**
 *
 * ## 확인 문자열을 관대하게 비교하지 않는다
 *
 * `trim`도 대소문자 무시도 하지 않는다 (`reassignConfirmed`). 확인의 목적은
 * 사용자가 대상을 **정확히** 안다는 증명이고, 관대한 비교는 그 증명을 약하게
 * 만든다. 서버도 같은 판정을 하며 화면이 그것을 흉내 내는 것이 아니라 먼저 막는다.
 */

import { useState, type ReactNode } from 'react';
import { Button, Card, CodeBlock, Dialog, Field, TextField } from '@conductor-by-89soone/react';
import { reassignConfirmed } from '../lib/ops-jobs';
import { formatTimestamp } from '../lib/format';

/** `API-ADM-007`이 내는 점검 결과 하나. */
export interface IntegrityReportView {
  readonly repository: string;
  readonly base_branch: string;
  readonly seq_epoch: number;
  readonly checked_at: string | null;
  readonly consistent: boolean;
  /** 최초 불일치 서수. 일치하면 `null`이다. */
  readonly first_mismatch_seq: number | null;
  readonly stored_sha: string | null;
  readonly actual_sha: string | null;
  readonly checked_count: number | null;
}

/** 재채번이 무엇을 무효화하는가. 서버가 산출한다. */
export interface ReassignImpactView {
  readonly affected_commit_count: number | null;
  readonly invalidated_safe_marker_count: number | null;
  readonly affected_saved_search_count: number | null;
}

export interface IntegrityReportCardProps {
  readonly report: IntegrityReportView;
  readonly impact?: ReassignImpactView | null;
  /** 확인이 끝난 뒤에만 불린다. 여기서 처음으로 서버 요청이 나간다. */
  readonly onReassign: (report: IntegrityReportView) => void;
  readonly submitting?: boolean;
}

function Count({ value }: { readonly value: number | null }): ReactNode {
  return value === null ? (
    <span data-testid="impact-unavailable">미확인</span>
  ) : (
    <>{value.toLocaleString('ko-KR')}</>
  );
}

export function IntegrityReportCard({
  report,
  impact = null,
  onReassign,
  submitting = false,
}: IntegrityReportCardProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  const confirmed = reassignConfirmed(typed, report.repository);

  return (
    <Card
      data-testid="integrity-report-card"
      data-repository={report.repository}
      data-branch={report.base_branch}
      data-consistent={report.consistent ? 'true' : 'false'}
    >
      <h3>
        {report.repository} <span data-testid="integrity-branch">{report.base_branch}</span>
      </h3>
      <p data-testid="integrity-epoch">
        에폭 {report.seq_epoch}
        {report.checked_at === null ? '' : ` · 점검 ${formatTimestamp(report.checked_at)}`}
        {report.checked_count === null ? '' : ` · 대조 ${report.checked_count.toLocaleString('ko-KR')}건`}
      </p>

      {report.consistent ? (
        <p data-testid="integrity-consistent">불일치가 없습니다. 저장된 서수가 커밋 그래프와 같습니다.</p>
      ) : (
        <div data-testid="integrity-mismatch">
          <p>
            최초 불일치 서수 <strong data-testid="integrity-first-mismatch">{report.first_mismatch_seq ?? '미확인'}</strong>
          </p>
          {/*
            **저장 SHA와 실제 SHA를 나란히 보인다** (AC-3). 하나만 보이면
            운영자가 무엇이 어떻게 어긋났는지 알 수 없다.
          */}
          <CodeBlock
            data-testid="integrity-shas"
            code={`저장 ${report.stored_sha ?? '(없음)'}\n실제 ${report.actual_sha ?? '(없음)'}`}
          />

          <Button
            variant="primary"
            tone="danger"
            data-testid="integrity-reassign-open"
            onClick={() => {
              setTyped('');
              setOpen(true);
            }}
          >
            재채번 실행
          </Button>
        </div>
      )}

      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTyped('');
        }}
      >
        <Dialog.Content size="md" data-testid="reassign-dialog">
          <Dialog.Title>재채번은 되돌릴 수 없습니다</Dialog.Title>
          <Dialog.Description>
            {report.repository} {report.base_branch}의 에폭이 {report.seq_epoch}에서 {report.seq_epoch + 1}로 올라가고,
            이전 에폭을 인용한 범위는 모두 무효가 됩니다.
          </Dialog.Description>

          <ul data-testid="reassign-impact">
            <li>
              재채번 대상 커밋 <Count value={impact?.affected_commit_count ?? null} />건
            </li>
            <li>
              무효화되는 안전 구간 표식 <Count value={impact?.invalidated_safe_marker_count ?? null} />건
            </li>
            <li>
              영향받는 저장된 검색 <Count value={impact?.affected_saved_search_count ?? null} />건
            </li>
          </ul>

          <Field
            id="reassign-confirm"
            label="저장소 이름을 그대로 입력하세요"
            description={`정확히 "${report.repository}"여야 합니다. 공백과 대소문자도 같아야 합니다.`}
          >
            <TextField
              id="reassign-confirm"
              data-testid="reassign-confirm-input"
              value={typed}
              autoComplete="off"
              onChange={(event) => {
                setTyped(event.target.value);
              }}
            />
          </Field>

          <div>
            <Button
              variant="primary"
              tone="danger"
              disabled={!confirmed || submitting}
              data-testid="reassign-confirm-submit"
              onClick={() => {
                /*
                 * **여기가 첫 서버 요청이다.** 확인이 끝나지 않았으면 부르지
                 * 않는다 — `disabled`는 시각 신호일 뿐이고 실제 방어선은 이
                 * 조건이다.
                 */
                if (!confirmed || submitting) return;
                setOpen(false);
                onReassign(report);
              }}
            >
              {submitting ? '재채번 요청 중…' : '재채번 실행'}
            </Button>
            <Dialog.Close asChild>
              <Button variant="secondary" data-testid="reassign-cancel">
                취소
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </Card>
  );
}
