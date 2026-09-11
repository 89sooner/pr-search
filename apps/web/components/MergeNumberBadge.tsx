'use client';

/**
 * M 번호 배지 (WP-074 / FR-SEQ-008, CR-079 — C-014 확장).
 *
 * 판정은 전부 `lib/merge-number.ts`가 한다. 여기서는 그 결과를 그리기만 한다 —
 * `SequenceBadge`와 같은 분리다. 세 화면(W-001·W-002·W-004)이 이 컴포넌트 하나를
 * 쓴다.
 *
 * ## assigned는 진짜 링크다
 *
 * 표기 문자열은 `<a href>`로 `/search`의 M 해석 진입을 가리킨다. `onClick`으로
 * 이동하면 가운데 클릭·⌘클릭·"새 탭에서 열기"가 죽는다 — C-013이 제목 링크에
 * 세운 규칙과 같다. 링크는 네 값(`m_repository`·`m_base_branch`·`m_seq_epoch`·
 * `m_number`)을 전부 나른다.
 *
 * ## pending·unavailable에는 링크도 복사도 없다
 *
 * 아직 없는 번호를 가리키는 링크는 거짓이다. 그때는 배지와 설명만 그린다.
 *
 * ## 복사는 부모가 알린다
 *
 * 복사 결과는 **화면이 이미 가진 live region**으로 알려야 한다 (상세 설계 9절).
 * 배지가 자기 live region을 만들면 행마다 status 영역이 생겨 스크린 리더가
 * 같은 말을 여러 번 듣는다. 그래서 `onCopy`를 받는 부모가 클립보드 쓰기와
 * 알림을 소유하고, 배지는 버튼만 그린다. **식별자 복사(`repo#번호`)와 M 링크
 * 복사는 버튼 이름으로 구분한다.**
 */

import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { Badge, Button } from '@conductor-by-89soone/react';
import { WorkbenchIcon } from './WorkbenchIcon';
import {
  mergeNumberView,
  type MergeNumberContext,
  type MergeNumberFields,
  type MergeNumberLink,
} from '../lib/merge-number';

export interface MergeNumberBadgeProps {
  readonly fields: MergeNumberFields;
  readonly context: MergeNumberContext;
  /**
   * M 링크 복사. 주면 `assigned`에 「M 링크 복사」 버튼이 붙는다.
   * 클립보드 쓰기와 live region 알림은 부모가 한다.
   */
  readonly onCopy?: (link: MergeNumberLink) => void;
}

export type ClipboardResult = 'copied' | 'failed' | 'unsupported';

/**
 * 클립보드 쓰기. 부모가 결과를 live region으로 알린다.
 *
 * 상대 경로를 그대로 붙여넣으면 채팅에서 링크가 되지 않으므로 **절대 URL**로
 * 만든다 — 네 query key는 그대로다.
 */
export async function writeMergeNumberLink(link: MergeNumberLink): Promise<ClipboardResult> {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return 'unsupported';
  const absolute = new URL(link.href, window.location.origin).toString();
  try {
    await navigator.clipboard.writeText(absolute);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** 복사 결과의 문구. 세 화면이 같은 말을 한다. */
export const COPY_MESSAGES: Readonly<Record<ClipboardResult, string>> = {
  copied: 'M 번호 링크를 복사했습니다.',
  failed: 'M 번호 링크를 복사하지 못했습니다. 배지를 새 탭에서 열어 주소를 복사하세요.',
  unsupported: '클립보드를 사용할 수 없습니다. 배지를 새 탭에서 열어 주소를 복사하세요.',
};

export function MergeNumberBadge({ fields, context, onCopy }: MergeNumberBadgeProps): ReactNode {
  const describedBy = useId();
  const view = mergeNumberView(fields, context);
  // 기능 off·구버전 응답·커밋 행 — 영역 자체를 그리지 않는다.
  if (view.kind === 'hidden') return null;

  const badge = (
    <Badge
      tone={view.tone}
      data-testid="mnumber-badge"
      data-mnumber-state={view.state}
      data-mnumber-reason={view.reason ?? undefined}
      // 링크가 있으면 설명은 링크에 잇는다 — 상호작용 요소의 describedby가 더 널리 읽힌다.
      aria-describedby={view.link === null ? describedBy : undefined}
    >
      {view.label}
    </Badge>
  );

  return (
    <>
      {view.link === null ? (
        badge
      ) : (
        <Link href={view.link.href} data-testid="mnumber-link" aria-describedby={describedBy}>
          {badge}
        </Link>
      )}
      {view.link !== null && onCopy !== undefined ? (
        <Button
          variant="ghost"
          size="sm"
          type="button"
          data-testid="mnumber-copy"
          aria-label={`${view.label} 링크 복사`}
          onClick={() => {
            if (view.link !== null) onCopy(view.link);
          }}
        >
          <WorkbenchIcon name="copy" />
          M 링크 복사
        </Button>
      ) : null}
      {/*
       * 설명은 화면에 보이지 않되 스크린 리더에는 읽힌다 (C-014 접근성 규칙).
       * 색과 짧은 문구만으로는 "왜 번호가 없는가"가 전달되지 않는다.
       */}
      <span id={describedBy} className="cdt-sr-only">
        {view.description}
      </span>
    </>
  );
}
