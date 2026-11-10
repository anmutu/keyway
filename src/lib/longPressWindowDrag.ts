import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const HOLD_MS = 320;
const MOVE_TOLERANCE = 8;

/**
 * 长按拖动窗口:按住界面任意位置不动 320ms,即进入原生窗口拖拽。
 * 提前移动(点按钮、拖卡片排序、划词)会取消长按,不影响原有交互;
 * 表单控件与 data-tauri-drag-region 区域不参与,避免与文本选择、原生拖区冲突。
 */
export function useLongPressWindowDrag(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !isTauri()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sx = 0;
    let sy = 0;

    const interactive = (target: EventTarget | null): boolean =>
      target instanceof Element &&
      Boolean(target.closest(
        'input, textarea, select, [contenteditable="true"], [data-tauri-drag-region]',
      ));

    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || interactive(e.target)) return;
      cancel();
      sx = e.clientX;
      sy = e.clientY;
      timer = setTimeout(() => {
        timer = undefined;
        void getCurrentWindow().startDragging();
      }, HOLD_MS);
    };

    const onMove = (e: PointerEvent) => {
      if (!timer) return;
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > MOVE_TOLERANCE) cancel();
    };

    // 卡片排序等 HTML5 拖拽开始后,指针事件会被拖拽会话吞掉(pointerup 不再派发),
    // 长按计时器若继续跑会在拖拽会话中途调用 startDragging——务必取消,排序本身不受影响
    const onDragStart = () => cancel();

    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", cancel);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("dragstart", onDragStart);
    return () => {
      cancel();
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", cancel);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("dragstart", onDragStart);
    };
  }, [enabled]);
}
