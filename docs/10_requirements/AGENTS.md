<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 -->

# 10_requirements

## Purpose

Authoritative requirements layer. `srs_final.md` is the single source of truth for approved scope; all other files either feed it, define its vocabulary, explain it, or map it to downstream documents.

## For AI Agents

- Treat `srs_final.md` as frozen once its status is `baseline`; changes require a CR in `../00_governance/change_control.md`.
- `feature.md` is an idea pool, not approved scope.
- Every FR must be a full block: statement, source, acceptance criteria, verification method, related IDs. No one-line requirements.
- Domain nouns must resolve in `glossary.md`; rename terms there first, then cascade.
- Open product decisions use `OD-###` (not `ADR-###`, which is architecture-only).
- When the SRS changes, update the traceability matrix in the same pass.
- Never introduce a requirement ID that is absent from traceability.
