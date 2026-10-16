"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Loader2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { PaginationBar } from "@/components/admin/list-controls";
import { AiConnectionDialog } from "@/components/admin/ai-connection-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/lib/admin-mail-ui";
import { api } from "@/lib/api-client";
import type {
  AiConnection,
  AiConnectionList,
  AiTestResult,
} from "@/lib/admin-ai";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/** Put React nodes where a translated sentence has `{name}`-style markers. */
function highlight(
  template: string,
  nodes: Record<string, ReactNode>,
): ReactNode {
  return template.split(/(\{\w+\})/).map((part, index) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    return key && key in nodes ? (
      <Fragment key={index}>{nodes[key]}</Fragment>
    ) : (
      part
    );
  });
}

const PAGE_SIZES = [10, 25, 50];

type SortKey = "name" | "endpoint" | "model" | "status";
type Sort = { key: SortKey; dir: "asc" | "desc" } | null;
type StatusFilter =
  "all" | "active" | "inactive" | "working" | "failing" | "unchecked";
const STATUS_FILTERS: StatusFilter[] = [
  "all",
  "active",
  "inactive",
  "working",
  "failing",
  "unchecked",
];

/** Active first, then working, then not checked, then failing: what an admin looks for first. */
function statusRank(item: AiConnection): number {
  const check =
    item.last_check_ok === true ? 1 : item.last_check_ok === null ? 2 : 3;
  return (item.is_active ? 0 : 10) + check;
}

function matchesStatus(item: AiConnection, filter: StatusFilter): boolean {
  switch (filter) {
    case "active":
      return item.is_active;
    case "inactive":
      return !item.is_active;
    case "working":
      return item.last_check_ok === true;
    case "failing":
      return item.last_check_ok === false;
    case "unchecked":
      return item.last_check_ok === null;
    default:
      return true;
  }
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  hint,
}: {
  label: string;
  column: SortKey;
  sort: Sort;
  onSort: (column: SortKey) => void;
  hint: string;
}) {
  const current = sort?.key === column ? sort.dir : null;
  const Icon =
    current === "asc" ? ArrowUp : current === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <th
      className="px-4 py-2 font-medium"
      aria-sort={
        current === "asc"
          ? "ascending"
          : current === "desc"
            ? "descending"
            : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        title={hint}
        className={cn(
          "hover:text-foreground focus-visible:ring-ring -mx-1 inline-flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
          current && "text-foreground",
        )}
      >
        {label}
        <Icon className="size-3" aria-hidden />
      </button>
    </th>
  );
}

/** A model id in the table; a missing one shows `empty`, muted. */
function ModelName({
  active,
  empty,
  children,
}: {
  active: boolean;
  empty: string;
  children: string;
}) {
  return children ? (
    <code
      className={cn(
        "font-mono text-xs",
        active ? "text-foreground font-medium" : "text-muted-foreground",
      )}
    >
      {children.split(/(?<=[/-])/).map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <wbr /> : null}
          {part}
        </Fragment>
      ))}
    </code>
  ) : (
    <span className="text-muted-foreground text-xs">{empty}</span>
  );
}

/**
 * The gateways the AI assistant can use, as a table. Any number can be saved
 * but only one is active at a time: activating one switches the previous one
 * off, and the server enforces it too. New connections are added in a dialog.
 */
