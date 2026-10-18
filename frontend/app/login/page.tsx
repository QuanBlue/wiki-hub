import type { Metadata } from "next";
import { Suspense } from "react";

import { FolderTree, ShieldCheck, Sparkles } from "lucide-react";

import { AuthPanels } from "@/components/auth/auth-panels";
import { Wordmark } from "@/components/brand/logo";
import { SITE_NAME } from "@/lib/env";
import { getServerLocale } from "@/lib/i18n/server";

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
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,36rem)]">
      <section className="bg-primary text-primary-foreground relative hidden overflow-hidden px-12 py-12 lg:sticky lg:top-0 lg:flex lg:h-screen lg:items-center xl:px-16">
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

        <div className="relative mx-auto flex h-full max-h-[56rem] w-full max-w-2xl flex-col justify-between gap-8">
          <Wordmark siteName={SITE_NAME} className="text-lg" />

          <div>
            <p className="text-primary-foreground/70 text-sm font-medium">
              {t("auth.tagline")}
            </p>
            <h1 className="mt-3 text-4xl leading-tight font-semibold tracking-tight text-balance">
              {t("auth.headline")}
            </h1>
            <p className="text-primary-foreground/70 mt-4 max-w-xl text-[0.9375rem] leading-6 [@media(max-height:600px)]:hidden">
              {t("auth.subheading")}
            </p>
          </div>

          {/* A real capture of the application (docs/demo/assets), cropped to its top-left corner:
              top bar, page tree and the start of a page. */}
          <div className="border-primary-foreground/20 aspect-[16/8.5] overflow-hidden rounded-xl border shadow-2xl [@media(max-height:700px)]:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/login/workspace.png"
              alt={t("auth.previewAlt")}
              width={1430}
              height={900}
              className="bg-surface w-full object-cover object-left-top"
            />
          </div>

          <div>
            <ul className="grid grid-cols-3 gap-x-6 gap-y-2">
              {features.map(({ icon: Icon, title, description }) => (
                <li key={title}>
                  <div className="flex items-center gap-2.5">
                    <span className="bg-primary-foreground/10 grid size-7 shrink-0 place-items-center rounded-md">
                      <Icon className="size-3.5" aria-hidden="true" />
                    </span>
                    <p className="text-sm leading-tight font-semibold">{title}</p>
                  </div>
                  <p className="text-primary-foreground/65 mt-2 text-xs leading-5 [@media(max-height:820px)]:hidden">
                    {description}
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-primary-foreground/50 border-primary-foreground/15 mt-5 border-t pt-4 text-xs [@media(max-height:640px)]:hidden">
              {t("auth.footerTagline")}
            </p>
          </div>
        </div>
      </section>

      <section className="bg-surface-sunken flex min-h-screen items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center lg:hidden">
            <Wordmark siteName={SITE_NAME} className="text-base" />
          </div>

          {/* useSearchParams needs a Suspense boundary during prerender. */}
          <Suspense fallback={null}>
            <AuthPanels
              siteName={SITE_NAME}
              initialView={view === "contact" ? "contact" : "login"}
            />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
