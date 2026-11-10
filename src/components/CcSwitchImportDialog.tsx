import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Database, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useI18n } from "@/i18n";
import type { AppType } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProviderIcon } from "@/components/ProviderIcon";
import { cn } from "@/lib/utils";
import { ccSwitchItemKey, selectionForFilter } from "@/lib/ccSwitchImport";
import { humanizeError } from "@/lib/errors";

interface CcSwitchProvider {
  source_id: string;
  app_type: AppType;
  name: string;
  base_url: string;
  has_key: boolean;
  is_current: boolean;
  importable: boolean;
  reason: "missing_url" | "local_proxy" | "unsafe_url" | "missing_key" | "duplicate" | null;
}

interface ImportResult {
  imported: {
    source_id: string;
    app_type: AppType;
    name: string;
  }[];
  skipped: string[];
}

type Filter = "all" | AppType;

const APPS: AppType[] = ["claude", "codex", "gemini"];

/** 浏览器演示模式(?demo=1):mock 扫描结果,便于官网/文档截图 */
const IS_DEMO = new URLSearchParams(location.search).has("demo");
/** 浏览器演示模式(?demo=1):mock 扫描结果,便于官网/文档截图;名称跟随界面语言 */
const demoItemsFor = (locale: "zh" | "en"): CcSwitchProvider[] => [
  { source_id: "d1", app_type: "claude", name: "CoderPlan", base_url: "https://api.coderplan.ai", has_key: true, is_current: false, importable: true, reason: null },
  { source_id: "d2", app_type: "claude", name: "TeapotRouter", base_url: "https://api.teapotrouter.com", has_key: true, is_current: true, importable: true, reason: null },
  { source_id: "d3", app_type: "claude", name: locale === "zh" ? "Claude 官方" : "Claude Official", base_url: "https://api.anthropic.com", has_key: true, is_current: false, importable: true, reason: null },
  { source_id: "d4", app_type: "claude", name: locale === "zh" ? "本地代理" : "Local proxy", base_url: "http://127.0.0.1:8080", has_key: true, is_current: false, importable: false, reason: "local_proxy" },
];

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

const REASON_KEYS = {
  missing_url: "ccSwitch.reasonMissingUrl",
  local_proxy: "ccSwitch.reasonLocalProxy",
  unsafe_url: "ccSwitch.reasonUnsafeUrl",
  missing_key: "ccSwitch.reasonMissingKey",
  duplicate: "ccSwitch.reasonDuplicate",
} as const;

