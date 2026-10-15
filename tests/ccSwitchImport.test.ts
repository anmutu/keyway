import assert from "node:assert/strict";
import test from "node:test";
import { selectionForFilter } from "../src/lib/ccSwitchImport.ts";

test("selects only visible importable providers for the active CC Switch filter", () => {
  const items = [
    { source_id: "claude-1", app_type: "claude", importable: true },
    { source_id: "codex-1", app_type: "codex", importable: true },
    { source_id: "gemini-1", app_type: "gemini", importable: false },
  ];

  assert.deepEqual([...selectionForFilter(items, "codex")], ["codex:codex-1"]);
  assert.deepEqual([...selectionForFilter(items, "all")], ["claude:claude-1", "codex:codex-1"]);
});
