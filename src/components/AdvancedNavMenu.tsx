import { useEffect, useState } from "react";
import { BarChart3, CircleHelp, MoreHorizontal, Plug, Settings, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { View } from "@/components/Sidebar";

const ADVANCED_VIEWS: View[] = ["usage", "skills", "mcp", "settings"];

export function AdvancedNavMenu({
  currentView,
  onViewChange,
  onGuide,
  mode,
  edge = "left",
}: {
  currentView: View;
  onViewChange: (view: View) => void;
  onGuide: () => void;
  mode: "rail" | "toolbar";
  edge?: "left" | "right";
}) {
  const { t } = useI18n();
  const hasActiveView = ADVANCED_VIEWS.includes(currentView);
  const [open, setOpen] = useState(hasActiveView);

  useEffect(() => {
    if (hasActiveView) setOpen(true);
  }, [hasActiveView]);

  const navigate = (view: View) => {
    setOpen(false);
    onViewChange(view);
  };

  const trigger = mode === "rail" ? (
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      aria-label={t("common.more")}
      aria-expanded={open}
      className={cn(
        "relative flex items-center justify-center h-9 w-9 mx-auto rounded-lg transition-all duration-150 lg:w-auto lg:mx-2 lg:px-3 lg:justify-start lg:gap-2",
        hasActiveView
          ? "bg-background text-foreground shadow-sm ring-1 ring-border"
          : "text-muted-foreground hover:text-foreground hover:bg-background/70",
      )}
    >
      <MoreHorizontal className="w-[18px] h-[18px]" />
      <span className="hidden lg:block truncate text-xs font-medium">{t("common.more")}</span>
    </button>
  ) : (
    <Button
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8", hasActiveView && "bg-accent")}
      title={t("common.more")}
      aria-label={t("common.more")}
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
    >
      <MoreHorizontal className="w-4 h-4" />
    </Button>
  );

  return (
    <div className={cn("relative", mode === "rail" && "group w-full shrink-0")}>
      {trigger}
      {mode === "rail" && (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 z-50 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md opacity-0 scale-95 transition-all duration-100 group-hover:opacity-100 group-hover:scale-100 lg:hidden",
            edge === "right" ? "right-full mr-2 origin-right" : "left-full ml-2 origin-left",
          )}
        >
          {t("common.more")}
        </span>
      )}
      {open && (
        <div
          role="menu"
          aria-label={t("common.more")}
          className={cn(
            "absolute z-50 min-w-[168px] rounded-xl border border-border bg-popover p-1.5 shadow-lg",
            mode === "toolbar" ? "right-0 top-full mt-2" : edge === "right" ? "right-full top-0 mr-2" : "left-full top-0 ml-2",
          )}
        >
          <MenuItem active={currentView === "usage"} onClick={() => navigate("usage")} icon={<BarChart3 />} label={t("dash.title")} />
          <MenuItem active={currentView === "mcp"} onClick={() => navigate("mcp")} icon={<Plug />} label={t("mcp.title")} />
          <MenuItem active={currentView === "skills"} onClick={() => navigate("skills")} icon={<Sparkles />} label={t("sk.title")} />
          <MenuItem active={currentView === "settings"} onClick={() => navigate("settings")} icon={<Settings />} label={t("common.settings")} />
          <div className="my-1 border-t border-border" />
          <MenuItem onClick={() => { setOpen(false); onGuide(); }} icon={<CircleHelp />} label={t("guide.open")} />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  active = false,
  onClick,
  icon,
  label,
}: {
  active?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      {label}
    </button>
  );
}
