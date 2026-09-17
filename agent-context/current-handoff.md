# Current Handoff — 2026-09-17 PR Search pilot.12

## Start here

`main` is clean at `aadf2f29087c96d5a46a47234479c63fd3fce0fc`. Do not recreate or amend the released code unless a new user request requires it. The current completed deliverable is CR-098/099: internal permission-name compatibility and PR-first Repository workspace search.

## Delivered

- PR #203 (`05687c2`): accept GHE `read`/`write`/`writer`, restrict Workspace menu to operator, remove obsolete left text, preserve Legacy UI.
- PR #205 (`990d6ad`): Base branch/Label facet selects, Radix date calendar, `is:merged` UI query, `#` GHE PR links, M number display, `pr_number DESC`, stronger badges.
- PR #206 (`aadf2f2`): release evidence recorded in CR/WP/traceability docs.
- `0.1.0-pilot.12` is immutable and targets `990d6ad95e683c8023c5512c9a9f7733481eb090`.

## Verify before changing code

1. `git status --short --branch` must remain clean on main.
2. Read `agent-context/files.md` 2026-09-17 section for paths and `decisions.md` for contracts.
3. For a search issue, reproduce with `node scripts/verify-source-workspace.mjs`, then compare browser request, search-api response, and ES data.
4. Never delete `SearchView.tsx` or `LegacyRepositoryWorkspace.tsx`; they are intentionally operator-only Legacy paths.

## Open boundary

Real internal GHE data/permissions/re-import verification is NOT RUN. Validate `read`/`write`/`writer`, `is:merged`, facets, and GHE PR links only in the internal environment. An immutable pilot.12 correction requires a new release, not asset/tag mutation.

## References

- https://github.com/89sooner/pr-search/pull/203
- https://github.com/89sooner/pr-search/pull/205
- https://github.com/89sooner/pr-search/pull/206
- https://github.com/89sooner/pr-search/releases/tag/0.1.0-pilot.12
