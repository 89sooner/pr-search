<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 -->

# 40_delivery

## Purpose

Delivery planning layer for PR Search. Documents here convert approved requirements and architecture into release slices (REL), validation gates, agent-session-sized work packages (WP), and the implementation traceability ledger.

## For AI Agents

- Delivery docs package approved work; they do not add scope.
- Every REL slice must be decomposed into WPs before handoff; every WP must reference at least one FR and define a checkable DoD.
- Cross-functional dependencies must be explicit.
- Release validation must include product, frontend, backend, API, data, infrastructure, security, accessibility, performance, observability, and rollback checks.
- The traceability ledger is updated after every completed WP; doc/code conflicts become DEV entries linked to CRs.
