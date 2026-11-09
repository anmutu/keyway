import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { DictKey } from "@/i18n/dict";
import { cn } from "@/lib/utils";

export const TOUR_DONE_KEY = "keyway-tour-completed";

export function hasTourDone(): boolean {
  return localStorage.getItem(TOUR_DONE_KEY) === "1";
}

interface TourStep {
  /** 目标选择器;null = 居中卡片(欢迎/结束) */
  target: string | null;
  titleKey: DictKey;
  descKey: DictKey;
}

// 步骤顺序 = 使用链路:添加/迁移供应商 → 一键接管 → 日志验证,再日常操作与界面分区。
// 用户最容易卡在"加完供应商不知道怎么接管",接管步必须讲透;
// 迁移步在导入按钮不存在时(如 demo)由 goTo 自动跳过。
const STEPS: TourStep[] = [
  { target: null, titleKey: "tour.welcomeTitle", descKey: "tour.welcomeDesc" },
  { target: '[data-tour="add-provider"]', titleKey: "tour.stepAddTitle", descKey: "tour.stepAddDesc" },
  { target: '[data-tour="import-external"]', titleKey: "tour.stepImportTitle", descKey: "tour.stepImportDesc" },
  { target: '[data-tour="proxy-status"]', titleKey: "tour.stepTakeoverTitle", descKey: "tour.stepTakeoverDesc" },
  { target: '[data-tour="logs"]', titleKey: "tour.stepLogsTitle", descKey: "tour.stepLogsDesc" },
  { target: '[data-tour="quick-switch"]', titleKey: "tour.stepQuickTitle", descKey: "tour.stepQuickDesc" },
  { target: '[data-tour="cli-nav"]', titleKey: "tour.stepCliNavTitle", descKey: "tour.stepCliNavDesc" },
  { target: '[data-tour="advanced-menu"]', titleKey: "tour.stepAdvancedTitle", descKey: "tour.stepAdvancedDesc" },
  { target: null, titleKey: "tour.doneTitle", descKey: "tour.doneDesc" },
];

const PAD = 6;
const POP_W = 300;
const POP_GAP = 16;
const MARGIN = 16;

/**
 * 分步界面导览:高亮目标区域 + 说明气泡。
 * 遮罩用单个"孔洞"div 的超大 box-shadow 实现,位置走 CSS transition,
 * 步骤切换时孔洞平滑滑动;目标缺失的步骤(如首启无供应商时的路由预览)自动跳过。
 */
