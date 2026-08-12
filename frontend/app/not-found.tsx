import { ArrowLeft, BookOpen, FileQuestion, Grid2X2, Home } from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";

/**
 * Keep the not-found state inside the same workspace chrome as the rest of the
 * product. This is also used by pages that call `notFound()` after a resource
 * disappears, so the copy stays intentionally generic.
 */
export default async function NotFound() {
  const user = await getCurrentUser();

  const content = (
    <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center py-8">
      <section
        aria-labelledby="not-found-title"
        className="w-full max-w-xl text-center"
      >
        <div className="border-border bg-primary-subtle text-primary mx-auto flex size-16 items-center justify-center rounded-2xl border">
          <FileQuestion className="size-8" strokeWidth={1.75} aria-hidden />
        </div>

        <p className="text-primary mt-6 text-sm font-semibold tracking-wide uppercase">
          Error 404
        </p>
        <h1
          id="not-found-title"
          className="text-foreground mt-2 text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          This page is not in the hub
        </h1>
        <p className="text-muted-foreground mx-auto mt-3 max-w-md text-sm leading-6 sm:text-base">
          The page may have moved, been archived, or the link may be out of
          date. Let&apos;s get you back to useful team knowledge.
        </p>

        <div className="mt-7 flex flex-wrap justify-center gap-2">
          <Button variant="primary" size="lg" asChild>
            <Link href="/">
              <Home />
              Go to home
            </Link>
          </Button>
          <Button variant="secondary" size="lg" asChild>
            <Link href="/spaces">
              <Grid2X2 />
              Browse spaces
            </Link>
          </Button>
        </div>

        <div className="border-border bg-surface mt-10 flex items-start gap-3 rounded-lg border p-4 text-left">
          <BookOpen className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="text-sm font-medium">Looking for a document?</p>
            <p className="text-muted-foreground mt-1 text-xs leading-5">
              Start from a space or use the navigation rail to find the right
              page.
            </p>
          </div>
          <ArrowLeft className="text-muted-foreground ml-auto mt-0.5 hidden size-4 shrink-0 sm:block" aria-hidden />
        </div>
      </section>
    </div>
  );

  if (!user) {
    return (
      <main className="bg-surface-sunken min-h-screen px-5 py-10 sm:px-8">
        <div className="mx-auto max-w-content">{content}</div>
      </main>
    );
  }

  return (
    <AppShell siteName={SITE_NAME} user={user}>
      {content}
    </AppShell>
  );
}
