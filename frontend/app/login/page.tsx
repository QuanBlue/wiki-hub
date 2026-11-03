import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { FolderTree, ShieldCheck, Sparkles } from "lucide-react";

import { AuthPanels } from "@/components/auth/auth-panels";
import { Wordmark } from "@/components/brand/logo";
import { LanguageToggle } from "@/components/layout/language-toggle";
import { SystemAnnouncementBanner } from "@/components/layout/system-announcement-banner";
import { SITE_NAME } from "@/lib/env";
import { getServerLocale } from "@/lib/i18n/server";
import { serverGet } from "@/lib/server-api";
import type { InstanceInfo, SystemAnnouncement } from "@/types/api";

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
  const { t } = await getServerLocale();
  let publicAnnouncement: SystemAnnouncement | null = null;
  try {
    const meta = await serverGet<InstanceInfo>("/api/v1/meta");
    publicAnnouncement = meta?.announcement ?? null;
  } catch {
    // Backend unreachable during SSR: render login form without banner.
  }

  const features = [
    {
      icon: Sparkles,
      title: t("auth.featAskTitle"),
      description: t("auth.featAskDescription"),
    },
    {
      icon: FolderTree,
      title: t("auth.featSpacesTitle"),
      description: t("auth.featSpacesDescription"),
    },
    {
      icon: ShieldCheck,
      title: t("auth.featControlTitle"),
      description: t("auth.featControlDescription"),
    },
  ];

  return (
    <main className="grid min-h-dvh lg:h-dvh lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] lg:overflow-hidden">
      <section className="bg-primary text-primary-foreground relative hidden overflow-hidden px-8 py-8 lg:sticky lg:top-0 lg:flex lg:h-full lg:items-center xl:px-14 xl:py-12">
        {/* Decorative echo of the brand mark's three converging layers - purely
            atmospheric, so it is hidden from assistive tech. */}
        <svg
          viewBox="0 0 400 400"
          fill="none"
          aria-hidden="true"
          className="text-primary-foreground pointer-events-none absolute -top-24 -right-32 h-120 w-120"
        >
          <path
            d="M90 150 200 95 310 150 200 205Z"
            stroke="currentColor"
            strokeOpacity="0.14"
            strokeWidth="2"
          />
          <path
            d="M90 205 200 260 310 205"
            stroke="currentColor"
            strokeOpacity="0.1"
            strokeWidth="2"
          />
          <path
            d="M90 260 200 315 310 260"
            stroke="currentColor"
            strokeOpacity="0.07"
            strokeWidth="2"
          />
        </svg>

        <div className="relative mx-auto flex h-full max-h-[52rem] w-full max-w-2xl flex-col justify-between gap-4 lg:gap-6 [@media(max-height:850px)]:gap-3">
          <Wordmark siteName={SITE_NAME} className="text-lg" />

          <div>
            <p className="text-primary-foreground/70 text-sm font-medium">
              {t("auth.tagline")}
            </p>
            <h1 className="mt-2.5 text-3xl leading-tight font-semibold tracking-tight text-balance sm:mt-3 xl:text-4xl">
              {t("auth.headline")}
            </h1>
            <p className="text-primary-foreground/70 mt-3 max-w-xl text-[0.875rem] leading-6 sm:mt-4 xl:text-[0.9375rem] [@media(max-height:680px)]:hidden">
              {t("auth.subheading")}
            </p>
          </div>

          {/* A real capture of the application (docs/demo/assets), cropped to its top-left corner:
              top bar, page tree and the start of a page. */}
          <div className="border-primary-foreground/20 aspect-[16/8.5] overflow-hidden rounded-xl border shadow-2xl [@media(max-height:720px)]:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/login/workspace.png"
              alt={t("auth.previewAlt")}
              width={1420}
              height={900}
              className="bg-surface w-full object-cover object-left-top"
            />
          </div>

          <div>
            <ul className="grid grid-cols-3 gap-x-4 gap-y-2 xl:gap-x-6">
              {features.map(({ icon: Icon, title, description }) => (
                <li key={title}>
                  <div className="flex items-center gap-2.5">
                    <span className="bg-primary-foreground/10 grid size-7 shrink-0 place-items-center rounded-md">
                      <Icon className="size-3.5" aria-hidden="true" />
                    </span>
                    <p className="text-sm leading-tight font-semibold">
                      {title}
                    </p>
                  </div>
                  <p className="text-primary-foreground/65 mt-2 text-xs leading-5 [@media(max-height:800px)]:hidden">
                    {description}
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-primary-foreground/50 border-primary-foreground/15 mt-4 border-t pt-3 text-xs sm:mt-5 sm:pt-4 [@media(max-height:650px)]:hidden">
              {t("auth.footerTagline")}
            </p>
          </div>
        </div>
      </section>

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
