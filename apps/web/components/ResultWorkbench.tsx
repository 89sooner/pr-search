'use client';

/**
 * W-001 결과 작업대 — 목록과 선택한 결과의 미리보기 (WP-073 / FR-SRCH-006·008 · CR-093).
 *
 * ## 선택은 현재 목록 안에서만 일어난다
 *
 * 행별 API 요청은 없다. 미리보기가 보여 주는 것은 목록 응답이 이미 실어 온 값이다 (ADR-009).
 *
 * ## 배치와 닫기는 Conductor 0.4.1이 맡는다
 *
 * `WorkbenchLayout`이 목록과 미리보기를 좌우로 가르고(폭 25~60%, 좁은 화면에서는 세로로
 * 쌓는다), `DetailInspector`가 닫기 버튼·Escape·닫힌 뒤의 포커스 복귀를 한다. 0.3.1에서
 * 제품이 직접 하던 것(표 아래 붙는 미리보기, Escape 처리, 선택 버튼을 다시 찾는 DOM 탐색,
 * 클립보드 쓰기와 그 알림)은 그래서 사라졌다.
 *
 * ## 복귀 대상은 지금 선택된 행의 버튼이다
 *
 * 키보드로 행을 옮겨 다니면 선택이 바뀌고, 닫을 때는 **마지막으로 선택한 행**으로
 * 돌아가야 한다. 그래서 `ResultTable`이 선택마다 그 버튼을 넘겨 주고 여기서 ref에 담는다.
 * `onClose`에서 ref를 비우지 않는다 — `DetailInspector`는 `onClose` **뒤에** ref를 읽는다.
 */

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CopyButton, DetailInspector, WorkbenchLayout } from './ui';
import { ResultTable, resultIdentity, resultName, type ResultTableProps } from './ResultTable';
import { SequenceBadge } from './SequenceBadge';
import { RelationBadgeGroup } from './RelationBadgeGroup';
import { WorkbenchIcon } from './WorkbenchIcon';
import { formatTimestamp } from '../lib/format';
import { withFromQuery } from '../lib/query-url';
import { summaryBadges } from '../lib/relations';

/** 미리보기 폭의 기본값(%). `WorkbenchLayout`이 25~60으로 묶는다. 세션 상태이며 URL에 싣지 않는다. */
const DEFAULT_INSPECTOR_WIDTH = 38;

export function ResultWorkbench(props: ResultTableProps & { readonly fromQuery: string }): ReactNode {
  const { rows, fromQuery } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorWidth, setInspectorWidth] = useState(DEFAULT_INSPECTOR_WIDTH);
  const returnFocus = useRef<HTMLElement | null>(null);
  const inspector = useRef<HTMLElement | null>(null);
  const selected = rows.find((row) => resultIdentity(row) === selectedId) ?? null;
  const selectedIndex = selected === null ? -1 : rows.indexOf(selected);

  function select(id: string | null, trigger?: HTMLElement): void {
    setSelectedId(id);
    if (trigger !== undefined) returnFocus.current = trigger;
  }

  const href = selected === null ? null : withFromQuery(selected.url, fromQuery);
  /*
   * 관계 요약의 세 가지 사실을 가른다 (QA-W001-24): 요약이 아직 없다(`null`) · 확인했고 관계가 없다(빈 목록) ·
   * 관계가 있다. 표는 앞의 둘에 아무것도 그리지 않지만, 미리보기는 사용자가 그 행을 골라 들여다보는 자리라
   * 「없다」와 「모른다」를 글로 적는다.
   */
  const relationBadges = selected === null ? null : summaryBadges(selected.link_summary ?? null);
  /** 복사할 식별자. 커밋은 전체 SHA, PR은 `owner/repo#번호`다. 둘 다 못 만들면 `null`이다. */
  const identifier = selected === null ? null
    : selected.kind === 'commit' ? (selected.commit_sha ?? null)
    : selected.repository == null || selected.pr_number == null ? null
    : `${selected.repository}#${String(selected.pr_number)}`;
  useEffect(() => {
    if (selectedId !== null && window.matchMedia('(max-width: 700px)').matches) inspector.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [selectedId]);

  return (
    <WorkbenchLayout
      className="prs-result-workbench"
      width={inspectorWidth}
      onWidthChange={setInspectorWidth}
      inspector={selected === null ? null : (
        <DetailInspector
          ref={inspector}
          className="prs-result-preview"
          data-testid="result-preview"
          label="Selected result preview"
          returnFocusRef={returnFocus}
          onClose={() => {
            setSelectedId(null);
          }}
        >
          <p className="prs-preview-position">{selectedIndex + 1} / {rows.length}</p>
          <p className="prs-preview-identity prs-mono">
            {selected.repository ?? "Unknown repository"} · {selected.kind === 'commit' ? (selected.commit_sha ?? resultName(selected)) : resultName(selected)}
          </p>
          <h3 className="prs-preview-title">{selected.title ?? resultName(selected)}</h3>
          <div className="prs-preview-actions">
            {href === null ? null : <Link href={href} className="prs-text-link">View details <WorkbenchIcon name="arrow" /></Link>}
            {identifier === null
              ? <span role="status">No identifier available to copy.</span>
              : <CopyButton value={identifier} label="Copy identifier" />}
          </div>
          <dl className="prs-preview-facts">
            <div><dt>Author</dt><dd>{selected.author ?? '—'}</dd></div>
            <div><dt>Merged at</dt><dd>{formatTimestamp(selected.merged_at)}</dd></div>
            <div>
              <dt>Sequence · space</dt>
              <dd>
                <SequenceBadge merge_seq={selected.merge_seq} seq_epoch={selected.seq_epoch} sequence_space={selected.sequence_space} state={selected.state} />
                <span className="prs-preview-space prs-mono">{selected.sequence_space ?? "Sequence space unknown"}</span>
              </dd>
            </div>
            <div>
              <dt>Change size</dt>
              <dd>
                {selected.changed_files_count == null ? "File count unknown" : `${String(selected.changed_files_count)} files`}
                <span className="prs-diff-added"> {selected.additions == null ? '—' : `+${String(selected.additions)}`}</span>
                <span className="prs-diff-deleted"> {selected.deletions == null ? '—' : `−${String(selected.deletions)}`}</span>
              </dd>
            </div>
          </dl>
          <div className="prs-preview-relations" data-testid="preview-relations">
            <span>Relationships</span>
            {relationBadges === null
              ? <span>Relationship summary unavailable · View details</span>
              : relationBadges.length === 0
                ? <span>No confirmed relationships</span>
                : <RelationBadgeGroup summary={selected.link_summary ?? null} />}
          </div>
        </DetailInspector>
      )}
    >
      <ResultTable {...props} selectedId={selectedId} onSelect={select} />
    </WorkbenchLayout>
  );
}
