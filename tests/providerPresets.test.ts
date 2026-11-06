import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { providerPresets } from "../src/data/providerPresets.ts";

test("relay provider presets display TeapotRouter and its brand icon", () => {
  for (const app of ["claude", "codex", "opencode", "openclaw"] as const) {
    const preset = providerPresets[app].find((item) => item.category === "aggregator" && item.requiresBaseUrl);
    assert.ok(preset, `${app} should include the custom-endpoint preset`);
    assert.equal(preset.name, "TeapotRouter");
    assert.equal(preset.icon, "teapotrouter");
  }
});

test("TeapotRouter logo is included in the desktop app assets", () => {
  const logo = readFileSync(new URL("../public/icons/teapotrouter.png", import.meta.url));
  assert.equal(logo.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});
