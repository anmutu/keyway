import assert from "node:assert/strict";
import test from "node:test";
import { isValidRelayHandoff, isValidRelayModel, parseRelayDeepLink, relayEndpointForApp, relayFormState } from "../src/lib/relayDeepLink.ts";

test("accepts only a public RELAY base and supported CLI", () => {
  assert.deepEqual(
    parseRelayDeepLink("keyway://connect/relay?v=1&base=https%3A%2F%2Fapi.example.com%2Fv1&app=codex"),
    { baseUrl: "https://api.example.com/v1", app: "codex" },
  );
  assert.deepEqual(
    parseRelayDeepLink("keyway://connect/relay?v=1&base=https%3A%2F%2Fapi.example.com&app=opencode"),
    { baseUrl: "https://api.example.com", app: "opencode" },
  );
  assert.deepEqual(
    parseRelayDeepLink("keyway://connect/relay?v=1&base=http%3A%2F%2Flocalhost%3A3000%2Fapi&app=claude", true),
    { baseUrl: "http://localhost:3000/api", app: "claude" },
  );
  assert.equal(parseRelayDeepLink("keyway://connect/relay?v=1&base=http%3A%2F%2Flocalhost%3A3000&app=claude"), null);
});

test("accepts an optional safe model while preserving old v1 links", () => {
  assert.deepEqual(
    parseRelayDeepLink("keyway://connect/relay?v=1&base=https%3A%2F%2Fapi.example.com&app=codex&model=claude-sonnet-4.5"),
    { baseUrl: "https://api.example.com", app: "codex", model: "claude-sonnet-4.5" },
  );
  // The model is optional, so the original three-parameter format remains unchanged.
  assert.deepEqual(
    parseRelayDeepLink("keyway://connect/relay?v=1&base=https%3A%2F%2Fapi.example.com&app=codex"),
    { baseUrl: "https://api.example.com", app: "codex" },
  );
  assert.equal(isValidRelayModel("gpt-5.4-mini"), true);
  assert.equal(isValidRelayModel("openai/gpt-5.4:latest"), true);
});

test("accepts a one-time handoff grant without treating it as an API key", () => {
  const code = "A".repeat(64);
  assert.deepEqual(
    parseRelayDeepLink(`keyway://connect/relay?v=1&base=https%3A%2F%2Fapi.example.com&app=codex&model=gpt-5.5&handoff=${code}`),
    { baseUrl: "https://api.example.com", app: "codex", model: "gpt-5.5", handoff: code },
  );
  assert.equal(isValidRelayHandoff(code), true);
  for (const value of ["", "short", "A".repeat(257), "A_B".repeat(30), "A".repeat(63) + "!"]) {
    assert.equal(isValidRelayHandoff(value), false, value);
  }
});

test("rejects unsafe or ambiguous model metadata", () => {
  for (const model of [
    "",
    " model",
    "gpt model",
    "gpt?key=secret",
    "gpt#fragment",
    "gpt%00",
    "gpt\\path",
    "../secret",
    "a".repeat(129),
  ]) {
    const link = `keyway://connect/relay?v=1&base=https%3A%2F%2Fapi.example.com&app=codex&model=${encodeURIComponent(model)}`;
    assert.equal(parseRelayDeepLink(link), null, model);
    assert.equal(isValidRelayModel(model), false, model);
  }
  assert.equal(
    parseRelayDeepLink("keyway://connect/relay?v=1&base=https%3A%2F%2Fapi.example.com&app=codex&model=gpt-5&model=evil"),
    null,
  );
  assert.equal(
    parseRelayDeepLink("keyway://connect/relay?v=1&base=https%3A%2F%2Fapi.example.com&app=codex&model=gpt-5&extra=x"),
    null,
  );
  assert.equal(
    parseRelayDeepLink("keyway://connect/relay?v=1&base=https%3A%2F%2Fapi.example.com&app=codex&handoff=short"),
    null,
  );
  assert.equal(
    parseRelayDeepLink(`keyway://connect/relay?v=1&base=https%3A%2F%2Fapi.example.com&app=codex&handoff=${"A".repeat(64)}&handoff=${"B".repeat(64)}`),
    null,
  );
});

