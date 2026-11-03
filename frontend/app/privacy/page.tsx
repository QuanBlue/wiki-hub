import type { Metadata } from "next";
import Link from "next/link";

import { ArrowLeft } from "lucide-react";

import { Wordmark } from "@/components/brand/logo";
import { AppShell } from "@/components/layout/app-shell";
import { LanguageToggle } from "@/components/layout/language-toggle";
import { PrivacyPolicy } from "@/components/legal/privacy-policy";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";
import { getServerLocale } from "@/lib/i18n/server";
import { serverGet } from "@/lib/server-api";
import type { InstanceInfo } from "@/types/api";

export const metadata: Metadata = { title: "Personal data" };

// Public (see PUBLIC_PATHS in middleware.ts): someone has to be able to read
// this before signing in. Signed-in readers get it inside the normal shell.
export const dynamic = "force-dynamic";

export default async function PrivacyRoute() {
  const [user, { locale, t }] = await Promise.all([
    getCurrentUser(),
    getServerLocale(),
  ]);
  let siteName = SITE_NAME;
  try {
    const meta = await serverGet<InstanceInfo>("/api/v1/meta");
    if (meta?.site_name) siteName = meta.site_name;
  } catch {
    // Backend unreachable during SSR: the build-time name still reads correctly.
  }

  const policy = (
    <PrivacyPolicy
      locale={locale}
      siteName={siteName}
      signedIn={Boolean(user)}
    />
  );
  if (user) {
    return (
      <AppShell fullWidth siteName={SITE_NAME} user={user}>
        {policy}
      </AppShell>
    );
  }

  return (
    <div className="bg-background min-h-dvh">
      <header className="h-topbar topbar-on-primary sticky top-0 z-30">
        <div className="topbar-inner flex h-full items-center justify-between gap-3 px-4">
          <Link
            href="/login"
            className="hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring rounded-md px-1 py-1 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            <Wordmark siteName={siteName} />
          </Link>
          <div className="flex items-center gap-2">
            <LanguageToggle />
            <Link
              href="/login"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              <ArrowLeft aria-hidden="true" />
              {t("contactAdmin.backToSignIn")}
            </Link>
          </div>
        </div>
      </header>
      <main>{policy}</main>
    </div>
  );
}
