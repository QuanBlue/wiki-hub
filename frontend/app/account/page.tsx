import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccountSettings } from "@/components/account/account-settings";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";
import { getServerLocale } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Your account" };
export const dynamic = "force-dynamic";

/** Self-service, so it lives outside /admin, which non-admins cannot reach. */
export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { t } = await getServerLocale();

  return (
    <AppShell siteName={SITE_NAME} user={user} fullWidth>
      <div className="w-full space-y-8">
        <header className="border-border border-b pb-5">
          <p className="text-primary text-xs font-semibold tracking-[0.12em] uppercase">
            {t("account.pageEyebrow")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t("account.pageTitle")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("account.pageDescription")}
          </p>
        </header>
        <AccountSettings user={user} />
      </div>
    </AppShell>
  );
}
