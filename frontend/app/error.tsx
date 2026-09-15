"use client";

import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/context";

export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <main className="bg-surface-sunken flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
      <section
        aria-labelledby="page-load-error-title"
        className="border-border bg-surface-raised w-full max-w-lg rounded-lg border p-6 shadow-sm sm:p-8"
      >
        <div className="bg-warning-bg text-warning flex size-11 items-center justify-center rounded-md">
          <AlertTriangle className="size-5" aria-hidden />
        </div>
        <p className="text-muted-foreground mt-5 text-xs font-semibold tracking-wide uppercase">
          {t("errors.pageUnavailable")}
        </p>
        <h1
          id="page-load-error-title"
          className="text-foreground mt-2 text-2xl font-semibold tracking-normal"
        >
          {t("errors.pageCouldNotLoad")}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          {t("errors.pageCouldNotLoadHint")}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button type="button" variant="primary" onClick={reset}>
            <RefreshCw />
            {t("errors.tryAgain")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (window.history.length > 1) router.back();
              else router.push("/");
            }}
          >
            <ArrowLeft />
            {t("errors.goBack")}
          </Button>
        </div>
      </section>
    </main>
  );
}
