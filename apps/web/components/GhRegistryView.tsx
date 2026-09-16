'use client';

import { dimensionLabel, dimensionNote, gateDetail, gateLabel } from '../lib/gh-presentation';
import { serviceMessage } from '../lib/service-message';

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
import { Badge, Button, Panel, Table, TextField } from './ui';
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
    return { kind: 'failed', message: "Unable to connect to the server.", correlationId: null };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 404) return { kind: 'unavailable' };
  if (response.status === 403) return { kind: 'no_permission' };
  if (response.status === 401) return { kind: 'unauthenticated', loginPath: loginPathOf(body) };
  if (!response.ok) {
    const shaped = describeApiError(body, "Unable to read the response.");
    return { kind: 'failed', message: shaped.message, correlationId: shaped.correlationId };
  }
  return { kind: 'ok', body: body as T };
}

function formatTime(iso: string | null): string {
  if (iso === null) return '—';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString("en-US", { hour12: false });
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
  verified: "Result contract verified",
  legacy: "Result contract unverified (older version)",
  unknown: "Unknown version",
};

function VerificationRow({ row, now }: { readonly row: VerificationView; readonly now: Date }): ReactNode {
  const inventoryMatch = row.inventory_hash_observed === null ? '—' : row.inventory_hash_observed === row.inventory_hash_expected ? "Match" : "Mismatch";
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
      <td>{row.matches_served_manifest ? "Yes" : "No"}</td>
      <td>
        {row.validator_version} / {row.rules_version}
      </td>
      <td data-contract-dimensions={contractState}>
        {row.report_version ?? '—'} · {CONTRACT_STATE_TEXT[contractState]}
      </td>
      <td>{isOverdue(row.checked_at, 86_400_000, now) ? "Expired" : "Recent"}</td>
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
      <h2>Result contracts and connections (GATE-GH-01d)</h2>
      {contracts === undefined ? (
        <p data-testid="gh-registry-contracts-none">This deployment uses an older response format without a result contract summary.</p>
      ) : (
        <>
          <p>
            <small>Result contracts and type compatibility do not grant execution approval. The figures below have different denominators and cannot be added together.</small>
          </p>
          <Table data-testid="gh-registry-contract-summary" caption="Result contracts, ports, adapters, execution permissions, type edges, workflows, and GHES verification">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Value</th>
                <th scope="col">Denominator and meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr data-item="result_contracts">
                <td>Result contract classification</td>
                <td>
                  {String(contracts.resultContracts.classified)}/{String(contracts.resultContracts.total)}
                </td>
                <td>leaf command</td>
              </tr>
              <tr data-item="output_ports">
                <td>Output port</td>
                <td>{String(contracts.outputPorts.ports)}</td>
                <td>{String(contracts.outputPorts.commands)} commands whose results can conditionally produce references</td>
              </tr>
              <tr data-item="input_ports">
                <td>Input port</td>
                <td>{String(contracts.inputPorts.ports)}</td>
                <td>With target resource slots: {String(contracts.inputPorts.commands)} commands</td>
              </tr>
              <tr data-item="adapters">
                <td>Implemented result adapters</td>
                <td>{String(contracts.adaptersImplemented.length)}</td>
                <td>{contracts.adaptersImplemented.join(', ') || "None"}</td>
              </tr>
              <tr data-item="executable">
                <td>Execution allowed</td>
                <td>{String(contracts.executableCommands.length)}</td>
                <td>{contracts.executableCommands.join(', ') || "None"}</td>
              </tr>
              <tr data-item="edges">
                <td>Type-compatible edges</td>
                <td>{String(contracts.graph.edges)}</td>
                <td>
                  Conditional {String(contracts.graph.conditional)} · Direct {String(contracts.graph.direct)} · Same type, incompatible {String(contracts.graph.blockedSameType)}
                </td>
              </tr>
              <tr data-item="flows">
                <td>Executable workflows</td>
                <td>{String(contracts.executableFlows)}</td>
                <td>Recipes and multi-step execution are not enabled</td>
              </tr>
              <tr data-item="host">
                <td>Target GHES verification</td>
                <td>{String(contracts.hostVerified)}</td>
                <td>Commands verified on internal GHES</td>
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
          <small>{serviceMessage(gateScope, 'Only GATE-GH-01, 01b, and 01d are evaluated. Passing 01d does not complete REL-007; gates 01e, 06, 08 and target GHES support remain separate.')}</small>
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
        else setDetail({ kind: 'failed', message: loaded.kind === 'failed' ? loaded.message : `Unable to load details (${loaded.kind}).` });
      })
      .catch(() => {
        setDetail({ kind: 'failed', message: "Unable to load details." });
      });
  }, []);

  if (screen.kind === 'loading') {
    return (
      <div data-testid="gh-registry" data-state="loading" aria-busy="true">
        <p>Loading registry status…</p>
      </div>
    );
  }
  if (screen.kind === 'unavailable') {
    return (
      <div data-testid="gh-registry" data-state="unavailable">
        <EmptyState cause="not_found" title="GitHub operations are not enabled in this deployment" description="Registry queries are unavailable because GH_OPERATIONS_ENABLED is disabled. See runbook 7.C to enable it." />
      </div>
    );
  }
  if (screen.kind === 'no_permission') {
    return (
      <div data-testid="gh-registry" data-state="no_permission">
        <EmptyState cause="no_permission" title="The operator or security_officer role is required" description="Only operator and security_officer can view registry status." />
      </div>
    );
  }
  if (screen.kind === 'unauthenticated') {
    return (
      <div data-testid="gh-registry" data-state="unauthenticated">
        <ErrorBanner tone="warning" title="Session missing or expired" impact="Sign in again to return to this page." action={screen.loginPath === null ? undefined : <a href={screen.loginPath}>Sign in</a>} />
      </div>
    );
  }
  if (screen.kind === 'failed' || status === null) {
    return (
      <div data-testid="gh-registry" data-state="failed">
        <ErrorBanner tone="danger" title="Unable to load registry status" impact={screen.kind === 'failed' ? screen.message : "The response is empty."} correlationId={screen.kind === 'failed' ? screen.correlationId : null} action={<Button variant="secondary" onClick={() => setNonce((value) => value + 1)}>Reload</Button>} />
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
        <h2>gh and manifest used by this deployment</h2>
        <dl>
          <dt>Pinned gh version</dt>
          <dd data-testid="gh-registry-gh-version">{status.gh.pinned_version}</dd>
          <dt>Expected binary SHA-256</dt>
          <dd>
            <Hash value={status.gh.binary_sha256_expected} />
          </dd>
          <dt>Manifest version · hash</dt>
          <dd data-testid="gh-registry-manifest">
            {status.manifest.version} · <Hash value={status.manifest.hash} /> · {status.manifest.hash_verified ? "Hash verified" : "Hash mismatch"}
          </dd>
          <dt>Inventory hash</dt>
          <dd>
            <Hash value={status.manifest.inventory_hash} />
          </dd>
          <dt>Created at</dt>
          <dd>{formatTime(status.manifest.generated_at)}</dd>
          <dt>command</dt>
          <dd>
            All {String(status.manifest.command_count)} · leaf {String(status.manifest.leaf_command_count)} · Groups {String(status.manifest.group_command_count)} · Alias only {String(status.manifest.alias_only_command_count)} · help topic {String(status.manifest.help_topics)}
          </dd>
          <dt>Validator · rules</dt>
          <dd>
            {status.validator.version} / {status.validator.rules_version} · <StatusBadge status={status.validator.status} />
          </dd>
        </dl>
        {headline.kind === 'no_records' ? (
          <p data-testid="gh-registry-records-none" role="status">
            No validation record exists. The runner has not recorded a startup check or uses an older deployment. The status above validates the API's loaded manifest; only runner records compare it with the actual binary.
          </p>
        ) : null}
        {headline.kind === 'executor_unchecked' ? (
          <p data-testid="gh-registry-records-partial" role="status">
            No runner record exists — only {headline.other.checked_by} records ({label(STATUS_LABEL, headline.other.status)}, {formatTime(headline.other.checked_at)}) are available. Runner checks determine whether execution is rejected.
          </p>
        ) : null}
        {headline.kind === 'executor' ? (
          <p data-testid="gh-registry-records-executor" role="status" data-status={headline.latest.status} data-overdue={headline.overdue ? 'true' : 'false'}>
            Last runner check: <StatusBadge status={headline.latest.status} /> {formatTime(headline.latest.checked_at)}
            {headline.overdue ? "· More than two check intervals have elapsed. The runner or its checks may have stopped." : ''}
            {headline.servedMismatch ? "· Runner and API manifest hashes differ. Check both service image versions." : ''}
            {headline.latest.status === 'drift' || headline.latest.status === 'failed' ? "· The runner is rejecting new executions with registry_stale." : ''}
          </p>
        ) : null}
      </Panel>

      <Panel data-testid="gh-registry-execution">
        <h2>Execution allowed</h2>
        <p>
          Enabled capabilities {String(status.execution.allowed.length)} items: {status.execution.allowed.join(', ') || "None"} · Classified leaves: {String(status.coverage.classified_leaf_commands)}/ Unclassified: {String(status.coverage.unclassified_leaf_commands)} items
        </p>
        <p>
          <small>Execution is controlled jointly by EXECUTABLE_CAPABILITIES and the manifest, regardless of classification coverage. The validator rejects mismatches.</small>
        </p>
      </Panel>

      <Panel data-testid="gh-registry-verifications">
        <h2>Validation records (latest per source)</h2>
        {status.verification.latest_by_source.length === 0 ? (
          <p>No records</p>
        ) : (
          <Table caption="Latest runner (JOB-GH-003), CI, and CLI checks. Runner records determine execution rejection.">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Trigger</th>
                <th scope="col">Time</th>
                <th scope="col">Results</th>
                <th scope="col">Observed gh</th>
                <th scope="col">Inventory</th>
                <th scope="col">This manifest</th>
                <th scope="col">Validator/rules</th>
                <th scope="col">Report version</th>
                <th scope="col">Freshness</th>
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
            <h3>Drift — definition versus actual binary</h3>
            <ul>
              {drifted.drift.addedCommands.map((one) => (
                <li key={`+${one}`}>Binary only: {one}</li>
              ))}
              {drifted.drift.removedCommands.map((one) => (
                <li key={`-${one}`}>Manifest only: {one}</li>
              ))}
              {drifted.drift.changedCommands.map((one) => (
                <li key={`~${one}`}>Changed flags or JSON fields: {one}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>

      <Panel data-testid="gh-registry-coverage">
        <h2>Classification coverage by dimension (NFR-009)</h2>
        <ul data-testid="gh-registry-gates">
          {status.gates.map((gate) => (
            <li key={gate.id} data-gate={gate.id} data-pass={gate.pass ? 'true' : 'false'}>
              <Badge tone={gate.pass ? 'success' : 'warning'}>{gate.pass ? 'PASS' : 'FAIL'}</Badge> {gate.id} {gateLabel(gate)} — {gateDetail(gate)}
            </li>
          ))}
        </ul>
        <Table data-testid="gh-registry-dimensions" caption="Classified counts and denominators for each dimension. A zero denominator means undefined, not a percentage.">
          <thead>
            <tr>
              <th scope="col">Gate</th>
              <th scope="col">Dimension</th>
              <th scope="col">Classified/total</th>
              <th scope="col">Percentage</th>
              <th scope="col">Unclassified examples</th>
            </tr>
          </thead>
          <tbody>
            {status.coverage.dimensions.map((dimension) => (
              <tr key={dimension.id} data-dimension={dimension.id} data-unclassified={dimension.unclassified}>
                <td>{dimension.gate}</td>
                <td>
                  <span title={dimensionNote(dimension)}>{dimensionLabel(dimension)}</span>
                </td>
                <td>
                  {String(dimension.classified)}/{String(dimension.total)}
                </td>
                <td>{percentOf(dimension)}</td>
                <td>{dimension.unclassified === 0 ? '—' : `${dimension.unclassifiedSample.slice(0, 5).join(', ')}${dimension.unclassified > 5 ? `and more ${String(dimension.unclassified - 5)}` : ''}`}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <ContractsPanel contracts={status.contracts} gateScope={status.gate_scope} />

      <Panel data-testid="gh-registry-commands">
        <h2>Browse command classifications</h2>
        <p data-testid="gh-registry-support-summary">
          {bySupport.map((entry) => `${label(SUPPORT_LABEL, entry.value)} ${String(entry.count)}`).join(' · ') || "Unable to load list"}
        </p>
        <div>
          <TextField
            aria-label="Search commands"
            placeholder="e.g. pr merge, secret"
            value={filter.query}
            onChange={(event) => {
              setFilter((current) => ({ ...current, query: event.target.value }));
            }}
            data-testid="gh-registry-search"
          />
          <label>
            Support status {' '}
            <select
              data-testid="gh-registry-filter-support"
              value={filter.support}
              onChange={(event) => {
                setFilter((current) => ({ ...current, support: event.target.value }));
              }}
            >
              <option value="all">All</option>
              {Object.entries(SUPPORT_LABEL).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>{' '}
          <label>
            Run {' '}
            <select
              data-testid="gh-registry-filter-execution"
              value={filter.execution}
              onChange={(event) => {
                setFilter((current) => ({ ...current, execution: event.target.value }));
              }}
            >
              <option value="all">All</option>
              {Object.entries(EXECUTION_LABEL).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ul data-testid="gh-registry-command-list" aria-label="Commands">
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
          {filtered.length === 0 ? <li>No commands match these filters.</li> : null}
        </ul>
        {filtered.length > 250 ? <p>{String(filtered.length - 250)} items omitted. Narrow your search.</p> : null}

        <section aria-live="polite" data-testid="gh-registry-command-detail" data-state={detail.kind}>
          {detail.kind === 'loading' ? <p>Loading details…</p> : null}
          {detail.kind === 'failed' ? <p role="alert">{detail.message}</p> : null}
          {detail.kind === 'ok' ? <CommandDetail detail={detail.body} /> : null}
        </section>
      </Panel>

      <Panel data-testid="gh-registry-snapshots">
        <h2>Snapshots (one row per manifest hash)</h2>
        {status.snapshots.length === 0 ? (
          <p>No snapshots</p>
        ) : (
          <Table caption="Manifests observed by this deployment. Activation requires passing NFR-009 gates; this version has activated none.">
            <thead>
              <tr>
                <th scope="col">Hash</th>
                <th scope="col">Version</th>
                <th scope="col">gh</th>
                <th scope="col">leaf</th>
                <th scope="col">Unclassified</th>
                <th scope="col">Execution allowed</th>
                <th scope="col">First seen</th>
                <th scope="col">Activation</th>
                <th scope="col">Currently loaded</th>
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
                  <td>{row.activated_at === null ? "Not activated" : formatTime(row.activated_at)}</td>
                  <td>{row.is_served ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Panel data-testid="gh-registry-host">
        <h2>Target GHES verification</h2>
        <p data-status={status.host_verification.status}>
          <Badge tone="neutral">{status.host_verification.status === 'not_verified' ? "Unverified" : status.host_verification.status}</Badge> {serviceMessage(status.host_verification.note, 'Target GHES verification is separate from registry classification and operational approval.')}
        </p>
      </Panel>

      <p>
        <Button variant="secondary" data-testid="gh-registry-refresh" onClick={() => setNonce((value) => value + 1)}>
          Reload
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
        <dt>Run</dt>
        <dd>
          <Badge tone={detail.execution === 'allowed' ? 'accent' : 'neutral'}>{label(EXECUTION_LABEL, detail.execution)}</Badge>
          {detail.execution_reason === null ? null : <span> — {detail.execution_reason}</span>}
        </dd>
        <dt>Support · interaction · side effects · risk</dt>
        <dd>
          {label(SUPPORT_LABEL, detail.support)} · {label(INTERACTION_LABEL, classification?.interaction)} · {label(SIDE_EFFECT_LABEL, classification?.sideEffect)} · {detail.risk ?? '—'}
        </dd>
        <dt>Result · sensitivity · authentication · host verification</dt>
        <dd>
          {classification?.resultKind ?? '—'} · {classification?.sensitivity ?? '—'} · {classification?.auth ?? '—'} · {classification?.hostSupport === 'verified' ? "Verified" : "Unverified"}
        </dd>
        <dt>Input/output</dt>
        <dd>
          stdin {classification?.io.stdin ?? '—'} · File input {classification?.io.fileInputFlags.join(', ') || "None"} · File output {classification?.io.fileOutputFlags.join(', ') || "None"} · Output {classification?.io.outputFormats.join(', ') ?? '—'} · Context {classification?.io.contexts.join(', ') ?? '—'} · {classification?.io.paginated === true ? "Paginated" : "Not paginated"}
        </dd>
        <dt>Aliases</dt>
        <dd>{detail.aliases.length === 0 ? "None" : detail.aliases.join(', ')}</dd>
        <dt>Classification evidence</dt>
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
        <Table caption="Positional arguments and classification">
          <thead>
            <tr>
              <th scope="col">Position</th>
              <th scope="col">Required</th>
              <th scope="col">Repeatable</th>
              <th scope="col">Control</th>
              <th scope="col">Binding</th>
              <th scope="col">Rule</th>
            </tr>
          </thead>
          <tbody>
            {classification.positionals.map((positional) => (
              <tr key={positional.placeholder}>
                <td>
                  <code>{positional.placeholder}</code>
                </td>
                <td>{positional.required ? "Yes" : "No"}</td>
                <td>{positional.variadic ? "Yes" : "No"}</td>
                <td>{label(CONTROL_LABEL, positional.control)}</td>
                <td>{positional.binding ?? '—'}</td>
                <td>{positional.basis.rule ?? positional.basis.source}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      {classification !== null ? (
        <Table caption={`flag ${String(classification.flags.length)} items and classifications. Rule names provide evidence; the original text is in the title.`}>
          <thead>
            <tr>
              <th scope="col">flag</th>
              <th scope="col">Inherited</th>
              <th scope="col">Control</th>
              <th scope="col">Value</th>
              <th scope="col">Enum values</th>
              <th scope="col">Rule</th>
            </tr>
          </thead>
          <tbody>
            {classification.flags.map((flag) => (
              <tr key={`${flag.inherited ? 'i' : 'c'}-${flag.name}`} data-control={flag.control}>
                <td>
                  <code title={flag.basis.evidence}>--{flag.name}</code>
                  {flag.secretInput === true ? <Badge tone="danger">Secret value</Badge> : null}
                </td>
                <td>{flag.inherited ? "Yes" : "No"}</td>
                <td>{label(CONTROL_LABEL, flag.control)}</td>
                <td>{flag.valueKind}</td>
                <td>{flag.enumValues === null ? '—' : flag.enumValues.join(' | ')}</td>
                <td>{flag.basis.rule ?? flag.basis.source}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p>Group or alias-only nodes have no classification.</p>
      )}
      {detail.json_fields.length > 0 ? (
        <p>
          <small>--json fields {String(detail.json_fields.length)} items: {detail.json_fields.join(', ')}</small>
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
    return <p data-testid="gh-registry-contract-absent">This older response format does not include result contracts.</p>;
  }
  if (contract === null) {
    return (
      <p data-testid="gh-registry-contract-absent">
        {detail.alias_of === null ? "Groups and unclassified commands have no result contract." : `Aliases share the contract of gh ${detail.alias_of.join(' ')} rather than defining their own.`}
      </p>
    );
  }
  return (
    <section data-testid="gh-registry-contract" data-composability={contract.composability} aria-label="Result contract">
      <h4>Result contract</h4>
      <dl>
        <dt>Primary result · sensitivity</dt>
        <dd>
          {contract.kind} · {contract.sensitivity}
        </dd>
        <dt>Connectability</dt>
        <dd>
          <Badge tone={contract.bindable ? 'accent' : 'neutral'}>{label(COMPOSABILITY_LABEL, contract.composability)}</Badge>
        </dd>
        <dt>Resource</dt>
        <dd data-testid="gh-registry-contract-resource">
          {refTypeLabel(contract.resourceKind)} — {contract.resourceBasis}
        </dd>
        <dt>Evidence</dt>
        <dd>{contract.basis.evidence}</dd>
      </dl>
      <Table data-testid="gh-registry-contract-outputs" caption="Result contracts vary by output mode. Default and --json output have different contracts.">
        <thead>
          <tr>
            <th scope="col">Mode</th>
            <th scope="col">Results</th>
            <th scope="col">adapter</th>
            <th scope="col">Schema</th>
            <th scope="col">Connection</th>
            <th scope="col">Reason</th>
          </tr>
        </thead>
        <tbody>
          {contract.outputs.map((output) => (
            <tr key={output.mode} data-mode={output.mode} data-bindable={output.bindable ? 'true' : 'false'}>
              <td>{output.mode}</td>
              <td>{output.kind}</td>
              <td>{label(ADAPTER_LABEL, output.adapter)}</td>
              <td>{output.schema ?? '—'}</td>
              <td>{output.bindable ? "Available" : "Unavailable"}</td>
              <td>{output.reason ?? output.unstructuredReason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <PortTable title="Output port" ports={contract.outputPorts} note={contract.outputPortsNote} testId="gh-registry-output-ports" />
      <PortTable title="Input port" ports={contract.inputPorts} note={contract.inputPortsNote} testId="gh-registry-input-ports" />
      {detail.graph === undefined || detail.graph === null ? null : <GraphSection graph={detail.graph} />}
    </section>
  );
}

function PortTable({ title, ports, note, testId }: { readonly title: string; readonly ports: readonly PortView[]; readonly note: string | null; readonly testId: string }): ReactNode {
  return (
    <div data-testid={testId}>
      <h5>{title}</h5>
      {ports.length === 0 ? (
        <p>None — {note ?? "No reason provided"}</p>
      ) : (
        <Table caption={`${title}: type, cardinality, required, null, sensitivity, conditions`}>
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Type</th>
              <th scope="col">Count</th>
              <th scope="col">Required</th>
              <th scope="col">null</th>
              <th scope="col">Sensitivity</th>
              <th scope="col">Filters</th>
            </tr>
          </thead>
          <tbody>
            {ports.map((port) => (
              <tr key={port.id} data-port={port.id}>
                <td>
                  <code>{port.id}</code>
                </td>
                <td>{refTypeLabel(port.type)}</td>
                <td>{port.cardinality === 'many' ? "List" : "One"}</td>
                <td>{port.required ? "Yes" : "No"}</td>
                <td>{port.nullable ? "Yes" : "No"}</td>
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
        <p>None</p>
      ) : (
        <Table caption={title}>
          <thead>
            <tr>
              <th scope="col">{direction === 'outgoing' ? "Input command" : "Output command"}</th>
              <th scope="col">Type</th>
              <th scope="col">Evaluation</th>
              <th scope="col">Filters</th>
              <th scope="col">Run</th>
            </tr>
          </thead>
          <tbody>
            {edges.map((edge) => (
              <tr key={edgeKey(edge)} data-edge={edgeKey(edge)} data-verdict={edge.verdict} data-executable={String(edge.execution.executable)}>
                <td>{direction === 'outgoing' ? `${commandLabel(edge.to)} (${edge.toPort})` : `${commandLabel(edge.from)} (${edge.fromPort})`}</td>
                <td>{refTypeLabel(edge.type)}</td>
                <td>{edge.verdict === 'direct' ? "Directly compatible" : "Conditionally compatible"}</td>
                <td>{describeConditions(edge.conditions)}</td>
                <td>
                  <Badge tone="neutral">Execution disabled</Badge> {edge.execution.reason}
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
      <h5>Connection candidates (type evaluation)</h5>
      <p>
        <small>Compatibility does not grant execution approval. The code allowlist controls execution. Executable multi-step workflows: {String(graph.executable_flows)} items.</small>
      </p>
      <EdgeTable title="Commands that can consume this result" edges={graph.outgoing} direction="outgoing" />
      <EdgeTable title="Results that can feed this command" edges={graph.incoming} direction="incoming" />
      {graph.blocked.length === 0 ? null : (
        <Table data-testid="gh-registry-graph-blocked" caption="Same-type pairs that cannot connect, with reasons">
          <thead>
            <tr>
              <th scope="col">Output</th>
              <th scope="col">Input</th>
              <th scope="col">Reason</th>
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
