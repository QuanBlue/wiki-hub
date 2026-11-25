"use client";

import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Eye,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { MailError } from "@/components/admin/mail-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type {
  AdminMailbox,
  AdminMailLog,
  MailLogCounts,
  MailLogKind,
  MailLogStatusFilter,
  Page,
} from "@/types/api";

const PAGE_SIZES = [10, 25, 50, 100] as const;
const ALL_VALUE = "__all__";

const KIND_KEYS: Record<MailLogKind, string> = {
  contact_request: "adminMail.logsKindContactRequest",
  account_created: "adminMail.logsKindAccountCreated",
  password_reset: "adminMail.logsKindPasswordReset",
  admin_granted: "adminMail.logsKindAdminGranted",
  space_access: "adminMail.logsKindSpaceAccess",
  issue_created: "adminMail.logsKindIssueCreated",
  issue_assigned: "adminMail.logsKindIssueAssigned",
  issue_closed: "adminMail.logsKindIssueClosed",
};

const ALL_KINDS = Object.keys(KIND_KEYS) as MailLogKind[];

export function MailDeliveryLogs({
  mailboxes,
}: {
  mailboxes: AdminMailbox[];
}) {
  const { t, locale, apiErrorText } = useTranslation();
  const [status, setStatus] = useState<MailLogStatusFilter>("all");
  const [kind, setKind] = useState<string>(ALL_VALUE);
  const [mailboxId, setMailboxId] = useState<string>(ALL_VALUE);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [limit, setLimit] = useState<number>(25);
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(0);

  const [page, setPage] = useState<Page<AdminMailLog> | null>(null);
  const [counts, setCounts] = useState<MailLogCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AdminMailLog | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = searchInput.trim();
      setDebouncedQuery((prev) => {
        if (prev !== trimmed) setOffset(0);
        return trimmed;
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams();
    params.set("status", status);
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    if (kind !== ALL_VALUE) params.set("kind", kind);
    if (mailboxId !== ALL_VALUE) params.set("mailbox_id", mailboxId);
    if (debouncedQuery) params.set("q", debouncedQuery);

    const countParams = new URLSearchParams();
    if (kind !== ALL_VALUE) countParams.set("kind", kind);
    if (mailboxId !== ALL_VALUE) countParams.set("mailbox_id", mailboxId);
    if (debouncedQuery) countParams.set("q", debouncedQuery);

    void Promise.all([
      api.get<Page<AdminMailLog>>(`/api/v1/admin-mail/logs?${params.toString()}`),
      api.get<MailLogCounts>(
        `/api/v1/admin-mail/logs/counts${countParams.toString() ? `?${countParams.toString()}` : ""}`,
      ),
    ])
      .then(([logsPage, logCounts]) => {
        if (!active) return;
        setPage(logsPage);
        setCounts(logCounts);
      })
      .catch((error: unknown) => {
        if (active) toast.error(apiErrorText(error, "adminMail.logsLoadError"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [status, kind, mailboxId, debouncedQuery, limit, offset, tick, apiErrorText]);

  const hasFilters =
    status !== "all" ||
    kind !== ALL_VALUE ||
    mailboxId !== ALL_VALUE ||
    debouncedQuery !== "";

  function clearFilters() {
    setStatus("all");
    setKind(ALL_VALUE);
    setMailboxId(ALL_VALUE);
    setSearchInput("");
    setDebouncedQuery("");
    setOffset(0);
  }

  const total = page?.total ?? 0;
  const items = page?.items ?? [];
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + items.length, total);
  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  const statusTabs: { value: MailLogStatusFilter; label: string; count?: number }[] = [
    { value: "all", label: t("adminMail.logsFilterAll"), count: counts?.all },
    { value: "sent", label: t("adminMail.logsFilterSent"), count: counts?.sent },
    { value: "failed", label: t("adminMail.logsFilterFailed"), count: counts?.failed },
  ];

  return (
    <section className="border-border bg-surface overflow-hidden rounded-xl border shadow-sm">
      <div className="border-border flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3.5">
        <div>
          <h3 className="font-semibold">{t("adminMail.logsTitle")}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t("adminMail.logsDescription")}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={loading}
          onClick={() => setTick((n) => n + 1)}
          aria-label={t("adminMail.logsRefresh")}
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {t("adminMail.logsRefresh")}
        </Button>
      </div>

      <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={t("adminMail.logsColStatus")}>
          {statusTabs.map((tab) => {
            const active = status === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setStatus(tab.value);
                  setOffset(0);
                }}
                className={cn(
                  "focus-visible:ring-ring inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  active
                    ? "bg-surface-selected text-foreground"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {tab.label}
                {tab.count !== undefined ? (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[11px] leading-none",
                      tab.value === "failed" && tab.count > 0
                        ? "bg-danger-bg text-danger"
                        : "bg-surface-sunken text-muted-foreground",
                    )}
                  >
                    {tab.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
            />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t("adminMail.logsSearchPlaceholder")}
              aria-label={t("adminMail.logsSearchPlaceholder")}
              className="h-8 w-52 pr-7 pl-8 text-xs sm:w-60"
            />
            {searchInput ? (
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  setDebouncedQuery("");
                  setOffset(0);
                }}
                aria-label={t("adminMail.logsClearSearch")}
                className="text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>

          <Select
            value={kind}
            onValueChange={(value) => {
              setKind(value);
              setOffset(0);
            }}
          >
            <SelectTrigger className="h-8 w-44 text-xs" aria-label={t("adminMail.logsFilterKind")}>
              <SelectValue>
                {kind === ALL_VALUE
                  ? `${t("adminMail.logsFilterKind")}: ${t("adminMail.logsAllOption")}`
                  : t(KIND_KEYS[kind as MailLogKind])}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>
                {t("adminMail.logsFilterKind")}: {t("adminMail.logsAllOption")}
              </SelectItem>
              {ALL_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {t(KIND_KEYS[k])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {mailboxes.length > 0 ? (
            <Select
              value={mailboxId}
              onValueChange={(value) => {
                setMailboxId(value);
                setOffset(0);
              }}
            >
              <SelectTrigger
                className="h-8 w-48 text-xs"
                aria-label={t("adminMail.logsFilterMailbox")}
              >
                <SelectValue>
                  {mailboxId === ALL_VALUE
                    ? `${t("adminMail.logsFilterMailbox")}: ${t("adminMail.logsAllOption")}`
                    : (mailboxes.find((m) => m.id === mailboxId)?.email ?? mailboxId)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>
                  {t("adminMail.logsFilterMailbox")}: {t("adminMail.logsAllOption")}
                </SelectItem>
                {mailboxes.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {hasFilters ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="text-muted-foreground hover:text-foreground h-8 gap-1 text-xs"
            >
              <X className="size-3.5" />
              {t("adminMail.logsClearFilters")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left text-xs">
              <th className="px-4 py-2.5 font-medium">{t("adminMail.logsColTime")}</th>
              <th className="px-4 py-2.5 font-medium">{t("adminMail.logsColStatus")}</th>
              <th className="px-4 py-2.5 font-medium">{t("adminMail.logsColKind")}</th>
              <th className="px-4 py-2.5 font-medium">{t("adminMail.logsColRoute")}</th>
              <th className="px-4 py-2.5 font-medium">{t("adminMail.logsColSubject")}</th>
              <th className="px-4 py-2.5 font-medium">{t("adminMail.logsColReason")}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t("adminMail.logsColActions")}</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center">
                  {loading ? (
                    <Loader2 className="text-muted-foreground mx-auto size-6 animate-spin" />
                  ) : (
                    <>
                      <Mail aria-hidden className="text-muted-foreground mx-auto size-7" />
                      <p className="mt-2.5 font-medium">{t("adminMail.logsEmptyTitle")}</p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {t("adminMail.logsEmptyBody")}
                      </p>
                    </>
                  )}
                </td>
              </tr>
            ) : (
              items.map((log) => {
                const isSent = log.status === "sent";
                return (
                  <tr
                    key={log.id}
                    className="border-border hover:bg-surface-hover border-b align-top transition-colors duration-150 last:border-0"
                  >
                    <td className="text-muted-foreground px-4 py-2.5 text-xs whitespace-nowrap">
                      {formatDateTime(log.created_at, locale)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={isSent ? "success" : "danger"} className="gap-1">
                        {isSent ? (
                          <CircleCheck className="size-3" aria-hidden />
                        ) : (
                          <CircleAlert className="size-3" aria-hidden />
                        )}
                        {isSent
                          ? t("adminMail.logsStatusSent")
                          : t("adminMail.logsStatusFailed")}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="neutral">
                        {t(KIND_KEYS[log.kind] ?? "adminMail.logsKindContactRequest")}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <div className="font-medium break-all">{log.to_email}</div>
                      <div className="text-muted-foreground mt-0.5 break-all">
                        {log.from_email || t("adminMail.logsNoMailbox")}
                      </div>
                    </td>
                    <td className="max-w-60 px-4 py-2.5 text-xs">
                      <div className="truncate font-medium" title={log.subject}>
                        {log.subject || "—"}
                      </div>
                      {log.actor_username ? (
                        <div className="text-muted-foreground mt-0.5">
                          @{log.actor_username}
                        </div>
                      ) : null}
                    </td>
                    <td className="max-w-64 px-4 py-2.5 text-xs">
                      {isSent ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="text-danger line-clamp-2 break-words" title={log.error ?? ""}>
                          {log.error || log.error_code || "—"}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelected(log)}
                        className="hover:bg-surface-hover hover:text-foreground h-7 gap-1 px-2 text-xs"
                      >
                        <Eye className="size-3.5" />
                        {t("adminMail.logsViewDetails")}
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="border-border bg-surface-sunken flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 text-xs">
        <span className="text-muted-foreground">
          {t("adminMail.logsShowing", {
            start: String(start),
            end: String(end),
            total: String(total),
          })}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{t("adminMail.logsPerPage")}</span>
            <Select
              value={String(limit)}
              onValueChange={(value) => {
                setLimit(Number(value));
                setOffset(0);
              }}
            >
              <SelectTrigger className="h-7 w-18 text-xs" aria-label={t("adminMail.logsPerPage")}>
                <SelectValue>{limit}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!canPrev || loading}
              onClick={() => setOffset(Math.max(0, offset - limit))}
              className="h-7 px-2 text-xs"
            >
              <ChevronLeft className="size-3.5" />
              {t("adminMail.logsPrev")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!canNext || loading}
              onClick={() => setOffset(offset + limit)}
              className="h-7 px-2 text-xs"
            >
              {t("adminMail.logsNext")}
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {selected ? (
        <Dialog open onOpenChange={(open) => { if (!open) setSelected(null); }}>
          <DialogContent
            title={t("adminMail.logsDetailsTitle")}
            description={t("adminMail.logsDetailsSubtitle", {
              time: formatDateTime(selected.created_at, locale),
            })}
            className="max-w-lg"
          >
            <div className="space-y-4 text-sm">
              <dl className="border-border bg-surface-sunken grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border p-3.5 text-xs">
                <div>
                  <dt className="text-muted-foreground">{t("adminMail.logsFieldStatus")}</dt>
                  <dd className="mt-1">
                    <Badge variant={selected.status === "sent" ? "success" : "danger"}>
                      {selected.status === "sent"
                        ? t("adminMail.logsStatusSent")
                        : t("adminMail.logsStatusFailed")}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("adminMail.logsFieldKind")}</dt>
                  <dd className="mt-1 font-medium">
                    {t(KIND_KEYS[selected.kind] ?? "adminMail.logsKindContactRequest")}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("adminMail.logsFieldFrom")}</dt>
                  <dd className="mt-0.5 font-medium break-all">
                    {selected.from_email || t("adminMail.logsNoMailbox")}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("adminMail.logsFieldTo")}</dt>
                  <dd className="mt-0.5 font-medium break-all">{selected.to_email}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">{t("adminMail.logsFieldSubject")}</dt>
                  <dd className="mt-0.5 font-medium break-words">{selected.subject || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("adminMail.logsFieldActor")}</dt>
                  <dd className="mt-0.5 font-medium">
                    {selected.actor_username ? `@${selected.actor_username}` : t("adminMail.logsSystemActor")}
                  </dd>
                </div>
                {selected.error_code ? (
                  <div>
                    <dt className="text-muted-foreground">{t("adminMail.logsFieldErrorCode")}</dt>
                    <dd className="mt-0.5 font-mono">{selected.error_code}</dd>
                  </div>
                ) : null}
              </dl>

              {selected.status === "failed" && selected.error ? (
                <div className="border-danger/30 bg-danger-bg/50 rounded-lg border p-3 text-xs">
                  <p className="text-danger mb-1.5 font-semibold">
                    {t("adminMail.logsFieldError")}
                  </p>
                  <MailError raw={selected.error} />
                </div>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
