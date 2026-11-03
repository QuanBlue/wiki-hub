"use client";

import { Calendar, Download, Eye, Loader2, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { UserProfileTrigger } from "@/components/users/user-profile-trigger";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiBaseUrl } from "@/lib/env";
import { useTranslation } from "@/lib/i18n/context";
import { formatDateTime } from "@/lib/i18n/format";
import type { AuditLogEntry } from "@/types/api";

export interface AuditFilterOption {
  value: string;
  label: string;
}

export function buildAuditExportUrl(
  format: "csv" | "json",
  filters: {
    q?: string;
    actor_username?: string;
    entity_type?: string;
    action?: string;
    since?: string;
    until?: string;
  },
): string {
  const params = new URLSearchParams();
  params.set("format", format);
  if (filters.q) params.set("q", filters.q);
  if (filters.actor_username) params.set("actor_username", filters.actor_username);
  if (filters.entity_type) params.set("entity_type", filters.entity_type);
  if (filters.action) params.set("action", filters.action);
  if (filters.since) params.set("since", `${filters.since}T00:00:00Z`);
  if (filters.until) params.set("until", `${filters.until}T23:59:59.999Z`);
  return `${apiBaseUrl()}/api/v1/audit-logs/export?${params.toString()}`;
}

export function AuditLogsExportButtons({
  q,
  actorUsername,
  entityType,
  action,
  since,
  until,
  disabled,
}: {
  q?: string;
  actorUsername?: string;
  entityType?: string;
  action?: string;
  since?: string;
  until?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  function triggerDownload(format: "csv" | "json") {
    const link = document.createElement("a");
    link.href = buildAuditExportUrl(format, {
      q,
      actor_username: actorUsername,
      entity_type: entityType,
      action,
      since,
      until,
    });
    link.download = `audit-logs.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast.success(t("adminAuditLogs.exportPreparing"));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        size="md"
        disabled={disabled}
        onClick={() => triggerDownload("csv")}
      >
        <Download className="size-4" />
        {t("adminAuditLogs.exportCsv")}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="md"
        disabled={disabled}
        onClick={() => triggerDownload("json")}
      >
        <Download className="size-4" />
        {t("adminAuditLogs.exportJson")}
      </Button>
    </div>
  );
}

export function AuditLogsFilterBar({
  searchValue,
  actorValue,
  entityTypeValue,
  actionValue,
  sinceValue,
  untilValue,
  actorOptions,
  entityTypeOptions,
  actionOptions,
}: {
  searchValue: string;
  actorValue: string;
  entityTypeValue: string;
  actionValue: string;
  sinceValue: string;
  untilValue: string;
  actorOptions: AuditFilterOption[];
  entityTypeOptions: AuditFilterOption[];
  actionOptions: AuditFilterOption[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const write = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      if (!("offset" in updates)) next.delete("offset");
      const qs = next.toString();
      startTransition(() => {
        const navigate = (router.replace ?? router.push).bind(router);
        navigate(qs ? `${pathname}?${qs}` : pathname);
      });
    },
    [router, pathname, searchParams],
  );

  const writeRef = useRef(write);
  writeRef.current = write;

  const [term, setTerm] = useState(searchValue);
  const [prevSearchValue, setPrevSearchValue] = useState(searchValue);
  const lastDispatchedRef = useRef<string>(searchValue);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  if (searchValue !== prevSearchValue) {
    setPrevSearchValue(searchValue);
    if (searchValue !== lastDispatchedRef.current) {
      lastDispatchedRef.current = searchValue;
      setTerm(searchValue);
    }
  }

  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed === (searchValue || "").trim()) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      lastDispatchedRef.current = trimmed;
      writeRef.current({ q: trimmed || null });
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [term, searchValue]);

  const handleClearSearch = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    setTerm("");
    lastDispatchedRef.current = "";
    writeRef.current({ q: null });
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const trimmed = term.trim();
    lastDispatchedRef.current = trimmed;
    writeRef.current({ q: trimmed || null });
  };

  const hasAnyFilter = Boolean(
    searchValue || actorValue || entityTypeValue || actionValue || sinceValue || untilValue,
  );

  const handleClearAll = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    setTerm("");
    lastDispatchedRef.current = "";
    write({
      q: null,
      actor: null,
      entity_type: null,
      action: null,
      since: null,
      until: null,
    });
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <form className="flex items-end gap-2" onSubmit={handleSubmit}>
        <div className="relative">
          {isPending ? (
            <Loader2 className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 animate-spin" />
          ) : (
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          )}
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t("adminAuditLogs.searchPlaceholder")}
            aria-label={t("adminAuditLogs.searchPlaceholder")}
            className="w-48 sm:w-56 pr-8 pl-8"
          />
          {term ? (
            <button
              type="button"
              onClick={handleClearSearch}
              className="text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-2 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
              aria-label={t("adminAuditLogs.clearSearch")}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <Button type="submit" variant="secondary">
          {t("adminAuditLogs.searchButton")}
        </Button>
      </form>

      <div className="min-w-32">
        <Select
          value={actorValue || "__all__"}
          onValueChange={(val) => write({ actor: val === "__all__" ? null : val })}
        >
          <SelectTrigger aria-label={t("adminAuditLogs.filterActor")}>
            <SelectValue>
              {actorValue
                ? `${t("adminAuditLogs.filterActor")}: ${actorValue}`
                : `${t("adminAuditLogs.filterActor")}: ${t("adminAuditLogs.allOption")}`}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">
              {t("adminAuditLogs.filterActor")}: {t("adminAuditLogs.allOption")}
            </SelectItem>
            {actorOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-32">
        <Select
          value={entityTypeValue || "__all__"}
          onValueChange={(val) => write({ entity_type: val === "__all__" ? null : val })}
        >
          <SelectTrigger aria-label={t("adminAuditLogs.filterEntityType")}>
            <SelectValue>
              {entityTypeValue
                ? `${t("adminAuditLogs.filterEntityType")}: ${
                    entityTypeOptions.find((o) => o.value === entityTypeValue)?.label ??
                    entityTypeValue
                  }`
                : `${t("adminAuditLogs.filterEntityType")}: ${t("adminAuditLogs.allOption")}`}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">
              {t("adminAuditLogs.filterEntityType")}: {t("adminAuditLogs.allOption")}
            </SelectItem>
            {entityTypeOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-36">
        <Select
          value={actionValue || "__all__"}
          onValueChange={(val) => write({ action: val === "__all__" ? null : val })}
        >
          <SelectTrigger aria-label={t("adminAuditLogs.filterAction")}>
            <SelectValue>
              {actionValue
                ? `${t("adminAuditLogs.filterAction")}: ${
                    actionOptions.find((o) => o.value === actionValue)?.label ?? actionValue
                  }`
                : `${t("adminAuditLogs.filterAction")}: ${t("adminAuditLogs.allOption")}`}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">
              {t("adminAuditLogs.filterAction")}: {t("adminAuditLogs.allOption")}
            </SelectItem>
            {actionOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="border-border bg-surface flex h-9 items-center gap-1.5 rounded-md border px-2.5">
        <Calendar className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
        <input
          type="date"
          value={sinceValue}
          onChange={(e) => write({ since: e.target.value || null })}
          aria-label={t("adminAuditLogs.filterSince")}
          title={t("adminAuditLogs.filterSince")}
          className="text-foreground w-28 bg-transparent text-xs focus:outline-none"
        />
        <span className="text-muted-foreground text-xs" aria-hidden>
          –
        </span>
        <input
          type="date"
          value={untilValue}
          onChange={(e) => write({ until: e.target.value || null })}
          aria-label={t("adminAuditLogs.filterUntil")}
          title={t("adminAuditLogs.filterUntil")}
          className="text-foreground w-28 bg-transparent text-xs focus:outline-none"
        />
      </div>

      {hasAnyFilter ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClearAll}
          className="text-muted-foreground hover:text-foreground h-9 gap-1 text-xs"
        >
          <X className="size-3.5" />
          {t("adminAuditLogs.clearFilters")}
        </Button>
      ) : null}
    </div>
  );
}

import { extractChangeDiffs, type ChangeDiffRow } from "@/lib/audit";

export { extractChangeDiffs, type ChangeDiffRow };

function renderDiffValue(val: unknown, emptyLabel: string): React.ReactNode {
  if (val === null || val === undefined || val === "") {
    return <span className="text-muted-foreground/60 italic">{emptyLabel}</span>;
  }
  if (typeof val === "boolean") {
    return (
      <Badge variant={val ? "success" : "neutral"} className="text-[11px] font-normal">
        {val ? "true" : "false"}
      </Badge>
    );
  }
  if (Array.isArray(val)) {
    if (val.length === 0) {
      return <span className="text-muted-foreground/60 italic">{emptyLabel}</span>;
    }
    return val.map(String).join(", ");
  }
  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="text-muted-foreground/60 italic">{emptyLabel}</span>;
    }
    return (
      <span className="text-xs">
        {entries.map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(", ")}
      </span>
    );
  }
  return String(val);
}

export function AuditLogDetailsDialog({
  entry,
  actionLabel,
  entityTypeLabel,
}: {
  entry: AuditLogEntry;
  actionLabel: string;
  entityTypeLabel: string;
}) {
  const { t, locale } = useTranslation();
  const rawChanges =
    entry.details &&
    typeof entry.details.changes === "object" &&
    entry.details.changes !== null &&
    !Array.isArray(entry.details.changes)
      ? (entry.details.changes as Record<string, { from?: unknown; to?: unknown }>)
      : null;

  const diffRows = extractChangeDiffs(rawChanges);
  const targetText =
    entry.entity_label && entry.entity_label !== entityTypeLabel
      ? `${entityTypeLabel}: ${entry.entity_label}`
      : entityTypeLabel;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="hover:bg-surface-hover hover:text-foreground h-8 gap-1 px-2.5 text-xs transition-colors duration-150"
          aria-label={`${t("adminAuditLogs.viewDetails")}: ${actionLabel}`}
        >
          <Eye className="size-3.5" />
          {t("adminAuditLogs.viewDetails")}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={t("adminAuditLogs.detailsTitle")}
        description={t("adminAuditLogs.detailsSubtitle", {
          time: formatDateTime(entry.created_at, locale),
        })}
        className="max-w-xl"
      >
        <div className="space-y-4 text-sm">
          <dl className="border-border bg-surface-sunken grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border p-3.5 text-xs">
            <div>
              <dt className="text-muted-foreground">{t("adminAuditLogs.fieldActor")}</dt>
              <dd className="mt-0.5 font-medium text-foreground flex items-center gap-2">
                {entry.actor_username && entry.actor_username !== "system" ? (
                  <>
                    <UserProfileTrigger
                      username={entry.actor_username}
                      fullName={entry.actor_full_name}
                      avatarUrl={entry.actor_avatar_url}
                      variant="avatar"
                      className="size-5 text-[10px]"
                    />
                    <UserProfileTrigger
                      username={entry.actor_username}
                      fullName={entry.actor_full_name}
                      className="hover:underline cursor-pointer"
                    />
                  </>
                ) : (
                  <span>{entry.actor_username}</span>
                )}
              </dd>
            </div>
            {entry.impersonator_username ? (
              <div>
                <dt className="text-muted-foreground">{t("adminAuditLogs.fieldImpersonator")}</dt>
                <dd className="mt-0.5 flex items-center gap-1.5">
                  <UserProfileTrigger
                    username={entry.impersonator_username}
                    variant="avatar"
                    className="size-4 text-[9px]"
                  />
                  <Badge variant="warning">
                    <UserProfileTrigger
                      username={entry.impersonator_username}
                      className="hover:underline cursor-pointer"
                    />
                  </Badge>
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted-foreground">{t("adminAuditLogs.fieldAction")}</dt>
              <dd className="mt-0.5 font-medium text-foreground">{actionLabel}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("adminAuditLogs.fieldTarget")}</dt>
              <dd className="mt-0.5 font-medium text-foreground">{targetText}</dd>
            </div>
            {entry.entity_id && entry.entity_id !== entry.entity_label ? (
              <div>
                <dt className="text-muted-foreground">{t("adminAuditLogs.fieldEntityId")}</dt>
                <dd className="text-muted-foreground mt-0.5 break-all">{entry.entity_id}</dd>
              </div>
            ) : null}
            {entry.ip_address ? (
              <div>
                <dt className="text-muted-foreground">{t("adminAuditLogs.fieldIpAddress")}</dt>
                <dd className="text-muted-foreground mt-0.5">{entry.ip_address}</dd>
              </div>
            ) : null}
          </dl>

          {diffRows.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground">
                {t("adminAuditLogs.fieldChanges")}
              </p>
              <div className="border-border overflow-hidden rounded-lg border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-sunken text-muted-foreground border-border border-b font-medium">
                    <tr>
                      <th className="px-3 py-2 w-1/3">{t("adminAuditLogs.diffField")}</th>
                      <th className="px-3 py-2 w-1/3">{t("adminAuditLogs.diffBefore")}</th>
                      <th className="px-3 py-2 w-1/3">{t("adminAuditLogs.diffAfter")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-border divide-y">
                    {diffRows.map((row) => (
                      <tr key={row.field} className="hover:bg-surface-hover/50">
                        <td className="px-3 py-2 font-medium text-foreground">
                          {row.field}
                        </td>
                        <td className="text-muted-foreground px-3 py-2 break-words line-through decoration-muted-foreground/40">
                          {renderDiffValue(row.from, t("adminAuditLogs.emptyValue"))}
                        </td>
                        <td className="px-3 py-2 font-medium text-foreground break-words">
                          {renderDiffValue(row.to, t("adminAuditLogs.emptyValue"))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {Object.keys(entry.details ?? {}).length > 0 ? (
            <details className="group border-border bg-surface-sunken overflow-hidden rounded-lg border text-xs">
              <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center justify-between px-3 py-2 font-medium transition-colors select-none">
                <span>{t("adminAuditLogs.fieldRawJson")}</span>
                <span className="text-[11px] opacity-75 group-open:hidden">
                  {t("adminAuditLogs.expandJson")}
                </span>
                <span className="text-[11px] opacity-75 hidden group-open:inline">
                  {t("adminAuditLogs.collapseJson")}
                </span>
              </summary>
              <div className="border-border border-t p-3 bg-surface">
                <pre className="max-h-56 overflow-auto font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {JSON.stringify(entry.details, null, 2)}
                </pre>
              </div>
            </details>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
