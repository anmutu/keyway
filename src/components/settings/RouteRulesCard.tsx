import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowRight, ChevronDown, ChevronUp, FlaskConical, Plus, Route, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ProviderIcon } from "@/components/ProviderIcon";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { loadApps } from "@/lib/appPrefs";
import type { AppType, Provider } from "@/types";

interface RouteRule {
  id: number;
  app_type: string;
  pattern: string;
  provider_id: string;
  enabled: boolean;
  match_type: string;
  fallback_provider_id: string | null;
  priority: number;
}

const IS_DEMO = new URLSearchParams(location.search).has("demo");

const DEMO_PROVIDERS: Provider[] = [
  {
    id: "demo-route-main",
    app_type: "codex",
    name: "CoderPlan",
    base_url: "https://api.coderplan.ai",
    endpoints: { openai: "https://api.coderplan.ai/v1" },
    keychain_id: "demo-route-main",
    models: ["gpt-5", "o3"],
    is_current: true,
    is_healthy: true,
    sort_index: 0,
    created_at: 0,
    has_key: true,
  },
  {
    id: "demo-route-fallback",
    app_type: "codex",
    name: "OpenAI",
    base_url: "https://api.openai.com",
    endpoints: { openai: "https://api.openai.com/v1" },
    keychain_id: "demo-route-fallback",
    models: ["gpt-5", "gpt-4.1"],
    is_current: false,
    is_healthy: true,
    sort_index: 1,
    created_at: 0,
    has_key: true,
  },
];

const DEMO_RULES: RouteRule[] = [
  {
    id: 1,
    app_type: "codex",
    pattern: "o3",
    provider_id: "demo-route-main",
    enabled: true,
    match_type: "contains",
    fallback_provider_id: "demo-route-fallback",
    priority: 0,
  },
];

/**
 * 模型路由设置卡:请求体 model 匹配关键词 → 优先路由到指定供应商。
 * 自带 app 分组切换与供应商加载,可独立嵌在设置页。
 */
