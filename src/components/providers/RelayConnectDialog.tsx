import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "@/i18n";
import { relayEndpointForApp, suggestRelayName, type RelayConnectRequest } from "@/lib/relayDeepLink";
import type { Provider } from "@/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/PasswordInput";

interface Props {
  request: RelayConnectRequest | null;
  existingProviders: Provider[];
  currentProvider: Provider | undefined;
  onClose: () => void;
  onCreated: (provider: Provider, app: RelayConnectRequest["app"]) => void;
  onError: (message: string) => void;
}

export function RelayConnectDialog({ request, existingProviders, currentProvider, onClose, onCreated, onError }: Props) {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState("");
  // 名称可编辑:预填建议名(同名时自动加序号),用户可改成能区分账号的名字
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [nameAdjusted, setNameAdjusted] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [existingNames, setExistingNames] = useState<string[]>([]);
  const [currentName, setCurrentName] = useState<string | null>(null);
  // The gateway brand comes from the deep link; fall back to a neutral name
  // when an older link does not carry one.
  const sourceName = request?.name ?? t("relay.defaultName");

  useEffect(() => {
    const suggestion = suggestRelayName(existingProviders.map((provider) => provider.name), sourceName);
    setName(suggestion.name);
    setNameAdjusted(suggestion.adjusted);
    setModel(request?.model ?? "");
    setApiKey("");
    setConfirmed(false);
    setExistingNames(existingProviders.map((provider) => provider.name));
    setCurrentName(currentProvider?.name ?? null);
  }, [request, existingProviders, currentProvider, sourceName]);

  const trimmedName = name.trim();
  // create_provider 对同名会合并(可能改写已有凭据),保存前必须挡住重名
  const nameTaken = trimmedName.length > 0
    && existingNames.some((existing) => existing.trim().toLowerCase() === trimmedName.toLowerCase());
  const canSave = trimmedName.length > 0 && !nameTaken
    && (apiKey.trim().length > 0 || Boolean(request?.handoff));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!request || !confirmed || !canSave || submitting || exchanging) return;
    setSubmitting(true);
    try {
      let key = apiKey.trim();
      if (request.handoff) {
        setExchanging(true);
        key = await invoke<string>("exchange_relay_handoff", {
          baseUrl: request.baseUrl,
          code: request.handoff,
        });
        setExchanging(false);
      }
      // Recheck just before writing: create_provider merges names and would alter existing credentials.
      const [latest, current] = await Promise.all([
        invoke<Provider[]>("list_all_providers"),
        invoke<Provider | null>("get_current_provider", { appType: request.app }),
      ]);
      if (latest.some((provider) => provider.name.trim().toLowerCase() === trimmedName.toLowerCase())) {
        setExistingNames(latest.map((provider) => provider.name));
        setConfirmed(false);
        onError(t("relay.duplicateName"));
        return;
      }
      if ((current?.name ?? null) !== currentName) {
        setExistingNames(latest.map((provider) => provider.name));
        setCurrentName(current?.name ?? null);
        setConfirmed(false);
        onError(t("relay.changedBeforeSave"));
        return;
      }
      const created = await invoke<Provider>("create_relay_provider", {
        input: {
          app_type: request.app,
          name: trimmedName,
          base_url: relayEndpointForApp(request),
          models: model.trim() ? [model.trim()] : [],
          api_key: key,
        },
      });
      onCreated(created, request.app);
      onClose();
    } catch (error) {
      setExchanging(false);
      onError(String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent className="sm:max-w-[460px]" closeDisabled={submitting}>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("relay.connectTitle", { name: sourceName })}</DialogTitle>
            <DialogDescription>{t("relay.connectDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
            <span><strong>{t("relay.cli")}:</strong> {request ? t(`app.${request.app}`) : ""}</span>
            <span className="break-all"><strong>{t("dialog.url")}:</strong> {request && relayEndpointForApp(request)}</span>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="relay-name">{t("dialog.name")}</Label>
            <Input
              id="relay-name"
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={nameTaken}
              className={nameTaken ? "border-red-500 focus-visible:ring-red-500" : ""}
            />
            {nameTaken ? (
              <p className="text-xs text-red-500">{t("relay.duplicateName")}</p>
            ) : nameAdjusted ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">{t("relay.nameChanged", { name: sourceName })}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t("relay.nameHint")}</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="relay-model">{t("relay.model")}</Label>
            <Input
              id="relay-model"
              value={model}
              maxLength={128}
              onChange={(event) => setModel(event.target.value)}
              placeholder={t("relay.modelPh")}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {currentName ? t("relay.currentKept", { name: currentName }) : t("relay.firstActive", { name: trimmedName || sourceName })}
          </p>
          <p className="text-xs text-muted-foreground">{t("relay.noTakeover")}</p>
          {request?.handoff ? (
            <p className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3 text-xs text-muted-foreground">
              {t("relay.handoffNotice", { name: sourceName })}
            </p>
          ) : (
            <label className="grid gap-1.5 text-sm font-medium">
              {t("relay.pasteKey", { name: sourceName })}
              <PasswordInput value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" required />
            </label>
          )}
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5" />
            <span>{t("relay.confirm")}</span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={!confirmed || !canSave || submitting || exchanging}>{exchanging ? t("relay.importing") : submitting ? t("dialog.adding") : t("relay.save", { name: trimmedName || sourceName })}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
