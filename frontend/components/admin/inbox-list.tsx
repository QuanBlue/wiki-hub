"use client";

import {
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDot,
  Eye,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { MailError } from "@/components/admin/mail-error";
import { RequestActions } from "@/components/admin/request-actions";
import { useMailSummary } from "@/components/layout/mail-summary-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/admin-mail-ui";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type {
  AdminRequestKind,
  InboxCounts,
  InboxFilter,
  InboxItem,
  Page,
} from "@/types/api";

const PAGE_SIZES = [10, 25, 50, 100];
const FILTERS: { value: InboxFilter; icon: LucideIcon }[] = [
  { value: "all", icon: Inbox },
  { value: "unread", icon: Mail },
  { value: "open", icon: CircleDot },
  { value: "resolved", icon: CircleCheck },
];
const KINDS: AdminRequestKind[] = ["account", "password_reset", "other"];
/** The "no type filter" value; a Select item cannot be an empty string. */
const ANY_KIND = "__all__";

const KIND_KEY: Record<AdminRequestKind, string> = {
  account: "adminInbox.kindAccount",
  password_reset: "adminInbox.kindPasswordReset",
  other: "adminInbox.kindOther",
};

const FILTER_KEY: Record<InboxFilter, string> = {
  all: "adminInbox.filterAll",
  unread: "adminInbox.filterUnread",
  open: "adminInbox.filterOpen",
  resolved: "adminInbox.filterResolved",
};

/** The requests sent to the signed-in administrator's mailbox. */
export function InboxList({ openId }: { openId?: string }) {
  const { t, locale, apiErrorText } = useTranslation();
  const { summary, refresh: refreshMailSummary } = useMailSummary();
  // Changes when a new request arrives (the shell polls for it), so the list
  // and its tab numbers re-read on their own instead of waiting for a reload.
  const latestRequestAt = summary.latest_request_at ?? null;
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [kind, setKind] = useState<AdminRequestKind | null>(null);
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState<Page<InboxItem> | null>(null);
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const [selected, setSelected] = useState<InboxItem | null>(null);
  const [busy, setBusy] = useState(false);

  // Bumped to re-read the current page after a bulk change.
  const [reloadTick, setReloadTick] = useState(0);
  // Bumped when a request's read/resolved state changes, so the tab numbers
  // follow without re-reading the rows on screen.
  const [countsTick, setCountsTick] = useState(0);

  // Changing the filter or page keeps the rows already on screen until the new
  // ones arrive, rather than blanking the table on every click.
  useEffect(() => {
    let active = true;
    const kindQuery = kind ? `&kind=${kind}` : "";
    void api
      .get<Page<InboxItem>>(
        `/api/v1/admin-mail/inbox?status=${filter}&limit=${pageSize}&offset=${offset}${kindQuery}`,
      )
      .then((result) => {
        if (active) setPage(result);
      })
      .catch((error: unknown) => {
        if (active) toast.error(apiErrorText(error, "adminInbox.loadError"));
      });
    return () => {
      active = false;
    };
  }, [filter, kind, offset, pageSize, reloadTick, latestRequestAt, apiErrorText]);

  // The number on each tab: what it would list for the chosen request type.
  useEffect(() => {
    let active = true;
    void api
      .get<InboxCounts>(
        `/api/v1/admin-mail/inbox/counts${kind ? `?kind=${kind}` : ""}`,
      )
      .then((result) => {
        if (active) setCounts(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [kind, reloadTick, countsTick, latestRequestAt]);

  // A request opened from the bell's list, straight from its link.
  useEffect(() => {
    if (!openId) return;
    let active = true;
    void api
      .get<InboxItem>(`/api/v1/admin-mail/inbox/${openId}`)
      .then((item) => {
        if (active) void open(item);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // Opening is a one-off for the linked request, not something to redo when
    // the list or filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  /** A request changed (read, resolved, acted on): show it everywhere it appears. */
  function applyUpdated(updated: InboxItem) {
    setPage((current) =>
      current
        ? {
            ...current,
            items: current.items.map((row) =>
              row.id === updated.id ? updated : row,
            ),
          }
        : current,
    );
    setSelected((current) => (current?.id === updated.id ? updated : current));
    setCountsTick((tick) => tick + 1);
    refreshMailSummary();
  }

  async function patch(
    item: InboxItem,
    body: { read?: boolean; resolved?: boolean },
  ): Promise<InboxItem | null> {
    setBusy(true);
    try {
      const updated = await api.patch<InboxItem>(
        `/api/v1/admin-mail/inbox/${item.id}`,
        body,
      );
      applyUpdated(updated);
      return updated;
    } catch (error) {
      toast.error(apiErrorText(error, "adminInbox.actionError"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  // Opening a request reads it.
  async function open(item: InboxItem) {
    setSelected(item);
    if (!item.read_at) await patch(item, { read: true });
  }

  async function markAllRead() {
    setBusy(true);
    try {
      await api.post("/api/v1/admin-mail/inbox/read-all");
      setReloadTick((tick) => tick + 1);
      refreshMailSummary();
    } catch (error) {
      toast.error(apiErrorText(error, "adminInbox.actionError"));
    } finally {
      setBusy(false);
    }
  }

  const total = page?.total ?? 0;
  const items = page?.items ?? [];
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + pageSize, total);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.floor(offset / pageSize) + 1;

  return (
    <div className="space-y-4">
      <div className="border-border flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="group"
          aria-label={t("adminInbox.filterAria")}
          className="border-border bg-surface-sunken flex w-fit max-w-full flex-wrap items-center rounded-md border p-0.5 text-xs"
        >
          {FILTERS.map(({ value, icon: Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                setOffset(0);
              }}
              className={cn(
                "focus-visible:ring-ring flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                filter === value
                  ? "bg-surface text-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {t(FILTER_KEY[value], { count: counts?.[value] ?? 0 })}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-52">
            <Select
              value={kind ?? ANY_KIND}
              onValueChange={(value) => {
                setKind(
                  value === ANY_KIND ? null : (value as AdminRequestKind),
                );
                setOffset(0);
              }}
            >
              <SelectTrigger aria-label={t("adminInbox.typeFilter")}>
                {/* Explicit, so the label shows before the menu has been opened. */}
                <SelectValue>
                  {kind ? t(KIND_KEY[kind]) : t("adminInbox.typeAll")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_KIND}>
                  {t("adminInbox.typeAll")}
                </SelectItem>
                {KINDS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(KIND_KEY[value])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void markAllRead()}
            disabled={busy}
          >
            <CheckCheck /> {t("adminInbox.markAllRead")}
          </Button>
        </div>
      </div>

      <div className="border-border bg-surface overflow-hidden rounded-xl border shadow-sm">
        <div className="overflow-x-auto">
          {page === null ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 p-10 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
            </div>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground p-10 text-center text-sm">
              {t("adminInbox.empty")}
            </p>
          ) : (
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="bg-surface-sunken text-muted-foreground border-border border-b text-left text-xs">
                  <th className="px-4 py-2 font-medium">
                    {t("adminInbox.columnFrom")}
                  </th>
                  <th className="px-4 py-2 font-medium">
                    {t("adminInbox.columnType")}
                  </th>
                  <th className="px-4 py-2 font-medium">
                    {t("adminInbox.columnMessage")}
                  </th>
                  <th className="px-4 py-2 font-medium">
                    {t("adminInbox.columnReceived")}
                  </th>
                  <th className="px-4 py-2 font-medium">
                    {t("adminInbox.columnEmail")}
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    <span className="sr-only">
                      {t("adminInbox.viewDetails")}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-border hover:bg-surface-hover border-b align-top transition-colors duration-150 last:border-0"
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {!item.read_at ? (
                          <span
                            className="bg-primary size-2 shrink-0 rounded-full"
                            title={t("adminInbox.unread")}
                            role="img"
                            aria-label={t("adminInbox.unread")}
                          />
                        ) : null}
                        <span
                          className={cn(
                            "font-medium",
                            !item.read_at && "font-semibold",
                          )}
                        >
                          {item.requester_name}
                        </span>
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {item.requester_email}
                      </div>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {t(KIND_KEY[item.kind])}
                      {item.resolved_at ? (
                        <div className="mt-1">
                          <Badge variant="success">
                            {t("adminInbox.resolved")}
                          </Badge>
                        </div>
                      ) : null}
                    </td>
                    <td className="text-muted-foreground max-w-xs px-4 py-2">
                      <p className="line-clamp-2 break-words">
                        {item.message || (
                          <span className="italic">
                            {t("adminInbox.noMessage")}
                          </span>
                        )}
                      </p>
                    </td>
                    <td className="text-muted-foreground px-4 py-2 text-xs whitespace-nowrap">
                      {formatDateTime(item.created_at, locale)}
                    </td>
                    <td className="px-4 py-2">
                      <Badge
                        variant={
                          item.delivery_status === "sent" ? "success" : "danger"
                        }
                      >
                        {item.delivery_status === "sent"
                          ? t("adminInbox.emailSent")
                          : t("adminInbox.emailFailed")}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => void open(item)}
                        aria-label={`${t("adminInbox.viewDetails")}: ${item.requester_name}`}
                      >
                        <Eye /> {t("adminInbox.viewDetails")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {total > 0 ? (
          <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <p className="text-muted-foreground text-sm" aria-live="polite">
              {t("common.showingRange", { from, to, total })}
            </p>
            <div className="flex items-center gap-2">
              <label
                htmlFor="inbox-page-size"
                className="text-muted-foreground text-xs"
              >
                {t("common.rows")}
              </label>
              <Select
                value={String(pageSize)}
                onValueChange={(value) => {
                  setPageSize(Number(value));
                  setOffset(0);
                }}
              >
                <SelectTrigger
                  id="inbox-page-size"
                  className="h-8 w-18"
                  aria-label={t("common.rowsPerPage")}
                >
                  <SelectValue>{pageSize}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground hidden text-xs sm:inline">
                {t("common.pageIndicator", {
                  current: currentPage,
                  total: pageCount,
                })}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - pageSize))}
                aria-label={t("common.previousPage")}
                title={t("common.previousPage")}
              >
                <ChevronLeft />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                disabled={offset + pageSize >= total}
                onClick={() => setOffset(offset + pageSize)}
                aria-label={t("common.nextPage")}
                title={t("common.nextPage")}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {selected ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setSelected(null);
          }}
        >
          <DialogContent
            title={t("adminInbox.detailsTitle", {
              name: selected.requester_name,
            })}
            description={t(KIND_KEY[selected.kind])}
            className="max-w-lg"
          >
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">
                {t("adminInbox.fieldName")}
              </dt>
              <dd className="font-medium break-words">
                {selected.requester_name}
              </dd>
              <dt className="text-muted-foreground">
                {t("adminInbox.fieldEmail")}
              </dt>
              <dd className="break-words">
                <a
                  href={`mailto:${selected.requester_email}`}
                  className="text-primary hover:underline"
                >
                  {selected.requester_email}
                </a>
                <span className="text-muted-foreground block text-xs">
                  {t("adminInbox.unverifiedEmail")}
                </span>
              </dd>
              {selected.requester_username ? (
                <>
                  <dt className="text-muted-foreground">
                    {t("adminInbox.fieldUsername")}
                  </dt>
                  <dd className="break-words">{selected.requester_username}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">
                {t("adminInbox.fieldReceived")}
              </dt>
              <dd>{formatDateTime(selected.created_at, locale)}</dd>
              <dt className="text-muted-foreground">
                {t("adminInbox.fieldMessage")}
              </dt>
              <dd className="bg-surface-sunken rounded-md p-2 break-words whitespace-pre-wrap">
                {selected.message || (
                  <span className="text-muted-foreground italic">
                    {t("adminInbox.noMessage")}
                  </span>
                )}
              </dd>
            </dl>

            <div
              className={cn(
                "mt-4 rounded-md border px-3 py-2 text-xs",
                selected.delivery_status === "sent"
                  ? "border-success/30 bg-success-bg text-success"
                  : "border-danger/30 bg-danger-bg text-danger",
              )}
            >
              {selected.delivery_status === "sent" ? (
                t("adminInbox.deliverySent", { email: selected.mailbox_email })
              ) : (
                <>
                  <p className="font-semibold">
                    {t("adminInbox.deliveryFailed", {
                      email: selected.mailbox_email,
                    })}
                  </p>
                  <div className="mt-1">
                    <MailError raw={selected.delivery_error} />
                  </div>
                </>
              )}
            </div>

            <RequestActions item={selected} onChanged={applyUpdated} />

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void patch(selected, { read: false })}
              >
                <MailOpen /> {t("adminInbox.markUnread")}
              </Button>
              {selected.resolved_at ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void patch(selected, { resolved: false })}
                >
                  <Undo2 /> {t("adminInbox.reopen")}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void patch(selected, { resolved: true })}
                >
                  <CircleCheck /> {t("adminInbox.markResolved")}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
