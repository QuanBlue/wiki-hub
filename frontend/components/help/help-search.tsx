"use client";

import { ArrowRight, ArrowUpRight, CornerDownLeft, Loader2, MessageCircle, Search, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { IssueMarkdown } from "@/components/issues/issue-markdown";
import { Button } from "@/components/ui/button";
import { openChat } from "@/lib/ai-chat";
import { aiStatus } from "@/lib/ai-summary";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

import { sectionsEn } from "./help-content.en";
import { sectionsVi } from "./help-content.vi";
import { categoryInfo, guideHref, searchGuides } from "./help-data";
import type { HelpSection } from "./help-ui";

type HelpGuideRef = { id: string; title: string; category: string };
type HelpAction = { id: string; href: string; label_en: string; label_vi: string };
type HelpAnswer = {
  found: boolean;
  answer: string;
  guides: HelpGuideRef[];
  /** Pages of the application the answer is about, that this person may open. */
  actions?: HelpAction[];
};
type AskState =
  | { status: "idle" }
  | { status: "loading"; question: string }
  | { status: "done"; question: string; result: HelpAnswer }
  | { status: "failed"; question: string };

/** Open a guide: on its own topic page that is just a change of hash, elsewhere a navigation. */
export function openGuide(
  router: ReturnType<typeof useRouter>,
  guide: Pick<HelpSection, "id" | "category">,
): void {
  const href = guideHref(guide);
  const [path, hash] = href.split("#");
  if (typeof window !== "undefined" && window.location.pathname === path) {
    window.location.hash = hash!;
  } else {
    router.push(href);
  }
}

/**
 * The search box of the Help centre. As you type it lists the guides that match, at once and
 * without leaving the keyboard; Enter (or "Ask the AI assistant") has the assistant answer the
 * question from the guides themselves and name the ones to open.
 */
export function HelpSearch({
  sections,
  variant = "hero",
  suggestions = [],
}: {
  sections: HelpSection[];
  variant?: "hero" | "compact";
  /** Questions offered under the box, one click to ask. */
  suggestions?: string[];
}) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [ask, setAsk] = useState<AskState>({ status: "idle" });
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const asked = useRef(0);

  useEffect(() => {
    let live = true;
    void aiStatus().then((status) => {
      if (live) setAiEnabled(status.enabled);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const trimmed = query.trim();
  const matches = useMemo(
    () =>
      trimmed.length >= 2
        ? searchGuides(
            sections,
            trimmed,
            variant === "hero" ? 6 : 5,
            // The same guides in the other language: a question in either finds them.
            sections === sectionsEn ? sectionsVi : sectionsEn,
          )
        : [],
    [sections, trimmed, variant],
  );
  const canAsk = aiEnabled && trimmed.length >= 2;
  // The rows the arrow keys move through: "ask the assistant" (at the top), then the guides.
  const askRow = canAsk ? 1 : 0;
  const rows = matches.length + askRow;

  async function askAssistant(question: string) {
    const ticket = ++asked.current;
    setOpen(true);
    setAsk({ status: "loading", question });
    try {
      const result = await api.post<HelpAnswer>("/api/v1/ai/help", { question, locale });
      if (ticket === asked.current) setAsk({ status: "done", question, result });
    } catch {
      if (ticket === asked.current) setAsk({ status: "failed", question });
    }
  }

  function choose(index: number) {
    if (canAsk && index === 0) {
      void askAssistant(trimmed);
      return;
    }
    const match = matches[index - askRow];
    if (match) {
      setOpen(false);
      openGuide(router, match.section);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && rows > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((current) => (current + 1) % rows);
    } else if (event.key === "ArrowUp" && rows > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((current) => (current <= 0 ? rows - 1 : current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active >= 0) choose(active);
      else if (canAsk) void askAssistant(trimmed);
      else if (matches[0]) choose(0);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const showPanel = open && (trimmed.length >= 2 || ask.status !== "idle");
  const hero = variant === "hero";

  return (
    <div ref={box} className="relative w-full">
      <div className="relative">
        <Search
          className={cn(
            "text-muted-foreground pointer-events-none absolute top-1/2 -translate-y-1/2",
            hero ? "left-4 size-5" : "left-3 size-4",
          )}
          aria-hidden
        />
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
            setOpen(true);
            if (ask.status !== "idle") setAsk({ status: "idle" });
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t(hero ? "help.searchPlaceholder" : "help.searchPlaceholderShort")}
          aria-label={t("help.searchAria")}
          aria-controls="help-search-results"
          autoComplete="off"
          className={cn(
            "border-border bg-surface text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-ring/30 w-full border transition-[border-color,box-shadow] duration-150 focus-visible:ring-4 focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden",
            hero
              ? "h-14 rounded-xl pr-28 pl-12 text-base shadow-sm"
              : "h-9 rounded-md pr-8 pl-9 text-sm",
          )}
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setAsk({ status: "idle" });
              input.current?.focus();
            }}
            aria-label={t("help.clearSearch")}
            className={cn(
              "text-muted-foreground hover:text-foreground hover:bg-surface-hover focus-visible:ring-ring absolute top-1/2 grid -translate-y-1/2 place-items-center rounded-md transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
              hero ? "right-24 size-7" : "right-1.5 size-6",
            )}
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
        {hero ? (
          <button
            type="button"
            disabled={!canAsk}
            onClick={() => void askAssistant(trimmed)}
            className="bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-ring absolute top-1/2 right-2 inline-flex h-10 -translate-y-1/2 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-[background-color,opacity] duration-150 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            title={aiEnabled ? t("help.askAi") : t("help.aiOff")}
          >
            <Sparkles className="size-4" aria-hidden />
            {t("help.askButton")}
          </button>
        ) : null}

      {showPanel ? (
        <div
          id="help-search-results"
          role="region"
          aria-label={t("help.resultsAria")}
          className={cn(
            "border-border bg-surface absolute top-full left-0 z-30 mt-2 overflow-y-auto rounded-xl border text-left shadow-lg",
            // Beside the guides the box is narrow: its results spread over the page instead.
            hero
              ? "right-0 max-h-[min(60vh,26rem)]"
              : "w-[min(34rem,calc(100vw-2.5rem))] max-h-[min(70vh,30rem)]",
          )}
        >
          {/* First and stuck to the top of the list, so it stays in view however far the guides below
              are scrolled. */}
          {canAsk && ask.status === "idle" ? (
            <div className="border-border bg-surface sticky top-0 z-10 rounded-t-xl border-b p-1.5">
              <button
                type="button"
                onMouseEnter={() => setActive(0)}
                onClick={() => void askAssistant(trimmed)}
                className={cn(
                  "focus-visible:ring-ring flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  active === 0 ? "bg-surface-hover" : "hover:bg-surface-hover",
                )}
              >
                <span className="bg-primary text-primary-foreground grid size-7 shrink-0 place-items-center rounded-md">
                  <Sparkles className="size-3.5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="text-foreground font-medium">{t("help.askAi")}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    “{trimmed}”
                  </span>
                </span>
                <CornerDownLeft className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
              </button>
            </div>
          ) : null}
          <AnswerCard
            state={ask}
            onGuide={(guide) => {
              setOpen(false);
              openGuide(router, guide as Pick<HelpSection, "id" | "category">);
            }}
          />

          {matches.length > 0 ? (
            <div className="p-1.5">
              <p className="text-muted-foreground px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide uppercase">
                {t("help.guidesHeading")}
              </p>
              <ul>
                {matches.map((match, index) => {
                  const category = categoryInfo(match.section.category);
                  const Icon = category.icon;
                  return (
                    <li key={match.section.id}>
                      <button
                        type="button"
                        onMouseEnter={() => setActive(index + askRow)}
                        onClick={() => choose(index + askRow)}
                        className={cn(
                          "focus-visible:ring-ring flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                          active === index + askRow ? "bg-surface-hover" : "hover:bg-surface-hover",
                        )}
                      >
                        <span className="bg-primary-subtle text-primary mt-0.5 grid size-7 shrink-0 place-items-center rounded-md">
                          <Icon className="size-3.5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="text-foreground truncate text-sm font-medium">
                              {match.section.title}
                            </span>
                            <span className="text-muted-foreground shrink-0 text-[11px]">
                              {t(`help.${category.dict}Title`)}
                            </span>
                          </span>
                          <span className="text-muted-foreground mt-0.5 line-clamp-2 block text-xs leading-5">
                            {match.snippet}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : trimmed.length >= 2 && ask.status === "idle" ? (
            <p className="text-muted-foreground px-4 py-3 text-sm" role="status">
              {t("help.noResults", { query: trimmed })}
            </p>
          ) : null}

        </div>
      ) : null}
      </div>

      {hero && suggestions.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className="text-muted-foreground text-xs">{t("help.suggestionsLabel")}</span>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => {
                setQuery(suggestion);
                setActive(-1);
                if (aiEnabled) void askAssistant(suggestion);
                else setOpen(true);
                input.current?.focus();
              }}
              className="border-border bg-surface text-muted-foreground hover:text-foreground hover:border-border-strong hover:bg-surface-hover focus-visible:ring-ring rounded-full border px-3 py-1 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AnswerCard({
  state,
  onGuide,
}: {
  state: AskState;
  onGuide: (guide: HelpGuideRef) => void;
}) {
  const { t, locale } = useTranslation();
  if (state.status === "idle") return null;
  return (
    <div className="border-border bg-primary-subtle/40 border-b p-4" aria-live="polite">
      <p className="text-primary flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
        <Sparkles className="size-3.5" aria-hidden />
        {t("help.aiAnswerTitle")}
      </p>
      {state.status === "loading" ? (
        <p className="text-muted-foreground mt-2 flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t("help.aiThinking")}
        </p>
      ) : state.status === "failed" ? (
        <p className="text-warning mt-2 text-sm">{t("help.aiFailed")}</p>
      ) : (
        <>
          {state.result.found ? (
            <IssueMarkdown
              source={state.result.answer}
              className="text-foreground mt-2 text-sm leading-6"
            />
          ) : (
            <p className="text-muted-foreground mt-2 text-sm">{t("help.aiNotFound")}</p>
          )}
          {(state.result.actions ?? []).length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(state.result.actions ?? []).map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-ring inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
                >
                  {locale === "vi" ? action.label_vi : action.label_en}
                  <ArrowUpRight className="size-3.5" aria-hidden />
                </Link>
              ))}
            </div>
          ) : null}
          {state.result.guides.length > 0 ? (
            <div className="mt-3">
              <p className="text-muted-foreground text-xs font-medium">
                {t("help.relatedGuides")}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {state.result.guides.map((guide) => (
                  <button
                    key={guide.id}
                    type="button"
                    onClick={() => onGuide(guide)}
                    className="border-border bg-surface text-foreground hover:border-primary/60 hover:text-primary focus-visible:ring-ring inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {guide.title}
                    <ArrowRight className="size-3" aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
      {state.status !== "loading" ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3 -ml-2"
          onClick={() => openChat({ question: state.question })}
        >
          <MessageCircle />
          {t("help.continueInChat")}
        </Button>
      ) : null}
    </div>
  );
}
