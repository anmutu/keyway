import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download, Plus } from "lucide-react";
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

const IS_DEMO = new URLSearchParams(location.search).has("demo");

export const WELCOME_DONE_KEY = "keyway-welcome-completed";

export function hasWelcomeDone(): boolean {
  return localStorage.getItem(WELCOME_DONE_KEY) === "1";
}

/** 首启向导走完的新装用户调用:欢迎卡与向导内容重叠,不再重复弹 */
export function markWelcomeDone(): void {
  localStorage.setItem(WELCOME_DONE_KEY, "1");
}

/**
 * 升级用户欢迎卡:一句介绍 + 两条"把供应商弄进来"的路(手动添加 / 从已有工具一键导入)。
 * 任务导向,替代自动播导览;界面导览降级为底部链接,想细看的人自己点。
 * 任何关闭方式都写标记,只弹一次。
 */
export function WelcomeDialog({
  open,
  onOpenChange,
  onAdd,
  onImport,
  onTour,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: () => void;
  onImport: () => void;
  onTour: () => void;
}) {
  const { t } = useI18n();
  const [found, setFound] = useState<number | null>(null);

  // 打开时静默预扫外部管理器:有货就把导入卡顶成主按钮,兑现"一键接进来"
  useEffect(() => {
    if (!open || IS_DEMO) return;
    setFound(null);
    invoke<unknown[]>("scan_cc_switch_providers")
      .then((l) => setFound(l.length))
      .catch(() => setFound(null));
  }, [open]);

  const close = () => {
    markWelcomeDone();
    onOpenChange(false);
  };
  const go = (action: () => void) => {
    markWelcomeDone();
    onOpenChange(false);
    action();
  };

  const importHot = found !== null && found > 0;

  const cards = [
    {
      key: "add",
      icon: <Plus className="h-4 w-4" />,
      title: t("welcome.addTitle"),
      desc: t("welcome.addDesc"),
      found: null as number | null,
      action: t("welcome.addAction"),
      primary: !importHot,
      onClick: () => go(onAdd),
    },
    {
      key: "import",
      icon: <Download className="h-4 w-4" />,
      title: t("welcome.importTitle"),
      desc: t("welcome.importDesc"),
      found,
      action: t("welcome.importAction"),
      primary: importHot,
      onClick: () => go(onImport),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("welcome.title")}</DialogTitle>
          <DialogDescription className="leading-relaxed">
            {t("welcome.desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={c.onClick}
              className={cn(
                "flex flex-col rounded-xl border p-4 text-left transition-colors",
                c.primary
                  ? "border-primary/60 bg-primary/5 hover:bg-primary/10"
                  : "border-border hover:bg-muted/50",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg",
                  c.primary
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {c.icon}
              </span>
              <span className="mt-2.5 text-sm font-semibold">{c.title}</span>
              <span className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {c.desc}
              </span>
              {c.found !== null && c.found > 0 && (
                <span className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  {t("welcome.found", { count: c.found })}
                </span>
              )}
              <span
                className={cn(
                  "mt-3 inline-flex items-center gap-1 text-xs font-medium",
                  c.primary ? "text-primary" : "text-muted-foreground",
                )}
              >
                {c.action} →
              </span>
            </button>
          ))}
        </div>

        <DialogFooter className="sm:justify-between">
          <button
            type="button"
            className="rounded-md px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => go(onTour)}
          >
            {t("welcome.tourLink")}
          </button>
          <Button variant="outline" onClick={close}>
            {t("welcome.gotIt")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
