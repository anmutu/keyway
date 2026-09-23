import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ShieldCheck, ShieldOff, TriangleAlert, Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ProviderIcon } from "@/components/ProviderIcon";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { AppType } from "@/types";
import { ALL_APPS } from "@/lib/appPrefs";

interface TakeoverStatus {
  app: AppType;
  supported: boolean;
  config_exists: boolean;
  active: boolean;
  effective: boolean;
  failover: boolean;
}

const IS_DEMO = new URLSearchParams(location.search).has("demo");
const DEMO_TAKEOVER_STATUSES: TakeoverStatus[] = [
  { app: "claude", supported: true, config_exists: true, active: true, effective: true, failover: true },
  { app: "codex", supported: true, config_exists: false, active: false, effective: false, failover: false },
  { app: "gemini", supported: true, config_exists: true, active: true, effective: false, failover: false },
  { app: "opencode", supported: true, config_exists: false, active: false, effective: false, failover: false },
  { app: "openclaw", supported: true, config_exists: false, active: false, effective: false, failover: false },
];

/** 接管管理:把各 CLI 的 live 配置指向本地代理(可随时还原) */
export function TakeoverDialog({
  open,
  initialApp = "claude",
  onOpenChange,
  onError,
  onSuccess,
}: {
  open: boolean;
  initialApp?: AppType;
  onOpenChange: (open: boolean) => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}) {
  const [list, setList] = useState<TakeoverStatus[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [shell, setShell] = useState<"posix" | "powershell">(() => /Windows/i.test(navigator.userAgent) ? "powershell" : "posix");
  const [manualApp, setManualApp] = useState<AppType>(initialApp);
  const requestId = useRef(0);
  const mutationPending = useRef(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useI18n();
  const baseUrl = `http://127.0.0.1:9527/__keyway/${manualApp}`;
  const snippet = [
    ["ANTHROPIC_BASE_URL", baseUrl],
    ["ANTHROPIC_AUTH_TOKEN", "keyway"],
    ["OPENAI_BASE_URL", `${baseUrl}/v1`],
    ["OPENAI_API_KEY", "keyway"],
    ["GOOGLE_GEMINI_BASE_URL", baseUrl],
    ["GEMINI_API_KEY", "keyway"],
  ].map(([name, value]) => shell === "powershell"
    ? `$env:${name}="${value}"`
    : `export ${name}=${value}`).join("\n");

  const refresh = async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      if (IS_DEMO) {
        setList((current) => current.length > 0 ? current : DEMO_TAKEOVER_STATUSES.map((status) => ({ ...status })));
        return;
      }
      const statuses = await invoke<TakeoverStatus[]>("takeover_status");
      if (currentRequest === requestId.current) setList(statuses.filter((status) => status.supported));
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      setList([]);
      setLoadFailed(true);
      onError(String(error));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setManualApp(initialApp);
      setCopied(false);
      void refresh();
    }
    return () => {
      requestId.current += 1;
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialApp]);

  const toggleFailover = async (app: AppType, enabled: boolean) => {
    if (mutationPending.current || loading) return;
    mutationPending.current = true;
    setBusy(app);
    try {
      if (IS_DEMO) {
        setList((current) => current.map((status) => status.app === app ? { ...status, failover: enabled } : status));
      } else {
        await invoke("set_failover", {
          appType: app,
          enabled,
        });
      }
      onSuccess(t("fo.toast", { name: t(`app.${app}`), state: enabled ? "✓" : "✕" }));
      if (!IS_DEMO) await refresh();
    } catch (e) {
      onError(String(e));
    } finally {
      mutationPending.current = false;
      setBusy(null);
    }
  };

  const act = async (app: AppType, restore: boolean) => {
    if (mutationPending.current || loading) return;
    mutationPending.current = true;
    setBusy(app);
    try {
      if (IS_DEMO) {
        setList((current) => current.map((status) => status.app === app
          ? { ...status, active: !restore, effective: !restore, config_exists: true }
          : status));
      } else if (restore) {
        await invoke("restore_takeover", { appType: app });
      } else {
        await invoke("apply_takeover", { appType: app });
      }
      onSuccess(restore
        ? t("takeover.restored", { name: t(`app.${app}`) })
        : t(app === "codex" ? "takeover.appliedCodex" : "takeover.applied", { name: t(`app.${app}`) }));
      if (!IS_DEMO) await refresh();
    } catch (e) {
      onError(String(e));
    } finally {
      mutationPending.current = false;
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!mutationPending.current) onOpenChange(nextOpen);
    }}>
      <DialogContent closeDisabled={busy !== null} className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("takeover.title")}</DialogTitle>
          <DialogDescription>
            {t("takeover.desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed text-muted-foreground">
          <p>{t("takeover.sessionHint")}</p>
          <p>{t("takeover.dependencyHint")}</p>
        </div>

        <div className="grid gap-3">
          {list.map((s) => (
            <div
              key={s.app}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3 bg-card"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <ProviderIcon icon={s.app} size={18} />
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {t(`app.${s.app}`)}
                  </div>
                  <div
                    className={cn(
                      "text-xs flex items-center gap-1",
                      s.active && s.effective
                        ? "text-emerald-600 dark:text-emerald-400"
                        : s.active && !s.effective
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground",
                    )}
                  >
                    {s.active && s.effective && (
                      <>
                        <ShieldCheck className="w-3 h-3" /> {t("takeover.active")}
                      </>
                    )}
                    {s.active && !s.effective && (
                      <>
                        <TriangleAlert className="w-3 h-3" />
                        {t("takeover.overridden")}
                      </>
                    )}
                    {!s.active && (
                      <>
                        <ShieldOff className="w-3 h-3" />
                        {s.config_exists ? t("takeover.inactive") : t("takeover.noConfig")}
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5" title={t("fo.label")}>
                  <span className="text-xs text-muted-foreground hidden sm:inline">{t("fo.label")}</span>
                  <Switch
                    aria-label={t("takeover.failoverFor", { name: t(`app.${s.app}`) })}
                    checked={s.failover}
                    disabled={busy !== null || loading}
                    onCheckedChange={(v) => void toggleFailover(s.app, v)}
                  />
                </div>
                {s.active && s.effective ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null || loading}
                    onClick={() => void act(s.app, true)}
                  >
                    {busy === s.app ? "…" : t("takeover.restore")}
                  </Button>
                ) : s.active && !s.effective ? (
                  /* 被外部覆盖:主操作是重新夺回,还原为次选 */
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null || loading}
                      onClick={() => void act(s.app, true)}
                    >
                      {busy === s.app ? "…" : t("takeover.restore")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy !== null || loading}
                      onClick={() => void act(s.app, false)}
                    >
                      {busy === s.app ? "…" : t("takeover.retake")}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    disabled={busy !== null || loading}
                    onClick={() => void act(s.app, false)}
                  >
                    {busy === s.app ? "…" : t("takeover.apply")}
                  </Button>
                )}
              </div>
            </div>
          ))}
          {loadFailed && (
            <div className="space-y-2 rounded-lg border border-border p-3 text-sm" role="alert">
              <p>{t("takeover.loadFailed")}</p>
              <Button size="sm" variant="outline" disabled={busy !== null || loading} onClick={() => void refresh()}>{t("takeover.retry")}</Button>
            </div>
          )}
          {list.length === 0 && !loadFailed && (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t(loading ? "common.loading" : "takeover.empty")}
            </p>
          )}

          {/* 其他 CLI 手动接入:一键复制环境变量 */}
          <div className="rounded-xl border border-dashed border-border p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("takeover.manualTitle")}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(snippet);
                    setCopied(true);
                    if (copyTimer.current) clearTimeout(copyTimer.current);
                    copyTimer.current = setTimeout(() => setCopied(false), 1500);
                  } catch {
                    onError(String(t("takeover.copyFail")));
                  }
                }}
              >
                {copied ? (
                  <><Check className="w-3.5 h-3.5 mr-1" />{t("takeover.copied")}</>
                ) : (
                  <><Copy className="w-3.5 h-3.5 mr-1" />{t("takeover.copyEnv")}</>
                )}
              </Button>
            </div>
            <label className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {t("takeover.manualGroup")}
              <select value={manualApp} onChange={(event) => {
                setManualApp(event.target.value as AppType);
                setCopied(false);
              }} className="rounded-md border border-border bg-background px-2 py-1 text-foreground">
                {ALL_APPS.map((app) => <option key={app} value={app}>{t(`app.${app}`)}</option>)}
              </select>
            </label>
            <p className="mb-2 break-all font-mono text-xs text-muted-foreground">{baseUrl}</p>
            <label className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {t("takeover.shell")}
              <select value={shell} onChange={(event) => {
                setShell(event.target.value as "posix" | "powershell");
                setCopied(false);
              }} className="rounded-md border border-border bg-background px-2 py-1 text-foreground">
                <option value="posix">Bash / Zsh</option>
                <option value="powershell">PowerShell</option>
              </select>
            </label>
            <p className="mb-2 text-xs leading-relaxed text-muted-foreground">{t("takeover.manualHint")}</p>
            <pre className="text-[11px] leading-relaxed text-muted-foreground overflow-x-auto">
              <code>{snippet}</code>
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
