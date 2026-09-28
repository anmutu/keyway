import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowRight,
  Check,
  CircleHelp,
  GitBranch,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { AppType } from "@/types";

const IS_DEMO = new URLSearchParams(location.search).has("demo");

function GuideStep({
  index,
  done,
  title,
  description,
  action,
  onAction,
}: {
  index: number;
  done: boolean;
  title: string;
  description: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <span
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
          done
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : "bg-muted text-muted-foreground",
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : index}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0 px-2.5 text-xs"
        onClick={onAction}
      >
        {action}
      </Button>
    </div>
  );
}

export function GettingStartedDialog({
  open,
  onOpenChange,
  app,
  providersCount,
  takeoverEffective,
  onAdd,
  onTakeover,
  onQuickSwitch,
  onLogs,
  onRouting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  app: AppType;
  providersCount: number;
  takeoverEffective: boolean;
  onAdd: () => void;
  onTakeover: () => void;
  onQuickSwitch: () => void;
  onLogs: () => void;
  onRouting: () => void;
}) {
  const { t } = useI18n();
  const [hasRequest, setHasRequest] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    if (IS_DEMO) {
      setHasRequest(true);
      return;
    }
    setHasRequest(null);
    void invoke<{ last?: Record<string, unknown> }>("gateway_status")
      .then((status) => setHasRequest(Boolean(status.last?.[app])))
      .catch(() => setHasRequest(null));
  }, [app, open]);

  const completed =
    Number(providersCount > 0) +
    Number(takeoverEffective) +
    Number(hasRequest === true);
  const go = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-[560px]">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
            <div>
              <DialogTitle>{t("guide.title")}</DialogTitle>
              <DialogDescription className="mt-1 leading-relaxed">
                {t("guide.desc")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-center text-[11px] font-medium">
          <span>{t("guide.flowCli")}</span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="text-blue-600 dark:text-blue-400">Keyway</span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span>{t("guide.flowProvider")}</span>
        </div>

        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">{t("guide.quickTitle")}</h3>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {t("guide.progress", { done: completed })}
            </span>
          </div>
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            <GuideStep
              index={1}
              done={providersCount > 0}
              title={t("guide.step1Title")}
              description={t("guide.step1Desc")}
              action={t("guide.step1Action")}
              onAction={() => go(onAdd)}
            />
            <GuideStep
              index={2}
              done={takeoverEffective}
              title={t("guide.step2Title", { app: t(`app.${app}`) })}
              description={t("guide.step2Desc")}
              action={t("guide.step2Action")}
              onAction={() => go(onTakeover)}
            />
            <GuideStep
              index={3}
              done={hasRequest === true}
              title={t("guide.step3Title")}
              description={t("guide.step3Desc")}
              action={t("guide.step3Action")}
              onAction={() => go(onLogs)}
            />
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">{t("guide.dailyTitle")}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => go(onQuickSwitch)}
              className="rounded-xl border border-border px-3 py-3 text-left transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Search className="h-4 w-4 text-blue-500" />
                  {t("guide.switchTitle")}
                </span>
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                  ⌘⇧K
                </kbd>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {t("guide.switchDesc")}
              </p>
            </button>
            <button
              type="button"
              onClick={() => go(onRouting)}
              className="rounded-xl border border-border px-3 py-3 text-left transition-colors hover:bg-muted/50"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <GitBranch className="h-4 w-4 text-blue-500" />
                {t("guide.routeTitle")}
              </span>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {t("guide.routeDesc")}
              </p>
            </button>
          </div>
          <div className="mt-2 flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{t("guide.failoverDesc")}</span>
          </div>
        </section>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t("guide.runtimeTip")}
        </p>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t("guide.gotIt")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
