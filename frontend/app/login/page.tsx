import type { Metadata } from "next";
import { Suspense } from "react";

import { BookOpenCheck } from "lucide-react";

import { LoginForm } from "@/components/auth/login-form";
import { Wordmark } from "@/components/brand/logo";
import { SITE_NAME } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

// Rendered per request: the login form reads `?next=` from the URL.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="bg-surface-sunken flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Wordmark siteName={SITE_NAME} />
          <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-sm">
            <BookOpenCheck className="text-primary size-4" />
            Your team&apos;s shared knowledge
          </p>
        </div>

        <div className="border-border bg-surface rounded-xl border p-6 shadow-md shadow-black/5">
          <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
          <p className="text-muted-foreground mt-1 mb-6 text-sm">
            Sign in to continue to {SITE_NAME}.
          </p>

          {/* useSearchParams needs a Suspense boundary during prerender. */}
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
