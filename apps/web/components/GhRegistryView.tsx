'use client';

/**
 * A-006 gh capability·버전 레지스트리 (WP-078 / FR-GH-001 AC-5·AC-6, FR-GH-011 AC-2·AC-3, NFR-009, QA-GH-32, CR-088).
 *
 * 관리자가 여기서 확인하는 것:
 *   - 이 배포가 어떤 gh 버전·manifest(버전·해시·인벤토리 해시)를 쓰는가
 *   - 어떤 command·옵션까지 분류했고 무엇이 미확인인가 (차원별 커버리지, 게이트)
 *   - 명령 정의와 실제 바이너리가 달라졌는가 (실행기의 마지막 검사, 드리프트 diff)
 *   - 분류는 됐지만 실행은 열지 않은 command는 무엇이고 이유는 무엇인가 (command 탐색·상세)
 *   - 마지막 검증은 언제, 어떤 해시의 자료로 수행됐는가 (검증 기록·스냅숏)
 *
 * ## 화면은 판정을 만들지 않는다
 *
 * 커버리지·게이트·실행 허용은 `API-GH-013`이 검증기에서 계산해 준 값이고, 검증 기록은 실행기(JOB-GH-003)가
 * 남긴 것이다. 화면은 그것을 옮기고 **없음·미완·지남·드리프트·오류를 서로 다르게** 그릴 뿐이다. 「기록 없음」을
 * 「0개 정상」으로 그리지 않는다. 검사를 다시 돌리는 버튼은 없다 — 검사는 실행기가 정해진 주기로 한다.
 *
 * 모든 값은 텍스트 노드로 그린다 (ADR-018). command 요약·근거 문장은 gh help 원문이므로 HTML로 해석하지 않는다.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge, Button, Panel, Table, TextField } from '@conductor-by-89soone/react';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { describeApiError, loginPathOf, type CapabilitiesResponse } from '../lib/gh';
import {
  ADAPTER_LABEL,
  COMPOSABILITY_LABEL,
  CONTROL_LABEL,
  EMPTY_FILTER,
  EXECUTION_LABEL,
  INTERACTION_LABEL,
  SIDE_EFFECT_LABEL,
  STATUS_LABEL,
  SUPPORT_LABEL,
  contractVerificationState,
  countBy,
  describeConditions,
  filterCommands,
  isOverdue,
  label,
  percentOf,
  refTypeLabel,
  registryHeadline,
  shortHash,
  statusTone,
  type CommandDetailView,
  type CommandFilter,
  type CommandGraphView,
  type CommandListItem,
  type ContractSummaryView,
  type GraphEdgeView,
  type PortView,
  type RegistryStatusView,
  type VerificationView,
} from '../lib/gh-registry';

const REGISTRY_URL = '/api/gh/registry';
const CAPABILITIES_URL = '/api/gh/capabilities';
const commandUrl = (id: string): string => `/api/gh/registry/commands/${encodeURIComponent(id)}`;

type Screen =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  /** `search-api`가 `/gh/*`를 등록하지 않았다 — 배포가 기능을 껐다. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'no_permission' }
  | { readonly kind: 'unauthenticated'; readonly loginPath: string | null }
  | { readonly kind: 'failed'; readonly message: string; readonly correlationId: string | null };

type Loaded<T> =
  | { readonly kind: 'ok'; readonly body: T }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'no_permission' }
  | { readonly kind: 'unauthenticated'; readonly loginPath: string | null }
  | { readonly kind: 'failed'; readonly message: string; readonly correlationId: string | null };

async function loadJson<T>(url: string, signal: AbortSignal): Promise<Loaded<T>> {
  let response: Response;
  try {
    response = await fetch(url, { signal, cache: 'no-store' });
  } catch (error) {
    if (signal.aborted) throw error;
    return { kind: 'failed', message: '서버에 연결하지 못했습니다.', correlationId: null };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 404) return { kind: 'unavailable' };
  if (response.status === 403) return { kind: 'no_permission' };
  if (response.status === 401) return { kind: 'unauthenticated', loginPath: loginPathOf(body) };
  if (!response.ok) {
    const shaped = describeApiError(body, '응답을 읽지 못했습니다.');
    return { kind: 'failed', message: shaped.message, correlationId: shaped.correlationId };
  }
  return { kind: 'ok', body: body as T };
}

function formatTime(iso: string | null): string {
  if (iso === null) return '—';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString('ko-KR', { hour12: false });
}

function StatusBadge({ status }: { readonly status: string }): ReactNode {
  return <Badge tone={statusTone(status)}>{label(STATUS_LABEL, status)}</Badge>;
}

function Hash({ value }: { readonly value: string | null }): ReactNode {
  return (
    <code title={value ?? undefined} data-hash={value ?? undefined}>
      {shortHash(value)}
    </code>
  );
}

const CONTRACT_STATE_TEXT: Readonly<Record<ReturnType<typeof contractVerificationState>, string>> = {
  verified: '결과 계약 검증',
  legacy: '결과 계약 미검증(옛 판)',
  unknown: '판 모름',
};

function VerificationRow({ row, now }: { readonly row: VerificationView; readonly now: Date }): ReactNode {
  const inventoryMatch = row.inventory_hash_observed === null ? '—' : row.inventory_hash_observed === row.inventory_hash_expected ? '일치' : '불일치';
  const contractState = contractVerificationState(row);
  return (
    <tr data-testid="gh-registry-verification" data-source={row.checked_by} data-status={row.status}>
      <td>{row.checked_by}</td>
      <td>{row.trigger}</td>
      <td>{formatTime(row.checked_at)}</td>
      <td>
        <StatusBadge status={row.status} />
      </td>
      <td>{row.gh_version_observed ?? '—'}</td>
      <td>{inventoryMatch}</td>
      <td>{row.matches_served_manifest ? '예' : '아니오'}</td>
      <td>
        {row.validator_version} / {row.rules_version}
      </td>
      <td data-contract-dimensions={contractState}>
        {row.report_version ?? '—'} · {CONTRACT_STATE_TEXT[contractState]}
      </td>
      <td>{isOverdue(row.checked_at, 86_400_000, now) ? '지남' : '최근'}</td>
    </tr>
  );
}

/**
 * 결과 계약·연결 요약 (CR-089). 분모가 다른 수치를 따로 적는다 — 결과 계약이 있다는 것, port가 있다는 것, adapter를 구현했다는
 * 것, 실행이 열렸다는 것, 타입이 호환된다는 것, 다단계 실행이 된다는 것, 사내에서 확인했다는 것은 전부 다른 사실이다.
 */
