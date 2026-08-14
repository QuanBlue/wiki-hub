import type { Metadata } from "next";
import { Suspense } from "react";

import { BookOpenCheck } from "lucide-react";

import { LoginForm } from "@/components/auth/login-form";
import { SITE_NAME } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

// Rendered per request: the login form reads `?next=` from the URL.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative flex min-h-[45vh] items-center overflow-hidden bg-primary px-6 py-12 text-primary-foreground sm:px-12 lg:min-h-screen lg:px-16 xl:px-24">
          <div className="absolute -right-16 -top-16 size-56 rounded-full border border-primary-foreground/15" />
          <div className="absolute -right-4 -top-4 size-32 rounded-full border border-primary-foreground/15" />

          <div className="relative mx-auto w-full max-w-xl">
            <div className="mb-12 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-surface text-primary shadow-sm">
                <BookOpenCheck className="size-5" />
              </div>
              <span className="text-lg font-semibold tracking-tight">{SITE_NAME}</span>
            </div>
            <p className="mb-3 text-sm font-medium text-primary-foreground/75">Your team&apos;s shared knowledge</p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Keep the context behind every decision.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-7 text-primary-foreground/75">
              A calm, organised home for the pages, practices and ideas your team relies on.
            </p>

            <div className="mt-10 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-primary-foreground/15 bg-primary-foreground/10 p-4">
                <span className="mb-3 flex size-7 items-center justify-center rounded-md bg-primary-foreground/15 text-xs font-semibold" aria-hidden="true">01</span>
                <p className="text-sm font-medium">Organise with spaces</p>
                <p className="mt-1 text-xs leading-5 text-primary-foreground/65">Keep projects, policies and playbooks easy to navigate.</p>
              </div>
              <div className="rounded-lg border border-primary-foreground/15 bg-primary-foreground/10 p-4">
                <span className="mb-3 flex size-7 items-center justify-center rounded-md bg-primary-foreground/15 text-xs font-semibold" aria-hidden="true">02</span>
                <p className="text-sm font-medium">Find answers faster</p>
                <p className="mt-1 text-xs leading-5 text-primary-foreground/65">Turn scattered context into knowledge your team can trust.</p>
              </div>
              <div className="rounded-lg border border-primary-foreground/15 bg-primary-foreground/10 p-4 sm:col-span-2">
                <span className="mb-3 flex size-7 items-center justify-center rounded-md bg-primary-foreground/15 text-xs font-semibold" aria-hidden="true">03</span>
                <p className="text-sm font-medium">Build a shared source of truth</p>
                <p className="mt-1 text-xs leading-5 text-primary-foreground/65">Give every decision the page, owner and history it needs.</p>
              </div>
            </div>

            <p className="mt-8 text-xs text-primary-foreground/55">Made for focused teams that value clarity.</p>
          </div>
      </section>

      <section className="bg-surface-sunken flex min-h-[55vh] items-center justify-center px-6 py-12 sm:px-12 lg:min-h-screen lg:px-16">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <p className="text-primary mb-2 flex items-center gap-2 text-sm font-medium">
              <BookOpenCheck className="size-4" />
              Your team&apos;s shared knowledge
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
          </div>

          <div className="border-border bg-surface rounded-xl border p-6 shadow-lg shadow-black/5 sm:p-8">
            <div className="mb-7">
              <div className="mb-4 flex items-center justify-between">
                <div className="bg-primary-subtle text-primary flex size-9 items-center justify-center rounded-md text-sm font-semibold" aria-hidden="true">WH</div>
                <span className="text-muted-foreground text-xs">Secure sign in</span>
              </div>
              <h2 className="text-xl font-semibold tracking-tight">Welcome back</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Sign in to continue to {SITE_NAME}.
              </p>
            </div>

            {/* useSearchParams needs a Suspense boundary during prerender. */}
            <Suspense fallback={null}>
              <LoginForm />
            </Suspense>
          </div>

          <p className="text-muted-foreground mt-5 text-center text-xs">Access your workspace securely</p>
        </div>
      </section>
    </main>
  );
}