export function AiConnectionsPanel({ initial }: { initial: AiConnectionList }) {
  const { t, locale, apiErrorText } = useTranslation();
  const [items, setItems] = useState(initial.items);
  const [formTarget, setFormTarget] = useState<AiConnection | "new" | null>(
    null,
  );
  const [removeTarget, setRemoveTarget] = useState<AiConnection | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]!);
  const [offset, setOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [sort, setSort] = useState<Sort>(null);
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const active = items.find((item) => item.is_active) ?? null;
  const shown = items
    .filter((item) => {
      const needle = term.trim().toLowerCase();
      return (
        (!needle ||
          [item.name, item.base_url, item.model].some((value) =>
            value.toLowerCase().includes(needle),
          )) &&
        matchesStatus(item, status)
      );
    })
    .sort((a, b) => {
      if (!sort) return 0;
      const sign = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "status") return sign * (statusRank(a) - statusRank(b));
      const field = { name: "name", endpoint: "base_url", model: "model" }[
        sort.key
      ] as "name" | "base_url" | "model";
      return sign * a[field].localeCompare(b[field], locale, { numeric: true });
    });
  // Removing the last row of the last page must not leave an empty page behind.
  const firstRow = Math.min(
    offset,
    Math.max(0, (Math.ceil(shown.length / pageSize) - 1) * pageSize),
  );
  const visibleItems = shown.slice(firstRow, firstRow + pageSize);

  // First click sorts ascending, the second descending, the third goes back to the saved order.
  function toggleSort(key: SortKey) {
    setOffset(0);
    setSort((current) =>
      current?.key !== key
        ? { key, dir: "asc" }
        : current.dir === "asc"
          ? { key, dir: "desc" }
          : null,
    );
  }

  async function refresh() {
    setRefreshing(true);
    try {
      setItems(
        (await api.get<AiConnectionList>("/api/v1/ai/connections")).items,
      );
    } catch (error) {
      toast.error(apiErrorText(error, "adminAi.actionError"));
    } finally {
      setRefreshing(false);
    }
  }

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
      setItems((current) =>
        current.filter((item) => item.id !== removeTarget.id),
      );
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
      ? highlight(
          t("adminAi.activeSummary", { name: "{name}", model: "{model}" }),
          {
            name: (
              <strong className="text-foreground font-semibold">
                {active.name}
              </strong>
            ),
            model: (
              <code className="bg-surface text-foreground border-border rounded border px-1.5 py-0.5 font-mono text-xs font-medium">
                {active.model}
              </code>
            ),
          },
        )
      : highlight(t("adminAi.activeNoModel", { name: "{name}" }), {
          name: (
            <strong className="text-foreground font-semibold">
              {active.name}
            </strong>
          ),
        })
    : t("adminAi.noneActive");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">
            {t("adminAi.keysHeading")}
          </h3>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {t("adminAi.keysDescription")}
          </p>
        </div>
        <Button variant="primary" onClick={() => setFormTarget("new")}>
          <Plus aria-hidden />
          {t("adminAi.add")}
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="border-border bg-surface rounded-xl border p-10 text-center">
          <Sparkles
            aria-hidden
            className="text-muted-foreground mx-auto size-8"
          />
          <p className="mt-3 font-semibold">{t("adminAi.emptyTitle")}</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            {t("adminAi.emptyBody")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="border-border bg-surface-sunken rounded-xl border px-4 py-3">
            <div className="flex items-start gap-2.5">
              <Sparkles
                aria-hidden
                className="text-muted-foreground mt-0.5 size-4 shrink-0"
              />
              <p className="text-muted-foreground text-sm">{summary}</p>
            </div>
          </div>

          <div className="border-border bg-surface overflow-x-auto rounded-xl border">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <h4 className="text-sm font-semibold">
                  {t("adminAi.tableTitle")}
                </h4>
                <p className="text-muted-foreground text-xs">
                  {t("adminAi.tableHint")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search
                    aria-hidden
                    className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                  />
                  <Input
                    value={term}
                    onChange={(event) => {
                      setOffset(0);
                      setTerm(event.target.value);
                    }}
                    placeholder={t("adminAi.searchPlaceholder")}
                    aria-label={t("adminAi.searchPlaceholder")}
                    className="w-56 pl-8"
                    autoComplete="off"
                  />
                </div>
                <div className="min-w-36">
                  <Select
                    value={status}
                    onValueChange={(value) => {
                      setOffset(0);
                      setStatus(value as StatusFilter);
                    }}
                  >
                    <SelectTrigger
                      aria-label={t("adminAi.filterBy", {
                        column: t("adminAi.colStatus"),
                      })}
                    >
                      <SelectValue>
                        {status === "all"
                          ? t("adminAi.statusAll")
                          : t(`adminAi.statusFilter_${status}`)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="end">
                      {STATUS_FILTERS.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value === "all"
                            ? t("adminAi.statusAll")
                            : t(`adminAi.statusFilter_${value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => void refresh()}
                  disabled={refreshing}
                  aria-label={t("adminAi.refreshList")}
                  title={t("adminAi.refreshList")}
                >
                  {refreshing ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw aria-hidden />
                  )}
                </Button>
              </div>
            </div>
            <table className="border-border w-full border-t text-sm">
              <thead>
                <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left text-xs">
                  {(
                    [
                      ["name", "adminAi.colName"],
                      ["endpoint", "adminAi.colEndpoint"],
                      ["model", "adminAi.colModel"],
                      ["status", "adminAi.colStatus"],
                    ] as const
                  ).map(([key, label]) => (
                    <SortHeader
                      key={key}
                      column={key}
                      label={t(label)}
                      sort={sort}
                      onSort={toggleSort}
                      hint={t("adminAi.sortBy", { column: t(label) })}
                    />
                  ))}
                  <th className="px-4 py-2 text-right font-medium">
                    {t("adminAi.colActions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="text-muted-foreground px-4 py-8 text-center text-sm"
                    >
                      {t("adminAi.filterNone")}
                    </td>
                  </tr>
                ) : null}
                {visibleItems.map((connection) => {
                  const busy = busyId === connection.id;
                  return (
                    <tr
                      key={connection.id}
                      aria-current={connection.is_active ? "true" : undefined}
                      className={cn(
                        "border-border border-b transition-colors duration-150 last:border-b-0",
                        connection.is_active
                          ? "bg-surface-selected hover:bg-surface-selected"
                          : "hover:bg-surface-hover",
                      )}
                    >
                      <td
                        className={cn(
                          "px-4 py-2",
                          // A bar down the left edge marks the connection in use.
                          connection.is_active &&
                            "before:bg-primary relative before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
                        )}
                      >
                        <div className="font-medium">{connection.name}</div>
                        <code className="text-muted-foreground font-mono text-[11px]">
                          {connection.api_key_preview}
                        </code>
                      </td>
                      <td className="text-muted-foreground px-4 py-2 text-xs">
                        <span
                          className="block max-w-[13rem] truncate"
                          title={connection.base_url}
                        >
                          {connection.base_url}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <ModelName
                          active={connection.is_active}
                          empty={t("adminAi.noModel")}
                        >
                          {connection.model}
                        </ModelName>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          <Badge
                            variant={
                              connection.is_active ? "success" : "neutral"
                            }
                          >
                            {connection.is_active
                              ? t("adminAi.active")
                              : t("adminAi.inactive")}
                          </Badge>
                          {connection.last_check_ok === null ? (
                            <Badge variant="neutral">
                              {t("adminAi.unchecked")}
                            </Badge>
                          ) : (
                            <Badge
                              variant={
                                connection.last_check_ok ? "info" : "danger"
                              }
                            >
                              {connection.last_check_ok
                                ? t("adminAi.working")
                                : t("adminAi.failed")}
                            </Badge>
                          )}
                        </div>
                        <div
                          className="text-muted-foreground mt-1 text-[11px] whitespace-nowrap"
                          // The time is formatted in the viewer's time zone, which the server cannot know.
                          suppressHydrationWarning
                        >
                          {connection.last_checked_at
                            ? formatDateTime(connection.last_checked_at, locale)
                            : t("adminAi.neverChecked")}
                        </div>
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
                            {busy ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <RefreshCw />
                            )}
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
            <div className="border-border bg-surface-sunken border-t px-4 py-2">
              <PaginationBar
                total={shown.length}
                limit={pageSize}
                offset={firstRow}
                pageSizes={PAGE_SIZES}
                onLimitChange={(value) => {
                  setOffset(0);
                  setPageSize(value);
                }}
                onOffsetChange={setOffset}
              />
            </div>
          </div>
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
            ? t(
                removeTarget.is_active
                  ? "adminAi.removeActiveBody"
                  : "adminAi.removeBody",
                {
                  name: removeTarget.name,
                },
              )
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
