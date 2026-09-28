import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowRight, CircleAlert, FlaskConical, Route, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import type { AppType, Provider } from "@/types";
import { cn } from "@/lib/utils";

interface RoutePreviewResult {
  model: string;
  rule_hit: boolean;
  pattern: string | null;
  provider: string;
  fallback: string | null;
  candidates?: string[];
}

const IS_DEMO = new URLSearchParams(location.search).has("demo");

function demoPreview(model: string, providers: Provider[]): RoutePreviewResult {
  const normalized = model.toLowerCase();
  const hit = normalized.includes("o3") || normalized.includes("reasoning");
  const preferred = providers[0];
  const fallback = providers.find((provider) => provider.id !== preferred?.id);
  const candidates = [preferred?.name, fallback?.name].filter(
    (name): name is string => Boolean(name),
  );
  return {
    model,
    rule_hit: hit,
    pattern: hit ? "o3" : null,
    provider: preferred?.name ?? "",
    fallback: fallback?.name ?? null,
    candidates,
  };
}

export function RoutePreviewCard({
  app,
  providers,
  onManage,
}: {
  app: AppType;
  providers: Provider[];
  onManage: () => void;
}) {
  const { t } = useI18n();
  const [model, setModel] = useState("");
  const [result, setResult] = useState<RoutePreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestId = useRef(0);
  const defaultProvider = providers.find((provider) => provider.is_current)?.name;
  const suggestions = Array.from(
    new Set(providers.flatMap((provider) => provider.models)),
  ).slice(0, 4);

  useEffect(() => {
    requestId.current += 1;
    setResult(null);
    setFailed(false);
    setLoading(false);
  }, [app]);

  const run = async (value = model) => {
    const requestedModel = value.trim();
    if (!requestedModel) return;
    const currentRequest = ++requestId.current;
    setModel(requestedModel);
    setLoading(true);
    setFailed(false);
    try {
      const preview = IS_DEMO
        ? demoPreview(requestedModel, providers)
        : await invoke<RoutePreviewResult>("dry_run_route", {
            appType: app,
            model: requestedModel,
          });
      if (requestId.current === currentRequest) setResult(preview);
    } catch {
      if (requestId.current === currentRequest) {
        setResult(null);
        setFailed(true);
      }
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  };

  const candidates = result?.candidates?.length
    ? result.candidates
    : result?.provider
      ? [result.provider]
      : [];
  const inputId = `route-preview-${app}`;

  return (
    <section id="route-preview" className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 sm:px-5 lg:grid-cols-[minmax(170px,0.62fr)_minmax(300px,1.38fr)_auto] lg:items-center">
        <label htmlFor={inputId} className="flex min-w-0 items-center gap-2.5">
          <Route className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{t("route.previewTitle")}</span>
            <span className="mt-0.5 hidden truncate text-[11px] text-muted-foreground xl:block">
              {t("route.previewLocalOnly")}
            </span>
          </span>
        </label>

        <div className="col-span-2 flex min-w-0 gap-2 lg:col-span-1">
          <div className="relative min-w-0 flex-1">
            <FlaskConical className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={inputId}
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                if (result) setResult(null);
                if (failed) setFailed(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void run();
              }}
              placeholder={t("route.previewPh")}
              className="h-9 pl-8 pr-8 text-xs"
            />
            {model && (
              <button
                type="button"
                aria-label={t("route.previewClear")}
                onClick={() => {
                  setModel("");
                  setResult(null);
                  setFailed(false);
                }}
                className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button
            size="sm"
            className="h-9 shrink-0"
            disabled={loading || !model.trim()}
            onClick={() => void run()}
          >
            <FlaskConical className={cn("h-3.5 w-3.5", loading && "animate-pulse")} />
            <span className="hidden sm:inline">
              {loading ? t("route.previewRunning") : t("route.previewRun")}
            </span>
          </Button>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="col-start-2 row-start-1 h-8 justify-self-end lg:col-start-auto lg:row-start-auto"
          aria-label={t("route.previewManage")}
          title={t("route.previewManage")}
          onClick={onManage}
        >
          <Settings2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("route.previewManage")}</span>
        </Button>
      </div>

      {suggestions.length > 0 && !result && !failed && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground sm:px-5">
          <span>{t("route.previewTry")}</span>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => void run(suggestion)}
              className="rounded-md border border-border bg-muted/50 px-2 py-1 font-mono text-[10px] hover:border-blue-400/60 hover:text-foreground"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {failed && (
        <div className="flex items-center gap-2 border-t border-border/70 bg-amber-500/[0.05] px-4 py-2.5 text-xs text-amber-700 dark:text-amber-300 sm:px-5">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" />
          {t("route.previewError")}
        </div>
      )}

      {result ? (
        <div className="flex flex-col gap-2 border-t border-border/70 bg-muted/20 px-4 py-2.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
            <span className="rounded-md bg-blue-500/10 px-2 py-1 font-medium text-blue-700 dark:text-blue-300">
              {result.rule_hit ? t("route.previewRule") : t("route.previewDefault")}
            </span>
            <code className="max-w-[240px] truncate rounded bg-background px-1.5 py-1 font-mono text-[11px] text-foreground">
              {result.model}
            </code>
            {result.rule_hit && result.pattern && (
              <span className="text-muted-foreground">
                {t("route.previewMatched", { pattern: result.pattern })}
              </span>
            )}
          </div>
          {candidates.length > 0 ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
              <span className="mr-1 text-[11px] text-muted-foreground">
                {t("route.previewPath")}
              </span>
              {candidates.map((candidate, index) => (
                <span key={`${candidate}-${index}`} className="flex min-w-0 items-center gap-1.5">
                  {index > 0 && <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                  <span className={cn(
                    "max-w-[170px] truncate rounded-md border px-2 py-1",
                    index === 0
                      ? "border-blue-500/30 bg-background font-semibold text-foreground"
                      : "border-border bg-muted/40 text-muted-foreground",
                  )}>
                    {candidate}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {t("route.previewNoProvider")}
            </p>
          )}
        </div>
      ) : !failed && suggestions.length === 0 ? (
        <div className="flex min-w-0 items-center gap-2 border-t border-border/70 bg-muted/20 px-4 py-2.5 text-xs sm:px-5">
          <span className="shrink-0 text-muted-foreground">{t("route.previewDefault")}</span>
          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate font-semibold">
            {defaultProvider ?? t("route.previewNoProvider")}
          </span>
        </div>
      ) : null}
    </section>
  );
}
