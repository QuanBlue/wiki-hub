"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo } from "react";

import { api } from "@/lib/api-client";
import type { MailSummary } from "@/types/api";

/** Short, so a new request shows up in seconds rather than after a refresh. */
const POLL_INTERVAL_MS = 15_000;

const EMPTY: MailSummary = {
  has_mailbox: false,
  has_inbox: false,
  mailbox_id: null,
  mailbox_email: null,
  health_status: null,
  health_error: null,
  unread_count: 0,
  latest_request_at: null,
  can_send_account_mail: false,
};

interface MailSummaryContextValue {
  summary: MailSummary;
  /** Re-read now, e.g. after marking requests read or fixing a password. */
  refresh: () => void;
}

// The default is "no mailbox" so anything rendered without the provider (unit
// tests, isolated mounts) simply shows no Inbox, bell or banner.
const MailSummaryContext = createContext<MailSummaryContextValue>({
  summary: EMPTY,
  refresh: () => {},
});

export const MAIL_SUMMARY_QUERY_KEY = ["admin-mail", "summary"] as const;

/**
 * Shares one polled copy of the mail status with the sidebar's Inbox entry,
 * the top bar's bell and the password banner, so they always agree and only
 * one request per interval is made however many of them are on screen.
 *
 * It re-reads every few seconds while the tab is visible, and straight away
 * when the tab regains focus, so the Inbox entry and the password banner do not
 * wait for a reload. (Telling the person a request arrived is the bell's job:
 * see `NotificationsProvider`.)
 *
 * `poll` is false for accounts that cannot hold a mailbox: there is nothing
 * to learn, so they never make the request.
 */
export function MailSummaryProvider({
  initial,
  poll,
  children,
}: {
  initial: MailSummary;
  poll: boolean;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: MAIL_SUMMARY_QUERY_KEY,
    queryFn: () => api.get<MailSummary>("/api/v1/admin-mail/summary"),
    initialData: initial,
    enabled: poll,
    refetchInterval: poll ? POLL_INTERVAL_MS : false,
    // The app-wide defaults are lazy (30s stale, no refetch on focus), which is
    // right for documents but leaves a new request unseen until the next tick.
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: MAIL_SUMMARY_QUERY_KEY });
  }, [queryClient]);

  const summary = data ?? initial;

  const value = useMemo(() => ({ summary, refresh }), [summary, refresh]);

  return (
    <MailSummaryContext.Provider value={value}>
      {children}
    </MailSummaryContext.Provider>
  );
}

export function useMailSummary(): MailSummaryContextValue {
  return useContext(MailSummaryContext);
}
