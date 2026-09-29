import { serverGet } from "@/lib/server-api";
import type { AdminAccount, AdminMailbox, MailSummary } from "@/types/api";

/** What an account without an administrator mailbox sees. */
export const NO_MAILBOX: MailSummary = {
  has_mailbox: false,
  mailbox_id: null,
  mailbox_email: null,
  health_status: null,
  health_error: null,
  unread_count: 0,
  can_send_account_mail: false,
};

/**
 * The shell's mail status for the signed-in user.
 *
 * Never throws: this runs on every page, and mail being unreachable (or the
 * backend not yet migrated during a rolling deploy) must not take the page
 * down. Failing to "no mailbox" merely hides the Inbox and bell until the
 * next poll.
 */
export async function getMailSummary(): Promise<MailSummary> {
  try {
    return await serverGet<MailSummary>("/api/v1/admin-mail/summary");
  } catch {
    return NO_MAILBOX;
  }
}

export function listMailboxes(): Promise<AdminMailbox[]> {
  return serverGet<AdminMailbox[]>("/api/v1/admin-mail/mailboxes");
}

/** Every account that currently holds `system_admin`: the only ones a mailbox
 * may be linked to. */
export function listAdministrators(): Promise<AdminAccount[]> {
  return serverGet<AdminAccount[]>("/api/v1/users/administrators");
}
