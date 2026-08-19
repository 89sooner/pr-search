<!-- Generated: 2026-08-19 -->

# PR Search

## Purpose

Documentation-first product planning repository for PR Search. This repo holds governance and change-control rules, PRD/SRS requirements, a domain glossary, traceability, derived UI specifications, technical architecture, delivery planning, work packages, an implementation traceability ledger, QA gates, and AI-agent execution briefs.

## What the product is

PR Search collects pull requests and commits from an internal GitHub Enterprise via webhooks, indexes them into Elasticsearch, and gives engineers two things Git took away when the organization migrated off Perforce:

1. **Merge sequence** — a monotonically increasing ordinal per `(repository, base branch)`, derived from the branch's first-parent commit chain. It restores what a Perforce Changelist number provided: "everything up to N is verified", "investigate the range N..M". PR numbers cannot do this because GitHub assigns them at creation time, not at merge time.
2. **Bidirectional identifier resolution** — commit SHA → PR and PR → commits in a single lookup, plus a relationship graph (precedes/contains/references/reverts/cherry-picks/stacks/co-changes) with evidence and confidence on every edge.

Stack: TypeScript everywhere, PostgreSQL as the system of record, Elasticsearch as a rebuildable derived search view, and the internal `design-system` (Conductor) for UI. The settled decisions live in ADR-001 through ADR-012; implementation agents follow them rather than re-deciding.

Current state: **documentation only.** No code yet. `srs_final.md` is `review` and needs user approval to become `baseline` before implementation starts.

## Key Files

| File | Description |
| --- | --- |
| `docs/README.md` | Master index, reading order, priority rules, and update cascade |
| `docs/10_requirements/srs_final.md` | Final implementation baseline and highest-priority product truth |
| `docs/00_governance/change_control.md` | Change requests (CR), gate log, cascade records |
| `docs/40_delivery/pr_search_work_packages.md` | Agent-session-sized work packages (WP) derived from release slices |
| `docs/40_delivery/pr_search_implementation_traceability.md` | Living docs-to-code ledger once implementation starts |

## Subdirectories

| Directory | Purpose |
| --- | --- |
| `docs/00_governance/` | Document roles, priority, workflow rules, change control |
| `docs/10_requirements/` | Feature candidates, PRD, workflow, glossary, SRS, traceability |
| `docs/20_derived_ui_specs/` | IA, wireframes, flows, states, components, tokens, QA, agent briefs |
| `docs/30_technical_architecture/` | System, frontend, backend, API, data, async, security, infra, observability architecture |
| `docs/40_delivery/` | Implementation roadmap, release validation, work packages, implementation ledger |

## For AI Agents

- Read `docs/README.md` before editing planning documents.
- Never invent requirements. Approved scope starts in `docs/10_requirements/srs_final.md`.
- Conflict priority: `srs_final.md` > `prd.md` > `workflow.md` > `feature.md` > `glossary.md` > traceability matrix > derived UI specs > technical architecture > delivery docs > AI-agent briefs.
- Scope or baseline changes start with a CR entry in `docs/00_governance/change_control.md`, then cascade from `srs_final.md` downward in the order defined by `docs/README.md`.
- Document status headers (`> 상태: draft | review | baseline`) are binding. Only the user authorizes `baseline`.
- Keep IDs stable. Deprecate by marking; do not renumber.
- Once code exists: tag commits/PRs/tests with FR/WP IDs, update the implementation traceability ledger after every work package, and route doc/code conflicts through DEV -> CR instead of silently changing behavior.
- Preserve the repository language and document style.

## Testing Requirements

This repository may be documentation-only. If no application source exists, validate with document checks:

```bash
rg "FR-[A-Z0-9]+-[0-9]+" docs/
rg "\b[DWA]-[0-9]{3}" docs/
rg "\b(API|ENT|JOB|EVT)-[A-Z0-9]+-[0-9]{3}|\b(REL|WP|CR|DEV|OD|FLOW)-[0-9]{3}" docs/
rg "docs/.+\.md" docs/
```

## Dependencies

None by default.
