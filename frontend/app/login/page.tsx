import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ShieldCheck } from "lucide-react";

import { AuthPanels } from "@/components/auth/auth-panels";
import { LoginShowcase } from "@/components/auth/login-showcase";
import { Wordmark } from "@/components/brand/logo";
import { LanguageToggle } from "@/components/layout/language-toggle";
import { SystemAnnouncementBanner } from "@/components/layout/system-announcement-banner";
import { SITE_NAME } from "@/lib/env";
import { getServerLocale } from "@/lib/i18n/server";
import { resolveLoginPanel } from "@/lib/login-panel";
import { serverGet } from "@/lib/server-api";
import type { InstanceInfo, LoginPanel, SystemAnnouncement } from "@/types/api";

export const metadata: Metadata = { title: "Sign in" };

// Rendered per request: the login form reads `?next=` from the URL, and the
// copy follows the locale cookie.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const { t, locale } = await getServerLocale();
  let publicAnnouncement: SystemAnnouncement | null = null;
  let loginPanel: LoginPanel | undefined;
  let loginImageUrl: string | null | undefined;
  try {
    const meta = await serverGet<InstanceInfo>("/api/v1/meta");
    publicAnnouncement = meta?.announcement ?? null;
    loginPanel = meta?.login_panel;
    loginImageUrl = meta?.login_image_url;
  } catch {
    // Backend unreachable during SSR: render login form without banner.
  }

  const showcase = resolveLoginPanel(loginPanel, loginImageUrl, locale, t);

  return (
    <main className="grid min-h-dvh lg:h-dvh lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] lg:overflow-hidden">
      <LoginShowcase panel={showcase} siteName={SITE_NAME} />

      <section className="bg-surface-sunken/60 relative flex min-h-full flex-col justify-between overflow-x-hidden overflow-y-auto lg:overflow-hidden">
        {/* Subtle dot matrix texture across the canvas */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_50%,transparent_100%)] [background-size:24px_24px] opacity-70"
        />

        {/* Ambient atmospheric lighting */}
        <div
          aria-hidden="true"
          className="bg-primary/6 pointer-events-none absolute -top-32 right-0 size-96 rounded-full blur-3xl"
        />
        <div
          aria-hidden="true"
          className="bg-primary/4 pointer-events-none absolute -bottom-32 left-0 size-96 rounded-full blur-3xl"
        />

        {/* Decorative isometric geometry mirroring the left panel's motif */}
        <svg
          viewBox="0 0 400 400"
          fill="none"
          aria-hidden="true"
          className="text-primary/10 pointer-events-none absolute -right-16 -bottom-16 h-80 w-80 max-sm:hidden"
        >
          <path
            d="M90 150 200 95 310 150 200 205Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          <path
            d="M90 205 200 260 310 205"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M90 260 200 315 310 260"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="2 4"
          />
        </svg>

        {/* Floating utility: language switcher in top right corner */}
        <div className="absolute top-3.5 right-4 z-20 sm:top-5 sm:right-6">
          <LanguageToggle />
        </div>

        {/* Center content: Login Card */}
        <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-3 sm:px-6">
          <div className="w-full max-w-[27rem] [@media(max-height:760px)]:max-w-[25.5rem]">
            <div className="mb-4 flex justify-center sm:mb-6 lg:hidden">
              <Wordmark siteName={SITE_NAME} className="text-base" />
            </div>

            <div className="border-border/80 bg-surface overflow-hidden rounded-2xl border shadow-lg shadow-black/[0.03]">
              <div className="p-5 sm:p-7 [@media(max-height:750px)]:p-4.5 [@media(max-height:850px)]:p-5.5">
                {/* useSearchParams needs a Suspense boundary during prerender. */}
                <Suspense fallback={null}>
                  <AuthPanels
                    siteName={SITE_NAME}
                    initialView={view === "contact" ? "contact" : "login"}
                  />
                </Suspense>
                {/* Full width of the card's content, inset from its edges. */}
                {publicAnnouncement ? (
                  <SystemAnnouncementBanner
                    announcement={publicAnnouncement}
                    allowDismiss={false}
                    className="mt-4 w-full rounded-xl border px-4 py-2.5 text-xs shadow-2xs"
                  />
                ) : null}
              </div>
            </div>
            {/* A notice, not a consent box: signing in is not a tick of agreement. */}
            <p className="text-muted-foreground mt-3 px-2 text-center text-xs leading-5">
              {t("auth.privacyNotice", { siteName: SITE_NAME })}{" "}
              <Link
                href="/privacy"
                className="text-primary focus-visible:ring-ring rounded-sm underline-offset-4 transition-colors duration-150 hover:underline focus-visible:ring-2 focus-visible:outline-none active:opacity-80"
              >
                {t("auth.privacyLink")}
              </Link>
              .
            </p>
          </div>
        </div>

        {/* Footer info */}
        <footer className="relative z-10 shrink-0 py-3 text-center sm:py-4 [@media(max-height:760px)]:py-2">
          <div className="text-muted-foreground/75 inline-flex items-center gap-1.5 text-xs">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            <span>{SITE_NAME} &middot; Enterprise Workspace</span>
          </div>
        </footer>
      </section>
    </main>
  );
}
