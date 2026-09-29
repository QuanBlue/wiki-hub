"use client";

import { Mail, MailWarning } from "lucide-react";

import { useMailSummary } from "@/components/layout/mail-summary-provider";
import { api } from "@/lib/api-client";

/**
 * Email someone the sign-in details for an account an administrator just
 * created, or a password they just reset, by hand in Users - a follow-up
 * request, not a flag on the create/reset call itself, so a failed send never
 * blocks the account change that already succeeded, and the caller decides
 * for itself how (or whether) to tell the administrator about the outcome.
 */
export async function notifyAccountEmail(
  mode: "created" | "reset",
  userId: string,
  password: string,
): Promise<{ email_sent: boolean; email_error: string | null } | null> {
  try {
    return await api.post<{ email_sent: boolean; email_error: string | null }>(
      `/api/v1/admin-mail/notify-${mode === "created" ? "account-created" : "password-reset"}`,
      {
        user_id: userId,
        password,
        login_url: `${window.location.origin}/login`,
      },
    );
  } catch {
    return null;
  }
}

/**
 * Email someone that their account was just made a WikiHub administrator, by
 * hand in Users - the same follow-up-request shape as `notifyAccountEmail`.
 */
export async function notifyAdminGranted(
  userId: string,
): Promise<{ email_sent: boolean; email_error: string | null } | null> {
  try {
    return await api.post<{ email_sent: boolean; email_error: string | null }>(
      "/api/v1/admin-mail/notify-admin-granted",
      { user_id: userId, login_url: `${window.location.origin}/login` },
    );
  } catch {
    return null;
  }
}

/**
 * Email someone that they were added to, or removed from, a space, from the
 * Access tab's user permission matrix - the same follow-up-request shape as
 * `notifyAccountEmail`.
 */
export async function notifySpaceAccess(
  userId: string,
  spaceKey: string,
  added: boolean,
): Promise<{ email_sent: boolean; email_error: string | null } | null> {
  try {
    return await api.post<{ email_sent: boolean; email_error: string | null }>(
      "/api/v1/admin-mail/notify-space-access",
      {
        user_id: userId,
        space_key: spaceKey,
        added,
        login_url: `${window.location.origin}/login`,
      },
    );
  } catch {
    return null;
  }
}

/** Whether the signed-in administrator has a mailbox that can actually send -
 * not just one that exists, since a mailbox that has never connected (or has
 * lost its connection) would just fail the same way every other send from it
 * already does. Independent of "Receive requests" (`has_mailbox`): that switch
 * only decides whether this account gets an Inbox, not whether its own
 * mailbox can send a message it is composing right now. */
export function useCanEmailAccounts(): boolean {
  const { summary } = useMailSummary();
  return summary.can_send_account_mail;
}

/**
 * A quiet heads-up that the email is about to be sent automatically - not a
 * checkbox to remember to tick. An administrator who has a working mailbox
 * gets no choice in the matter (there is nothing to opt into or forget), only
 * a note saying so; one without a working mailbox sees nothing here, since
 * the ordinary "share it yourself" guidance already covers that case.
 */
export function AccountEmailNotice({ mode }: { mode: "created" | "reset" | "admin" }) {
  const { summary } = useMailSummary();
  if (!summary.can_send_account_mail) return null;

  const sentence =
    mode === "created"
      ? "WikiHub will also email the sign-in details to them automatically"
      : mode === "reset"
        ? "WikiHub will also email the new password to them automatically"
        : "WikiHub will also let them know by email automatically";

  // Sent from this administrator's own mailbox when it is actually
  // connected; otherwise from another connected administrator's, picked
  // automatically - see `_resolve_sender` on the backend. Which one that
  // will be is not known in advance, so it is never named here.
  const source =
    summary.health_status === "ok"
      ? `, from your mailbox (${summary.mailbox_email}).`
      : ", relayed through another administrator's connected mailbox.";

  return (
    <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
      <Mail className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {sentence}
      {source}
    </p>
  );
}

/**
 * The other half of the story `AccountEmailNotice` tells: without a working
 * mailbox, none of this happens automatically, and unlike a freshly created
 * or reset password - which stays right there on screen for the
 * administrator to copy - a role or a space's access has nothing to show
 * afterwards, so silence here reads as "it's handled" rather than "you still
 * need to tell them". `children` is what to tell them, e.g. "tell them
 * yourself that they can now sign in".
 */
export function NoMailboxEmailNotice({ children }: { children: React.ReactNode }) {
  const { summary } = useMailSummary();
  if (summary.can_send_account_mail) return null;

  return (
    <p className="text-warning flex items-start gap-1.5 text-xs">
      <MailWarning className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      No mailbox connected, so WikiHub can&apos;t email this automatically - {children}
    </p>
  );
}