test("rejects malformed and credential-bearing links", () => {
  for (const link of [
    "https://connect/relay?base=https%3A%2F%2Fapi.example.com&app=codex",
    "keyway://evil/relay?base=https%3A%2F%2Fapi.example.com&app=codex",
    "keyway://connect/relay/extra?base=https%3A%2F%2Fapi.example.com&app=codex",
    "keyway://connect/relay?base=https%3A%2F%2Fapi.example.com&app=unknown",
    "keyway://connect/relay?base=file%3A%2F%2F%2Fetc%2Fpasswd&app=codex",
    "keyway://connect/relay?base=https%3A%2F%2Fu%3Ap%40api.example.com&app=codex",
    "keyway://connect/relay?base=https%3A%2F%2Fapi.example.com%2F%3Fkey%3Dsecret&app=codex",
    "keyway://connect/relay?base=https%3A%2F%2Fapi.example.com%2F%23secret&app=codex",
    "keyway://connect/relay?v=1&base=https%3A%2F%2Fapi.example.com%2F%3F&app=codex",
    "keyway://connect/relay?v=1&base=https%3A%2F%2Fapi.example.com%2F%23&app=codex",
    "keyway://connect/relay?v=1&base=https%3A%2F%2F%40api.example.com&app=codex",
    "keyway://connect/relay?base=https%3A%2F%2Fapi.example.com&app=codex",
    "keyway://connect/relay?v=1&base=https%3A%2F%2Fapi.example.com&app=codex&api_key=secret",
    "keyway://connect/relay?v=1&base=https%3A%2F%2Fapi.example.com&app=gemini",
    "keyway://connect/relay?v=1&base=https%3A%2F%2Fapi.example.com&app=codex&app=claude",
    "keyway://connect/relay?v=1&base=https%3A%2F%2Fapi.example.com&base=https%3A%2F%2Fevil.example&app=codex",
    "keyway://connect/relay?v=1&base=https%3A%2F%2Fapi.example.com%2F%2500&app=codex",
    "keyway://connect/relay?v=2&base=https%3A%2F%2Fapi.example.com&app=codex",
    "keyway://connect/relay?base=https%3A%2F%2Fapi.example.com&base=https%3A%2F%2Fevil.example&app=codex",
    "keyway://connect/relay?base=https%3A%2F%2Fapi.example.com&app=codex#secret",
    "keyway://user@connect/relay?base=https%3A%2F%2Fapi.example.com&app=codex",
    "keyway://@connect/relay?v=1&base=https%3A%2F%2Fapi.example.com&app=codex",
  ]) assert.equal(parseRelayDeepLink(link), null, link);
  assert.equal(parseRelayDeepLink(`keyway://connect/relay?v=1&base=${"a".repeat(2048)}&app=codex`), null);
});

test("uses the OpenAI v1 endpoint for Codex and the root for Anthropic CLIs", () => {
  assert.equal(relayEndpointForApp({ baseUrl: "https://relay.example", app: "codex" }), "https://relay.example/v1");
  assert.equal(relayEndpointForApp({ baseUrl: "https://relay.example/v1", app: "codex" }), "https://relay.example/v1");
  assert.equal(relayEndpointForApp({ baseUrl: "https://relay.example", app: "claude" }), "https://relay.example");
  assert.equal(relayEndpointForApp({ baseUrl: "https://relay.example", app: "opencode" }), "https://relay.example");
  assert.equal(relayEndpointForApp({ baseUrl: "https://relay.example", app: "openclaw" }), "https://relay.example");
});

test("form state requires a pasted key and chooses a fresh name", () => {
  assert.deepEqual(relayFormState(["RELAY", "RELAY (2)"], "  "), {
    name: "RELAY (3)", canSave: false, nameChanged: true,
  });
  assert.deepEqual(relayFormState(["relay"], "sk-secret"), {
    name: "RELAY (2)", canSave: true, nameChanged: true,
  });
  assert.deepEqual(relayFormState([], "sk-secret"), {
    name: "RELAY", canSave: true, nameChanged: false,
  });
});
