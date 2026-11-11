# Reminder settings take effect after editing

The user approved this behavior in the conversation on 2026-11-11.

- Changing the window reminder time, remaining-quota percentage, or enabled state rearms the reminder for all configured providers.
- Saving immediately evaluates the current cached quota against the new conditions. An eligible provider can notify again even if it notified earlier in the same quota window.
- A provider that is not eligible waits until a later heartbeat meets the conditions.
- Saving identical effective values, changing peak reminders, or restarting does not rearm window reminders.
- Without further edits, each provider still notifies at most once per quota window.
- Errors returned by the notification adapter must not consume the reminder. The next heartbeat can retry. Tauri queues native delivery asynchronously; adapter success is not confirmation that the OS displayed a banner, and native delivery acknowledgement is outside this change.
- Config changes and rearming are atomic. Immediate checks and heartbeats must not duplicate a notification.

Keep the existing settings UI and save-on-blur behavior. Update its Chinese and English explanation. No periodic repeat reminders, new settings, or public release are included.

Implementation uses the existing SQLite settings table. Saving changed window conditions removes only window notification markers in the same transaction. A shared transactional notification function handles immediate and heartbeat checks, and records success only after the adapter accepts the notification for asynchronous submission.

Verification covers threshold changes before and after eligibility, quota changes, re-enabling, unchanged saves, peak-only edits, returning to a previous threshold, independent providers, new quota windows, failures, rollback, and concurrent checks.
