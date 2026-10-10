import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "@/i18n";
import { relayEndpointForApp, relayFormState, type RelayConnectRequest } from "@/lib/relayDeepLink";
import type { Provider } from "@/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [existingNames, setExistingNames] = useState<string[]>([]);
  const [currentName, setCurrentName] = useState<string | null>(null);
  const form = useMemo(() => relayFormState(existingNames, apiKey), [existingNames, apiKey]);

  useEffect(() => {
    setApiKey("");
    setConfirmed(false);
    setExistingNames(existingProviders.map((provider) => provider.name));
    setCurrentName(currentProvider?.name ?? null);
  }, [request, existingProviders, currentProvider]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const canSave = form.canSave || Boolean(request?.handoff);
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
      const fresh = relayFormState(latest.map((p) => p.name), apiKey);
      if (fresh.name !== form.name || (current?.name ?? null) !== currentName) {
        setExistingNames(latest.map((provider) => provider.name));
        setCurrentName(current?.name ?? null);
        setConfirmed(false);
        onError(t("relay.changedBeforeSave"));
        return;
      }
      const created = await invoke<Provider>("create_relay_provider", {
        input: {
          app_type: request.app,
          name: form.name,
          base_url: relayEndpointForApp(request),
          models: request.model ? [request.model] : [],
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
            <DialogTitle>{t("relay.connectTitle")}</DialogTitle>
            <DialogDescription>{t("relay.connectDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
            <span><strong>{t("dialog.name")}:</strong> {form.name}</span>
            <span><strong>{t("relay.cli")}:</strong> {request ? t(`app.${request.app}`) : ""}</span>
            <span className="break-all"><strong>{t("dialog.url")}:</strong> {request && relayEndpointForApp(request)}</span>
            {request?.model && <span className="break-all"><strong>{t("relay.model")}:</strong> {request.model}</span>}
          </div>
          {form.nameChanged && <p className="text-xs text-amber-600 dark:text-amber-400">{t("relay.nameChanged", { name: form.name })}</p>}
          <p className="text-xs text-muted-foreground">
            {currentName ? t("relay.currentKept", { name: currentName }) : t("relay.firstActive")}
          </p>
          <p className="text-xs text-muted-foreground">{t("relay.noTakeover")}</p>
          {request?.handoff ? (
            <p className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3 text-xs text-muted-foreground">
              {t("relay.handoffNotice")}
            </p>
          ) : (
            <label className="grid gap-1.5 text-sm font-medium">
              {t("relay.pasteKey")}
              <PasswordInput value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" required />
            </label>
          )}
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5" />
            <span>{t("relay.confirm")}</span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={!confirmed || (!form.canSave && !request?.handoff) || submitting || exchanging}>{exchanging ? t("relay.importing") : submitting ? t("dialog.adding") : t("relay.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
