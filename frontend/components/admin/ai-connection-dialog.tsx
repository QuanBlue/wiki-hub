"use client";

import { Check, CircleAlert, CloudDownload, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { api } from "@/lib/api-client";
import type { AiConnection, AiModelInfo, AiTestResult } from "@/lib/admin-ai";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

type Check =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; models: AiModelInfo[] }
  | { state: "error"; message: string };

/**
 * Add or edit one connection. Leaving the address or key field checks the
 * connection by itself and lists the models the endpoint offers, so the model
 * is picked rather than typed. When editing, a blank key keeps the saved one.
 */
export function AiConnectionDialog({
  open,
  onOpenChange,
  target,
  isFirst = false,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` adds a new connection. */
  target: AiConnection | null;
  /** Nothing is saved yet: the new connection becomes active by itself. */
  isFirst?: boolean;
  onSaved: (connection: AiConnection) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        // Radix would focus the first tabbable thing, which is now a field's
        // info button - opening its tooltip before anyone hovered anything.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById("ai-name")?.focus();
        }}
        title={target ? t("adminAi.dialogEditTitle") : t("adminAi.dialogAddTitle")}
        description={t("adminAi.dialogDescription")}
      >
        {/* Mounted only while open, so every opening starts from a clean form. */}
        <ConnectionForm
          target={target}
          isFirst={isFirst}
          onCancel={() => onOpenChange(false)}
          onSaved={(connection) => {
            onSaved(connection);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ConnectionForm({
  target,
  isFirst,
  onCancel,
  onSaved,
}: {
  target: AiConnection | null;
  isFirst: boolean;
  onCancel: () => void;
  onSaved: (connection: AiConnection) => void;
}) {
  const { t, apiErrorText } = useTranslation();
  const [name, setName] = useState(target?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(target?.base_url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(target?.model ?? "");
  const [activate, setActivate] = useState(false);
  // Editing checks the saved connection as soon as the form opens (see below).
  const [check, setCheck] = useState<Check>(target ? { state: "loading" } : { state: "idle" });
  const [saving, setSaving] = useState(false);
  // The last address+key checked, so leaving a field unchanged does not ask
  // the endpoint again; and a counter so a slow, stale answer never wins.
  const lastChecked = useRef("");
  const requestId = useRef(0);

  const hasKey = Boolean(apiKey) || target !== null;

  async function runCheck(address: string, key: string) {
    lastChecked.current = `${address}
${key}`;
    const id = ++requestId.current;
    try {
      const result = await api.post<AiTestResult>("/api/v1/ai/connections/test", {
        base_url: address,
        api_key: key,
        connection_id: target?.id ?? null,
      });
      if (id !== requestId.current) return;
      setCheck(
        result.ok
          ? { state: "ok", models: result.models }
          : { state: "error", message: result.error ?? t("adminAi.checkFailed") },
      );
    } catch (error) {
      if (id !== requestId.current) return;
      setCheck({ state: "error", message: apiErrorText(error, "adminAi.checkFailed") });
    }
  }

  function fetchModels(force: boolean) {
    const address = baseUrl.trim();
    if (!address || !hasKey) return;
    if (!force && `${address}
${apiKey}` === lastChecked.current) return;
    setCheck({ state: "loading" });
    void runCheck(address, apiKey);
  }

  // A new address or key invalidates the last check: saving needs a fresh one.
  function connectionChanged() {
    requestId.current += 1;
    lastChecked.current = "";
    setCheck({ state: "idle" });
  }

  useEffect(() => {
    if (!target) return;
    const timer = setTimeout(() => void runCheck(target.base_url.trim(), ""), 0);
    return () => clearTimeout(timer);
    // Only when the form opens; later checks follow the fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = target
        ? await api.patch<AiConnection>(`/api/v1/ai/connections/${target.id}`, {
            name,
            base_url: baseUrl,
            model,
            ...(apiKey ? { api_key: apiKey } : {}),
          })
        : await api.post<AiConnection>("/api/v1/ai/connections", {
            name,
            base_url: baseUrl,
            model,
            api_key: apiKey,
            activate,
          });
      toast.success(t(target ? "adminAi.updated" : "adminAi.added"));
      onSaved(saved);
    } catch (error) {
      toast.error(apiErrorText(error, "adminAi.saveError"));
    } finally {
      setSaving(false);
    }
  }

  // Saving needs a connection that checked out and a model picked from the
  // list it offered - the model is never typed by hand.
  const modelChosen =
    check.state === "ok" && check.models.some((candidate) => candidate.id === model);
  // Embedding models belong to Semantic search, not to the chat model list.
  const chatModels = check.state === "ok" ? check.models.filter((m) => !m.embedding) : [];
  const canSave = Boolean(name.trim() && baseUrl.trim() && modelChosen);

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <Label htmlFor="ai-name">{t("adminAi.nameLabel")}</Label>
          <InfoTip>{t("adminAi.nameHelp")}</InfoTip>
        </div>
        <Input
          id="ai-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("adminAi.namePlaceholder")}
          autoComplete="off"
          maxLength={120}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <Label htmlFor="ai-base-url">{t("adminAi.baseUrl")}</Label>
          <InfoTip>{t("adminAi.baseUrlHint")}</InfoTip>
        </div>
        <Input
          id="ai-base-url"
          value={baseUrl}
          onChange={(event) => {
            setBaseUrl(event.target.value);
            connectionChanged();
          }}
          onBlur={() => fetchModels(false)}
          placeholder="https://api.openai.com/v1"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1">
          <Label htmlFor="ai-api-key">{t("adminAi.apiKey")}</Label>
          <InfoTip>{t("adminAi.keyNote")}</InfoTip>
        </div>
        <PasswordInput
          id="ai-api-key"
          value={apiKey}
          onChange={(event) => {
            setApiKey(event.target.value);
            connectionChanged();
          }}
          onBlur={() => fetchModels(false)}
          placeholder={t("adminAi.apiKeyPlaceholder")}
          autoComplete="off"
        />
        {target ? (
          <p className="text-muted-foreground text-xs">
            {t("adminAi.apiKeyKeep", { preview: target.api_key_preview })}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <span className="flex items-center gap-1">
            <span id="ai-models-heading" className="text-sm leading-none font-medium">
              {t("adminAi.modelsHeading")}
            </span>
            <InfoTip>{t("adminAi.modelsHelp")}</InfoTip>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={check.state === "loading" || !baseUrl.trim() || !hasKey}
            onClick={() => fetchModels(true)}
          >
            {check.state === "loading" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <CloudDownload aria-hidden />
            )}
            {check.state === "loading" ? t("adminAi.fetching") : t("adminAi.fetchModels")}
          </Button>
        </div>

        <div aria-live="polite" className="text-sm">
          {check.state === "loading" ? (
            <p className="text-muted-foreground flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("adminAi.checking")}
            </p>
          ) : check.state === "error" ? (
            <p role="alert" className="text-danger flex items-start gap-2">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {check.message}
            </p>
          ) : check.state === "ok" ? (
            chatModels.length ? (
              <div className="space-y-2">
                <p className="text-success flex items-center gap-2">
                  <Check className="size-4" aria-hidden />
                  {t("adminAi.modelsFound", { count: chatModels.length })}
                </p>
                <div
                  role="radiogroup"
                  aria-labelledby="ai-models-heading"
                  className="border-border wh-scroll max-h-56 divide-y overflow-y-auto rounded-md border"
                >
                  {chatModels.map((candidate) => (
                    <ModelRow
                      key={candidate.id}
                      model={candidate}
                      selected={candidate.id === model}
                      onSelect={() => setModel(candidate.id)}
                    />
                  ))}
                </div>
                {model && !chatModels.some((candidate) => candidate.id === model) ? (
                  <p className="text-muted-foreground text-xs">
                    {t("adminAi.modelNotListed", { model })}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-muted-foreground">{t("adminAi.noModels")}</p>
            )
          ) : (
            <p className="text-muted-foreground border-border rounded-md border border-dashed px-3 py-4 text-center">
              {t("adminAi.modelsEmpty")}
            </p>
          )}
        </div>

      </div>

      {!target && !isFirst ? (
        <label className="hover:bg-surface-hover -mx-2 flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors duration-150">
          <input
            type="checkbox"
            checked={activate}
            onChange={(event) => setActivate(event.target.checked)}
            className="accent-primary focus-visible:ring-ring size-4 cursor-pointer focus-visible:ring-2 focus-visible:outline-none"
          />
          {t("adminAi.activateOnSave")}
        </label>
      ) : null}

      <DialogFooter className="items-center">
        {canSave ? null : (
          <p className="text-muted-foreground mr-auto text-xs">{t("adminAi.saveNeedsCheck")}</p>
        )}
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={saving || !canSave}>
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {saving ? t("adminAi.saving") : t("adminAi.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** One model the endpoint offers, on a single line: its id and what it can do. */
function ModelRow({
  model,
  selected,
  onSelect,
}: {
  model: AiModelInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <label
      title={model.name === model.id ? undefined : model.name}
      className={cn(
        "focus-within:ring-ring flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm transition-colors duration-150 focus-within:ring-2 focus-within:ring-inset",
        selected
          ? "bg-surface-selected text-primary"
          : "hover:bg-surface-hover active:bg-surface-selected",
      )}
    >
      <input
        type="radio"
        name="ai-model-choice"
        checked={selected}
        onChange={onSelect}
        aria-label={model.id}
        className="accent-primary size-4 shrink-0 cursor-pointer focus-visible:outline-none"
      />
      <span className={cn("min-w-0 flex-1 truncate font-mono text-xs", selected && "font-medium")}>
        {model.id}
      </span>
      {model.reasoning ? <Badge variant="info">{t("adminAi.reasoning")}</Badge> : null}
      {model.image ? <Badge variant="info">{t("adminAi.image")}</Badge> : null}
    </label>
  );
}
