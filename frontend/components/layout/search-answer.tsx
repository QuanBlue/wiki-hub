"use client";

import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Loader2,
  RotateCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";

import { IssueMarkdown } from "@/components/issues/issue-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  citeLinks,
  type AnswerResult,
  type AnswerSource,
} from "@/lib/ai-answer";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/** Where an answer stands: being written, written, or failed (with the words to show). */
export type AnswerState =
  | { status: "loading" }
  | { status: "done"; result: AnswerResult }
  | { status: "error"; message: string };

/** How long a question runs before the panel says it is still working, and then that it is slow. */
const SLOW_AFTER_MS = 6000;
const VERY_SLOW_AFTER_MS = 20000;

function SourceRow({
  source,
  onOpen,
  numbered,
}: {
  source: AnswerSource;
  onOpen: (source: AnswerSource) => void;
  numbered: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(source)}
        // What was read from the page, on hover, so the row itself stays one line.
        title={source.excerpt || source.title}
        className="hover:bg-surface-hover focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
      >
        {numbered ? (
          <span className="bg-primary-subtle text-primary inline-flex min-w-5 shrink-0 items-center justify-center rounded px-1 text-[11px] leading-5 font-semibold">
            {source.n}
          </span>
        ) : (
          <FileText
            className="text-muted-foreground size-3.5 shrink-0"
            aria-hidden
          />
        )}
        <span className="text-foreground/90 min-w-0 flex-1 truncate text-[13px]">
          {source.title}
        </span>
        <Badge variant="subtle" className="shrink-0 font-mono text-[10px]">
          {source.space_key}
        </Badge>
      </button>
    </li>
  );
}

/** Pages that were read but not cited: folded away, so they are never mistaken for sources. */
function AlsoRead({
  pages,
  onOpen,
}: {
  pages: AnswerSource[];
  onOpen: (source: AnswerSource) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-label={t("search.answerRelated")}
      className="border-border/70 mt-1 border-t pt-1"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground hover:bg-surface-hover focus-visible:ring-ring flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
      >
        <ChevronRight
          className={cn(
            "size-3 transition-transform duration-150",
            open && "rotate-90",
          )}
          aria-hidden
        />
        {t("search.answerRelated")} ({pages.length})
      </button>
      {open ? (
        <ul className="mt-0.5 space-y-0.5 opacity-90">
          {pages.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              onOpen={onOpen}
              numbered={false}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <h4 className="text-muted-foreground px-2 pb-0.5 text-[10px] font-semibold tracking-wider uppercase">
      {children}
    </h4>
  );
}

/**
 * The answer to a question asked from the search box. The answer itself is the page's focus: a
 * raised, bordered card with larger text. The pages it came from sit quietly under it, and the
 * reminder to check them is the smallest, dimmest thing here. When the wiki has no answer, it
 * says so and offers the pages that may help.
 */
export function SearchAnswer({
  question,
  state,
  onBack,
  onRetry,
  onOpen,
}: {
  question: string;
  state: AnswerState;
  onBack: () => void;
  onRetry: () => void;
  onOpen: (source: AnswerSource) => void;
}) {
  const { t } = useTranslation();
  // 0: just started, 1: taking a while, 2: slow - and then the way out is spelled out.
  const [slowness, setSlowness] = useState<0 | 1 | 2>(0);

  // Say it is still working, then that it is slow; start over when a new answer begins.
  useEffect(() => {
    if (state.status !== "loading") return;
    const first = setTimeout(() => setSlowness(1), SLOW_AFTER_MS);
    const second = setTimeout(() => setSlowness(2), VERY_SLOW_AFTER_MS);
    return () => {
      clearTimeout(first);
      clearTimeout(second);
      setSlowness(0);
    };
  }, [state.status, question]);

  const result = state.status === "done" ? state.result : null;
  const notFoundKey = result
    ? ({
        no_match: "search.answerNoMatch",
        not_in_pages: "search.answerNotInPages",
        ungrounded: "search.answerUngrounded",
      }[result.reason] ?? "search.answerNotInPages")
    : "";
  const byNumber = new Map(
    (result?.sources ?? []).map((source) => [source.n, source]),
  );

  return (
    <div
      className="space-y-3 px-1 py-1"
      aria-live="polite"
      aria-busy={state.status === "loading"}
    >
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-1">
          <ArrowLeft aria-hidden />
          {t("search.answerBack")}
        </Button>
        <span
          className="text-muted-foreground min-w-0 flex-1 truncate text-xs"
          title={question}
        >
          “{question}”
        </span>
      </div>

      {state.status === "loading" ? (
        <div className="text-muted-foreground flex flex-col items-center gap-1 py-10 text-sm">
          <span className="flex items-center">
            <Loader2
              className="text-primary mr-2 size-5 animate-spin"
              aria-hidden
            />
            {t("search.answerLoading")}
          </span>
          {slowness === 1 ? (
            <span className="text-xs">{t("search.answerSlow")}</span>
          ) : null}
          {slowness === 2 ? (
            <span className="max-w-xs text-center text-xs">
              {t("search.answerVerySlow")}
            </span>
          ) : null}
        </div>
      ) : null}

      {state.status === "error" ? (
        <div role="alert" className="space-y-3 py-6 text-center">
          <p className="text-danger flex items-start justify-center gap-2 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {state.message}
          </p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RotateCw aria-hidden />
            {t("search.answerRetry")}
          </Button>
        </div>
      ) : null}

      {result?.found ? (
        <div className="space-y-3">
          <div className="border-primary/30 bg-surface rounded-xl border px-5 py-4 shadow-sm">
            <div className="text-primary mb-2.5 flex items-center gap-1.5 text-xs font-semibold">
              <Sparkles className="size-4" aria-hidden />
              {t("search.answerTitle")}
            </div>
            <IssueMarkdown
              source={citeLinks(result.answer)}
              autolink
              onCite={(n) => {
                const source = byNumber.get(n);
                if (source) onOpen(source);
              }}
              className="text-foreground text-[15px] leading-7"
            />
          </div>

          <section aria-label={t("search.answerSources")} className="px-1">
            <SectionLabel>{t("search.answerSources")}</SectionLabel>
            <ul className="space-y-0.5">
              {result.sources.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  onOpen={onOpen}
                  numbered
                />
              ))}
            </ul>
            {result.related.length ? (
              <AlsoRead pages={result.related} onOpen={onOpen} />
            ) : null}
          </section>

          <p className="text-muted-foreground/70 px-3 text-[10px]">
            {t("search.answerCheck")}
          </p>
        </div>
      ) : null}

      {result && !result.found ? (
        <div className={cn("space-y-3", result.related.length ? "" : "py-6")}>
          <p
            className="text-muted-foreground px-1 text-center text-sm"
            role="status"
          >
            {t(notFoundKey)}
          </p>
          {result.related.length ? (
            <section aria-label={t("search.answerMayHelp")} className="px-1">
              <SectionLabel>{t("search.answerMayHelp")}</SectionLabel>
              <ul className="space-y-0.5">
                {result.related.map((source) => (
                  <SourceRow
                    key={source.id}
                    source={source}
                    onOpen={onOpen}
                    numbered={false}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
