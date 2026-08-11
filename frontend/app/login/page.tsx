import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "@/components/auth/login-form";
import { Wordmark } from "@/components/brand/logo";
import { SITE_NAME } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

// Rendered per request: the login form reads `?next=` from the URL.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Wordmark siteName={SITE_NAME} />
        </div>

        <div className="border-border bg-surface rounded-lg border p-6 shadow-sm">
          <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
          <p className="text-muted-foreground mt-1 mb-5 text-sm">
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
