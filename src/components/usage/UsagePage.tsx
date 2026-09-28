import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { BarChart3, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n";
import type { Provider } from "@/types";

interface UsageSummary {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  errors?: number;
}
interface NamedUsage extends UsageSummary {
  avg_duration_ms?: number;
  key: string;
}
interface DayUsage {
  date: string;
  requests: number;
  tokens: number;
}
interface UsageDashboard {
  total: UsageSummary;
  by_provider: NamedUsage[];
  by_model: NamedUsage[];
  by_day: DayUsage[];
}

const IS_DEMO = new URLSearchParams(location.search).has("demo");

const DEMO: UsageDashboard = {
  total: { requests: 412, input_tokens: 3_860_000, output_tokens: 9_420_000 },
  by_provider: [
    { key: "demo-1", requests: 351, input_tokens: 3_300_000, output_tokens: 8_100_000 },
    { key: "demo-2", requests: 61, input_tokens: 560_000, output_tokens: 1_320_000 },
  ],
  by_model: [
    { key: "glm-4.6", requests: 288, input_tokens: 2_700_000, output_tokens: 6_400_000 },
    { key: "kimi-k2", requests: 98, input_tokens: 1_000_000, output_tokens: 2_600_000 },
    { key: "claude-sonnet-4.5", requests: 26, input_tokens: 160_000, output_tokens: 420_000 },
  ],
  by_day: [
    { date: "08-17", requests: 41, tokens: 1_020_000 },
    { date: "08-18", requests: 66, tokens: 1_540_000 },
    { date: "08-19", requests: 38, tokens: 910_000 },
    { date: "08-20", requests: 72, tokens: 1_780_000 },
    { date: "08-21", requests: 95, tokens: 2_260_000 },
    { date: "08-22", requests: 61, tokens: 1_410_000 },
    { date: "08-23", requests: 39, tokens: 860_000 },
  ],
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(n: number): string {
  if (n >= 100) return `$${Math.round(n).toLocaleString()}`;
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function StatCard({
  label,
  value,
  detail,
  emphasis = false,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail?: string;
  emphasis?: boolean;
  tone?: "neutral" | "positive" | "negative";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "negative"
        ? "text-red-600 dark:text-red-400"
        : "text-foreground";
  return (
    <div
      className={
        "rounded-xl border p-3.5 sm:p-4 " +
        (emphasis
          ? "border-blue-500/30 bg-blue-500/[0.06]"
          : "border-border bg-card")
      }
    >
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums sm:text-2xl ${toneClass}`}>
        {value}
      </div>
      {detail && (
        <div className="mt-1 truncate text-[11px] text-muted-foreground">{detail}</div>
      )}
    </div>
  );
}

function EmptyPanel({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
      <BarChart3 className="h-6 w-6 text-muted-foreground/70" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{hint}</p>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-2 animate-pulse rounded-full bg-muted" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
      <div className="h-2 animate-pulse rounded-full bg-muted" />
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function formatDay(date: string): string {
  const parts = date.split("-");
  return parts.length === 3 ? `${parts[1]}-${parts[2]}` : date;
}

function formatTokenTotal(n: number): string {
  return `${fmt(n)} tok`;
}

function TrendMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Bars({
  rows,
  format,
}: {
  rows: { key: string; label: string; value: number; sub?: string }[];
  format: (n: number) => string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.key} className="text-xs">
          <div className="flex justify-between mb-1">
            <span className="font-medium truncate max-w-[60%]">{r.label}</span>
            <span className="text-muted-foreground tabular-nums">
              {format(r.value)}
              {r.sub ? ` · ${r.sub}` : ""}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500"
              style={{ width: `${Math.max((r.value / max) * 100, 2)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function UsagePage({
  app,
  appName,
  providers,
  onError,
  onInfo,
}: {
  app: string;
  appName: string;
  providers: Provider[];
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<UsageDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  const [days, setDays] = useState(() => {
    const v = Number(localStorage.getItem("keyway.dash.days"));
    return [1, 7, 30].includes(v) ? v : 7;
  });
  // 模型单价表(批 C):model → { i: 输入 $/M, o: 输出 $/M }
  const [prices, setPrices] = useState<Record<string, { i: number; o: number }>>({});
  const [draft, setDraft] = useState<Record<string, { i: string; o: string }>>({});
  const [priceOpen, setPriceOpen] = useState(false);
  const [newModel, setNewModel] = useState("");

  const reload = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    if (IS_DEMO) {
      if (requestId.current === currentRequest) {
        setData(DEMO);
        setLoading(false);
      }
      return;
    }
    try {
      const result = await invoke<UsageDashboard>("get_usage_dashboard", {
        appType: app,
        days,
      });
      if (requestId.current === currentRequest) setData(result);
    } catch (e) {
      if (requestId.current === currentRequest) onError(String(e));
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }, [app, days, onError]);

  useEffect(() => {
    void reload();
    return () => {
      requestId.current += 1;
    };
  }, [reload]);

  const loadPrices = useCallback(() => {
    if (IS_DEMO) return;
    invoke<[string, number, number][]>("get_model_prices")
      .then((l) => {
        const m: Record<string, { i: number; o: number }> = {};
        for (const [k, i, o] of l) m[k] = { i, o };
        setPrices(m);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadPrices();
  }, [loadPrices]);

  // 新出现的模型补一行草稿(已有单价填入,否则留空)
  useEffect(() => {
    if (!data) return;
    setDraft((d) => {
      const next = { ...d };
      for (const m of data.by_model) {
        if (next[m.key]) continue;
        const p = prices[m.key];
        next[m.key] = { i: p ? String(p.i) : "", o: p ? String(p.o) : "" };
      }
      return next;
    });
  }, [data, prices]);

  const modelCost = (m: NamedUsage): number | null => {
    const p = prices[m.key];
    if (!p) return null;
    return (m.input_tokens / 1e6) * p.i + (m.output_tokens / 1e6) * p.o;
  };
  const totalCost = (data?.by_model ?? []).reduce<number>(
    (acc, m) => acc + (modelCost(m) ?? 0),
    0,
  );
  const hasAnyPrice = Object.keys(prices).length > 0;

  const savePrice = async (model: string) => {
    const d = draft[model];
    if (!d) return;
    const i = d.i.trim() === "" ? 0 : Number(d.i);
    const o = d.o.trim() === "" ? 0 : Number(d.o);
    if (!Number.isFinite(i) || !Number.isFinite(o) || i < 0 || o < 0) {
      onError(t("dash.priceInvalid"));
      return;
    }
    try {
      await invoke("set_model_price", { model, input: i, output: o });
      onInfo(t("dash.priceSaved", { n: model }));
      loadPrices();
    } catch (e) {
      onError(String(e));
    }
  };
  const removePrice = async (model: string) => {
    try {
      await invoke("remove_model_price", { model });
      onInfo(t("dash.priceRemoved", { n: model }));
      setDraft((d) => {
        const next = { ...d };
        delete next[model];
        return next;
      });
      loadPrices();
    } catch (e) {
      onError(String(e));
    }
  };
  const addPriceRow = () => {
    const m = newModel.trim();
    if (!m) return;
    setDraft((d) => ({ ...d, [m]: { i: "", o: "" } }));
    setNewModel("");
  };

  const nameOf = (id: string) =>
    providers.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  const dayMax = Math.max(...(data?.by_day.map((d) => d.tokens) ?? [1]), 1);
  const totalInput = data?.total.input_tokens ?? 0;
  const totalOutput = data?.total.output_tokens ?? 0;
  const totalTokens = totalInput + totalOutput;
  const totalErrors = data?.total.errors ?? 0;
  const successRate =
    data && data.total.requests > 0
      ? Math.round(((data.total.requests - totalErrors) / data.total.requests) * 100)
      : 0;
  const rangeRequests = data?.by_day.reduce((sum, day) => sum + day.requests, 0) ?? 0;
  const rangeTokens = data?.by_day.reduce((sum, day) => sum + day.tokens, 0) ?? 0;
  const peakDay = data?.by_day.reduce<DayUsage | null>(
    (peak, day) => (!peak || day.tokens > peak.tokens ? day : peak),
    null,
  );

  return (
    <div className="w-full space-y-5 sm:space-y-6" aria-busy={loading}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
            <BarChart3 className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              {appName} · {t("dash.overview")}
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">{t("dash.title")}</h2>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{t("dash.pageDesc")}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-60"
          title={t("dash.refresh")}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">{t("dash.refresh")}</span>
        </button>
      </div>

      {/* 总览 */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        <StatCard
          label={t("dash.requests")}
          value={data ? fmt(data.total.requests) : "—"}
          detail={data ? t("dash.scopeAll") : "—"}
          emphasis
        />
        <StatCard
          label={t("dash.totalTokens")}
          value={data ? formatTokenTotal(totalTokens) : "—"}
          detail={data ? t("dash.inputOutput", { input: fmt(totalInput), output: fmt(totalOutput) }) : "—"}
        />
        <StatCard
          label={t("dash.successRate")}
          value={data?.total.requests ? `${successRate}%` : "—"}
          detail={data ? (totalErrors ? t("dash.fails", { n: totalErrors }) : t("dash.noFailures")) : "—"}
          tone={!data?.total.requests ? "neutral" : totalErrors ? "negative" : "positive"}
        />
        <StatCard
          label={t("dash.failures")}
          value={data ? fmt(totalErrors) : "—"}
          detail={data?.total.requests ? `${Math.round((totalErrors / data.total.requests) * 100)}%` : "—"}
          tone={totalErrors ? "negative" : "neutral"}
        />
      </div>

      {/* 趋势 */}
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">
              {days === 1 ? t("dash.trendToday") : t("dash.trendN", { n: days })}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("dash.trendHint")}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5" role="group" aria-label={t("dash.trend")}>
              {[1, 7, 30].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setDays(d);
                    localStorage.setItem("keyway.dash.days", String(d));
                  }}
                  className={
                    "h-6 rounded-md px-2 text-[11px] font-medium transition-all " +
                    (days === d
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
        </div>
        {loading && !data ? (
          <div className="mt-4 h-32 animate-pulse rounded-lg bg-muted/40" />
        ) : data && data.by_day.length > 0 ? (
          <div className="mt-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border/70 py-3 sm:grid-cols-4">
              <TrendMetric
                label={t("dash.requests")}
                value={String(rangeRequests)}
              />
              <TrendMetric
                label={t("dash.totalTokens")}
                value={formatTokenTotal(rangeTokens)}
              />
              <TrendMetric
                label={t("dash.peakDay")}
                value={peakDay ? formatDay(peakDay.date) : "—"}
              />
              <TrendMetric
                label={t("dash.avgTokens")}
                value={rangeRequests ? formatTokenTotal(Math.round(rangeTokens / rangeRequests)) : "—"}
              />
            </dl>
            <div className="mt-4 flex h-36 min-w-0 items-end gap-2 rounded-lg border border-border/70 bg-muted/10 px-3 pb-2 pt-3">
              {data.by_day.map((day) => (
                <div key={day.date} className="group flex h-full min-w-0 flex-1 flex-col items-center gap-1.5">
                  <div className="flex min-h-0 w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t-md bg-blue-500/70 transition-colors group-hover:bg-blue-500"
                      style={{ height: `${Math.max((day.tokens / dayMax) * 100, 4)}%` }}
                      title={`${day.date}: ${fmt(day.tokens)} tokens / ${day.requests} ${t("dash.reqUnit")}`}
                      aria-label={`${day.date}: ${fmt(day.tokens)} tokens, ${day.requests} ${t("dash.reqUnit")}`}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {formatDay(day.date)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <EmptyPanel title={t("dash.emptyTitle")} hint={t("dash.emptyHint")} />
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 按供应商 */}
        <SectionCard
          title={t("dash.byProvider")}
          description={t("dash.distributionHint")}
        >
          {loading && !data ? (
            <LoadingPanel />
          ) : data && data.by_provider.length > 0 ? (
            <Bars
              rows={data.by_provider.map((p) => ({
                key: p.key,
                label: nameOf(p.key),
                value: p.input_tokens + p.output_tokens,
                sub:
                  `${p.requests} ${t("dash.reqUnit")}` +
                  ((p.errors ?? 0) > 0 ? ` · ${t("dash.fails", { n: p.errors ?? 0 })}` : "") +
                  (p.avg_duration_ms && p.avg_duration_ms > 0
                    ? ` · ${(p.avg_duration_ms / 1000).toFixed(1)}s`
                    : ""),
              }))}
              format={fmt}
            />
          ) : (
            <EmptyPanel title={t("dash.emptyTitle")} hint={t("dash.emptyHint")} />
          )}
        </SectionCard>

        {/* 按模型 */}
        <SectionCard
          title={t("dash.byModel")}
          description={t("dash.distributionHint")}
        >
          <div className="mb-4 flex items-center justify-between">
            <button
            type="button"
            title={t("dash.exportModels")}
            onClick={async () => {
              try {
                const target = await save({
                  defaultPath: `keyway-models-${days}d.csv`,
                  filters: [{ name: "CSV", extensions: ["csv"] }],
                });
                if (!target) return;
                const result = await invoke<{ path: string; count: number }>(
                  "export_usage_models_csv",
                  { appType: app, days, target },
                );
                onInfo(t("dash.exported", { n: result.count, path: result.path }));
              } catch (e) {
                onError(String(e));
              }
            }}
            className="h-6 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            CSV
            </button>
            <div className="flex items-center gap-3">
              {hasAnyPrice && totalCost > 0 && (
                <span className="text-xs font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                  {t("dash.costTotal", { c: fmtCost(totalCost) })}
                </span>
              )}
              <button
                type="button"
                onClick={() => setPriceOpen((v) => !v)}
                className={
                  "h-6 rounded-md px-2 text-[11px] font-medium transition-all " +
                  (priceOpen || hasAnyPrice
                    ? "text-blue-500"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {t("dash.priceTable")}
              </button>
            </div>
          </div>
          {loading && !data ? (
            <LoadingPanel />
          ) : data && data.by_model.length > 0 ? (
            <Bars
            rows={data.by_model.map((m) => {
              const cost = modelCost(m);
              return {
                key: m.key,
                label: m.key,
                value: m.input_tokens + m.output_tokens,
                sub:
                  `${m.requests} ${t("dash.reqUnit")}` +
                  ((m.errors ?? 0) > 0 ? ` · ${t("dash.fails", { n: m.errors ?? 0 })}` : "") +
                  (m.avg_duration_ms && m.avg_duration_ms > 0
                    ? ` · ${(m.avg_duration_ms / 1000).toFixed(1)}s`
                    : "") +
                  (cost != null ? ` · ${fmtCost(cost)}` : ""),
              };
            })}
            format={fmt}
              />
          ) : (
            <EmptyPanel title={t("dash.emptyTitle")} hint={t("dash.emptyHint")} />
          )}

        {/* 单价表:本地保存,用于估算成本 */}
        {priceOpen && (
          <div className="mt-4 overflow-x-auto border-t border-border pt-3">
            <div className="min-w-[420px] space-y-2">
            <p className="text-[11px] text-muted-foreground">{t("dash.priceHint")}</p>
            {Object.entries(draft).map(([model, d]) => (
              <div key={model} className="flex items-center gap-2 text-xs">
                <span className="flex-1 truncate font-medium">{model}</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={d.i}
                  placeholder={t("dash.priceIn")}
                  onChange={(e) =>
                    setDraft((x) => ({ ...x, [model]: { ...d, i: e.target.value } }))
                  }
                  className="w-24 h-7 rounded-md border border-border bg-background px-2 tabular-nums"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={d.o}
                  placeholder={t("dash.priceOut")}
                  onChange={(e) =>
                    setDraft((x) => ({ ...x, [model]: { ...d, o: e.target.value } }))
                  }
                  className="w-24 h-7 rounded-md border border-border bg-background px-2 tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => void savePrice(model)}
                  className="px-2 h-7 rounded-md text-[11px] font-medium text-blue-500 hover:bg-blue-500/10 transition-all"
                >
                  {t("common.save")}
                </button>
                {prices[model] && (
                  <button
                    type="button"
                    onClick={() => void removePrice(model)}
                    className="px-1.5 h-7 rounded-md text-[11px] text-muted-foreground hover:text-red-500 transition-all"
                  >
                    {t("common.delete")}
                  </button>
                )}
              </div>
            ))}
            {/* 新增任意模型 */}
            <div className="flex items-center gap-2 text-xs">
              <input
                type="text"
                value={newModel}
                placeholder={t("dash.priceNewPh")}
                onChange={(e) => setNewModel(e.target.value)}
                className="flex-1 h-7 rounded-md border border-border bg-background px-2"
              />
              <button
                type="button"
                onClick={addPriceRow}
                disabled={!newModel.trim()}
                className="px-2 h-7 rounded-md text-[11px] font-medium text-blue-500 hover:bg-blue-500/10 transition-all disabled:opacity-40"
              >
                {t("dash.priceAdd")}
              </button>
            </div>
            </div>
          </div>
        )}
        </SectionCard>
      </div>

      <p className="text-xs text-muted-foreground flex items-center justify-end gap-1.5">
        <BarChart3 className="w-3.5 h-3.5" />
        {t("dash.note")}
      </p>
    </div>
  );
}
