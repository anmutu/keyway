# Gateway Information Hierarchy Implementation Plan

**Goal:** Keep provider selection primary and move routine gateway diagnostics behind the existing navigation status entry.

**Architecture:** Reuse the takeover dialog for gateway details. Render a compact provider summary in the main page and keep offline, drift and degraded-provider alerts actionable. No backend or persisted configuration changes.

**Tech Stack:** React, TypeScript, Radix Dialog, Tailwind, existing Tauri IPC.

## Approved design
- Sidebar footer status opens gateway details and takeover management. Top/bottom layouts retain the equivalent compact entry.
- Main page shows the current CLI, default provider and switch/log actions; no address, version, other CLI defaults or global counters.
- Address, version, CLI defaults, counters and latest destination remain available in the dialog.
- Offline and active-but-ineffective takeover remain prominent. Inactive/unconfigured CLIs are neutral in details.

## Execution
- [x] Inspect current components and capture the main-page baseline.
- [x] Update GatewayStatusStrip with summary/details rendering and demand-loaded diagnostics.
- [x] Embed details in TakeoverDialog; preserve navigation entry, keyboard access and existing takeover actions.
- [x] Verify normal, drift, details, unknown/offline states, Chinese/English and narrow layouts.
- [x] Run TypeScript/production build and diff whitespace checks; record actual results.

## Validation
Use the local browser demo to inspect the main page, open/close details and switch to the drifted Gemini group. Verify footer entry and no top-level address, version or unrelated CLI states at desktop and 375px widths. Exercise offline/unknown rendering through a temporary component fixture without changing real CLI configuration. Run `npm run build` and `git diff --check`. No commit or push.

## Results
- Browser baseline confirmed the address was in the main content; after the change, the main content contains the provider summary and no gateway address.
- Normal Claude/Codex pages, Gemini drift alert, detail-to-logs navigation, and Escape dismissal verified in demo mode.
- All four navigation entries open the same dialog, including unknown gateway status. Top, bottom, right and left layouts were verified through a temporary component fixture using only local React state, without changing persisted layout preferences. Fixture console had no errors/warnings and the fixture was removed afterward.
- Chinese and English UI checked at desktop and 375px widths. Fixed dialog grid overflow (375px viewport: dialog client/scroll widths both 373px) and compacted summary actions.
- Escape now returns focus to the invoking status button; diagnostic links are inert while a takeover mutation is busy.
- Temporary IPC fixture verified offline/degraded alerts, a usable unknown-status footer entry, and unavailable details rendered as dashes rather than false zeroes/unconfigured states. No gateway-status requests before opening details; the counter stopped advancing after closing. Fixture removed afterward.
- `npm run build` and `git diff --check` passed. No native CLI configurations changed, no new dependencies, no commit or push.
