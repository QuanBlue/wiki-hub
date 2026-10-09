"use client";

import { Bell, BellRing, CheckCheck, Inbox } from "lucide-react";
import Link from "next/link";
import {
  type MouseEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useMailSummary } from "@/components/layout/mail-summary-provider";
import { useNotifications } from "@/components/layout/notifications-provider";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import {
  describeNotification,
  notificationMeta,
  type NotificationTone,
} from "@/lib/notification-meta";
import { formatRelative } from "@/lib/relative-time";
import { richText } from "@/lib/rich-text";
import { cn } from "@/lib/utils";
import type { AppNotification, Page } from "@/types/api";

const LIST_SIZE = 20;
/** How many rows show before the list scrolls instead of growing further. */
const MAX_VISIBLE_ROWS = 5;

/** The count shown on the badge: two digits, then "99+". */
export function formatBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/**
 * A ``…#comment-<id>`` link to the page already open: Next would only swap
 * the URL (no ``hashchange``), so a second visit - or a reply hidden in a
 * collapsed thread - would not scroll. Set the hash ourselves and announce it;
 * the page's comments open the thread and scroll to it. Other links, and
 * new-tab clicks, navigate as usual.
 */
function revealOnSamePage(event: MouseEvent, link: string) {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = new URL(link, window.location.href);
  if (
    !target.hash ||
    target.origin !== window.location.origin ||
    target.pathname !== window.location.pathname ||
    target.search !== window.location.search
  ) {
    return;
  }
  event.preventDefault();
  // Keep Next's history state so Back still works within the app; the same
  // link twice does not stack identical history entries.
  if (target.hash !== window.location.hash) {
    window.history.pushState(window.history.state, "", target.hash);
  }
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

const TONE_CLASSES: Record<NotificationTone, string> = {
  success: "bg-success-bg text-success",
  info: "bg-primary-subtle text-primary",
  warning: "bg-warning-bg text-warning",
};

/**
 * The top bar's bell: everything that has happened to the signed-in person -
 * access granted or removed, group changes, a password reset by an
 * administrator, and, for an administrator, new requests - newest first.
 */
export function NotificationBell() {
  const { t, locale } = useTranslation();
  const { summary, refresh } = useNotifications();
  const { summary: mail } = useMailSummary();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [failed, setFailed] = useState(false);
  const unread = summary.unread_count;
  const listRef = useRef<HTMLUListElement>(null);
  const [listMaxHeight, setListMaxHeight] = useState<number | undefined>(undefined);

  // Re-read whenever the menu opens, or something new arrives while it is open.
  useEffect(() => {
    if (!open) return;
    let active = true;
    void api
      .get<Page<AppNotification>>(`/api/v1/notifications?limit=${LIST_SIZE}`)
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setFailed(false);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [open, summary.latest_at, unread]);

  // Cap the list at exactly MAX_VISIBLE_ROWS rows' worth of real, rendered
  // height (not a guessed pixel figure) before it scrolls - rows are not a
  // fixed height, since longer text wraps onto a second line. A
  // ResizeObserver keeps this correct if a row's height changes after the
  // fact (e.g. a font swap reflows the text).
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) {
      setListMaxHeight(undefined);
      return;
    }

    function recompute() {
      const node = listRef.current;
      if (!node) return;
      const rows = Array.from(node.children) as HTMLElement[];
      if (rows.length <= MAX_VISIBLE_ROWS) {
        setListMaxHeight(undefined);
        return;
      }
      const top = node.getBoundingClientRect().top;
      const cutoff = rows[MAX_VISIBLE_ROWS - 1]!.getBoundingClientRect().bottom;
      setListMaxHeight(cutoff - top);
    }

    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(el);
    return () => observer.disconnect();
  }, [items]);

  async function markRead(item: AppNotification) {
    if (item.read_at) return;
    setItems((current) =>
      current
        ? current.map((row) =>
            row.id === item.id
              ? { ...row, read_at: new Date().toISOString() }
              : row,
          )
        : current,
    );
    try {
      await api.patch(`/api/v1/notifications/${item.id}`, { read: true });
    } finally {
      refresh();
    }
  }

  async function markAllRead() {
    const now = new Date().toISOString();
    setItems((current) =>
      current ? current.map((row) => ({ ...row, read_at: row.read_at ?? now })) : current,
    );
    try {
      await api.post("/api/v1/notifications/read-all");
    } finally {
      refresh();
    }
  }

  const label =
    unread > 0
      ? t("topbar.notificationsUnread", { count: unread })
      : t("topbar.notifications");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={label}
          title={label}
        >
          {unread > 0 ? (
            <BellRing className="size-4" aria-hidden />
          ) : (
            <Bell className="size-4" aria-hidden />
          )}
          {unread > 0 ? (
            <span
              aria-hidden
              className="bg-danger text-danger-foreground ring-background absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold ring-2"
            >
              {formatBadgeCount(unread)}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-[26rem] max-w-[calc(100vw-1.5rem)] overflow-hidden p-0"
      >
        <div className="border-border flex items-center justify-between gap-3 border-b px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{t("notifications.title")}</h2>
            {unread > 0 ? (
              <span className="bg-primary-subtle text-primary rounded-full px-2 py-0.5 text-[11px] font-semibold">
                {t("notifications.unreadCount", { count: unread })}
              </span>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={unread === 0}
            onClick={() => void markAllRead()}
          >
            <CheckCheck /> {t("notifications.markAllRead")}
          </Button>
        </div>

        {/* Capped at MAX_VISIBLE_ROWS rows of *actual* rendered height (see the
         * ResizeObserver above) - rows are not a fixed height, since longer
         * notification text wraps onto a second line. */}
        <div className="overflow-y-auto" style={listMaxHeight ? { maxHeight: listMaxHeight } : undefined}>
          {failed && items === null ? (
            <p role="alert" className="text-danger px-4 py-8 text-center text-sm">
              {t("notifications.loadError")}
            </p>
          ) : items === null ? (
            <ul aria-hidden className="divide-border divide-y">
              {[0, 1, 2].map((index) => (
                <li key={index} className="flex gap-2.5 px-3.5 py-2.5">
                  <span className="bg-surface-sunken size-8 shrink-0 animate-pulse rounded-lg" />
                  <span className="flex-1 space-y-2">
                    <span className="bg-surface-sunken block h-3 w-11/12 animate-pulse rounded" />
                    <span className="bg-surface-sunken block h-3 w-1/3 animate-pulse rounded" />
                  </span>
                </li>
              ))}
            </ul>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-8 text-center">
              <span className="bg-surface-sunken text-muted-foreground flex size-10 items-center justify-center rounded-full">
                <Bell className="size-5" aria-hidden />
              </span>
              <p className="mt-3 text-sm font-medium">{t("notifications.empty")}</p>
              <p className="text-muted-foreground mt-1 max-w-64 text-xs">
                {t("notifications.emptyHint")}
              </p>
            </div>
          ) : (
            <ul ref={listRef} className="divide-border divide-y">
              {items.map((item) => {
                const meta = notificationMeta(item.kind);
                const isUnread = item.read_at === null;
                const body = (
                  <>
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg",
                        TONE_CLASSES[meta.tone],
                      )}
                    >
                      <meta.icon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block text-[13px] leading-[1.35] wrap-break-word",
                          isUnread ? "text-foreground font-medium" : "text-muted-foreground",
                        )}
                      >
                        {richText(describeNotification(t, item))}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block text-[11px]">
                        {formatRelative(item.created_at, locale)}
                      </span>
                    </span>
                    {isUnread ? (
                      <span
                        role="img"
                        aria-label={t("notifications.unread")}
                        className="bg-primary mt-1.5 size-2 shrink-0 rounded-full"
                      />
                    ) : null}
                  </>
                );
                const rowClass = cn(
                  "focus-visible:ring-ring flex w-full cursor-pointer gap-2.5 px-3.5 py-2.5 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
                  isUnread
                    ? "bg-primary-subtle/40 hover:bg-primary-subtle/70"
                    : "hover:bg-surface-hover",
                  "active:bg-surface-selected",
                );
                return (
                  <li key={item.id}>
                    {item.link ? (
                      <Link
                        href={item.link}
                        className={rowClass}
                        onClick={(event) => {
                          void markRead(item);
                          setOpen(false);
                          revealOnSamePage(event, item.link!);
                        }}
                      >
                        {body}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className={rowClass}
                        onClick={() => void markRead(item)}
                      >
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {mail.has_inbox ? (
          <Link
            href="/admin/inbox"
            onClick={() => setOpen(false)}
            className="border-border text-primary hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring flex items-center justify-center gap-2 border-t px-4 py-2 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
          >
            <Inbox className="size-4" aria-hidden />
            {t("notifications.openInbox")}
          </Link>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
