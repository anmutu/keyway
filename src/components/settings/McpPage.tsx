import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Activity, Plug, Plus, RefreshCw, Server, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

interface McpServer {
  id: string;
  name: string;
  config: {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    type?: string;
    url?: string;
  };
  apps: string[];
  enabled: boolean;
  created_at: number;
}

const TARGET_APPS = [
  { key: "claude", label: "Claude Code" },
  { key: "codex", label: "Codex" },
];
const IS_DEMO = new URLSearchParams(location.search).has("demo");
const DEMO_SERVERS: McpServer[] = [
  {
    id: "context7",
    name: "Context7",
    config: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
    apps: ["claude", "codex"],
    enabled: true,
    created_at: 0,
  },
  {
    id: "browser-tools",
    name: "Browser Tools",
    config: { type: "http", url: "http://127.0.0.1:3000/mcp" },
    apps: ["claude"],
    enabled: false,
    created_at: 0,
  },
];

/** MCP 统一管理:一处定义,同步写入各 CLI 配置(Claude ~/.claude.json / Codex config.toml)。 */
export function McpPage({
  onError,
  onSuccess,
}: {
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [testing, setTesting] = useState<string | null>(null);

  const test = async (id: string) => {
    setTesting(id);
    try {
      if (IS_DEMO) {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        onSuccess(t("mcp.testOk"));
        return;
      }
      const msg = await invoke<string>("test_mcp_server", { id });
      onSuccess(msg);
    } catch (e) {
      onError(String(e));
    } finally {
      setTesting(null);
    }
  };
  const [servers, setServers] = useState<McpServer[]>([]);
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<McpServer | null>(null);
  const reloadId = useRef(0);

  const reload = useCallback(() => {
    const currentRequest = ++reloadId.current;
    if (IS_DEMO) {
      setServers(DEMO_SERVERS.map((s) => ({ ...s, config: { ...s.config }, apps: [...s.apps] })));
      return;
    }
    invoke<McpServer[]>("list_mcp_servers")
      .then((result) => {
        if (reloadId.current === currentRequest) setServers(result);
      })
      .catch(() => {
        if (reloadId.current === currentRequest) setServers([]);
      });
  }, []);

  useEffect(() => {
    reload();
    return () => {
      reloadId.current += 1;
    };
  }, [reload]);

  const save = (s: McpServer) => {
    if (saving) return;
    if (IS_DEMO) {
      setServers((current) => {
        const next = current.filter((item) => item.id !== s.id);
        return [...next, s];
      });
      onSuccess(t("mcp.saved"));
      setEditing(null);
      return;
    }
    setSaving(true);
    invoke("save_mcp_server", { server: s })
      .then(() => {
        setEditing(null);
        reload();
        onSuccess(t("mcp.saved"));
      })
      .catch((e) => onError(String(e)))
      .finally(() => setSaving(false));
  };

  const toggle = (s: McpServer, enabled: boolean) => {
    if (IS_DEMO) {
      setServers((current) => current.map((item) => item.id === s.id ? { ...item, enabled } : item));
      return;
    }
    invoke("set_mcp_server_enabled", { id: s.id, enabled })
      .then(reload)
      .catch((e) => onError(String(e)));
  };

  const remove = (s: McpServer) => {
    if (IS_DEMO) {
      setServers((current) => current.filter((item) => item.id !== s.id));
      onSuccess(t("mcp.deleted"));
      return;
    }
    invoke("delete_mcp_server", { id: s.id })
      .then(() => {
        reload();
        onSuccess(t("mcp.deleted"));
      })
      .catch((e) => onError(String(e)));
  };

  const syncNow = () => {
    if (IS_DEMO) {
      onSuccess(t("mcp.demoSynced"));
      return;
    }
    setSyncing(true);
    invoke<string[]>("sync_mcp_servers")
      .then((report) => onSuccess(report.join("; ") || t("mcp.noTarget")))
      .catch((e) => onError(String(e)))
      .finally(() => setSyncing(false));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-start sm:gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Plug className="w-5 h-5 text-blue-500" />
            {t("mcp.title")}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">{t("mcp.desc")}</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
          <Button variant="outline" size="sm" onClick={syncNow} disabled={syncing}>
            <RefreshCw className={cn("w-4 h-4 mr-1", syncing && "animate-spin")} />
            {t("mcp.sync")}
          </Button>
          <Button size="sm" onClick={() => setEditing(newServer())}>
            <Plus className="w-4 h-4 mr-1" />
            {t("common.add")}
          </Button>
        </div>
      </div>

      {servers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t("mcp.empty")}
        </div>
      ) : (
        <div className="space-y-2">
          {servers.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <Server className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{s.name}</span>
                  <code className="text-xs text-muted-foreground">{s.id}</code>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {s.config.url
                    ? `${s.config.type ?? "http"} · ${s.config.url}`
                    : [s.config.command, ...(s.config.args ?? [])].join(" ")}
                  {" → "}
                  {s.apps
                    .map((a) => TARGET_APPS.find((t2) => t2.key === a)?.label ?? a)
                    .join(", ")}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-8 px-2 text-muted-foreground hover:text-foreground"
                disabled={testing === s.id}
                onClick={() => void test(s.id)}
                title={t("mcp.test")}
                aria-label={`${t("mcp.test")}: ${s.name}`}
              >
                <Activity className={"w-4 h-4 " + (testing === s.id ? "animate-pulse" : "")} />
              </Button>
              <Switch
                checked={s.enabled}
                onCheckedChange={(v) => toggle(s, v)}
                aria-label={t(s.enabled ? "mcp.disable" : "mcp.enable", { name: s.name })}
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-muted-foreground hover:text-foreground"
                onClick={() => setEditing({ ...s, config: { ...s.config } })}
              >
                {t("common.edit")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-muted-foreground hover:text-destructive"
                onClick={() => setPendingDelete(s)}
                aria-label={`${t("common.delete")}: ${s.name}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!pendingDelete}
        title={t("mcp.deleteTitle")}
        message={t("mcp.deleteConfirm", { name: pendingDelete?.name ?? "" })}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) remove(target);
        }}
        onCancel={() => setPendingDelete(null)}
      />

      <McpEditDialog
        server={editing}
        saving={saving}
        onClose={() => { if (!saving) setEditing(null); }}
        onSave={save}
        exists={servers.some((x) => x.id === editing?.id)}
      />
    </div>
  );
}

function newServer(): McpServer {
  return {
    id: "",
    name: "",
    config: { command: "", args: [] },
    apps: ["claude"],
    enabled: true,
    created_at: 0,
  };
}

function McpEditDialog({
  server,
  onClose,
  onSave,
  exists,
  saving,
}: {
  server: McpServer | null;
  onClose: () => void;
  onSave: (s: McpServer) => void;
  exists: boolean;
  saving: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<McpServer | null>(server);
  useEffect(() => setDraft(server), [server]);
  if (!draft) return null;

  const set = (patch: Partial<McpServer>) => setDraft({ ...draft, ...patch });
  const isRemote = draft.config.type === "http" || draft.config.type === "sse" || draft.config.url !== undefined;
  const envText = Object.entries(draft.config.env ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const parseEnv = (text: string) => {
    const env: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return env;
  };

  const submit = () => {
    onSave({
      ...draft,
      name: draft.name.trim() || draft.id.trim(),
      config: isRemote
        ? { type: draft.config.type ?? "http", url: draft.config.url }
        : {
            command: draft.config.command?.trim(),
            args: [...(draft.config.args ?? [])],
            env: draft.config.env,
          },
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{exists ? t("mcp.edit") : t("mcp.add")}</DialogTitle>
        </DialogHeader>
        <fieldset disabled={saving} className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mcp-server-id">{t("mcp.fId")}</Label>
              <Input
                id="mcp-server-id"
                value={draft.id}
                disabled={exists}
                placeholder="filesystem"
                onChange={(e) => set({ id: e.target.value })}
              />
              <p className="text-[11px] text-muted-foreground">{t("mcp.fIdHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mcp-server-name">{t("mcp.fName")}</Label>
              <Input
                id="mcp-server-name"
                value={draft.name}
                placeholder={t("mcp.fNamePh")}
                onChange={(e) => set({ name: e.target.value })}
              />
            </div>
          </div>

          <div className="flex gap-2 text-sm">
            <button
              type="button"
              className={cn(
                "rounded-md border px-3 py-1.5",
                !isRemote ? "border-blue-500 text-blue-600" : "border-border text-muted-foreground",
              )}
              aria-pressed={!isRemote}
              onClick={() => set({ config: { command: "", args: [] } })}
            >
              stdio
            </button>
            <button
              type="button"
              className={cn(
                "rounded-md border px-3 py-1.5",
                isRemote ? "border-blue-500 text-blue-600" : "border-border text-muted-foreground",
              )}
              aria-pressed={isRemote}
              onClick={() => set({ config: { type: "http", url: "" } })}
            >
              http / sse
            </button>
          </div>

          {isRemote ? (
            <div className="space-y-1.5">
              <Label htmlFor="mcp-server-url">URL</Label>
              <Input
                id="mcp-server-url"
                value={draft.config.url ?? ""}
                placeholder="https://mcp.example.com/sse"
                onChange={(e) =>
                  set({ config: { ...draft.config, url: e.target.value } })
                }
              />
              <p className="text-[11px] text-muted-foreground">{t("mcp.remoteHint")}</p>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-server-command">{t("mcp.fCommand")}</Label>
                <Input
                  id="mcp-server-command"
                  value={draft.config.command ?? ""}
                  placeholder="npx"
                  onChange={(e) =>
                    set({ config: { ...draft.config, command: e.target.value } })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("mcp.fArgs")}</Label>
                <div className="space-y-2">
                  {(draft.config.args ?? []).map((argument, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <span aria-hidden="true" className="w-5 shrink-0 pt-2 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                      <textarea
                        rows={1}
                        value={argument}
                        aria-label={t("mcp.argument", { n: index + 1 })}
                        placeholder={t("mcp.emptyArgument")}
                        spellCheck={false}
                        className="min-w-0 flex-1 resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                        onChange={(event) => set({ config: { ...draft.config, args: draft.config.args?.map((value, argumentIndex) => argumentIndex === index ? event.target.value : value) } })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("mcp.removeArgument", { n: index + 1 })}
                        onClick={() => set({ config: { ...draft.config, args: draft.config.args?.filter((_, argumentIndex) => argumentIndex !== index) } })}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={() => set({ config: { ...draft.config, args: [...(draft.config.args ?? []), ""] } })}>
                    <Plus className="h-3.5 w-3.5" />
                    {t("mcp.addArgument")}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">{t("mcp.fArgsHint")}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-server-env">{t("mcp.fEnv")}</Label>
                <textarea
                  id="mcp-server-env"
                  value={envText}
                  placeholder={"API_TOKEN=xxx\nDEBUG=1"}
                  onChange={(e) =>
                    set({ config: { ...draft.config, env: parseEnv(e.target.value) } })
                  }
                  className="w-full min-h-[56px] rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">{t("mcp.fEnvHint")}</p>
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label>{t("mcp.fApps")}</Label>
            <div className="flex gap-3">
              {TARGET_APPS.map((a) => {
                const on = draft.apps.includes(a.key);
                return (
                  <button
                    key={a.key}
                    type="button"
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-sm",
                      on
                        ? "border-blue-500 text-blue-600"
                        : "border-border text-muted-foreground",
                    )}
                    aria-pressed={on}
                    onClick={() =>
                      set({
                        apps: on
                          ? draft.apps.filter((k) => k !== a.key)
                          : [...draft.apps, a.key],
                      })
                    }
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>
          </div>
        </fieldset>

        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            <X className="w-4 h-4 mr-1" />
            {t("common.cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={
              saving ||
              !draft.id.trim() ||
              (isRemote ? !draft.config.url?.trim() : !draft.config.command?.trim()) ||
              draft.apps.length === 0
            }
          >
            {saving ? t("dialog.saving") : t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
