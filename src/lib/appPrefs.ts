import type { AppType } from "@/types";

/**
 * 界面偏好(localStorage):布局模式 + CLI 分组的显示与顺序。
 * 与后端无关,纯前端偏好,损坏时静默回退默认值。
 */

export type LayoutMode = "side" | "top" | "right" | "bottom";

const LAYOUT_KEY = "keyway-layout";
const LEGACY_LAYOUT_KEY = "conduit-layout";
const APPS_KEY = "keyway-apps";
const LEGACY_APPS_KEY = "conduit-apps";
const LAST_APP_KEY = "keyway-last-app";
const LEGACY_LAST_APP_KEY = "conduit-last-app";

export const ALL_LAYOUTS: LayoutMode[] = ["side", "top", "right", "bottom"];

/** 全部分组(含扩充;顺序即默认排序) */
export const ALL_APPS: AppType[] = [
  "claude",
  "codex",
  "gemini",
  "opencode",
  "openclaw",
  "qwen",
  "iflow",
  "crush",
  "droid",
];

/** 默认显示的分组(扩充组默认隐藏,可在设置中开启) */
export const DEFAULT_APPS: AppType[] = ALL_APPS.slice(0, 5);

export function loadLayout(): LayoutMode {
  try {
    let v = localStorage.getItem(LAYOUT_KEY) as LayoutMode | null;
    if (v === null) {
      // 旧键迁移:老版本用户的布局偏好不丢
      v = localStorage.getItem(LEGACY_LAYOUT_KEY) as LayoutMode | null;
      if (v && ALL_LAYOUTS.includes(v)) localStorage.setItem(LAYOUT_KEY, v);
    }
    return v && ALL_LAYOUTS.includes(v) ? v : "side";
  } catch {
    return "side";
  }
}

export function saveLayout(mode: LayoutMode) {
  try {
    localStorage.setItem(LAYOUT_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** 可见分组(有序);存储缺失/非法时回退默认 5 个 */
export function loadApps(): AppType[] {
  try {
    let raw = localStorage.getItem(APPS_KEY);
    if (!raw) {
      // 旧键迁移:老版本用户的分组显示/排序偏好不丢
      raw = localStorage.getItem(LEGACY_APPS_KEY);
      if (raw) localStorage.setItem(APPS_KEY, raw);
    }
    if (!raw) return DEFAULT_APPS;
    const list = JSON.parse(raw) as string[];
    const valid = list.filter(
      (app, index): app is AppType =>
        ALL_APPS.includes(app as AppType) && list.indexOf(app) === index,
    );
    return valid.length > 0 ? valid : DEFAULT_APPS;
  } catch {
    return DEFAULT_APPS;
  }
}

export function saveApps(apps: AppType[]) {
  try {
    localStorage.setItem(APPS_KEY, JSON.stringify(apps));
  } catch {
    /* ignore */
  }
}

/** 上次选中的 CLI 分组(启动时默认打开);存储缺失/非法时回退 null */
export function loadLastApp(): AppType | null {
  try {
    let v = localStorage.getItem(LAST_APP_KEY) as AppType | null;
    if (v === null) {
      // 旧键迁移:老版本用户上次选中的分组不丢
      v = localStorage.getItem(LEGACY_LAST_APP_KEY) as AppType | null;
      if (v && ALL_APPS.includes(v)) localStorage.setItem(LAST_APP_KEY, v);
    }
    return v && ALL_APPS.includes(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveLastApp(app: AppType) {
  try {
    localStorage.setItem(LAST_APP_KEY, app);
  } catch {
    /* ignore */
  }
}

/** 预设选择器排序偏好:类别顺序 + 各分组内平台顺序(按名称) */
export interface PresetOrderPrefs {
  /** 类别(大版块)顺序 */
  categories: string[];
  /** appId → 平台名称顺序 */
  presets: Record<string, string[]>;
}

const PRESET_KEY = "keyway-preset-order";
const LEGACY_PRESET_KEY = "conduit-preset-order";

export function loadPresetOrder(): PresetOrderPrefs {
  try {
    let raw = localStorage.getItem(PRESET_KEY);
    if (!raw) {
      // 旧键迁移:老版本用户的预设排序偏好不丢
      raw = localStorage.getItem(LEGACY_PRESET_KEY);
      if (raw) localStorage.setItem(PRESET_KEY, raw);
    }
    if (!raw) return { categories: [], presets: {} };
    const v = JSON.parse(raw) as Partial<PresetOrderPrefs>;
    return {
      categories: Array.isArray(v.categories) ? v.categories : [],
      presets: v.presets && typeof v.presets === "object" ? v.presets : {},
    };
  } catch {
    return { categories: [], presets: {} };
  }
}

export function savePresetOrder(prefs: PresetOrderPrefs) {
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
