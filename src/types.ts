// 前端类型,镜像后端 src-tauri/src/types.rs。
// 注意:Provider 故意不含 api_key 字段 —— 后端永远不会把 Key 传给前端。

export type AppType =
  | "claude"
  | "codex"
  | "gemini"
  | "opencode"
  | "openclaw"
  | "qwen"
  | "iflow"
  | "crush"
  | "droid";

/** 上游协议:供应商按协议暴露不同端点 */
export type Protocol = "anthropic" | "openai" | "gemini";

/** 各分组使用的协议(与后端 AppType::protocol 一致) */
export const APP_PROTOCOL: Record<AppType, Protocol> = {
  claude: "anthropic",
  codex: "openai",
  gemini: "gemini",
  opencode: "anthropic",
  openclaw: "anthropic",
  qwen: "openai",
  iflow: "anthropic",
  crush: "anthropic",
  droid: "anthropic",
};

export interface Provider {
  id: string;
  app_type: AppType;
  name: string;
  base_url: string;
  /** 各协议端点 {anthropic|openai|gemini: base_url} */
  endpoints: Record<string, string>;
  keychain_id: string | null;
  models: string[];
  is_current: boolean;
  is_healthy: boolean;
  sort_index: number;
  created_at: number;
  has_key: boolean;
  last_test?: { ok: boolean; latency_ms: number; ts?: number } | null;
}

export interface ProviderInput {
  app_type: AppType;
  name: string;
  base_url: string;
  models: string[];
  api_key?: string;
}

export interface ProxyStatus {
  addr: string;
  running: boolean;
  supported_apps: string[];
}

export interface UsageSummary {
  requests: number;
  input_tokens: number;
  output_tokens: number;
}

// ---------- 套餐计费(镜像后端 services/billing.rs 的 camelCase 序列化) ----------

export interface BillingPeakState {
  isPeak: boolean;
  /** 当前时段相对倍率:高峰 = ×N,非高峰 = 1.0 */
  relRate: number;
  /** 政策的高峰相对倍率(「N 分后进峰(×N)」预警用) */
  nextRelRate: number;
  /** 当前时段还剩多少分钟结束;null = 今天没有临近变化 */
  minutesToChange: number | null;
  phase: "peak" | "prePeak" | "off";
}

export interface BillingWindow {
  /** 5h 窗口已用百分比(0-100) */
  usedPct: number;
  resetAtMs: number;
  weeklyUsedPct: number | null;
  weeklyResetAtMs: number | null;
  fetchedAtMs: number;
  /** api = 官方 monitor API;local = 本地估算 */
  source: string;
}

export interface BillingState {
  providerId: string;
  policyId: string;
  policyLabelZh: string;
  policyLabelEn: string;
  peak: BillingPeakState;
  window: BillingWindow | null;
  windowRemainingMin: number | null;
}

/** 可选政策(billing_policies 命令返回) */
export interface BillingPolicyInfo {
  id: string;
  labelZh: string;
  labelEn: string;
}

/** 提醒配置(镜像后端 AlertConfig;心跳评估,去重保证每事件一次) */
export interface BillingAlerts {
  /** 高峰预警:工作日高峰开始前提醒一次(仅正在使用的供应商) */
  peakEnabled: boolean;
  peakLeadMin: number;
  /** 窗口清仓:窗口临期且剩余额度仍多时提醒(含闲置套餐;默认关) */
  windowEnabled: boolean;
  windowRemainingMin: number;
  /** 剩余额度百分比阈值(还剩多少没浪费的口径) */
  windowKeepPct: number;
}
