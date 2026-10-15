import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../site/release-sync.js", import.meta.url), "utf8");

async function renderRelease(response, fails = false) {
  const asset = { href: "", getAttribute: () => "mac-arm" };
  const version = { textContent: "" };
  let requestedUrl;
  runInNewContext(source, {
    document: {
      documentElement: { getAttribute: () => "zh-CN" },
      querySelectorAll: () => [asset],
      querySelector: () => version,
      getElementById: () => null,
    },
    fetch: async (url) => {
      requestedUrl = url;
      if (fails) throw new Error("offline");
      return { ok: true, json: async () => response };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { asset, version, requestedUrl };
}

test("queries the GitHub JSON API and uses the published asset", async () => {
  const download = "https://github.com/anmutu/keyway/releases/download/v9.8.7/Keyway_9.8.7_aarch64.dmg";
  const result = await renderRelease({
    tag_name: "v9.8.7",
    assets: [{ name: "Keyway_9.8.7_aarch64.dmg", browser_download_url: download }],
  });
  assert.equal(result.requestedUrl, "https://api.github.com/repos/anmutu/keyway/releases/latest");
  assert.equal(result.asset.href, download);
  assert.match(result.version.textContent, /v9\.8\.7/);
});

test("retains the bundled download when the API is unavailable", async () => {
  const result = await renderRelease(null, true);
  assert.match(result.asset.href, /\/releases\/download\/v\d+\.\d+\.\d+\//);
  assert.match(result.version.textContent, /最新正式版 v\d+\.\d+\.\d+/);
});

test("links to the release page when a platform asset is missing", async () => {
  const result = await renderRelease({ tag_name: "v9.8.7", assets: [{ name: "another-platform.exe" }] });
  assert.equal(result.asset.href, "https://github.com/anmutu/keyway/releases/tag/v9.8.7");
});
