'use client';

import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';
import { Button, IconButton } from '@conductor-by-89soone/react';
import { ResultTable, resultIdentity, resultName, type ResultTableProps } from './ResultTable';
import { SequenceBadge } from './SequenceBadge';
import { RelationBadgeGroup } from './RelationBadgeGroup';
import { WorkbenchIcon } from './WorkbenchIcon';
import { formatTimestamp } from '../lib/format';
import { withFromQuery } from '../lib/query-url';

/** WP-073 / FR-SRCH-006·008: 현재 목록 안에서만 선택한다. 행별 API 요청은 없다. */
export function ResultWorkbench(props: ResultTableProps & { readonly fromQuery: string }): ReactNode {
  const { rows, fromQuery } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const copyGeneration = useRef(0);
  const selected = rows.find((row) => resultIdentity(row) === selectedId) ?? null;
  const selectedIndex = selected === null ? -1 : rows.indexOf(selected);

  function select(id: string | null): void {
    ++copyGeneration.current;
    setCopyStatus('');
    setSelectedId(id);
  }

  function close(): void {
    const target = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[data-result-select]') ?? [])
      .find((button) => button.dataset['resultSelect'] === selectedId);
    select(null);
    target?.focus({ preventScroll: true });
  }

  const href = selected === null ? null : withFromQuery(selected.url, fromQuery);

  return (
    <div className="prs-result-workbench" ref={root} data-preview-open={selected !== null ? '' : undefined}>
      <ResultTable {...props} selectedId={selectedId} onSelect={select} />
      {selected === null ? null : (
        <section className="prs-result-preview" aria-label="선택한 결과 미리보기"
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
          <div className="prs-preview-toolbar">
            <div><WorkbenchIcon name="preview" /><strong>선택한 변경</strong><span>{selectedIndex + 1} / {rows.length}</span></div>
            <IconButton icon={<WorkbenchIcon name="close" />} aria-label="미리보기 닫기" variant="ghost" size="sm" onClick={close} />
          </div>
          <div className="prs-preview-content">
            <div className="prs-preview-heading">
              <p className="prs-mono">{selected.repository ?? '저장소 미상'} · {selected.kind === 'commit' ? selected.commit_sha ?? resultName(selected) : resultName(selected)}</p>
              <h2>{selected.title ?? resultName(selected)}</h2>
              <div className="prs-preview-actions">
                {href === null ? null : <Link href={href} className="prs-text-link">상세 보기<WorkbenchIcon name="arrow" /></Link>}
                <Button variant="ghost" size="sm" onClick={() => {
                  const mine = ++copyGeneration.current;
                  const value = selected.kind === 'commit' ? selected.commit_sha :
                    selected.repository == null || selected.pr_number == null ? null : `${selected.repository}#${selected.pr_number}`;
                  if (value == null) { setCopyStatus('복사할 식별자가 없습니다.'); return; }
                  if (navigator.clipboard === undefined) { setCopyStatus('클립보드를 사용할 수 없습니다. 위 식별자를 선택해 복사하세요.'); return; }
                  void navigator.clipboard.writeText(value).then(
                    () => { if (copyGeneration.current === mine) setCopyStatus('식별자를 복사했습니다.'); },
                    () => { if (copyGeneration.current === mine) setCopyStatus('복사하지 못했습니다. 위 식별자를 선택해 복사하세요.'); },
                  );
                }}><WorkbenchIcon name="copy" />식별자 복사</Button>
                <span role="status">{copyStatus}</span>
              </div>
            </div>
            <dl className="prs-preview-facts">
              <div><dt>작성자</dt><dd>{selected.author ?? '—'}</dd></div>
              <div><dt>머지 시각</dt><dd>{formatTimestamp(selected.merged_at)}</dd></div>
              <div><dt>시퀀스 · 공간</dt><dd><SequenceBadge merge_seq={selected.merge_seq} seq_epoch={selected.seq_epoch} sequence_space={selected.sequence_space} state={selected.state} /><span className="prs-preview-space prs-mono">{selected.sequence_space ?? '시퀀스 공간 미확인'}</span></dd></div>
              <div><dt>변경 규모</dt><dd>{selected.changed_files_count == null ? '파일 수 미확인' : `${selected.changed_files_count}개 파일`}<span className="prs-diff-added"> {selected.additions == null ? '—' : `+${selected.additions}`}</span><span className="prs-diff-deleted"> {selected.deletions == null ? '—' : `−${selected.deletions}`}</span></dd></div>
            </dl>
          </div>
          <div className="prs-preview-relations"><span>관계</span><RelationBadgeGroup summary={selected.link_summary ?? null} />{selected.link_summary == null ? <span>관계 요약 미확인 · 상세에서 확인</span> : null}</div>
        </section>
      )}
    </div>
  );
}
