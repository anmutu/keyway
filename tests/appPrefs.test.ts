import assert from "node:assert/strict";
import test from "node:test";
import { isAppVisibilityLocked, setAppVisibility } from "../src/lib/appPrefs.ts";

test("only the last visible CLI is locked, hidden CLIs can be restored", () => {
  assert.equal(isAppVisibilityLocked(["codex"], "claude"), false);
  assert.equal(isAppVisibilityLocked(["codex"], "codex"), true);
  assert.equal(isAppVisibilityLocked(["codex", "claude"], "codex"), false);
  assert.deepEqual(setAppVisibility(["codex"], "claude", true), ["codex", "claude"]);
});

test("showing another CLI preserves the user's existing order", () => {
  const apps = ["gemini", "codex"] as const;
  assert.deepEqual(setAppVisibility([...apps], "claude", true), ["gemini", "codex", "claude"]);
  assert.deepEqual(setAppVisibility([...apps], "codex", true), apps);
});

test("hiding a CLI preserves remaining order and never hides the last CLI", () => {
  assert.deepEqual(setAppVisibility(["gemini", "codex", "claude"], "codex", false), ["gemini", "claude"]);
  assert.deepEqual(setAppVisibility(["codex"], "codex", false), ["codex"]);
  assert.deepEqual(setAppVisibility(["codex"], "claude", false), ["codex"]);
});