export function RouteRulesCard({ onError }: { onError: (msg: string) => void }) {
  const { t } = useI18n();
  const [apps, setApps] = useState<AppType[]>([]);
  const [app, setApp] = useState<AppType>("codex");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [rules, setRules] = useState<RouteRule[]>([]);
  const [pattern, setPattern] = useState("");
  const [providerId, setProviderId] = useState("");
  const [matchType, setMatchType] = useState("contains");
  const [adding, setAdding] = useState(false);
  // 长上下文分流预设
  const [lcProvider, setLcProvider] = useState("");
  // 规则试运行
  const [dryModel, setDryModel] = useState("");
  const [dryResult, setDryResult] = useState<{ rule_hit: boolean; pattern: string | null; provider: string; fallback: string | null } | null>(null);

  const dryRun = () => {
    if (!dryModel.trim()) { setDryResult(null); return; }
    if (IS_DEMO) {
      const model = dryModel.trim().toLowerCase();
      const hit = rules.find((r) => {
        if (!r.enabled) return false;
        const pattern = r.pattern.toLowerCase();
        return r.match_type === "starts_with" ? model.startsWith(pattern) : model.includes(pattern);
      });
      setDryResult({
        rule_hit: !!hit,
        pattern: hit?.pattern ?? null,
        provider: nameOf(hit?.provider_id ?? providers[0]?.id ?? ""),
        fallback: hit?.fallback_provider_id ? nameOf(hit.fallback_provider_id) : null,
      });
      return;
    }
    invoke<{ rule_hit: boolean; pattern: string | null; provider: string; fallback: string | null }>(
      "dry_run_route",
      { appType: app, model: dryModel.trim() },
    )
      .then(setDryResult)
      .catch(() => setDryResult(null));
  };
  const [lcThreshold, setLcThreshold] = useState("60000");
  // 后台轻量分流预设
  const [bgProvider, setBgProvider] = useState("");
  // 深度思考分流预设
  const [thProvider, setThProvider] = useState("");

  const reload = (a: AppType) => {
    if (IS_DEMO) {
      setRules(DEMO_RULES.map((r) => ({ ...r, app_type: a })));
      setProviders(DEMO_PROVIDERS.map((p) => ({ ...p, app_type: a, endpoints: { ...p.endpoints }, models: [...p.models] })));
      setLcProvider("demo-route-fallback");
      setLcThreshold("60000");
      setBgProvider("demo-route-main");
      setThProvider("demo-route-main");
      return;
    }
    invoke<RouteRule[]>("list_route_rules", { appType: a })
      .then(setRules)
      .catch(() => setRules([]));
    invoke<Provider[]>("list_providers", { appType: a })
      .then(setProviders)
      .catch(() => setProviders([]));
    invoke<{ provider_id: string; threshold: number } | null>(
      "get_longctx_preset",
      { appType: a },
    )
      .then((p) => {
        setLcProvider(p?.provider_id ?? "");
        setLcThreshold(String(p?.threshold ?? 60000));
      })
      .catch(() => setLcProvider(""));
    invoke<string | null>("get_background_preset", { appType: a })
      .then((pid) => setBgProvider(pid ?? ""))
      .catch(() => setBgProvider(""));
    invoke<string | null>("get_think_preset", { appType: a })
      .then((pid) => setThProvider(pid ?? ""))
      .catch(() => setThProvider(""));
  };

  useEffect(() => {
    const list = loadApps();
    setApps(list);
    setApp(list[0]);
    reload(list[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nameOf = (id: string) =>
    providers.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  const add = async () => {
    if (!pattern.trim() || !providerId) return;
    setAdding(true);
    try {
      if (IS_DEMO) {
        setRules((current) => [
          ...current,
          {
            id: Math.max(0, ...current.map((r) => r.id)) + 1,
            app_type: app,
            pattern: pattern.trim(),
            provider_id: providerId,
            enabled: true,
            match_type: matchType,
            fallback_provider_id: null,
            priority: current.length,
          },
        ]);
        setPattern("");
        return;
      }
      await invoke("add_route_rule", {
        appType: app,
        pattern: pattern.trim(),
        providerId,
        matchType,
      });
      setPattern("");
      setRules(await invoke<RouteRule[]>("list_route_rules", { appType: app }));
    } catch (e) {
      onError(String(e));
    } finally {
      setAdding(false);
    }
  };

  /** 上移/下移(与相邻规则交换优先级,列表即匹配顺序) */
  const move = async (id: number, dir: number) => {
    try {
      if (IS_DEMO) {
        setRules((current) => {
          const index = current.findIndex((r) => r.id === id);
          const target = index + dir;
          if (index < 0 || target < 0 || target >= current.length) return current;
          const next = [...current];
          [next[index], next[target]] = [next[target], next[index]];
          return next;
        });
        return;
      }
      await invoke("move_route_rule", { id, dir });
      setRules(await invoke<RouteRule[]>("list_route_rules", { appType: app }));
    } catch (e) {
      onError(String(e));
    }
  };

  const remove = async (id: number) => {
    try {
      if (IS_DEMO) {
        setRules((current) => current.filter((r) => r.id !== id));
        return;
      }
      await invoke("delete_route_rule", { id });
      setRules(await invoke<RouteRule[]>("list_route_rules", { appType: app }));
    } catch (e) {
      onError(String(e));
    }
  };

  const toggle = async (r: RouteRule, enabled: boolean) => {
    // 乐观更新,失败回滚并提示
    setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, enabled } : x)));
    if (IS_DEMO) return;
    try {
      await invoke("set_route_rule_enabled", { id: r.id, enabled });
    } catch (e) {
      onError(String(e));
      setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, enabled: !enabled } : x)));
    }
  };

  const saveFallback = async (r: RouteRule, pid: string) => {
    setRules((rs) =>
      rs.map((x) => (x.id === r.id ? { ...x, fallback_provider_id: pid || null } : x)),
    );
    if (IS_DEMO) return;
    try {
      await invoke("set_route_rule_fallback", { id: r.id, providerId: pid || null });
    } catch (e) {
      onError(String(e));
    }
  };

  const saveThink = async (pid: string) => {
    setThProvider(pid);
    if (IS_DEMO) return;
    try {
      await invoke("set_think_preset", { appType: app, providerId: pid });
    } catch (e) {
      onError(String(e));
    }
  };

  const saveBackground = async (pid: string) => {
    setBgProvider(pid);
    if (IS_DEMO) return;
    try {
      await invoke("set_background_preset", {
        appType: app,
        providerId: pid,
      });
    } catch (e) {
      onError(String(e));
    }
  };

  const saveLongctx = async (pid: string) => {
    setLcProvider(pid);
    if (IS_DEMO) return;
    try {
      await invoke("set_longctx_preset", {
        appType: app,
        providerId: pid,
        threshold: Number(lcThreshold) || 60000,
      });
    } catch (e) {
      onError(String(e));
    }
  };

  return (
    <div id="route-rules" className="scroll-mt-28 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-muted-foreground">
          <Route className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{t("route.title")}</div>
          <div className="text-xs text-muted-foreground mb-3">
            {t("route.cardDesc")}
          </div>
          {IS_DEMO && <p className="mb-3 text-xs text-muted-foreground">{t("route.demoNote")}</p>}

          {/* app 分组切换 */}
          {apps.length > 1 && (
            <div className="flex flex-wrap items-center gap-1 p-1 bg-muted rounded-lg w-fit max-w-full mb-3">
              {apps.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => {
                    setApp(a);
                    setDryResult(null);
                    setDryModel("");
                    setProviderId("");
                    reload(a);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-xs font-medium transition-all",
                    app === a
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <ProviderIcon icon={a} name={a} size={14} />
                  <span className="capitalize">{a}</span>
                </button>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {rules.map((r, i) => (
              <div
                key={r.id}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs",
                  !r.enabled && "opacity-55",
                )}
              >
                <code className="min-w-0 max-w-[45%] truncate font-mono" title={r.pattern}>
                  {r.pattern}
                </code>
                <span className="text-[10px] text-muted-foreground">
                  {r.match_type === "starts_with"
                    ? t("route.matchStartsWith")
                    : t("route.matchContains")}
                </span>
                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                <span className="font-medium">{nameOf(r.provider_id)}</span>
                <select
                  value={r.fallback_provider_id ?? ""}
                  onChange={(e) => void saveFallback(r, e.target.value)}
                  className="h-6 rounded border border-border bg-background px-1 text-[10px] text-muted-foreground max-w-[110px]"
                  title={t("route.fallbackTitle")}
                >
                  <option value="">{t("route.fallbackNone")}</option>
                  {providers
                    .filter((p) => p.id !== r.provider_id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        ↩ {p.name}
                      </option>
                    ))}
                </select>
                <div className="ml-auto flex items-center gap-0.5" title={t("route.orderTitle")}>
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => void move(r.id, -1)}
                    aria-label={t("route.moveUp")}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={i === rules.length - 1}
                    onClick={() => void move(r.id, 1)}
                    aria-label={t("route.moveDown")}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Switch
                  className="scale-75"
                  checked={r.enabled}
                  onCheckedChange={(v) => void toggle(r, v)}
                />
                <button
                  type="button"
                  onClick={() => void remove(r.id)}
                  className="text-muted-foreground hover:text-red-500"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <Input
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder={t("route.patternPh")}
                className="h-8 text-xs sm:flex-1"
                onKeyDown={(e) => e.key === "Enter" && void add()}
              />
              <select
                value={matchType}
                onChange={(e) => setMatchType(e.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs sm:max-w-[150px]"
                title={t("route.matchTypeTitle")}
              >
                <option value="contains">{t("route.matchContains")}</option>
                <option value="starts_with">{t("route.matchStartsWith")}</option>
              </select>
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs sm:max-w-[150px]"
              >
                <option value="">{t("route.pickProvider")}</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                aria-label={t("common.add")}
                className="h-8 px-2.5"
                disabled={adding || !pattern.trim() || !providerId}
                onClick={() => void add()}
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
            {/* 规则试运行 */}
            <div className="rounded-md border border-dashed border-border px-2.5 py-2 text-xs">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <Input
                  value={dryModel}
                  onChange={(e) => setDryModel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && dryRun()}
                  placeholder={t("route.dryPh")}
                  className="h-7 text-xs flex-1"
                />
                <Button variant="outline" size="sm" className="h-7 px-2" onClick={dryRun}>
                  {t("route.dryRun")}
                </Button>
              </div>
              {dryResult && (
                <p className="mt-1.5 text-muted-foreground">
                  {dryResult.rule_hit ? (
                    <>
                      <span className="rounded bg-blue-500/15 px-1 text-blue-600 dark:text-blue-400">
                        {dryResult.pattern}
                      </span>{" "}
                      → <b className="text-foreground">{dryResult.provider}</b>
                      {dryResult.fallback && <> · {t("route.dryFallback")} {dryResult.fallback}</>}
                    </>
                  ) : (
                    <>
                      {t("route.dryMiss")} <b className="text-foreground">{dryResult.provider}</b>
                    </>
                  )}
                </p>
              )}
            </div>
            {/* 长上下文分流预设 */}
            <div className="flex items-center gap-2 flex-wrap rounded-md border border-dashed border-border px-2.5 py-2 text-xs">
              <span className="text-muted-foreground">{t("route.longctxLabel")}</span>
              <select
                value={lcProvider}
                onChange={(e) => void saveLongctx(e.target.value)}
                className="h-7 rounded-md border border-border bg-background px-2 text-xs"
              >
                <option value="">{t("route.longctxOff")}</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {lcProvider && (
                <>
                  <span className="text-muted-foreground">{t("route.longctxThreshold")}</span>
                  <Input
                    value={lcThreshold}
                    onChange={(e) => setLcThreshold(e.target.value.replace(/\D/g, ""))}
                    onBlur={() => void saveLongctx(lcProvider)}
                    className="h-7 w-20 text-xs"
                  />
                  <span className="text-muted-foreground">tokens</span>
                </>
              )}
            </div>
            {/* 深度思考分流预设 */}
            <div className="flex items-center gap-2 flex-wrap rounded-md border border-dashed border-border px-2.5 py-2 text-xs">
              <span className="text-muted-foreground">{t("route.thinkLabel")}</span>
              <select
                value={thProvider}
                onChange={(e) => void saveThink(e.target.value)}
                className="h-7 rounded-md border border-border bg-background px-2 text-xs"
              >
                <option value="">{t("route.thinkOff")}</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground">{t("route.thinkHint")}</span>
            </div>
            {/* 后台轻量分流预设 */}
            <div className="flex items-center gap-2 flex-wrap rounded-md border border-dashed border-border px-2.5 py-2 text-xs">
              <span className="text-muted-foreground">{t("route.bgLabel")}</span>
              <select
                value={bgProvider}
                onChange={(e) => void saveBackground(e.target.value)}
                className="h-7 rounded-md border border-border bg-background px-2 text-xs"
              >
                <option value="">{t("route.bgOff")}</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground">{t("route.bgHint")}</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {t("route.desc")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
