import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ExternalLink, Plus, Search } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/PasswordInput";
import { ProviderIcon } from "@/components/ProviderIcon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  providerPresets,
  type ProviderPreset,
} from "@/data/providerPresets";
import { loadPresetOrder, savePresetOrder } from "@/lib/appPrefs";
import { cn } from "@/lib/utils";
import { isValidRelayBase, relayEndpointForApp, relayFormState } from "@/lib/relayDeepLink";
import type { AppType, Provider } from "@/types";

const PROVIDER_SUBMISSION_URL =
  "https://github.com/anmutu/keyway/issues/new?template=provider-submission.yml";

interface AddProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appId: AppType;
  onCreated: (provider: Provider, fromRelay?: boolean) => void;
  onError: (msg: string) => void;
}

/** 校验接口地址:必须是合法 http(s) URL */
function validateUrl(v: string, t: ReturnType<typeof useI18n>["t"]): string | null {
  if (!v.trim()) return null; // 空值交给必填校验
  try {
    const u = new URL(v.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return t("url.scheme");
    }
    return null;
  } catch {
    return t("url.invalid");
  }
}

// 添加供应商对话框;
// form 包住整个内容(含 footer),支持 Enter 提交。
// 两步式:先选预设(或自定义),再进入预填表单。
export function AddProviderDialog({
  open,
  onOpenChange,
  appId,
  onCreated,
  onError,
}: AddProviderDialogProps) {
  const { t } = useI18n();
  const [preset, setPreset] = useState<ProviderPreset | null>(null);
  // 步骤要独立于 preset:preset===null 既表示"还没选"也表示"自定义",
  // 若用它推导 step,点「自定义供应商」会永远停在第一步
  const [step, setStep] = useState<"pick" | "form">("pick");
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [existingNames, setExistingNames] = useState<string[]>([]);
  const [currentName, setCurrentName] = useState<string | null>(null);
  const [relayStateLoaded, setRelayStateLoaded] = useState(false);
  const [relayConfirmed, setRelayConfirmed] = useState(false);
  const [relayDuplicate, setRelayDuplicate] = useState(false);
  const keyInputRef = useRef<HTMLInputElement>(null);

  // 拖拽排序:扁平列表全局排序;持久化到 localStorage
  const [presetOrders, setPresetOrders] = useState<
    Record<string, string[]>
  >(() => loadPresetOrder().presets);
  const [dragPreset, setDragPreset] = useState<string | null>(null);
  const [dragOverPreset, setDragOverPreset] = useState<string | null>(null);

  const persist = (orders: Record<string, string[]>) => {
    savePresetOrder({ categories: [], presets: orders });
  };

  const dropPreset = (targetName: string) => {
    if (!dragPreset) return;
    const list = providerPresets[appId] ?? [];
    if (dragPreset === targetName || !list.some((p) => p.name === targetName)) {
      return setDragPreset(null);
    }
    const names = list.map((p) => p.name);
    const order = presetOrders[appId] ?? [];
    const base = order.length ? order.filter((n) => names.includes(n)) : names;
    const next = base.filter((n) => n !== dragPreset);
    next.splice(next.indexOf(targetName), 0, dragPreset);
    const orders = { ...presetOrders, [appId]: next };
    setPresetOrders(orders);
    persist(orders);
    setDragPreset(null);
    setDragOverPreset(null);
  };

  useEffect(() => {
    if (open) {
      setPreset(null);
      setStep("pick");
      setSearch("");
      setName("");
      setBaseUrl("");
      setApiKey("");
      setUrlError(null);
      setRelayConfirmed(false);
      setRelayDuplicate(false);
      setRelayStateLoaded(false);
      if (isTauri()) {
        void Promise.all([
          invoke<Provider[]>("list_all_providers"),
          invoke<Provider | null>("get_current_provider", { appType: appId }),
        ]).then(([all, current]) => {
          setExistingNames(all.map((provider) => provider.name));
          setCurrentName(current?.name ?? null);
          setRelayStateLoaded(true);
        }).catch((error) => onError(String(error)));
      }
    }
  }, [open, appId]);

  // 选预设 → 预填并进入表单;自定义 → 空表单(可用搜索词作名称种子)
  const pick = (p: ProviderPreset | null, nameSeed?: string) => {
    setPreset(p);
    setStep("form");
    setName(p?.requiresBaseUrl ? relayFormState(existingNames, "").name : p?.name ?? nameSeed ?? "");
    setBaseUrl(p?.baseUrl ?? "");
    setApiKey("");
    setUrlError(null);
    setRelayConfirmed(false);
    setRelayDuplicate(false);
    // 预填后焦点落到 API Key;自定义则从名称开始
    requestAnimationFrame(() => {
      if (p && !p.requiresBaseUrl) keyInputRef.current?.focus();
    });
  };

  // 表单返回重选:回到第一步并清空表单(搜索词保留,方便换词再找)
  const back = () => {
    setPreset(null);
    setStep("pick");
    setName("");
    setBaseUrl("");
    setApiKey("");
    setUrlError(null);
  };

  // 扁平预设列表:用户拖拽过的名称优先,其余按默认顺序追加
  const presets = useMemo(() => {
    const list = providerPresets[appId] ?? [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (p) =>
            p.name.toLowerCase().includes(q) || p.baseUrl.toLowerCase().includes(q),
        )
      : list;
    const savedOrder = presetOrders[appId] ?? [];
    const byName = new Map(
      list.map((p) => [p.name, p] as const),
    );
    const orderedNames = savedOrder.filter((n) => byName.has(n));
    for (const p of list) if (!orderedNames.includes(p.name)) orderedNames.push(p.name);
    return filtered.slice().sort(
      (a, b) => orderedNames.indexOf(a.name) - orderedNames.indexOf(b.name),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, search, presetOrders]);

  const urlValid = urlError === null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = preset?.requiresBaseUrl && !isValidRelayBase(baseUrl.trim(), import.meta.env.DEV)
      ? t("relay.invalidBase") : validateUrl(baseUrl, t);
    setUrlError(err);
    if (name.trim() === "" || baseUrl.trim() === "" || err) return;
    if (preset?.requiresBaseUrl && (!relayStateLoaded || !apiKey.trim() || !relayConfirmed)) return;
    if (submitting) return;
    setSubmitting(true);
    try {
      if (preset?.requiresBaseUrl) {
        const [all, current] = await Promise.all([
          invoke<Provider[]>("list_all_providers"),
          invoke<Provider | null>("get_current_provider", { appType: appId }),
        ]);
        if ((current?.name ?? null) !== currentName) {
          setCurrentName(current?.name ?? null);
          setRelayConfirmed(false);
          return;
        }
        if (all.some((provider) => provider.name.trim().toLowerCase() === name.trim().toLowerCase())) {
          setRelayDuplicate(true);
          setRelayConfirmed(false);
          setExistingNames(all.map((provider) => provider.name));
          setName(relayFormState(all.map((provider) => provider.name), apiKey).name);
          return;
        }
      }
      const created = await invoke<Provider>(preset?.requiresBaseUrl ? "create_relay_provider" : "create_provider", {
        input: {
          app_type: appId,
          name: name.trim(),
          base_url: preset?.requiresBaseUrl
            ? relayEndpointForApp({ baseUrl: baseUrl.trim(), app: appId }) : baseUrl.trim(),
          models: preset?.models ?? [],
          api_key: apiKey.trim() || undefined,
        },
      });
      onCreated(created, Boolean(preset?.requiresBaseUrl));
      onOpenChange(false);
    } catch (err) {
      onError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        {step === "pick" ? (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("dialog.addTitle")}</DialogTitle>
              <DialogDescription>{t("preset.pickDesc")}</DialogDescription>
            </DialogHeader>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("preset.searchPh")}
                className="pl-8"
                autoFocus
              />
            </div>

            <div className="grid gap-1.5">
              <div className="grid gap-1.5 max-h-[52vh] overflow-y-auto pr-1">
                {presets.map((p) => (
                  <div
                    key={p.name}
                    draggable={!search.trim()}
                    onDragStart={() => setDragPreset(p.name)}
                    onDragEnd={() => { setDragPreset(null); setDragOverPreset(null); }}
                    onDragOver={(e) => {
                      if (dragPreset) { e.preventDefault(); setDragOverPreset(p.name); }
                    }}
                    onDragLeave={() => setDragOverPreset(null)}
                    onDrop={(e) => {
                      e.stopPropagation();
                      dropPreset(p.name);
                    }}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                      !search.trim() && "cursor-grab active:cursor-grabbing",
                      dragOverPreset === p.name && dragPreset !== null && dragPreset !== p.name &&
                        "border-blue-500/60 ring-1 ring-blue-500/40",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => pick(p)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left text-sm"
                    >
                      <ProviderIcon
                        icon={p.icon ?? ""}
                        name={p.name}
                        size={18}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{p.name}</span>
                          {p.partner && (
                            <span className="shrink-0 rounded bg-amber-500/15 px-1 py-px text-[10px] font-medium text-amber-600 dark:text-amber-400">
                              {t("preset.badge.partner")}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {p.requiresBaseUrl ? t("relay.presetDesc") : p.baseUrl}
                        </span>
                      </span>
                    </button>
                    {p.apiKeyUrl && (
                      <a
                        href={p.apiKeyUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={t("preset.getKey")}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isTauri()) return;
                          // Tauri WebView 拦截新窗口,必须走 opener 插件才能真正打开
                          e.preventDefault();
                          void openUrl(p.apiKeyUrl!).catch(() => {});
                        }}
                        className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                ))}

                {presets.length === 0 && (
                  <p className="py-3 text-center text-xs text-muted-foreground">
                    {t("preset.noMatch")}
                  </p>
                )}
              </div>

              {/* 自定义:固定在滚动区外,预设再多也始终可见 */}
              <button
                type="button"
                onClick={() => pick(null, search.trim())}
                className="flex items-center rounded-md border border-dashed px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Plus className="w-4 h-4 mr-2" />
                {t("preset.customItem")}
              </button>
              <a
                href={PROVIDER_SUBMISSION_URL}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  if (!isTauri()) return;
                  e.preventDefault();
                  void openUrl(PROVIDER_SUBMISSION_URL).catch(() => {});
                }}
                className="rounded-md px-3 py-1 text-center text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline"
              >
                {t("preset.submitProvider")}
              </a>
              <p className="text-center text-[11px] text-muted-foreground">
                {t("preset.submitProviderHint")}
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("dialog.addTitle")}</DialogTitle>
              <DialogDescription>
                {preset
                  ? preset.requiresBaseUrl ? t("relay.presetDesc") : t("preset.formDesc", { name: preset.name })
                  : t("dialog.addDesc")}
              </DialogDescription>
            </DialogHeader>

            {/* 来源 + 返回重选:预设和自定义都能无损回到第一步 */}
            <div className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm",
              preset ? "bg-accent" : "border border-dashed border-border",
            )}>
              {preset ? (
                <ProviderIcon
                  icon={preset.icon ?? ""}
                  name={preset.name}
                  size={16}
                />
              ) : (
                <Plus className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate font-medium">
                {preset?.name ?? t("preset.customItem")}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={back}
                className="h-7 px-2 text-xs"
              >
                <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                {t("preset.repick")}
              </Button>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="provider-name">{t("dialog.name")}</Label>
              <Input
                id="provider-name"
                value={name}
                onChange={(e) => { setName(e.target.value); setRelayDuplicate(false); setRelayConfirmed(false); }}
                placeholder={t("dialog.namePh")}
                autoFocus={!preset}
              />
              {relayDuplicate && <p className="text-xs text-red-500">{t("relay.duplicateName")}</p>}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="provider-url">{t("dialog.url")}</Label>
              <Input
                id="provider-url"
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  if (preset?.requiresBaseUrl) setRelayConfirmed(false);
                  if (urlError) setUrlError(validateUrl(e.target.value, t));
                }}
                onBlur={() => setUrlError(preset?.requiresBaseUrl && !isValidRelayBase(baseUrl.trim(), import.meta.env.DEV)
                  ? t("relay.invalidBase") : validateUrl(baseUrl, t))}
                placeholder={t("dialog.urlPh")}
                aria-invalid={!urlValid}
                className={!urlValid ? "border-red-500 focus-visible:ring-red-500" : ""}
              />
              {urlError && (
                <p className="text-xs text-red-500">{urlError}</p>
              )}
              {preset?.requiresBaseUrl && baseUrl.trim() && isValidRelayBase(baseUrl.trim(), import.meta.env.DEV) && (
                <p className="break-all text-xs text-muted-foreground">
                  {t("relay.savedEndpoint", { url: relayEndpointForApp({ baseUrl: baseUrl.trim(), app: appId }) })}
                </p>
              )}
              {preset?.models && preset.models.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("preset.modelsHint")}: {preset.models.join(" · ")}
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="provider-key">{t("dialog.key")}</Label>
                {preset?.apiKeyUrl && (
                  <a
                    href={preset.apiKeyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-500 hover:underline"
                    onClick={(e) => {
                      if (!isTauri()) return;
                      e.preventDefault();
                      void openUrl(preset.apiKeyUrl!).catch(() => {});
                    }}
                  >
                    {t("preset.getKey")}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              <PasswordInput
                ref={keyInputRef}
                id="provider-key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={t("dialog.keyPh")}
              />
            </div>

            {preset?.requiresBaseUrl && (
              <div className="grid gap-2 text-xs text-muted-foreground">
                <p>{currentName ? t("relay.currentKept", { name: currentName }) : t("relay.firstActive")}</p>
                <p>{t("relay.noTakeover")}</p>
                <label className="flex items-start gap-2 text-foreground">
                  <input type="checkbox" className="mt-0.5" checked={relayConfirmed} onChange={(e) => setRelayConfirmed(e.target.checked)} />
                  <span>{t("relay.confirm")}</span>
                </label>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={
                  submitting || name.trim() === "" || baseUrl.trim() === "" || !urlValid
                    || (preset?.requiresBaseUrl && (!relayStateLoaded || !isValidRelayBase(baseUrl.trim(), import.meta.env.DEV) || !apiKey.trim() || !relayConfirmed))
                }
              >
                <Plus className="w-4 h-4 mr-1" />
                {submitting ? t("dialog.adding") : t("common.add")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
