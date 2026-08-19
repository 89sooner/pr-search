<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 -->

# docs

## Purpose

Root of all product planning documentation. The numbered directories encode priority and reading order: governance defines the rules, requirements lock scope, derived UI specs translate approved scope, technical architecture shapes implementation, and delivery packages execution.

## For AI Agents

- Start at `README.md` before editing anything else.
- Do not rename numbered directories unless the governance docs are updated first.
- When adding a document, register it in `README.md` and `00_governance/document_definitions.md`.
- Derived docs must not contradict `10_requirements/srs_final.md`.
- Keep every document's status header (`> 상태:`) current when its content materially changes.

## Testing Requirements

- Verify every referenced path resolves.
- Grep for old names after renames.
- Check requirement IDs and screen IDs after traceability edits.
- Run the bundled validator before claiming a phase complete.
