<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 -->

# 30_technical_architecture

## Purpose

Implementation architecture layer for PR Search. Documents here translate approved SRS/PRD scope and derived UI specs into system, frontend, backend, API, data, async, security, infrastructure, observability, and ADR decisions.

## For AI Agents

- Do not add product scope from architecture docs.
- Every major architecture decision must cite requirement IDs, quality attributes, or ADRs.
- `ADR-###` records architecture decisions; product open decisions are `OD-###` and live in the requirements layer.
- Keep API, data, job, event, and release IDs stable.
- Naming for entities, APIs, and events follows `../10_requirements/glossary.md`.
- If architecture requires new product behavior, open a CR and update `../10_requirements/srs_final.md` first, then cascade.
