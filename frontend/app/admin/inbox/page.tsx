import type { Metadata } from "next";

import { InboxList } from "@/components/admin/inbox-list";
import { getMailSummary } from "@/lib/admin-mail";
import { getServerLocale } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Requests" };
export const dynamic = "force-dynamic";

export default async function AdminInboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [summary, { t }, params] = await Promise.all([
    getMailSummary(),
    getServerLocale(),
    searchParams,
  ]);
  const openId = typeof params.request === "string" ? params.request : undefined;

  return (
    <div className="space-y-6">
      <header className="border-border border-b pb-5">
        <p className="text-primary text-xs font-semibold tracking-[0.08em] uppercase">
          {t("nav.administration")}
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">
          {t("adminInbox.title")}
        </h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          {t("adminInbox.description")}
        </p>
      </header>

      {summary.has_inbox ? (
        <InboxList openId={openId} />
      ) : (
        // Every system administrator has the Requests page (mailbox or not);
        // the sidebar hides the link for everyone else, so this is only
        // reached by typing the URL.
        <div className="border-border bg-surface rounded-xl border p-6 shadow-sm">
          <p className="font-semibold">{t("adminInbox.noMailboxTitle")}</p>
          <p className="text-muted-foreground mt-1 max-w-xl text-sm">
            {t("adminInbox.noMailboxBody")}
          </p>
        </div>
      )}
    </div>
  );
}
