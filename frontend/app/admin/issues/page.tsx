import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { IssuesList } from "@/components/admin/issues-list";
import { getCurrentUser } from "@/lib/auth";
import { getServerLocale } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Issues" };
export const dynamic = "force-dynamic";

/**
 * Reported issues. The backend is the real gate; this only keeps the page from
 * rendering for someone who cannot use it: a superuser, a system administrator,
 * or anyone granted `manage_issues`.
 */
export default async function AdminIssuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, { t }, params] = await Promise.all([
    getCurrentUser(),
    getServerLocale(),
    searchParams,
  ]);
  if (!user) redirect("/login");
  const allowed =
    user.is_superuser ||
    user.global_permissions.includes("system_admin") ||
    user.global_permissions.includes("manage_issues");
  if (!allowed) redirect("/admin");

  const openId = typeof params.issue === "string" ? params.issue : undefined;

  return (
    <div className="space-y-6">
      <header className="border-border border-b pb-5">
        <p className="text-primary text-xs font-semibold tracking-[0.08em] uppercase">
          {t("nav.administration")}
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">
          {t("adminIssues.pageTitle")}
        </h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          {t("adminIssues.pageDescription")}
        </p>
      </header>

      <IssuesList openId={openId} />
    </div>
  );
}
