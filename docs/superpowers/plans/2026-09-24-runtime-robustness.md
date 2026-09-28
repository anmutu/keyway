# Runtime Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make configuration import/export and asynchronous dashboard polling fail loudly and avoid stale state without changing product behavior.

**Architecture:** Keep the existing Tauri command and React component boundaries. Reuse already-loaded provider data in `commands/config.rs`, propagate existing `Result` values, and use request-generation guards plus cleanup flags for UI IPC calls.

**Tech Stack:** Rust 2021, Tauri 2, rusqlite/r2d2, React 19, TypeScript, Vite.

---

### Task 1: Reuse the provider snapshot during config export

**Files:**
- Modify: `src-tauri/src/commands/config.rs:12-71`
- Test: `src-tauri/src/commands/config.rs:268-352`

- [ ] Add a focused unit test that passes a provider snapshot and profile JSON to a profile-export helper and asserts known IDs become names while unknown IDs are omitted.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml commands::config::tests::profile_export_uses_loaded_provider_records` and confirm it fails because the helper is not implemented.
- [ ] Load `Vec<Provider>` once in `build_config`, use it both for provider JSON and profile name mapping, and preserve the current empty-object behavior for missing or malformed profile JSON.
- [ ] Run the focused test and the existing `export_import_roundtrip` test; both must pass.

### Task 2: Stop swallowing config-import database errors

**Files:**
- Modify: `src-tauri/src/commands/config.rs:146-263`
- Test: `src-tauri/src/commands/config.rs:278-352`

- [ ] Replace ignored endpoint upsert errors with `map_err(...)?`.
- [ ] Replace the route cache's `unwrap_or_default()` with an error-propagating `route_dao::list_by_app` call.
- [ ] Replace ignored preset and profile `kv::set` errors with propagated command errors.
- [ ] Run all config command tests and confirm the round-trip behavior remains unchanged.

### Task 3: Make Gateway polling lifecycle-safe

**Files:**
- Modify: `src/components/providers/GatewayStatusStrip.tsx:64-97`

- [ ] Add a cleanup flag and one in-flight guard for `gateway_status`.
- [ ] Add the same lifecycle and overlap protection for `get_degraded_providers`.
- [ ] Keep demo data and the existing 30/60-second cadence unchanged.
- [ ] Run `npm run build` and confirm TypeScript compilation succeeds.

### Task 4: Ignore stale usage-dashboard responses

**Files:**
- Modify: `src/components/usage/UsagePage.tsx:1,213-247`

- [ ] Add a request-generation ref and increment it for every reload.
- [ ] Apply data, errors, and loading state only when the request is still current.
- [ ] Invalidate the generation in the effect cleanup so an unmounted component cannot receive a result.
- [ ] Run `npm run build` and confirm TypeScript compilation succeeds.

### Task 5: Verify the focused patch

**Files:**
- Inspect: `git diff --check`
- Inspect: `git status --short`

- [ ] Run `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml --lib` and the API-key integration test.
- [ ] Run `npm run build`.
- [ ] Report loopback proxy integration tests separately if the sandbox still denies local socket binding.
