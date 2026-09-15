import { ArrowLeft, BookOpen, FileQuestion, Grid2X2, Home } from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { SITE_NAME } from "@/lib/env";
import { getServerLocale } from "@/lib/i18n/server";

/**
 * Keep the not-found state inside the same workspace chrome as the rest of the
 * product. This is also used by pages that call `notFound()` after a resource
 * disappears, so the copy stays intentionally generic.
 */
export default async function NotFound() {
  const [user, { t }] = await Promise.all([getCurrentUser(), getServerLocale()]);

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
          {t("errors.notFoundEyebrow")}
        </p>
        <h1
          id="not-found-title"
          className="text-foreground mt-2 text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          {t("errors.notFoundTitle")}
        </h1>
        <p className="text-muted-foreground mx-auto mt-3 max-w-md text-sm leading-6 sm:text-base">
          {t("errors.notFoundDescription")}
        </p>

        <div className="mt-7 flex flex-wrap justify-center gap-2">
          <Button variant="primary" size="lg" asChild>
            <Link href="/">
              <Home />
              {t("errors.notFoundGoHome")}
            </Link>
          </Button>
          <Button variant="secondary" size="lg" asChild>
            <Link href="/spaces">
              <Grid2X2 />
              {t("errors.browseSpaces")}
            </Link>
          </Button>
        </div>

        <div className="border-border bg-surface mt-10 flex items-start gap-3 rounded-lg border p-4 text-left">
          <BookOpen
            className="text-muted-foreground mt-0.5 size-4 shrink-0"
            aria-hidden
          />
          <div>
            <p className="text-sm font-medium">{t("errors.notFoundLookingFor")}</p>
            <p className="text-muted-foreground mt-1 text-xs leading-5">
              {t("errors.notFoundLookingForHint")}
            </p>
          </div>
          <ArrowLeft
            className="text-muted-foreground mt-0.5 ml-auto hidden size-4 shrink-0 sm:block"
            aria-hidden
          />
        </div>
      </section>
    </div>
  );

  if (!user) {
    return (
      <main className="bg-surface-sunken min-h-screen px-5 py-10 sm:px-8">
        <div className="max-w-content mx-auto">{content}</div>
      </main>
    );
  }

  return (
    <AppShell siteName={SITE_NAME} user={user}>
      {content}
    </AppShell>
  );
}
