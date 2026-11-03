import { History, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  AuditLogDetailsDialog,
  AuditLogsExportButtons,
  AuditLogsFilterBar,
  type AuditFilterOption,
} from "@/components/admin/audit-logs-toolbar";
import { PaginationControls } from "@/components/admin/list-controls";
import { RefreshButton } from "@/components/admin/refresh-button";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Avatar, getUserAvatarColor } from "@/components/ui/avatar";
import { UserProfileTrigger } from "@/components/users/user-profile-trigger";
import { listAuditActions, listAuditActors, listAuditLogs } from "@/lib/admin";
import { extractChangeDiffs } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/i18n/format";
import { getServerLocale } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import type { AuditLogEntry } from "@/types/api";

export const metadata: Metadata = { title: "Audit Logs" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const PAGE_SIZES = [25, 50, 100, 200] as const;
const COLUMN_WIDTHS = ["15%", "20%", "17%", "18%", "22%", "8%"];

function ColumnWidths() {
  return (
    <colgroup>
      {COLUMN_WIDTHS.map((width, index) => (
        <col key={index} style={{ width }} />
      ))}
    </colgroup>
  );
}

const KNOWN_ENTITY_TYPES = [
  "user",
  "space",
  "group",
  "site_settings",
  "admin_mailbox",
  "archive",
  "instance",
] as const;

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/[\s_.-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}

function actionBadgeVariant(action: string): BadgeProps["variant"] {
  if (
    action.endsWith("_deleted") ||
    action.endsWith("_deactivated") ||
    action.endsWith("_removed") ||
    action.endsWith("_revoked")
  ) {
    return "danger";
  }
  if (
    action.endsWith("_created") ||
    action.endsWith("_activated") ||
    action.endsWith("_unarchived") ||
    action.endsWith("_added") ||
    action.endsWith("_granted")
  ) {
    return "success";
  }
  if (action.startsWith("impersonation_") || action.endsWith("_archived")) {
    return "warning";
  }
  return "info";
}

function formatScalar(value: unknown, emptyLabel: string): string {
  if (value === null || value === undefined || value === "") return emptyLabel;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.length ? value.join(", ") : emptyLabel;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return emptyLabel;
    if ("title" in obj && obj.title) return String(obj.title);
    if ("name" in obj && obj.name) return String(obj.name);
    return keys.slice(0, 2).map((k) => `${k}: ${obj[k]}`).join(", ");
  }
  return String(value);
}

function summarizeDetails(entry: AuditLogEntry, emptyLabel: string): string[] {
  const details = entry.details ?? {};
  const parts: string[] = [];

  if (typeof details.space_key === "string" && details.space_key) {
    parts.push(`key: ${details.space_key}`);
  }
  if (typeof details.user === "string" && details.user) {
    parts.push(`user: ${details.user}`);
  }
  if (typeof details.principal === "string" && details.principal) {
    const kind = typeof details.principal_type === "string" ? details.principal_type : "principal";
    parts.push(`${kind}: ${details.principal}`);
  }
  if (typeof details.permission === "string" && details.permission) {
    parts.push(`permission: ${details.permission}`);
  }
  if (typeof details.owner === "string" && details.owner) {
    parts.push(`owner: ${details.owner}`);
  }
  if (
    details.role &&
    typeof details.role === "object" &&
    !Array.isArray(details.role)
  ) {
    const r = details.role as { from?: unknown; to?: unknown };
    parts.push(
      `role: ${formatScalar(r.from, emptyLabel)} → ${formatScalar(r.to, emptyLabel)}`,
    );
  }
  if (Array.isArray(details.added) && details.added.length > 0) {
    parts.push(`+${details.added.join(", ")}`);
  }
  if (Array.isArray(details.removed) && details.removed.length > 0) {
    parts.push(`-${details.removed.join(", ")}`);
  }
  if (typeof details.is_superuser === "boolean") {
    parts.push(`is_superuser: ${details.is_superuser ? "true" : "false"}`);
  }
  if (
    details.overrides &&
    typeof details.overrides === "object" &&
    !Array.isArray(details.overrides)
  ) {
    for (const [k, v] of Object.entries(details.overrides as Record<string, unknown>)) {
      parts.push(`${k}: ${formatScalar(v, emptyLabel)}`);
    }
  }
  if (
    details.changes &&
    typeof details.changes === "object" &&
    !Array.isArray(details.changes)
  ) {
    const changeRows = extractChangeDiffs(
      details.changes as Record<string, { from?: unknown; to?: unknown }>,
    );
    for (const row of changeRows) {
      parts.push(
        `${row.field}: ${formatScalar(row.from, emptyLabel)} → ${formatScalar(row.to, emptyLabel)}`,
      );
    }
  }

  return parts;
}

