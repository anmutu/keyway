import { Button } from "@/components/ui/button";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Activity, RefreshCw, ScrollText, Search, Download, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Provider } from "@/types";

interface UsageEntry {
  id: number;
  provider_id: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  status: number;
  rule_pattern: string | null;
  duration_ms: number;
  error_note: string | null;
  created_at: number;
}

const IS_DEMO = new URLSearchParams(location.search).has("demo");

function demoEntries(providers: Provider[]): UsageEntry[] {
  const now = Math.floor(Date.now() / 1000);
  const rows = [
    { model: "glm-4.6", status: 200, input: 1820, output: 6340, duration: 1240 },
    { model: "claude-sonnet-4.5", status: 200, input: 940, output: 2880, duration: 980 },
    { model: "kimi-k2", status: 429, input: 620, output: 0, duration: 412, error: "Rate limit reached" },
    { model: "glm-4.6", status: 200, input: 2180, output: 7210, duration: 1530 },
    { model: "gpt-5", status: 200, input: 760, output: 1940, duration: 810 },
    { model: "kimi-k2", status: 503, input: 480, output: 0, duration: 3000, error: "Upstream unavailable" },
  ];
  return rows.map((row, index) => ({
    id: index + 1,
    provider_id: providers[index % Math.max(providers.length, 1)]?.id ?? "demo-1",
    model: row.model,
    input_tokens: row.input,
    output_tokens: row.output,
    status: row.status,
    rule_pattern: index === 1 ? "*sonnet*" : null,
    duration_ms: row.duration,
    error_note: row.error ?? null,
    created_at: now - index * 930,
  }));
}

