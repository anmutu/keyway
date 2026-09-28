# Runtime Robustness Design

## Goal

Reduce silent configuration-import failures and stale asynchronous UI updates without changing routing policy or introducing a frontend test framework.

## Scope

- Reuse the provider records already loaded during configuration export instead of querying the database again and swallowing errors.
- Propagate database errors while importing endpoints, route-rule caches, presets, and profiles.
- Prevent Gateway status polling from overlapping and from updating state after unmount.
- Prevent usage dashboard responses from an older app/range selection from overwriting the latest selection.
- Add focused Rust regression coverage and validate the frontend with the existing production build.

## Non-goals

- No routing-policy changes.
- No visual redesign.
- No new dependencies or frontend test framework.
- No changes to the existing uncommitted feature work.

## Acceptance criteria

1. Export profiles are derived from the same provider snapshot as the exported provider list.
2. Import stops with a descriptive error instead of silently ignoring database write/read failures.
3. Gateway polling has at most one in-flight request per poller and ignores results after cleanup.
4. Usage dashboard only applies the newest request result.
5. `npm run build`, Rust formatting, and non-network Rust tests pass; loopback integration-test restrictions are reported separately.
