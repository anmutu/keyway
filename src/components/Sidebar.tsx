import { useState } from "react";
import { BarChart3, ScrollText, Plus, Plug, Sparkles, Settings } from "lucide-react";
import { ProviderIcon } from "@/components/ProviderIcon";
import { ModeToggle } from "@/components/mode-toggle";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { saveLastApp } from "@/lib/appPrefs";
import type { AppType } from "@/types";

// 窄图标栏:80px 纯图标,悬停 tooltip 显示名称
// 首次使用时给 Skills/MCP 一次性高亮提示,用户交互过一次后不再出现
const TOUR_KEY = "keyway-sidebar-tour";

const appIconName: Record<AppType, string> = {
  claude: "claude",
  codex: "openai",
  gemini: "gemini",
  opencode: "opencode",
  openclaw: "openclaw",
  qwen: "qwen",
  iflow: "iflow",
  crush: "crush",
  droid: "droid",
};

const appDisplayName: Record<AppType, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
  qwen: "Qwen Code",
  iflow: "iFlow",
  crush: "Crush",
  droid: "Droid",
};

export type View = "providers" | "settings" | "usage" | "logs" | "mcp" | "skills";

interface SidebarProps {
  /** 可见分组(有序,可在设置中调整) */
  apps: AppType[];
  activeApp: AppType;
  onSwitchApp: (app: AppType) => void;
  currentView: View;
  onViewChange: (view: View) => void;
  proxyOk: boolean | null;
  proxyAddr: string;
  onTakeover: () => void;
  onAbout: () => void;
  /** 添加供应商(⌘N),入口放在 CLI 分组标题行 */
  onAdd: () => void;
  isMac: boolean;
  /** 渲染在左侧还是右侧(影响描边方向) */
  edge?: "left" | "right";
}

/** 图标轨导航项:居中图标,选中为凸起卡片;悬停浮出名称(左侧栏弹右侧,右侧栏弹左侧) */
function RailItem({
  active,
  onClick,
  title,
  edge = "left",
  highlight = false,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  edge?: "left" | "right";
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="relative group w-full shrink-0">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "relative flex items-center justify-center h-9 w-9 mx-auto rounded-lg transition-all duration-150",
          active
            ? "bg-background text-foreground shadow-sm ring-1 ring-border"
            : "text-muted-foreground hover:text-foreground hover:bg-background/70",
        )}
      >
        {active && (
          <span className={cn("absolute top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-blue-500", edge === "right" ? "-right-2" : "-left-2")} />
        )}
        {/* 首次使用一次性高亮点:提示该图标值得探索,悬停/点击一次即消失 */}
        {highlight && !active && (
          <span className="absolute top-0.5 right-0.5 flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
          </span>
        )}
        {children}
      </button>
      {/* 悬停提示:靠内容区一侧浮出 */}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 z-50 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md opacity-0 scale-95 transition-all duration-100 group-hover:opacity-100 group-hover:scale-100",
          edge === "right"
            ? "right-full mr-2 origin-right"
            : "left-full ml-2 origin-left",
        )}
      >
        {title}
      </span>
    </div>
  );
}

