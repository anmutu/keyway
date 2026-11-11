# Window Alert Settings Implementation Plan

> Execute inline in the current session, following test-driven-development and verification-before-completion. The user approved the design and requested implementation.

**Goal:** Make edited reminder conditions take effect during the current quota window.

**Architecture:** Atomically save effective settings and rearm window reminders only when their conditions change. Share a transactional send-and-record path between immediate settings checks and the existing heartbeat.

**Tech Stack:** Rust, Tauri, rusqlite/SQLCipher, React, TypeScript.

## Task 1: Reproduce and repair rearming

Files: `src-tauri/src/services/billing.rs`, `src-tauri/src/services/billing/alert_tests.rs`.

- [x] Add in-memory settings database tests that seed `billing.alert.fired.win.provider`, change 100 minutes to 95, and require the old window marker to be absent. Cover percentage/enabled changes, unchanged/clamped saves, peak-only changes, and transactional rollback.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --lib services::billing::` and observe the expected rearming failures.
- [x] Save config and delete only `billing.alert.fired.win.*` markers in one SQLite transaction when effective window fields change; return whether they changed.

## Task 2: Evaluate immediately and preserve reliable delivery

Files: `src-tauri/src/services/billing.rs`, `src-tauri/src/commands/billing.rs`, `src/i18n/dict.ts`.

- [x] Share window checks through a function with an injectable notification submission closure. Serialize reads, send, and success-marker persistence with a SQLite write transaction.
- [x] Test an edited threshold before and after eligibility, unchanged-rule deduplication, returning to an older threshold, new windows, independent providers, submission failure, and concurrent checks.
- [x] After a successful changed-window-settings save, invoke window-only checks immediately for providers with billing policies.
- [x] Explain in both locales that editing conditions restarts evaluation, with immediate notification when eligible.

## Task 3: Verify and prepare the local app

- [x] Run the focused billing tests, all Rust tests, frontend/site tests, `cargo fmt --check`, `npm run build`, preset validation, and `git diff --check`. Results: 147 Rust tests and 28 frontend/site tests pass; 20 billing tests included.
- [x] Review the complete diff against the approved behavior and leave unrelated work untouched. Independent read-only review found no actionable issue under the documented asynchronous-adapter contract.
- [x] Build, ad-hoc sign, and verify the macOS app. With sandbox approval, back up the old app, replace `/Applications/Keyway.app`, restart, and verify the running app health endpoint plus installed/built binary hash equality. Health reports `status: ok`; existing release version remains 0.2.27. No public release was made.
