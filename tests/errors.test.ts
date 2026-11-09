import assert from "node:assert/strict";
import test from "node:test";
import { humanizeError } from "../src/lib/errors.ts";
import { en, zh } from "../src/i18n/dict.ts";

const identity = (key: string) => key;

test("missing or unreadable external data is not a takeover conflict", () => {
  for (const message of [
    "未找到外部管理器数据",
    "无法读取外部管理器数据: /fixture/.cc-switch/cc-switch.db",
    "未找到 CC Switch 数据库",
    "无法读取 CC Switch 数据库: /fixture/.cc-switch/cc-switch.db",
    "Could not read CC Switch database",
  ]) {
    assert.equal(humanizeError(message, identity), "err.ccSwitchDb", message);
  }
});

test("neutral and legacy ownership errors have actionable localized messages", () => {
  for (const message of [
    "codex 配置正由其他管理器接管，Keyway 未写入。请先关闭对方代理并回到直连，再由 Keyway 接管",
    "codex 配置正由 CC Switch 接管",
  ]) {
    assert.equal(humanizeError(message, identity), "err.ccSwitchOwner", message);
    assert.equal(humanizeError(message, (key) => en[key]), en["err.ccSwitchOwner"]);
    assert.equal(humanizeError(message, (key) => zh[key]), zh["err.ccSwitchOwner"]);
  }
});

test("a manager path alone does not imply ownership", () => {
  assert.equal(humanizeError("database is locked: /fixture/.cc-switch/cc-switch.db", identity), "err.db");
  assert.equal(humanizeError("operation failed: /fixture/.cc-switch/config.json", identity), "err.fallback");
});

test("ordinary errors retain their existing categories", () => {
  for (const [message, expected] of [
    ["Error: 401 unauthorized", "err.401"],
    ["403 forbidden", "err.403"],
    ["404 not found", "err.404"],
    ["429 rate limit", "err.429"],
    ["request timed out", "err.timeout"],
    ["connection refused", "err.network"],
    ["certificate invalid", "err.tls"],
    ["keychain unavailable", "err.keychain"],
    ["database locked", "err.db"],
    ["invoke failed", "err.ipc"],
    ["unknown", "err.fallback"],
  ]) assert.equal(humanizeError(message, identity), expected);
});
