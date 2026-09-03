'use client';

/**
 * C-020 ReleaseContainmentList (WP-024 / FR-REL-002, W-002-RELEASES·W-003).
 *
 * 두 겹이다:
 *
 * - `ReleaseContainmentList` — 컴포넌트 스펙 그대로의 표시 계층. 상태 판정은
 *   `lib/containment.ts`가 이미 끝냈고, 여기는 그리기만 한다.
 * - `ReleaseContainmentSection` — `/api/v1/containments`를 조회해 위를 채우는
 *   컨테이너. W-002·W-003 상세 화면이 이것을 쓴다.
 *
 * **섹션을 숨기지 않는다** (PendingSection과 같은 원칙). 미수집·미채번 상태도
 * 사유와 함께 렌더링한다 — 숨기면 기능 부재로 오인한다.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, Panel, Table } from '@conductor-by-89soone/react';
import { judgeContainment, type ContainmentState, type ContainmentSource } from '../lib/containment';
import { formatTimestamp } from '../lib/format';

export interface ReleaseContainmentListProps {
  readonly state: ContainmentState;
}

/**
 * 시각 오름차순 그대로 그린다 (QA-W002-08). 정렬은 서버(정본 조회)가 보장하고,
 * 여기서 다시 정렬하지 않는다 — 두 곳이 각자 정렬하면 규칙이 갈라졌을 때
 * 화면이 그 사실을 숨긴다.
 */
export function ReleaseContainmentList({ state }: ReleaseContainmentListProps): ReactNode {
  if (state.kind === 'release_not_indexed') {
    return (
      <p data-testid="releases-not-indexed">
        이 저장소의 릴리스가 아직 수집되지 않았습니다. 수집이 서면 포함 릴리스가 표시됩니다.
      </p>
    );
  }

  if (state.kind === 'not_sequenced') {
    return (
      <p data-testid="releases-not-sequenced">
        머지 시퀀스가 없어 포함 여부를 판정할 수 없습니다. 머지·채번이 끝나면 표시됩니다.
      </p>
    );
  }

  if (state.kind === 'unreleased') {
    return (
      <p data-testid="releases-unreleased">
        <Badge tone="warning">미배포</Badge> 아직 어떤 릴리스에도 포함되지 않았습니다.
        {state.pendingPrCount > 0 ? ` 마지막 릴리스 이후 ${String(state.pendingPrCount)}건이 대기 중입니다.` : ''}
      </p>
    );
  }

  return (
    <Table caption="이 항목을 포함하는 릴리스 (시각 오름차순)">
      <Table.Head>
        <Table.Row>
          <Table.HeaderCell scope="col">태그</Table.HeaderCell>
          <Table.HeaderCell scope="col">릴리스 시각</Table.HeaderCell>
          <Table.HeaderCell scope="col">대상 브랜치</Table.HeaderCell>
          <Table.HeaderCell scope="col">시퀀스</Table.HeaderCell>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {state.releases.map((release) => (
          <Table.Row key={release.tagName} data-testid="release-row">
            <Table.Cell>{release.tagName}</Table.Cell>
            <Table.Cell>{formatTimestamp(release.releasedAt)}</Table.Cell>
            <Table.Cell>{release.baseBranch}</Table.Cell>
            <Table.Cell>{release.mergeSeq === null ? '—' : `#${String(release.mergeSeq)}`}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
}

export interface ReleaseContainmentSectionProps {
  readonly repository: string;
  readonly kind: 'pull_request' | 'commit';
  readonly id: string;
  /** 섹션 testid·aria id의 어근. W-002는 `releases`, W-003은 `commit-releases`. */
  readonly sectionId: string;
}

type SectionOutcome =
  | { readonly phase: 'idle' }
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly state: ContainmentState }
  | { readonly phase: 'error' };

/**
 * `/containments`를 조회해 C-020을 채우는 컨테이너.
 *
 * **진입 시에는 부르지 않는다** (QA-W002-17, IA 원칙 4 — CR-020 DEV-088이
 * 세운 구조). PendingSection과 같은 접힘 기본 + 펼칠 때 1회 조회다: 상세
 * 진입의 네트워크 요청은 문서 하나여야 하고, a11y 계층이 그 수를 실제로
 * 센다. 접거나 다시 펼쳐도 재조회하지 않는다 — 자동 폴링 금지와 같은 원칙.
 */
export function ReleaseContainmentSection({
  repository,
  kind,
  id,
  sectionId,
}: ReleaseContainmentSectionProps): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const [outcome, setOutcome] = useState<SectionOutcome>({ phase: 'idle' });
  const requested = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return (): void => {
      alive.current = false;
    };
  }, []);

  const load = (): void => {
    if (requested.current) return;
    requested.current = true;
    setOutcome({ phase: 'loading' });
    // 프록시가 `/api/<rest>`를 업스트림 `/api/v1/<rest>`로 옮긴다 (lib/proxy.ts).
    const url = `/api/containments?repository=${encodeURIComponent(repository)}&kind=${kind}&id=${encodeURIComponent(id)}`;

    void (async (): Promise<void> => {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!alive.current) return;
        if (!response.ok) {
          setOutcome({ phase: 'error' });
          return;
        }
        const body = (await response.json()) as ContainmentSource;
        if (!alive.current) return;
        setOutcome({ phase: 'ready', state: judgeContainment(body) });
      } catch {
        if (alive.current) setOutcome({ phase: 'error' });
      }
    })();
  };

  return (
    <Panel as="section" aria-labelledby={`${sectionId}-heading`} data-testid={`section-${sectionId}`}>
      <h2 id={`${sectionId}-heading`}>포함 릴리스</h2>

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
          // 펼칠 때만, 처음 한 번만 부른다 (QA-W002-17).
          if (next) load();
        }}
      >
        {expanded ? '접기' : '펼치기'}
      </Button>

      <div id={`${sectionId}-body`} hidden={!expanded} data-testid={`body-${sectionId}`}>
        {outcome.phase === 'loading' ? <p data-testid="releases-loading">불러오는 중…</p> : null}
        {outcome.phase === 'error' ? (
          <p data-testid="releases-error">포함 릴리스를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.</p>
        ) : null}
        {outcome.phase === 'ready' ? <ReleaseContainmentList state={outcome.state} /> : null}
      </div>
    </Panel>
  );
}
