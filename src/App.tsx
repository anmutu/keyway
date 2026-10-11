import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Activity, Boxes, CopyPlus, Download, Gauge, Plus, Search, TriangleAlert, X } from "lucide-react";
import type { AppType, Provider, ProxyStatus, UsageSummary } from "@/types";
import { APP_PROTOCOL } from "@/types";
import { Sidebar } from "@/components/Sidebar";
import { AppHeaderBar } from "@/components/AppHeaderBar";
import { ProviderCard } from "@/components/providers/ProviderCard";
import { AddProviderDialog } from "@/components/providers/AddProviderDialog";
import { RelayConnectDialog } from "@/components/providers/RelayConnectDialog";
import { parseRelayDeepLink, type RelayConnectRequest } from "@/lib/relayDeepLink";
import { GatewayStatusStrip } from "@/components/providers/GatewayStatusStrip";
import { RoutePreviewCard } from "@/components/providers/RoutePreviewCard";
import { EditProviderDialog } from "@/components/providers/EditProviderDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ToastStack, type ToastItem, type ToastType } from "@/components/Toast";
import { AboutDialog } from "@/components/AboutDialog";
import { QuickSwitchPanel } from "@/components/QuickSwitchPanel";
import { OnboardingDialog, hasOnboarded } from "@/components/OnboardingDialog";
import { TakeoverDialog } from "@/components/TakeoverDialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import {
  loadLayout,
  saveLayout,
  loadApps,
  saveApps,
  loadLastApp,
  saveLastApp,
  type LayoutMode,
} from "@/lib/appPrefs";

const GettingStartedDialog = lazy(async () => {
  const module = await import("@/components/GettingStartedDialog");
  return { default: module.GettingStartedDialog };
});

const SettingsPage = lazy(async () => {
  const module = await import("@/components/settings/SettingsPage");
  return { default: module.SettingsPage };
});

const UsagePage = lazy(async () => {
  const module = await import("@/components/usage/UsagePage");
  return { default: module.UsagePage };
});

const LogsPage = lazy(async () => {
  const module = await import("@/components/usage/LogsPage");
  return { default: module.LogsPage };
});

const McpPage = lazy(async () => {
  const module = await import("@/components/settings/McpPage");
  return { default: module.McpPage };
});

const SkillsPage = lazy(async () => {
  const module = await import("@/components/settings/SkillsPage");
  return { default: module.SkillsPage };
});

function getInitialApp(): AppType {
  return loadLastApp() ?? "claude";
}

/** 把底层错误串转成人话 */
type TFunc = ReturnType<typeof useI18n>["t"];
function humanizeError(raw: string, t: TFunc): string {
  const msg = raw.replace(/^Error:\s*/i, "");
  const m = msg.toLowerCase();
  if (m.includes("cc switch") || m.includes("cc-switch")) return t("err.ccSwitchOwner");
  if (msg.includes("keychain")) return t("err.keychain");
  if (msg.includes("数据库") || msg.includes("database")) return t("err.db");
  if (msg.includes("invoke") || msg.includes("ipc")) return t("err.ipc");
  // 常见 HTTP/网络错误:给出可操作的下一步,而不是裸状态码
  if (/\b401\b|unauthorized/.test(m)) return t("err.401");
  if (/\b403\b|forbidden/.test(m)) return t("err.403");
  if (/\b404\b|not found/.test(m)) return t("err.404");
  if (/\b429\b|rate.?limit|quota/.test(m)) return t("err.429");
  if (/timeout|timed out/.test(m)) return t("err.timeout");
  if (/dns|resolve|refused|unreachable|network/.test(m)) return t("err.network");
  if (/certificate|tls|ssl/.test(m)) return t("err.tls");
  return t("err.fallback", { msg: msg.length > 120 ? `${msg.slice(0, 120)}…` : msg });
}

/** 骨架卡片:列表加载时占位,避免布局抖动 */
function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border p-4 bg-card">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
        <div className="space-y-1.5 flex-1">
          <div className="h-4 w-32 rounded bg-muted animate-pulse" />
          <div className="h-3 w-56 rounded bg-muted animate-pulse" />
        </div>
      </div>
    </div>
  );
}

function PageFallback() {
  return (
    <div className="mx-auto w-full max-w-[1040px] space-y-3 px-3 py-4 sm:px-6 sm:py-6">
      <div className="h-7 w-40 animate-pulse rounded bg-muted" />
      <div className="h-28 animate-pulse rounded-xl border border-border bg-card" />
      <div className="h-48 animate-pulse rounded-xl border border-border bg-card" />
    </div>
  );
}

let toastSeq = 0;

/** 浏览器演示模式(?demo=1):mock 数据渲染 UI,便于截图与样式开发 */
const IS_DEMO = new URLSearchParams(location.search).has("demo");
const DEMO_PROVIDERS: Provider[] = [
  {
    id: "demo-1",
    app_type: "claude",
    name: "CoderPlan",
    base_url: "https://api.coderplan.ai",
    endpoints: { anthropic: "https://api.coderplan.ai", openai: "https://api.coderplan.ai/v1" },
    keychain_id: "demo-1",
    models: [],
    is_current: true,
    is_healthy: true,
    sort_index: 0,
    created_at: 0,
    has_key: true,
  },
  {
    id: "demo-2",
    app_type: "claude",
    name: "OpenAI",
    base_url: "https://api.openai.com",
    endpoints: { openai: "https://api.openai.com" },
    keychain_id: "demo-2",
    models: [],
    is_current: false,
    is_healthy: true,
    sort_index: 1,
    created_at: 0,
    has_key: true,
  },
  {
    id: "demo-3",
    app_type: "claude",
    name: "官方登录",
    base_url: "https://api.anthropic.com",
    endpoints: { anthropic: "https://api.anthropic.com" },
    keychain_id: null,
    models: [],
    is_current: false,
    is_healthy: true,
    sort_index: 2,
    created_at: 0,
    has_key: false,
  },
];