export function Sidebar({
  apps,
  activeApp,
  onSwitchApp,
  currentView,
  onViewChange,
  proxyOk,
  proxyAddr,
  onTakeover,
  onAbout,
  onAdd,
  isMac,
  edge = "left",
}: SidebarProps) {
  const { t } = useI18n();

  const switchApp = (app: AppType) => {
    saveLastApp(app);
    onSwitchApp(app);
    onViewChange("providers");
  };

  // 首次使用一次性高亮:Skills/MCP 图标语义不直观,交互过一次后不再提示
  const [tourSeen, setTourSeen] = useState(
    () => localStorage.getItem(TOUR_KEY) === "1",
  );
  const dismissTour = () => {
    if (tourSeen) return;
    localStorage.setItem(TOUR_KEY, "1");
    setTourSeen(true);
  };

  return (
    <aside
      className={cn(
        "shrink-0 w-[80px] h-full flex flex-col items-center bg-muted select-none",
        edge === "right" ? "border-l border-border" : "border-r border-border",
      )}
      data-tauri-drag-region
    >
      {/* 品牌:macOS Overlay 红绿灯占据左上,向下避让 */}
      <div className={cn("flex flex-col items-center gap-0.5 pb-2 shrink-0", isMac ? "pt-10" : "pt-3")} data-tauri-no-drag>
        <button
          type="button"
          onClick={onAbout}
          title={t("common.about")}
          className="flex items-center justify-center rounded-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer"
        >
          <img src="icons/keyway-logo.svg?v=3" alt="Keyway" width={28} height={28} className="rounded-[7px]" />
        </button>
        <span className="text-[9px] font-semibold tracking-wide text-muted-foreground/70">Keyway</span>
      </div>

      {/* CLI 分组导航(⌘1..5,悬停显示名称)+ 添加;分组多时此区可滚,下方导航钉住不被挤走 */}
      <nav className="flex flex-col gap-1 pt-2 w-full min-h-0 overflow-y-auto" data-tauri-no-drag>
        <RailItem
          active={false}
          onClick={onAdd}
          title={`${t("common.add")} (⌘N)`}
          edge={edge}
        >
          <Plus className="w-[18px] h-[18px]" />
        </RailItem>
        <div className="my-1 mx-3 border-t border-border" />
        <span className="px-1 pb-0.5 text-center text-[8px] font-semibold uppercase tracking-wide text-muted-foreground/50">
          {t("sidebar.section.cli")}
        </span>
        {apps.map((app) => (
          <RailItem
            key={app}
            active={currentView === "providers" && activeApp === app}
            onClick={() => switchApp(app)}
            title={`${appDisplayName[app]}(⌘${apps.indexOf(app) + 1})`}
            edge={edge}
          >
            <ProviderIcon
              icon={appIconName[app]}
              name={appDisplayName[app]}
              size={18}
            />
          </RailItem>
        ))}
      </nav>

      <div className="my-3 mx-3 w-auto self-stretch border-t border-border shrink-0" />

      {/* 二级导航 */}
      <nav className="flex flex-col gap-1 w-full shrink-0" data-tauri-no-drag>
        <span className="px-1 pb-0.5 text-center text-[8px] font-semibold uppercase tracking-wide text-muted-foreground/50">
          {t("sidebar.section.general")}
        </span>
        <RailItem
          active={currentView === "usage"}
          onClick={() => onViewChange("usage")}
          title={t("dash.title")}
          edge={edge}
        >
          <BarChart3 className="w-[18px] h-[18px]" />
        </RailItem>
        <RailItem
          active={currentView === "logs"}
          onClick={() => onViewChange("logs")}
          title={t("logs.title")}
          edge={edge}
        >
          <ScrollText className="w-[18px] h-[18px]" />
        </RailItem>
        <div onMouseEnter={dismissTour} onClick={dismissTour}>
          <RailItem
            active={currentView === "skills"}
            onClick={() => onViewChange("skills")}
            title={`${t("sk.title")} (⌘⇧S)`}
            edge={edge}
            highlight={!tourSeen}
          >
            <Sparkles className="w-[18px] h-[18px]" />
          </RailItem>
        </div>
        <div onMouseEnter={dismissTour} onClick={dismissTour}>
          <RailItem
            active={currentView === "mcp"}
            onClick={() => onViewChange("mcp")}
            title={`${t("mcp.title")} (⌘⇧M)`}
            edge={edge}
            highlight={!tourSeen}
          >
            <Plug className="w-[18px] h-[18px]" />
          </RailItem>
        </div>
        <RailItem
          active={currentView === "settings"}
          onClick={() => onViewChange("settings")}
          title={t("common.settings")}
          edge={edge}
        >
          <Settings className="w-[18px] h-[18px]" />
        </RailItem>
      </nav>

      <div className="flex-1" data-tauri-drag-region />

      {/* 底部:代理状态 + 主题,均居中 */}
      <div
        className="flex flex-col items-center gap-1 pb-3 w-full shrink-0"
        data-tauri-no-drag
      >
        {proxyOk !== null && (
          <div className="relative group">
            <button
              type="button"
              onClick={onTakeover}
              className={cn(
                "flex items-center justify-center h-9 w-9 rounded-lg transition-opacity hover:opacity-80 cursor-pointer",
                proxyOk
                  ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                  : "text-red-600 dark:text-red-400 bg-red-500/10",
              )}
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  proxyOk ? "bg-emerald-500" : "bg-red-500",
                )}
              />
            </button>
            {/* 悬停提示:靠内容区一侧浮出 */}
            <span
              role="tooltip"
              className={cn(
                "pointer-events-none absolute top-1/2 -translate-y-1/2 z-50 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md opacity-0 scale-95 transition-all duration-100 group-hover:opacity-100 group-hover:scale-100",
                edge === "right"
                  ? "right-full mr-2 origin-right"
                  : "left-full ml-2 origin-left",
              )}
            >
              {proxyOk
                ? t("takeover.proxyTipOn", { addr: proxyAddr })
                : t("takeover.proxyTipOff")}
            </span>
          </div>
        )}
        <ModeToggle />
      </div>
    </aside>
  );
}
