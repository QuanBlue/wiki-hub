import { serverGet } from "@/lib/server-api";
import type { NotificationSummary } from "@/types/api";

export const NO_NOTIFICATIONS: NotificationSummary = {
  unread_count: 0,
  latest_at: null,
};

/**
 * The shell's notification status for the signed-in person.
 *
 * Never throws: this runs on every page, and notifications being unavailable
 * (or the backend not yet migrated during a rolling deploy) must not take the
 * page down; the bell just shows nothing new until the next poll.
 */
export async function getNotificationSummary(): Promise<NotificationSummary> {
  try {
    return await serverGet<NotificationSummary>("/api/v1/notifications/summary");
  } catch {
    return NO_NOTIFICATIONS;
  }
}
