import type { DictKey } from "@/i18n/dict";

type Translate = (key: DictKey, vars?: Record<string, string | number>) => string;

export function humanizeError(raw: string, translate: Translate): string {
  const message = raw.replace(/^Error:\s*/i, "");
  const normalized = message.toLowerCase();
  if (/(未找到|无法读取)外部管理器数据|(?:未找到|无法读取)\s*cc[ -]switch\s*数据库|cc[ -]switch database/.test(normalized)) {
    return translate("err.ccSwitchDb");
  }
  if (/(?:其他管理器|cc[ -]switch)\s*接管/.test(normalized)) {
    return translate("err.ccSwitchOwner");
  }
  if (message.includes("keychain")) return translate("err.keychain");
  if (message.includes("数据库") || message.includes("database")) return translate("err.db");
  if (message.includes("invoke") || message.includes("ipc")) return translate("err.ipc");
  if (/\b401\b|unauthorized/.test(normalized)) return translate("err.401");
  if (/\b403\b|forbidden/.test(normalized)) return translate("err.403");
  if (/\b404\b|not found/.test(normalized)) return translate("err.404");
  if (/\b429\b|rate.?limit|quota/.test(normalized)) return translate("err.429");
  if (/timeout|timed out/.test(normalized)) return translate("err.timeout");
  if (/dns|resolve|refused|unreachable|network/.test(normalized)) return translate("err.network");
  if (/certificate|tls|ssl/.test(normalized)) return translate("err.tls");
  return translate("err.fallback", { msg: message.length > 120 ? `${message.slice(0, 120)}…` : message });
}
