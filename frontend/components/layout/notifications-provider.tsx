"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { toast } from "sonner";

import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { describeNotification, notificationMeta } from "@/lib/notification-meta";
import { richText } from "@/lib/rich-text";
import type { AppNotification, NotificationSummary, Page } from "@/types/api";

/** Short, so something that happens to you shows up in seconds, not on reload. */
const POLL_INTERVAL_MS = 15_000;
/** At most this many toasts for one burst of new notifications. */
const MAX_TOASTS = 3;

const EMPTY: NotificationSummary = { unread_count: 0, latest_at: null };

interface NotificationsContextValue {
  summary: NotificationSummary;
  /** Re-read now, e.g. after marking notifications read. */
  refresh: () => void;
}

// Without the provider (unit tests, isolated mounts) there is simply nothing new.
const NotificationsContext = createContext<NotificationsContextValue>({
  summary: EMPTY,
  refresh: () => {},
});

export const NOTIFICATIONS_QUERY_KEY = ["notifications", "summary"] as const;

/**
 * Shares one polled copy of the notification status with the bell, so its badge
 * and list agree and only one request per interval is made.
 *
 * When something new arrives it says so with a toast - coloured by how it reads
 * (good news, a change, a removal) - so nobody has to reload the page or open
 * the bell to find out.
 */
export function NotificationsProvider({
  initial,
  children,
}: {
  initial: NotificationSummary;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: () => api.get<NotificationSummary>("/api/v1/notifications/summary"),
    initialData: initial,
    refetchInterval: POLL_INTERVAL_MS,
    // The app-wide defaults are lazy (30s stale, no refetch on focus), which is
    // right for documents but leaves a new notification unseen until a tick.
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
  }, [queryClient]);

  const summary = data ?? initial;
  const latest = summary.latest_at;

  // The newest notification already accounted for. The first value seen is only
  // the baseline: what was already there at load is not "new".
  const seen = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const previous = seen.current;
    seen.current = latest;
    if (previous === undefined || latest === null) return;
    if (previous !== null && new Date(latest) <= new Date(previous)) return;

    let active = true;
    void api
      .get<Page<AppNotification>>("/api/v1/notifications?unread=true&limit=5")
      .then((page) => {
        if (!active) return;
        const fresh = page.items
          .filter(
            (item) =>
              previous === null ||
              new Date(item.created_at) > new Date(previous),
          )
          .slice(0, MAX_TOASTS)
          .reverse();
        for (const item of fresh) {
          const link = item.link;
          toast[notificationMeta(item.kind).tone](richText(describeNotification(t, item)), {
            action: link
              ? { label: t("notifications.openNotification"), onClick: () => router.push(link) }
              : undefined,
          });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [latest, router, t]);

  const value = useMemo(() => ({ summary, refresh }), [summary, refresh]);

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  return useContext(NotificationsContext);
}
