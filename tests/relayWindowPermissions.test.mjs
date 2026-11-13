import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const capability = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));

test('relay links may reveal, restore and focus the main window using explicit capabilities', () => {
  assert.deepEqual(capability.windows, ['main']);
  for (const permission of ['core:window:allow-show', 'core:window:allow-unminimize', 'core:window:allow-set-focus']) {
    // core:default only supplies read operations for windows. These commands
    // need explicit capabilities even though the same Rust calls need no IPC.
    assert.ok(capability.permissions.includes(permission), `relay window recovery is missing ${permission}`);
  }
});
