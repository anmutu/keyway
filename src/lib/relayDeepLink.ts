import type { AppType } from "../types.ts";

export interface RelayConnectRequest {
  baseUrl: string;
  app: AppType;
  /** Optional model selected in RELAY. Never contains an API key or secret. */
  model?: string;
  /** Short-lived, single-use authorization grant. Never log or persist this value. */
  handoff?: string;
}

const SUPPORTED_APPS = new Set<AppType>(["claude", "codex", "opencode", "openclaw"]);
const MAX_MODEL_LENGTH = 128;
// Model IDs are identifiers, not free-form labels. Keep the allow-list narrow so
// a deep link cannot smuggle query/control characters into a provider config.
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const HANDOFF_PATTERN = /^[A-Za-z0-9]{16,256}$/;

export function isValidRelayModel(value: string): boolean {
  return value.length > 0 && value.length <= MAX_MODEL_LENGTH && MODEL_ID_PATTERN.test(value);
}

export function isValidRelayHandoff(value: string): boolean {
  return HANDOFF_PATTERN.test(value);
}

export function isValidRelayBase(value: string, allowLocalHttp = false): boolean {
  const authority = /^https?:\/\/([^/?#]*)/i.exec(value)?.[1];
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  if (!authority || authority.includes("@") || value.includes("?") || value.includes("#")
    || /[\\\u0000-\u001f\u007f]/.test(decoded)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || (allowLocalHttp && url.protocol === "http:"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1")))
      && Boolean(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/** Only public connection data may arrive through the operating system URL handler. */
export function parseRelayDeepLink(raw: string, allowLocalHttp = false): RelayConnectRequest | null {
  try {
    if (raw.length > 2048) return null;
    const authority = /^keyway:\/\/([^/?#]*)/i.exec(raw)?.[1];
    if (!authority || authority.includes("@")) return null;
    const url = new URL(raw);
    if (url.protocol !== "keyway:" || url.hostname !== "connect" || url.pathname !== "/relay"
      || url.username || url.password || url.port || url.hash) return null;
    const keys = [...url.searchParams.keys()];
    const allowedKeys = new Set(["v", "base", "app", "model", "handoff"]);
    if ((keys.length < 3 || keys.length > 5)
      || keys.some((key) => !allowedKeys.has(key))
      || new Set(keys).size !== keys.length
      || !keys.includes("v") || !keys.includes("base") || !keys.includes("app")
      || url.searchParams.get("v") !== "1") return null;
    const baseUrl = url.searchParams.get("base");
    const app = url.searchParams.get("app");
    if (!baseUrl || !isValidRelayBase(baseUrl, allowLocalHttp) || !app || !SUPPORTED_APPS.has(app as AppType)) return null;
    const model = url.searchParams.get("model");
    if (keys.includes("model") && (!model || !isValidRelayModel(model))) return null;
    const handoff = url.searchParams.get("handoff");
    if (keys.includes("handoff") && (!handoff || !isValidRelayHandoff(handoff))) return null;
    return {
      baseUrl,
      app: app as AppType,
      ...(model ? { model } : {}),
      ...(handoff ? { handoff } : {}),
    };
  } catch {
    return null;
  }
}

export function relayEndpointForApp(request: RelayConnectRequest): string {
  // Keyway's current APP_PROTOCOL maps only Codex to OpenAI; the other supported CLIs use Anthropic.
  if (request.app !== "codex") return request.baseUrl;
  const trimmed = request.baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

/** create_provider merges equal names, so use a distinct name for each RELAY import. */
export function relayFormState(existingNames: string[], apiKey: string) {
  const names = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  let name = "RELAY";
  for (let suffix = 2; names.has(name.toLowerCase()); suffix += 1) {
    name = `RELAY (${suffix})`;
  }
  return { name, canSave: apiKey.trim().length > 0, nameChanged: name !== "RELAY" };
}
