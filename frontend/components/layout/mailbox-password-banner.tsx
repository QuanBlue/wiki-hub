"use client";

import { MailWarning } from "lucide-react";
import Link from "next/link";

import { useMailSummary } from "@/components/layout/mail-summary-provider";
import { useTranslation } from "@/lib/i18n/context";

/**
 * A prominent strip at the top of every page, shown only to the owner of a
 * mailbox whose password the mail server has stopped accepting. It is not
 * dismissible: while it shows, requests are no longer reaching them by email,
 * and the fix is one dialog away.
 *
 * Other administrators do not see it - by design it is the mailbox owner's to
 * fix, and they are the one who knows the new password.
 */
export function MailboxPasswordBanner() {
  const { t } = useTranslation();
  const { summary } = useMailSummary();

  if (!summary.has_mailbox || summary.health_status !== "auth_failed") {
    return null;
  }

  return (
    <div
      role="alert"
      className="bg-danger-bg text-danger border-danger/40 flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-3 text-sm shadow-sm sm:px-8"
    >
      <MailWarning aria-hidden className="size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t("mailBanner.passwordTitle")}</p>
        <p className="text-foreground/80 mt-0.5">
          {t("mailBanner.passwordBody", {
            email: summary.mailbox_email ?? "",
          })}
        </p>
      </div>
      <Link
        href={`/admin/mail?update=${summary.mailbox_id ?? ""}`}
        className="bg-danger text-danger-foreground hover:bg-danger/90 active:bg-danger/80 focus-visible:ring-ring inline-flex h-8 shrink-0 items-center rounded-md px-3 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        {t("mailBanner.updateNow")}
      </Link>
    </div>
  );
}
