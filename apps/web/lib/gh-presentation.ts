import type { DimensionView, GateView } from './gh-registry';
import { serviceMessage } from './service-message';

export function capabilityTitle(capability: { readonly id: string; readonly title: string }): string {
  return serviceMessage(capability.title, capability.id === 'pr.list' ? 'List pull requests' : capability.id);
}

/** Display labels are separate from the signed command definitions and validation reports. */
const DIMENSIONS: Readonly<Record<string, readonly [label: string, note: string]>> = {
  command_path: ['Core command path coverage', 'Leaf commands, excluding groups and alias-only nodes. Classified means support is known.'],
  command_alias: ['Command alias coverage', 'Commands with aliases and alias-only nodes. Alias targets must exist and be classified or navigational groups.'],
  positional: ['Positional argument coverage', 'Top-level USAGE positions, excluding [flags] and including passed-through arguments. Classified means control is known.'],
  command_flag: ['Command-specific flag coverage', 'FLAGS entries across all commands, including executable groups. Classified means control is known.'],
  inherited_flag: ['Inherited/global flag coverage', 'INHERITED FLAGS occurrences across commands, not the number of unique flag names.'],
  short_alias: ['Short/long alias coverage', 'Flags with short aliases, including inherited occurrences. Classified means control is known.'],
  repeatable_flag: ['Repeatable flag coverage', 'Command-specific flags accepting repeatable string values.'],
  interaction: ['Interaction mode coverage', 'Each leaf command must have a classified interaction mode.'],
  io_mode: ['Input/output mode coverage', 'Leaf commands with defined input, output formats, and execution context requirements.'],
  json_field: ['JSON field coverage', 'Fields from JSON FIELDS sections. Input flags such as workflow run --json are excluded.'],
  result_contract: ['Result contract coverage', 'Leaf commands with consistent result contracts, output-mode adapters, and schemas or reasons why output cannot be structured.'],
  bindability: ['Bindability coverage', 'Leaf commands with composability consistent with their output modes and ports, including reasons for missing ports.'],
  resource_type: ['Resource type coverage', 'Leaf commands with a resource kind and evidence, or a reason why the result is not a resource.'],
  secret_output: ['Secret output coverage', 'Leaf commands with classified sensitivity. Secret results cannot be bound and must have no output ports.'],
  output_port: ['Output port coverage', 'The denominator counts bindable leaf commands, not ports. Ports must match the identifier fields, schema, and conditions. A zero denominator does not pass.'],
  input_port: ['Input port coverage', 'The denominator counts leaf commands with target resource slots, not ports. Each slot requires matching type, cardinality, and conditions. A zero denominator does not pass.'],
  io_port: ['Input/output port coverage', 'Legacy combined port coverage. Use the report version to interpret this dimension.'],
  extension_split: ['Core/extension coverage separation', 'Extension-plane commands are counted separately from core leaf commands.'],
  host_support: ['Target GHES verification', 'Commands actually verified against the internal GHES. Unverified does not mean unsupported.'],
  graph_edges: ['Capability graph edges', 'Compatible output-to-input pairs. Compatibility does not authorize execution.'],
  opaque_text: ['Opaque text results', 'Leaf commands whose result structure cannot be trusted for binding.'],
  adapter_implemented: ['Implemented result adapters', 'Schemas the runner actually produces, distinct from schemas merely defined in a result contract.'],
  executable_flows: ['Executable multistep flows', 'Multistep Recipe execution is not enabled.'],
};

export function dimensionLabel(dimension: DimensionView): string {
  return DIMENSIONS[dimension.id]?.[0] ?? serviceMessage(dimension.label, dimension.id);
}

export function dimensionNote(dimension: DimensionView): string {
  return serviceMessage(dimension.note, `${DIMENSIONS[dimension.id]?.[1] ?? dimensionLabel(dimension)} Denominator: ${dimension.total}.`);
}

export function gateLabel(gate: GateView): string {
  const labels: Readonly<Record<string, string>> = {
    'GATE-GH-01': 'Capability coverage (NFR-009)',
    'GATE-GH-01b': 'Core/extension separation',
    'GATE-GH-01d': 'Result contract coverage (CR-009)',
  };
  return labels[gate.id] ?? serviceMessage(gate.label, gate.id);
}

export function gateDetail(gate: GateView): string {
  return serviceMessage(gate.detail, gate.pass ? 'All gate dimensions passed.' : `Gate requirements were not met. Review: ${gate.dimensions.join(', ')}.`);
}
