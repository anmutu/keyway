import { Button } from "@/components/ui/button";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Copy,
  Download,
  RefreshCw,
  ScrollText,
  Search,
  Trash2,
  X,
  Zap,
} from "lucide-react";
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

interface TestResult {
  ok: boolean;
  status: number | null;
  latency_ms: number;
  message: string;
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

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function StatusBadge({ status }: { status: number }) {
  const ok = status < 400;
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums " +
        (ok
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-red-500/10 text-red-600 dark:text-red-400")
      }
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}
      {status}
    </span>
  );
}

/** 请求日志浏览器:最近 100 条请求(时间/供应商/模型/tokens/状态) */
export function LogsPage({
  app,
  appName,
  providers,
  onError,
  onInfo,
  onQuickSwitch,
}: {
  app: string;
  appName: string;
  providers: Provider[];
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
  onQuickSwitch: () => void;
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
  const [detailTesting, setDetailTesting] = useState(false);
  const [detailTest, setDetailTest] = useState<TestResult | null>(null);
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

  const copyErrorSummary = async (entry: UsageEntry) => {
    const summary = [
      `${appName} · ${t("logs.detail")}`,
      `HTTP ${entry.status}`,
      `${t("logs.provider")}: ${nameOf(entry.provider_id)}`,
      `${t("logs.model")}: ${entry.model ?? "—"}`,
      `${t("logs.time")}: ${fmtTime(entry.created_at)}`,
      entry.error_note ?? "",
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(summary);
      onInfo(t("logs.errCopied"));
    } catch (error) {
      onError(String(error));
    }
  };

  const retestDetailProvider = async (entry: UsageEntry) => {
    const provider = providers.find((item) => item.id === entry.provider_id);
    if (!provider) return;
    setDetailTesting(true);
    setDetailTest(null);
    try {
      const result = IS_DEMO
        ? { ok: true, status: 200, latency_ms: 186, message: "" }
        : await invoke<TestResult>("test_provider", {
            id: provider.id,
            appType: app,
          });
      setDetailTest(result);
    } catch (error) {
      onError(String(error));
    } finally {
      setDetailTesting(false);
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
    setDetailTest(null);
    setDetailTesting(false);
  }, [detail?.id]);

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

  const loadedFailureCount = entries?.filter((entry) => entry.status >= 400).length ?? 0;
  const loadedTokens =
    entries?.reduce((sum, entry) => sum + entry.input_tokens + entry.output_tokens, 0) ?? 0;
  const latestProvider = entries?.[0] ? nameOf(entries[0].provider_id) : "—";
  const hasFilters = Boolean(q.trim() || prov || onlyErrors);

  return (
    <div className="w-full space-y-5">
      {IS_DEMO && (
        <p className="rounded-lg border border-blue-500/20 bg-blue-500/[0.06] px-3 py-2 text-xs text-muted-foreground">
          {t("logs.demoNote")}
        </p>
      )}
      {loadFailed && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-xs text-red-600 dark:text-red-400"
        >
          <span>{t("logs.loadFailed")}</span>
          <Button variant="outline" size="sm" className="h-7 border-red-500/30 text-xs" onClick={() => void reload()}>
            {t("logs.refresh")}
          </Button>
        </div>
      )}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                {appName}
              </p>
              <h2 className="text-base font-semibold">{t("logs.title")}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("logs.pageDesc")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground tabular-nums">
              {t("logs.count", {
                n: filtered?.length ?? 0,
                total: entries?.length ?? 0,
              })}
            </span>
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
        </div>
        {entries !== null && (
          <>
            <div className="grid grid-cols-2 gap-2 border-b border-border bg-muted/[0.18] px-4 py-3 sm:grid-cols-4">
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("logs.loaded")}</div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums">{entries.length}</div>
              </div>
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("logs.failures")}</div>
                <div className={`mt-0.5 text-sm font-semibold tabular-nums ${loadedFailureCount ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {loadedFailureCount}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("logs.tokens")}</div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums">{fmtTokens(loadedTokens)}</div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("logs.latest")}</div>
                <div className="mt-0.5 truncate text-sm font-semibold" title={latestProvider}>{latestProvider}</div>
              </div>
            </div>
              {/* 筛选行:关键词 / 供应商 / 仅看失败 */}
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
              <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("logs.filterLabel")}
              </span>
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
            <label className="flex h-7 cursor-pointer select-none items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={onlyErrors}
                onChange={(e) => setOnlyErrors(e.target.checked)}
                className="accent-red-500"
              />
              {t("logs.onlyErrors")}
            </label>
            {hasFilters && (
              <button
                type="button"
                onClick={() => { setQ(""); setProv(""); setOnlyErrors(false); }}
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
                {t("logs.clearFilters")}
              </button>
            )}
            <button
              type="button"
              onClick={() => void exportCsv()}
              disabled={entries.length === 0}
              className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              title={t("logs.exportTitle")}
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
            {entries.length > 0 && (
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
          </>
        )}
        {entries === null ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <ScrollText className="h-8 w-8 animate-pulse text-muted-foreground/60" />
            <p className="text-sm font-medium">{t("common.loading")}</p>
          </div>
        ) : (filtered?.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <ScrollText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              {entries.length ? t("logs.noMatch") : t("logs.emptyTitle")}
            </p>
            <p className="max-w-md px-4 text-xs leading-relaxed text-muted-foreground">
              {entries.length ? t("logs.noMatchHint") : t("logs.emptyHint")}
            </p>
            {entries.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => { setQ(""); setProv(""); setOnlyErrors(false); }}>
                {t("logs.clearFilters")}
              </Button>
            )}
            {entries.length === 0 && (
              <Button variant="outline" size="sm" onClick={() => void reload()} disabled={refreshing}>
                <RefreshCw className={`mr-1 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                {t("logs.refresh")}
              </Button>
            )}
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full min-w-[700px] text-xs">
              <thead className="text-muted-foreground sticky top-0 bg-card">
                <tr className="border-b border-border">
                  <th className="text-left font-medium px-4 py-2">{t("logs.time")}</th>
                  <th className="text-left font-medium px-2 py-2">{t("logs.provider")}</th>
                  <th className="text-left font-medium px-2 py-2">{t("logs.model")}</th>
                  <th className="text-right font-medium px-2 py-2">↓</th>
                  <th className="text-right font-medium px-2 py-2">↑</th>
                  <th className="text-right font-medium px-2 py-2">{t("logs.duration")}</th>
                  <th className="text-right font-medium px-3 py-2">{t("logs.status")}</th>
                  <th className="w-8 px-2 py-2" aria-label={t("logs.detailHint")} />
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {grouped?.map(([day, dayEntries]) => (
                  <Fragment key={day}>
                    <tr className="bg-muted/40">
                      <td
                        colSpan={8}
                        className="px-4 py-1 text-[11px] font-semibold text-muted-foreground"
                      >
                        {day} · {dayEntries.length}
                      </td>
                    </tr>
                    {dayEntries.map((e) => (
                  <tr
                    key={e.id}
                    onClick={() => setDetail(e)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setDetail(e);
                      }
                    }}
                    className={`cursor-pointer border-b border-border/50 hover:bg-accent/50 focus-within:bg-accent/50 focus-visible:outline-none focus-visible:bg-accent/50 ${e.status >= 400 ? "bg-red-500/[0.025]" : ""}`}
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
                    <td className="px-3 py-1.5 text-right">
                      <span title={e.error_note ?? undefined}>
                        <StatusBadge status={e.status} />
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right text-muted-foreground">
                      <ChevronRight className="ml-auto h-3.5 w-3.5" aria-hidden="true" />
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
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <StatusBadge status={detail.status} />
                  <span className="truncate text-right font-medium">{detail.model ?? "—"}</span>
                </div>
                <p className="mt-2 truncate text-muted-foreground">{nameOf(detail.provider_id)}</p>
              </div>
              {[
                [t("logs.time"), fmtTime(detail.created_at)],
                ["↓", String(detail.input_tokens)],
                ["↑", String(detail.output_tokens)],
                [t("logs.duration"), detail.duration_ms > 0 ? `${(detail.duration_ms / 1000).toFixed(1)}s` : "—"],
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
              {detail.status >= 400 && (
                <div className="space-y-2.5 border-t border-border pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {t("logs.recoveryTitle")}
                  </p>
                  <Button
                    className="w-full"
                    size="sm"
                    onClick={() => {
                      setDetail(null);
                      onQuickSwitch();
                    }}
                  >
                    <Zap className="h-3.5 w-3.5" />
                    {t("logs.quickSwitch")}
                  </Button>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={detailTesting || !providers.some((provider) => provider.id === detail.provider_id)}
                      onClick={() => void retestDetailProvider(detail)}
                    >
                      <Activity className={detailTesting ? "h-3.5 w-3.5 animate-pulse" : "h-3.5 w-3.5"} />
                      {t(detailTesting ? "logs.retesting" : "logs.retest")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void copyErrorSummary(detail)}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {t("logs.copyError")}
                    </Button>
                  </div>
                  {detailTest && (
                    <p
                      role="status"
                      className={detailTest.ok
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"}
                    >
                      {detailTest.ok
                        ? t("logs.retestOk", { ms: detailTest.latency_ms })
                        : t("logs.retestFail", { message: detailTest.message || t("provider.testFail") })}
                    </p>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
