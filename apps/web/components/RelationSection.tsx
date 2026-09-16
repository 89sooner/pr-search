'use client';

/**
 * W-002-LINKS · W-003-LINKS 관계 섹션 (WP-031 / CR-042).
 *
 * ## 진입 시에는 부르지 않는다 (QA-W002-17, QA-W003-10)
 *
 * 접힘이 기본이고 **펼칠 때** 유형별로 조회한다. 상세 진입의 네트워크 요청은
 * 문서 하나여야 하고 a11y 계층이 그 수를 실제로 센다. 접었다 다시 펼쳐도
 * 재조회하지 않는다 — 자동 폴링을 만들지 않는다는 원칙과 같다. 다시 부르는
 * 유일한 길은 **사용자의 재시도 클릭**이다.
 *
 * ## 커밋은 스택을 묻지 않는다
 *
 * 스택은 PR↔PR 관계다 (FR-REL-006). 커밋 화면에서 물으면 서버가 400으로
 * 거절하는데, 그것을 유발해 놓고 받아 내지 않는다 — 화면이 이미 아는 사실이다
 * (`NeighborSection`의 `skip`과 같은 규율, CR-031 DEV-164).
 *
 * ## `links_pending`은 참조 그룹에만 걸린다 (DEV-258)
 *
 * 그 필드는 FR-REL-003 **참조 추출**의 완결 상태다. 되돌림·체리픽·스택은 이미
 * 계산돼 있으므로 그 상태에서도 그대로 표시한다. 섹션 전체를 가리면 있는 사실을
 * 없다고 그리는 것이다.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, Panel } from './ui';
import { LinkGroupList } from './LinkGroupList';
import {
  judgeRelations,
  linkTypeLabel,
  type RelationDirection,
  type RelationGroupView,
  type RelationLinkType,
} from '../lib/relations';

/** 화면 종류별 조회 대상. 커밋에는 스택이 없다. */
const PR_TYPES: readonly RelationLinkType[] = ['references', 'reverts', 'cherry_picks', 'stacks_on'];
const COMMIT_TYPES: readonly RelationLinkType[] = ['references', 'reverts', 'cherry_picks'];
const DIRECTIONS: readonly RelationDirection[] = ['outgoing', 'incoming'];

export interface RelationSectionProps {
  readonly repository: string;
  readonly kind: 'pull_request' | 'commit';
  /** PR 번호(문자열) 또는 40자 커밋 SHA. */
  readonly id: string;
  readonly sectionId: string;
  /** 참조 추출이 아직 끝나지 않았다 (FR-REL-003 예외 처리). */
  readonly linksPending?: boolean;
}

type GroupKey = string;

type GroupOutcome =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly group: RelationGroupView }
  | { readonly phase: 'error' };

function keyOf(linkType: RelationLinkType, direction: RelationDirection): GroupKey {
  return `${linkType}:${direction}`;
}

export function RelationSection({
  repository,
  kind,
  id,
  sectionId,
  linksPending,
}: RelationSectionProps): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const [outcomes, setOutcomes] = useState<Readonly<Record<GroupKey, GroupOutcome>>>({});
  const requested = useRef<Set<GroupKey>>(new Set());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return (): void => {
      alive.current = false;
    };
  }, []);

  const types = kind === 'pull_request' ? PR_TYPES : COMMIT_TYPES;

  const loadGroup = (linkType: RelationLinkType, direction: RelationDirection): void => {
    const key = keyOf(linkType, direction);
    setOutcomes((prev) => ({ ...prev, [key]: { phase: 'loading' } }));

    const query = new URLSearchParams({ repository, link_type: linkType, direction });
    if (kind === 'pull_request') query.set('pr_number', id);
    else query.set('commit_sha', id);

    void (async (): Promise<void> => {
      try {
        // 프록시가 `/api/<rest>`를 업스트림 `/api/v1/<rest>`로 옮긴다 (lib/proxy.ts).
        const response = await fetch(`/api/relations?${query.toString()}`, { cache: 'no-store' });
        if (!alive.current) return;
        if (!response.ok) {
          setOutcomes((prev) => ({ ...prev, [key]: { phase: 'error' } }));
          return;
        }
        const body: unknown = await response.json();
        if (!alive.current) return;
        const group = judgeRelations(body);
        setOutcomes((prev) => ({
          ...prev,
          [key]: group === null ? { phase: 'error' } : { phase: 'ready', group },
        }));
      } catch {
        if (alive.current) setOutcomes((prev) => ({ ...prev, [key]: { phase: 'error' } }));
      }
    })();
  };

  const loadAll = (): void => {
    for (const linkType of types) {
      for (const direction of DIRECTIONS) {
        const key = keyOf(linkType, direction);
        if (requested.current.has(key)) continue;
        requested.current.add(key);
        loadGroup(linkType, direction);
      }
    }
  };

  return (
    <Panel as="section" aria-labelledby={`${sectionId}-heading`} data-testid={`section-${sectionId}`}>
      <h2 id={`${sectionId}-heading`}>Relationships</h2>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={expanded}
        aria-controls={`${sectionId}-body`}
        data-testid={`toggle-${sectionId}`}
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          // 펼칠 때만, 그리고 유형마다 한 번만 부른다.
          if (next) loadAll();
        }}
      >
        {expanded ? "Collapse" : "Expand"}
      </Button>

      <div id={`${sectionId}-body`} hidden={!expanded} data-testid={`body-${sectionId}`}>
        {types.map((linkType) => (
          <section key={linkType} aria-label={linkTypeLabel(linkType)}>
            <h3>
              {linkTypeLabel(linkType)}
              {/*
                * 참조 그룹에만 붙는다. 되돌림·체리픽·스택은 이 상태와 무관하게
                * 이미 계산돼 있다 (DEV-258).
                */}
              {linkType === 'references' && linksPending === true ? (
                <>
                  {' '}
                  <Badge tone="neutral" data-testid="references-pending">
                    Analyzing references
                  </Badge>
                </>
              ) : null}
            </h3>
            {DIRECTIONS.map((direction) => {
              const key = keyOf(linkType, direction);
              const outcome = outcomes[key];
              if (outcome === undefined) return null;
              if (outcome.phase === 'loading') {
                return (
                  <p key={key} data-testid={`relation-loading-${key}`}>
                    Loading…
                  </p>
                );
              }
              if (outcome.phase === 'error') {
                return (
                  <p key={key} data-testid={`relation-error-${key}`}>
                    Unable to load relationships.{' '}
                    {/*
                      * 따를 수 없는 지시를 하지 않는다 (CR-032, DEV-170). 버튼이
                      * 없으면 상세 화면을 다시 여는 것 말고 복구 경로가 없다.
                      */}
                    <Button
                      type="button"
                      data-testid={`relation-retry-${key}`}
                      onClick={() => {
                        loadGroup(linkType, direction);
                      }}
                    >
                      Try again
                    </Button>
                  </p>
                );
              }
              return <LinkGroupList key={key} group={outcome.group} />;
            })}
          </section>
        ))}
      </div>
    </Panel>
  );
}