export function GuidedTour({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [popH, setPopH] = useState(190);
  const popRef = useRef<HTMLDivElement | null>(null);

  const step = STEPS[index];
  const first = index === 0;
  const last = index === STEPS.length - 1;

  const close = () => {
    localStorage.setItem(TOUR_DONE_KEY, "1");
    onClose();
  };

  // 目标元素不存在(布局特例/数据为空)时按行进方向跳过该步
  const goTo = (i: number, dir: 1 | -1) => {
    if (i < 0 || i >= STEPS.length) {
      close();
      return;
    }
    const s = STEPS[i];
    if (s.target && !document.querySelector(s.target)) {
      goTo(i + dir, dir);
      return;
    }
    setIndex(i);
  };

  // 定位:滚动目标进入视野,并跟随 resize/滚动重测(覆盖 smooth scroll 过程)
  useLayoutEffect(() => {
    if (!step.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(step.target);
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const measure = () => setRect(el.getBoundingClientRect());
    measure();
    // smooth scroll 期间矩形连续变化,短间隔重测跟上动画
    const ticker = window.setInterval(measure, 100);
    const stop = window.setTimeout(() => window.clearInterval(ticker), 600);
    const onAny = () => measure();
    window.addEventListener("resize", onAny);
    window.addEventListener("scroll", onAny, true);
    return () => {
      window.clearInterval(ticker);
      window.clearTimeout(stop);
      window.removeEventListener("resize", onAny);
      window.removeEventListener("scroll", onAny, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // 气泡实际高度回填,用于垂直 clamp(首帧用估算值,之后自动校正)
  useLayoutEffect(() => {
    if (popRef.current) setPopH(popRef.current.offsetHeight);
  }, [index, rect]);

  // 气泡获得焦点,键盘操作以导览为中心
  useEffect(() => {
    popRef.current?.focus();
  }, [index]);

  // capture 阶段接管按键:←/→/Enter 切步,Esc 跳过,并屏蔽 ⌘ 快捷键与全局 Esc 跳页
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
        return;
      }
      if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        goTo(index + 1, 1);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopImmediatePropagation();
        goTo(index - 1, -1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 孔洞矩形:目标外扩 PAD;居中步骤则覆盖全屏(压暗一切)
  const hole = rect
    ? {
        left: rect.left - PAD,
        top: rect.top - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : { left: 0, top: 0, width: vw, height: vh };

  // 气泡优先放目标左/右侧(垂直居中),水平放不下则上/下方;全部 clamp 在安全边距内
  let popLeft: number;
  let popTop: number;
  if (!rect) {
    popLeft = (vw - POP_W) / 2;
    popTop = (vh - popH) / 2;
  } else {
    const centerX = hole.left + hole.width / 2;
    const fitsRight = vw - hole.left - hole.width - MARGIN >= POP_W + POP_GAP;
    const fitsLeft = hole.left - MARGIN >= POP_W + POP_GAP;
    if ((centerX < vw / 2 && fitsRight) || (!fitsLeft && fitsRight)) {
      popLeft = hole.left + hole.width + POP_GAP;
      popTop = Math.min(
        Math.max(MARGIN, hole.top + hole.height / 2 - popH / 2),
        vh - popH - MARGIN,
      );
    } else if (fitsLeft) {
      popLeft = hole.left - POP_W - POP_GAP;
      popTop = Math.min(
        Math.max(MARGIN, hole.top + hole.height / 2 - popH / 2),
        vh - popH - MARGIN,
      );
    } else {
      popLeft = Math.min(
        Math.max(MARGIN, centerX - POP_W / 2),
        vw - POP_W - MARGIN,
      );
      const below = hole.top + hole.height + POP_GAP + popH + MARGIN <= vh;
      popTop = below
        ? hole.top + hole.height + POP_GAP
        : Math.max(MARGIN, hole.top - popH - POP_GAP);
    }
  }

  if (!step) return null;

  return (
    <div data-tour-panel>
      {/* 点击拦截层:导览期间阻断底层交互,点击空白跳过 */}
      <div className="fixed inset-0 z-[89]" onClick={close} />
      {/* 高亮孔洞:超大 box-shadow 压暗其余区域,位置过渡平滑;
          居中步骤孔洞铺满全屏,shadow 会全被推出视口,改用自身背景压暗 */}
      <div
        aria-hidden
        className={cn(
          "fixed z-[90] pointer-events-none transition-all duration-300 ease-out",
          rect
            ? "rounded-xl ring-2 ring-primary/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.6)]"
            : "bg-black/60",
        )}
        style={{
          left: hole.left,
          top: hole.top,
          width: hole.width,
          height: hole.height,
        }}
      />
      {/* 说明气泡 */}
      <div
        ref={popRef}
        role="dialog"
        aria-modal="true"
        aria-label={t(step.titleKey)}
        tabIndex={-1}
        key={index}
        className="fixed z-[91] w-[300px] max-w-[calc(100vw-32px)] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none animate-in fade-in zoom-in-95 duration-200"
        style={{ left: popLeft, top: popTop }}
      >
        <div className="flex items-center justify-between">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
            {t("tour.stepOf", { current: index + 1, total: STEPS.length })}
          </span>
          {!last && (
            <button
              type="button"
              className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              onClick={close}
            >
              {t("tour.skip")}
            </button>
          )}
        </div>
        <h3 className="mt-2.5 text-sm font-semibold leading-snug">
          {t(step.titleKey)}
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {t(step.descKey)}
        </p>
        {/* 步骤进度 */}
        <div className="mt-3 flex gap-1.5">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i <= index ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </div>
        <div className="mt-3.5 flex items-center gap-2">
          {!first && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => goTo(index - 1, -1)}
            >
              {t("tour.prev")}
            </Button>
          )}
          <div className="flex-1" />
          {last ? (
            <Button size="sm" onClick={close}>
              {t("tour.finish")}
            </Button>
          ) : (
            <Button size="sm" onClick={() => goTo(index + 1, 1)}>
              {first ? t("tour.start") : t("tour.next")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
