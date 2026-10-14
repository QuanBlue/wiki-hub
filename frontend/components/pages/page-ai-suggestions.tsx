"use client";

import {
  ArrowUpRight,
  Check,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  aiStatus,
  suggestForPage,
  type AiStatus,
  type PageSuggestions,
} from "@/lib/ai-summary";
import { ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/**
 * "Suggest with AI" for a page: labels worth adding (one click adds one) and
 * existing pages that cover the same ground (they open in a new tab). It only
 * asks when the button is pressed, and the server remembers the answer until
 * the page changes, so reopening is free.
 */
export function PageAiSuggestions({
  spaceKey,
  slug,
  labelNames,
  onAddLabel,
}: {
  spaceKey: string;
  slug: string;
  /** Labels the page already has, so a suggestion is not offered twice. */
  labelNames: string[];
  onAddLabel: (name: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<PageSuggestions | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void aiStatus().then((value) => {
      if (active) setStatus(value);
    });
    return () => {
      active = false;
    };
  }, []);

  async function ask() {
    setPending(true);
    setError(null);
    try {
      setResult(await suggestForPage(spaceKey, slug));
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status !== 404 && caught.message
          ? caught.message
          : t("ai.suggest.error"),
      );
    } finally {
      setPending(false);
    }
  }

  // Not drawn until the status is known, so there is no flicker of a wrong state.
  if (status === null) return null;
  const enabled = status.enabled;
  const have = new Set(labelNames.map((name) => name.toLowerCase()));
  const labels = (result?.labels ?? []).filter(
    (label) => !have.has(label.name.toLowerCase()),
  );
  const related = result?.related ?? [];
  const nothing =
    result !== null && labels.length === 0 && related.length === 0;
  const asked = result !== null;

  return (
    <section
      aria-label={t("ai.suggest.title")}
      className="border-border bg-surface mt-5 overflow-hidden rounded-xl border shadow-xs"
    >
      <div className="flex items-start gap-3 p-4">
        <span className="bg-primary-subtle text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
          <Sparkles className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("ai.suggest.title")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            {!enabled
              ? t("ai.suggest.off")
              : asked
                ? t("ai.suggest.basedOn")
                : t("ai.suggest.hint")}
          </p>
        </div>
        {asked ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!enabled || pending}
            onClick={() => void ask()}
          >
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <RefreshCw aria-hidden />
            )}
            {pending ? t("ai.suggest.working") : t("ai.suggest.again")}
          </Button>
        ) : null}
      </div>

      {!asked ? (
        <div className="px-4 pb-4">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={!enabled || pending}
            title={enabled ? undefined : t("ai.notEnabledTitle")}
            onClick={() => void ask()}
          >
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Sparkles aria-hidden />
            )}
            {pending ? t("ai.suggest.working") : t("ai.suggest.button")}
          </Button>
        </div>
      ) : null}

      {pending && !asked ? (
        <div
          role="status"
          className="border-border flex animate-pulse flex-wrap gap-2 border-t px-4 py-3"
        >
          <span className="sr-only">{t("ai.suggest.working")}</span>
          {[72, 96, 64, 84].map((width) => (
            <span
              key={width}
              className="bg-border h-6 rounded-full"
              style={{ width }}
            />
          ))}
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="text-danger bg-danger-bg border-danger/40 m-4 mt-0 flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {nothing ? (
        <p className="text-muted-foreground border-border border-t px-4 py-3 text-sm">
          {t("ai.suggest.nothing")}
        </p>
      ) : null}

      {labels.length > 0 ? (
        <div
          className={cn(
            "border-border border-t px-4 py-3 transition-opacity duration-150",
            pending && "opacity-50",
          )}
        >
          <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-[0.06em] uppercase">
            {t("ai.suggest.labels")}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {labels.map((label) => (
              <li key={label.name}>
                <button
                  type="button"
                  onClick={() => void onAddLabel(label.name)}
                  title={label.existing ? t("ai.suggest.yours") : undefined}
                  className={cn(
                    "focus-visible:ring-ring inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                    label.existing
                      ? "border-primary/40 bg-primary-subtle text-primary hover:bg-primary-subtle/70"
                      : "border-border bg-surface hover:bg-surface-hover",
                  )}
                >
                  {label.existing ? (
                    <Check className="size-3" aria-hidden />
                  ) : (
                    <Plus className="size-3" aria-hidden />
                  )}
                  {label.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {related.length > 0 ? (
        <div
          className={cn(
            "border-border border-t px-4 py-3 transition-opacity duration-150",
            pending && "opacity-50",
          )}
        >
          <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-[0.06em] uppercase">
            {t("ai.suggest.related")}
          </p>
          <ul className="space-y-1.5">
            {related.map((page) => (
              <li key={page.id}>
                <a
                  href={`/spaces/${encodeURIComponent(page.space_key)}/pages/${encodeURIComponent(page.slug)}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="border-border bg-surface hover:bg-surface-hover focus-visible:ring-ring group flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                >
                  <FileText
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block truncate text-sm font-medium">
                      {page.title}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {page.space_name}
                    </span>
                  </span>
                  <ArrowUpRight
                    className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors duration-150"
                    aria-hidden
                  />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
