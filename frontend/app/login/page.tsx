import type { Metadata } from "next";
import { Suspense } from "react";

import { FolderTree, History, Search, ShieldCheck } from "lucide-react";

import { LoginForm } from "@/components/auth/login-form";
import { LogoMark, Wordmark } from "@/components/brand/logo";
import { SITE_NAME } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

// Rendered per request: the login form reads `?next=` from the URL.
export const dynamic = "force-dynamic";

const highlights = [
  {
    icon: FolderTree,
    title: "Organise with spaces",
    description:
      "Group work into spaces with their own page tree, so projects, policies and playbooks stay easy to navigate.",
  },
  {
    icon: Search,
    title: "Find answers faster",
    description:
      "Full-text search across every space turns scattered context into knowledge your team can actually trust.",
  },
  {
    icon: History,
    title: "Track every change",
    description:
      "Full version history on each page lets you compare edits, see who changed what, and restore an earlier draft.",
  },
  {
    icon: ShieldCheck,
    title: "Control who sees what",
    description:
      "Space and page-level permissions keep sensitive documentation restricted to the right people.",
  },
];

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,36rem)]">
      <section className="bg-primary text-primary-foreground relative hidden overflow-hidden px-16 py-16 lg:flex lg:items-center xl:px-20">
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

        <div className="relative mx-auto w-full max-w-lg">
          <Wordmark siteName={SITE_NAME} className="text-lg" />

          <p className="text-primary-foreground/70 mt-14 text-sm font-medium">
            Your team&apos;s shared knowledge
          </p>
          <h1 className="mt-3 text-4xl leading-tight font-semibold tracking-tight text-balance">
            Keep the context behind every decision.
          </h1>
          <p className="text-primary-foreground/70 mt-4 max-w-md text-[0.9375rem] leading-6">
            WikiHub is a calm, organised home for the pages, practices and
            ideas your team relies on — built so documentation stays as easy
            to find as it was to write.
          </p>

          <ul className="mt-12 space-y-5">
            {highlights.map(({ icon: Icon, title, description }) => (
              <li key={title} className="flex items-start gap-3.5">
                <span className="bg-primary-foreground/10 text-primary-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-primary-foreground/65 mt-0.5 max-w-sm text-[0.8125rem] leading-5">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <p className="text-primary-foreground/50 border-primary-foreground/15 mt-12 border-t pt-6 text-xs">
            Made for focused teams that value clarity.
          </p>
        </div>
      </section>

      <section className="bg-surface-sunken flex min-h-screen items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center lg:hidden">
            <Wordmark siteName={SITE_NAME} className="text-base" />
          </div>

          <div className="mb-7 flex flex-col items-center text-center lg:items-start lg:text-left">
            <div className="bg-primary-subtle text-primary hidden size-10 items-center justify-center rounded-lg lg:flex">
              <LogoMark className="size-5" />
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">
              Welcome back
            </h2>
            <p className="text-muted-foreground mt-1.5 text-sm">
              Sign in to continue to {SITE_NAME}.
            </p>
          </div>

          {/* useSearchParams needs a Suspense boundary during prerender. */}
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>

          <p className="text-muted-foreground mt-8 text-center text-xs">
            Trouble signing in? Contact your workspace admin.
          </p>
        </div>
      </section>
    </main>
  );
}
