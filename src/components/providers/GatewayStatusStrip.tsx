import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "@/i18n";
import { Activity, AlertTriangle, ArrowRight, ScrollText, Settings2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppType } from "@/types";
import { ALL_APPS } from "@/lib/appPrefs";
import { version } from "../../../package.json";

interface Degraded {
  id: string;
  name: string;
  total: number;
  errors: number;
}

interface GatewayStatus {
  version: string;
  current: Partial<Record<AppType, string | null>>;
  today_tokens: number;
  today_requests: number;
  last?: Record<string, {
    provider: string;
    model: string | null;
    status: number;
    created_at: number;
  }>;
}

const IS_DEMO = new URLSearchParams(location.search).has("demo");

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function GatewayStatusStrip({
  variant = "summary",
  app,
  defaultProvider,
  proxyRunning,
  proxyAddr,
  takeover,
  chain = [],
  onManage,
  onLogs,
  onQuickSwitch,
  onTestAll,
  testingAll,
}: {
  variant?: "summary" | "details";
  app: AppType;
  defaultProvider?: string;
  proxyRunning: boolean | null;
  proxyAddr: string;
  takeover?: { active: boolean; effective: boolean; external_owner?: string | null };
  chain?: string[];
  onManage: () => void;
  onLogs: () => void;
  onQuickSwitch: () => void;
  onTestAll: () => void;
  testingAll: boolean;
}) {
  const { t } = useI18n();
  const [st, setSt] = useState<GatewayStatus | null>(null);
  const [degraded, setDegraded] = useState<Degraded[]>([]);

  useEffect(() => {
    if (IS_DEMO) {
      setSt({
        version,
        current: Object.fromEntries(ALL_APPS.map((cli) => [cli, ["claude", "codex", "gemini"].includes(cli) ? "CoderPlan" : null])),
        today_tokens: 123_400,
        today_requests: 18,
        last: {
          claude: {
            provider: "CoderPlan",
            model: "claude-sonnet-4.5",
            status: 200,
            created_at: Math.floor(Date.now() / 1000) - 180,
          },
        },
      });
      setDegraded([]);
      return;
    }
    let disposed = false;
    let statusInFlight = false;
    let degradedInFlight = false;
    const load = async () => {
      if (disposed || statusInFlight) return;
      statusInFlight = true;
      try {
        const result = await invoke<GatewayStatus>("gateway_status");
        if (!disposed) setSt(result);
      } catch {
        if (!disposed) setSt(null);
      } finally {
        statusInFlight = false;
      }
    };
    const loadDegraded = async () => {
      if (disposed || degradedInFlight) return;
      degradedInFlight = true;
      try {
        const result = await invoke<Degraded[]>("get_degraded_providers", { appType: app });
        if (!disposed) setDegraded(result);
      } catch {
        if (!disposed) setDegraded([]);
      } finally {
        degradedInFlight = false;
      }
    };
    setDegraded([]);
    const refresh = variant === "details" ? load : loadDegraded;
    void refresh();
    const interval = setInterval(refresh, variant === "details" ? 30_000 : 60_000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [app, variant]);

  const hasExternalOwner = Boolean(takeover?.external_owner);
  const connected = takeover?.active && takeover.effective && !hasExternalOwner;
  const isDrifted = takeover?.active === true && !takeover.effective;
  const last = st?.last?.[app];
  const statusKey = proxyRunning === false
    ? "gw.offlineHelp"
    : !takeover || proxyRunning === null
      ? "gw.unknownHelp"
      : hasExternalOwner
        ? "takeover.externalOwnerBanner"
      : takeover.active && !takeover.effective
        ? "takeover.driftBanner"
          : connected
            ? "gw.connectedHelp"
            : "gw.notConnectedHelp";
  const takeoverLabel = !takeover
    ? t("gw.unknown")
    : hasExternalOwner
      ? t("takeover.externalOwnerShort")
    : takeover.active && takeover.effective
      ? t("takeover.active")
      : takeover.active
        ? t("takeover.driftShort")
        : t("takeover.inactive");
  const statusTone = proxyRunning === true
    ? "text-emerald-600 dark:text-emerald-400"
    : proxyRunning === false
      ? "text-red-600 dark:text-red-400"
      : "text-muted-foreground";
  const routeChain = chain.length > 0
    ? chain
    : defaultProvider
      ? [defaultProvider]
      : [];
  const showGuidance = proxyRunning !== true || !connected || !last;
  const takeoverTone = connected
    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : hasExternalOwner
      ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
    : takeover?.active
      ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : "border-border bg-muted/60 text-muted-foreground";

  return (
    <div className="space-y-2">
      {variant === "summary" && degraded.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/25 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-300">
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {t("gw.degraded", {
                names: degraded
                  .map((d) => `${d.name}(${d.errors}/${d.total})`)
                  .join(t("common.sep")),
              })}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px] text-amber-700 hover:bg-amber-500/10 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200"
              onClick={onLogs}
            >
              <ScrollText className="h-3 w-3" />
              {t("gw.degradedLogs")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px] text-amber-700 hover:bg-amber-500/10 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200"
              onClick={onQuickSwitch}
            >
              <Zap className="h-3 w-3" />
              {t("gw.degradedSwitch")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px] text-amber-700 hover:bg-amber-500/10 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200"
              disabled={testingAll}
              onClick={onTestAll}
            >
              <Activity className={cn("h-3 w-3", testingAll && "animate-pulse")} />
              {t(testingAll ? "gw.degradedTesting" : "gw.degradedTest")}
            </Button>
          </div>
        </div>
      )}
      {variant === "summary" ? (
        <>
          {proxyRunning !== true && (
            <div
              role={proxyRunning === false ? "alert" : "status"}
              className={cn(
                "flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-xs leading-relaxed",
                proxyRunning === false
                  ? "border-red-500/25 bg-red-500/5 text-red-700 dark:text-red-300"
                  : "border-border text-muted-foreground",
              )}
            >
              <span className="flex min-w-0 flex-1 basis-48 items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {t(proxyRunning === false ? "gw.offlineHelp" : "gw.unknown")}
              </span>
              <Button size="sm" variant="ghost" className="h-8" onClick={onManage}>{t("gw.details")}</Button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:px-5">
            <div className="min-w-0 flex-1 basis-40">
              <p className="text-xs text-muted-foreground">{t("gw.defaultProvider")}</p>
              <p className="mt-1 break-words text-base font-semibold">{defaultProvider || t("gw.none")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button size="sm" variant="outline" className="h-8" onClick={onQuickSwitch}>
                <Zap className="h-3.5 w-3.5" />{t("gw.degradedSwitch")}
              </Button>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 sm:w-auto sm:px-3" onClick={onLogs} aria-label={t("gw.viewLogs")} title={t("gw.viewLogs")}>
                <ScrollText className="h-3.5 w-3.5" /><span className="hidden sm:inline">{t("gw.viewLogs")}</span>
              </Button>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onManage} aria-label={t("gw.details")} title={t("gw.details")}>
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </>
      ) : (
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <span className={cn(
              "h-2.5 w-2.5 shrink-0 rounded-full",
              proxyRunning === true
                ? "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]"
                : proxyRunning === false
                  ? "bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.12)]"
                  : "bg-muted-foreground",
            )} />
            <p className={cn("truncate text-sm font-semibold", statusTone)} role="status">
              {t(proxyRunning === true ? "gw.running" : proxyRunning === false ? "takeover.proxyOff" : "gw.unknown")}
            </p>
            <span
              className={cn("rounded-md border px-2 py-0.5 text-[11px] font-medium", takeoverTone)}
              title={hasExternalOwner ? t("takeover.externalOwnerHint") : isDrifted ? t("takeover.overridden") : undefined}
            >
              {takeoverLabel}
            </span>
          </div>
          <div className="flex w-full flex-wrap items-center justify-start gap-1.5 sm:w-auto sm:shrink-0 sm:justify-end">
            <span className="mr-1 break-all rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
              {proxyAddr || "—"} · {st?.version ? `v${st.version}` : "—"}
            </span>
            <Button size="sm" variant="ghost" className="h-8" onClick={onLogs}>
              <ScrollText className="h-3.5 w-3.5" />{t("gw.viewLogs")}
            </Button>
          </div>
        </div>

        {showGuidance && (
          <div className={cn(
            "border-t border-border/70 px-4 py-2 text-xs leading-relaxed sm:px-5",
            proxyRunning === false || hasExternalOwner || takeover?.active && !takeover.effective
              ? "bg-amber-500/[0.06] text-amber-700 dark:text-amber-300"
              : "bg-muted/25 text-muted-foreground",
          )}>
            {t(statusKey)}
          </div>
        )}

        <div className="border-t border-border/70 px-4 py-3 sm:px-5">
          <p className="text-xs font-medium text-muted-foreground">{t("gw.defaults")}</p>
          <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {ALL_APPS.map((cli) => (
              <div key={cli} className="flex min-w-0 items-baseline justify-between gap-2 text-xs">
                <dt className="shrink-0 text-muted-foreground">{t(`app.${cli}`)}</dt>
                <dd className="truncate" title={st?.current[cli] ?? undefined}>
                  {st?.current[cli] === null ? t("gw.none") : st?.current[cli] ?? "—"}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="border-t border-border/70">
          <div className="min-w-0 px-4 py-3 sm:px-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t(`app.${app}`)} · {t("gw.route")}
            </p>
            <div className="mt-2 flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5 text-xs">
              {routeChain.length > 0 ? routeChain.map((provider, index) => (
                <span key={`${provider}-${index}`} className="contents">
                  {index > 0 && <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  <span className={cn(
                    "max-w-[180px] truncate rounded-md border px-2 py-1",
                    index === 0
                      ? "border-blue-500/25 bg-blue-500/[0.06] font-semibold text-foreground"
                      : "border-border bg-muted/50 text-muted-foreground",
                  )} title={provider}>
                    {provider}
                  </span>
                </span>
              )) : (
                <span className="text-muted-foreground">{t("gw.none")}</span>
              )}
              {routeChain.length > 1 && (
                <span className="ml-1 shrink-0 text-[11px] text-muted-foreground">
                  {t("gw.chainCount", { n: routeChain.length })}
                </span>
              )}
              {routeChain.length === 1 && (
                <span className="ml-1 shrink-0 text-[11px] text-muted-foreground">
                  {t("gw.noFallback")}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 border-t border-border/70">
            <div className="px-4 py-3">
              <p className="text-[10px] text-muted-foreground">{t("gw.allRequestsToday")}</p>
              <p className="mt-1 text-lg font-semibold tracking-tight tabular-nums">{st?.today_requests ?? "—"}</p>
            </div>
            <div className="border-l border-border/70 px-4 py-3">
              <p className="text-[10px] text-muted-foreground">{t("gw.allTokensToday")}</p>
              <p className="mt-1 text-lg font-semibold tracking-tight tabular-nums">{st ? fmtTokens(st.today_tokens) : "—"}</p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onLogs}
          className="flex w-full min-w-0 flex-wrap items-center gap-2 border-t border-border/70 bg-muted/20 px-4 py-2.5 text-left text-xs transition-colors hover:bg-muted/40 sm:px-5"
        >
          <span className="shrink-0 text-muted-foreground">{t("gw.actualProvider")}</span>
          {last ? (
            <>
              <span className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px]",
                last.status >= 400
                  ? "bg-red-500/10 text-red-600 dark:text-red-400"
                  : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
              )}>
                {last.status}
              </span>
              <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                {last.model ?? t("gw.noModel")}
              </span>
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate font-semibold text-foreground">{last.provider}</span>
            </>
          ) : (
            <span className="truncate text-muted-foreground">
              {t(st ? "gw.noRequests" : "gw.requestsUnconfirmed")}
            </span>
          )}
          <ScrollText className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </div>
      )}
    </div>
  );
}