export function CcSwitchImportDialog({
  open,
  onOpenChange,
  activeApp,
  onImported,
  onManageTakeover,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeApp: AppType;
  onImported: (apps: AppType[]) => void;
  onManageTakeover: (app: AppType) => void;
  onError: (message: string) => void;
}) {
  const { t, locale } = useI18n();
  const demoItems = demoItemsFor(locale);
  const [items, setItems] = useState<CcSwitchProvider[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const scan = async (selectionFilter: Filter = filter) => {
    setLoading(true);
    setScanError(null);
    setResult(null);
    try {
      if (IS_DEMO) {
        setItems(demoItems);
        setSelected(selectionForFilter(demoItems, selectionFilter));
        return;
      }
      const found = await invoke<CcSwitchProvider[]>("scan_cc_switch_providers");
      setItems(found);
      setSelected(selectionForFilter(found, selectionFilter));
    } catch (error) {
      setItems([]);
      setSelected(new Set());
      setScanError(String(error).replace(/^Error:\s*/i, ""));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const nextFilter = activeApp === "claude" || activeApp === "codex" || activeApp === "gemini" ? activeApp : "all";
    setFilter(nextFilter);
    void scan(nextFilter);
    // Scan only when the dialog opens; changing the current app should not
    // discard a user's in-progress selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const visibleItems = useMemo(
    () => filter === "all" ? items : items.filter((item) => item.app_type === filter),
    [filter, items],
  );
  const selectedVisible = visibleItems.filter((item) => selected.has(ccSwitchItemKey(item)) && item.importable).length;
  const selectedCount = items.filter((item) => selected.has(ccSwitchItemKey(item)) && item.importable).length;
  const importedApps = useMemo(
    () => [...new Set((result?.imported ?? []).map((item) => item.app_type))],
    [result],
  );

  const toggle = (item: CcSwitchProvider) => {
    if (!item.importable) return;
    const key = ccSwitchItemKey(item);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setResult(null);
  };

  const selectVisible = (checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const item of visibleItems) {
        if (!item.importable) continue;
        if (checked) next.add(ccSwitchItemKey(item));
        else next.delete(ccSwitchItemKey(item));
      }
      return next;
    });
    setResult(null);
  };

  const importSelected = async () => {
    const requests = items
      .filter((item) => item.importable && selected.has(ccSwitchItemKey(item)))
      .map((item) => ({ source_id: item.source_id, app_type: item.app_type }));
    if (requests.length === 0 || importing) return;
    setImporting(true);
    try {
      let importedResult: ImportResult;
      if (IS_DEMO) {
        const byId = new Map(demoItems.map((item) => [item.source_id, item]));
        importedResult = {
          imported: requests.map((r) => ({ source_id: r.source_id, app_type: r.app_type, name: byId.get(r.source_id)?.name ?? r.source_id })),
          skipped: [],
        };
      } else {
        importedResult = await invoke<ImportResult>("import_cc_switch_providers", { requests });
      }
      setResult(importedResult);
      if (importedResult.imported.length > 0) {
        const apps = [...new Set(importedResult.imported.map((item) => item.app_type))];
        onImported(apps);
      }
    } catch (error) {
      onError(String(error));
    } finally {
      setImporting(false);
    }
  };

  const preferredTakeoverApp = importedApps.includes("codex")
    ? "codex"
    : importedApps[0] ?? activeApp;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!importing) onOpenChange(next); }}>
      <DialogContent className="grid-cols-1 sm:max-w-[650px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            {t("ccSwitch.title")}
          </DialogTitle>
          <DialogDescription>{t("ccSwitch.desc")}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2.5 rounded-lg border border-blue-500/25 bg-blue-500/5 p-3 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">{t("ccSwitch.readOnly")}</p>
            <p>{t("ccSwitch.safety")}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>
              {t("ccSwitch.all")}
            </Button>
            {APPS.map((app) => (
              <Button key={app} size="sm" variant={filter === app ? "default" : "outline"} onClick={() => setFilter(app)}>
                {t(`app.${app}`)}
              </Button>
            ))}
          </div>
          <Button size="sm" variant="ghost" disabled={loading || importing} onClick={() => void scan()}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            {t("ccSwitch.rescan")}
          </Button>
        </div>

        {scanError ? (
          <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
            <p className="font-medium">{t("ccSwitch.notFound")}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{humanizeError(scanError, t)}</p>
          </div>
        ) : loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("ccSwitch.scanning")}</p>
        ) : visibleItems.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("ccSwitch.empty")}</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("ccSwitch.found", { n: visibleItems.length })}</span>
              <button
                type="button"
                className="text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                disabled={visibleItems.every((item) => !item.importable)}
                onClick={() => selectVisible(selectedVisible !== visibleItems.filter((item) => item.importable).length)}
              >
                {selectedVisible === visibleItems.filter((item) => item.importable).length
                  ? t("ccSwitch.unselectVisible")
                  : t("ccSwitch.selectVisible")}
              </button>
            </div>
            <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
              {visibleItems.map((item) => {
                const key = ccSwitchItemKey(item);
                const checked = selected.has(key);
                return (
                  <button
                    type="button"
                    key={key}
                    disabled={!item.importable}
                    aria-pressed={checked}
                    onClick={() => toggle(item)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                      item.importable ? "hover:bg-accent" : "cursor-not-allowed opacity-70",
                      checked && "border-primary/60 bg-primary/5",
                    )}
                  >
                    <span className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      checked ? "border-primary bg-primary text-primary-foreground" : "border-border",
                    )}>
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <ProviderIcon icon={item.app_type} name={item.name} size={20} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{item.name}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t(`app.${item.app_type}`)}</span>
                        {item.is_current && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">{t("ccSwitch.current")}</span>}
                      </span>
                      <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">{safeUrl(item.base_url) || "—"}</span>
                      <span className={cn(
                        "mt-1 flex items-center gap-1 text-xs",
                        item.importable ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300",
                      )}>
                        {item.importable ? <ShieldCheck className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
                        {item.importable
                          ? t("ccSwitch.ready")
                          : item.reason
                            ? t(REASON_KEYS[item.reason])
                            : t("ccSwitch.unavailable")}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {result && (
          <div className={cn(
            "rounded-xl border p-3 text-sm",
            result.imported.length > 0
              ? "border-emerald-500/25 bg-emerald-500/5"
              : "border-amber-500/25 bg-amber-500/5",
          )}>
            <p className={cn(
              "font-medium",
              result.imported.length > 0
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-amber-700 dark:text-amber-300",
            )}>
              {t(result.imported.length > 0 ? "ccSwitch.imported" : "ccSwitch.noImported", { n: result.imported.length })}
            </p>
            {result.skipped.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">{t("ccSwitch.skipped", { n: result.skipped.length })}</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={importing} onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
          {result && result.imported.length > 0 && (
            <Button onClick={() => onManageTakeover(preferredTakeoverApp)}>
              {t("ccSwitch.manageTakeover")}
            </Button>
          )}
          {!result && (
            <Button disabled={loading || importing || selectedCount === 0} onClick={() => void importSelected()}>
              {importing ? t("ccSwitch.importing") : t("ccSwitch.importSelected", { n: selectedCount })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
