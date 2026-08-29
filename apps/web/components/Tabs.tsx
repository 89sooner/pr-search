'use client';

/**
 * 접근성 탭 목록 (WP-038 / W-001-AGG, FR-STAT-006).
 *
 * ## Conductor에 Tabs 프리미티브가 없다
 *
 * ADR-006이 "없는 프리미티브는 semantic 토큰만으로 구현하고 DEV로 기여를 제안한다"고
 * 정했다. Radix·MUI 같은 외부 탭 라이브러리를 더하지 않고 Conductor `Button`을 조합해
 * WAI-ARIA 탭 상호작용을 직접 구현한다(DEV-397 기여 후보로 기록).
 *
 * ## 포커스와 선택을 섞지 않는다
 *
 * roving tabindex다: 선택된 탭만 `tabindex=0`, 나머지는 `-1`. 화살표로 포커스를 옮기고
 * 그 자리에서 선택도 함께 바꾼다(automatic activation). `Home`·`End`도 지원한다.
 * 눌러도 아무 일이 없는 컨트롤을 두지 않는다.
 */

import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabDef {
  readonly id: string;
  readonly label: string;
}

export interface TabsProps {
  readonly tabs: readonly TabDef[];
  readonly activeId: string;
  readonly onChange: (id: string) => void;
  /** 탭 목록의 접근성 이름. */
  readonly label: string;
}

export function TabList({ tabs, activeId, onChange, label }: TabsProps): ReactNode {
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const focusTab = (id: string): void => {
    onChange(id);
    // 렌더 뒤에 포커스를 옮긴다 — 선택된 탭이 tabindex=0이 된 뒤여야 한다.
    queueMicrotask(() => refs.current.get(id)?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = tabs.length - 1;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
        next = index === last ? 0 : index + 1;
        break;
      case 'ArrowLeft':
        next = index === 0 ? last : index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = tabs[next];
    if (target !== undefined) focusTab(target.id);
  };

  return (
    <div role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const selected = tab.id === activeId;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              if (node === null) refs.current.delete(tab.id);
              else refs.current.set(tab.id, node);
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`tabpanel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            className="cdt-btn cdt-btn--secondary"
            data-active={selected ? 'true' : undefined}
            onClick={() => {
              onChange(tab.id);
            }}
            onKeyDown={(event) => {
              onKeyDown(event, index);
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/** 탭 패널 하나. 비활성이면 `hidden`으로 감춘다(언마운트하지 않아 상태를 보존한다). */
export function TabPanel({
  id,
  active,
  children,
}: {
  readonly id: string;
  readonly active: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div role="tabpanel" id={`tabpanel-${id}`} aria-labelledby={`tab-${id}`} hidden={!active}>
      {children}
    </div>
  );
}
