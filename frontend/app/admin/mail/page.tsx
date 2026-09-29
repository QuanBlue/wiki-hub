import type { Metadata } from "next";

import { MailboxPanel } from "@/components/admin/mailbox-panel";
import { listAdministrators, listMailboxes } from "@/lib/admin-mail";
import { getCurrentUser } from "@/lib/auth";
import { getServerLocale } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Mailboxes" };
export const dynamic = "force-dynamic";

export default async function AdminMailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [me, { t }, params] = await Promise.all([
    getCurrentUser(),
    getServerLocale(),
    searchParams,
  ]);
  // The layout also admits `manage_users`/`manage_groups` holders; neither
  // unlocks mailboxes - the backend restricts them to `system_admin`.
  const isSystemAdmin =
    me?.is_superuser || me?.global_permissions.includes("system_admin");

  if (!isSystemAdmin) {
    return (
      <div className="border-border bg-surface rounded-xl border p-6 shadow-sm">
        <p className="font-semibold">
          {t("adminShared.permissionRequiredTitle")}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("adminShared.permissionRequiredBody", {
            feature: t("adminMail.permissionFeature"),
            permission: t("adminShared.systemAdministratorLabel"),
          })}
        </p>
      </div>
    );
  }

  const [mailboxes, administrators] = await Promise.all([
    listMailboxes(),
    listAdministrators(),
  ]);
  const update = typeof params.update === "string" ? params.update : undefined;

  return (
    <div className="space-y-6">
      <header className="border-border border-b pb-5">
        <p className="text-primary text-xs font-semibold tracking-[0.08em] uppercase">
          {t("nav.administration")}
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">
          {t("adminMail.title")}
        </h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          {t("adminMail.description")}
        </p>
      </header>
      <MailboxPanel
        initialMailboxes={mailboxes}
        administrators={administrators}
        initialUpdateId={update}
        currentUserId={me?.id ?? ""}
        currentUserIsProtected={me?.is_protected ?? false}
      />
    </div>
  );
}
