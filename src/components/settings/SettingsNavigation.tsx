import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

const SECTIONS = ["general", "cli", "data", "proxy"] as const;
type SectionId = typeof SECTIONS[number];

export function SettingsNavigation() {
  const { t } = useI18n();
  const navigationRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState<SectionId>("general");

  useEffect(() => {
    const navigation = navigationRef.current;
    const scroller = navigation?.closest("main");
    if (!navigation || !scroller) return;
    let frame = 0;
    const update = () => {
      const offset = navigation.getBoundingClientRect().height + 12;
      navigation.parentElement?.style.setProperty("--settings-nav-height", `${offset}px`);
      const top = scroller.getBoundingClientRect().top + offset;
      let current: SectionId = "general";
      for (const section of SECTIONS) {
        const element = document.getElementById(`settings-${section}`);
        if (element && element.getBoundingClientRect().top <= top + 2) current = section;
      }
      if (scroller.scrollHeight > scroller.clientHeight && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) current = "proxy";
      setActive(current);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(navigation);
    resize.observe(scroller);
    scroller.addEventListener("scroll", schedule, { passive: true });
    update();
    return () => {
      resize.disconnect();
      scroller.removeEventListener("scroll", schedule);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <nav ref={navigationRef} aria-label={t("settings.navigation")} className="sticky top-0 z-20 grid grid-cols-2 gap-1 rounded-xl border border-border bg-background p-1 shadow-sm sm:grid-cols-4">
      {SECTIONS.map((section) => (
        <button
          key={section}
          type="button"
          aria-current={active === section ? "location" : undefined}
          aria-controls={`settings-${section}`}
          onClick={() => {
            const heading = document.getElementById(`settings-${section}-title`);
            document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: "instant", block: "start" });
            heading?.focus({ preventScroll: true });
            setActive(section);
          }}
          className={cn("min-h-9 rounded-lg px-2 py-2 text-xs font-medium transition-colors", active === section ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
        >
          {t(`settings.section.${section}`)}
        </button>
      ))}
    </nav>
  );
}

export function SettingsSection({ id, children }: { id: SectionId; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section id={`settings-${id}`} aria-labelledby={`settings-${id}-title`} className="space-y-3" style={{ scrollMarginTop: "var(--settings-nav-height, 104px)" }}>
      <h3 id={`settings-${id}-title`} tabIndex={-1} className="pt-2 text-sm font-semibold outline-none">{t(`settings.section.${id}`)}</h3>
      {children}
    </section>
  );
}
