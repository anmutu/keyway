import {
  Plus,
  ScrollText,
  Search,
} from "lucide-react";
import { AdvancedNavMenu } from "@/components/AdvancedNavMenu";
import { AppSwitcher } from "@/components/AppSwitcher";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { AppType } from "@/types";
import type { View } from "@/components/Sidebar";

/**
 * 横向切换栏:顶部(top)/底部(bottom)布局共用。
 * 左侧 CLI 分组切换 + 新增,右侧 日志/技能/MCP/用量/设置/代理/主题
 * (与侧栏布局的功能对齐,不依赖快捷键)。
 */
export function AppHeaderBar({
  position,
  apps,
  activeApp,
  currentView,
  onViewChange,
  onSwitchApp,
  onAdd,
  onQuickSwitch,
  proxyOk,
  proxyAddr,
  onTakeover,
  onGuide,
  isMac,
}: {
  position: "top" | "bottom";
  apps: AppType[];
  activeApp: AppType;
  currentView: View;
  onViewChange: (v: View) => void;
  onSwitchApp: (app: AppType) => void;
  onAdd: () => void;
  onQuickSwitch: () => void;
  proxyOk: boolean | null;
  proxyAddr: string;
  onTakeover: () => void;
  onGuide: () => void;
  isMac: boolean;
}) {
  const { t } = useI18n();

  return (
    <header
      className={cn(
        "shrink-0 z-50 w-full h-14 flex items-center gap-3 bg-background/80 backdrop-blur-md",
        position === "top" ? "border-b border-border" : "border-t border-border",
      )}
      data-tauri-drag-region
    >
      <div
        className={cn(
          "flex items-center gap-3 flex-1 min-w-0",
          position === "top" && isMac && "pl-[92px]",
          position === "bottom" && "pl-3",
        )}
        data-tauri-no-drag
      >
        <AppSwitcher
          activeApp={activeApp}
          apps={apps}
          onSwitch={(app) => {
            onSwitchApp(app);
            onViewChange("providers");
          }}
        />
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          title={t("common.add")}
          aria-label={t("common.add")}
          onClick={onAdd}
        >
          <Plus className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          title={`${t("qs.open")} (⌘⇧K)`}
          aria-label={t("qs.open")}
          onClick={onQuickSwitch}
        >
          <Search className="w-4 h-4" />
        </Button>
      </div>
      <div className="flex items-center gap-1.5 pr-3" data-tauri-no-drag>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", currentView === "logs" && "bg-accent")}
          title={t("logs.title")}
          aria-label={t("logs.title")}
          onClick={() => onViewChange("logs")}
        >
          <ScrollText className="w-4 h-4" />
        </Button>
        <AdvancedNavMenu
          currentView={currentView}
          onViewChange={onViewChange}
          onGuide={onGuide}
          mode="toolbar"
        />
        <button
          type="button"
          onClick={onTakeover}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            proxyOk === true
              ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
              : proxyOk === false
                ? "text-red-600 dark:text-red-400 bg-red-500/10"
                : "text-muted-foreground bg-muted/60",
          )}
          aria-label={`${t(proxyOk === true ? "gw.running" : proxyOk === false ? "takeover.proxyOff" : "gw.unknown")} · ${t("gw.details")}`}
          aria-haspopup="dialog"
          title={`${t("gw.details")}${proxyAddr ? ` · ${proxyAddr}` : ""}`}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              proxyOk === true ? "bg-emerald-500" : proxyOk === false ? "bg-red-500" : "bg-muted-foreground",
            )}
          />
          <span className="hidden lg:inline">{t(proxyOk === true ? "takeover.proxyOn" : proxyOk === false ? "takeover.proxyOff" : "gw.details")}</span>
        </button>
        <ModeToggle />
      </div>
    </header>
  );
}
