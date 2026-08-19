# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Repository Type

This repository is a documentation-first SRS/PRD product planning environment for PR Search. It supports full product implementation planning across product, UX, frontend, backend, API, data, infrastructure, security, operations, QA, delivery, and post-handoff implementation tracking.

## Product Context

PR Search is an internal, read-only search and analytics dashboard over an organization's GitHub Enterprise pull requests and commits. It exists because the organization migrated from Perforce to Git and lost range-based investigation: a Perforce Changelist number is assigned at submit time, so `number order = landing order`, while a GitHub PR number is assigned at creation time and says nothing about merge order.

The product restores that with three things:

- **Merge sequence** — a 1-based ordinal per `(repository, base branch)` derived from `git rev-list --first-parent --reverse`. Every sequence value carries a `seq_epoch`; a force-push to the base branch bumps the epoch and invalidates prior range citations rather than silently shifting them (ADR-007).
- **Bidirectional identifier resolution** — commit SHA → PR and PR → commits, with abbreviated-SHA prefix search (minimum 7 characters, ADR-012).
- **Relationship edges** — precedes, contains, references, reverts, cherry-picks, stacks-on, co-changes. Every edge stores evidence text and a confidence tier (`exact` / `derived` / `heuristic`).

Stack decisions are settled in ADR-001 through ADR-012 and are not re-litigated during implementation: TypeScript across every layer, Fastify services, Next.js App Router with the internal Conductor design system, PostgreSQL as the system of record, Elasticsearch as a fully rebuildable derived view, Redis Streams behind an `EventBus` port (Kafka is an adapter swap, not a rewrite), and Filebeat only for the immutable raw-event archive lane.

Three invariants matter more than anything else when reviewing or writing docs here:

1. Merge sequence must be verifiable against `git log --first-parent`. Any design that cannot be checked against Git is wrong.
2. Every Elasticsearch read passes through the mandatory access-scope filter; the type system enforces it (ADR-008).
3. Elasticsearch is rebuildable from PostgreSQL alone. Nothing may exist only in the search index (ADR-004).

Current state: documentation only, no code. `docs/10_requirements/srs_final.md` is `review`; it needs user approval to reach `baseline` before implementation starts.

## Core Working Principle

Favor correctness, traceability, and minimal changes over speed. Do not assume missing requirements. Surface ambiguity, document assumptions and open decisions (`OD-###`), and preserve the hierarchy of source documents.

## Document Hierarchy

- `docs/00_governance/`: rules and change control that govern every other document.
- `docs/10_requirements/`: authoritative product scope, glossary, and traceability.
- `docs/20_derived_ui_specs/`: screen-level documents derived from approved requirements.
- `docs/30_technical_architecture/`: implementation architecture derived from requirements and UI specs.
- `docs/40_delivery/`: release slices, validation, work packages, and the implementation traceability ledger.

## Conflict-Resolution Priority

1. `docs/10_requirements/srs_final.md`
2. `docs/10_requirements/prd.md`
3. `docs/10_requirements/workflow.md`
4. `docs/10_requirements/feature.md`
5. `docs/10_requirements/glossary.md`
6. `docs/10_requirements/requirements_screen_traceability_matrix.md`
7. `docs/20_derived_ui_specs/pr_search_product_ia.md`
8. Remaining derived UI specs
9. `docs/30_technical_architecture/*`
10. `docs/40_delivery/*`
11. AI-agent implementation request and execution brief

Derived UI, technical architecture, delivery docs, and agent briefs can never expand scope beyond the SRS or PRD. If downstream docs need something the SRS does not grant, open a CR and update the SRS first.

## Document Status Headers

Planning deliverables carry `> 상태: draft | 버전: vX.Y | 갱신일: YYYY-MM-DD` under their title.

- `draft` -> `review` -> `baseline`. Only the user authorizes `baseline`.
- Do not fill agent briefs or work packages to `review`+ while `srs_final.md` is `draft`.
- Changing a `baseline` document requires a CR in `docs/00_governance/change_control.md` first.

## Update Cascade

1. Register `CR-###` in `docs/00_governance/change_control.md`
2. `srs_final.md`
3. `prd.md`
4. `glossary.md` (when terms change)
5. `requirements_screen_traceability_matrix.md`
6. Derived UI specs in `docs/20_derived_ui_specs/`
7. Technical architecture docs in `docs/30_technical_architecture/`
8. Delivery docs in `docs/40_delivery/` (roadmap, validation, work packages, ledger)
9. AI-agent implementation request and execution brief
10. Record the cascade and validator result in the CR, then close it

## ID Conventions

- Functional requirements: `FR-<AREA>-###`
- Nonfunctional requirements: `NFR-###`
- Open (product) decisions: `OD-###`
- Scenarios: `SCN-###`
- Screens: `D-###`, `W-###`, `A-###`
- Components: `C-###`
- Flows: `FLOW-###`
- Architecture decisions: `ADR-###`
- API operations: `API-<AREA>-###`
- Data entities: `ENT-<AREA>-###`
- Jobs: `JOB-<AREA>-###`
- Events: `EVT-<AREA>-###`
- Release slices: `REL-###`
- Work packages: `WP-###`
- Change requests: `CR-###`
- Implementation deviations: `DEV-###`

## Verification

Since this may be a documentation-only repository, verification is manual and link-based unless code tooling exists.

```bash
rg "FR-[A-Z0-9]+-[0-9]+" docs/
rg "\b[DWA]-[0-9]{3}" docs/
rg "\b(API|ENT|JOB|EVT)-[A-Z0-9]+-[0-9]{3}|\b(REL|WP|CR|DEV|OD|FLOW)-[0-9]{3}" docs/
rg "TODO|TBD|미정|결정 필요" docs/
```

## Application Code Guidelines

Apply this section once application source code exists.

- Code implements the approved scope from `srs_final.md`; candidate-only ideas in `feature.md` are not implementable.
- Work through `docs/40_delivery/pr_search_work_packages.md` one WP at a time; respect each WP's 제외 list.
- Reference IDs in commits/PRs (`Refs: WP-001 FR-CORE-001`) and in test names for the FR/AC they verify.
- After each completed WP, update `docs/40_delivery/pr_search_implementation_traceability.md` (status, commit/PR, verification result, FR-to-code mapping).
- If docs and reality conflict, register `DEV-###` in the ledger and `CR-###` in change control. Never silently change behavior away from the SRS.
