"use client";

import { Languages, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AiNotSetUp } from "@/components/pages/ai-not-set-up";
import { IssueMarkdown } from "@/components/issues/issue-markdown";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/info-tip";
import {
  aiStatus,
  resetAiStatus,
  linkAttachments,
  openAttachment,
  type AiStatus,
  type SummaryAttachment,
} from "@/lib/ai-summary";
import { api, ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

type PageSummary = {
  summary: string;
  cached: boolean;
  too_short: boolean;
  attachments?: SummaryAttachment[];
};

type SummaryLanguage = "page" | "en" | "vi";

const SUMMARY_LANGUAGES: SummaryLanguage[] = ["page", "en", "vi"];

const LANGUAGE_LABEL_KEY = {
  page: "ai.languagePage",
  en: "ai.languageEn",
  vi: "ai.languageVi",
} as const;

/**
 * The page's TL;DR: an AI summary in a dialog, opened from the page toolbar.
 * The toolbar button is always there so people can find it; until an
 * administrator connects an endpoint the dialog explains that instead (and
 * links administrators to the settings). The server caches a summary until the
 * page changes, so reopening it costs no model call.
 */
export function PageSummaryDialog({
  open,
  onOpenChange,
  spaceKey,
  pageSlug,
  pageTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceKey: string;
  pageSlug: string;
  pageTitle: string;
}) {
  const { t } = useTranslation();
  // `null` while the availability is still being looked up.
  const [status, setStatus] = useState<AiStatus | null>(null);

  useEffect(() => {
    let active = true;
    void aiStatus().then((value) => {
      if (active) setStatus(value);
    });
    return () => {
      active = false;
    };
  }, []);

  const off = status !== null && !status.enabled;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        // Radix focuses the first control on open, which would be the "i" and
        // pop its tooltip open before anyone hovers. Focus the dialog itself.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
        title={off ? t("ai.notEnabledTitle") : t("ai.title")}
        // The caveat lives behind the "i", so it stays out of the way.
        titleAddon={
          off ? null : (
            <InfoTip>{t("ai.description", { title: pageTitle })}</InfoTip>
          )
        }
      >
        {/* Mounted only while open, so each opening asks for the summary afresh
            (the server answers from its cache when the page hasn't changed). */}
        <SummaryBody
          status={status}
          spaceKey={spaceKey}
          pageSlug={pageSlug}
          onClose={() => onOpenChange(false)}
          // The assistant was switched off after this page last asked about it.
          onDisabled={() => {
            resetAiStatus();
            setStatus((current) => ({
              enabled: false,
              can_configure: current?.can_configure ?? false,
            }));
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function SummaryBody({
  status,
  spaceKey,
  pageSlug,
  onClose,
  onDisabled,
}: {
  status: AiStatus | null;
  spaceKey: string;
  pageSlug: string;
  onClose: () => void;
  onDisabled: () => void;
}) {
  const { t, apiErrorText } = useTranslation();
  const [pending, setPending] = useState(true);
  const [result, setResult] = useState<PageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "page" writes in the page's own language; the others switch the summary.
  const [language, setLanguage] = useState<SummaryLanguage>("page");
  const enabled = status?.enabled === true;

  async function load(refresh: boolean, lang: SummaryLanguage = language) {
    setPending(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (lang !== "page") params.set("lang", lang);
      if (refresh) params.set("refresh", "true");
      const query = params.toString();
      const base = `/api/v1/ai/spaces/${encodeURIComponent(spaceKey)}/pages/${encodeURIComponent(pageSlug)}/summary`;
      setResult(await api.post<PageSummary>(query ? `${base}?${query}` : base));
    } catch (err) {
      // "Not enabled" means an administrator turned the assistant off (or removed
      // its connection) since the status was looked up: show the set-up state
      // instead of an error with live-looking buttons under it.
      if (
        err instanceof ApiError &&
        err.status === 503 &&
        /not enabled/i.test(err.message)
      ) {
        onDisabled();
      } else {
        setError(apiErrorText(err, "ai.failed"));
      }
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => void load(false), 0);
    return () => clearTimeout(timer);
    // Once, when the dialog opens and the assistant is known to be on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const hasSummary = Boolean(result?.summary.trim());
  // A summary already on screen is kept while the next one loads.
  const showingSummary = hasSummary && !result?.too_short && !error;

  function chooseLanguage(next: SummaryLanguage) {
    if (next === language || pending) return;
    setLanguage(next);
    void load(false, next);
  }

  return (
    <>
      {enabled ? (
        <div className="mb-3 flex items-center gap-2">
          <Languages
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden
          />
          <div
            role="radiogroup"
            aria-label={t("ai.languageLabel")}
            className="border-border bg-surface-sunken inline-flex rounded-md border p-0.5"
          >
            {SUMMARY_LANGUAGES.map((option) => {
              const selected = language === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={pending && !selected}
                  onClick={() => chooseLanguage(option)}
                  className={cn(
                    "focus-visible:ring-ring cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                    selected
                      ? "bg-surface text-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-surface-hover hover:text-foreground active:bg-surface-selected",
                  )}
                >
                  {t(LANGUAGE_LABEL_KEY[option])}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div
        aria-live="polite"
        aria-busy={pending}
        className="relative min-h-40 text-base"
      >
        {status !== null && !status.enabled ? (
          <AiNotSetUp canConfigure={status.can_configure} />
        ) : status === null || (pending && !showingSummary) ? (
          // The same centred pill as when a summary is being replaced, so the
          // first load and a language switch look alike.
          <div className="flex h-56 items-center justify-center">
            <span
              role="status"
              className="border-border bg-surface text-foreground flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-md"
            >
              <Loader2
                className="text-primary size-4 animate-spin"
                aria-hidden
              />
              {t("ai.loading")}
            </span>
          </div>
        ) : error ? (
          <p className="text-danger">{error}</p>
        ) : result?.too_short ? (
          <p className="text-muted-foreground">{t("ai.tooShort")}</p>
        ) : hasSummary && result ? (
          <>
            {/* While a new version loads (another language, or again) the
                current one stays put, dimmed, so the dialog doesn't collapse and
                jump. */}
            {pending ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center">
                <span
                  role="status"
                  className="border-border bg-surface text-foreground flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-md"
                >
                  <Loader2
                    className="text-primary size-4 animate-spin"
                    aria-hidden
                  />
                  {t("ai.loading")}
                </span>
              </div>
            ) : null}
            {/* The model answers in Markdown: bold terms, code, lists. Web
                addresses are links, and a file's name opens that file. */}
            <IssueMarkdown
              source={linkAttachments(result.summary, result.attachments ?? [])}
              autolink
              // The file's viewer opens on top of this dialog, which stays open
              // underneath, so closing the viewer returns to the summary.
              onOpenAttachment={openAttachment}
              className={cn(
                "max-h-[60vh] overflow-y-auto pr-1 text-[15px] leading-relaxed transition-[opacity,filter] duration-200",
                // The old text sinks into the background while the new one loads.
                pending &&
                  "pointer-events-none opacity-30 blur-[1px] select-none",
              )}
            />
            {result.cached ? (
              <p className="text-muted-foreground mt-3 text-xs">
                {t("ai.cached")}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
      <DialogFooter>
        {enabled ? (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => void load(true)}
          >
            {t("ai.regenerate")}
          </Button>
        ) : status?.can_configure ? (
          <Button asChild variant="primary">
            <Link href="/admin/ai">{t("ai.openSettings")}</Link>
          </Button>
        ) : null}
        <Button onClick={onClose}>{t("ai.close")}</Button>
      </DialogFooter>
    </>
  );
}