function demoProvidersFor(app: AppType): Provider[] {
  const protocol = APP_PROTOCOL[app];
  return DEMO_PROVIDERS.map((provider) => ({
    ...provider,
    app_type: app,
    endpoints: {
      [protocol]: provider.endpoints[protocol] ?? provider.base_url,
    },
  }));
}

function App() {
  const { t, locale } = useI18n();
  const [activeApp, setActiveApp] = useState<AppType>(getInitialApp);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerQuery, setProviderQuery] = useState("");
  const [usageMap, setUsageMap] = useState<Record<string, UsageSummary>>({});
  const [hasCache, setHasCache] = useState(false); // 当前 app 是否已有可展示数据
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [relayRequest, setRelayRequest] = useState<RelayConnectRequest | null>(null);
  const [relayExisting, setRelayExisting] = useState<Provider[]>([]);
  const [relayCurrent, setRelayCurrent] = useState<Provider | undefined>();
  const [relaySavedApp, setRelaySavedApp] = useState<AppType | null>(null);
  const pendingRelayUrl = useRef<string | null>(null);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Provider | null>(null);
  // 空分组引导:其他分组的供应商(点「从其他分组复制」时懒加载)
  const [copySrc, setCopySrc] = useState<Provider[] | null>(null);
  const loadOtherGroups = async () => {
    if (copySrc) return setCopySrc(null);
    if (IS_DEMO) {
      setCopySrc(appsOrder.filter((app) => app !== activeApp).flatMap((app) => demoProvidersFor(app)));
      return;
    }
    const all: Provider[] = [];
    for (const a of appsOrder) {
      if (a === activeApp) continue;
      try {
        all.push(...(await invoke<Provider[]>("list_providers", { appType: a })));
      } catch {
        /* 该分组读取失败则跳过 */
      }
    }
    setCopySrc(all);
  };
  /** 跨分组复制:按当前分组的 app_type 重建一条(name 去重) */
  const copyFromGroup = async (src: Provider) => {
    try {
      const created = await invoke<Provider>("create_provider", {
        input: {
          app_type: activeApp,
          name: src.name,
          base_url: src.base_url,
          models: src.models,
        },
      });
      toast("success", t("toast.added", { name: created.name }));
      syncTray();
      setCopySrc(null);
      await refresh(activeApp);
      focusProvider(created.id);
    } catch (e) {
      toast("error", humanizeError(String(e), t));
    }
  };
  const [aboutOpen, setAboutOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  // 拖拽排序:被拖卡片 id 与悬停目标 id
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // 全部测速:批量结果 + 进行中标记
  const [batchResults, setBatchResults] = useState<Record<string, { ok: boolean; latency_ms: number; message: string }>>({});
  const [testingAll, setTestingAll] = useState(false);
  // 候选链展示(Clash 式)+ 按延迟排序开关
  const [chain, setChain] = useState<string[]>([]);
  const [gatewayRevision, setGatewayRevision] = useState(0);
  const [latencySort, setLatencySort] = useState(false);
  // 接管状态:app → { active: 内部已接管, effective: 配置确实指向代理 }(批 54 漂移检测)
  const [takeoverMap, setTakeoverMap] = useState<
    Record<string, { active: boolean; effective: boolean; external_owner?: string | null }>
  >({});
  const [retaking, setRetaking] = useState(false);

  const runTestAll = async () => {
    setTestingAll(true);
    try {
      if (IS_DEMO) {
        const map: Record<string, { ok: boolean; latency_ms: number; message: string }> = {};
        providers.forEach((provider, index) => {
          map[provider.id] = { ok: true, latency_ms: 118 + index * 37, message: "" };
        });
        setBatchResults(map);
        toast("success", t("provider.testAllDone", { ok: providers.length, total: providers.length }));
        return;
      }
      const items = await invoke<{ provider_id: string; ok: boolean; latency_ms: number; message: string }[]>(
        "test_all_providers",
        { appType: activeApp },
      );
      const map: Record<string, { ok: boolean; latency_ms: number; message: string }> = {};
      for (const it of items) {
        map[it.provider_id] = { ok: it.ok, latency_ms: it.latency_ms, message: it.message };
      }
      setBatchResults(map);
      const okN = items.filter((i) => i.ok).length;
      toast(okN === items.length ? "success" : "error",
        t("provider.testAllDone", { ok: okN, total: items.length }));
    } catch (e) {
      toast("error", humanizeError(String(e), t));
    } finally {
      setTestingAll(false);
    }
  };

  /** 拖拽落点:本地立即换序,并把完整顺序写回后端 */
  const dropOn = (targetId: string) => {
    const from = dragId;
    setDragId(null);
    setDragOverId(null);
    if (!from || from === targetId) return;
    setProviders((list) => {
      const next = [...list];
      const fi = next.findIndex((p) => p.id === from);
      const ti = next.findIndex((p) => p.id === targetId);
      if (fi < 0 || ti < 0) return list;
      const [moved] = next.splice(fi, 1);
      next.splice(ti, 0, moved);
      void invoke("reorder_providers", { ids: next.map((p) => p.id) }).catch(
        () => {},
      );
      return next;
    });
  };
  /** ↑↓ 按钮排序:在基础顺序上与相邻项交换(延迟排序视图下隐藏) */
  const moveProvider = (id: string, dir: -1 | 1) => {
    if (latencySort) return;
    setProviders((list) => {
      const i = list.findIndex((p) => p.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      void invoke("reorder_providers", { ids: next.map((p) => p.id) }).catch(() => {});
      return next;
    });
  };
  const [currentView, setCurrentView] = useState<"providers" | "settings" | "usage" | "logs" | "mcp" | "skills">("providers");
  // 界面偏好:布局(左侧/顶部)+ 可见分组顺序,设置页可改
  const [layout, setLayoutState] = useState<LayoutMode>(loadLayout);
  const [appsOrder, setAppsOrder] = useState<AppType[]>(loadApps);
  const setLayout = (m: LayoutMode) => {
    setLayoutState(m);
    saveLayout(m);
  };
  const updateApps = (apps: AppType[]) => {
    setAppsOrder(apps);
    saveApps(apps);
  };
  const switchApp = useCallback((app: AppType) => {
    saveLastApp(app);
    setActiveApp(app);
    setCurrentView("providers");
  }, []);
  useEffect(() => {
    setProviderQuery("");
  }, [activeApp]);
  const visibleProviders = providers.filter((provider) => {
    const query = providerQuery.trim().toLowerCase();
    if (!query) return true;
    return [
      provider.name,
      provider.base_url,
      ...Object.values(provider.endpoints ?? {}),
      ...(provider.models ?? []),
    ].some((value) => value?.toLowerCase().includes(query));
  });
  const latencyFor = (provider: Provider) => {
    const result = batchResults[provider.id];
    if (result) return result.ok ? result.latency_ms : Infinity;
    return provider.last_test?.ok ? provider.last_test.latency_ms : Infinity;
  };
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  // 首启向导:零供应商且未看过向导时触发
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [proxyOk, setProxyOk] = useState<boolean | null>(null);
  const [proxyAddr, setProxyAddr] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const providerScrollRef = useRef<HTMLDivElement | null>(null);
  // macOS 融合标题栏(Overlay):红绿灯占据左上角,侧栏顶部需向下避让
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    const p = (window as any).__TAURI_INTERNALS__?.platform;
    setIsMac(p ? p === "darwin" : /Mac/i.test(navigator.userAgent));
  }, []);

  // 按 app 缓存列表数据:切换时先显示缓存,后台刷新(stale-while-revalidate)
  const cacheRef = useRef<Partial<Record<AppType, Provider[]>>>({});
  // 跟踪当前 app:异步刷新返回时防竞态
  const activeAppRef = useRef(activeApp);
  useEffect(() => {
    activeAppRef.current = activeApp;
  }, [activeApp]);

  useEffect(() => {
    if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0;
    if (providerScrollRef.current) providerScrollRef.current.scrollTop = 0;
  }, [currentView, activeApp]);
  useEffect(() => {
    if (IS_DEMO) return;
    const app = activeApp;
    invoke<string[]>("get_failover_chain", { appType: app })
      .then((c) => {
        if (activeAppRef.current === app) setChain(c);
      })
      .catch(() => {
        if (activeAppRef.current === app) setChain([]);
      });
  }, [activeApp, providers, gatewayRevision]);

  const toast = useCallback(
    (type: ToastType, msg: string, action?: ToastItem["action"]) => {
      const id = ++toastSeq;
      setToasts((ts) => [...ts.slice(-2), { id, type, msg, action }]);
      // 带动作(如"撤销")时停留 5s,给用户反应时间
      const ttl = action ? 5000 : type === "success" ? 1800 : 3500;
      setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), ttl);
    },
    [],
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const handleError = useCallback((message: string) => {
    toast("error", humanizeError(message, t));
  }, [t, toast]);

  const handleSuccess = useCallback((message: string) => {
    toast("success", message);
  }, [toast]);

  const handleQuickSwitch = useCallback(() => {
    setQuickOpen(true);
  }, []);

  useEffect(() => {
    if (IS_DEMO || !isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const receive = async (urls: string[]) => {
      // A deep link can arrive while Keyway is minimized to the tray. Bring the
      // existing singleton to the front before showing the import dialog.
      try {
        const window = getCurrentWindow();
        await window.show();
        await window.setFocus();
      } catch {
        // The browser build and older desktop runtimes do not expose window
        // controls; handling the link itself can continue without them.
      }
      for (const raw of urls) {
        // Loopback HTTP is intentionally allowed here for local RELAY testing.
        // Public endpoints still require HTTPS in parseRelayDeepLink.
        const request = parseRelayDeepLink(raw, true);
        if (!request || raw === pendingRelayUrl.current) continue;
        try {
          const [all, current] = await Promise.all([
            invoke<Provider[]>("list_all_providers"),
            invoke<Provider | null>("get_current_provider", { appType: request.app }),
          ]);
          if (disposed) return;
          if (raw === pendingRelayUrl.current) continue;
          pendingRelayUrl.current = raw;
          setRelayExisting(all);
          setRelayCurrent(current ?? undefined);
          setOnboardingOpen(false);
          setIsAddOpen(false);
          switchApp(request.app);
          setRelayRequest(request);
        } catch (error) {
          handleError(String(error));
        }
      }
    };
    void onOpenUrl((urls) => { void receive(urls); })
      .then((un) => {
        if (disposed) un();
        else unlisten = un;
        return getCurrent();
      })
      .then((urls) => { if (!disposed && urls) void receive(urls); })
      .catch((error) => handleError(String(error)));
    return () => { disposed = true; unlisten?.(); };
  }, [handleError, switchApp]);

  const refresh = useCallback(async (app: AppType) => {
    // 演示模式:不走 IPC,直接展示 mock 数据
    if (IS_DEMO) {
      setProviders(demoProvidersFor(app));
      setChain(["CoderPlan", "OpenAI"]);
      setHasCache(true);
      setUsageMap({
        "demo-1": { requests: 128, input_tokens: 412_000, output_tokens: 1_260_000 },
        "demo-2": { requests: 36, input_tokens: 98_000, output_tokens: 210_000 },
      });
      return;
    }
    const cached = cacheRef.current[app];
    if (cached) {
      // 已有缓存:先展示旧数据,静默刷新
      setProviders(cached);
      setHasCache(true);
    } else {
      setHasCache(false);
    }
    try {
      // 用量统计与列表互不依赖:并行发起,不等列表返回
      const usageP = activeAppRef.current === app
        ? invoke<Record<string, UsageSummary>>("get_usage_map", { appType: app }).catch(() => ({}))
        : Promise.resolve(null);
      const list = await invoke<Provider[]>("list_providers", { appType: app });
      cacheRef.current[app] = list;
      // 异步返回时若已切走其他 app,不覆盖当前展示
      if (activeAppRef.current === app) {
        setProviders(list);
        setHasCache(true);
        void usageP.then((m) => {
          if (m && activeAppRef.current === app) setUsageMap(m);
        });
        // 播种上次测速结果(meta 持久化,重启后徽章仍在)
        setBatchResults((prev) => {
          const next = { ...prev };
          for (const p of list) {
            if (p.last_test && !next[p.id]) {
              next[p.id] = {
                ok: p.last_test.ok,
                latency_ms: p.last_test.latency_ms,
                message: p.last_test.ok ? "" : t("provider.unreachable"),
              };
            }
          }
          return next;
        });
      }
    } catch (e) {
      toast("error", humanizeError(String(e), t));
    }
  }, [toast]);

  useEffect(() => {
    setBatchResults({});
    void refresh(activeApp);
  }, [activeApp, refresh]);

  // 首启向导:首次加载完成、无任何供应商、未看过 → 弹出 3 步向导
  useEffect(() => {
    if (IS_DEMO) return;
    if (hasCache && providers.length === 0 && !hasOnboarded()) {
      setOnboardingOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCache]);

  // 代理状态:常显于 header(卖点可见性)
  useEffect(() => {
    if (IS_DEMO) {
      setProxyOk(true);
      setProxyAddr("127.0.0.1:9527");
      return;
    }
    let cancelled = false;
    const load = () => invoke<ProxyStatus>("proxy_status")
      .then((status) => {
        if (cancelled) return;
        setProxyOk(status.running);
        setProxyAddr(status.addr);
      })
      .catch(() => { if (!cancelled) setProxyOk(null); });
    void load();
    const timer = window.setInterval(load, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // 接管漂移检测:active 但配置文件被外部(其他工具/手动)改写 → 分组页横幅提示(批 54)
  const refreshTakeover = useCallback(() => {
    if (IS_DEMO) {
      setTakeoverMap({
        claude: { active: true, effective: true, external_owner: null },
        codex: { active: false, effective: false, external_owner: null },
        gemini: { active: true, effective: false, external_owner: null },
      });
      return;
    }
    invoke<
      { app: string; supported: boolean; active: boolean; effective: boolean; external_owner: string | null }[]
    >("takeover_status")
      .then((list) => {
        const m: Record<string, { active: boolean; effective: boolean; external_owner: string | null }> = {};
        for (const s of list) {
          m[s.app] = {
            active: s.active,
            effective: s.effective,
            external_owner: s.external_owner,
          };
        }
        setTakeoverMap(m);
      })
      .catch(() => setTakeoverMap({}));
  }, []);
  useEffect(() => {
    refreshTakeover();
    const id = window.setInterval(refreshTakeover, 60_000);
    return () => window.clearInterval(id);
  }, [refreshTakeover]);

  const groupDrift =
    takeoverMap[activeApp]?.active === true &&
    takeoverMap[activeApp]?.effective === false &&
    !takeoverMap[activeApp]?.external_owner;
  const groupExternalOwner = takeoverMap[activeApp]?.external_owner;
  const retakeOver = async () => {
    setRetaking(true);
    try {
      if (IS_DEMO) {
        setTakeoverMap((current) => ({
          ...current,
          [activeApp]: { active: true, effective: true, external_owner: null },
        }));
      } else {
        await invoke("apply_takeover", {
          appType: activeApp as "claude" | "codex" | "gemini",
        });
      }
      toast("success", t(activeApp === "codex" ? "takeover.appliedCodex" : "takeover.applied", { name: t(`app.${activeApp}`) }));
      if (!IS_DEMO) refreshTakeover();
    } catch (e) {
      toast("error", humanizeError(String(e), t));
    } finally {
      setRetaking(false);
    }
  };

  // 快捷键:Cmd/Ctrl+N 新建,Cmd/Ctrl+1..5 切换应用
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape:从设置页返回主界面(仪表盘为默认首页)。
      // 对话框/浮层打开时让 Radix 自己关,不劫持跳页;输入框聚焦时也忽略
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        if (document.querySelector("[data-state=open], [data-qs-panel]")) return;
        const el = document.activeElement;
        if (el instanceof HTMLElement && el.isContentEditable) return;
        if (
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLSelectElement
        ) {
          el.blur();
          return;
        }
        setCurrentView("providers");
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        setIsAddOpen(true);
        return;
      }
      // Cmd/Ctrl+Shift+K → 快速切换;M → MCP;S → Skills
      if (e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === "k") {
          e.preventDefault();
          setQuickOpen(true);
          return;
        }
        if (k === "m") {
          e.preventDefault();
          setCurrentView("mcp");
          return;
        }
        if (k === "s") {
          e.preventDefault();
          setCurrentView("skills");
          return;
        }
      }
      const idx = Number(e.key) - 1;
      if (Number.isInteger(idx) && idx >= 0 && idx < appsOrder.length) {
        e.preventDefault();
        switchApp(appsOrder[idx]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appsOrder]);

  // 故障转移自动回退提示
  useEffect(() => {
    if (IS_DEMO) return;
    let un: (() => void) | undefined;
    void listen<{ chain: string }>("provider-fallback", (e) => {
      toast("error", t("fo.fallback", { chain: e.payload.chain }));
    }).then((fn) => (un = fn));
    return () => un?.();
  }, [toast, t]);

  // 托盘快速切换后:同步刷新 + toast(与主界面操作同一反馈通道)
  useEffect(() => {
    if (IS_DEMO) return;
    let un: (() => void) | undefined;
    void listen<{ appType: AppType; providerId: string; name: string }>(
      "provider-switched",
      (e) => {
        toast("success", t("toast.switchedTray", { name: e.payload.name }));
        cacheRef.current = {};
        void refresh(e.payload.appType);
      },
    ).then((fn) => (un = fn));
    return () => un?.();
  }, [refresh, toast]);

  // 全局快捷键 ⌘⇧K:唤起快速切换面板(演示模式同样可用,纯前端交互)
  useEffect(() => {
    if (IS_DEMO) return;
    let un: (() => void) | undefined;
    void listen("quick-switch", () => setQuickOpen(true)).then(
      (fn) => (un = fn),
    );
    return () => un?.();
  }, []);

  /** 首启导入:扫描现有 CLI 配置建供应商 */
  const [importing, setImporting] = useState(false);
  const runImport = async () => {
    setImporting(true);
    try {
      const list = await invoke<{ app: string; name: string; has_key: boolean }[]>(
        "import_existing",
      );
      if (list.length === 0) {
        toast("error", t("import.none"));
      } else {
        toast(
          "success",
          t("import.done", { n: list.length, names: list.map((x) => x.name.replace("导入的 ", "").replace("Imported ", "")).join(list.length > 1 && locale === "zh" ? "、" : ", ") }),
        );
        syncTray();
        await refresh(activeApp);
      }
    } catch (e) {
      toast("error", humanizeError(String(e), t));
    } finally {
      setImporting(false);
    }
  };

  /** 跨分组快速切换:面板打开时拉取所有分组的供应商(缓存优先) */
  const [qsGroups, setQsGroups] = useState<{ app: AppType; providers: Provider[] }[]>([]);
  useEffect(() => {
    if (!quickOpen) return;
    if (IS_DEMO) {
      setQsGroups(
        appsOrder.map((a) => ({
          app: a,
          providers: demoProvidersFor(a),
        })),
      );
      return;
    }
    let alive = true;
    void (async () => {
      const gs: { app: AppType; providers: Provider[] }[] = [];
      for (const a of appsOrder) {
        let list = cacheRef.current[a];
        if (!list) {
          try {
            list = await invoke<Provider[]>("list_providers", { appType: a });
            cacheRef.current[a] = list;
          } catch {
            list = [];
          }
        }
        gs.push({ app: a, providers: list });
      }
      if (alive) setQsGroups(gs);
    })();
    return () => {
      alive = false;
    };
  }, [appsOrder, quickOpen]);

  /** 供应商变更后同步托盘菜单(演示模式无后端,跳过) */
  const syncTray = useCallback(() => {
    if (!IS_DEMO) void invoke("refresh_tray").catch(() => {});
  }, []);

  /** 新建/更新后:滚动到该卡片并短暂高亮 */
  const focusProvider = useCallback((id: string) => {
    setHighlightId(id);
    setTimeout(() => {
      document
        .getElementById(`provider-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 80);
    setTimeout(() => setHighlightId(null), 2200);
  }, []);

  const switchProvider = async (provider: Provider, app: AppType = activeApp) => {
    // 记住切换前的当前供应商,支持 toast「撤销」一键切回
    const prev = cacheRef.current[app]?.find((p) => p.is_current);
    try {
      if (IS_DEMO) {
        setProviders((list) => list.map((item) => ({ ...item, is_current: item.id === provider.id })));
        toast("success", t("toast.switched", { name: provider.name }));
        return;
      }
      await invoke("switch_provider", {
        id: provider.id,
        appType: app,
      });
      // 跨组切换:同时把界面切到对应分组,所见即所得
      if (app !== activeApp) {
        switchApp(app);
      }
      toast(
        "success",
        t("toast.switched", { name: provider.name }),
        prev && prev.id !== provider.id
          ? {
              label: t("toast.undo"),
              run: () => void switchProvider(prev, app),
            }
          : undefined,
      );
      syncTray();
      await refresh(app);
    } catch (e) {
      toast("error", humanizeError(String(e), t));
    }
  };

  const duplicateProvider = async (provider: Provider) => {
    try {
      const created = await invoke<Provider>("create_provider", {
        input: {
          app_type: provider.app_type,
          name: `${provider.name} (副本)`,
          base_url: provider.base_url,
          models: provider.models,
        },
      });
      toast("success", t("toast.duplicated", { name: created.name }));
      syncTray();
      await refresh(activeApp);
      focusProvider(created.id);
    } catch (e) {
      toast("error", humanizeError(String(e), t));
    }
  };

  const deleteProvider = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    try {
      await invoke("delete_provider", { id: target.id });
      setConfirmDelete(null);
      toast("success", t("toast.deleted", { name: target.name }));
      syncTray();
      await refresh(activeApp);
    } catch (e) {
      toast("error", humanizeError(String(e), t));
    }
  };

  return (
    <div
      className={cn(
        "flex h-screen overflow-hidden bg-background text-foreground selection:bg-primary/30",
        layout === "top" || layout === "bottom" ? "flex-col" : "flex-row",
      )}
    >
      {/* 布局一:左侧导航栏(默认,腾讯会议式) */}
      {layout === "side" && (
        <Sidebar
          apps={appsOrder}
          activeApp={activeApp}
          onSwitchApp={switchApp}
          currentView={currentView}
          onViewChange={setCurrentView}
          proxyOk={proxyOk}
          proxyAddr={proxyAddr}
          onTakeover={() => setTakeoverOpen(true)}
          onAbout={() => setAboutOpen(true)}
          onGuide={() => setGuideOpen(true)}
          onAdd={() => setIsAddOpen(true)}
          onQuickSwitch={() => setQuickOpen(true)}
          isMac={isMac}
        />
      )}

      {/* 顶部横栏布局 */}
      {layout === "top" && (
        <AppHeaderBar
          position="top"
          apps={appsOrder}
          activeApp={activeApp}
          currentView={currentView}
          onViewChange={setCurrentView}
          onSwitchApp={switchApp}
          onAdd={() => setIsAddOpen(true)}
          onQuickSwitch={() => setQuickOpen(true)}
          proxyOk={proxyOk}
          proxyAddr={proxyAddr}
          onTakeover={() => setTakeoverOpen(true)}
          onGuide={() => setGuideOpen(true)}
          isMac={isMac}
        />
      )}

      {/* 右侧主区:内容直接铺满(标题与添加入口在侧栏) */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      {/* 主内容区:供应商卡片列表 */}
      <main
        ref={mainScrollRef}
        className={cn(
          "flex-1 min-h-0 flex flex-col overflow-y-auto",
          // 右侧/底部布局:macOS 红绿灯悬于主区左上,顶部避让
          (layout === "right" || layout === "bottom") && isMac && "pt-7",
        )}
        data-tauri-drag-region
      >
        <Suspense fallback={<PageFallback />}>
        {currentView === "skills" && (
          <div className="mx-auto w-full max-w-[920px] px-3 py-4 sm:px-6 sm:py-6 animate-fade-in">
            <SkillsPage
              onError={handleError}
              onSuccess={handleSuccess}
            />
          </div>
        )}
        {currentView === "mcp" && (
          <div className="mx-auto w-full max-w-[920px] px-3 py-4 sm:px-6 sm:py-6 animate-fade-in">
            <McpPage
              onError={handleError}
              onSuccess={handleSuccess}
            />
          </div>
        )}
        {currentView === "settings" && (
          <div className="px-3 py-4 sm:px-6 sm:py-6 max-w-[760px] w-full mx-auto animate-fade-in">
            <SettingsPage
              onError={handleError}
              onSuccess={handleSuccess}
              layout={layout}
              onLayoutChange={setLayout}
              apps={appsOrder}
              onAppsChange={updateApps}
            />
          </div>
        )}
        {currentView === "usage" && (
          <div className="mx-auto w-full max-w-[1040px] px-3 py-4 sm:px-6 sm:py-6 animate-fade-in">
            <UsagePage
              app={activeApp}
              appName={t(`app.${activeApp}`)}
              providers={providers}
              onError={handleError}
              onInfo={handleSuccess}
            />
          </div>
        )}
        {currentView === "logs" && (
          <div className="mx-auto w-full max-w-[1040px] px-3 py-4 sm:px-6 sm:py-6 animate-fade-in">
            <LogsPage
              key={activeApp}
              app={activeApp}
              appName={t(`app.${activeApp}`)}
              providers={providers}
              onError={handleError}
              onInfo={handleSuccess}
              onQuickSwitch={handleQuickSwitch}
            />
          </div>
        )}
        {currentView === "providers" && (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden px-4 pt-4 sm:px-8 sm:pt-6">
          <div ref={providerScrollRef} className="flex-1 overflow-y-auto overflow-x-hidden pb-12 px-1">
            <div className="mx-auto flex min-h-full w-full max-w-[1040px] flex-col space-y-4 animate-fade-in" key={activeApp}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {t("provider.workspace")}
                  </p>
                  <h1 className="mt-1 truncate text-xl font-semibold tracking-tight sm:text-2xl">
                    {t(`app.${activeApp}`)}
                  </h1>
                  <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
                    {t("provider.pageDesc")}
                  </p>
                </div>
                <Button size="sm" className="shrink-0" aria-label={t("common.add")} onClick={() => setIsAddOpen(true)}>
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("common.add")}</span>
                </Button>
              </div>
              <GatewayStatusStrip
                app={activeApp}
                defaultProvider={providers.find((provider) => provider.is_current)?.name}
                proxyRunning={proxyOk}
                proxyAddr={proxyAddr}
                takeover={takeoverMap[activeApp]}
                chain={chain}
                onManage={() => setTakeoverOpen(true)}
                onLogs={() => setCurrentView("logs")}
                onQuickSwitch={() => setQuickOpen(true)}
                onTestAll={() => void runTestAll()}
                testingAll={testingAll}
              />
              {groupExternalOwner && (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5">
                  <span className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                    <TriangleAlert className="w-4 h-4 shrink-0" />
                    {t("takeover.externalOwnerBanner")}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 border-amber-500/40 px-2.5 text-xs text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
                    onClick={() => setTakeoverOpen(true)}
                  >
                    {t("takeover.externalOwnerAction")}
                  </Button>
                </div>
              )}
              {/* 接管漂移:配置被外部覆盖,流量绕过了 Keyway(批 54) */}
              {groupDrift && (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5">
                  <span className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                    <TriangleAlert className="w-4 h-4 shrink-0" />
                    {t("takeover.driftBanner")}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 border-amber-500/40 px-2.5 text-xs text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
                    disabled={retaking}
                    onClick={() => void retakeOver()}
                  >
                    {retaking ? "…" : t("takeover.retake")}
                  </Button>
                </div>
              )}
              {providers.length > 0 && (
                <RoutePreviewCard
                  app={activeApp}
                  providers={providers}
                  gatewayRevision={gatewayRevision}
                  onManage={() => {
                    setCurrentView("settings");
                    window.setTimeout(() => {
                      document.getElementById("route-rules")?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                    }, 80);
                  }}
                />
              )}
              {/* 首次加载:骨架屏占位 */}
              {!hasCache && providers.length === 0 && (
                <>
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                </>
              )}

              {/* 空状态:CTA 引导 */}
              {hasCache && providers.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
                  <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center border border-border">
                    <Boxes className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-base font-medium">{t("empty.title", { app: t(`app.${activeApp}`) })}</p>
                  <p className="text-sm text-muted-foreground -mt-2">
                    {t("empty.desc")}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <Button onClick={() => setIsAddOpen(true)}>
                      <Plus className="w-4 h-4 mr-1" />
                      {t("empty.cta")}
                    </Button>
                    {!IS_DEMO && (
                      <Button
                        variant="outline"
                        disabled={importing}
                        onClick={() => void runImport()}
                      >
                        <Download className="w-4 h-4 mr-1" />
                        {importing ? t("empty.importing") : t("empty.import")}
                      </Button>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => void loadOtherGroups()}>
                    <CopyPlus className="w-4 h-4 mr-1" />
                    {t("empty.copyFrom")}
                  </Button>
                  {copySrc && (
                    <div className="mt-1 max-w-md w-full rounded-lg border border-border bg-card p-2">
                      {copySrc.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-2">
                          {t("empty.copyNone")}
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 justify-center">
                          {copySrc.map((src) => (
                            <button
                              key={src.id}
                              type="button"
                              onClick={() => void copyFromGroup(src)}
                              className="rounded-md border border-border bg-muted px-2 py-1 text-xs hover:bg-accent"
                              title={t(`app.${src.app_type}`)}
                            >
                              {src.name}
                              <span className="ml-1 text-muted-foreground">
                                · {t(`app.${src.app_type}`)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t("empty.kbd")}{" "}
                    <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted font-mono text-[10px]">
                      ⌘N
                    </kbd>
                  </p>
                </div>
              )}

              {providers.length > 0 && (
                <div className="flex flex-col gap-3 border-b border-border/70 pb-3 pt-1 lg:flex-row lg:items-end lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{t("provider.poolTitle")}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("provider.poolDesc", { n: providers.length })}
                        {providerQuery && (
                          <span className="ml-1 tabular-nums" aria-live="polite">
                            · {t("provider.searchCount", { shown: visibleProviders.length, total: providers.length })}
                          </span>
                        )}
                      </p>
                    </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2 lg:flex-1 lg:justify-end">
                    <div className="relative min-w-[180px] flex-1 lg:max-w-[340px]">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="search"
                        value={providerQuery}
                        onChange={(event) => setProviderQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape" && providerQuery) {
                            event.stopPropagation();
                            setProviderQuery("");
                          }
                        }}
                        placeholder={t("provider.searchPh")}
                        aria-label={t("provider.searchPh")}
                        className="h-9 w-full appearance-none rounded-lg border border-border bg-background pl-8 pr-8 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                      />
                      {providerQuery && (
                        <button
                          type="button"
                          aria-label={t("common.clear")}
                          onClick={() => setProviderQuery("")}
                          className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <Button
                      variant={latencySort ? "secondary" : "ghost"}
                      size="sm"
                      title={t("gw.latencySort")}
                      onClick={() => setLatencySort((v) => !v)}
                    >
                      <Gauge className="w-4 h-4 mr-1" />
                      {t("gw.latencySort")}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={testingAll} onClick={() => void runTestAll()}>
                      <Activity className={cn("w-4 h-4 mr-1", testingAll && "animate-pulse")} />
                      {testingAll ? t("provider.testingAll") : t("provider.testAll")}
                    </Button>
                  </div>
                </div>
              )}

              {visibleProviders.length === 0 && providers.length > 0 && (
                <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("provider.noMatch")}
                </div>
              )}

              {(latencySort
                ? [...visibleProviders].sort((a, b) => {
                    return latencyFor(a) - latencyFor(b);
                  })
                : visibleProviders
              ).map((p) => (
                <div
                  key={p.id}
                  draggable
                  onDragStart={(e) => {
                    setDragId(p.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverId(p.id);
                  }}
                  onDragLeave={() => setDragOverId((x) => (x === p.id ? null : x))}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropOn(p.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDragOverId(null);
                  }}
                  className={cn(
                    "rounded-xl transition-shadow",
                    dragId === p.id && "opacity-40",
                    dragOverId === p.id && dragId !== p.id && "ring-2 ring-blue-500/50",
                  )}
                  title={t("provider.dragHint")}
                >
                  <ProviderCard
                    provider={p}
                    isCurrent={p.is_current}
                    app={activeApp}
                    takeoverEffective={takeoverMap[activeApp]?.effective}
                    takeoverActive={takeoverMap[activeApp]?.active}
                    takeoverExternalOwner={takeoverMap[activeApp]?.external_owner}
                    highlight={p.id === highlightId}
                    onMoveUp={
                      !latencySort && providers.findIndex((x) => x.id === p.id) > 0
                        ? () => moveProvider(p.id, -1)
                        : undefined
                    }
                    onMoveDown={
                      !latencySort &&
                      providers.findIndex((x) => x.id === p.id) < providers.length - 1
                        ? () => moveProvider(p.id, 1)
                        : undefined
                    }
                    onSwitch={(provider) => void switchProvider(provider)}
                    onEdit={(provider) => setEditingProvider(provider)}
                    onDuplicate={(provider) => void duplicateProvider(provider)}
                    onDelete={(provider) => setConfirmDelete(provider)}
                    usage={usageMap[p.id]}
                    batchResult={batchResults[p.id] ?? null}
                    testedAt={p.last_test?.ts ?? null}
                    onTestResult={(result) => {
                      setBatchResults((prev) => ({
                        ...prev,
                        [p.id]: {
                          ok: result.ok,
                          latency_ms: result.latency_ms,
                          message: result.message,
                        },
                      }));
                    }}
                    onError={(m) => toast("error", humanizeError(m, t))}
                    onCopyUrl={(url) => {
                      navigator.clipboard
                        .writeText(url)
                        .then(() => toast("success", t("toast.copied")))
                        .catch(() => toast("error", t("toast.copyFailed")));
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        )}
        </Suspense>
      </main>
      </div>

      {/* 右侧边栏布局:导航在右 */}
      {layout === "right" && (
        <Sidebar
          apps={appsOrder}
          edge="right"
          activeApp={activeApp}
          onSwitchApp={switchApp}
          currentView={currentView}
          onViewChange={setCurrentView}
          proxyOk={proxyOk}
          proxyAddr={proxyAddr}
          onTakeover={() => setTakeoverOpen(true)}
          onAbout={() => setAboutOpen(true)}
          onGuide={() => setGuideOpen(true)}
          onAdd={() => setIsAddOpen(true)}
          onQuickSwitch={() => setQuickOpen(true)}
          isMac={isMac}
        />
      )}

      {/* 底部横栏布局 */}
      {layout === "bottom" && (
        <AppHeaderBar
          position="bottom"
          apps={appsOrder}
          activeApp={activeApp}
          currentView={currentView}
          onViewChange={setCurrentView}
          onSwitchApp={switchApp}
          onAdd={() => setIsAddOpen(true)}
          onQuickSwitch={() => setQuickOpen(true)}
          proxyOk={proxyOk}
          proxyAddr={proxyAddr}
          onTakeover={() => setTakeoverOpen(true)}
          onGuide={() => setGuideOpen(true)}
          isMac={isMac}
        />
      )}

      <ToastStack items={toasts} onDismiss={dismissToast} />

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />

      {guideOpen && (
        <Suspense fallback={null}>
          <GettingStartedDialog
            open={guideOpen}
            onOpenChange={setGuideOpen}
            app={activeApp}
            providersCount={providers.length}
            takeoverEffective={Boolean(takeoverMap[activeApp]?.effective)}
            onAdd={() => setIsAddOpen(true)}
            onTakeover={() => setTakeoverOpen(true)}
            onQuickSwitch={() => setQuickOpen(true)}
            onLogs={() => setCurrentView("logs")}
            onRouting={() => {
              setCurrentView("providers");
              window.setTimeout(() => {
                document.getElementById("route-preview")?.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                });
              }, 80);
            }}
          />
        </Suspense>
      )}

      <QuickSwitchPanel
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        app={activeApp}
        providers={providers}
        groups={qsGroups}
        onPick={(p, a) => void switchProvider(p, a)}
        onAdd={() => setIsAddOpen(true)}
      />

      <OnboardingDialog
        open={onboardingOpen}
        onOpenChange={setOnboardingOpen}
        apps={appsOrder}
        onAppsChange={updateApps}
        onAdd={() => setIsAddOpen(true)}
        onImport={() => void runImport()}
        providersCount={providers.length}
        onDone={() => {
          void refresh(activeApp);
          setGuideOpen(true);
        }}
      />

      <TakeoverDialog
        open={takeoverOpen}
        initialApp={activeApp}
        gatewayDetails={
          <GatewayStatusStrip
            variant="details"
            app={activeApp}
            defaultProvider={providers.find((provider) => provider.is_current)?.name}
            proxyRunning={proxyOk}
            proxyAddr={proxyAddr}
            takeover={takeoverMap[activeApp]}
            chain={chain}
            onManage={() => setTakeoverOpen(true)}
            onLogs={() => {
              setTakeoverOpen(false);
              setCurrentView("logs");
            }}
            onQuickSwitch={() => setQuickOpen(true)}
            onTestAll={() => void runTestAll()}
            testingAll={testingAll}
          />
        }
        onOpenChange={(open) => {
          setTakeoverOpen(open);
          if (!open) {
            setGatewayRevision((revision) => revision + 1);
            refreshTakeover();
          }
        }}
        onError={(m) => toast("error", humanizeError(m, t))}
        onSuccess={(m) => {
          toast("success", m);
          refreshTakeover();
          setGatewayRevision((revision) => revision + 1);
        }}
      />

      <AddProviderDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        appId={activeApp}
        onCreated={async (created, fromRelay) => {
          toast("success", t("toast.added", { name: created.name }));
          syncTray();
          await refresh(activeApp);
          focusProvider(created.id);
          if (fromRelay) setRelaySavedApp(activeApp);
        }}
        onError={(msg) => toast("error", humanizeError(msg, t))}
      />

      <RelayConnectDialog
        request={relayRequest}
        existingProviders={relayExisting}
        currentProvider={relayCurrent}
        onClose={() => { setRelayRequest(null); pendingRelayUrl.current = null; }}
        onCreated={(created, app) => {
          toast("success", t("toast.added", { name: created.name }));
          syncTray();
          void refresh(app).then(() => focusProvider(created.id));
          setRelaySavedApp(app);
        }}
        onError={(message) => handleError(message)}
      />

      <Dialog open={relaySavedApp !== null} onOpenChange={(open) => { if (!open) setRelaySavedApp(null); }}>
        <DialogContent className="sm:max-w-[430px]">
          <DialogHeader>
            <DialogTitle>{t("relay.savedTitle")}</DialogTitle>
            <DialogDescription>{t("relay.savedDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRelaySavedApp(null)}>{t("relay.later")}</Button>
            <Button onClick={() => {
              if (relaySavedApp) switchApp(relaySavedApp);
              setRelaySavedApp(null);
              setTakeoverOpen(true);
            }}>{t("relay.manageTakeover")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditProviderDialog
        provider={editingProvider}
        defaultProtocol={APP_PROTOCOL[activeApp]}
        onOpenChange={(open: boolean) => {
          if (!open) setEditingProvider(null);
        }}
        onSaved={async (saved) => {
          toast("success", t("toast.saved", { name: saved.name }));
          syncTray();
          await refresh(activeApp);
          focusProvider(saved.id);
        }}
        onError={(msg) => toast("error", humanizeError(msg, t))}
      />

      <ConfirmDialog
        isOpen={Boolean(confirmDelete)}
        title={t("confirm.deleteTitle")}
        message={t("confirm.deleteMsg", { name: confirmDelete?.name ?? "" })}
        onConfirm={() => void deleteProvider()}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

export default App;