export default async function AdminAuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : (value ?? "");
  };

  const q = single("q");
  const actor = single("actor");
  const entityType = single("entity_type");
  const action = single("action");
  const since = single("since");
  const until = single("until");
  const offset = Number.parseInt(single("offset") || "0", 10) || 0;
  const requestedLimit = Number.parseInt(single("limit") || String(PAGE_SIZE), 10);
  const limit = PAGE_SIZES.includes(requestedLimit as 25 | 50 | 100 | 200)
    ? requestedLimit
    : PAGE_SIZE;

  const [me, { t, locale }] = await Promise.all([getCurrentUser(), getServerLocale()]);
  const isSystemAdmin =
    me?.is_superuser || me?.global_permissions.includes("system_admin");

  if (!isSystemAdmin) {
    return (
      <div className="border-border bg-surface rounded-xl border p-6 shadow-sm">
        <p className="font-semibold">{t("adminShared.permissionRequiredTitle")}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("adminShared.permissionRequiredBody", {
            feature: t("adminAuditLogs.permissionFeature"),
            permission: t("adminShared.systemAdminLabel"),
          })}
        </p>
      </div>
    );
  }

  const sinceIso = since ? `${since}T00:00:00Z` : undefined;
  const untilIso = until ? `${until}T23:59:59.999Z` : undefined;

  const [page, actions, actors] = await Promise.all([
    listAuditLogs({
      q: q || undefined,
      actor_username: actor || undefined,
      entity_type: entityType || undefined,
      action: action || undefined,
      since: sinceIso,
      until: untilIso,
      limit,
      offset,
    }),
    listAuditActions(),
    listAuditActors(),
  ]);

  const actionLabel = (act: string): string => {
    const key = `adminAuditLogs.actions.${act}`;
    const translated = t(key);
    return translated === key ? act.replace(/_/g, " ") : translated;
  };

  const entityTypeLabel = (et: string): string => {
    const key = `adminAuditLogs.entityTypes.${et}`;
    const translated = t(key);
    return translated === key ? et : translated;
  };

  const actorOptions: AuditFilterOption[] = actors.map((username) => ({
    value: username,
    label: username,
  }));

  const entityTypeOptions: AuditFilterOption[] = KNOWN_ENTITY_TYPES.map((et) => ({
    value: et,
    label: entityTypeLabel(et),
  }));

  const actionOptions: AuditFilterOption[] = actions.map((act) => ({
    value: act,
    label: actionLabel(act),
  }));

  const emptyValLabel = t("adminAuditLogs.emptyValue");

  return (
    <div className="space-y-5">
      <header className="border-border flex shrink-0 flex-wrap items-end justify-between gap-4 border-b pb-5">
        <div>
          <p className="text-primary text-xs font-semibold tracking-[0.08em] uppercase">
            {t("nav.administration")}
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">
            {t("adminAuditLogs.title")}
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            {t("adminAuditLogs.description")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AuditLogsExportButtons
            q={q || undefined}
            actorUsername={actor || undefined}
            entityType={entityType || undefined}
            action={action || undefined}
            since={since || undefined}
            until={until || undefined}
            disabled={page.total === 0}
          />
        </div>
      </header>

      <section className="border-border bg-surface overflow-hidden rounded-xl border shadow-sm">
        <div className="border-border flex shrink-0 flex-wrap items-end justify-between gap-3 border-b px-4 py-3">
          <div>
            <h3 className="font-medium">{t("adminAuditLogs.tableHeading")}</h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t("adminAuditLogs.tableHint")}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Suspense fallback={null}>
              <AuditLogsFilterBar
                searchValue={q}
                actorValue={actor}
                entityTypeValue={entityType}
                actionValue={action}
                sinceValue={since}
                untilValue={until}
                actorOptions={actorOptions}
                entityTypeOptions={entityTypeOptions}
                actionOptions={actionOptions}
              />
            </Suspense>
            <RefreshButton label={t("adminAuditLogs.refresh")} />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] table-fixed text-sm">
            <ColumnWidths />
            <thead>
              <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left">
                <th className="px-4 py-3 font-medium">{t("adminAuditLogs.colTime")}</th>
                <th className="px-4 py-3 font-medium">{t("adminAuditLogs.colActor")}</th>
                <th className="px-4 py-3 font-medium">{t("adminAuditLogs.colAction")}</th>
                <th className="px-4 py-3 font-medium">{t("adminAuditLogs.colTarget")}</th>
                <th className="px-4 py-3 font-medium">{t("adminAuditLogs.colDetails")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("adminAuditLogs.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {page.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <History className="text-muted-foreground mx-auto size-7" />
                    <p className="mt-3 font-medium">{t("adminAuditLogs.noLogsFound")}</p>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {t("adminAuditLogs.tryChangingFilters")}
                    </p>
                  </td>
                </tr>
              ) : (
                page.items.map((entry) => {
                  const actLabel = actionLabel(entry.action);
                  const etLabel = entityTypeLabel(entry.entity_type);
                  const summaryParts = summarizeDetails(entry, emptyValLabel);
                  const hasDetails = Object.keys(entry.details ?? {}).length > 0;
                  const displayActor = entry.actor_username || t("adminAuditLogs.systemActor");

                  return (
                    <tr
                      key={entry.id}
                      className="border-border hover:bg-surface-hover border-b transition-colors duration-150 last:border-0"
                    >
                      <td className="px-4 py-3">
                        <span className="text-muted-foreground text-xs">
                          {formatDateTime(entry.created_at, locale)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {entry.actor_username && entry.actor_username !== "system" ? (
                            <UserProfileTrigger
                              username={entry.actor_username}
                              fullName={entry.actor_full_name}
                              avatarUrl={entry.actor_avatar_url}
                              variant="avatar"
                              className="size-8 text-xs"
                            />
                          ) : (
                            <span
                              className={cn(
                                "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold select-none ring-1 ring-inset ring-black/5 dark:ring-white/10",
                                getUserAvatarColor(displayActor),
                              )}
                            >
                              {initials(displayActor)}
                            </span>
                          )}
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {entry.actor_username && entry.actor_username !== "system" ? (
                                <UserProfileTrigger
                                  username={entry.actor_username}
                                  fullName={entry.actor_full_name}
                                  className="truncate font-medium text-foreground hover:underline cursor-pointer"
                                />
                              ) : (
                                <span className="truncate font-medium">{displayActor}</span>
                              )}
                              {entry.impersonator_username ? (
                                <Badge
                                  variant="warning"
                                  className="text-[10px]"
                                  title={t("adminAuditLogs.impersonatedTooltip", {
                                    actor: entry.actor_username,
                                    admin: entry.impersonator_username,
                                  })}
                                >
                                  <ShieldAlert className="size-3" />
                                  {t("adminAuditLogs.impersonatedVia", {
                                    admin: entry.impersonator_username,
                                  })}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="text-muted-foreground truncate text-xs">
                              {entry.ip_address || (entry.actor_username ? `@${entry.actor_username}` : "—")}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={actionBadgeVariant(entry.action)}>
                          {actLabel}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Badge variant="neutral" className="shrink-0">{etLabel}</Badge>
                          {entry.entity_label && entry.entity_label !== etLabel ? (
                            entry.entity_type === "user" ? (
                              <UserProfileTrigger
                                username={entry.entity_label}
                                className="truncate font-medium text-xs text-foreground hover:underline cursor-pointer"
                              />
                            ) : (
                              <span className="truncate font-medium text-xs" title={entry.entity_label}>
                                {entry.entity_label}
                              </span>
                            )
                          ) : entry.entity_id && entry.entity_id !== entry.entity_label ? (
                            <span className="text-muted-foreground truncate text-xs" title={entry.entity_id}>
                              {entry.entity_id}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {summaryParts.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1">
                            {summaryParts.slice(0, 3).map((part, idx) => (
                              <span
                                key={idx}
                                className="border-border/70 bg-surface-sunken text-foreground inline-block max-w-[220px] truncate rounded-md border px-2 py-0.5 text-xs font-normal"
                                title={part}
                              >
                                {part}
                              </span>
                            ))}
                            {summaryParts.length > 3 ? (
                              <span className="text-muted-foreground text-xs">
                                +{summaryParts.length - 3}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {hasDetails ? (
                          <AuditLogDetailsDialog
                            entry={entry}
                            actionLabel={actLabel}
                            entityTypeLabel={etLabel}
                          />
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="border-border bg-surface-sunken shrink-0 border-t px-4 py-3">
          <Suspense fallback={null}>
            <PaginationControls
              total={page.total}
              limit={page.limit}
              offset={page.offset}
              pageSizes={[...PAGE_SIZES]}
            />
          </Suspense>
        </div>
      </section>
    </div>
  );
}