/** 请求日志浏览器:最近 100 条请求(时间/供应商/模型/tokens/状态) */
export function LogsPage({
  app,
  providers,
  onError,
  onInfo,
}: {
  app: string;
  providers: Provider[];
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<UsageEntry[] | null>(null);
  const [detail, setDetail] = useState<UsageEntry | null>(null);
  const [q, setQ] = useState("");
  const [prov, setProv] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestId = useRef(0);
  const nameOf = (id: string) =>
    providers.find((provider) => provider.id === id)?.name ?? id.slice(0, 8);

  const exportCsv = async () => {
    if (IS_DEMO) {
      onInfo(t("logs.demoExport"));
      return;
    }
    try {
      // 先弹系统保存对话框;取消则回落到应用数据目录默认路径
      const ts = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const target = await save({
        defaultPath: `keyway-usage-${ts}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!target) return;
      const r = await invoke<{ path: string; count: number }>(
        "export_usage_csv",
        { appType: app, target },
      );
      onInfo(t("logs.exportedTo", { path: r.path, n: r.count }));
    } catch (e) {
      onError(String(e));
    }
  };

  const clearAll = async () => {
    try {
      const n = IS_DEMO ? entries?.length ?? 0 : await invoke<number>("clear_usage", { appType: app });
      requestId.current += 1;
      setRefreshing(false);
      setEntries([]);
      setDetail(null);
      onInfo(t("logs.cleared", { n }));
    } catch (e) {
      onError(String(e));
    }
  };

  const filtered = useMemo(() => {
    if (!entries) return null;
    const kw = q.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (!prov || e.provider_id === prov) &&
        (!onlyErrors || e.status >= 400) &&
        (!kw ||
          (e.model ?? "").toLowerCase().includes(kw) ||
          nameOf(e.provider_id).toLowerCase().includes(kw) ||
          (e.rule_pattern ?? "").toLowerCase().includes(kw) ||
          (e.error_note ?? "").toLowerCase().includes(kw)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, q, prov, onlyErrors, providers]);

  // 拉取条数:默认 100,「加载更多」每次 +200
  const [limit, setLimit] = useState(100);

  const reload = async () => {
    const currentRequest = ++requestId.current;
    setRefreshing(true);
    setLoadFailed(false);
    try {
      if (IS_DEMO) {
        setEntries(demoEntries(providers));
      } else {
        const result = await invoke<UsageEntry[]>("get_recent_usage", { appType: app, limit });
        if (requestId.current === currentRequest) setEntries(result);
      }
    } catch (e) {
      if (requestId.current === currentRequest) {
        setLoadFailed(true);
        onError(String(e));
      }
    } finally {
      if (requestId.current === currentRequest) setRefreshing(false);
    }
  };

  useEffect(() => {
    setLimit(100);
  }, [app]);

  useEffect(() => {
    void reload();
    return () => { requestId.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, limit]);

  // 按天分组倒序(新日期在上),组头显示 日期 · 条数
  const grouped = useMemo(() => {
    if (!filtered) return null;
    const byDay = new Map<string, typeof filtered>();
    for (const e of filtered) {
      const d = new Date(e.created_at * 1000);
      const pad = (n: number) => String(n).padStart(2, "0");
      const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const arr = byDay.get(day) ?? [];
      arr.push(e);
      byDay.set(day, arr);
    }
    const today = new Date();
    const tpad = (n: number) => String(n).padStart(2, "0");
    const tday = `${today.getFullYear()}-${tpad(today.getMonth() + 1)}-${tpad(today.getDate())}`;
    return [...byDay.entries()].map(([d, es]) => [
      d === tday ? `${t("logs.today")} ${d}` : d,
      es,
    ]) as [string, typeof filtered][];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, t]);

  const fmtTime = (ts: number) => {
    const d = new Date(ts * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  return (
    <div className="space-y-4 w-full">
      {IS_DEMO && <p className="text-xs text-muted-foreground">{t("logs.demoNote")}</p>}
      {loadFailed && <p role="alert" className="text-sm text-destructive">{t("logs.loadFailed")}</p>}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-500" />
            <h3 className="text-sm font-semibold">{t("logs.title")}</h3>
            <span className="text-xs text-muted-foreground">
              {t("logs.count", {
                n: filtered?.length ?? 0,
                total: entries?.length ?? 0,
              })}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => void reload()}
            disabled={refreshing}
            title={t("logs.refresh")}
          >
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {t("logs.refresh")}
          </Button>
        </div>
        {/* 筛选行:关键词 / 供应商 / 仅看失败 */}
        {entries !== null && entries.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-wrap">
            <div className="relative flex-1 min-w-[140px] max-w-[220px]">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("logs.searchPh")}
                aria-label={t("logs.searchPh")}
                className="h-7 pl-7 text-xs"
              />
            </div>
            <select
              value={prov}
              aria-label={t("logs.provider")}
              onChange={(e) => setProv(e.target.value)}
              className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
            >
              <option value="">{t("logs.allProviders")}</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyErrors}
                onChange={(e) => setOnlyErrors(e.target.checked)}
                className="accent-red-500"
              />
              {t("logs.onlyErrors")}
            </label>
            <button
              type="button"
              onClick={() => void exportCsv()}
              className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              title={t("logs.exportTitle")}
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
            {entries !== null && entries.length > 0 && (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-500"
                title={t("logs.clearTitle")}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t("logs.clear")}
              </button>
            )}
          </div>
        )}
        {entries === null ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {loadFailed ? t("logs.loadFailed") : t("common.loading")}
          </p>
        ) : (filtered?.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <ScrollText className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {entries.length ? t("logs.noMatch") : t("logs.empty")}
            </p>
            {entries.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => { setQ(""); setProv(""); setOnlyErrors(false); }}>
                {t("logs.resetFilters")}
              </Button>
            )}
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="text-muted-foreground sticky top-0 bg-card">
                <tr className="border-b border-border">
                  <th className="text-left font-medium px-4 py-2">{t("logs.time")}</th>
                  <th className="text-left font-medium px-2 py-2">{t("logs.provider")}</th>
                  <th className="text-left font-medium px-2 py-2">{t("logs.model")}</th>
                  <th className="text-right font-medium px-2 py-2">↓</th>
                  <th className="text-right font-medium px-2 py-2">↑</th>
                  <th className="text-right font-medium px-2 py-2">{t("logs.duration")}</th>
                  <th className="text-right font-medium px-4 py-2">{t("logs.status")}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {grouped?.map(([day, dayEntries]) => (
                  <Fragment key={day}>
                    <tr className="bg-muted/40">
                      <td
                        colSpan={7}
                        className="px-4 py-1 text-[11px] font-semibold text-muted-foreground"
                      >
                        {day} · {dayEntries.length}
                      </td>
                    </tr>
                    {dayEntries.map((e) => (
                  <tr
                    key={e.id}
                    onClick={() => setDetail(e)}
                    className="border-b border-border/50 hover:bg-accent/50 cursor-pointer"
                  >
                    <td className="px-4 py-1.5 text-muted-foreground whitespace-nowrap">
                      <button type="button" className="rounded text-left underline-offset-4 hover:underline" onClick={() => setDetail(e)} aria-label={`${t("logs.detail")} · ${fmtTime(e.created_at)}`}>
                        {fmtTime(e.created_at)}
                      </button>
                    </td>
                    <td className="px-2 py-1.5 max-w-[140px] truncate">
                      {nameOf(e.provider_id)}
                    </td>
                    <td className="px-2 py-1.5 max-w-[180px] truncate">
                      {e.model ?? "—"}
                      {e.rule_pattern && (
                        <span
                          className="ml-1.5 rounded bg-blue-500/15 px-1 py-px text-[10px] text-blue-600 dark:text-blue-400 align-middle"
                          title={t("logs.ruleHit", { pattern: e.rule_pattern })}
                        >
                          {e.rule_pattern}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right text-muted-foreground">
                      {e.input_tokens}
                    </td>
                    <td className="px-2 py-1.5 text-right text-muted-foreground">
                      {e.output_tokens}
                    </td>
                    <td className="px-2 py-1.5 text-right text-muted-foreground">
                      {e.duration_ms > 0 ? `${(e.duration_ms / 1000).toFixed(1)}s` : "—"}
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <span
                        className={
                          e.status < 400
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-500"
                        }
                        title={e.error_note ?? undefined}
                      >
                        {e.status}
                      </span>
                    </td>
                  </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {entries && entries.length >= limit && limit < 2000 && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={refreshing} onClick={() => setLimit((n) => Math.min(2000, n + 200))}>
            {t("logs.more")}
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground text-right">{t("logs.note")}</p>

      {/* 清空确认(Tauri WebView 里 window.confirm 是空操作,必须用自绘对话框) */}
      <ConfirmDialog
        isOpen={confirmClear}
        title={t("logs.clearTitle")}
        message={t("logs.clearConfirm")}
        confirmText={t("logs.clear")}
        onConfirm={() => {
          setConfirmClear(false);
          void clearAll();
        }}
        onCancel={() => setConfirmClear(false)}
      />

      {/* 详情抽屉:点行展开(Proxyman 式) */}
      {detail && (
        <Dialog open onOpenChange={(open) => { if (!open) setDetail(null); }}>
          <DialogContent
            aria-describedby={undefined}
            className="left-auto right-0 top-0 block h-dvh w-[340px] max-w-full translate-x-0 translate-y-0 overflow-y-auto rounded-none bg-card p-0 sm:rounded-none"
          >
            <div className="flex items-center justify-between px-4 py-4 border-b border-border sticky top-0 bg-card">
              <DialogTitle className="text-sm font-semibold">{t("logs.detail")}</DialogTitle>
            </div>
            <div className="p-4 space-y-3 text-xs">
              {[
                [t("logs.time"), fmtTime(detail.created_at)],
                [t("logs.provider"), nameOf(detail.provider_id)],
                [t("logs.model"), detail.model ?? "—"],
                ["↓", String(detail.input_tokens)],
                ["↑", String(detail.output_tokens)],
                [t("logs.duration"), detail.duration_ms > 0 ? `${(detail.duration_ms / 1000).toFixed(1)}s` : "—"],
                [t("logs.status"), String(detail.status)],
                [t("logs.ruleHitShort"), detail.rule_pattern ?? "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">{k}</span>
                  <span className="font-medium text-right break-all">{v}</span>
                </div>
              ))}
              {detail.error_note && (
                <div className="rounded-md bg-red-500/10 border border-red-500/30 p-2.5">
                  <p className="font-semibold text-red-600 dark:text-red-400 mb-1">{t("logs.errNote")}</p>
                  <p className="text-red-700 dark:text-red-300 break-all whitespace-pre-wrap">{detail.error_note}</p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
