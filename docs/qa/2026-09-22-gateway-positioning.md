# Gateway positioning and status clarity

## Approved direction

Keyway is a proxy-first local gateway for AI CLIs. Its positioning is clear,
controllable request destinations, not an exclusive claim to switching or failover.

## Implementation scope

1. Align the bilingual landing page, guide, README, and app copy around request
   destinations, diagnostics, and recovery. Remove unverified competitor claims.
2. Explain encrypted API-key storage, first-time CLI restart requirements,
   routing overrides, and the dependency on a running local proxy.
3. Replace the hardcoded running status with listener lifecycle state. Display
   default-provider selection separately from takeover and proxy status, with
   direct links to takeover management and request logs.
4. Preserve existing work. Do not change routing policy, add dependencies, or
   commit/push as part of this iteration.

## Verification plan

- Reproduce the false-positive proxy status before changing it.
- Exercise startup, successful listening, bind failure, and task cancellation.
- Build the frontend and run existing backend tests.
- Inspect bilingual desktop/mobile pages and the product demo, including status
  actions, text wrapping, and browser console errors.

## Boundaries

The selected provider is a default, not evidence of a request's actual destination.
Listener availability does not establish upstream health. First-time Codex takeover
may require a new session. Closing the window and quitting the app are different.

## Verification results

- The original no-listener test failed because `proxy_status` returned `true`.
  After the fix, both status unit tests pass. The integration test confirms that
  an occupied port leaves status offline, listening sets it online, and cancelling
  the server task returns it offline.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 49 unit tests, 1 API-key test,
  and 17 proxy integration tests passed. Local socket tests require permission
  to bind loopback ports; the initial sandbox denial was not an application failure.
- Browser demo: log navigation, unconnected Codex, Gemini configuration drift,
  and 390px layout checks passed. Takeover load failure offers retry rather than
  permanent loading; a browser-only IPC fixture verified successful retry and
  the session/dependency guidance without touching real CLI files.
- Bilingual landing-page positioning, mobile overflow checks, the dependency FAQ,
  Chinese guide text, and JSON-LD parsing passed. Browser console checks were clear.
- Light/dark screenshots were regenerated from the current demo for the website
  and README. Browser demonstrations do not replace a packaged native-app test
  or prove compatibility with real upstream providers.

## Two-round follow-up review

### Round 1

- Reproduced concurrent takeover actions with a delayed local IPC fixture. The
  dialog previously allowed another action while `apply_takeover` was pending,
  had unnamed failover switches, and could be dismissed mid-mutation.
- Reproduced a copy mismatch: the visible POSIX snippet omitted the Gemini
  variable while the copied payload included it. Added one generated snippet,
  POSIX/PowerShell selection, an explicit CLI limitation note, accessible switch
  labels, a mutation lock, and a disabled close button during writes.
- Reproduced the English guide dropping the CoderPlan link because the language
  dictionary used plain text replacement. Restored the link as localized HTML.
- The guide was checked at 320px: no horizontal overflow and code blocks remain
  contained in their scrollable context.

### Round 2

- Settings category navigation reached and focused the selected section at 390px;
  the document remained within the viewport width.
- Request log filtering reduced the demo list from six entries to the two failed
  responses, reset restored all entries, and quick switch closed with Escape.
- The landing page and guide were checked in Chinese and English at 320px/390px;
  no horizontal overflow or console errors were found. The guide dependency FAQ
  and the revised request-destination wording were visible after settling.
- Default-provider switching updated the gateway card immediately in the demo.
- Remaining native boundary: this browser loop uses local IPC fixtures for async
  takeover failure/success, not real CLI files or a packaged desktop build.
