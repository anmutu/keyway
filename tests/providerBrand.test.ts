import assert from "node:assert/strict";
import test from "node:test";
import { providerBrandKey } from "../src/lib/providerBrand.ts";

test("uses the TeapotRouter brand for the renamed preset", () => {
  assert.equal(providerBrandKey("claude", "TeapotRouter"), "teapotrouter");
});

test("uses a known provider name before the generic CLI icon", () => {
  assert.equal(providerBrandKey("codex", "CoderPlan"), "coderplan");
});

test("keeps the CLI icon for unrelated generic relay names", () => {
  assert.equal(providerBrandKey("codex", "Relay"), "codex");
});

test("falls back to the CLI icon for unknown provider names", () => {
  assert.equal(providerBrandKey("claude", "My private endpoint"), "claude");
});