function ContractsPanel({ contracts, gateScope }: { readonly contracts: ContractSummaryView | undefined; readonly gateScope: string | undefined }): ReactNode {
  return (
    <Panel data-testid="gh-registry-contracts">
      <h2>결과 계약과 연결 (GATE-GH-01d)</h2>
      {contracts === undefined ? (
        <p data-testid="gh-registry-contracts-none">이 배포의 응답에는 결과 계약 요약이 없습니다 — 결과 계약을 싣지 않는 옛 판입니다.</p>
      ) : (
        <>
          <p>
            <small>결과 계약이 있고 타입이 호환된다는 것은 실행 승인이 아닙니다. 아래 수치는 분모가 달라 서로 합치지 않습니다.</small>
          </p>
          <Table data-testid="gh-registry-contract-summary" caption="결과 계약·port·구현 adapter·실행 허용·타입 간선·다단계 흐름·대상 GHES 확인">
            <thead>
              <tr>
                <th scope="col">항목</th>
                <th scope="col">값</th>
                <th scope="col">분모와 뜻</th>
              </tr>
            </thead>
            <tbody>
              <tr data-item="result_contracts">
                <td>결과 계약 분류</td>
                <td>
                  {String(contracts.resultContracts.classified)}/{String(contracts.resultContracts.total)}
                </td>
                <td>leaf command</td>
              </tr>
              <tr data-item="output_ports">
                <td>출력 port</td>
                <td>{String(contracts.outputPorts.ports)}</td>
                <td>{String(contracts.outputPorts.commands)}개 command(조건부 연결 가능)의 결과에서 참조를 만드는 방법</td>
              </tr>
              <tr data-item="input_ports">
                <td>입력 port</td>
                <td>{String(contracts.inputPorts.ports)}</td>
                <td>대상 자원 자리를 가진 {String(contracts.inputPorts.commands)}개 command</td>
              </tr>
              <tr data-item="adapters">
                <td>구현된 결과 adapter</td>
                <td>{String(contracts.adaptersImplemented.length)}</td>
                <td>{contracts.adaptersImplemented.join(', ') || '없음'}</td>
              </tr>
              <tr data-item="executable">
                <td>실행 허용</td>
                <td>{String(contracts.executableCommands.length)}</td>
                <td>{contracts.executableCommands.join(', ') || '없음'}</td>
              </tr>
              <tr data-item="edges">
                <td>타입상 호환 간선</td>
                <td>{String(contracts.graph.edges)}</td>
                <td>
                  조건부 {String(contracts.graph.conditional)} · 직접 {String(contracts.graph.direct)} · 타입은 같지만 불가 {String(contracts.graph.blockedSameType)}
                </td>
              </tr>
              <tr data-item="flows">
                <td>실행 가능한 다단계 흐름</td>
                <td>{String(contracts.executableFlows)}</td>
                <td>Recipe·다단계 실행은 열리지 않았다</td>
              </tr>
              <tr data-item="host">
                <td>대상 GHES 확인</td>
                <td>{String(contracts.hostVerified)}</td>
                <td>사내 GHES에서 확인한 command</td>
              </tr>
            </tbody>
          </Table>
          <p data-testid="gh-registry-composability">
            {contracts.composability
              .filter((entry) => entry.count > 0)
              .map((entry) => `${label(COMPOSABILITY_LABEL, entry.value)} ${String(entry.count)}`)
              .join(' · ')}
          </p>
        </>
      )}
      {gateScope === undefined ? null : (
        <p data-testid="gh-registry-gate-scope">
          <small>{gateScope}</small>
        </p>
      )}
    </Panel>
  );
}

