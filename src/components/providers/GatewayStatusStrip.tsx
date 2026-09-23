import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "@/i18n";
import { AlertTriangle, ArrowRight, ScrollText, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppType } from "@/types";

interface Degraded {
  id: string;
  name: string;
  total: number;
  errors: number;
}

interface GatewayStatus {
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
  app,
  defaultProvider,
  proxyRunning,
  proxyAddr,
  takeover,
  onManage,
  onLogs,
}: {
  app: AppType;
  defaultProvider?: string;
  proxyRunning: boolean | null;
  proxyAddr: string;
  takeover?: { active: boolean; effective: boolean };
  onManage: () => void;
  onLogs: () => void;
}) {
  const { t } = useI18n();
  const [st, setSt] = useState<GatewayStatus | null>(null);
  const [degraded, setDegraded] = useState<Degraded[]>([]);

  useEffect(() => {
    if (IS_DEMO) {
      setSt({
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
      return;
    }
    const load = () =>
      invoke<GatewayStatus>("gateway_status")
        .then(setSt)
        .catch(() => setSt(null));
    const loadDegraded = () =>
      invoke<Degraded[]>("get_degraded_providers")
        .then(setDegraded)
        .catch(() => setDegraded([]));
    load();
    loadDegraded();
    const id = setInterval(load, 30_000);
    const id2 = setInterval(loadDegraded, 60_000);
    return () => {
      clearInterval(id);
      clearInterval(id2);
    };
  }, []);

  const connected = takeover?.active && takeover.effective;
  const last = st?.last?.[app];
  const statusKey = proxyRunning === false
    ? "gw.offlineHelp"
    : !takeover || proxyRunning === null
      ? "gw.unknownHelp"
      : takeover.active && !takeover.effective
        ? "takeover.driftBanner"
        : connected
          ? "gw.connectedHelp"
          : "gw.notConnectedHelp";

  return (
    <div className="space-y-2">
      {degraded.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/25 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            {t("gw.degraded", {
              names: degraded
                .map((d) => `${d.name}(${d.errors}/${d.total})`)
                .join(t("common.sep")),
            })}
          </span>
        </div>
      )}
      <div className="space-y-3 rounded-xl border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-semibold" role="status">
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", proxyRunning === true ? "bg-emerald-500" : proxyRunning === false ? "bg-red-500" : "bg-muted-foreground")} />
            {t(proxyRunning === true ? "gw.running" : proxyRunning === false ? "takeover.proxyOff" : "gw.unknown")}
          </span>
          <span className="text-xs text-muted-foreground font-mono break-all">{proxyAddr}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium">{t(`app.${app}`)}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">{t("gw.defaultProvider")}</span>
          <span className="min-w-0 break-all font-medium">{defaultProvider ?? t("gw.none")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t("gw.actualProvider")}</span>
          {last ? (
            <>
              <span className="min-w-0 break-all font-medium">{last.provider}</span>
              {last.model && <span className="min-w-0 truncate text-muted-foreground">· {last.model}</span>}
              <span className={cn(
                "rounded-md px-1.5 py-0.5 font-mono text-[10px]",
                last.status >= 400
                  ? "bg-red-500/10 text-red-600 dark:text-red-400"
                  : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
              )}>
                {last.status}
              </span>
              <time className="text-muted-foreground" dateTime={new Date(last.created_at * 1000).toISOString()}>
                {new Date(last.created_at * 1000).toLocaleString()}
              </time>
            </>
          ) : (
            <span className="text-muted-foreground">{t(st ? "gw.noRequests" : "gw.requestsUnconfirmed")}</span>
          )}
        </div>
        <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
          <p>{t(statusKey)}</p>
          <p>{t("gw.defaultHelp")}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onManage}>
              <Settings2 className="h-3.5 w-3.5" />{t("gw.manage")}
            </Button>
            <Button size="sm" variant="ghost" onClick={onLogs}>
              <ScrollText className="h-3.5 w-3.5" />{t("gw.viewLogs")}
            </Button>
          </div>
          {st && st.today_requests > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("gw.today", { tok: fmtTokens(st.today_tokens), n: st.today_requests })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
