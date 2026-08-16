import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { HelpPage } from "@/components/help/help-page";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";

export const metadata: Metadata = { title: "Help" };
export const dynamic = "force-dynamic";

export default async function HelpRoute() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell fullWidth siteName={SITE_NAME} user={user}>
      <HelpPage />
    </AppShell>
  );
}
