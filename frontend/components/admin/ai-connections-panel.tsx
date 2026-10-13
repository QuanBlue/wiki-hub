"use client";

import { Loader2, Pencil, Plus, Power, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { AiConnectionDialog } from "@/components/admin/ai-connection-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDateTime } from "@/lib/admin-mail-ui";
import { api } from "@/lib/api-client";
import type {
  AiConnection,
  AiConnectionList,
  AiTestResult,
} from "@/lib/admin-ai";
import { useTranslation } from "@/lib/i18n/context";

/** Put React nodes where a translated sentence has `{name}`-style markers. */
function highlight(template: string, nodes: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/).map((part, index) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    return key && key in nodes ? <Fragment key={index}>{nodes[key]}</Fragment> : part;
  });
}

/**
 * The gateways the AI assistant can use, as a table. Any number can be saved
 * but only one is active at a time: activating one switches the previous one
 * off, and the server enforces it too. New connections are added in a dialog.
 */
export function AiConnectionsPanel({ initial }: { initial: AiConnectionList }) {
  const { t, locale, apiErrorText } = useTranslation();
  const [items, setItems] = useState(initial.items);
  const [formTarget, setFormTarget] = useState<AiConnection | "new" | null>(null);
  const [removeTarget, setRemoveTarget] = useState<AiConnection | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const active = items.find((item) => item.is_active) ?? null;

  function replace(updated: AiConnection) {
    setItems((current) =>
      current.map((item) =>
        item.id === updated.id
          ? updated
          : // Only one connection may be active.
            updated.is_active
            ? { ...item, is_active: false }
            : item,
      ),
    );
  }

  function saved(connection: AiConnection) {
    setItems((current) => {
      const exists = current.some((item) => item.id === connection.id);
      // Whichever connection is active after saving is the only one.
      const base = connection.is_active
        ? current.map((item) => ({ ...item, is_active: false }))
        : current;
      return exists
        ? base.map((item) => (item.id === connection.id ? connection : item))
        : [...base, connection];
    });
  }

  async function toggleActive(connection: AiConnection) {
    setBusyId(connection.id);
    try {
      const updated = await api.post<AiConnection>(
        `/api/v1/ai/connections/${connection.id}/${connection.is_active ? "deactivate" : "activate"}`,
      );
      replace(updated);
      toast.success(
        t(updated.is_active ? "adminAi.activated" : "adminAi.deactivated", {
          name: updated.name,
        }),
      );
    } catch (error) {
      toast.error(apiErrorText(error, "adminAi.actionError"));
    } finally {
      setBusyId(null);
    }
  }

  async function checkNow(connection: AiConnection) {
    setBusyId(connection.id);
    try {
      const result = await api.post<AiTestResult>(
        `/api/v1/ai/connections/${connection.id}/check`,
      );
      if (result.ok) toast.success(t("adminAi.checkOk"));
      else toast.error(result.error ?? t("adminAi.checkFailed"));
      const fresh = await api.get<AiConnectionList>("/api/v1/ai/connections");
      setItems(fresh.items);
    } catch (error) {
      toast.error(apiErrorText(error, "adminAi.checkFailed"));
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await api.delete(`/api/v1/ai/connections/${removeTarget.id}`);
      setItems((current) => current.filter((item) => item.id !== removeTarget.id));
      toast.success(t("adminAi.removed"));
      setRemoveTarget(null);
    } catch (error) {
      toast.error(apiErrorText(error, "adminAi.actionError"));
    } finally {
      setRemoving(false);
    }
  }

  // The connection's name and model stand out in the sentence.
  const summary = active
    ? active.model
      ? highlight(t("adminAi.activeSummary", { name: "{name}", model: "{model}" }), {
          name: <strong className="text-foreground font-semibold">{active.name}</strong>,
          model: (
            <code className="bg-surface text-foreground border-border rounded border px-1.5 py-0.5 font-mono text-xs font-medium">
              {active.model}
            </code>
          ),
        })
      : highlight(t("adminAi.activeNoModel", { name: "{name}" }), {
          name: <strong className="text-foreground font-semibold">{active.name}</strong>,
        })
    : t("adminAi.noneActive");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{t("adminAi.keysHeading")}</h3>
          <p className="text-muted-foreground mt-0.5 text-sm">{t("adminAi.keysDescription")}</p>
        </div>
        <Button variant="primary" onClick={() => setFormTarget("new")}>
          <Plus aria-hidden />
          {t("adminAi.add")}
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="border-border bg-surface rounded-xl border p-10 text-center">
          <Sparkles aria-hidden className="text-muted-foreground mx-auto size-8" />
          <p className="mt-3 font-semibold">{t("adminAi.emptyTitle")}</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            {t("adminAi.emptyBody")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="border-border bg-surface-sunken flex items-start gap-2.5 rounded-xl border px-4 py-3">
            <Sparkles aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <p className="text-muted-foreground text-sm">{summary}</p>
          </div>

          {items.length ? (
            <div className="border-border bg-surface overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left text-xs">
                    <th className="px-4 py-2 font-medium">{t("adminAi.colName")}</th>
                    <th className="px-4 py-2 font-medium">{t("adminAi.colEndpoint")}</th>
                    <th className="px-4 py-2 font-medium">{t("adminAi.colModel")}</th>
                    <th className="px-4 py-2 font-medium">{t("adminAi.colKey")}</th>
                    <th className="px-4 py-2 font-medium">{t("adminAi.colStatus")}</th>
                    <th className="px-4 py-2 font-medium">{t("adminAi.colChecked")}</th>
                    <th className="px-4 py-2 text-right font-medium">
                      {t("adminAi.colActions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((connection) => {
                    const busy = busyId === connection.id;
                    return (
                      <tr
                        key={connection.id}
                        className="border-border hover:bg-surface-hover border-b transition-colors duration-150 last:border-b-0"
                      >
                        <td className="px-4 py-2">
                          <div className="font-medium">{connection.name}</div>
                        </td>
                        <td className="text-muted-foreground px-4 py-2 text-xs">
                          <span className="break-all">{connection.base_url}</span>
                        </td>
                        <td className="px-4 py-2">
                          {connection.model ? (
                            <code
                              className={
                                connection.is_active
                                  ? "text-foreground font-mono text-xs font-medium"
                                  : "text-muted-foreground font-mono text-xs"
                              }
                            >
                              {connection.model}
                            </code>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              {t("adminAi.noModel")}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <code className="font-mono text-xs">{connection.api_key_preview}</code>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            <Badge variant={connection.is_active ? "success" : "neutral"}>
                              {connection.is_active
                                ? t("adminAi.active")
                                : t("adminAi.inactive")}
                            </Badge>
                            {connection.last_check_ok === null ? null : (
                              <Badge
                                variant={connection.last_check_ok ? "info" : "danger"}
                              >
                                {connection.last_check_ok
                                  ? t("adminAi.working")
                                  : t("adminAi.failed")}
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="text-muted-foreground px-4 py-2 text-xs whitespace-nowrap">
                          {connection.last_checked_at
                            ? formatDateTime(connection.last_checked_at, locale)
                            : t("adminAi.neverChecked")}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex justify-end gap-0.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={busy}
                              onClick={() => void checkNow(connection)}
                              aria-label={t("adminAi.checkNow")}
                              title={t("adminAi.checkNow")}
                            >
                              {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => setFormTarget(connection)}
                              aria-label={t("adminAi.edit")}
                              title={t("adminAi.edit")}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={busy}
                              onClick={() => void toggleActive(connection)}
                              aria-pressed={connection.is_active}
                              aria-label={
                                connection.is_active
                                  ? t("adminAi.deactivate")
                                  : t("adminAi.activate")
                              }
                              title={
                                connection.is_active
                                  ? t("adminAi.deactivate")
                                  : t("adminAi.activate")
                              }
                              className={
                                connection.is_active
                                  ? "text-success hover:text-success"
                                  : undefined
                              }
                            >
                              <Power />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => setRemoveTarget(connection)}
                              aria-label={t("adminAi.remove")}
                              title={t("adminAi.remove")}
                              className="text-danger hover:bg-danger-bg hover:text-danger active:bg-danger-bg/85"
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}

      <AiConnectionDialog
        open={formTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFormTarget(null);
        }}
        target={formTarget === "new" ? null : formTarget}
        isFirst={items.length === 0}
        onSaved={saved}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title={t("adminAi.removeTitle")}
        description={
          removeTarget
            ? t(removeTarget.is_active ? "adminAi.removeActiveBody" : "adminAi.removeBody", {
                name: removeTarget.name,
              })
            : ""
        }
        confirmLabel={t("adminAi.remove")}
        cancelLabel={t("common.cancel")}
        destructive
        pending={removing}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
