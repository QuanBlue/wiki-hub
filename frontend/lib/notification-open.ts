import { api, ApiError } from "@/lib/api-client";

/**
 * Asks the server to open a notification: it is marked read, and if what it
 * points at (a comment, page, space, request) has been deleted since, the
 * notification is removed and this answers ``false`` - the caller says so in a
 * toast instead of navigating to a missing page.
 *
 * Any other failure (offline, a hiccup) answers ``true``: the destination's own
 * page can report what is wrong with it.
 */
export async function openNotificationTarget(id: string): Promise<boolean> {
  try {
    await api.post(`/api/v1/notifications/${id}/open`);
    return true;
  } catch (error) {
    return !(error instanceof ApiError && error.status === 404);
  }
}
