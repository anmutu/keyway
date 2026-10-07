import { useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
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
  position = "top",
}: {
  currentView: View;
  onViewChange: (view: View) => void;
  onGuide: () => void;
  mode: "rail" | "toolbar";
  edge?: "left" | "right";
  position?: "top" | "bottom";
}) {
  const { t } = useI18n();
  const hasActiveView = ADVANCED_VIEWS.includes(currentView);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tabDismissed = useRef(false);

  useEffect(() => {
    setOpen(false);
  }, [currentView]);

  const navigate = (view: View) => {
    setOpen(false);
    onViewChange(view);
  };

  const trigger = mode === "rail" ? (
    <button
      type="button"
      aria-label={t("common.more")}
      className={cn(
        "relative flex items-center justify-center h-9 w-9 mx-auto rounded-lg transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-auto lg:mx-2 lg:px-3 lg:justify-start lg:gap-2",
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
    >
      <MoreHorizontal className="w-4 h-4" />
    </Button>
  );

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <div className={cn("relative", mode === "rail" && "group w-full shrink-0")}>
        <DropdownMenu.Trigger ref={triggerRef} asChild>{trigger}</DropdownMenu.Trigger>
        {mode === "rail" && !open && (
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
      </div>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          aria-label={t("common.more")}
          side={mode === "rail" ? (edge === "right" ? "left" : "right") : (position === "bottom" ? "top" : "bottom")}
          align={mode === "rail" ? "start" : "end"}
          sideOffset={8}
          collisionPadding={8}
          loop
          onKeyDownCapture={(event) => {
            if (event.key !== "Tab") return;
            event.stopPropagation();
            tabDismissed.current = true;
            triggerRef.current?.focus();
            setOpen(false);
          }}
          onCloseAutoFocus={(event) => {
            if (!tabDismissed.current) return;
            event.preventDefault();
            tabDismissed.current = false;
          }}
          data-tauri-no-drag
          className="z-[60] min-w-[168px] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-lg outline-none"
        >
          <MenuItem active={currentView === "usage"} onClick={() => navigate("usage")} icon={<BarChart3 />} label={t("dash.title")} />
          <MenuItem active={currentView === "mcp"} onClick={() => navigate("mcp")} icon={<Plug />} label={t("mcp.title")} />
          <MenuItem active={currentView === "skills"} onClick={() => navigate("skills")} icon={<Sparkles />} label={t("sk.title")} />
          <MenuItem active={currentView === "settings"} onClick={() => navigate("settings")} icon={<Settings />} label={t("common.settings")} />
          <DropdownMenu.Separator className="my-1 border-t border-border" />
          <MenuItem onClick={() => { setOpen(false); onGuide(); }} icon={<CircleHelp />} label={t("guide.open")} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
    <DropdownMenu.Item
      onSelect={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-9 w-full cursor-default select-none items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium outline-none transition-colors data-[highlighted]:bg-muted data-[highlighted]:text-foreground",
        active ? "bg-accent text-foreground" : "text-muted-foreground",
      )}
    >
      <span aria-hidden="true" className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      {label}
    </DropdownMenu.Item>
  );
}