export function GhRegistryView(): ReactNode {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [status, setStatus] = useState<RegistryStatusView | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null);
  const [nonce, setNonce] = useState(0);
  const [filter, setFilter] = useState<CommandFilter>(EMPTY_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ readonly kind: 'idle' } | { readonly kind: 'loading' } | { readonly kind: 'ok'; readonly body: CommandDetailView } | { readonly kind: 'failed'; readonly message: string }>({ kind: 'idle' });
  const now = useMemo(() => new Date(), [status]);

  useEffect(() => {
    const controller = new AbortController();
    setScreen({ kind: 'loading' });
    void (async (): Promise<void> => {
      const [registry, caps] = await Promise.all([loadJson<RegistryStatusView>(REGISTRY_URL, controller.signal), loadJson<CapabilitiesResponse>(CAPABILITIES_URL, controller.signal)]);
      if (controller.signal.aborted) return;
      // 레지스트리 응답이 화면의 자격을 정한다 — capability 목록은 누구나 읽지만 이 화면은 운영 화면이다.
      if (registry.kind !== 'ok') {
        setScreen(registry.kind === 'unavailable' ? { kind: 'unavailable' } : registry.kind === 'no_permission' ? { kind: 'no_permission' } : registry.kind === 'unauthenticated' ? registry : { kind: 'failed', message: registry.message, correlationId: registry.correlationId });
        return;
      }
      setStatus(registry.body);
      setCapabilities(caps.kind === 'ok' ? caps.body : null);
      setScreen({ kind: 'ready' });
    })().catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [nonce]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setDetail({ kind: 'loading' });
    const controller = new AbortController();
    void loadJson<CommandDetailView>(commandUrl(id), controller.signal)
      .then((loaded) => {
        if (loaded.kind === 'ok') setDetail({ kind: 'ok', body: loaded.body });
        else setDetail({ kind: 'failed', message: loaded.kind === 'failed' ? loaded.message : `상세를 읽지 못했습니다 (${loaded.kind}).` });
      })
      .catch(() => {
        setDetail({ kind: 'failed', message: '상세를 읽지 못했습니다.' });
      });
  }, []);

  if (screen.kind === 'loading') {
    return (
      <div data-testid="gh-registry" data-state="loading" aria-busy="true">
        <p>레지스트리 상태를 읽는 중입니다…</p>
      </div>
    );
  }
  if (screen.kind === 'unavailable') {
    return (
      <div data-testid="gh-registry" data-state="unavailable">
        <EmptyState cause="not_found" title="이 배포에서는 GitHub 작업이 열리지 않았습니다" description="GH_OPERATIONS_ENABLED가 꺼져 있어 레지스트리 조회 경로가 없습니다. 켜는 방법은 런북 7.C에 있습니다." />
      </div>
    );
  }
  if (screen.kind === 'no_permission') {
    return (
      <div data-testid="gh-registry" data-state="no_permission">
        <EmptyState cause="no_permission" title="이 화면은 운영자(operator) 또는 보안 담당자(security_officer) 역할이 필요합니다" description="필요한 역할을 그대로 적습니다. 다른 역할로는 레지스트리 상태를 조회할 수 없습니다." />
      </div>
    );
  }
  if (screen.kind === 'unauthenticated') {
    return (
      <div data-testid="gh-registry" data-state="unauthenticated">
        <ErrorBanner tone="warning" title="세션이 없거나 만료되었습니다" impact="다시 로그인하면 이 화면으로 돌아옵니다." action={screen.loginPath === null ? undefined : <a href={screen.loginPath}>로그인</a>} />
      </div>
    );
  }
  if (screen.kind === 'failed' || status === null) {
    return (
      <div data-testid="gh-registry" data-state="failed">
        <ErrorBanner tone="danger" title="레지스트리 상태를 읽지 못했습니다" impact={screen.kind === 'failed' ? screen.message : '응답이 비어 있습니다.'} correlationId={screen.kind === 'failed' ? screen.correlationId : null} action={<Button variant="secondary" onClick={() => setNonce((value) => value + 1)}>다시 읽기</Button>} />
      </div>
    );
  }

  const headline = registryHeadline(status, now);
  const commands: readonly CommandListItem[] = capabilities?.commands ?? [];
  const filtered = filterCommands(commands, filter);
  const bySupport = countBy(commands, (command) => command.support);
  const drifted = status.verification.latest_by_source.find((row) => row.drift !== null && (row.drift.addedCommands.length + row.drift.removedCommands.length + row.drift.changedCommands.length > 0));

  return (
    <div data-testid="gh-registry" data-state="ready" data-records={headline.kind}>
      <Panel data-testid="gh-registry-headline">
        <h2>이 배포가 쓰는 gh와 manifest</h2>
        <dl>
          <dt>고정 gh 버전</dt>
          <dd data-testid="gh-registry-gh-version">{status.gh.pinned_version}</dd>
          <dt>바이너리 SHA-256(기대)</dt>
          <dd>
            <Hash value={status.gh.binary_sha256_expected} />
          </dd>
          <dt>manifest 판 · 해시</dt>
          <dd data-testid="gh-registry-manifest">
            {status.manifest.version} · <Hash value={status.manifest.hash} /> · {status.manifest.hash_verified ? '해시 검증됨' : '해시 불일치'}
          </dd>
          <dt>인벤토리 해시</dt>
          <dd>
            <Hash value={status.manifest.inventory_hash} />
          </dd>
          <dt>생성 시각</dt>
          <dd>{formatTime(status.manifest.generated_at)}</dd>
          <dt>command</dt>
          <dd>
            전체 {String(status.manifest.command_count)} · leaf {String(status.manifest.leaf_command_count)} · 그룹 {String(status.manifest.group_command_count)} · 별칭 전용 {String(status.manifest.alias_only_command_count)} · help topic {String(status.manifest.help_topics)}
          </dd>
          <dt>검증기 · 규칙</dt>
          <dd>
            {status.validator.version} / {status.validator.rules_version} · <StatusBadge status={status.validator.status} />
          </dd>
        </dl>
        {headline.kind === 'no_records' ? (
          <p data-testid="gh-registry-records-none" role="status">
            검증 기록이 없습니다 — 실행기가 아직 기동 검사를 기록하지 않았거나 이 기록을 남기지 않는 옛 배포입니다. 위의 상태는 이 API가 적재한 manifest를 지금 검증한 값이며, 실제 바이너리와의 대조는 실행기의 기록에만 있습니다.
          </p>
        ) : null}
        {headline.kind === 'executor_unchecked' ? (
          <p data-testid="gh-registry-records-partial" role="status">
            실행기 기록이 없습니다 — {headline.other.checked_by}의 기록({label(STATUS_LABEL, headline.other.status)}, {formatTime(headline.other.checked_at)})만 있습니다. 실행을 실제로 거절하는 판정은 실행기의 검사입니다.
          </p>
        ) : null}
        {headline.kind === 'executor' ? (
          <p data-testid="gh-registry-records-executor" role="status" data-status={headline.latest.status} data-overdue={headline.overdue ? 'true' : 'false'}>
            실행기 마지막 검사: <StatusBadge status={headline.latest.status} /> {formatTime(headline.latest.checked_at)}
            {headline.overdue ? ' · 검사 주기의 두 배를 넘겼습니다 — 실행기가 멈췄거나 검사가 돌지 않습니다' : ''}
            {headline.servedMismatch ? ' · 실행기가 검사한 manifest 해시가 이 API의 manifest와 다릅니다 — 두 서비스의 이미지 버전을 확인하세요' : ''}
            {headline.latest.status === 'drift' || headline.latest.status === 'failed' ? ' · 실행기가 새 실행을 registry_stale로 거절하고 있습니다' : ''}
          </p>
        ) : null}
      </Panel>

      <Panel data-testid="gh-registry-execution">
        <h2>실행 허용</h2>
        <p>
          실행이 열린 capability {String(status.execution.allowed.length)}개: {status.execution.allowed.join(', ') || '없음'} · 분류된 leaf {String(status.coverage.classified_leaf_commands)}개 / 미분류 {String(status.coverage.unclassified_leaf_commands)}개
        </p>
        <p>
          <small>분류가 늘어도 실행 허용은 코드 표(EXECUTABLE_CAPABILITIES)와 manifest가 함께 정한다. 검증기가 둘의 불일치를 실패로 본다.</small>
        </p>
      </Panel>

      <Panel data-testid="gh-registry-verifications">
        <h2>검증 기록 (출처별 최신)</h2>
        {status.verification.latest_by_source.length === 0 ? (
          <p>기록 없음</p>
        ) : (
          <Table caption="실행기(JOB-GH-003)·CI·CLI가 남긴 마지막 검사. 실행기의 기록이 실행 거절의 근거다.">
            <thead>
              <tr>
                <th scope="col">출처</th>
                <th scope="col">계기</th>
                <th scope="col">시각</th>
                <th scope="col">결과</th>
                <th scope="col">관측 gh</th>
                <th scope="col">인벤토리</th>
                <th scope="col">이 manifest</th>
                <th scope="col">검증기/규칙</th>
                <th scope="col">보고서 판</th>
                <th scope="col">신선도</th>
              </tr>
            </thead>
            <tbody>
              {status.verification.latest_by_source.map((row) => (
                <VerificationRow key={row.verification_id} row={row} now={now} />
              ))}
            </tbody>
          </Table>
        )}
        {drifted?.drift ? (
          <div data-testid="gh-registry-drift">
            <h3>드리프트 — 정의와 실제 바이너리의 차이</h3>
            <ul>
              {drifted.drift.addedCommands.map((one) => (
                <li key={`+${one}`}>바이너리에만 있음: {one}</li>
              ))}
              {drifted.drift.removedCommands.map((one) => (
                <li key={`-${one}`}>manifest에만 있음: {one}</li>
              ))}
              {drifted.drift.changedCommands.map((one) => (
                <li key={`~${one}`}>flag·JSON 필드가 달라짐: {one}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>

      <Panel data-testid="gh-registry-coverage">
        <h2>차원별 분류 커버리지 (NFR-009)</h2>
        <ul data-testid="gh-registry-gates">
          {status.gates.map((gate) => (
            <li key={gate.id} data-gate={gate.id} data-pass={gate.pass ? 'true' : 'false'}>
              <Badge tone={gate.pass ? 'success' : 'warning'}>{gate.pass ? 'PASS' : 'FAIL'}</Badge> {gate.id} {gate.label} — {gate.detail}
            </li>
          ))}
        </ul>
        <Table data-testid="gh-registry-dimensions" caption="차원마다 분모(무엇을 셌는가)와 분류된 수. 분모 0은 백분율이 아니라 「정의되지 않음」이다.">
          <thead>
            <tr>
              <th scope="col">게이트</th>
              <th scope="col">차원</th>
              <th scope="col">분류/전체</th>
              <th scope="col">비율</th>
              <th scope="col">미분류 예</th>
            </tr>
          </thead>
          <tbody>
            {status.coverage.dimensions.map((dimension) => (
              <tr key={dimension.id} data-dimension={dimension.id} data-unclassified={dimension.unclassified}>
                <td>{dimension.gate}</td>
                <td>
                  <span title={dimension.note}>{dimension.label}</span>
                </td>
                <td>
                  {String(dimension.classified)}/{String(dimension.total)}
                </td>
                <td>{percentOf(dimension)}</td>
                <td>{dimension.unclassified === 0 ? '—' : `${dimension.unclassifiedSample.slice(0, 5).join(', ')}${dimension.unclassified > 5 ? ` 외 ${String(dimension.unclassified - 5)}` : ''}`}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <ContractsPanel contracts={status.contracts} gateScope={status.gate_scope} />

      <Panel data-testid="gh-registry-commands">
        <h2>command 분류 탐색</h2>
        <p data-testid="gh-registry-support-summary">
          {bySupport.map((entry) => `${label(SUPPORT_LABEL, entry.value)} ${String(entry.count)}`).join(' · ') || '목록을 읽지 못했습니다'}
        </p>
        <div>
          <TextField
            aria-label="command 검색"
            placeholder="예: pr merge, secret"
            value={filter.query}
            onChange={(event) => {
              setFilter((current) => ({ ...current, query: event.target.value }));
            }}
            data-testid="gh-registry-search"
          />
          <label>
            지원 상태{' '}
            <select
              data-testid="gh-registry-filter-support"
              value={filter.support}
              onChange={(event) => {
                setFilter((current) => ({ ...current, support: event.target.value }));
              }}
            >
              <option value="all">전체</option>
              {Object.entries(SUPPORT_LABEL).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>{' '}
          <label>
            실행{' '}
            <select
              data-testid="gh-registry-filter-execution"
              value={filter.execution}
              onChange={(event) => {
                setFilter((current) => ({ ...current, execution: event.target.value }));
              }}
            >
              <option value="all">전체</option>
              {Object.entries(EXECUTION_LABEL).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ul data-testid="gh-registry-command-list" aria-label="command 목록">
          {filtered.slice(0, 250).map((command) => (
            <li key={command.id} data-support={command.support} data-execution={command.execution}>
              <button type="button" aria-pressed={command.id === selectedId} data-testid={`gh-registry-command-${command.id}`} onClick={() => select(command.id)}>
                gh {command.path.join(' ')}
              </button>{' '}
              <Badge tone="neutral">{label(SUPPORT_LABEL, command.support)}</Badge> <Badge tone={command.execution === 'allowed' ? 'accent' : 'neutral'}>{label(EXECUTION_LABEL, command.execution)}</Badge>
              {command.risk === null ? null : <Badge tone="accent">{command.risk}</Badge>}
              {command.side_effect === undefined || command.side_effect === null ? null : <small> {label(SIDE_EFFECT_LABEL, command.side_effect)}</small>}
              {command.composability === undefined || command.composability === null ? null : <small> · {label(COMPOSABILITY_LABEL, command.composability)}</small>}
              <span> {command.summary}</span>
            </li>
          ))}
          {filtered.length === 0 ? <li>조건에 맞는 command가 없습니다.</li> : null}
        </ul>
        {filtered.length > 250 ? <p>{String(filtered.length - 250)}개는 표시하지 않았습니다 — 검색어를 좁히세요.</p> : null}

        <section aria-live="polite" data-testid="gh-registry-command-detail" data-state={detail.kind}>
          {detail.kind === 'loading' ? <p>상세를 읽는 중입니다…</p> : null}
          {detail.kind === 'failed' ? <p role="alert">{detail.message}</p> : null}
          {detail.kind === 'ok' ? <CommandDetail detail={detail.body} /> : null}
        </section>
      </Panel>

      <Panel data-testid="gh-registry-snapshots">
        <h2>스냅숏 (manifest 해시마다 한 행)</h2>
        {status.snapshots.length === 0 ? (
          <p>스냅숏 없음</p>
        ) : (
          <Table caption="이 배포가 본 manifest들. 활성화는 NFR-009 게이트를 통과한 뒤에만 가능하며 이 판은 어느 것도 활성화하지 않았다.">
            <thead>
              <tr>
                <th scope="col">해시</th>
                <th scope="col">판</th>
                <th scope="col">gh</th>
                <th scope="col">leaf</th>
                <th scope="col">미분류</th>
                <th scope="col">실행 허용</th>
                <th scope="col">처음 본 시각</th>
                <th scope="col">활성화</th>
                <th scope="col">지금 적재</th>
              </tr>
            </thead>
            <tbody>
              {status.snapshots.map((row) => (
                <tr key={row.snapshot_id} data-served={row.is_served ? 'true' : 'false'}>
                  <td>
                    <Hash value={row.manifest_hash} />
                  </td>
                  <td>{row.manifest_version}</td>
                  <td>{row.gh_version}</td>
                  <td>{String(row.leaf_command_count)}</td>
                  <td>{String(row.unclassified_count)}</td>
                  <td>{String(row.executable_count)}</td>
                  <td>{formatTime(row.first_seen_at)}</td>
                  <td>{row.activated_at === null ? '활성화 안 됨' : formatTime(row.activated_at)}</td>
                  <td>{row.is_served ? '예' : '아니오'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Panel data-testid="gh-registry-host">
        <h2>대상 GHES 확인</h2>
        <p data-status={status.host_verification.status}>
          <Badge tone="neutral">{status.host_verification.status === 'not_verified' ? '미확인' : status.host_verification.status}</Badge> {status.host_verification.note}
        </p>
      </Panel>

      <p>
        <Button variant="secondary" data-testid="gh-registry-refresh" onClick={() => setNonce((value) => value + 1)}>
          다시 읽기
        </Button>
      </p>
    </div>
  );
}

function CommandDetail({ detail }: { readonly detail: CommandDetailView }): ReactNode {
  const classification = detail.classification;
  return (
    <div data-testid={`gh-registry-detail-${detail.id}`}>
      <h3>gh {detail.path.join(' ')}</h3>
      <p>{detail.summary}</p>
      <p>
        <code>{detail.usage}</code>
      </p>
      <dl>
        <dt>실행</dt>
        <dd>
          <Badge tone={detail.execution === 'allowed' ? 'accent' : 'neutral'}>{label(EXECUTION_LABEL, detail.execution)}</Badge>
          {detail.execution_reason === null ? null : <span> — {detail.execution_reason}</span>}
        </dd>
        <dt>지원 · interaction · 부작용 · 위험</dt>
        <dd>
          {label(SUPPORT_LABEL, detail.support)} · {label(INTERACTION_LABEL, classification?.interaction)} · {label(SIDE_EFFECT_LABEL, classification?.sideEffect)} · {detail.risk ?? '—'}
        </dd>
        <dt>결과 · 민감도 · 인증 · 호스트 확인</dt>
        <dd>
          {classification?.resultKind ?? '—'} · {classification?.sensitivity ?? '—'} · {classification?.auth ?? '—'} · {classification?.hostSupport === 'verified' ? '확인됨' : '미확인'}
        </dd>
        <dt>입출력</dt>
        <dd>
          stdin {classification?.io.stdin ?? '—'} · 파일 입력 {classification?.io.fileInputFlags.join(', ') || '없음'} · 파일 출력 {classification?.io.fileOutputFlags.join(', ') || '없음'} · 출력 {classification?.io.outputFormats.join(', ') ?? '—'} · 컨텍스트 {classification?.io.contexts.join(', ') ?? '—'} · {classification?.io.paginated === true ? '페이지네이션 있음' : '페이지네이션 없음'}
        </dd>
        <dt>별칭</dt>
        <dd>{detail.aliases.length === 0 ? '없음' : detail.aliases.join(', ')}</dd>
        <dt>분류 근거</dt>
        <dd data-testid="gh-registry-detail-basis">{classification?.basis.evidence ?? '—'}</dd>
      </dl>
      {classification !== null && classification.notes.length > 0 ? (
        <ul>
          {classification.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      {classification !== null && classification.positionals.length > 0 ? (
        <Table caption="positional 자리와 분류">
          <thead>
            <tr>
              <th scope="col">자리</th>
              <th scope="col">필수</th>
              <th scope="col">반복</th>
              <th scope="col">컨트롤</th>
              <th scope="col">바인딩</th>
              <th scope="col">규칙</th>
            </tr>
          </thead>
          <tbody>
            {classification.positionals.map((positional) => (
              <tr key={positional.placeholder}>
                <td>
                  <code>{positional.placeholder}</code>
                </td>
                <td>{positional.required ? '예' : '아니오'}</td>
                <td>{positional.variadic ? '예' : '아니오'}</td>
                <td>{label(CONTROL_LABEL, positional.control)}</td>
                <td>{positional.binding ?? '—'}</td>
                <td>{positional.basis.rule ?? positional.basis.source}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      {classification !== null ? (
        <Table caption={`flag ${String(classification.flags.length)}개와 분류. 규칙 이름이 곧 근거이며, 원문은 title에 있다.`}>
          <thead>
            <tr>
              <th scope="col">flag</th>
              <th scope="col">상속</th>
              <th scope="col">컨트롤</th>
              <th scope="col">값</th>
              <th scope="col">열거값</th>
              <th scope="col">규칙</th>
            </tr>
          </thead>
          <tbody>
            {classification.flags.map((flag) => (
              <tr key={`${flag.inherited ? 'i' : 'c'}-${flag.name}`} data-control={flag.control}>
                <td>
                  <code title={flag.basis.evidence}>--{flag.name}</code>
                  {flag.secretInput === true ? <Badge tone="danger">비밀 값</Badge> : null}
                </td>
                <td>{flag.inherited ? '예' : '아니오'}</td>
                <td>{label(CONTROL_LABEL, flag.control)}</td>
                <td>{flag.valueKind}</td>
                <td>{flag.enumValues === null ? '—' : flag.enumValues.join(' | ')}</td>
                <td>{flag.basis.rule ?? flag.basis.source}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p>그룹 또는 별칭 전용 노드라 분류가 없습니다.</p>
      )}
      {detail.json_fields.length > 0 ? (
        <p>
          <small>--json 필드 {String(detail.json_fields.length)}개: {detail.json_fields.join(', ')}</small>
        </p>
      ) : null}
      <ResultContractSection detail={detail} />
    </div>
  );
}

/**
 * command 하나의 결과 계약·port·연결 후보 (CR-089). 모든 값은 서버가 준 것이며 화면은 판정을 만들지 않는다. 실행 결과는 싣지
 * 않는다 — 이 상세는 manifest의 정적 계약이다.
 */
function ResultContractSection({ detail }: { readonly detail: CommandDetailView }): ReactNode {
  const contract = detail.result_contract;
  if (contract === undefined) {
    return <p data-testid="gh-registry-contract-absent">이 응답에는 결과 계약이 없습니다 — 결과 계약을 싣지 않는 옛 판입니다.</p>;
  }
  if (contract === null) {
    return (
      <p data-testid="gh-registry-contract-absent">
        {detail.alias_of === null ? '그룹 또는 미분류 command라 결과 계약이 없습니다.' : `별칭은 계약을 따로 갖지 않습니다 — gh ${detail.alias_of.join(' ')}의 계약을 따릅니다.`}
      </p>
    );
  }
  return (
    <section data-testid="gh-registry-contract" data-composability={contract.composability} aria-label="결과 계약">
      <h4>결과 계약</h4>
      <dl>
        <dt>주 결과 · 민감도</dt>
        <dd>
          {contract.kind} · {contract.sensitivity}
        </dd>
        <dt>연결 가능성</dt>
        <dd>
          <Badge tone={contract.bindable ? 'accent' : 'neutral'}>{label(COMPOSABILITY_LABEL, contract.composability)}</Badge>
        </dd>
        <dt>자원</dt>
        <dd data-testid="gh-registry-contract-resource">
          {refTypeLabel(contract.resourceKind)} — {contract.resourceBasis}
        </dd>
        <dt>근거</dt>
        <dd>{contract.basis.evidence}</dd>
      </dl>
      <Table data-testid="gh-registry-contract-outputs" caption="출력 모드마다 결과 계약이 다르다 — 기본 출력과 --json 출력은 다른 계약이다">
        <thead>
          <tr>
            <th scope="col">모드</th>
            <th scope="col">결과</th>
            <th scope="col">adapter</th>
            <th scope="col">스키마</th>
            <th scope="col">연결</th>
            <th scope="col">이유</th>
          </tr>
        </thead>
        <tbody>
          {contract.outputs.map((output) => (
            <tr key={output.mode} data-mode={output.mode} data-bindable={output.bindable ? 'true' : 'false'}>
              <td>{output.mode}</td>
              <td>{output.kind}</td>
              <td>{label(ADAPTER_LABEL, output.adapter)}</td>
              <td>{output.schema ?? '—'}</td>
              <td>{output.bindable ? '가능' : '불가'}</td>
              <td>{output.reason ?? output.unstructuredReason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <PortTable title="출력 port" ports={contract.outputPorts} note={contract.outputPortsNote} testId="gh-registry-output-ports" />
      <PortTable title="입력 port" ports={contract.inputPorts} note={contract.inputPortsNote} testId="gh-registry-input-ports" />
      {detail.graph === undefined || detail.graph === null ? null : <GraphSection graph={detail.graph} />}
    </section>
  );
}

function PortTable({ title, ports, note, testId }: { readonly title: string; readonly ports: readonly PortView[]; readonly note: string | null; readonly testId: string }): ReactNode {
  return (
    <div data-testid={testId}>
      <h5>{title}</h5>
      {ports.length === 0 ? (
        <p>없음 — {note ?? '이유가 적혀 있지 않습니다'}</p>
      ) : (
        <Table caption={`${title}: 타입·개수·필수·null·민감도·조건`}>
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">타입</th>
              <th scope="col">개수</th>
              <th scope="col">필수</th>
              <th scope="col">null</th>
              <th scope="col">민감도</th>
              <th scope="col">조건</th>
            </tr>
          </thead>
          <tbody>
            {ports.map((port) => (
              <tr key={port.id} data-port={port.id}>
                <td>
                  <code>{port.id}</code>
                </td>
                <td>{refTypeLabel(port.type)}</td>
                <td>{port.cardinality === 'many' ? '목록' : '하나'}</td>
                <td>{port.required ? '예' : '아니오'}</td>
                <td>{port.nullable ? '예' : '아니오'}</td>
                <td>{port.sensitivity}</td>
                <td>{describeConditions(port.conditions)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

const edgeKey = (edge: { readonly from: string; readonly fromPort: string; readonly to: string; readonly toPort: string }): string => `${edge.from}.${edge.fromPort}->${edge.to}.${edge.toPort}`;
const commandLabel = (id: string): string => `gh ${id.split('.').join(' ')}`;

function EdgeTable({ title, edges, direction }: { readonly title: string; readonly edges: readonly GraphEdgeView[]; readonly direction: 'outgoing' | 'incoming' }): ReactNode {
  return (
    <div data-testid={`gh-registry-graph-${direction}`}>
      <h6>
        {title} ({String(edges.length)})
      </h6>
      {edges.length === 0 ? (
        <p>없음</p>
      ) : (
        <Table caption={title}>
          <thead>
            <tr>
              <th scope="col">{direction === 'outgoing' ? '입력 쪽 command' : '출력 쪽 command'}</th>
              <th scope="col">타입</th>
              <th scope="col">판정</th>
              <th scope="col">조건</th>
              <th scope="col">실행</th>
            </tr>
          </thead>
          <tbody>
            {edges.map((edge) => (
              <tr key={edgeKey(edge)} data-edge={edgeKey(edge)} data-verdict={edge.verdict} data-executable={String(edge.execution.executable)}>
                <td>{direction === 'outgoing' ? `${commandLabel(edge.to)} (${edge.toPort})` : `${commandLabel(edge.from)} (${edge.fromPort})`}</td>
                <td>{refTypeLabel(edge.type)}</td>
                <td>{edge.verdict === 'direct' ? '직접 호환' : '조건부 호환'}</td>
                <td>{describeConditions(edge.conditions)}</td>
                <td>
                  <Badge tone="neutral">실행 미개방</Badge> {edge.execution.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function GraphSection({ graph }: { readonly graph: CommandGraphView }): ReactNode {
  return (
    <div data-testid="gh-registry-graph">
      <h5>연결 후보 (타입 판정)</h5>
      <p>
        <small>호환은 실행 승인이 아닙니다. 실행 허용은 코드 표가 정하고, 실행 가능한 다단계 흐름은 {String(graph.executable_flows)}개입니다.</small>
      </p>
      <EdgeTable title="이 결과를 입력으로 받을 수 있는 command" edges={graph.outgoing} direction="outgoing" />
      <EdgeTable title="이 command의 입력에 이을 수 있는 결과" edges={graph.incoming} direction="incoming" />
      {graph.blocked.length === 0 ? null : (
        <Table data-testid="gh-registry-graph-blocked" caption="타입은 같지만 이어지지 않는 짝과 이유">
          <thead>
            <tr>
              <th scope="col">출력</th>
              <th scope="col">입력</th>
              <th scope="col">이유</th>
            </tr>
          </thead>
          <tbody>
            {graph.blocked.map((pair) => (
              <tr key={edgeKey(pair)} data-edge={edgeKey(pair)}>
                <td>
                  {commandLabel(pair.from)} ({pair.fromPort})
                </td>
                <td>
                  {commandLabel(pair.to)} ({pair.toPort})
                </td>
                <td>{pair.reasons.map((reason) => reason.detail).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
